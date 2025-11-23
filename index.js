// ============================================================================
// IMPORTS - Chargement des bibliothèques nécessaires
// ============================================================================

// discord.js : bibliothèque pour interagir avec l'API Discord
import { Client, GatewayIntentBits, Partials, EmbedBuilder } from 'discord.js';
// express : serveur web léger pour le monitoring de disponibilité (uptime)
import express from 'express';
// fs : système de fichiers Node.js pour sauvegarder/charger les timers
import fs from 'fs';

// ============================================================================
// CONFIGURATION DU CLIENT DISCORD
// ============================================================================

// Création du client Discord avec les permissions et paramètres nécessaires
const client = new Client({
  // Intents : permissions demandées à Discord pour recevoir certains événements
  intents: [
    GatewayIntentBits.Guilds,                    // Accès aux serveurs Discord
    GatewayIntentBits.DirectMessages,            // Accès aux messages privés (DM)
    GatewayIntentBits.DirectMessageReactions,    // Accès aux réactions sur les DM
    GatewayIntentBits.MessageContent,            // Accès au contenu des messages
  ],
  // Partials : permet de recevoir des événements même si les objets ne sont pas en cache
  partials: [
    Partials.Channel,   // Canaux partiels (nécessaire pour les DM)
    Partials.Message,   // Messages partiels
    Partials.Reaction,  // Réactions partielles (important pour les réactions en DM)
  ],
});

// === DEBUG DISCORD.JS  ===
client.rest.on('invalidRequestWarning', console.warn);

client.on('error', (err) => {
  console.error('🔥 [CLIENT ERROR]', err);
});

client.on('debug', (msg) => {
  console.log('🐛 [DEBUG]', msg);
});

client.rest.on('rateLimited', (info) => {
  console.warn('⏳ [RATE LIMIT]', info);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ [UNHANDLED REJECTION]', reason);
});

// ============================================================================
// CONFIGURATION DU SERVEUR EXPRESS (MONITORING)
// ============================================================================

// Création du serveur HTTP pour permettre le monitoring externe (UptimeRobot, etc.)
const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// CONSTANTES ET STRUCTURES DE DONNÉES
// ============================================================================

// Nom du fichier JSON où sont sauvegardés tous les timers
const TIMERS_FILE = 'timers.json';

// LIMITE MAXIMALE : 20 timers par utilisateur (actifs + terminés non annulés)
// Raison : Discord limite à 20 réactions par message
const MAX_TIMERS_PER_USER = 20;

// Map JavaScript pour stocker tous les timers en mémoire
// Clé : ID unique du timer (userId-timestamp)
// Valeur : objet timer { id, userId, text, endTime, startTime, ended }
const timers = new Map();

// Map pour stocker les timeouts Node.js actifs (pour pouvoir les annuler)
// Clé : ID du timer
// Valeur : objet Timeout retourné par setTimeout()
const activeTimeouts = new Map();

// Map pour stocker les informations des messages récapitulatifs en DM
// Clé : userId
// Valeur : { userId, messageId, channelId }
const summaryMessagesMap = new Map();

// Tableau des 25 emojis régionaux (lettres A-Y) utilisés pour les réactions
// Note : Discord permet jusqu'à 20 réactions, donc on n'utilisera que les 20 premiers
const EMOJI_LETTERS = [
  '🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭', '🇮', '🇯',
  '🇰', '🇱', '🇲', '🇳', '🇴', '🇵', '🇶', '🇷', '🇸', '🇹'
];

// ============================================================================
// GESTION DES RATE LIMITS DISCORD
// ============================================================================

// Classe pour gérer les délais entre les requêtes Discord et éviter les rate limits
// Discord impose des limites : max 5 messages/s, max 50 requêtes/s en général
class RateLimiter {
  constructor(maxPerSecond = 3) {
    // Nombre maximum d'opérations par seconde (on reste conservateur : 3/s)
    this.maxPerSecond = maxPerSecond;
    // File d'attente des timestamps des dernières opérations
    this.queue = [];
  }

