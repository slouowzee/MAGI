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
  commandes: 'Clic droit et /chuchoter',
  vocaux: 'Écoute des messages vocaux',
  debat: 'Débats entre unités',
  etoiles: 'Hall of Fame',
  sondages: 'Sondages',
  evenements: 'Événements',
  anniversaires: 'Anniversaires',
  synchro: 'Taux de synchronisation',
  vocal_temporaire: 'Salons vocaux temporaires',
  tickets: 'Tickets',
  filtre_arrivee: "Filtre à l'arrivée",
  anti_raid: 'Anti-raid',
  automod: 'AutoMod Discord',
  statut: 'Statut dynamique',
};
const OFF_BY_DEFAULT = new Set(['bienvenue', 'etoiles', 'anniversaires', 'synchro', 'vocal_temporaire', 'tickets', 'filtre_arrivee', 'automod']);

export const OPTIONS = {
  stars_threshold: { default: '5', values: ['3', '5', '7', '10', '15'] },
  gate_min_age: { default: '7', values: ['0', '1', '3', '7', '30'] },
  raid_threshold: { default: '10', values: ['5', '10', '20', '30'] },
  automod_mentions: { default: '5', values: ['3', '5', '10', '20'] },
};

const list = (guildId, key) => setting(guildId, key)?.split(',').filter(Boolean) ?? [];

export const settingList = list;

export function setSettingList(guildId, key, ids) {
  setSetting(guildId, key, ids.join(',') || null);
}

export function option(guildId, key) {
  const value = setting(guildId, key);
  return OPTIONS[key].values.includes(value) ? value : OPTIONS[key].default;
}

export function channelSetting(guild, key) {
  return guild.channels.cache.get(setting(guild.id, key)) ?? null;
}

export function personaForChannel(channel) {
  const id = channel.isThread?.() ? channel.parentId : channel.id;
  return Object.keys(PERSONAS).find((p) => list(channel.guild.id, `persona_channels:${p}`).includes(id)) ?? null;
}

export function moduleEnabled(guildId, name) {
  const value = setting(guildId, `module:${name}`);
  return value === null ? !OFF_BY_DEFAULT.has(name) : value === '1';
}

export function enabledModules(guildId) {
  return Object.keys(MODULES).filter((name) => moduleEnabled(guildId, name));
}

export function setModule(guildId, name, on) {
  setSetting(guildId, `module:${name}`, on ? '1' : '0');
}

export function setModules(guildId, enabled) {
  for (const name of Object.keys(MODULES)) setModule(guildId, name, enabled.includes(name));
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
