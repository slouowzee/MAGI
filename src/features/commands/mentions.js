const OPENING = /[\s(«"'’]/;
const AFTER = /^(?:$|[\s.,;:!?)\]»"'’…])/u;
const WORD = /^[\p{L}\p{N}_.-]+/u;
const EMOJI = /(?<![<\w]):([\w~]{2,32}):(?!\d)/g;
const bare = (name) => String(name ?? '').replace(/^[^\p{L}\p{N}]+/u, '');

function table(entries) {
  const byName = new Map();
  for (const [names, value] of entries) {
    for (const name of new Set(names.filter(Boolean).map((n) => n.toLowerCase()))) byName.set(name, byName.has(name) && byName.get(name) !== value ? null : value);
  }
  return [...byName].sort((a, b) => b[0].length - a[0].length);
}

function replaceMarked(text, marker, names, unknown) {
  let out = '';
  let from = 0;
  for (let at = text.indexOf(marker); at >= 0; at = text.indexOf(marker, at + 1)) {
    const rest = text.slice(at + 1);
    if ((at > 0 && !OPENING.test(text[at - 1])) || !/^[^\s<]/.test(rest)) continue;
    const lower = rest.toLowerCase();
    const hit = names.find(([name]) => lower.startsWith(name) && AFTER.test(rest.slice(name.length)));
    if (hit?.[1]) {
      out += text.slice(from, at) + hit[1];
      from = at + 1 + hit[0].length;
      at = from - 1;
    } else if (hit) unknown.push(`${marker}${rest.slice(0, hit[0].length)} (plusieurs correspondances)`);
    else if (WORD.test(rest) && !['everyone', 'here'].includes(rest.match(WORD)[0].toLowerCase())) unknown.push(`${marker}${rest.match(WORD)[0]}`);
  }
  return out + text.slice(from);
}

export function resolveMentions(guild, text) {
  const unknown = [];
  if (!text) return { text, unknown };
  const people = table([
    ...[...guild.members.cache.values()].map((m) => [[m.displayName, m.user?.username, m.user?.globalName], `<@${m.id}>`]),
    ...[...guild.roles.cache.values()].filter((r) => r.id !== guild.id).map((r) => [[r.name], `<@&${r.id}>`]),
  ]);
  const places = table([...guild.channels.cache.values()].map((c) => [[c.name, bare(c.name)], `<#${c.id}>`]));
  const emojis = [...(guild.emojis?.cache.values() ?? [])];
  let result = replaceMarked(replaceMarked(text, '@', people, unknown), '#', places, unknown);
  result = result.replace(EMOJI, (match, name) => {
    if (!/[a-z]/i.test(name)) return match;
    const emoji = emojis.find((e) => e.name === name) ?? emojis.find((e) => e.name?.toLowerCase() === name.toLowerCase());
    if (emoji) return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
    unknown.push(match);
    return match;
  });
  return { text: result, unknown: [...new Set(unknown)] };
}

export const unknownNote = (unknown) => (unknown.length ? `Pas trouvé sur le serveur, laissé tel quel : ${unknown.join(', ')}.` : '');
