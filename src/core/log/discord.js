import { addSink, readable, severity, timestamp } from './log.js';
import { logChannels } from '../installation.js';
import { setting } from '../settings.js';

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
  antiraid: 'securite',
  automod: 'securite',
  filtre: 'securite',
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
const ICONS = {
  moderation: '🛡️', antinuke: '💣', honeypot: '🍯', antiraid: '🚧', automod: '🤖', filtre: '🚪', audit: '🔍', sauvegarde: '💾',
  sshd: '🔑', 'sshd-session': '🔑', ssh: '🔑', sudo: '🔐', su: '🔐', login: '🔑', outils: '🔧', config: '⚙️', installation: '🛠️',
  rappels: '⏰', tickets: '🎫', bot: '🔄', commandes: '⌨️', conversation: '💬', vote: '🗳️', debat: '💭', etoiles: '🔥', synchro: '📈',
  anniversaires: '🎂', vocal: '🔊', publications: '📰', journal: '📜', interaction: '🖱️', rattrapage: '⏪',
};
const LEVEL_ICONS = { emerg: '🚨', alert: '🚨', crit: '🚨', err: '❌', warning: '⚠️' };
const HINTS = [
  [/Unknown Member/i, 'le membre a déjà quitté le serveur'],
  [/Missing Permissions/i, 'permission Discord manquante pour MAGI'],
  [/Missing Access/i, "MAGI n'a pas accès à ce salon"],
  [/Unknown Message/i, 'message déjà supprimé'],
  [/Unknown Channel/i, 'salon déjà supprimé'],
  [/\b429\b|rate.?limit/i, 'limite de débit atteinte, nouvel essai automatique'],
  [/is not an object|Cannot read properties|is not a function/i, 'bug interne de MAGI, à signaler'],
  [/fetch failed|ECONNRESET|ETIMEDOUT|socket/i, 'coupure réseau passagère'],
];
const FLUSH_DELAY = 2_000;
const LIMIT = 1_900;
const FENCE = '`'.repeat(3);
const silent = { allowedMentions: { parse: [] } };
const pending = new Map();
const merged = new Map();
let ownerId = null;

export const sourceOf = (component) => SOURCES[component] ?? 'systeme';

export function discordLevel(guildId) {
  const level = setting(guildId, 'log_level');
  return DISCORD_LEVELS[level] ? level : DEFAULT_DISCORD_LEVEL;
}

export function plain(text, guild) {
  return readable(text, guild).replaceAll(FENCE, "'''").replace(/\u001b/g, '');
}

