import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { norm, structure } from './plan.js';

const EMOJI = /^\p{Extended_Pictographic}/u;
const SEPARATOR = /^\p{Extended_Pictographic}️?\s*([・┃︱»|•·:]|-(?=\S))/u;
const PRIVATE = /(staff|admin|mod[ée]?r|modo|logs?|priv[ée]|coulisses|backstage)/i;
const ANNOUNCE = /(annonce|announcement|r[èe]gle|rules|news)/i;
const few = (list) => `${list.slice(0, 5).join(', ')}${list.length > 5 ? ` et ${list.length - 5} autre(s)` : ''}`;

export function auditStructure(guild) {
  const channels = structure(guild);
  const everyone = guild.roles.everyone;
  const categories = channels.filter((c) => c.type === ChannelType.GuildCategory);
  const rooms = channels.filter((c) => c.type !== ChannelType.GuildCategory);
  const findings = [];

  const separators = new Map();
  for (const c of rooms) {
    const sep = c.name.match(SEPARATOR)?.[1];
    if (sep) separators.set(sep, (separators.get(sep) ?? 0) + 1);
  }
  if (separators.size > 1) findings.push(`Séparateurs mélangés : ${[...separators].map(([s, n]) => `« ${s} » ×${n}`).join(', ')}`);

  const bare = rooms.filter((c) => !EMOJI.test(c.name));
  if (bare.length && bare.length < rooms.length) findings.push(`${bare.length} salon(s) sans emoji alors que les autres en ont : ${few(bare.map((c) => c.name))}`);

  const groups = new Map();
  for (const c of rooms) {
    const key = norm(c.name.replace(EMOJI, ''));
    if (key) groups.set(key, [...(groups.get(key) ?? []), c.name]);
  }
  for (const names of groups.values()) if (names.length > 1) findings.push(`Doublons possibles : ${names.join(', ')}`);

  const empty = categories.filter((cat) => !rooms.some((c) => c.parentId === cat.id));
  if (empty.length) findings.push(`Catégorie(s) vide(s) : ${few(empty.map((c) => c.name))}`);
  const loose = rooms.filter((c) => !c.parentId);
  if (loose.length) findings.push(`Salon(s) hors catégorie : ${few(loose.map((c) => c.name))}`);

  const can = (c, perm) => c.permissionsFor?.(everyone)?.has(perm) ?? false;
  const leaks = rooms.filter((c) => PRIVATE.test(c.name) && can(c, P.ViewChannel));
  if (leaks.length) findings.push(`Visible(s) par tout le monde malgré un nom de salon privé : ${few(leaks.map((c) => c.name))}`);
  const open = rooms.filter((c) => c.type !== ChannelType.GuildVoice && ANNOUNCE.test(c.name) && can(c, P.ViewChannel) && can(c, P.SendMessages));
  if (open.length) findings.push(`Tout le monde peut écrire dans : ${few(open.map((c) => c.name))}`);
  return findings;
}
