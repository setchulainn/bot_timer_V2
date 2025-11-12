# Discord Timer Bot

## Overview
A Discord bot that helps users manage personal timers with private message notifications. Users can create multiple timers, view them in a summary message, and cancel them using emoji reactions.

## Recent Changes
- **2025-11-12 (v2.0)**: Major improvements and optimizations
  - ✅ **Limite de 20 timers** par utilisateur (actifs + terminés non annulés)
  - ✅ **Suppression des timers terminés** via emojis pour libérer de la place
  - ✅ **Gestion avancée des rate limits** Discord (support de 200 utilisateurs × 20 timers)
  - ✅ **Code entièrement commenté** en français pour les débutants
  - ✅ **Optimisations de performance** pour gérer ~4000 timers simultanés
  
- **2025-11-12 (v1.0)**: Initial bot development
  - Created main bot with discord.js v14
  - Implemented timer management with JSON persistence
  - Added /add-timer slash command with flexible duration parsing
  - Built DM summary message system with emoji reactions (🇦-🇾)
  - Added timer expiration notifications and reaction-based cancellation
  - Configured Express ping server for uptime monitoring

## Project Architecture

### File Structure
```
├── index.js                 # Main bot file with all core functionality
├── register-commands.js     # Slash command registration script
├── package.json             # Node.js dependencies
├── timers.json              # Timer data persistence (auto-generated)
└── .gitignore              # Git ignore file
```

### Key Features
1. **Timer Creation**: `/add-timer texte:"Description" duree:"2h30m"`
   - Supports flexible duration formats: 1d, 2h, 30m, 1d2h30m, 3h15
   - Validates input and provides immediate feedback

2. **DM Notifications**: 
   - Private message when timer expires
   - Auto-updating summary message showing all timers
   - Emoji reactions (🇦-🇾) for quick cancellation

3. **Persistence**: 
   - All timers saved to timers.json
   - Automatic restoration on bot restart
   - Active timers rescheduled automatically

4. **Uptime Monitoring**: 
   - Express server on port 3000 for health checks
   - Compatible with UptimeRobot, Render, Replit

### Duration Parser
Accepts formats combining days (d), hours (h), and minutes (m):
- `1d` = 1 day
- `2h` = 2 hours  
- `45m` = 45 minutes
- `1d2h30m` = 1 day, 2 hours, 30 minutes
- `3h15` = 3 hours 15 minutes (m is optional)

Regex: `/^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m?)?$/i`

### Timer Data Structure
```json
{
  "timers": [
    {
      "id": "userId-timestamp",
      "userId": "1234567890",
      "text": "Timer description",
      "endTime": 1700000000000,
      "startTime": 1699990000000,
      "ended": false
    }
  ],
  "summaryMessages": [
    {
      "userId": "1234567890",
      "messageId": "0987654321",
      "channelId": "0987654321"
    }
  ]
}
```

## Setup Instructions

### 1. Create Discord Bot
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and name it
3. Go to "Bot" section and click "Add Bot"
4. Enable these intents:
   - Server Members Intent
   - Message Content Intent
5. Copy the bot token (you'll need this for `DISCORD_BOT_TOKEN`)

### 2. Get Client ID
1. In the Discord Developer Portal, go to "OAuth2" → "General"
2. Copy the "Client ID" (you'll need this for `DISCORD_CLIENT_ID`)

### 3. Invite Bot to Server
1. Go to "OAuth2" → "URL Generator"
2. Select scopes: `bot`, `applications.commands`
3. Select bot permissions: 
   - Send Messages
   - Send Messages in Threads
   - Embed Links
   - Add Reactions
   - Read Message History
4. Copy the generated URL and open it in your browser to invite the bot

### 4. Register Commands
After setting environment variables, run:
```bash
npm run register
```

### 5. Start the Bot
```bash
npm start
```

## Environment Variables Required
- `DISCORD_BOT_TOKEN`: Your Discord bot token
- `DISCORD_CLIENT_ID`: Your Discord application client ID
- `PORT`: (optional) Server port for uptime monitoring (default: 3000)

## User Preferences
None configured yet.

## Usage Example
1. User runs: `/add-timer texte:"Study session" duree:"2h30m"`
2. Bot confirms in ephemeral message
3. User receives DM with summary showing timer and 🇦 reaction
4. User can click 🇦 to cancel, or wait for timer to expire
5. When timer expires, user receives DM notification
6. Summary message updates automatically to show timer as completed
