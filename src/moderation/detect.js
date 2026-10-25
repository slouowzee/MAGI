const OFFICIAL = new Set(['discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.gift', 'discord.media', 'discordstatus.com', 'steampowered.com', 'steamcommunity.com', 'steamstatic.com', 'discord.js.org', 'discordjs.guide', 'discord.dev', 'dis.gd']);
const LURE = /\b(nitro|free|gratuit|gift|cadeau|giveaway|airdrop|claim|r[ée]cup[eè]re|steam)\b/i;
const URL = /\bhttps?:\/\/([^\s/<>]+)[^\s<>]*/gi;
const INVITE = /\b(?:discord(?:app)?\.com\/invite|discord\.gg)\/[\w-]+/i;
const BURST = { count: 6, window: 10_000 };
const DUPLICATE = { channels: 3, window: 120_000 };
const MENTIONS = { suspect: 5, flagrant: 10 };
const NEW_ACCOUNT = 7 * 24 * 3600_000;
const NEW_MEMBER = 24 * 3600_000;

export function hosts(content) {
  return [...content.matchAll(URL)].map((m) => m[1].toLowerCase().replace(/^www\./, '').split(':')[0]);
}

function official(host) {
  return [...OFFICIAL].some((d) => host === d || host.endsWith(`.${d}`));
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

function lookalike(host, text) {
  if (official(host)) return false;
  if ([...OFFICIAL].some((d) => distance(host, d) <= 2)) return true;
  return /discord|steam|nitro/.test(host.replace(/[^a-z0-9]/g, '')) && LURE.test(text);
}

const normalize = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();

export function createTracker() {
  const recent = new Map();
  return function track(userId, channelId, content, now) {
    const list = (recent.get(userId) ?? []).filter((m) => now - m.at <= DUPLICATE.window);
    list.push({ at: now, channelId, text: normalize(content) });
    recent.set(userId, list);
    const burst = list.filter((m) => now - m.at <= BURST.window).length;
    const text = normalize(content);
    const duplicateChannels = text.length >= 10 ? new Set(list.filter((m) => m.text === text).map((m) => m.channelId)).size : 0;
    return { burst, duplicateChannels };
  };
}

export function detect({ content, mentionCount = 0, everyoneAttempt = false, accountAge = Infinity, memberAge = Infinity, activity = { burst: 0, duplicateChannels: 0 } }) {
  const found = [];
  const links = hosts(content);
  const text = content.replace(URL, ' ');
  const fakes = links.filter((h) => lookalike(h, text));
  if (fakes.length) found.push({ level: 'flagrant', reason: `lien d'arnaque imitant un site connu (${fakes[0]})` });
  else if (links.some((h) => !official(h)) && LURE.test(text)) found.push({ level: 'suspect', reason: 'lien accompagné d’une promesse de cadeau' });
  if (activity.duplicateChannels >= DUPLICATE.channels) found.push({ level: 'flagrant', reason: `même message dans ${activity.duplicateChannels} salons` });
  if (mentionCount >= MENTIONS.flagrant) found.push({ level: 'flagrant', reason: `${mentionCount} mentions dans un message` });
  else if (mentionCount >= MENTIONS.suspect || everyoneAttempt) found.push({ level: 'suspect', reason: everyoneAttempt ? 'tentative de mentionner tout le monde' : `${mentionCount} mentions dans un message` });
  if (activity.burst >= BURST.count) found.push({ level: 'suspect', reason: `${activity.burst} messages en quelques secondes` });
  if (INVITE.test(content)) found.push({ level: 'suspect', reason: "lien d'invitation vers un autre serveur" });
  if (links.length && (accountAge < NEW_ACCOUNT || memberAge < NEW_MEMBER)) found.push({ level: 'suspect', reason: 'lien posté par un compte ou un membre récent' });
  if (!found.length) return null;
  const flagrant = found.find((f) => f.level === 'flagrant');
  return { level: flagrant ? 'flagrant' : 'suspect', reasons: found.map((f) => f.reason) };
}
