import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits as P,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { PERSONAS } from '../personas.js';
import { auditReport } from '../security/audit.js';
import { backupGuild } from '../security/backup.js';
import { disableHoneypot, enableHoneypot, honeypotOf, refreshHoneypot } from '../security/honeypot.js';
import { restylePublications } from '../tools/admin/publications.js';
import { latestBackup } from '../storage/backups.js';
import { interventionChannels, replaceInterventions } from '../storage/interventions.js';
import { MODES, moderationMode, setModerationMode } from '../storage/moderation.js';
import { setSetting, setting } from '../storage/settings.js';
import { activePersonas, channelSetting, enabledModules, moduleEnabled, MODULES, mutedChannels, OPTIONS, option, setActivePersonas, setModule, setMutedChannels, setSettingList, settingList } from './config.js';
import { installAndReport, isOperator, logChannels, magiCategory, operatorRole } from './installation.js';
import { log } from '../logging/log.js';
import { COMMANDS, statusReport, syncCommands } from '../conversation/commands.js';
import { ensureGate } from '../security/gate.js';
import { postTicketPanel } from '../community/tickets.js';
import { createHub } from '../community/voice.js';
import { DISCORD_LEVELS, discordLevel } from '../logging/discord.js';
import { atLeast, currentLevel, inviteUrl, LEVELS } from './permissions.js';

const PREFIX = 'magi-config:';
const PAGES = {
  accueil: 'Accueil',
  conversation: 'Conversation',
  personas: 'Personas et salons',
  communaute: 'Communauté',
  services: 'Services',
  arrivees: 'Arrivées',
  securite: 'Sécurité',
  logs: 'Logs',
  permissions: 'Permissions',
};
export const PAGE_MODULES = {
  conversation: ['interventions', 'memoire', 'rappels', 'vote', 'debat', 'commandes', 'vocaux', 'statut'],
  communaute: ['etoiles', 'anniversaires', 'synchro', 'sondages', 'evenements'],
  services: ['tickets', 'vocal_temporaire'],
  arrivees: ['bienvenue', 'filtre_arrivee', 'anti_raid'],
  securite: ['administration', 'antinuke', 'sauvegardes'],
};
const HINTS = {
  interventions: 'MAGI prend la parole de lui-même dans les salons choisis.',
  memoire: 'Retient des faits sur les membres et résume les conversations.',
  rappels: 'Rappels programmés à la demande.',
  vote: 'Les trois unités votent sur une question.',
  debat: 'Les unités débattent quand on le demande.',
  commandes: 'Clic droit sur un message, /chuchoter.',
  vocaux: 'Écoute les messages vocaux.',
  statut: "Le statut du bot montre ce qu'il fait.",
  administration: 'Gestion du serveur à la demande des opérateurs.',
  etoiles: 'Copie les messages qui reçoivent assez de 🔥 dans un salon.',
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
};
const NEEDS = {
  sondages: [P.SendPolls],
  evenements: [P.CreateEvents],
  tickets: [P.CreatePrivateThreads],
  vocal_temporaire: [P.ManageChannels, P.MoveMembers],
  filtre_arrivee: [P.ManageRoles, P.ManageChannels],
  anti_raid: [P.ManageRoles, P.ManageChannels],
  antinuke: [P.ViewAuditLog, P.ManageRoles, P.ModerateMembers],
};
const MISSING_CHANNEL = {
  interventions: (guild) => !interventionChannels(guild.id).length && 'aucun salon choisi',
  etoiles: (guild) => !channelSetting(guild, 'stars_channel') && 'aucun salon choisi',
  tickets: (guild) => !channelSetting(guild, 'tickets_channel') && 'aucun salon choisi pour le panneau',
  vocal_temporaire: (guild) => !channelSetting(guild, 'voice_hub') && 'aucun salon générateur',
  bienvenue: (guild) => !channelSetting(guild, 'welcome_channel') && !guild.systemChannel && 'aucun salon choisi',
};
const COLOR = 0xd65c62;
const V2 = MessageFlags.IsComponentsV2;
const PRIVATE = V2 | MessageFlags.Ephemeral;
const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum];
const silent = { allowedMentions: { parse: [] } };
const MODE_LABELS = { observation: 'Observation (note sans agir)', active: 'Active (agit)', desactivee: 'Désactivée' };

