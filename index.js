import { Client, GatewayIntentBits, Partials, EmbedBuilder, REST, Routes } from 'discord.js';
import express from 'express';
import fs from 'fs';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

const app = express();
const PORT = process.env.PORT || 3000;

const TIMERS_FILE = 'timers.json';
const timers = new Map();
const activeTimeouts = new Map();

const EMOJI_LETTERS = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭', '🇮', '🇯', '🇰', '🇱', '🇲', '🇳', '🇴', '🇵', '🇶', '🇷', '🇸', '🇹', '🇺', '🇻', '🇼', '🇽', '🇾'];

function parseDuration(durationStr) {
  const regex = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m?)?$/i;
  const match = durationStr.trim().match(regex);
  
  if (!match) return null;
  
  const days = parseInt(match[1]) || 0;
  const hours = parseInt(match[2]) || 0;
  const minutes = parseInt(match[3]) || 0;
  
  if (days === 0 && hours === 0 && minutes === 0) return null;
  
  return (days * 24 * 60 * 60 * 1000) + (hours * 60 * 60 * 1000) + (minutes * 60 * 1000);
}

function loadTimers() {
  if (!fs.existsSync(TIMERS_FILE)) {
    return { timers: [], summaryMessages: [] };
  }
  
  try {
    const data = fs.readFileSync(TIMERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading timers:', error);
    return { timers: [], summaryMessages: [] };
  }
}

function saveTimers() {
  const data = {
    timers: Array.from(timers.values()),
    summaryMessages: Array.from(summaryMessagesMap.values()),
  };
  
  try {
    fs.writeFileSync(TIMERS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving timers:', error);
  }
}

const summaryMessagesMap = new Map();

function getUserTimers(userId) {
  return Array.from(timers.values()).filter(t => t.userId === userId);
}

async function updateSummaryMessage(userId) {
  const userTimers = getUserTimers(userId);
  
  if (userTimers.length === 0) {
    const summaryInfo = summaryMessagesMap.get(userId);
    if (summaryInfo) {
      try {
        const user = await client.users.fetch(userId);
        const channel = await user.createDM();
        const message = await channel.messages.fetch(summaryInfo.messageId);
        await message.delete();
      } catch (error) {
        console.error('Error deleting summary message:', error.message);
      }
      summaryMessagesMap.delete(userId);
      saveTimers();
    }
    return;
  }
  
  const embed = new EmbedBuilder()
    .setTitle('⏱️ Gestion des timers')
    .setColor(0x5865F2)
    .setFooter({ text: 'Réagissez avec l\'emoji correspondant pour annuler un timer' })
    .setTimestamp();
  
  const activeTimers = userTimers.filter(t => !t.ended);
  const endedTimers = userTimers.filter(t => t.ended);
  
  let description = '';
  
  activeTimers.forEach((timer, index) => {
    const emoji = EMOJI_LETTERS[index];
    const letter = String.fromCharCode(65 + index);
    const timestamp = Math.floor(timer.endTime / 1000);
    
    description += `${emoji} **${letter}** · **${timer.text}**\n`;
    description += `└ Timer: <t:${timestamp}:R> le <t:${timestamp}:F>\n\n`;
  });
  
  endedTimers.forEach((timer, index) => {
    const emojiIndex = activeTimers.length + index;
    const emoji = EMOJI_LETTERS[emojiIndex];
    const letter = String.fromCharCode(65 + emojiIndex);
    const timestamp = Math.floor(timer.endTime / 1000);
    
    description += `${emoji} **${letter}** · ~~${timer.text}~~\n`;
    description += `└ ~~Timer terminé <t:${timestamp}:R>~~\n\n`;
  });
  
  embed.setDescription(description.trim());
  
  try {
    const user = await client.users.fetch(userId);
    const channel = await user.createDM();
    
    const summaryInfo = summaryMessagesMap.get(userId);
    let message;
    
    if (summaryInfo) {
      try {
        message = await channel.messages.fetch(summaryInfo.messageId);
        await message.edit({ embeds: [embed] });
        
        await message.reactions.removeAll();
      } catch (error) {
        console.error('Error editing summary message:', error.message);
        message = await channel.send({ embeds: [embed] });
        summaryMessagesMap.set(userId, {
          userId,
          messageId: message.id,
          channelId: channel.id,
        });
      }
    } else {
      message = await channel.send({ embeds: [embed] });
      summaryMessagesMap.set(userId, {
        userId,
        messageId: message.id,
        channelId: channel.id,
      });
    }
    
    for (let i = 0; i < activeTimers.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
        await message.react(EMOJI_LETTERS[i]);
      } catch (error) {
        console.error('Error adding reaction:', error.message);
      }
    }
    
    saveTimers();
  } catch (error) {
    console.error('Error updating summary message:', error.message);
  }
}

async function scheduleTimer(timer) {
  const timeLeft = timer.endTime - Date.now();
  
  if (timeLeft <= 0) {
    timer.ended = true;
    timers.set(timer.id, timer);
    
    try {
      const user = await client.users.fetch(timer.userId);
      const timestamp = Math.floor(timer.endTime / 1000);
      await user.send(`⌛ Votre timer **${timer.text}** s'est terminé <t:${timestamp}:R> !`);
    } catch (error) {
      console.error('Error sending timer notification:', error.message);
    }
    
    saveTimers();
    await updateSummaryMessage(timer.userId);
    return;
  }
  
  const timeout = setTimeout(async () => {
    timer.ended = true;
    timers.set(timer.id, timer);
    
    try {
      const user = await client.users.fetch(timer.userId);
      const timestamp = Math.floor(timer.endTime / 1000);
      await user.send(`⌛ Votre timer **${timer.text}** s'est terminé <t:${timestamp}:R> !`);
    } catch (error) {
      console.error('Error sending timer notification:', error.message);
    }
    
    activeTimeouts.delete(timer.id);
    await updateSummaryMessage(timer.userId);
  }, timeLeft);
  
  activeTimeouts.set(timer.id, timeout);
}

client.once('ready', async () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
  
  const data = loadTimers();
  
  data.timers.forEach(timer => {
    timers.set(timer.id, timer);
    if (!timer.ended) {
      scheduleTimer(timer);
    }
  });
  
  data.summaryMessages.forEach(msg => {
    summaryMessagesMap.set(msg.userId, msg);
  });
  
  for (const userId of summaryMessagesMap.keys()) {
    await updateSummaryMessage(userId);
  }
  
  console.log(`📊 ${timers.size} timer(s) chargé(s)`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  
  if (interaction.commandName === 'add-timer') {
    const text = interaction.options.getString('texte');
    const durationStr = interaction.options.getString('duree');
    
    const duration = parseDuration(durationStr);
    
    if (!duration) {
      await interaction.reply({
        content: '❌ Format invalide. Utilisez `2h30m`, `1d5h`, etc.',
        ephemeral: true,
      });
      return;
    }
    
    const now = Date.now();
    const timer = {
      id: `${interaction.user.id}-${now}`,
      userId: interaction.user.id,
      text,
      endTime: now + duration,
      startTime: now,
      ended: false,
    };
    
    timers.set(timer.id, timer);
    saveTimers();
    
    await scheduleTimer(timer);
    await updateSummaryMessage(interaction.user.id);
    
    await interaction.reply({
      content: `⏱️ Timer **${text}** démarré !`,
      ephemeral: true,
    });
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('Error fetching reaction:', error);
      return;
    }
  }
  
  const summaryInfo = summaryMessagesMap.get(user.id);
  if (!summaryInfo || summaryInfo.messageId !== reaction.message.id) return;
  
  const emojiIndex = EMOJI_LETTERS.indexOf(reaction.emoji.name);
  if (emojiIndex === -1) return;
  
  const userTimers = getUserTimers(user.id).filter(t => !t.ended);
  if (emojiIndex >= userTimers.length) return;
  
  const timerToCancel = userTimers[emojiIndex];
  
  const timeout = activeTimeouts.get(timerToCancel.id);
  if (timeout) {
    clearTimeout(timeout);
    activeTimeouts.delete(timerToCancel.id);
  }
  
  timers.delete(timerToCancel.id);
  saveTimers();
  
  try {
    await user.send(`✅ Timer **${timerToCancel.text}** annulé.`);
  } catch (error) {
    console.error('Error sending cancellation message:', error.message);
  }
  
  await updateSummaryMessage(user.id);
  
  try {
    await reaction.users.remove(user.id);
  } catch (error) {
    console.error('Error removing reaction:', error.message);
  }
});

app.get('/', (req, res) => {
  res.send('Discord Timer Bot is running!');
});

app.listen(PORT, () => {
  console.log(`🌐 Express server running on port ${PORT}`);
});

client.login(process.env.DISCORD_BOT_TOKEN);
