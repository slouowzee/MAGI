import {
  ActionRowBuilder,
  ApplicationCommandOptionType as O,
  ApplicationCommandType,
  AuditLogEvent,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits as P,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder,
} from 'discord.js';
import { isOperator } from '../../core/installation.js';
import { listSettings, setSetting, setting } from '../../core/settings.js';
import { birthdayOfUser, synchroOf } from '../community/store.js';
import { nextMilestone, paliers, pointsFor, rateOf } from '../community/synchro.js';
import { pendingReminders } from '../reminders/store.js';
import { factsAbout, forgetUser, summariesAbout } from '../memory/store.js';
import { forgetToneOf, toneCountOf } from '../conversation/examples.js';
import { moduleEnabled } from '../../core/config.js';
import { gateRole } from '../security/gate.js';
import { activeInfractions, casesOf, purgeMember, recordOf } from './store.js';
import { KINDS, markPurged, sanctionOf } from './cases.js';
import { log } from '../../core/log/log.js';
import { decide } from './index.js';
import { DURATIONS, mayPunish, parseDuration, PURGES, punish } from './manual.js';
import { COLOR } from '../../core/discord/embeds.js';
import { discordTime as stamp } from '../../core/util.js';

const PREFIX = 'magi-look:';
const WINDOW = 30 * 86_400_000;
const KEY_PERMS = { Administrator: 'Administrateur', ManageGuild: 'Gérer le serveur', ManageRoles: 'Gérer les rôles', ManageChannels: 'Gérer les salons', ManageMessages: 'Gérer les messages', BanMembers: 'Bannir', KickMembers: 'Expulser', ModerateMembers: 'Exclure' };
const ephemeral = { flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
const text = (content) => new TextDisplayBuilder().setContent(content.slice(0, 3900));
const day = (ms) => stamp(ms, 'd');
const clipList = (lines, max) => (lines.length > max ? [...lines.slice(0, max), `-# et ${lines.length - max} autre(s)`] : lines);

export const LOOKUP_COMMANDS = [
  { tier: 'membres', data: { name: 'profil', type: ApplicationCommandType.ChatInput, description: 'Ton dossier : sanctions, infractions, synchro, rappels, ce que MAGI retient (visible par toi seul)' } },
  { tier: 'membres', data: { name: 'oublier', type: ApplicationCommandType.ChatInput, description: 'Voir ce que MAGI retient de toi et lui faire tout oublier (visible par toi seul)' } },
  { tier: 'moderation', data: { name: 'lookup', type: ApplicationCommandType.ChatInput, description: "Dossier complet d'un membre (modération)", options: [{ type: O.User, name: 'membre', description: 'Le membre ou l’utilisateur', required: true }] } },
];

export const isLookupInteraction = (id) => id.startsWith(PREFIX);

function sanctionLines(guildId, userId) {
  const list = casesOf(guildId, userId, 20).filter((c) => !c.observing);
  return list.map((c) => `- ${day(c.at)} · **${sanctionOf(c)}** · ${c.reasons.join(', ') || 'sans motif'}${c.status === 'annulee' ? ' · *annulée*' : ''}`);
}

export function infractionLine(guildId, userId, now = Date.now()) {
  const active = activeInfractions(guildId, userId, now);
  if (!active.length) return 'Aucune infraction sur les 30 derniers jours.';
  const next = decide('suspect', active.length + 1).label;
  const oldest = Math.min(...active.map((i) => i.created_at));
  return [`- ${active.length} infraction${active.length > 1 ? 's' : ''} sur les 30 derniers jours`, `- Prochaine sanction : ${next}`, `- La plus ancienne s'efface ${stamp(oldest + WINDOW)}`].join('\n');
}

function synchroLine(guild, userId) {
  const { points } = synchroOf(guild.id, userId);
  const rate = rateOf(points);
  const tier = Object.entries(paliers(guild.id))
    .filter(([threshold]) => Number(threshold) <= rate)
    .sort((a, b) => Number(b[0]) - Number(a[0]))[0];
  const role = tier && guild.roles.cache.get(tier[1]);
  const next = nextMilestone(rate);
  const left = next && pointsFor(next) - points;
  return `${rate} % · ${points} point${points > 1 ? 's' : ''}${role ? ` · palier ${role}` : ''}\n-# ${next ? `Prochain palier ${next} % dans ${left} point${left > 1 ? 's' : ''}, soit ${left} minute${left > 1 ? 's' : ''} active${left > 1 ? 's' : ''} au moins` : 'Palier maximal atteint'}`;
}

export async function showProfile(interaction) {
  const { guild, member, user } = interaction;
  const birthday = birthdayOfUser(guild.id, user.id);
  const reminders = pendingReminders(guild.id, user.id);
  const sanctions = sanctionLines(guild.id, user.id);
  const facts = await factsAbout(guild.id, user.id, 10).catch(() => []);
  const container = new ContainerBuilder()
    .setAccentColor(COLOR)
    .addSectionComponents(new SectionBuilder().addTextDisplayComponents(text(`### Ton dossier\n<@${user.id}> · arrivé ${stamp(member.joinedTimestamp)} (${day(member.joinedTimestamp)})`)).setThumbnailAccessory(new ThumbnailBuilder().setURL(user.displayAvatarURL({ size: 128 }))))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(text(`**Sanctions**\n${sanctions.length ? clipList(sanctions, 8).join('\n') : 'Aucune sanction.'}`))
    .addTextDisplayComponents(text(`**Infractions**\n${infractionLine(guild.id, user.id)}`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(text(`**Synchronisation** : ${synchroLine(guild, user.id)}\n**Anniversaire** : ${birthday ? `${String(birthday.day).padStart(2, '0')}/${String(birthday.month).padStart(2, '0')}` : 'non enregistré'}`))
    .addTextDisplayComponents(text(`**Rappels en attente**\n${reminders.length ? clipList(reminders.map((r) => `- n°${r.id} · ${r.text} · ${stamp(r.due_at)}`), 6).join('\n') : 'Aucun.'}`));
  if (facts.length || moduleEnabled(guild.id, 'memoire')) {
    container
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(text(`**Ce que MAGI retient de toi**\n${facts.length ? facts.map((f) => `- ${f}`).join('\n') : 'Rien pour l’instant.'}\n-# MAGI garde aussi un résumé des conversations auxquelles tu as participé.`))
      .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}oublier:${user.id}`).setLabel('Tout oublier').setStyle(ButtonStyle.Danger)));
  }
  return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

async function auditLines(guild, userId) {
  const lines = [];
  for (const [type, label] of [[AuditLogEvent.MemberBanAdd, 'banni'], [AuditLogEvent.MemberKick, 'expulsé'], [AuditLogEvent.MemberBanRemove, 'débanni']]) {
    const logs = await guild.fetchAuditLogs({ type, limit: 50 }).catch(() => null);
    for (const entry of logs?.entries.values() ?? []) if (entry.targetId === userId) lines.push({ at: entry.createdTimestamp, line: `- ${day(entry.createdTimestamp)} · ${label} par ${entry.executorId ? `<@${entry.executorId}>` : '?'}${entry.reason ? ` · ${entry.reason.slice(0, 80)}` : ''}` });
  }
  return lines.sort((a, b) => b.at - a.at).map((l) => l.line);
}

export function notesOf(guildId, userId) {
  return JSON.parse(setting(guildId, `notes:${userId}`) ?? '[]');
}

export function addNote(guildId, userId, by, note, now = Date.now()) {
  setSetting(guildId, `notes:${userId}`, JSON.stringify([...notesOf(guildId, userId), { by, at: now, text: note.slice(0, 500) }].slice(-20)));
}

export async function lookupCard(guild, userId) {
  const user = await guild.client.users.fetch(userId, { force: true }).catch(() => null);
  if (!user) return null;
  const member = await guild.members.fetch(userId).catch(() => null);
  const banned = member ? null : await guild.bans.fetch(userId).catch(() => null);
  const avatar = (member ?? user).displayAvatarURL({ size: 512 });
  const banner = user.bannerURL?.({ size: 1024 }) ?? null;
  const identity = [
    `### ${member?.displayName ?? user.globalName ?? user.username}`,
    `@${user.username} · \`${user.id}\` · <@${user.id}>${user.bot ? ' · bot' : ''}`,
    `Compte créé ${stamp(user.createdTimestamp)} (${day(user.createdTimestamp)})`,
    member ? `Arrivé ${stamp(member.joinedTimestamp)} (${day(member.joinedTimestamp)})${member.premiumSinceTimestamp ? ` · booste depuis ${stamp(member.premiumSinceTimestamp)}` : ''}` : banned ? '**Banni du serveur**' : "N'est pas sur le serveur",
    `[Avatar](${avatar})${banner ? ` · [Bannière](${banner})` : ''}`,
  ].join('\n');
  const state = [
    member?.communicationDisabledUntilTimestamp > Date.now() && `exclu jusqu'à ${stamp(member.communicationDisabledUntilTimestamp, 'f')}`,
    member && gateRole(guild) && member.roles.cache.has(gateRole(guild).id) && 'en attente de vérification',
    setting(guild.id, `quarantine:${userId}`) && 'en quarantaine anti-nuke',
    banned && `banni${banned.reason ? ` · ${banned.reason.slice(0, 80)}` : ''}`,
  ].filter(Boolean);
  const roles = member ? [...member.roles.cache.values()].filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position) : [];
  const perms = member ? Object.entries(KEY_PERMS).filter(([flag]) => member.permissions.has(P[flag])).map(([, label]) => label) : [];
  const cases = casesOf(guild.id, userId, 15).map((c) => `- ${c.messageId && c.channelLog ? `[#${c.id}](https://discord.com/channels/${guild.id}/${c.channelLog}/${c.messageId})` : `#${c.id}`} · ${day(c.at)} · ${KINDS[c.kind] ?? c.kind} · ${c.action}${c.status === 'annulee' ? ' · *annulée*' : c.observing ? ' · *observation*' : ''}`);
  const tickets = listSettings(guild.id, 'ticket:').filter((row) => row.value === userId).map((row) => `<#${row.key.slice('ticket:'.length)}>`);
  const notes = notesOf(guild.id, userId).map((n) => `- ${day(n.at)} · <@${n.by}> : ${n.text}`);
  const facts = await factsAbout(guild.id, userId, 8).catch(() => []);
  const audit = await auditLines(guild, userId);

  const container = new ContainerBuilder().setAccentColor(state.length ? 0xe24b4a : COLOR);
  container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text(identity)).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)));
  if (banner) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems((item) => item.setURL(banner)));
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(text(`**État** : ${state.length ? state.join(' · ') : 'rien à signaler'}\n**Rôles** : ${roles.length ? clipList(roles.map(String), 15).join(' ') : 'aucun'}${perms.length ? `\n**Permissions** : ${perms.join(', ')}` : ''}`));
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(text(`**Infractions**\n${infractionLine(guild.id, userId)}\n**Cas de modération**\n${cases.length ? clipList(cases, 8).join('\n') : 'Aucun.'}`));
  if (audit.length) container.addTextDisplayComponents(text(`**Journal d'audit**\n${clipList(audit, 5).join('\n')}`));
  if (tickets.length) container.addTextDisplayComponents(text(`**Tickets** : ${clipList(tickets, 8).join(' ')}`));
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(text(`**Notes d'opérateurs**\n${notes.length ? clipList(notes, 6).join('\n') : 'Aucune.'}\n**Mémoire de MAGI**\n${facts.length ? clipList(facts.map((f) => `- ${f}`), 6).join('\n') : 'Rien de retenu.'}`));
  const button = (action, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`${PREFIX}${action}:${userId}`).setLabel(label).setStyle(style);
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      [member && button('warn', 'Warn'), member && button('mute', 'Mute'), member && button('kick', 'Expulser'), !banned && button('ban', 'Bannir', ButtonStyle.Danger), button('note', 'Ajouter une note', ButtonStyle.Primary)].filter(Boolean),
    ),
  );
  container.addActionRowComponents(new ActionRowBuilder().addComponents(button('purge', 'Purger les sanctions', ButtonStyle.Danger)));
  return { components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

const allowedToLook = (member) => isOperator(member) || member.permissions.has(P.ManageMessages) || member.permissions.has(P.ModerateMembers);

export async function showLookup(interaction) {
  if (!allowedToLook(interaction.member)) return interaction.reply({ content: "Tu n'as pas les droits : le lookup complet est réservé à la modération.", ...ephemeral });
  await interaction.deferReply(ephemeral);
  const payload = await lookupCard(interaction.guild, interaction.options.getUser('membre').id);
  return interaction.editReply(payload ?? { content: 'Utilisateur introuvable.' });
}

function modal(action, userId) {
  const field = (id, label, style, required, placeholder, value) => {
    const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(style === TextInputStyle.Short ? 40 : 300);
    if (placeholder) input.setPlaceholder(placeholder);
    if (value) input.setValue(value);
    return new ActionRowBuilder().addComponents(input);
  };
  const titles = { warn: 'Warn', mute: 'Mute', kick: 'Expulser', ban: 'Bannir', note: 'Ajouter une note' };
  const rows = [];
  if (action === 'mute') rows.push(field('duree', 'Durée', TextInputStyle.Short, true, Object.keys(DURATIONS).join(', '), '1h'));
  if (action === 'ban') rows.push(field('messages', 'Supprimer ses messages', TextInputStyle.Short, true, Object.keys(PURGES).join(', '), 'aucun'));
  rows.push(field('texte', action === 'note' ? 'Note (visible par la modération seulement)' : 'Motif (obligatoire)', TextInputStyle.Paragraph, true));
  return new ModalBuilder().setCustomId(`${PREFIX}${action}-set:${userId}`).setTitle(titles[action]).addComponents(rows);
}

async function confirmPurge(interaction, userId) {
  const { guild } = interaction;
  const record = recordOf(guild.id, userId);
  const member = await guild.members.fetch(userId).catch(() => null);
  const timedOut = member?.communicationDisabledUntilTimestamp > Date.now();
  const banned = !member && (await guild.bans.fetch(userId).catch(() => null));
  const parts = [`${record.cases.length} cas`, `${record.infractions} infraction${record.infractions > 1 ? 's' : ''}`, timedOut && 'son exclusion en cours', banned && 'son bannissement'].filter(Boolean);
  if (!record.cases.length && !record.infractions && !timedOut && !banned) return interaction.reply({ content: `Rien à purger : le dossier de <@${userId}> est déjà vide.`, ...ephemeral });
  return interaction.reply({
    content: `Effacer tout le casier de <@${userId}> : ${parts.join(', ')} ? Les cartes de ses cas seront vidées. C'est définitif.`,
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}purge-ok:${userId}`).setLabel('Tout effacer').setStyle(ButtonStyle.Danger))],
    ...ephemeral,
  });
}

async function purgeRecord(interaction, userId) {
  const { guild, member: operator } = interaction;
  await interaction.update({ content: 'Purge en cours…', components: [] });
  const reason = `MAGI, purge du casier par ${interaction.user.tag}`;
  const target = await guild.members.fetch(userId).catch(() => null);
  const lifted = [];
  if (target?.communicationDisabledUntilTimestamp > Date.now()) await target.timeout(null, reason).then(() => lifted.push('exclusion levée')).catch(() => {});
  if (!target && (await guild.bans.fetch(userId).catch(() => null))) await guild.members.unban(userId, reason).then(() => lifted.push('débanni')).catch(() => {});
  const record = purgeMember(guild.id, userId);
  for (const c of record.cases) await markPurged(guild, c, operator.displayName);
  log.notice('moderation', `${operator} a purgé le casier de <@${userId}> : ${record.cases.length} cas, ${record.infractions} infraction${record.infractions > 1 ? 's' : ''}${lifted.length ? `, ${lifted.join(', ')}` : ''}`, { guild });
  return interaction.editReply({ content: `Casier de <@${userId}> effacé : ${record.cases.length} cas, ${record.infractions} infraction${record.infractions > 1 ? 's' : ''}${lifted.length ? `, ${lifted.join(', ')}` : ''}.` });
}

export async function showMemory(interaction) {
  const { guild, user } = interaction;
  const facts = await factsAbout(guild.id, user.id, 50).catch(() => []);
  const summaries = (await summariesAbout(guild.id, user.id, 100).catch(() => [])).length;
  const tone = toneCountOf(guild.id, user.id);
  const container = new ContainerBuilder().setAccentColor(COLOR).addTextDisplayComponents(text(`### Ce que MAGI retient de toi\n${facts.length ? clipList(facts.map((f) => `- ${f}`), 25).join('\n') : 'Aucun souvenir.'}`));
  container.addTextDisplayComponents(text(`-# ${summaries ? `Et ${summaries} résumé${summaries > 1 ? 's' : ''} de conversations auxquelles tu as participé.` : 'Aucun résumé de conversation.'} MAGI s’en sert pour te répondre avec le contexte, rien d’autre.${tone ? `\n-# ${tone} de tes messages servent d’exemple du ton du serveur, pour que les unités parlent comme la bande.` : ''}`));
  if (facts.length || summaries || tone) {
    container.addTextDisplayComponents(text('Tout oublier efface tes souvenirs, ces résumés et tes messages d’exemple, définitivement.')).addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}oublier-ok:${user.id}`).setLabel('Tout oublier').setStyle(ButtonStyle.Danger)));
  }
  return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

async function forgetMe(interaction, confirmed) {
  const { guild, user } = interaction;
  if (!confirmed) {
    return interaction.reply({
      content: 'Effacer tout ce que MAGI retient de toi, souvenirs et résumés de conversations ? C’est définitif.',
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}oublier-ok:${user.id}`).setLabel('Tout oublier').setStyle(ButtonStyle.Danger))],
      ...ephemeral,
    });
  }
  const { facts, summaries } = await forgetUser(guild.id, user.id);
  const tone = forgetToneOf(guild.id, user.id);
  const extra = tone ? `, ${tone} message${tone > 1 ? 's' : ''} d’exemple` : '';
  log.notice('memoire', `<@${user.id}> a fait effacer ce que MAGI retenait : ${facts} souvenir${facts > 1 ? 's' : ''}, ${summaries} résumé${summaries > 1 ? 's' : ''}${extra}`, { guild });
  return interaction.update({ content: `C’est oublié : ${facts} souvenir${facts > 1 ? 's' : ''}, ${summaries} résumé${summaries > 1 ? 's' : ''} de conversation${extra} effacés.`, components: [] });
}