  // Attend le temps nécessaire avant d'autoriser une nouvelle opération
  async waitIfNeeded() {
    const now = Date.now();
    // Nettoie les timestamps plus vieux qu'une seconde
    this.queue = this.queue.filter(timestamp => now - timestamp < 1000);
    
    // Si on a déjà atteint la limite ce tte seconde
    if (this.queue.length >= this.maxPerSecond) {
      // Calcule combien de temps attendre avant que le plus ancien expire
      const oldestTimestamp = this.queue[0];
      const waitTime = 1000 - (now - oldestTimestamp) + 100; // +100ms de marge
      
      // Attend avant de continuer
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      // Nettoie à nouveau après l'attente
      this.queue = this.queue.filter(timestamp => Date.now() - timestamp < 1000);
    }
    
    // Enregistre cette opération
    this.queue.push(Date.now());
  }
}

// Instances de rate limiters pour différents types d'opérations
const messageLimiter = new RateLimiter(3);  // 3 messages par seconde max
const reactionLimiter = new RateLimiter(2); // 2 réactions par seconde max (plus lent)

// ============================================================================
// FONCTION : ANALYSE DE DURÉE
// ============================================================================

/**
 * Convertit une chaîne de durée en millisecondes
 * Exemples supportés :
 * - "1d" → 1 jour
 * - "2h" → 2 heures
 * - "30m" → 30 minutes
 * - "1d2h30m" → 1 jour + 2 heures + 30 minutes
 * - "3h15" → 3 heures + 15 minutes (le 'm' est optionnel)
 * 
 * @param {string} durationStr - Chaîne à analyser (ex: "2h30m")
 * @returns {number|null} - Durée en millisecondes ou null si invalide
 */
function parseDuration(durationStr) {
  // Expression régulière pour capturer jours, heures et minutes
  // (?:...) = groupe non-capturant
  // (\d+) = capture un ou plusieurs chiffres
  // ? = optionnel
  // i = insensible à la casse (D ou d, H ou h, M ou m)
  const regex = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m?)?$/i;
  
  // Teste la chaîne contre l'expression régulière
  const match = durationStr.trim().match(regex);
  
  // Si la chaîne ne correspond pas au format attendu
  if (!match) return null;
  
  // Extrait les valeurs (0 si non spécifié)
  const days = parseInt(match[1]) || 0;      // Groupe 1 : jours
  const hours = parseInt(match[2]) || 0;     // Groupe 2 : heures
  const minutes = parseInt(match[3]) || 0;   // Groupe 3 : minutes
  
  // Si tous les composants sont 0, la durée est invalide
  if (days === 0 && hours === 0 && minutes === 0) return null;
  
  // Convertit tout en millisecondes et retourne le total
  // 1 jour = 24h = 24*60min = 24*60*60s = 24*60*60*1000ms
  return (days * 24 * 60 * 60 * 1000) + 
         (hours * 60 * 60 * 1000) + 
         (minutes * 60 * 1000);
}

// ============================================================================
// FONCTION : CHARGEMENT DES TIMERS DEPUIS LE FICHIER
// ============================================================================

/**
 * Charge les timers et messages récapitulatifs depuis timers.json
 * Appelée au démarrage du bot pour restaurer l'état précédent
 * 
 * @returns {object} - { timers: [], summaryMessages: [] }
 */
function loadTimers() {
  // Vérifie si le fichier existe
  if (!fs.existsSync(TIMERS_FILE)) {
    // Si le fichier n'existe pas, retourne un objet vide
    return { timers: [], summaryMessages: [] };
  }
  
  try {
    // Lit le contenu du fichier en UTF-8
    const data = fs.readFileSync(TIMERS_FILE, 'utf8');
    // Parse le JSON et retourne l'objet
    return JSON.parse(data);
  } catch (error) {
    // En cas d'erreur (fichier corrompu, etc.), log l'erreur
    console.error('❌ Erreur lors du chargement des timers:', error);
    // Retourne un objet vide pour éviter de crasher le bot
    return { timers: [], summaryMessages: [] };
  }
}

