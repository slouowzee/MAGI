import { addSink, severity } from './log.js';
import { listSettings, setSetting, setting } from '../settings.js';

const CHECK_EVERY = 10 * 60_000;
const HOUR = 9;
const KEEP_DAYS = 8;
const DAY = 86_400_000;
const PARTS = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });

export function parisDay(ms) {
  const p = Object.fromEntries(PARTS.formatToParts(ms).map(({ type, value }) => [type, value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

export function bumpStat(scope, metric, n = 1, now = Date.now()) {
  const key = `stats:${parisDay(now).day}:${metric}`;
  setSetting(scope, key, Number(setting(scope, key) ?? 0) + n);
}

export function statsOf(scope, day) {
  return Object.fromEntries(listSettings(scope, `stats:${day}:`).map((row) => [row.key.split(':')[2], Number(row.value)]));
}

export function countEntry(entry, now = Date.now()) {
  const scope = entry.guild?.id ?? 'global';
  const { component, message } = entry;
  if (component === 'membres' && / est arrivée?(?=\s|$)/.test(message)) bumpStat(scope, 'arrivees', 1, now);
  if (component === 'membres' && / est partie?(?=\s|$)/.test(message)) bumpStat(scope, 'departs', 1, now);
  if (component === 'tickets' && /a ouvert un ticket/.test(message)) bumpStat(scope, 'tickets', 1, now);
  if (component === 'bot' && /^(Redémarré|Démarré)/.test(message)) bumpStat('global', 'redemarrages', 1, now);
  const model = component === 'conversation' && message.match(/, conv \d+, ([^,]+), [\d.]+ s$/)?.[1];
  if (model) {
    bumpStat(scope, 'reponses', 1, now);
    if (!/gemini/i.test(model)) bumpStat(scope, 'relais', 1, now);
  }
  if (severity(entry.level) <= severity('err')) bumpStat(scope, 'erreurs', 1, now);
}

const count = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

export function digestText(day, stats, global = null) {
  const s = (k) => stats[k] ?? 0;
  const g = (k) => global?.[k] ?? 0;
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
  const parts = [
    (s('arrivees') || s('departs')) && `${count(s('arrivees'), 'arrivée')}, ${count(s('departs'), 'départ')}`,
    s('cas') && `${count(s('cas'), 'cas de modération', 'cas de modération')}${s('cas_annules') ? ` (${s('cas_annules')} annulé${s('cas_annules') > 1 ? 's' : ''})` : ''}`,
    s('tickets') && count(s('tickets'), 'ticket'),
    s('reponses') && `${count(s('reponses'), 'réponse')} des unités${s('relais') ? `, dont ${s('relais')} via le relais` : ''}`,
    global && g('redemarrages') && count(g('redemarrages'), 'redémarrage'),
    s('erreurs') + g('erreurs') ? `❌ ${count(s('erreurs') + g('erreurs'), 'erreur')}, voir #magi-systeme` : 'aucune erreur',
  ].filter(Boolean);
  return `📊 **Résumé du ${label}** · ${parts.join(' · ')}`;
}

function cleanup(scope, now) {
  const oldest = parisDay(now - KEEP_DAYS * DAY).day;
  for (const row of listSettings(scope, 'stats:')) if (row.key.split(':')[1] < oldest) setSetting(scope, row.key, null);
}

export function startDigest(client, { channelOf, ownerGuilds }) {
  addSink((entry) => countEntry(entry));
  const tick = () => {
    const now = Date.now();
    if (parisDay(now).hour < HOUR) return;
    const yesterday = parisDay(now - DAY).day;
    const owners = new Set(ownerGuilds(client).map((g) => g.id));
    for (const guild of client.guilds.cache.values()) {
      if (setting(guild.id, 'digest') === 'off' || setting(guild.id, 'digest_done') === yesterday) continue;
      setSetting(guild.id, 'digest_done', yesterday);
      channelOf(guild)
        ?.send({ content: digestText(yesterday, statsOf(guild.id, yesterday), owners.has(guild.id) ? statsOf('global', yesterday) : null), allowedMentions: { parse: [] } })
        .catch(() => {});
      cleanup(guild.id, now);
    }
    cleanup('global', now);
  };
  tick();
  setInterval(tick, CHECK_EVERY).unref();
}
