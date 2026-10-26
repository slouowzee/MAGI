import { addSink, readable, severity, timestamp } from './log.js';
import { logChannels } from '../server/installation.js';
import { setting } from '../storage/settings.js';

export const DISCORD_LEVELS = {
  err: 'Erreurs seulement',
  warning: 'Erreurs et avertissements',
  notice: 'Événements importants',
  info: 'Activité détaillée',
  debug: 'Tout, débogage compris',
};
export const DEFAULT_DISCORD_LEVEL = 'notice';

const SOURCES = {
  moderation: 'moderation',
  antinuke: 'securite',
  honeypot: 'securite',
  audit: 'securite',
  sauvegarde: 'securite',
  sshd: 'securite',
  'sshd-session': 'securite',
  ssh: 'securite',
  sudo: 'securite',
  su: 'securite',
  login: 'securite',
  outils: 'logs',
  config: 'logs',
  membres: 'logs',
  installation: 'logs',
  rappels: 'logs',
};
const COLORS = { emerg: '1;31', alert: '1;31', crit: '1;31', err: '31', warning: '33', notice: '36', info: '37', debug: '30' };
const FLUSH_DELAY = 2_000;
const LIMIT = 1_900;
const pending = new Map();
let ownerId = null;

export const sourceOf = (component) => SOURCES[component] ?? 'systeme';

export function discordLevel(guildId) {
  const level = setting(guildId, 'log_level');
  return DISCORD_LEVELS[level] ? level : DEFAULT_DISCORD_LEVEL;
}

export function plain(text, guild) {
  return readable(text, guild).replace(/```/g, "'''").replace(/\u001b/g, '');
}

export function ansiLine(entry, guild) {
  const host = entry.host === 'magi' ? '' : `${entry.host} `;
  const place = entry.channel ? `#${entry.channel.name} ` : '';
  return `\u001b[30m${timestamp(entry.at).slice(11, 19)}\u001b[0m \u001b[34m${host}${entry.component}\u001b[0m: \u001b[${COLORS[entry.level]}m${entry.level}\u001b[0m: ${plain(place + entry.message, guild)}`;
}

const block = (lines) => `\`\`\`ansi\n${lines.join('\n')}\n\`\`\``;
const clip = (line) => (line.length > LIMIT ? `${line.slice(0, LIMIT - 1)}…` : line);

function send(channel, payload) {
  return channel.send(payload).catch((err) => console.error(`${timestamp()} magi log: err: envoi dans #${channel.name} impossible : ${err.message}`));
}

export async function flush(channelId) {
  const batch = pending.get(channelId);
  if (!batch) return;
  pending.delete(channelId);
  clearTimeout(batch.timer);
  const lines = batch.lines.map((l) => clip(l.count > 1 ? `${l.text} \u001b[30m(×${l.count})\u001b[0m` : l.text));
  let chunk = [];
  for (const line of lines) {
    if (chunk.length && [...chunk, line].join('\n').length > LIMIT) {
      await send(batch.channel, { content: block(chunk), allowedMentions: { parse: [] } });
      chunk = [];
    }
    chunk.push(line);
  }
  if (chunk.length) await send(batch.channel, { content: block(chunk), allowedMentions: { parse: [] } });
}

export function flushAll() {
  return Promise.all([...pending.keys()].map(flush));
}

function queue(channel, key, text) {
  let batch = pending.get(channel.id);
  if (!batch) {
    batch = { channel, lines: [], timer: null };
    pending.set(channel.id, batch);
  }
  const last = batch.lines.at(-1);
  if (last?.key === key) last.count++;
  else batch.lines.push({ key, text, count: 1 });
  batch.timer ??= setTimeout(() => flush(channel.id), FLUSH_DELAY);
}

export async function deliver(guild, entry) {
  if (!entry.mention && severity(entry.level) > severity(discordLevel(guild.id))) return;
  const channels = logChannels(guild);
  const channel = channels[sourceOf(entry.component)] ?? channels.logs;
  if (!channel) return;
  const text = ansiLine(entry, guild);
  if (!entry.mention) return queue(channel, `${entry.host} ${entry.component} ${entry.level} ${entry.channel?.id} ${entry.message}`, text);
  await flush(channel.id);
  const { users = [], roles = [] } = entry.mention;
  const pings = [...users.map((id) => `<@${id}>`), ...roles.map((id) => `<@&${id}>`)].join(' ');
  await send(channel, { content: `${pings}\n${block([clip(text)])}`, allowedMentions: { users, roles } });
}

export const ownerGuilds = (client) => (ownerId ? [...client.guilds.cache.values()].filter((g) => g.ownerId === ownerId) : []);

export async function attachDiscord(client) {
  const application = await client.application.fetch().catch(() => null);
  ownerId = application?.owner?.ownerId ?? application?.owner?.id ?? null;
  return addSink((entry) => {
    const guilds = entry.guild ? [entry.guild] : ownerGuilds(client);
    for (const guild of guilds) deliver(guild, entry).catch((err) => console.error(`${timestamp()} magi log: err: ${err.message}`));
  });
}