const id = (field) => PREFIX + field;
const channels = (ids) => (ids.length ? ids.map((c) => `<#${c}>`).join(', ') : 'aucun salon');
const one = (key, guild) => channels([setting(guild.id, key)].filter(Boolean));
const row = (component) => new ActionRowBuilder().addComponents(component);
const text = (content) => new TextDisplayBuilder().setContent(content);
const separator = () => new SeparatorBuilder();
const pageOf = (key) => Object.keys(PAGE_MODULES).find((page) => PAGE_MODULES[page].includes(key));

export function alerts(guild) {
  const me = guild.members.me.permissions;
  const found = {};
  for (const key of enabledModules(guild.id)) {
    const problem = MISSING_CHANNEL[key]?.(guild) || (NEEDS[key]?.some((p) => !me.has(p)) && 'permissions manquantes, voir la page Permissions');
    if (problem) found[key] = problem;
  }
  return found;
}

function feature(guild, key, detail) {
  const on = moduleEnabled(guild.id, key);
  const problem = on && alerts(guild)[key];
  const lines = [`**${MODULES[key]}**`, [on ? 'Actif' : 'Coupé', on && detail].filter(Boolean).join(' · '), problem && `**À régler** : ${problem}`, `-# ${HINTS[key]}`];
  return new SectionBuilder()
    .addTextDisplayComponents(text(lines.filter(Boolean).join('\n')))
    .setButtonAccessory(new ButtonBuilder().setCustomId(id(`module:${key}`)).setLabel(on ? 'Couper' : 'Activer').setStyle(on ? ButtonStyle.Secondary : ButtonStyle.Success));
}

function channelSelect(field, placeholder, defaults, max, types = TEXT_CHANNELS) {
  const menu = new ChannelSelectMenuBuilder().setCustomId(id(field)).setPlaceholder(placeholder).setChannelTypes(types).setMinValues(0).setMaxValues(max);
  const kept = defaults.filter(Boolean).slice(0, max);
  if (kept.length) menu.setDefaultChannels(kept);
  return row(menu);
}

function choice(guild, key, placeholder, label) {
  const current = option(guild.id, key);
  return row(
    new StringSelectMenuBuilder()
      .setCustomId(id(key))
      .setPlaceholder(placeholder)
      .addOptions(OPTIONS[key].values.map((value) => ({ label: label(value), value, default: value === current }))),
  );
}

function homeSection(guild, { live }) {
  const found = Object.entries(alerts(guild));
  const level = currentLevel(guild.members.me.permissions);
  const missingLogs = Object.entries(logChannels(guild)).filter(([, c]) => !c).map(([source]) => source);
  const todo = [
    ...found.map(([key, problem]) => `- **${MODULES[key]}** (${PAGES[pageOf(key)]}) : ${problem}`),
    ...(missingLogs.length ? [`- **Logs** : salon manquant pour ${missingLogs.join(', ')}`] : []),
  ];
  return [
    text(
      [
        `Permissions : **${level ? LEVELS[level].label : 'insuffisantes'}**`,
        `Modules actifs : **${enabledModules(guild.id).length}/${Object.keys(MODULES).length}**`,
        `Modération automatique : ${MODE_LABELS[moderationMode(guild.id).mode]}`,
      ].join('\n'),
    ),
    separator(),
    text(todo.length ? ['**À régler**', ...todo].join('\n') : 'Rien à régler.'),
    ...(live ? [separator(), text(statusReport())] : [text('-# Choisis une page : elle s’ouvre en privé, visible par toi seul.')]),
  ];
}

function conversationSection(guild) {
  const interventions = interventionChannels(guild.id);
  return [
    feature(guild, 'interventions', channels(interventions)),
    channelSelect('interventions', 'Salons des interventions spontanées', interventions, 25),
    separator(),
    ...PAGE_MODULES.conversation.slice(1).map((key) => feature(guild, key)),
  ];
}

function personasSection(guild) {
  const personas = activePersonas(guild.id);
  const muted = mutedChannels(guild.id);
  return [
    text('**Unités actives**'),
    row(
      new StringSelectMenuBuilder()
        .setCustomId(id('personas'))
        .setPlaceholder('Unités actives')
        .setMinValues(1)
        .setMaxValues(Object.keys(PERSONAS).length)
        .addOptions(Object.entries(PERSONAS).map(([value, p]) => ({ label: p.name, value, default: personas.includes(value) }))),
    ),
    separator(),
    text('**Unité par défaut**\n-# Celle qui répond à « magi, … » dans ces salons.'),
    ...Object.entries(PERSONAS).map(([key, p]) => channelSelect(`persona_ch:${key}`, `Salons de ${p.name}`, settingList(guild.id, `persona_channels:${key}`), 25)),
    separator(),
    text(`**Salons où MAGI se tait**\n-# ${muted.length ? `${muted.length} salon(s)` : 'Aucun'} : MAGI n'y répond pas et n'y intervient pas.`),
    channelSelect('muted', 'Salons où MAGI se tait', muted, 25),
  ];
}

