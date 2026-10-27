import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { handleMessage } from './conversation/handle-message.js';
import { moderate } from './moderation/index.js';
import { handleInteraction } from './discord/buttons.js';
import { handleRoleButton, isRoleButton } from './tools/admin/role-panels.js';
import { handlePanelInteraction, isPanelInteraction, setupGuild } from './server/panel.js';
import { farewell, logArrival, welcome } from './server/welcome.js';
import { gateMember, hideNewChannel } from './security/gate.js';
import { resumeLockdowns, trackJoin } from './security/raid.js';
import { handleSecurityButton, isSecurityButton } from './security/actions.js';
import { handleStar } from './community/stars.js';
import { trackActivity } from './community/synchro.js';
import { cleanTemporary, handleVoiceState } from './community/voice.js';
import { startBirthdays } from './community/birthdays.js';
import { handleTicketInteraction, isTicketInteraction } from './community/tickets.js';
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
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User],
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
  resumeLockdowns(c);
  startBirthdays(c);
  cleanTemporary(c).catch(() => {});
});

client.on(Events.GuildCreate, setupGuild);
client.on(Events.GuildMemberAdd, async (member) => {
  logArrival(member);
  try {
    const raid = await trackJoin(member);
    if (await gateMember(member, { lockdown: raid })) return;
    await welcome(member);
  } catch (err) {
    log.err('membres', `échec arrivée de ${member.user.tag} : ${err.message}`, { guild: member.guild });
  }
});
client.on(Events.ChannelCreate, (channel) => channel.guild && hideNewChannel(channel).catch(() => {}));
client.on(Events.GuildMemberRemove, (member) => farewell(member).catch(() => {}));
client.on(Events.GuildRoleUpdate, (before, after) => {
  if (after.tags?.botId === client.user.id && before.permissions.bitfield !== after.permissions.bitfield) setupGuild(after.guild);
});
client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => watchAuditLog(entry, guild).catch((err) => log.err('antinuke', err.message, { guild })));
client.on(Events.InteractionCreate, (interaction) => {
  if (isCommand(interaction)) return handleCommand(interaction);
  const id = interaction.customId ?? '';
  const handler = isRoleButton(id) ? handleRoleButton : isPanelInteraction(id) ? handlePanelInteraction : isSecurityButton(id) ? handleSecurityButton : isTicketInteraction(id) ? handleTicketInteraction : handleInteraction;
  handler(interaction).catch((err) => log.err('interaction', `${id} : ${err.message}`, { guild: interaction.guild, channel: interaction.channel }));
});
client.on(Events.MessageCreate, async (message) => {
  if (await moderate(message).catch((err) => log.err('moderation', err.message, { guild: message.guild, channel: message.channel }))) return;
  trackActivity(message).catch((err) => log.err('synchro', err.message, { guild: message.guild }));
  await handleMessage(message);
});
client.on(Events.MessageReactionAdd, (reaction) => handleStar(reaction).catch((err) => log.err('etoiles', err.message, { guild: reaction.message.guild })));
client.on(Events.VoiceStateUpdate, (before, after) => handleVoiceState(before, after).catch((err) => log.err('vocal', err.message, { guild: after.guild })));

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
