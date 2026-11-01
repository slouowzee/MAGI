import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { operatorRole } from '../../core/installation.js';
import { listSettings, setSetting, setting } from '../../core/settings.js';
import { PERMISSIONS } from '../admin/resolve.js';
import { norm, structure, TYPES } from './plan.js';

const scopeOf = (guild) => `modeles:${guild.ownerId}`;
const TYPE_NAMES = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [v, k]));
const HOOKED = { welcome_channel: 'accueil', stars_channel: 'hall_of_fame', tickets_channel: 'tickets', birthday_channel: 'anniversaires', voice_hub: 'generateur_vocal', roles_channel: 'roles' };

function accessOf(channel, everyone) {
  if (channel.nsfw) return 'nsfw';
  const overwrite = channel.permissionOverwrites.cache.get(everyone.id);
  if (overwrite?.deny.has(P.ViewChannel)) return 'staff';
  if (overwrite?.deny.has(P.SendMessages)) return 'lecture';
  return 'public';
}

export function templateOf(guild) {
  const everyone = guild.roles.everyone;
  const fns = Object.fromEntries(Object.entries(HOOKED).map(([key, fn]) => [setting(guild.id, key), fn]));
  const channels = structure(guild).sort((a, b) => a.rawPosition - b.rawPosition);
  const salon = (c) => ({
    nom: c.name,
    type: TYPE_NAMES[c.type] ?? 'texte',
    acces: accessOf(c, everyone),
    sujet: c.topic ?? '',
    lent: c.rateLimitPerUser ?? 0,
    places: c.userLimit ?? 0,
    fonction: fns[c.id] ?? (c.id === guild.rulesChannelId ? 'regles' : c.id === guild.afkChannelId ? 'afk' : ''),
  });
  const categories = channels.filter((c) => c.type === ChannelType.GuildCategory).map((cat) => ({ nom: cat.name, acces: accessOf(cat, everyone), salons: channels.filter((c) => c.parentId === cat.id).map(salon) }));
  const loose = channels.filter((c) => !c.parentId && c.type !== ChannelType.GuildCategory);
  if (loose.length) categories.unshift({ nom: 'Général', acces: 'public', salons: loose.map(salon) });
  const top = guild.members.me.roles.highest.position;
  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id && !r.managed && r.id !== operatorRole(guild)?.id && r.position < top)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ nom: r.name, couleur: r.hexColor === '#000000' ? '' : r.hexColor, affiche: r.hoist, permissions: Object.keys(PERMISSIONS).filter((k) => r.permissions.has(PERMISSIONS[k], false)) }));
  return { categories, roles };
}

export function saveTemplate(guild, name) {
  const key = norm(name);
  if (!key) throw new Error('il faut un nom de modèle');
  setSetting(scopeOf(guild), `modele:${key}`, JSON.stringify({ name: name.trim().slice(0, 60), from: guild.name, at: Date.now(), plan: templateOf(guild) }));
  return name.trim().slice(0, 60);
}

export function listTemplates(guild) {
  return listSettings(scopeOf(guild), 'modele:').map((row) => JSON.parse(row.value));
}

export function findTemplate(guild, name) {
  const raw = setting(scopeOf(guild), `modele:${norm(name)}`);
  if (!raw) throw new Error(`modèle introuvable : ${name}. Modèles : ${listTemplates(guild).map((t) => t.name).join(', ') || 'aucun'}`);
  return JSON.parse(raw);
}

export async function discordTemplate(guild, reason) {
  const existing = (await guild.fetchTemplates()).first();
  const template = existing ? await existing.sync() : await guild.createTemplate(guild.name.slice(0, 100), reason);
  return `https://discord.new/${template.code}`;
}