// ============================================================================
// FONCTION : SAUVEGARDE DES TIMERS DANS LE FICHIER
// ============================================================================

/**
 * Sauvegarde tous les timers et messages récapitulatifs dans timers.json
 * Appelée après chaque modification (ajout, suppression, fin de timer)
 * Cette persistance permet de survivre aux redémarrages du bot
 */
function saveTimers() {
  // Construit l'objet à sauvegarder
  const data = {
    // Convertit la Map des timers en tableau
    timers: Array.from(timers.values()),
    // Convertit la Map des messages récapitulatifs en tableau
    summaryMessages: Array.from(summaryMessagesMap.values()),
  };
  
  try {
    // Écrit le JSON dans le fichier avec indentation (2 espaces) pour la lisibilité
    fs.writeFileSync(TIMERS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    // Log l'erreur mais ne crash pas le bot (la sauvegarde peut échouer sans bloquer)
    console.error('❌ Erreur lors de la sauvegarde des timers:', error);
  }
}

// ============================================================================
// FONCTION : RÉCUPÉRER LES TIMERS D'UN UTILISATEUR
// ============================================================================

/**
 * Récupère tous les timers (actifs et terminés) d'un utilisateur
 * 
 * @param {string} userId - L'ID Discord de l'utilisateur
 * @returns {Array} - Tableau des timers de cet utilisateur
 */
function getUserTimers(userId) {
  // Convertit la Map en tableau et filtre par userId
  return Array.from(timers.values()).filter(t => t.userId === userId);
}

// ============================================================================
// FONCTION : COMPTER LES TIMERS NON ANNULÉS D'UN UTILISATEUR
// ============================================================================

/**
 * Compte le nombre de timers non annulés (actifs + terminés) d'un utilisateur
 * Utilisé pour vérifier la limite de 20 timers
 * 
 * @param {string} userId - L'ID Discord de l'utilisateur
 * @returns {number} - Nombre de timers (actifs + terminés, mais pas annulés)
 */
function countUserTimers(userId) {
  // Les timers annulés sont supprimés de la Map, donc on compte tous les timers restants
  return getUserTimers(userId).length;
}

// ============================================================================
// FONCTION : MISE À JOUR DU MESSAGE RÉCAPITULATIF EN DM
// ============================================================================

/**
 * Met à jour (ou crée) le message récapitulatif des timers d'un utilisateur en DM
 * Ce message affiche tous les timers avec des emojis pour les annuler
 * Appelée après chaque changement de timer (ajout, fin, annulation)
 * 
 * @param {string} userId - L'ID Discord de l'utilisateur
 */
async function updateSummaryMessage(userId) {
  // Récupère tous les timers de l'utilisateur
  const userTimers = getUserTimers(userId);
  
  // ========================================
  // CAS 1 : L'utilisateur n'a plus de timer
  // ========================================
  if (userTimers.length === 0) {
    const summaryInfo = summaryMessagesMap.get(userId);
    
    // Si un message récapitulatif existe, on le supprime
    if (summaryInfo) {
      try {
        // Respecte le rate limit avant d'envoyer une requête Discord
        await messageLimiter.waitIfNeeded();
        
        // Récupère l'utilisateur et son canal DM
        const user = await client.users.fetch(userId);
        const channel = await user.createDM();
        
        // Récupère et supprime le message
        const message = await channel.messages.fetch(summaryInfo.messageId);
        await message.delete();
        
        console.log(`🗑️ Message récapitulatif supprimé pour l'utilisateur ${userId}`);
      } catch (error) {
        // Si le message n'existe plus ou autre erreur, on continue sans bloquer
        console.error('⚠️ Impossible de supprimer le message récapitulatif:', error);
      }
      
      // Supprime l'entrée de la Map
      summaryMessagesMap.delete(userId);
      // Sauvegarde l'état mis à jour
      saveTimers();
    }
    return; // Fin de la fonction
  }
  
  // ========================================
  // CAS 2 : L'utilisateur a des timers
  // ========================================
  
  // Sépare les timers actifs et terminés pour un affichage optimal
  const activeTimers = userTimers.filter(t => !t.ended);
  const endedTimers = userTimers.filter(t => t.ended);
  
  // Construit l'embed Discord (message enrichi avec formatage)
  const embed = new EmbedBuilder()
    .setTitle('⏱️ Gestion des timers')
    .setColor(0x5865F2)  // Bleu Discord officiel
    .setFooter({ text: 'Réagissez avec l\'emoji pour annuler un timer actif ou supprimer un timer terminé' })
    .setTimestamp();      // Ajoute l'horodatage actuel
  
  let description = '';
  
  // ---- Affichage des timers ACTIFS ----
  activeTimers.forEach((timer, index) => {
    const emoji = EMOJI_LETTERS[index];                    // Emoji correspondant (🇦, 🇧, etc.)
    const letter = String.fromCharCode(65 + index);        // Lettre (A, B, C, etc.)
    const timestamp = Math.floor(timer.endTime / 1000);    // Timestamp Unix en secondes
    
    // Format du timer actif :
    // 🇦 **A** · **Description du timer**
    // └ Timer: dans 2 heures le 12 nov. 2025 à 15:30
    description += `${emoji} **${letter}** · **${timer.text}**\n`;
    description += `└ Timer: <t:${timestamp}:R> le <t:${timestamp}:F>\n\n`;
    // <t:timestamp:R> = format relatif ("dans 2 heures")
    // <t:timestamp:F> = format complet ("12 novembre 2025 à 15:30")
  });
  
  // ---- Affichage des timers TERMINÉS ----
  endedTimers.forEach((timer, index) => {
    // L'index continue après les timers actifs pour les emojis
    const emojiIndex = activeTimers.length + index;
    const emoji = EMOJI_LETTERS[emojiIndex];
    const letter = String.fromCharCode(65 + emojiIndex);
    const timestamp = Math.floor(timer.endTime / 1000);
    
    // Format du timer terminé (texte barré avec ~~) :
    // 🇨 **C** · ~~Description du timer~~
    // └ ~~Timer terminé il y a 5 minutes~~
    description += `${emoji} **${letter}** · ~~${timer.text}~~\n`;
    description += `└ ~~Timer terminé <t:${timestamp}:R>~~\n\n`;
  });
  
  // Ajoute la description à l'embed (enlève les espaces/sauts de ligne en trop à la fin)
  embed.setDescription(description.trim());
  
  try {
    // Respecte le rate limit avant d'envoyer une requête Discord
    await messageLimiter.waitIfNeeded();
    
    // Récupère l'utilisateur Discord
    const user = await client.users.fetch(userId);
    // Crée ou récupère le canal DM avec cet utilisateur
    const channel = await user.createDM();
    
    const summaryInfo = summaryMessagesMap.get(userId);
    let message;
    
    // ---- Mise à jour ou création du message ----
    if (summaryInfo) {
      // Un message récapitulatif existe déjà : on le met à jour
        try {
          message = await channel.messages.fetch(summaryInfo.messageId);
          await message.edit({ embeds: [embed] });
          
          // Supprime toutes les anciennes réactions pour repartir à zéro
          await message.reactions.removeAll();
          
          console.log(`🔄 Message récapitulatif mis à jour pour ${userId}`);
        } catch (error) {
          // Si le message n'existe plus (supprimé manuellement par l'user), on en crée un nouveau
          console.error('⚠️ Impossible de modifier le message, création d\'un nouveau:', error.message);
          await messageLimiter.waitIfNeeded();
          message = await channel.send({ embeds: [embed] });
          
          // Met à jour l'info du message dans la Map
          summaryMessagesMap.set(userId, {
            userId,
            messageId: message.id,
            channelId: channel.id,
          });
          
          console.log(`📨 Nouveau message récapitulatif créé pour ${userId}`);
        }
    } else {
      // Aucun message récapitulatif existant : on en crée un
      message = await channel.send({ embeds: [embed] });
      
      // Enregistre l'info du message dans la Map
      summaryMessagesMap.set(userId, {
        userId,
        messageId: message.id,
        channelId: channel.id,
      });
      
      console.log(`📨 Message récapitulatif créé pour ${userId}`);
    }
    
    // ---- Ajout des réactions emoji (pour TOUS les timers : actifs ET terminés) ----
    // Les utilisateurs peuvent cliquer pour annuler les timers actifs OU supprimer les timers terminés
    // Cela permet de libérer de la place quand on atteint la limite de 20 timers
    // On ajoute les réactions une par une avec un délai pour éviter le rate limit
    const totalTimers = activeTimers.length + endedTimers.length;
    
    for (let i = 0; i < totalTimers; i++) {
      // Respecte le rate limit des réactions (plus strict)
      await reactionLimiter.waitIfNeeded();
      
      try {
        await message.react(EMOJI_LETTERS[i]);
      } catch (error) {
        // Si l'ajout de réaction échoue, on log mais on continue
        console.error(`⚠️ Impossible d'ajouter la réaction ${EMOJI_LETTERS[i]}:`, error.message);
      }
    }
    
    // Sauvegarde l'état après la mise à jour
    saveTimers();
    
  } catch (error) {
    // Erreur globale (utilisateur a bloqué les DM, etc.)
    console.error(`❌ Erreur lors de la mise à jour du message récapitulatif pour ${userId}:`, error.message);
  }
}

// ============================================================================
// FONCTION : PLANIFICATION D'UN TIMER
// ============================================================================

/**
 * Planifie l'exécution d'un timer (crée un setTimeout)
 * Gère aussi le cas des timers déjà expirés (lors du rechargement)
 * 
 * @param {object} timer - L'objet timer { id, userId, text, endTime, startTime, ended }
 */
async function scheduleTimer(timer) {
  // Calcule le temps restant avant l'expiration
  const timeLeft = timer.endTime - Date.now();
  
  // ========================================
  // CAS 1 : Timer déjà expiré (timeLeft <= 0)
  // ========================================
  // Cela arrive au redémarrage du bot si un timer a expiré pendant qu'il était éteint
  if (timeLeft <= 0) {
    // Marque le timer comme terminé
    timer.ended = true;
    timers.set(timer.id, timer);
    
    // Envoie quand même la notification à l'utilisateur (timer expiré pendant l'arrêt)
    try {
      await messageLimiter.waitIfNeeded();
      
      const user = await client.users.fetch(timer.userId);
      const timestamp = Math.floor(timer.endTime / 1000);
      
      // Message de notification d'expiration
      await user.send(`⌛ Votre timer **${timer.text}** s'est terminé <t:${timestamp}:R> !`);
      
      console.log(`⌛ Timer expiré envoyé pour "${timer.text}" (utilisateur ${timer.userId})`);
    } catch (error) {
      console.error('❌ Erreur lors de l\'envoi de la notification de timer expiré:', error.message);
    }
    
    // Sauvegarde et met à jour le message récapitulatif
    saveTimers();
    await updateSummaryMessage(timer.userId);
    return; // Fin de la fonction
  }
  
  // ========================================
  // CAS 2 : Timer encore actif
  // ========================================
  
  // Crée un setTimeout qui s'exécutera quand le timer expirera
  const timeout = setTimeout(async () => {
    // Marque le timer comme terminé
    timer.ended = true;
    timers.set(timer.id, timer);
    
    // Envoie la notification DM à l'utilisateur
    try {
      await messageLimiter.waitIfNeeded();
      
      const user = await client.users.fetch(timer.userId);
      const timestamp = Math.floor(timer.endTime / 1000);
      
      await user.send(`⌛ Votre timer **${timer.text}** s'est terminé <t:${timestamp}:R> !`);
      
      console.log(`⌛ Timer terminé : "${timer.text}" pour l'utilisateur ${timer.userId}`);
    } catch (error) {
      console.error('❌ Erreur lors de l\'envoi de la notification:', error.message);
    }
    
    // Supprime le timeout de la Map (il est terminé)
    activeTimeouts.delete(timer.id);
    
    // Met à jour le message récapitulatif pour afficher le timer comme terminé
    await updateSummaryMessage(timer.userId);
  }, timeLeft); // Le délai est le temps restant en millisecondes
  
  // Enregistre le timeout dans la Map pour pouvoir l'annuler plus tard si nécessaire
  activeTimeouts.set(timer.id, timeout);
  
  console.log(`⏱️ Timer planifié : "${timer.text}" pour ${Math.round(timeLeft / 1000)}s`);
}

// ============================================================================
// ÉVÉNEMENT : BOT PRÊT (DÉMARRAGE)
// ============================================================================

/**
 * Événement déclenché une seule fois quand le bot se connecte à Discord
 * Charge les timers sauvegardés et les reprogramme
 */
client.once('clientReady', async () => {
  console.log('');
  console.log('🤖 ============================================');
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
  console.log('🤖 ============================================');
  console.log('');
  
  // Charge les données depuis le fichier JSON
  const data = loadTimers();
  
  // ---- Restauration des timers ----
  console.log(`📂 Chargement de ${data.timers.length} timer(s)...`);
  
  data.timers.forEach(timer => {
    // Ajoute chaque timer dans la Map
    timers.set(timer.id, timer);
    
    // Si le timer n'est pas terminé, on le replanifie
    if (!timer.ended) {
      scheduleTimer(timer);
    }
  });
  
  // ---- Restauration des messages récapitulatifs ----
  console.log(`📂 Chargement de ${data.summaryMessages.length} message(s) récapitulatif(s)...`);
  
  data.summaryMessages.forEach(msg => {
    summaryMessagesMap.set(msg.userId, msg);
  });
  
  // ---- Mise à jour des messages récapitulatifs existants ----
  // Cela permet de synchroniser l'affichage après un redémarrage
  console.log('🔄 Mise à jour des messages récapitulatifs...');
  
  for (const userId of summaryMessagesMap.keys()) {
    try {
      await updateSummaryMessage(userId);
      // Petit délai entre chaque mise à jour pour éviter le rate limit
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`❌ Erreur lors de la mise à jour du récapitulatif pour ${userId}:`, error.message);
    }
  }
  
  console.log('');
  console.log('✅ Bot prêt à recevoir des commandes !');
  console.log(`📊 ${timers.size} timer(s) actif(s) en mémoire`);
  console.log('');
});

