import { ApplicationCommandOptionType as O, ApplicationCommandType, MessageFlags, PermissionFlagsBits as P } from 'discord.js';
import { isOperator } from '../../core/installation.js';
import { speak } from '../../core/discord/webhooks.js';
import { log } from '../../core/log/log.js';
import { recordInfraction } from './store.js';
import { excludedOf, latestCase, openCase, updateCase } from './cases.js';
import { notifySanction } from './appeal.js';

export const DURATIONS = { '10m': ['10 min', 10 * 60_000], '1h': ['1 h', 3_600_000], '6h': ['6 h', 6 * 3_600_000], '24h': ['24 h', 86_400_000], '7j': ['7 j', 7 * 86_400_000], '28j': ['28 j', 28 * 86_400_000] };
export const PURGES = { aucun: ['Aucun', 0], '24h': ['Dernières 24 h', 86_400], '7j': ['7 derniers jours', 604_800] };
export const RIGHTS = { warn: P.ManageMessages, mute: P.ModerateMembers, unmute: P.ModerateMembers, ban: P.BanMembers, unban: P.BanMembers, kick: P.KickMembers };
const NEEDS = { warn: 'Gérer les messages', mute: 'Exclure temporairement des membres', unmute: 'Exclure temporairement des membres', ban: 'Bannir des membres', unban: 'Bannir des membres', kick: 'Expulser des membres' };
const ephemeral = { flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
const member = (name, description) => ({ type: O.User, name, description, required: true });
const motif = (required = true) => ({ type: O.String, name: 'motif', description: required ? 'Raison de la sanction (obligatoire)' : 'Raison', required, max_length: 300 });

export const MANUAL_COMMANDS = [
  { perms: String(P.ManageMessages), data: { name: 'warn', type: ApplicationCommandType.ChatInput, description: 'Avertir un membre (compte comme une infraction)', options: [member('membre', 'Le membre à avertir'), motif()] } },
  {
    perms: String(P.ModerateMembers),
    data: {
      name: 'mute',
      type: ApplicationCommandType.ChatInput,
      description: 'Exclure temporairement un membre',
      options: [member('membre', 'Le membre à exclure'), { type: O.String, name: 'duree', description: 'Durée', required: true, choices: Object.entries(DURATIONS).map(([value, [name]]) => ({ name, value })) }, motif()],
    },
  },
  { perms: String(P.ModerateMembers), data: { name: 'unmute', type: ApplicationCommandType.ChatInput, description: "Lever l'exclusion d'un membre", options: [member('membre', 'Le membre exclu'), motif(false)] } },
  {
    perms: String(P.BanMembers),
    data: {
      name: 'ban',
      type: ApplicationCommandType.ChatInput,
      description: 'Bannir un membre',
      options: [member('membre', 'Le membre à bannir'), motif(), { type: O.String, name: 'messages', description: 'Supprimer ses messages récents', choices: Object.entries(PURGES).map(([value, [name]]) => ({ name, value })) }],
    },
  },
  { perms: String(P.BanMembers), data: { name: 'unban', type: ApplicationCommandType.ChatInput, description: 'Lever le bannissement de quelqu’un', options: [{ type: O.String, name: 'utilisateur', description: 'Identifiant ou mention', required: true }, motif(false)] } },
  { perms: String(P.KickMembers), data: { name: 'kick', type: ApplicationCommandType.ChatInput, description: 'Expulser un membre du serveur', options: [member('membre', 'Le membre à expulser'), motif()] } },
];

export const MANUAL_NAMES = new Set(MANUAL_COMMANDS.map((c) => c.data.name));

export function mayPunish(moderator, action) {
  return isOperator(moderator) || moderator.permissions.has(RIGHTS[action]);
}

export function outranks(moderator, target) {
  const { guild } = moderator;
  if (!target || target.id === moderator.id || target.id === guild.ownerId) return false;
  if (moderator.id === guild.ownerId) return true;
  return moderator.roles.highest.position > target.roles.highest.position;
}

export const parseDuration = (text) => DURATIONS[String(text ?? '').toLowerCase().replace(/\s+/g, '').replace('min', 'm').replace(/d$/, 'j')] ?? null;

function infraction(guild, userId, reason) {
  const { id, count } = recordInfraction(guild.id, userId, `manuel : ${reason}`);
  return { infractionId: id, infraction: count };
}

export async function punish({ guild, moderator, userId, action, reason, duration = null, purge = 0, channel = null }) {
  if (!mayPunish(moderator, action)) throw new Error(`il faut la permission « ${NEEDS[action]} » ou être opérateur MAGI`);
  const target = await guild.members.fetch(userId).catch(() => null);
  const audit = `${moderator.user.tag} : ${reason || 'sans motif'}`;
  const base = { kind: 'manuel', by: moderator.id, reasons: [reason], channelId: channel?.id ?? null, sample: '' };
  if (['warn', 'mute', 'kick'].includes(action) && !target) throw new Error("ce membre n'est pas sur le serveur");
  if (target && ['warn', 'mute', 'ban', 'kick'].includes(action) && !outranks(moderator, target)) throw new Error('tu ne peux pas sanctionner ce membre : son rôle est égal ou supérieur au tien');
  let c;
  if (action === 'warn') {
    c = await openCase(guild, userId, { ...base, action: 'avertissement', ...infraction(guild, userId, reason) });
    notifySanction(guild, userId, { sanction: 'Avertissement', reason });
    if (channel && target && channel.permissionsFor?.(target)?.has(P.ViewChannel)) await speak(channel, 'balthasar', `<@${userId}>, avertissement de la modération : ${reason}`, { mentions: [userId] }).catch(() => {});
  } else if (action === 'mute') {
    if (!target.moderatable) throw new Error('MAGI ne peut pas exclure ce membre (rôle trop haut ou permission manquante)');
    await target.timeout(duration[1], audit);
    c = await openCase(guild, userId, { ...base, action: `exclusion ${duration[0]}`, excluded: true, excludedUntil: Date.now() + duration[1], ...infraction(guild, userId, reason) });
    notifySanction(guild, userId, { sanction: `Exclusion ${duration[0]}`, reason });
  } else if (action === 'ban') {
    if (target) await notifySanction(guild, userId, { sanction: 'Ban', reason });
    await guild.members.ban(userId, { reason: audit, deleteMessageSeconds: purge });
    c = await openCase(guild, userId, { ...base, action: 'ban', banned: true, ...infraction(guild, userId, reason) });
  } else if (action === 'kick') {
    if (!target.kickable) throw new Error('MAGI ne peut pas expulser ce membre (rôle trop haut ou permission manquante)');
    await notifySanction(guild, userId, { sanction: 'Expulsion', reason });
    await target.kick(audit);
    c = await openCase(guild, userId, { ...base, action: 'expulsion', kicked: true, ...infraction(guild, userId, reason) });
  } else if (action === 'unmute') {
    if (!(target?.communicationDisabledUntilTimestamp > Date.now())) throw new Error("ce membre n'est pas exclu");
    await target.timeout(null, audit);
    const open = latestCase(guild.id, userId, (k) => excludedOf(k));
    if (open) updateCase(guild, open.id, { excluded: false, excludedUntil: null }, { event: `exclusion levée par ${moderator.displayName}${reason ? ` : ${reason}` : ''}` });
  } else if (action === 'unban') {
    if (!(await guild.bans.fetch(userId).catch(() => null))) throw new Error("cette personne n'est pas bannie");
    await guild.members.unban(userId, audit);
    const open = latestCase(guild.id, userId, (k) => k.banned);
    if (open) updateCase(guild, open.id, { banned: false }, { event: `débanni par ${moderator.displayName}${reason ? ` : ${reason}` : ''}` });
  }
  const done = { warn: 'averti', mute: `exclu ${duration?.[0]}`, unmute: "n'est plus exclu", ban: 'banni', unban: "n'est plus banni", kick: 'expulsé' }[action];
  log.notice('moderation', `${moderator} : <@${userId}> ${done}${reason ? ` · ${reason}` : ''}${c ? ` (cas #${c.id})` : ''}`, { guild, quiet: Boolean(c) });
  return `<@${userId}> ${done}${c ? ` · cas #${c.id}${c.infraction ? `, infraction ${c.infraction}/30 j` : ''}` : ''}.`;
}

export async function runManual(interaction) {
  const action = interaction.commandName;
  const { guild, member: moderator, options } = interaction;
  const userId = action === 'unban' ? String(options.getString('utilisateur')).match(/\d{17,20}/)?.[0] : options.getUser('membre')?.id;
  if (!userId) return interaction.reply({ content: 'Identifiant introuvable : colle l’identifiant ou la mention.', ...ephemeral });
  const reason = options.getString('motif')?.trim() ?? '';
  const duration = action === 'mute' ? DURATIONS[options.getString('duree')] : null;
  const purge = PURGES[options.getString('messages') ?? 'aucun']?.[1] ?? 0;
  await interaction.deferReply(ephemeral);
  const result = await punish({ guild, moderator, userId, action, reason, duration, purge, channel: interaction.channel }).catch((err) => `Impossible : ${err.message}.`);
  return interaction.editReply({ content: result });
}
