import { AuditLogEvent } from 'discord.js';
import { operatorRole } from '../server/installation.js';
import { log } from '../logging/log.js';
import { freezeBackups } from './backup.js';
import { moduleEnabled } from '../server/config.js';

const WINDOW = 60_000;
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
    if (removable.size) await member.roles.remove(removable, reason).then(() => done.push(`rôles retirés : ${removable.map((r) => r.name).join(', ')}`)).catch(() => {});
    if (member.user.bot && member.kickable) await member.kick(reason).then(() => done.push('bot expulsé')).catch(() => {});
  }
  const operators = operatorRole(guild);
  log.alert(
    'antinuke',
    [
      `<@${entry.executorId}> a fait trop de ${kind} en moins d'une minute`,
      done.length ? `mesures prises : ${done.join(' ; ')}` : 'aucune mesure possible : son rôle est au-dessus de celui de MAGI, retire-lui ses permissions à la main',
      "sauvegardes automatiques gelées 7 jours pour garder l'état d'avant : demande à MAGI de restaurer la structure si besoin",
    ].join('\n'),
    { guild, mention: { users: [guild.ownerId], roles: operators ? [operators.id] : [] } },
  );
}