// ============================================================================
// ÉVÉNEMENT : COMMANDE SLASH /add-timer
// ============================================================================

/**
 * Événement déclenché quand un utilisateur exécute une commande slash
 * Gère la commande /add-timer pour créer un nouveau timer
 */
client.on('interactionCreate', async (interaction) => {
  // Vérifie que c'est bien une commande slash (pas un bouton ou menu)
  if (!interaction.isChatInputCommand()) return;
  
  // Vérifie que c'est la commande /add-timer
  if (interaction.commandName === 'add-timer') {
    await interaction.deferReply({ flags: 64 });
    // Récupère les paramètres de la commande
    const text = interaction.options.getString('texte');      // Description du timer
    const durationStr = interaction.options.getString('duree'); // Durée (ex: "2h30m")
    const multiple = interaction.options.getInteger('multiple') ?? 1; // Multiplicateur de la durée (1 par défaut)
    
    // ========================================
    // VALIDATION 1 : Format de durée
    // ========================================
    let duration = parseDuration(durationStr);
    
    if (!duration) {
      // Format invalide : répond avec un message d'erreur éphémère (seul l'user le voit)
      await interaction.editReply({
        content: '❌ Format de durée invalide. Utilisez par exemple : `2h30m`, `1d5h`, `45m`, etc.',
      });
      return; // Arrête l'exécution
    }
    duration = duration * multiple; // Application du multiplicateur
    // ========================================
    // VALIDATION 2 : Limite de 20 timers
    // ========================================
    const currentTimerCount = countUserTimers(interaction.user.id);
    
    if (currentTimerCount >= MAX_TIMERS_PER_USER) {
      // L'utilisateur a déjà 20 timers : refuse la création
      await interaction.editReply({
        content: `❌ Vous avez atteint la limite de **${MAX_TIMERS_PER_USER} timers** (actifs + terminés).\n\n` +
                 `💡 Pour créer un nouveau timer, vous devez d'abord supprimer les timers inutiles :\n` +
                 `• Cliquez sur les emojis des timers terminés pour les retirer\n` +
                 `• Annulez les timers actifs dont vous n'avez plus besoin`,
      });
      
      console.log(`🚫 Tentative de création d'un 21ème timer par ${interaction.user.tag} (refusée)`);
      return; // Arrête l'exécution
    }
    
    // ========================================
    // CRÉATION DU TIMER
    // ========================================
    const now = Date.now(); // Timestamp actuel en millisecondes
    
    // Construit l'objet timer
    const timer = {
      id: `${interaction.user.id}-${now}`,  // ID unique : "userId-timestamp"
      userId: interaction.user.id,           // ID Discord de l'utilisateur
      text,                                   // Description du timer
      endTime: now + duration,                // Timestamp de fin (maintenant + durée)
      startTime: now,                         // Timestamp de création
      ended: false,                           // État : pas encore terminé
    };
    
    // Ajoute le timer dans la Map
    timers.set(timer.id, timer);
    
    // Sauvegarde immédiatement dans le fichier JSON
    saveTimers();
    
    // Planifie le timer (crée le setTimeout)
    await scheduleTimer(timer);
    
    // Met à jour le message récapitulatif en DM
    await updateSummaryMessage(interaction.user.id);
    
    // ========================================
    // CONFIRMATION À L'UTILISATEUR
    // ========================================
    await interaction.editReply({
      content: `⏱️ Timer **${text}** démarré avec succès !\n` +
               `⏰ Expiration : <t:${Math.floor(timer.endTime / 1000)}:R>\n` +
               `📨 Consultez vos messages privés pour gérer vos timers.`, // Message visible uniquement par l'utilisateur
    });
    
    console.log(`✅ Timer créé par ${interaction.user.tag} : "${text}" (${durationStr})`);
    console.log(`   └ Timers actuels : ${currentTimerCount + 1}/${MAX_TIMERS_PER_USER}`);
  }
});

