import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits as P,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { interventionChannels } from '../features/conversation/interventions.js';
import { setting } from '../core/settings.js';
import { channelSetting, enabledModules, moduleEnabled, MODULES, OPTIONS, option } from '../core/config.js';

export const PREFIX = 'magi-config:';

export const PAGES = {
  accueil: 'Accueil',
  conversation: 'Conversation',
  statut: 'Statut du bot',
  personas: 'Personas et salons',
  reponses: 'Réponses des unités',
  communaute: 'Communauté',
  services: 'Services',
  arrivees: 'Arrivées',
  securite: 'Sécurité',
  automod: 'AutoMod',
  serveur: 'Serveur',
  logs: 'Logs',
  permissions: 'Permissions',
  debug: 'Débogage',
};

export const PAGE_MODULES = {
  conversation: ['interventions', 'memoire', 'rappels', 'vote', 'debat', 'commandes', 'vocaux'],
  statut: ['statut'],
  communaute: ['etoiles', 'anniversaires', 'synchro', 'sondages', 'evenements'],
  services: ['tickets', 'vocal_temporaire'],
  arrivees: ['bienvenue', 'filtre_arrivee', 'anti_raid'],
  securite: ['administration', 'antinuke', 'sauvegardes'],
  automod: ['automod'],
};

export const HINTS = {
  interventions: 'MAGI prend la parole de lui-même dans les salons choisis.',
  memoire: 'Retient des faits sur les membres et résume les conversations.',
  rappels: 'Rappels programmés à la demande.',
  vote: 'Les trois unités votent sur une question.',
  debat: 'Les unités débattent quand on le demande.',
  commandes: 'Clic droit sur un message, /chuchoter.',
  vocaux: 'Écoute les messages vocaux.',
  statut: 'Pastille et texte du profil : ce que fait MAGI, infos du serveur, veille la nuit.',
  administration: 'Gestion du serveur à la demande des opérateurs.',
  etoiles: 'Copie dans un salon les messages qui reçoivent assez de réactions avec l’emoji choisi.',
  anniversaires: 'Souhaite les anniversaires à 9 h.',
  synchro: 'Activité des membres, paliers et rôles.',
  sondages: 'Sondages Discord à la demande.',
  evenements: 'Événements Discord à la demande.',
  tickets: 'Un fil privé entre un membre et les opérateurs.',
  vocal_temporaire: 'Un salon vocal par personne, supprimé quand il est vide.',
  bienvenue: "Messages d'arrivée et de départ.",
  filtre_arrivee: 'Les comptes suspects passent par un bouton de vérification.',
  anti_raid: "Verrouille les salons en cas d'afflux d'arrivées.",
  antinuke: 'Met en quarantaine qui supprime ou bannit en masse.',
  sauvegardes: 'Sauvegarde quotidienne de la structure du serveur.',
  automod: 'Règles natives de Discord : le message est bloqué avant publication, alerte dans #magi-moderation.',
};

export const NEEDS = {
  sondages: [P.SendPolls],
  evenements: [P.CreateEvents],
  tickets: [P.CreatePrivateThreads],
  vocal_temporaire: [P.ManageChannels, P.MoveMembers],
  filtre_arrivee: [P.ManageRoles, P.ManageChannels],
  anti_raid: [P.ManageRoles, P.ManageChannels],
  antinuke: [P.ViewAuditLog, P.ManageRoles, P.ModerateMembers],
  automod: [P.ManageGuild],
};

export const MISSING_CHANNEL = {
  interventions: (guild) => !interventionChannels(guild.id).length && 'aucun salon choisi',
  etoiles: (guild) => !channelSetting(guild, 'stars_channel') && 'aucun salon choisi',
  tickets: (guild) => !channelSetting(guild, 'tickets_channel') && 'aucun salon choisi pour le panneau',
  vocal_temporaire: (guild) => !channelSetting(guild, 'voice_hub') && 'aucun salon générateur',
  bienvenue: (guild) => !channelSetting(guild, 'welcome_channel') && !guild.systemChannel && 'aucun salon choisi',
};

export const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum];

export const MODE_LABELS = { observation: 'Observation (note sans agir)', active: 'Active (agit)', desactivee: 'Désactivée' };

export const id = (field) => PREFIX + field;
export const channels = (ids) => (ids.length ? ids.map((c) => `<#${c}>`).join(', ') : 'aucun salon');
export const one = (key, guild) => channels([setting(guild.id, key)].filter(Boolean));
export const row = (component) => new ActionRowBuilder().addComponents(component);
export const text = (content) => new TextDisplayBuilder().setContent(content);
export const separator = () => new SeparatorBuilder();
export const pageOf = (key) => Object.keys(PAGE_MODULES).find((page) => PAGE_MODULES[page].includes(key));

export function alerts(guild) {
  const me = guild.members.me.permissions;
  const found = {};
  for (const key of enabledModules(guild.id)) {
    const problem = MISSING_CHANNEL[key]?.(guild) || (NEEDS[key]?.some((p) => !me.has(p)) && 'permissions manquantes, voir la page Permissions');
    if (problem) found[key] = problem;
  }
  return found;
}

export function feature(guild, key, detail) {
  const on = moduleEnabled(guild.id, key);
  const problem = on && alerts(guild)[key];
  const lines = [`**${MODULES[key]}**`, [on ? 'Actif' : 'Coupé', on && detail].filter(Boolean).join(' · '), problem && `**À régler** : ${problem}`, `-# ${HINTS[key]}`];
  return new SectionBuilder()
    .addTextDisplayComponents(text(lines.filter(Boolean).join('\n')))
    .setButtonAccessory(new ButtonBuilder().setCustomId(id(`module:${key}`)).setLabel(on ? 'Couper' : 'Activer').setStyle(on ? ButtonStyle.Secondary : ButtonStyle.Success));
}

export function channelSelect(field, placeholder, defaults, max, types = TEXT_CHANNELS) {
  const menu = new ChannelSelectMenuBuilder().setCustomId(id(field)).setPlaceholder(placeholder).setChannelTypes(types).setMinValues(0).setMaxValues(max);
  const kept = defaults.filter(Boolean).slice(0, max);
  if (kept.length) menu.setDefaultChannels(kept);
  return row(menu);
}

export function choice(guild, key, placeholder, label) {
  const current = option(guild.id, key);
  return row(
    new StringSelectMenuBuilder()
      .setCustomId(id(key))
      .setPlaceholder(placeholder)
      .addOptions(OPTIONS[key].values.map((value) => ({ label: label(value), value, default: value === current }))),
  );
}
