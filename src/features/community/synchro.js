import { activePersonas, channelSetting, isMuted, moduleEnabled } from '../../core/config.js';
import { saveSynchro, synchroOf } from './store.js';
import { setting } from '../../core/settings.js';
import { speak } from '../../core/discord/webhooks.js';
import { log } from '../../core/log/log.js';

const COOLDOWN = 60_000;
const NOTICE_TTL = 30_000;
export const MILESTONES = [25, 50, 75, 100, 150, 200, 300, 400];

export const rateOf = (points) => Math.min(400, Math.floor(Math.sqrt(points) * 4));

export function paliers(guildId) {
  return JSON.parse(setting(guildId, 'synchro_roles') ?? '{}');
}

export function crossed(before, after) {
  return MILESTONES.filter((m) => before < m && after >= m);
}

export async function trackActivity(message, now = message.createdTimestamp) {
  const { guild, member } = message;
  if (!guild || !member || message.author.bot || message.webhookId || !moduleEnabled(guild.id, 'synchro')) return null;
  const { points, last_at: last } = synchroOf(guild.id, member.id);
  if (now - last < COOLDOWN) return null;
  const before = rateOf(points);
  const after = rateOf(points + 1);
  saveSynchro(guild.id, member.id, points + 1, now);
  const reached = crossed(before, after);
  if (!reached.length) return null;
  const roles = paliers(guild.id);
  const earned = Object.entries(roles)
    .filter(([threshold]) => Number(threshold) <= after)
    .map(([, roleId]) => guild.roles.cache.get(roleId))
    .filter((role) => role?.editable && !member.roles.cache.has(role.id));
  if (earned.length) await member.roles.add(earned, `MAGI : taux de synchronisation ${after} %`).catch(() => {});
  const persona = activePersonas(guild.id).includes('melchior') ? 'melchior' : activePersonas(guild.id)[0];
  const role = earned.length ? `, accès ${earned.map((r) => r.name).join(', ')} accordé` : '';
  message.react('📈').catch(() => {});
  const board = channelSetting(guild, 'synchro_channel');
  if (board) await speak(board, persona, `Taux de synchronisation de <@${member.id}> : ${reached.at(-1)} %${role}.`, { mentions: [member.id] }).catch(() => {});
  if (board?.id !== message.channel.id && !isMuted(message.channel)) {
    const notice = await speak(message.channel, persona, `Taux de synchronisation : ${reached.at(-1)} %${role}.`, { replyTo: message }).catch(() => null);
    if (notice) setTimeout(() => notice.delete().catch(() => {}), NOTICE_TTL);
  }
  log.info('synchro', `${member.user.tag} atteint ${reached.at(-1)} %${role}`, { guild });
  return reached.at(-1);
}