// ============================================================================
// ÉVÉNEMENT : RÉACTION AJOUTÉE (ANNULATION DE TIMER)
// ============================================================================

/**
 * Événement déclenché quand quelqu'un ajoute une réaction à un message
 * Gère l'annulation de timer via les emojis du message récapitulatif
 */
client.on('messageReactionAdd', async (reaction, user) => {
  // Ignore les réactions des bots (y compris les siennes)
  if (user.bot) return;
  
  // ========================================
  // GESTION DES RÉACTIONS PARTIELLES
  // ========================================
  // Si la réaction n'est pas en cache, on la charge depuis Discord
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('❌ Erreur lors de la récupération de la réaction:', error);
      return; // Impossible de traiter cette réaction
    }
  }
  
  // ========================================
  // VÉRIFICATION : C'est bien le message récapitulatif de l'user ?
  // ========================================
  const summaryInfo = summaryMessagesMap.get(user.id);
  
  // Si l'utilisateur n'a pas de message récapitulatif OU
  // si la réaction n'est pas sur son message récapitulatif
  if (!summaryInfo || summaryInfo.messageId !== reaction.message.id) {
    return; // Ce n'est pas une réaction qui nous intéresse
  }
  
  // ========================================
  // IDENTIFICATION DU TIMER À SUPPRIMER/ANNULER
  // ========================================
  
  // Trouve l'index de l'emoji dans notre tableau (🇦 = 0, 🇧 = 1, etc.)
  const emojiIndex = EMOJI_LETTERS.indexOf(reaction.emoji.name);
  
  // Si l'emoji n'est pas dans notre liste (réaction invalide)
  if (emojiIndex === -1) return;
  
  // Récupère TOUS les timers de l'utilisateur (actifs ET terminés)
  // On les trie dans le même ordre que l'affichage : actifs d'abord, puis terminés
  const allUserTimers = getUserTimers(user.id);
  const activeTimers = allUserTimers.filter(t => !t.ended);
  const endedTimers = allUserTimers.filter(t => t.ended);
  const sortedTimers = [...activeTimers, ...endedTimers];
  
  // Si l'index est hors limites (pas de timer à cet index)
  if (emojiIndex >= sortedTimers.length) return;
  
  // Récupère le timer correspondant à cet index
  const timerToRemove = sortedTimers[emojiIndex];
  const isActiveTimer = !timerToRemove.ended;
  
  // ========================================
  // SUPPRESSION/ANNULATION DU TIMER
  // ========================================
  
  // Si c'est un timer actif avec un timeout en cours, on l'annule
  if (isActiveTimer) {
    const timeout = activeTimeouts.get(timerToRemove.id);
    if (timeout) {
      clearTimeout(timeout);                      // Annule le setTimeout
      activeTimeouts.delete(timerToRemove.id);    // Supprime de la Map
    }
  }
  
  // Supprime complètement le timer de la Map (libère de la place)
  timers.delete(timerToRemove.id);
  
  // Sauvegarde l'état mis à jour
  saveTimers();
  
  const action = isActiveTimer ? 'annulé' : 'supprimé';
  console.log(`🗑️ Timer ${action} par ${user.tag} : "${timerToRemove.text}"`);
  
  // ========================================
  // NOTIFICATION ET MISE À JOUR
  // ========================================
  
  // Envoie un message de confirmation en DM
  try {
    await messageLimiter.waitIfNeeded();
    
    const confirmMessage = isActiveTimer 
      ? `✅ Timer **${timerToRemove.text}** annulé avec succès.`
      : `🗑️ Timer terminé **${timerToRemove.text}** supprimé avec succès.`;
    
    await user.send(confirmMessage);
  } catch (error) {
    console.error('⚠️ Impossible d\'envoyer le message de confirmation:', error.message);
  }
  
  // Met à jour le message récapitulatif (supprime le timer de la liste)
  await updateSummaryMessage(user.id);
  
  // Supprime la réaction de l'utilisateur pour un retour visuel immédiat
  try {
    await reaction.users.remove(user.id);
  } catch (error) {
    console.error('⚠️ Impossible de supprimer la réaction de l\'utilisateur:', error.message);
  }
});