function communitySection(guild) {
  return [
    feature(guild, 'etoiles', `${option(guild.id, 'stars_threshold')} 🔥 · ${one('stars_channel', guild)}`),
    choice(guild, 'stars_threshold', 'Flammes nécessaires', (v) => `${v} 🔥 pour entrer`),
    channelSelect('stars_channel', 'Salon du Hall of Fame', [setting(guild.id, 'stars_channel')], 1),
    separator(),
    feature(guild, 'anniversaires', one('birthday_channel', guild)),
    channelSelect('birthday_channel', 'Salon des anniversaires (bienvenue sinon)', [setting(guild.id, 'birthday_channel')], 1),
    separator(),
    feature(guild, 'synchro', setting(guild.id, 'synchro_channel') ? `annonces dans ${one('synchro_channel', guild)}` : 'annonces dans le salon du message'),
    channelSelect('synchro_channel', 'Salon des annonces de synchronisation', [setting(guild.id, 'synchro_channel')], 1),
    separator(),
    feature(guild, 'sondages'),
    feature(guild, 'evenements'),
  ];
}

function servicesSection(guild) {
  return [
    feature(guild, 'tickets', one('tickets_channel', guild)),
    channelSelect('tickets_channel', 'Salon du panneau de tickets', [setting(guild.id, 'tickets_channel')], 1),
    row(new ButtonBuilder().setCustomId(id('tickets_post')).setLabel('Publier le panneau de tickets').setStyle(ButtonStyle.Primary)),
    separator(),
    feature(guild, 'vocal_temporaire', one('voice_hub', guild)),
    channelSelect('voice_hub', 'Salon vocal générateur', [setting(guild.id, 'voice_hub')], 1, [ChannelType.GuildVoice]),
    row(new ButtonBuilder().setCustomId(id('voice_hub_create')).setLabel('Créer le salon générateur').setStyle(ButtonStyle.Secondary)),
  ];
}

function arrivalsSection(guild) {
  const welcome = setting(guild.id, 'welcome_channel');
  const rules = settingList(guild.id, 'gate_rules');
  const age = option(guild.id, 'gate_min_age');
  const criteria = [age !== '0' && `comptes de moins de ${age} j`, rules.includes('avatar') && 'sans avatar', rules.includes('tous') && 'tous les nouveaux'].filter(Boolean);
  return [
    feature(guild, 'bienvenue', welcome ? one('welcome_channel', guild) : 'salon système du serveur'),
    channelSelect('welcome', 'Salon de bienvenue', [welcome], 1),
    separator(),
    feature(guild, 'filtre_arrivee', criteria.join(', ') || 'aucun critère'),
    choice(guild, 'gate_min_age', "Âge minimal du compte", (v) => (v === '0' ? "Pas de critère d'âge" : `Filtrer les comptes de moins de ${v} jour(s)`)),
    row(
      new StringSelectMenuBuilder()
        .setCustomId(id('gate_rules'))
        .setPlaceholder('Autres critères')
        .setMinValues(0)
        .setMaxValues(2)
        .addOptions([
          { label: 'Comptes sans avatar', value: 'avatar', default: rules.includes('avatar') },
          { label: 'Tous les nouveaux membres', value: 'tous', default: rules.includes('tous') },
        ]),
    ),
    separator(),
    feature(guild, 'anti_raid', `${option(guild.id, 'raid_threshold')} arrivées par minute`),
    choice(guild, 'raid_threshold', 'Seuil anti-raid', (v) => `Verrouiller à ${v} arrivées par minute`),
  ];
}