const stamp = (at, style = 'T') => `<t:${Math.floor(new Date(at).getTime() / 1000)}:${style}>`;
const sanitize = (text) => text.replace(/\u001b\[[\d;]*m/g, '').replaceAll(FENCE, "'''").replace(/^(#{1,3} |-# |> )/gm, '\\$1');
const clip = (line) => (line.length > LIMIT ? `${line.slice(0, LIMIT - 1)}…` : line);

export function hintFor(message) {
  return HINTS.find(([pattern]) => pattern.test(message))?.[1] ?? null;
}

export function smartLine(entry) {
  const alarming = severity(entry.level) <= severity('warning');
  const icon = LEVEL_ICONS[entry.level] ?? (entry.component === 'membres' ? (/ est partie?(?=\s|$)/.test(entry.message) ? '🚶' : '👋') : ICONS[entry.component] ?? '•');
  const label = alarming || entry.host !== 'magi' ? `**${entry.host === 'magi' ? entry.component : `${entry.host} ${entry.component}`}** · ` : '';
  const place = entry.channel ? `<#${entry.channel.id}> · ` : '';
  const hint = alarming ? hintFor(entry.message) : null;
  return `${stamp(entry.at)} ${icon} ${label}${place}${sanitize(entry.message)}${hint ? ` *(${hint})*` : ''}`;
}

export const MERGERS = {
  config: {
    window: 5 * 60_000,
    parse: (entry) => {
      const m = entry.message.match(/^([\s\S]*) par (\S+)$/);
      return m && { key: m[2], who: m[2], change: m[1] };
    },
    start: (p) => ({ who: p.who, changes: [p.change] }),
    add: (state, p) => ({ ...state, changes: [...state.changes.filter((c) => c.split(' = ')[0] !== p.change.split(' = ')[0]), p.change] }),
    render: (state) => `⚙️ **${state.who}** a modifié la configuration : ${state.changes.join(' ; ')}${state.changes.length > 1 ? ` *(${state.changes.length} changements)*` : ''}`,
  },
  sshd: {
    window: 6 * 3600_000,
    parse: (entry) => {
      const m = entry.message.match(/^Accepted \S+ for (\S+) from (\S+)/);
      return m && { key: `${m[1]}@${m[2]}`, user: m[1], ip: m[2] };
    },
    start: (p, entry) => ({ ...p, host: entry.host, n: 1, first: entry.at, last: entry.at }),
    add: (state, p, entry) => ({ ...state, n: state.n + 1, last: entry.at }),
    render: (state) => `🔑 **${state.host}** · ${state.user} connecté en SSH depuis ${state.ip}${state.n > 1 ? ` ×${state.n} (${stamp(state.first, 't')} → ${stamp(state.last, 't')})` : ''}`,
  },
};

function send(channel, payload) {
  return channel.send(payload).catch((err) => console.error(`${timestamp()} magi log: err: envoi dans #${channel.name} impossible : ${err.message}`));
}

export async function flush(channelId) {
  const batch = pending.get(channelId);
  if (!batch) return;
  pending.delete(channelId);
  clearTimeout(batch.timer);
  const lines = batch.lines.map((l) => clip(l.count > 1 ? `${l.text} *(×${l.count})*` : l.text));
  let chunk = [];
  for (const line of lines) {
    if (chunk.length && [...chunk, line].join('\n').length > LIMIT) {
      await send(batch.channel, { content: chunk.join('\n'), ...silent });
      chunk = [];
    }
    chunk.push(line);
  }
  if (chunk.length) await send(batch.channel, { content: chunk.join('\n'), ...silent });
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

async function merge(channel, merger, parsed, entry) {
  const key = `${channel.id}|${entry.component}|${parsed.key}`;
  const now = new Date(entry.at).getTime();
  const open = merged.get(key);
  const content = (record) => clip(`${stamp(record.at)} ${merger.render(record.state)}`);
  if (open && now < open.until) {
    open.state = merger.add(open.state, parsed, entry);
    open.until = now + merger.window;
    const message = await open.message;
    await message?.edit({ content: content(open), ...silent }).catch(() => {});
    return;
  }
  await flush(channel.id);
  const record = { state: merger.start(parsed, entry), until: now + merger.window, at: entry.at };
  record.message = send(channel, { content: content(record), ...silent });
  merged.set(key, record);
  await record.message;
}

export async function deliver(guild, entry) {
  if (entry.quiet) return;
  if (!entry.mention && severity(entry.level) > severity(discordLevel(guild.id))) return;
  const channels = logChannels(guild);
  const channel = channels[sourceOf(entry.component)] ?? channels.logs;
  if (!channel) return;
  const merger = !entry.mention && !entry.components ? MERGERS[entry.component] : null;
  const parsed = merger?.parse(entry);
  if (parsed) return merge(channel, merger, parsed, entry);
  const text = smartLine(entry);
  if (!entry.mention && !entry.components) return queue(channel, `${entry.host} ${entry.component} ${entry.level} ${entry.channel?.id} ${entry.message}`, text);
  await flush(channel.id);
  const { users = [], roles = [] } = entry.mention ?? {};
  const pings = [...users.map((id) => `<@${id}>`), ...roles.map((id) => `<@&${id}>`)].join(' ');
  await send(channel, { content: clip(`${pings ? `${pings}\n` : ''}${text}`), allowedMentions: { users, roles }, components: entry.components ?? [] });
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