export async function handleLookupInteraction(interaction) {
  const [action, userId] = interaction.customId.slice(PREFIX.length).split(':');
  if (action === 'oublier' || action === 'oublier-ok') {
    if (interaction.user.id !== userId) return interaction.reply({ content: 'Seule la personne concernée peut effacer sa mémoire.', ...ephemeral });
    return forgetMe(interaction, action === 'oublier-ok');
  }
  if (!allowedToLook(interaction.member)) return interaction.reply({ content: "Tu n'as pas les droits.", ...ephemeral });
  if (action === 'purge' || action === 'purge-ok') {
    if (!isOperator(interaction.member)) return interaction.reply({ content: "Tu n'as pas les droits : purger un casier est réservé aux opérateurs MAGI.", ...ephemeral });
    return action === 'purge' ? confirmPurge(interaction, userId) : purgeRecord(interaction, userId);
  }
  if (!action.endsWith('-set')) {
    if (action !== 'note' && !mayPunish(interaction.member, action)) return interaction.reply({ content: "Tu n'as pas la permission Discord pour cette sanction.", ...ephemeral });
    return interaction.showModal(modal(action, userId));
  }
  const kind = action.slice(0, -'-set'.length);
  const value = interaction.fields.getTextInputValue('texte').trim();
  if (kind === 'note') {
    addNote(interaction.guildId, userId, interaction.user.id, value);
    return interaction.reply({ content: `Note ajoutée au dossier de <@${userId}>.`, ...ephemeral });
  }
  const duration = kind === 'mute' ? parseDuration(interaction.fields.getTextInputValue('duree')) : null;
  if (kind === 'mute' && !duration) return interaction.reply({ content: `Durée inconnue : choisis parmi ${Object.keys(DURATIONS).join(', ')}.`, ...ephemeral });
  const wipe = kind === 'ban' ? (PURGES[interaction.fields.getTextInputValue('messages').trim().toLowerCase()]?.[1] ?? 0) : 0;
  await interaction.deferReply(ephemeral);
  const result = await punish({ guild: interaction.guild, moderator: interaction.member, userId, action: kind, reason: value, duration, purge: wipe }).catch((err) => `Impossible : ${err.message}.`);
  return interaction.editReply({ content: result });
}
