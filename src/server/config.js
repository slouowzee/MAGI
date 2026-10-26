import { PERSONAS } from '../personas.js';
import { setSetting, setting } from '../storage/settings.js';

export const MODULES = {
  interventions: 'Interventions spontanées',
  memoire: 'Mémoire et résumés',
  rappels: 'Rappels',
  vote: 'Vote MAGI',
  administration: "Outils d'administration",
  bienvenue: 'Bienvenue et départs',
  antinuke: 'Anti-nuke',
  sauvegardes: 'Sauvegardes automatiques',
};
const OFF_BY_DEFAULT = new Set(['bienvenue']);

const list = (guildId, key) => setting(guildId, key)?.split(',').filter(Boolean) ?? [];

export function moduleEnabled(guildId, name) {
  const value = setting(guildId, `module:${name}`);
  return value === null ? !OFF_BY_DEFAULT.has(name) : value === '1';
}

export function enabledModules(guildId) {
  return Object.keys(MODULES).filter((name) => moduleEnabled(guildId, name));
}

export function setModules(guildId, enabled) {
  for (const name of Object.keys(MODULES)) setSetting(guildId, `module:${name}`, enabled.includes(name) ? '1' : '0');
}

export function activePersonas(guildId) {
  const chosen = list(guildId, 'personas').filter((p) => PERSONAS[p]);
  return chosen.length ? chosen : Object.keys(PERSONAS);
}

export function setActivePersonas(guildId, personas) {
  setSetting(guildId, 'personas', personas.filter((p) => PERSONAS[p]).join(',') || null);
}

export function mutedChannels(guildId) {
  return list(guildId, 'muted_channels');
}

export function setMutedChannels(guildId, ids) {
  setSetting(guildId, 'muted_channels', ids.join(',') || null);
}

export function isMuted(channel) {
  const ids = mutedChannels(channel.guild.id);
  return ids.includes(channel.id) || Boolean(channel.isThread?.() && ids.includes(channel.parentId));
}
