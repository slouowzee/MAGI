import { activePersonas, isMuted, moduleEnabled } from '../../core/config.js';
import { saveSynchro, synchroOf } from './store.js';
import { listSettings, setSetting, setting } from '../../core/settings.js';
import { speak } from '../../core/discord/webhooks.js';
import { log } from '../../core/log/log.js';
import { DANGEROUS } from '../admin/role-panels.js';

const COOLDOWN = 60_000;
const NOTICE_TTL = 30_000;
const NOTICE = 'synchro_notice:';
export const MILESTONES = [25, 50, 75, 100, 150, 200, 300, 400];

export const rateOf = (points) => Math.min(400, Math.floor(Math.sqrt(points) * 4));
export const pointsFor = (rate) => Math.ceil((rate / 4) ** 2);
export const nextMilestone = (rate) => MILESTONES.find((m) => m > rate) ?? null;
export const milestoneMessages = (guildId) => JSON.parse(setting(guildId, 'synchro_messages') ?? '{}');

export function setMilestone(guild, threshold, { message = '', roleId = null }) {
  if (!MILESTONES.includes(threshold)) throw new Error(`palier inconnu, choisis parmi ${MILESTONES.join(', ')} %`);
  const role = roleId && guild.roles.cache.get(roleId);
  if (roleId && !role) throw new Error('rôle introuvable');
  if (role && DANGEROUS.some((p) => role.permissions.has(p, false))) throw new Error(`${role.name} donne des permissions de gestion ou de modération`);
  if (role && !role.editable) throw new Error(`${role.name} est au-dessus du rôle de MAGI`);
  const roles = paliers(guild.id);
  const messages = milestoneMessages(guild.id);
  if (role) roles[threshold] = role.id;
  else delete roles[threshold];
  if (message.trim()) messages[threshold] = message.trim().slice(0, 300);
  else delete messages[threshold];
  setSetting(guild.id, 'synchro_roles', JSON.stringify(roles));
  setSetting(guild.id, 'synchro_messages', JSON.stringify(messages));
}

export async function orderMilestoneRoles(guild) {
  const top = guild.members.me?.roles?.highest?.position ?? 0;
  const ids = [...new Set(Object.entries(paliers(guild.id)).sort((a, b) => Number(b[0]) - Number(a[0])).map(([, id]) => id))];
  const roles = ids.map((id) => guild.roles.cache.get(id)).filter((r) => r && !r.managed && r.position < top);
  const slots = roles.map((r) => r.position).sort((a, b) => b - a);
  if (roles.length < 2 || roles.every((r, i) => r.position === slots[i])) return false;
  await guild.roles.setPositions(roles.map((role, i) => ({ role: role.id, position: slots[i] })));
  log.notice('synchro', `rôles de palier rangés, du plus haut au plus bas : ${roles.map((r) => r.name).join(' > ')}`, { guild });
  return true;
}

export function milestoneLine(guildId, threshold, memberId, granted = []) {
  const custom = milestoneMessages(guildId)[threshold];
  const roles = granted.length ? granted.map((r) => r.name).join(', ') : '';
  if (!custom) return `Taux de synchronisation : ${threshold} %${roles ? `, accès ${roles} accordé` : ''}.`;
  return `${custom.replaceAll('{membre}', `<@${memberId}>`).replaceAll('{taux}', `${threshold} %`)}${roles ? `\n-# Rôle ${roles} accordé.` : ''}`;
}

export function paliers(guildId) {
  return JSON.parse(setting(guildId, 'synchro_roles') ?? '{}');
}

export function crossed(before, after) {
  return MILESTONES.filter((m) => before < m && after >= m);
}

async function dropNotice(guild, channelId, messageId) {
  await guild.channels.cache.get(channelId)?.messages.delete(messageId).catch(() => {});
  setSetting(guild.id, `${NOTICE}${channelId}:${messageId}`, null);
}

export function sweepNotices(client, now = Date.now()) {
  for (const guild of client.guilds.cache.values())
    for (const { key, value } of listSettings(guild.id, NOTICE)) {
      const [channelId, messageId] = key.slice(NOTICE.length).split(':');
      setTimeout(() => dropNotice(guild, channelId, messageId), Math.max(0, Number(value) - now));
    }
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
  if (!isMuted(message.channel)) {
    const notice = await speak(message.channel, persona, milestoneLine(guild.id, reached.at(-1), member.id, earned), { replyTo: message }).catch(() => null);
    if (notice) {
      setSetting(guild.id, `${NOTICE}${notice.channelId}:${notice.id}`, String(now + NOTICE_TTL));
      setTimeout(() => dropNotice(guild, notice.channelId, notice.id), NOTICE_TTL);
    }
  }
  log.info('synchro', `${member.user.tag} atteint ${reached.at(-1)} %${role}`, { guild });
  return reached.at(-1);
}
