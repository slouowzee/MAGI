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
  debug: 'systeme',
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
  anniversaires: '🎂', vocal: '🔊', debug: '🐞', publications: '📰', journal: '📜', interaction: '🖱️', rattrapage: '⏪',
};
export const PALETTE = { erreur: 0xe24b4a, alerte: 0xef9f27, securite: 0x7f77dd, moderation: 0xd85a30, config: 0x378add, arrivee: 0x1d9e75, depart: 0x888780, communaute: 0xd4537e, systeme: 0x5f5e5a };
const GROUPS = {
  config: 'config', outils: 'config', installation: 'config', commandes: 'config', publications: 'config',
  automod: 'securite', antinuke: 'securite', antiraid: 'securite', filtre: 'securite', honeypot: 'securite', audit: 'securite', sauvegarde: 'securite',
  sshd: 'securite', 'sshd-session': 'securite', ssh: 'securite', sudo: 'securite', su: 'securite', login: 'securite',
  moderation: 'moderation',
  tickets: 'communaute', etoiles: 'communaute', synchro: 'communaute', anniversaires: 'communaute', rappels: 'communaute', vocal: 'communaute', vote: 'communaute', debat: 'communaute',
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

const departing = (entry) => entry.component === 'membres' && / est partie?(?=\s|$)/.test(entry.message);

export function colorOf(entry) {
  if (severity(entry.level) <= severity('err')) return PALETTE.erreur;
  if (entry.level === 'warning') return PALETTE.alerte;
  if (entry.component === 'membres') return departing(entry) ? PALETTE.depart : PALETTE.arrivee;
  return PALETTE[GROUPS[entry.component]] ?? PALETTE.systeme;
}

export function smartLine(entry) {
  const alarming = severity(entry.level) <= severity('warning');
  const icon = LEVEL_ICONS[entry.level] ?? (entry.component === 'membres' ? (departing(entry) ? '🚶' : '👋') : ICONS[entry.component] ?? '•');
  const label = alarming || entry.host !== 'magi' ? `**${entry.host === 'magi' ? entry.component : `${entry.host} ${entry.component}`}** · ` : '';
  const place = entry.channel ? `<#${entry.channel.id}> · ` : '';
  const hint = alarming ? hintFor(entry.message) : null;
  return `${icon} ${label}${place}${sanitize(entry.message)}${hint ? ` *(${hint})*` : ''}`;
}

export const MERGERS = {
  config: {
    window: 5 * 60_000,
    parse: (entry) => {
      const m = entry.message.match(/^([\s\S]*) par (.+)$/);
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

export const card = (text, color, at) => ({ description: clip(text), color, timestamp: new Date(at).toISOString() });

export async function flush(channelId) {
  const batch = pending.get(channelId);
  if (!batch) return;
  pending.delete(channelId);
  clearTimeout(batch.timer);
  const embeds = batch.lines.map((l) => card(l.count > 1 ? `${l.text} *(×${l.count})*` : l.text, l.color, l.at));
  for (let i = 0; i < embeds.length; i += 10) await send(batch.channel, { embeds: embeds.slice(i, i + 10), ...silent });
}

export function flushAll() {
  return Promise.all([...pending.keys()].map(flush));
}

function queue(channel, key, text, color, at) {
  let batch = pending.get(channel.id);
  if (!batch) {
    batch = { channel, lines: [], timer: null };
    pending.set(channel.id, batch);
  }
  const last = batch.lines.at(-1);
  if (last?.key === key) last.count++;
  else batch.lines.push({ key, text, color, at, count: 1 });
  batch.timer ??= setTimeout(() => flush(channel.id), FLUSH_DELAY);
}

async function merge(channel, merger, parsed, entry) {
  const key = `${channel.id}|${entry.component}|${parsed.key}`;
  const now = new Date(entry.at).getTime();
  const open = merged.get(key);
  const payload = (record) => ({ embeds: [card(merger.render(record.state), colorOf(entry), record.last ?? record.at)], ...silent });
  if (open && now < open.until) {
    open.state = merger.add(open.state, parsed, entry);
    open.until = now + merger.window;
    open.last = entry.at;
    const message = await open.message;
    await message?.edit(payload(open)).catch(() => {});
    return;
  }
  await flush(channel.id);
  const record = { state: merger.start(parsed, entry), until: now + merger.window, at: entry.at };
  record.message = send(channel, payload(record));
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
  if (!entry.mention && !entry.components) return queue(channel, `${entry.host} ${entry.component} ${entry.level} ${entry.channel?.id} ${entry.message}`, text, colorOf(entry), entry.at);
  await flush(channel.id);
  const { users = [], roles = [] } = entry.mention ?? {};
  const pings = [...users.map((id) => `<@${id}>`), ...roles.map((id) => `<@&${id}>`)].join(' ');
  await send(channel, { content: pings || undefined, embeds: [card(text, colorOf(entry), entry.at)], allowedMentions: { users, roles }, components: entry.components ?? [] });
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