// ============================================================================
// SERVEUR EXPRESS POUR LE MONITORING (UPTIME)
// ============================================================================

/**
 * Route racine du serveur web
 * Permet aux services de monitoring (UptimeRobot, Render, etc.) de vérifier
 * que le bot est toujours en ligne
 */
app.get('/', (req, res) => {
  // Statistiques du bot
  const stats = {
    status: 'online',
    bot: client.user?.tag || 'Connexion en cours...',
    timers: timers.size,
    users: summaryMessagesMap.size,
    uptime: Math.floor(process.uptime()), // Temps de fonctionnement en secondes
  };
  
  // Retourne un objet JSON avec les stats
  res.json(stats);
});

/**
 * Route de santé (health check)
 * Utilisée par certains services pour vérifier la disponibilité
 */
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: Date.now() });
});

// Démarre le serveur Express sur le port configuré
app.listen(PORT, () => {
  console.log('🌐 ============================================');
  console.log(`🌐 Serveur Express démarré sur le port ${PORT}`);
  console.log('🌐 Routes disponibles :');
  console.log(`🌐   - http://localhost:${PORT}/       (stats)`);
  console.log(`🌐   - http://localhost:${PORT}/health (santé)`);
  console.log('🌐 ============================================');
  console.log('');
});

// ============================================================================
// CONNEXION DU BOT À DISCORD
// ============================================================================

// Démarre la connexion avec le token stocké dans les variables d'environnement
client.login(process.env.DISCORD_BOT_TOKEN);