function securitySection(guild) {
  const trap = honeypotOf(guild);
  const backup = latestBackup(guild.id);
  const { mode } = moderationMode(guild.id);
  return [
    text('**Modération automatique**\n-# Spam, liens et insultes : observer seulement, agir, ou rien.'),
    row(
      new StringSelectMenuBuilder()
        .setCustomId(id('moderation'))
        .setPlaceholder('Modération automatique')
        .addOptions(MODES.map((value) => ({ label: MODE_LABELS[value], value, default: value === mode }))),
    ),
    separator(),
    feature(guild, 'administration'),
    feature(guild, 'antinuke'),
    feature(guild, 'sauvegardes', `dernière ${backup ? `<t:${Math.floor(backup.createdAt / 1000)}:R>` : 'jamais'}`),
    new SectionBuilder()
      .addTextDisplayComponents(text(`**Honeypot**\n${trap ? `Actif · ${trap}` : 'Aucun'}\n-# Salon piège : tout message posté dedans entraîne un bannissement.`))
      .setButtonAccessory(
        trap
          ? new ButtonBuilder().setCustomId(id('honeypot')).setLabel('Supprimer').setStyle(ButtonStyle.Danger)
          : new ButtonBuilder().setCustomId(id('honeypot')).setLabel('Créer').setStyle(ButtonStyle.Success),
      ),
    separator(),
    row([
      new ButtonBuilder().setCustomId(id('audit')).setLabel('Lancer l’audit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(id('backup')).setLabel('Sauvegarder maintenant').setStyle(ButtonStyle.Secondary),
    ]),
  ];
}

const LOG_PURPOSES = {
  logs: 'outils, configuration, installation, arrivées et départs, rappels',
  moderation: 'décisions de la modération automatique',
  securite: 'anti-nuke, honeypot, SSH et sudo du VPS',
  systeme: 'démarrage, modèles, erreurs, journal du VPS',
};

function logsSection(guild) {
  const level = discordLevel(guild.id);
  const targets = logChannels(guild);
  return [
    text(Object.entries(LOG_PURPOSES).map(([source, purpose]) => `${targets[source] ?? 'salon manquant'} : ${purpose}`).join('\n')),
    separator(),
    text(`**Niveau minimal** : ${level} et au-dessus\n-# Les alertes qui mentionnent passent quel que soit le niveau.`),
    row(
      new StringSelectMenuBuilder()
        .setCustomId(id('log_level'))
        .setPlaceholder('Niveau minimal des logs Discord')
        .addOptions(Object.entries(DISCORD_LEVELS).map(([value, label]) => ({ label: `${value} : ${label}`, value, default: value === level }))),
    ),
  ];
}

function permissionsSection(guild) {
  const level = currentLevel(guild.members.me.permissions);
  return [
    text(
      [
        `Niveau actuel : **${level ? LEVELS[level].label : 'insuffisant'}**`,
        '',
        ...Object.values(LEVELS).map((l) => `**${l.label}** : ${l.text}`),
        '',
        '-# Un clic ouvre la page d’autorisation Discord, qui met à jour le rôle de MAGI.',
      ].join('\n'),
    ),
    row(Object.entries(LEVELS).map(([key, l]) => new ButtonBuilder().setLabel(l.label).setStyle(ButtonStyle.Link).setURL(inviteUrl(guild.client.user.id, guild.id, key)))),
  ];
}

const BUILDERS = {
  accueil: homeSection,
  conversation: conversationSection,
  personas: personasSection,
  communaute: communitySection,
  services: servicesSection,
  arrivees: arrivalsSection,
  securite: securitySection,
  logs: logsSection,
  permissions: permissionsSection,
};

function navigation(name) {
  const names = Object.keys(PAGES);
  const at = names.indexOf(name);
  const prev = names[(at - 1 + names.length) % names.length];
  const next = names[(at + 1) % names.length];
  return [
    row(
      new StringSelectMenuBuilder()
        .setCustomId(id('page'))
        .setPlaceholder('Aller à une page')
        .addOptions(names.map((page) => ({ label: PAGES[page], value: page, default: page === name }))),
    ),
    row([
      new ButtonBuilder().setCustomId(id(`page:${prev}`)).setLabel(`‹ ${PAGES[prev]}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(id(`page:${next}`)).setLabel(`${PAGES[next]} ›`).setStyle(ButtonStyle.Secondary),
    ]),
  ];
}

export function panelPage(guild, name = 'accueil', { live = false } = {}) {
  const names = Object.keys(PAGES);
  const title = name === 'accueil' ? 'Configuration de MAGI' : PAGES[name];
  const header = text(`## ${title}\n-# Page ${names.indexOf(name) + 1}/${names.length}${live ? ' · visible par toi seul' : ''}`);
  const blocks = [header, separator(), ...BUILDERS[name](guild, { live }), separator(), ...navigation(name)];
  return { components: [new ContainerBuilder({ accent_color: COLOR, components: blocks.map((b) => b.toJSON()) })], flags: V2 };
}

export function openPanel(interaction, page = 'accueil') {
  if (!isOperator(interaction.member)) return interaction.reply({ content: 'Réservé aux opérateurs MAGI.', flags: MessageFlags.Ephemeral, ...silent });
  return interaction.reply({ ...panelPage(interaction.guild, page, { live: true }), flags: PRIVATE, ...silent });
}

function configChannel(guild) {
  return guild.channels.cache.get(setting(guild.id, 'config_channel')) ?? null;
}

async function ensureConfigChannel(guild) {
  const existing = configChannel(guild);
  const category = magiCategory(guild);
  if (existing) {
    if (category && existing.parentId !== category.id) {
      await existing.setParent(category.id, { lockPermissions: false, reason: 'Installation de MAGI' });
      await existing.setPosition(0);
    }
    return existing;
  }
  const role = operatorRole(guild);
  const channel = await guild.channels.create({
    name: 'magi-config',
    type: ChannelType.GuildText,
    parent: category?.id,
    position: 0,
    topic: 'Panneau de configuration de MAGI, réservé aux opérateurs.',
    reason: 'Installation de MAGI',
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
      ...(role ? [{ id: role.id, allow: [P.ViewChannel, P.ReadMessageHistory] }] : []),
      { id: guild.members.me.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks] },
    ],
  });
  setSetting(guild.id, 'config_channel', channel.id);
  return channel;
}

export async function refreshPanel(guild, { repost = false } = {}) {
  if (!operatorRole(guild) || !atLeast(guild.members.me.permissions, 'gestion')) return null;
  const channel = await ensureConfigChannel(guild);
  for (const old of Object.values(JSON.parse(setting(guild.id, 'config_panel') ?? '{}'))) await channel.messages.delete(old).catch(() => {});
  setSetting(guild.id, 'config_panel', null);
  const existing = setting(guild.id, 'config_message');
  const message = existing ? await channel.messages.fetch(existing).catch(() => null) : null;
  if (message && !repost && message.flags.has(V2)) {
    await message.edit(panelPage(guild));
    return channel;
  }
  await message?.delete().catch(() => {});
  setSetting(guild.id, 'config_message', (await channel.send({ ...panelPage(guild), ...silent })).id);
  return channel;
}

export async function setupGuild(guild) {
  await installAndReport(guild);
  await refreshPanel(guild).catch((err) => log.err('config', `échec panneau : ${err.message}`, { guild }));
  await syncCommands(guild).catch((err) => log.err('commandes', `échec enregistrement des commandes : ${err.message}`, { guild }));
  await ensureGate(guild).catch((err) => log.err('filtre', `échec mise en place du filtre : ${err.message}`, { guild }));
  await refreshHoneypot(guild).catch((err) => log.err('honeypot', `échec mise à jour du honeypot : ${err.message}`, { guild }));
  await restylePublications(guild)
    .then((count) => count && log.notice('publications', `${count} publication(s) remise(s) en forme`, { guild }))
    .catch((err) => log.err('publications', `échec remise en forme : ${err.message}`, { guild }));
}

export function isPanelInteraction(customId) {
  return customId.startsWith(PREFIX);
}

const FIELD_LABELS = {
  personas: 'personas',
  moderation: 'modération',
  muted: 'salons muets',
  interventions: 'salons des interventions',
  welcome: 'salon de bienvenue',
  log_level: 'niveau des logs',
  stars_threshold: 'flammes nécessaires',
  stars_channel: 'salon du Hall of Fame',
  birthday_channel: 'salon des anniversaires',
  synchro_channel: 'salon de synchronisation',
  tickets_channel: 'salon des tickets',
  voice_hub: 'salon vocal générateur',
  gate_min_age: 'âge minimal à l’arrivée',
  gate_rules: 'critères du filtre',
  raid_threshold: 'seuil anti-raid',
};
const single = (key) => (guild, values) => setSetting(guild.id, key, values[0] ?? null);

const APPLY = {
  personas: { page: 'personas', apply: (guild, values) => setActivePersonas(guild.id, values) },
  muted: { page: 'personas', apply: (guild, values) => setMutedChannels(guild.id, values) },
  interventions: { page: 'conversation', apply: (guild, values) => replaceInterventions(guild.id, values) },
  stars_threshold: { page: 'communaute', apply: single('stars_threshold') },
  stars_channel: { page: 'communaute', apply: single('stars_channel') },
  birthday_channel: { page: 'communaute', apply: single('birthday_channel') },
  synchro_channel: { page: 'communaute', apply: single('synchro_channel') },
  tickets_channel: { page: 'services', apply: single('tickets_channel') },
  voice_hub: { page: 'services', apply: single('voice_hub') },
  welcome: { page: 'arrivees', apply: single('welcome_channel') },
  gate_min_age: { page: 'arrivees', apply: single('gate_min_age') },
  gate_rules: { page: 'arrivees', apply: (guild, values) => setSettingList(guild.id, 'gate_rules', values) },
  raid_threshold: { page: 'arrivees', apply: single('raid_threshold') },
  moderation: { page: 'securite', apply: (guild, values) => setModerationMode(guild.id, values[0]) },
  log_level: { page: 'logs', apply: single('log_level') },
};

export async function handlePanelInteraction(interaction) {
  const { guild, member } = interaction;
  const field = interaction.customId.slice(PREFIX.length);
  const ephemeral = (content) => interaction.reply({ content: content.slice(0, 2000), flags: MessageFlags.Ephemeral, ...silent });
  if (!isOperator(member)) return ephemeral('Ce panneau est réservé aux opérateurs MAGI.');
  const show = (page) =>
    interaction.message?.flags.has(MessageFlags.Ephemeral) ? interaction.update(panelPage(guild, page, { live: true })) : openPanel(interaction, page);
  const changed = (summary) => {
    log.notice('config', `${summary} par ${member.user.tag}`, { guild });
    refreshPanel(guild).catch(() => {});
  };

  if (field === 'page' || field.startsWith('page:')) {
    const page = field === 'page' ? interaction.values?.[0] : field.slice('page:'.length);
    return PAGES[page] ? show(page) : ephemeral('Page inconnue.');
  }
  if (field.startsWith('module:')) {
    const key = field.slice('module:'.length);
    if (!MODULES[key]) return ephemeral('Module inconnu.');
    const on = !moduleEnabled(guild.id, key);
    setModule(guild.id, key, on);
    if (COMMANDS.some((c) => c.module === key)) await syncCommands(guild).catch((err) => log.err('commandes', `échec enregistrement des commandes : ${err.message}`, { guild }));
    if (key === 'filtre_arrivee') ensureGate(guild).catch((err) => log.err('filtre', `échec mise en place du filtre : ${err.message}`, { guild }));
    await show(pageOf(key));
    return changed(`${MODULES[key]} ${on ? 'activé' : 'coupé'}`);
  }
  if (field.startsWith('persona_ch:')) {
    const persona = field.slice('persona_ch:'.length);
    if (!PERSONAS[persona]) return ephemeral('Persona inconnue.');
    setSettingList(guild.id, `persona_channels:${persona}`, interaction.values ?? []);
    await show('personas');
    return changed(`salons de ${PERSONAS[persona].name} = ${(interaction.values ?? []).map((v) => `<#${v}>`).join(', ') || 'aucun'}`);
  }
  if (APPLY[field]) {
    const { page, apply } = APPLY[field];
    apply(guild, interaction.values ?? []);
    await show(page);
    const values = (interaction.values ?? []).map((v) => (interaction.isChannelSelectMenu?.() ? `<#${v}>` : v));
    return changed(`${FIELD_LABELS[field] ?? field} = ${values.join(', ') || 'aucun'}`);
  }
  if (field === 'audit') return ephemeral(auditReport(guild));
  if (field === 'tickets_post') {
    const posted = await postTicketPanel(guild).catch((err) => err);
    if (posted instanceof Error) return ephemeral(`Impossible : ${posted.message}.`);
    await show('services');
    return changed(`panneau de tickets publié dans ${posted.channel}`);
  }
  if (field === 'voice_hub_create') {
    const hub = await createHub(guild);
    await show('services');
    return changed(`salon générateur ${hub} créé`);
  }
  if (field === 'backup') {
    backupGuild(guild);
    await show('securite');
    return changed('structure sauvegardée');
  }
  if (field === 'honeypot') {
    const reason = `MAGI, demandé par ${member.user.tag}`;
    const existed = Boolean(honeypotOf(guild));
    if (existed) await disableHoneypot(guild, reason);
    else await enableHoneypot(guild, reason);
    await show('securite');
    return changed(existed ? 'honeypot supprimé' : 'honeypot créé');
  }
  return ephemeral('Réglage inconnu.');
}
