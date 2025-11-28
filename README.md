# Discord Timer Bot

Un bot Discord permettant de gérer des timers personnels avec notifications privées.

## Fonctionnalités

- ⏱️ Créer plusieurs timers personnels avec `/add-timer`
- 🔔 Recevoir des notifications en message privé quand un timer se termine
- 📊 Visualiser tous vos timers dans un message récapitulatif
- ❌ Annuler un timer avec une simple réaction emoji (🇦-🇾)


## Format de durée

Le bot accepte des durées flexibles combinant jours (d), heures (h) et minutes (m):

| Exemple | Signification |
|---------|---------------|
| `1d` | 1 jour |
| `2h` | 2 heures |
| `45m` | 45 minutes |
| `1d2h30m` | 1 jour, 2 heures et 30 minutes |
| `3h15` | 3 heures et 15 minutes (le 'm' est optionnel) |

## Installation

### 1. Créer le bot Discord

1. Allez sur [Discord Developer Portal](https://discord.com/developers/applications)
2. Cliquez sur "New Application" et donnez-lui un nom
3. Allez dans "Bot" et cliquez sur "Add Bot"
4. Activez ces intents :
   - **Server Members Intent**
   - **Message Content Intent**
5. Copiez le token du bot (pour `DISCORD_BOT_TOKEN`)

### 2. Obtenir le Client ID

1. Dans le Developer Portal, allez dans "OAuth2" → "General"
2. Copiez le "Client ID" (pour `DISCORD_CLIENT_ID`)

### 3. Inviter le bot

1. Allez dans "OAuth2" → "URL Generator"
2. Sélectionnez les scopes : `bot`, `applications.commands`
3. Sélectionnez les permissions :
   - Send Messages
   - Send Messages in Threads
   - Embed Links
   - Add Reactions
   - Read Message History
4. Copiez l'URL générée et ouvrez-la pour inviter le bot

### 4. Configuration

Vous aurez besoin de deux variables d'environnement :
- `DISCORD_BOT_TOKEN` : Token de votre bot
- `DISCORD_CLIENT_ID` : ID de votre application

### 5. Enregistrer les commandes

```bash
npm run register
```

### 6. Démarrer le bot

```bash
npm start
```

## Utilisation

### Créer un timer

```
/add-timer texte:"Révisions" duree:"2h30m" multiple:"2"
```
- texte : la description du timer
- duree : la durée du timer initiale
- multiple : le nombre de fois par lequel multiplier la durée du timer. par défaut  = 1 . OPTIONNEL
  
Le bot vous enverra un message de confirmation et créera un message récapitulatif en DM.

### Voir vos timers

Consultez votre message privé du bot. Il contient :
-  Timers actifs avec compte à rebours
-  Timers terminés (barrés)
- 🇦🇧🇨 Emojis pour chaque timer

### Annuler un timer

Cliquez 2 fois sur l'emoji correspondant (🇦, 🇧, etc.) dans votre message récapitulatif.
(l'API discord ne permet pas au bot de retirer les réactions d'un utilisateur, il faurt donc réagir une seconde fois pour retirer sa propre réaction).

Un message temporaire vous est envoyé en DM pour confirmer la prise en compte

### Expiration

Quand un timer se termine, vous recevez automatiquement une notification :
```
⌛ Votre timer **Révisions** s'est terminé il y a quelques secondes !
```

### Nettoyage

```
/cleanup
```
Le bot supprime ses messages dans les DM SAUF le message récapitulatif des Timers



