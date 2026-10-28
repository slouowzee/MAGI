import { ActionRowBuilder, AuditLogEvent, ButtonBuilder, ButtonStyle } from 'discord.js';
import { setSetting } from '../../core/settings.js';
import { operatorRole } from '../../core/installation.js';
import { log } from '../../core/log/log.js';
import { freezeBackups } from './backup.js';
import { moduleEnabled } from '../../core/config.js';

const WINDOW = 60_000;
const QUARANTINE = 28 * 24 * 3600_000;
const KINDS = {
  [AuditLogEvent.ChannelDelete]: 'suppression de salons ou de rôles',
  [AuditLogEvent.RoleDelete]: 'suppression de salons ou de rôles',
  [AuditLogEvent.MemberBanAdd]: 'bannissements ou expulsions',
  [AuditLogEvent.MemberKick]: 'bannissements ou expulsions',
  [AuditLogEvent.WebhookCreate]: 'création de webhooks',
  [AuditLogEvent.ChannelCreate]: 'création de salons',
};
const LIMITS = {
  'suppression de salons ou de rôles': 3,
  'bannissements ou expulsions': 5,
  'création de webhooks': 3,
  'création de salons': 6,
};

export function createNukeTracker(window = WINDOW) {
  const events = new Map();
  return (executorId, kind, now = Date.now()) => {
    const key = `${executorId}:${kind}`;
    const recent = (events.get(key) ?? []).filter((t) => now - t < window);
    recent.push(now);
    events.set(key, recent);
    return recent.length;
  };
}

const track = createNukeTracker();

export function nukeSuspected(entry, guild, now = Date.now()) {
  const kind = KINDS[entry.action];
  if (!kind || !entry.executorId || entry.executorId === guild.ownerId || entry.executorId === guild.client.user.id) return null;
  return track(entry.executorId, kind, now) === LIMITS[kind] ? kind : null;
}

export async function watchAuditLog(entry, guild) {
  if (!moduleEnabled(guild.id, 'antinuke')) return;
  const kind = nukeSuspected(entry, guild);
  if (!kind) return;
  const reason = `MAGI anti-nuke : ${kind} en masse`;
  freezeBackups(guild);
  const member = await guild.members.fetch(entry.executorId).catch(() => null);
  const done = [];
  if (member) {
    const removable = member.roles.cache.filter((r) => r.id !== guild.id && !r.managed && r.editable);
    if (removable.size) {
      await member.roles
        .remove(removable, reason)
        .then(() => {
          setSetting(guild.id, `quarantine:${member.id}`, JSON.stringify([...removable.keys()]));
          done.push(`rôles retirés (${removable.map((r) => r.name).join(', ')})`);
        })
        .catch(() => {});
    }
    if (member.user.bot && member.kickable) await member.kick(reason).then(() => done.push('bot expulsé')).catch(() => {});
    else if (member.moderatable) await member.timeout(QUARANTINE, reason).then(() => done.push('exclu 28 j')).catch(() => {});
  }
  const operators = operatorRole(guild);
  log.alert(
    'antinuke',
    [
      `Destruction en masse par <@${entry.executorId}> : ${kind} en moins d'une minute.`,
      `Mesures : ${done.length ? done.join(', ') : 'aucune, son rôle est au-dessus de MAGI'}.`,
      'Sauvegardes figées 7 jours pour garder la dernière version saine.',
    ].join('\n'),
    {
      guild,
      mention: { users: [guild.ownerId], roles: operators ? [operators.id] : [] },
      components: done.length && member && !member.user.bot ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`magi-sec:liberer:${member.id}`).setLabel('Lever la quarantaine').setStyle(ButtonStyle.Secondary))] : null,
    },
  );
}
