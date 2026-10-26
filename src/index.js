import { Client, Events, GatewayIntentBits } from 'discord.js';
import { handleMessage } from './conversation/handle-message.js';
import { moderate } from './moderation/index.js';
import { handleInteraction } from './discord/buttons.js';
import { handleRoleButton, isRoleButton } from './tools/admin/role-panels.js';
import { warmupOllama } from './llm/client.js';
import { warmupRequests } from './llm/prompts.js';
import { handlePanelInteraction, isPanelInteraction, setupGuild } from './server/panel.js';
import { farewell, welcome } from './server/welcome.js';
import { startReminders } from './tools/reminders.js';
import { startConversationSweeper } from './conversation/memory.js';
import { db } from './storage/db.js';
import { watchAuditLog } from './security/antinuke.js';
import { startBackups } from './security/backup.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN manquant (voir .env.example)');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`MAGI prêt : connecté en tant que ${c.user.tag} sur ${c.guilds.cache.size} serveur(s)`);
  for (const guild of c.guilds.cache.values()) await setupGuild(guild);
  startReminders(c);
  startConversationSweeper(c);
  startBackups(c);
  if (process.env.GEMINI_API_KEY) {
    console.log(`LLM : Gemini (${process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'}), Ollama en secours`);
    return;
  }
  console.log('LLM : Ollama seul (pas de GEMINI_API_KEY)');
  const started = Date.now();
  await Promise.all(warmupRequests().map(warmupOllama))
    .then(() => console.log(`Personas préchauffées sur Ollama en ${Math.round((Date.now() - started) / 1000)} s`))
    .catch((err) => console.error('Préchauffage impossible :', err.message));
});

client.on(Events.GuildCreate, setupGuild);
client.on(Events.GuildMemberAdd, (member) => welcome(member).catch((err) => console.error('bienvenue :', err.message)));
client.on(Events.GuildMemberRemove, (member) => farewell(member).catch(() => {}));
client.on(Events.GuildRoleUpdate, (before, after) => {
  if (after.tags?.botId === client.user.id && before.permissions.bitfield !== after.permissions.bitfield) setupGuild(after.guild);
});
client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => watchAuditLog(entry, guild).catch((err) => console.error('anti-nuke :', err.message)));
client.on(Events.InteractionCreate, (interaction) => {
  const id = interaction.customId ?? '';
  const handler = isRoleButton(id) ? handleRoleButton : isPanelInteraction(id) ? handlePanelInteraction : handleInteraction;
  handler(interaction).catch((err) => console.error('interaction :', err.message));
});
client.on(Events.MessageCreate, async (message) => {
  if (await moderate(message).catch((err) => console.error('modération :', err.message))) return;
  await handleMessage(message);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await client.destroy();
    db.close();
    process.exit(0);
  });
}

await client.login(token);
