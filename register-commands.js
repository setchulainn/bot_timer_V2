import { REST, Routes } from 'discord.js';

const commands = [
  {
    name: 'add-timer',
    description: 'Crée un nouveau timer avec notification privée',
    options: [
      {
        name: 'texte',
        type: 3,
        description: 'Description du timer',
        required: true,
      },
      {
        name: 'duree',
        type: 3,
        description: 'Durée du timer (ex: 2h30m, 1d5h, 45m)',
        required: true,
      },
    ],
  },
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

try {
  console.log('📝 Enregistrement des commandes slash...');
  
  await rest.put(
    Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
    { body: commands }
  );
  
  console.log('✅ Commandes slash enregistrées avec succès !');
} catch (error) {
  console.error('❌ Erreur lors de l\'enregistrement:', error);
}
