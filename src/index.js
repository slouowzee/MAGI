import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { handleMessage } from './features/conversation/handle-message.js';
import { moderate } from './features/moderation/index.js';
import { handleInteraction } from './core/discord/buttons.js';
import { handleRoleButton, isRoleButton } from './features/admin/role-panels.js';
import { handlePanelInteraction, isPanelInteraction, setupGuild } from './panel/index.js';
import { farewell, logArrival, welcome } from './features/welcome/welcome.js';
import { gateMember, hideNewChannel } from './features/security/gate.js';
import { resumeLockdowns, trackJoin } from './features/security/raid.js';
import { handleSecurityButton, isSecurityButton } from './features/security/actions.js';
import { handleStar } from './features/community/hall-of-fame.js';
import { trackActivity } from './features/community/synchro.js';
import { cleanTemporary, handleVoiceState } from './features/community/voice.js';
import { startBirthdays } from './features/community/birthdays.js';
import { handleTicketInteraction, isTicketInteraction } from './features/community/tickets.js';
import { startReminders } from './features/reminders/tools.js';
import { startConversationSweeper } from './features/memory/context.js';
import { db } from './core/db.js';
import { watchAuditLog } from './features/security/antinuke.js';
import { startBackups } from './features/security/backup.js';
import { catchUp } from './features/conversation/catch-up.js';
import { handleCommand, isCommand } from './features/commands/commands.js';
import { handleWriteModal, isWriteModal } from './features/commands/write.js';
import { handleLookupInteraction, isLookupInteraction } from './features/moderation/lookup.js';
import { noteMessage, startPresence } from './features/presence/presence.js';
import { log } from './core/log/log.js';
import { llmChain } from './core/llm/client.js';
import { attachDiscord, flushAll, ownerGuilds } from './core/log/discord.js';
import { startDigest } from './core/log/digest.js';
import { logChannels } from './core/installation.js';
import { setSetting, setting } from './core/settings.js';
import { followHostJournal } from './core/log/host.js';

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
  const stopped = Number(setting('global', 'last_stop') ?? 0);
  const offline = stopped && Date.now() - stopped < 30 * 60_000 ? Math.max(1, Math.round((Date.now() - stopped) / 1000)) : null;
  setSetting('global', 'last_stop', null);
  log.notice('bot', offline ? `Redémarré, ${offline} s d'interruption` : 'En ligne');
  if (!llmChain()) log.err('bot', 'aucun modèle de langage configuré, les unités ne peuvent pas répondre');
  startDigest(c, { channelOf: (guild) => logChannels(guild).logs, ownerGuilds });
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
    log.err('membres', `arrivée de ${member} mal traitée : ${err.message}`, { guild: member.guild });
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
  const handler = isRoleButton(id) ? handleRoleButton : isPanelInteraction(id) ? handlePanelInteraction : isSecurityButton(id) ? handleSecurityButton : isTicketInteraction(id) ? handleTicketInteraction : isWriteModal(id) ? handleWriteModal : isLookupInteraction(id) ? handleLookupInteraction : handleInteraction;
  handler(interaction).catch((err) => log.err('interaction', `un bouton ou menu a échoué (${id.split(':').slice(0, 2).join(':')}) : ${err.message}`, { guild: interaction.guild, channel: interaction.channel }));
});
client.on(Events.MessageCreate, async (message) => {
  if (await moderate(message).catch((err) => log.err('moderation', err.message, { guild: message.guild, channel: message.channel }))) return;
  noteMessage(message);
  trackActivity(message).catch((err) => log.err('synchro', err.message, { guild: message.guild }));
  await handleMessage(message);
});
client.on(Events.MessageReactionAdd, (reaction) => handleStar(reaction).catch((err) => log.err('etoiles', err.message, { guild: reaction.message.guild })));
client.on(Events.VoiceStateUpdate, (before, after) => handleVoiceState(before, after).catch((err) => log.err('vocal', err.message, { guild: after.guild })));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    setSetting('global', 'last_stop', Date.now());
    log.notice('bot', `arrêt (${signal})`, { quiet: true });
    await flushAll();
    await client.destroy();
    db.close();
    process.exit(0);
  });
}

process.on('unhandledRejection', (err) => log.err('bot', `rejet non géré : ${err?.stack ?? err}`));

await client.login(token);
