import { Client, Events, GatewayIntentBits } from 'discord.js';
import { handleMessage } from './conversation/handle-message.js';
import { moderate } from './moderation/index.js';
import { handleInteraction } from './discord/buttons.js';
import { handleRoleButton, isRoleButton } from './tools/admin/role-panels.js';
import { handlePanelInteraction, isPanelInteraction, setupGuild } from './server/panel.js';
import { farewell, welcome } from './server/welcome.js';
import { startReminders } from './tools/reminders.js';
import { startConversationSweeper } from './conversation/memory.js';
import { db } from './storage/db.js';
import { watchAuditLog } from './security/antinuke.js';
import { startBackups } from './security/backup.js';
import { catchUp } from './conversation/catch-up.js';
import { handleCommand, isCommand } from './conversation/commands.js';
import { startPresence } from './server/presence.js';
import { log } from './logging/log.js';
import { llmChain } from './llm/client.js';
import { attachDiscord, flushAll } from './logging/discord.js';
import { followHostJournal } from './logging/host.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  log.emerg('bot', 'DISCORD_TOKEN manquant');
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
  await attachDiscord(c);
  for (const guild of c.guilds.cache.values()) await setupGuild(guild);
  log.notice('bot', `démarré : ${c.user.tag}, ${c.guilds.cache.size} serveur(s), LLM ${llmChain() || 'aucun'}`);
  followHostJournal();
  await catchUp(c).catch((err) => log.err('rattrapage', `échec : ${err.message}`));
  startReminders(c);
  startConversationSweeper(c);
  startBackups(c);
  startPresence(c);
});

client.on(Events.GuildCreate, setupGuild);
client.on(Events.GuildMemberAdd, (member) => welcome(member).catch((err) => log.err('membres', `échec bienvenue : ${err.message}`, { guild: member.guild })));
client.on(Events.GuildMemberRemove, (member) => farewell(member).catch(() => {}));
client.on(Events.GuildRoleUpdate, (before, after) => {
  if (after.tags?.botId === client.user.id && before.permissions.bitfield !== after.permissions.bitfield) setupGuild(after.guild);
});
client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => watchAuditLog(entry, guild).catch((err) => log.err('antinuke', err.message, { guild })));
client.on(Events.InteractionCreate, (interaction) => {
  if (isCommand(interaction)) return handleCommand(interaction);
  const id = interaction.customId ?? '';
  const handler = isRoleButton(id) ? handleRoleButton : isPanelInteraction(id) ? handlePanelInteraction : handleInteraction;
  handler(interaction).catch((err) => log.err('interaction', `${id} : ${err.message}`, { guild: interaction.guild, channel: interaction.channel }));
});
client.on(Events.MessageCreate, async (message) => {
  if (await moderate(message).catch((err) => log.err('moderation', err.message, { guild: message.guild, channel: message.channel }))) return;
  await handleMessage(message);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    log.notice('bot', `arrêt (${signal})`);
    await flushAll();
    await client.destroy();
    db.close();
    process.exit(0);
  });
}

process.on('unhandledRejection', (err) => log.err('bot', `rejet non géré : ${err?.stack ?? err}`));

await client.login(token);
