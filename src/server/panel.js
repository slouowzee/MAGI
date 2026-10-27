import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
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
import { activePersonas, enabledModules, MODULES, mutedChannels, OPTIONS, option, setActivePersonas, setModules, setMutedChannels, setSettingList, settingList } from './config.js';
import { installAndReport, isOperator, logChannels, magiCategory, operatorRole } from './installation.js';
import { log } from '../logging/log.js';
import { syncCommands } from '../conversation/commands.js';
import { ensureGate } from '../security/gate.js';
import { postTicketPanel } from '../community/tickets.js';
import { createHub } from '../community/voice.js';
import { DISCORD_LEVELS, discordLevel } from '../logging/discord.js';
import { atLeast, currentLevel, inviteUrl, LEVELS } from './permissions.js';

const PREFIX = 'magi-config:';
const PAGES = {
  modules: 'Modules',
  personas: 'Personas',
  salons: 'Salons',
  communaute: 'Communauté',
  services: 'Services',
  securite: 'Sécurité',
  logs: 'Logs',
  permissions: 'Permissions',
};
const DEFAULT_PAGE = 'modules';
const COLOR = 0xd65c62;
const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum];
const STATE = (on) => (on ? 'actif' : 'coupé');
const silent = { allowedMentions: { parse: [] } };
const MODE_LABELS = { observation: 'Observation (note sans agir)', active: 'Active (agit)', desactivee: 'Désactivée' };

const id = (field) => PREFIX + field;
const channels = (ids) => (ids.length ? ids.map((c) => `<#${c}>`).join(', ') : 'aucun');
const row = (component) => new ActionRowBuilder().addComponents(component);

function channelSelect(field, placeholder, defaults, max, types = TEXT_CHANNELS) {
  const menu = new ChannelSelectMenuBuilder().setCustomId(id(field)).setPlaceholder(placeholder).setChannelTypes(types).setMinValues(0).setMaxValues(max);
  const kept = defaults.filter(Boolean).slice(0, max);
  if (kept.length) menu.setDefaultChannels(kept);
  return row(menu);
}

function choice(guild, field, placeholder, key, label) {
  const current = option(guild.id, key);
  return row(
    new StringSelectMenuBuilder()
      .setCustomId(id(field))
      .setPlaceholder(placeholder)
      .addOptions(OPTIONS[key].values.map((value) => ({ label: label(value), value, default: value === current }))),
  );
}

function permissionsSection(guild) {
  const level = currentLevel(guild.members.me.permissions);
  const lines = [
    `Niveau actuel de MAGI : **${level ? LEVELS[level].label : 'insuffisant'}**`,
    '',
    ...Object.values(LEVELS).map((l) => `**${l.label}** : ${l.text}`),
    '',
    'Clique sur un niveau pour l’accorder : Discord ouvre la page d’autorisation et met à jour le rôle de MAGI.',
  ];
  const buttons = Object.entries(LEVELS).map(([key, l]) => new ButtonBuilder().setLabel(l.label).setStyle(ButtonStyle.Link).setURL(inviteUrl(guild.client.user.id, guild.id, key)));
  return { description: lines.join('\n'), components: [row(buttons)] };
}

function modulesSection(guild) {
  const enabled = enabledModules(guild.id);
  const { mode } = moderationMode(guild.id);
  const description = [
    ...Object.entries(MODULES).map(([key, label]) => `${enabled.includes(key) ? 'Actif' : 'Coupé'} : ${label}`),
    '',
    `Modération automatique : ${MODE_LABELS[mode]}`,
  ].join('\n');
  return {
    description,
    components: [
      row(
        new StringSelectMenuBuilder()
          .setCustomId(id('modules'))
          .setPlaceholder('Modules actifs')
          .setMinValues(0)
          .setMaxValues(Object.keys(MODULES).length)
          .addOptions(Object.entries(MODULES).map(([value, label]) => ({ label, value, default: enabled.includes(value) }))),
      ),
      row(
        new StringSelectMenuBuilder()
          .setCustomId(id('moderation'))
          .setPlaceholder('Modération automatique')
          .addOptions(MODES.map((value) => ({ label: MODE_LABELS[value], value, default: value === mode }))),
      ),
    ],
  };
}

const LOG_PURPOSES = {
  logs: 'outils, configuration, installation, arrivées et départs, rappels',
  moderation: 'décisions de la modération automatique',
  securite: 'anti-nuke, honeypot, SSH et sudo du VPS',
  systeme: 'démarrage, Gemini, erreurs, journal du VPS',
};

function logsSection(guild) {
  const level = discordLevel(guild.id);
  const targets = logChannels(guild);
  const description = [
    ...Object.entries(LOG_PURPOSES).map(([source, purpose]) => `${targets[source] ?? 'salon manquant'} : ${purpose}`),
    '',
    `Niveau minimal : **${level}** et au-dessus (${DISCORD_LEVELS[level].toLowerCase()})`,
    'Les alertes qui mentionnent passent quel que soit le niveau.',
  ].join('\n');
  return {
    description,
    components: [
      row(
        new StringSelectMenuBuilder()
          .setCustomId(id('log_level'))
          .setPlaceholder('Niveau minimal des logs Discord')
          .addOptions(Object.entries(DISCORD_LEVELS).map(([value, label]) => ({ label: `${value} : ${label}`, value, default: value === level }))),
      ),
    ],
  };
}

function personasSection(guild) {
  const personas = activePersonas(guild.id);
  const description = [
    `Personas actives : ${personas.map((p) => PERSONAS[p].name).join(', ')}`,
    '',
    'Persona par défaut quand on écrit « magi, … » dans ces salons :',
    ...Object.entries(PERSONAS).map(([key, p]) => `${p.name} : ${channels(settingList(guild.id, `persona_channels:${key}`))}`),
  ].join('\n');
  return {
    description,
    components: [
      row(
        new StringSelectMenuBuilder()
          .setCustomId(id('personas'))
          .setPlaceholder('Personas actives')
          .setMinValues(1)
          .setMaxValues(Object.keys(PERSONAS).length)
          .addOptions(Object.entries(PERSONAS).map(([value, p]) => ({ label: p.name, value, default: personas.includes(value) }))),
      ),
      ...Object.entries(PERSONAS).map(([key, p]) => channelSelect(`persona_ch:${key}`, `Salons de ${p.name}`, settingList(guild.id, `persona_channels:${key}`), 25)),
    ],
  };
}

function communitySection(guild) {
  const enabled = enabledModules(guild.id);
  const description = [
    `Mur des étoiles : ${STATE(enabled.includes('etoiles'))}, ${option(guild.id, 'stars_threshold')} ⭐ pour entrer, salon ${channels([setting(guild.id, 'stars_channel')].filter(Boolean))}`,
    `Anniversaires : ${STATE(enabled.includes('anniversaires'))}, salon ${channels([setting(guild.id, 'birthday_channel')].filter(Boolean))}`,
    `Taux de synchronisation : ${STATE(enabled.includes('synchro'))}, annonces dans ${channels([setting(guild.id, 'synchro_channel')].filter(Boolean))}`,
    `Sondages : ${STATE(enabled.includes('sondages'))} · Événements : ${STATE(enabled.includes('evenements'))} · Débats : ${STATE(enabled.includes('debat'))}`,
    'Les rôles de palier de synchronisation se règlent en demandant à MAGI (« magi, donne le rôle Pilote à 50 % de synchro »).',
  ].join('\n');
  return {
    description,
    components: [
      choice(guild, 'stars_threshold', 'Étoiles nécessaires', 'stars_threshold', (v) => `${v} ⭐`),
      channelSelect('stars_channel', 'Salon du mur des étoiles', [setting(guild.id, 'stars_channel')], 1),
      channelSelect('birthday_channel', 'Salon des anniversaires', [setting(guild.id, 'birthday_channel')], 1),
      channelSelect('synchro_channel', 'Salon des annonces de synchronisation', [setting(guild.id, 'synchro_channel')], 1),
    ],
  };
}

function servicesSection(guild) {
  const enabled = enabledModules(guild.id);
  const description = [
    `Tickets : ${STATE(enabled.includes('tickets'))}, panneau dans ${channels([setting(guild.id, 'tickets_channel')].filter(Boolean))}`,
    `Salons vocaux temporaires : ${STATE(enabled.includes('vocal_temporaire'))}, salon générateur ${channels([setting(guild.id, 'voice_hub')].filter(Boolean))}`,
    '',
    "Rejoindre le salon générateur crée un salon vocal à ton nom, supprimé dès qu'il est vide.",
  ].join('\n');
  return {
    description,
    components: [
      channelSelect('tickets_channel', 'Salon du panneau de tickets', [setting(guild.id, 'tickets_channel')], 1),
      channelSelect('voice_hub', 'Salon vocal générateur', [setting(guild.id, 'voice_hub')], 1, [ChannelType.GuildVoice]),
      row([
        new ButtonBuilder().setCustomId(id('tickets_post')).setLabel('Publier le panneau de tickets').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(id('voice_hub_create')).setLabel('Créer le salon générateur').setStyle(ButtonStyle.Secondary),
      ]),
    ],
  };
}

function channelsSection(guild) {
  const muted = mutedChannels(guild.id);
  const interventions = interventionChannels(guild.id);
  const welcome = setting(guild.id, 'welcome_channel');
  const description = [
    `MAGI se tait dans : ${channels(muted)}`,
    `Interventions spontanées autorisées dans : ${channels(interventions)}`,
    `Salon de bienvenue : ${channels(welcome ? [welcome] : [])}`,
  ].join('\n');
  return {
    description,
    components: [
      channelSelect('muted', 'Salons où MAGI se tait', muted, 25),
      channelSelect('interventions', 'Salons des interventions spontanées', interventions, 25),
      channelSelect('welcome', 'Salon de bienvenue', [welcome], 1),
    ],
  };
}

function securitySection(guild) {
  const trap = honeypotOf(guild);
  const backup = latestBackup(guild.id);
  const enabled = enabledModules(guild.id);
  const rules = settingList(guild.id, 'gate_rules');
  const description = [
    `Honeypot : ${trap ? `${trap}` : 'aucun'}`,
    `Dernière sauvegarde de la structure : ${backup ? `<t:${Math.floor(backup.createdAt / 1000)}:R>` : 'aucune'}`,
    `Anti-nuke : ${STATE(enabled.includes('antinuke'))}`,
    `Filtre à l'arrivée : ${STATE(enabled.includes('filtre_arrivee'))}, comptes de moins de ${option(guild.id, 'gate_min_age')} jour(s)${rules.includes('avatar') ? ', sans avatar' : ''}${rules.includes('tous') ? ', ou tous les nouveaux' : ''}`,
    `Anti-raid : ${STATE(enabled.includes('anti_raid'))}, verrouillage à ${option(guild.id, 'raid_threshold')} arrivées par minute`,
  ].join('\n');
  return {
    description,
    components: [
      row([
        new ButtonBuilder().setCustomId(id('audit')).setLabel('Lancer l’audit').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(id('backup')).setLabel('Sauvegarder maintenant').setStyle(ButtonStyle.Secondary),
        trap
          ? new ButtonBuilder().setCustomId(id('honeypot')).setLabel('Supprimer le honeypot').setStyle(ButtonStyle.Danger)
          : new ButtonBuilder().setCustomId(id('honeypot')).setLabel('Créer le honeypot').setStyle(ButtonStyle.Secondary),
      ]),
      choice(guild, 'gate_min_age', "Filtre : âge minimal du compte", 'gate_min_age', (v) => (v === '0' ? "Pas de critère d'âge" : `Comptes de moins de ${v} jour(s)`)),
      row(
        new StringSelectMenuBuilder()
          .setCustomId(id('gate_rules'))
          .setPlaceholder('Filtre : autres critères')
          .setMinValues(0)
          .setMaxValues(2)
          .addOptions([
            { label: 'Comptes sans avatar', value: 'avatar', default: rules.includes('avatar') },
            { label: 'Tous les nouveaux membres', value: 'tous', default: rules.includes('tous') },
          ]),
      ),
      choice(guild, 'raid_threshold', 'Anti-raid : seuil', 'raid_threshold', (v) => `Verrouiller à ${v} arrivées par minute`),
    ],
  };
}

const BUILDERS = {
  modules: modulesSection,
  personas: personasSection,
  salons: channelsSection,
  communaute: communitySection,
  services: servicesSection,
  securite: securitySection,
  logs: logsSection,
  permissions: permissionsSection,
};

function currentPage(guild) {
  const page = setting(guild.id, 'config_page');
  return PAGES[page] ? page : DEFAULT_PAGE;
}

export function panelPage(guild, name = currentPage(guild)) {
  const { description, components } = BUILDERS[name](guild);
  const names = Object.keys(PAGES);
  const nav = row(
    new StringSelectMenuBuilder()
      .setCustomId(id('page'))
      .setPlaceholder('Page')
      .addOptions(names.map((page) => ({ label: PAGES[page], value: page, default: page === name }))),
  );
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`Configuration de MAGI · ${PAGES[name]}`)
    .setDescription(description)
    .setFooter({ text: `Page ${names.indexOf(name) + 1}/${names.length}` });
  return { embeds: [embed], components: [nav, ...components] };
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
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      ...(role ? [{ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] }] : []),
      { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
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
  if (message && !repost) {
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
  modules: 'modules',
  personas: 'personas',
  moderation: 'modération',
  muted: 'salons muets',
  interventions: 'salons des interventions',
  welcome: 'salon de bienvenue',
  log_level: 'niveau des logs',
  stars_threshold: 'étoiles nécessaires',
  stars_channel: 'salon du mur des étoiles',
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
  modules: { section: 'modules', apply: (guild, values) => setModules(guild.id, values) },
  personas: { section: 'personas', apply: (guild, values) => setActivePersonas(guild.id, values) },
  stars_threshold: { section: 'communaute', apply: single('stars_threshold') },
  stars_channel: { section: 'communaute', apply: single('stars_channel') },
  birthday_channel: { section: 'communaute', apply: single('birthday_channel') },
  synchro_channel: { section: 'communaute', apply: single('synchro_channel') },
  tickets_channel: { section: 'services', apply: single('tickets_channel') },
  voice_hub: { section: 'services', apply: single('voice_hub') },
  gate_min_age: { section: 'securite', apply: single('gate_min_age') },
  gate_rules: { section: 'securite', apply: (guild, values) => setSettingList(guild.id, 'gate_rules', values) },
  raid_threshold: { section: 'securite', apply: single('raid_threshold') },
  moderation: { section: 'modules', apply: (guild, values) => setModerationMode(guild.id, values[0]) },
  muted: { section: 'salons', apply: (guild, values) => setMutedChannels(guild.id, values) },
  interventions: { section: 'salons', apply: (guild, values) => replaceInterventions(guild.id, values) },
  welcome: { section: 'salons', apply: (guild, values) => setSetting(guild.id, 'welcome_channel', values[0] ?? null) },
  log_level: { section: 'logs', apply: (guild, values) => setSetting(guild.id, 'log_level', values[0] ?? null) },
};

export async function handlePanelInteraction(interaction) {
  const { guild, member } = interaction;
  const field = interaction.customId.slice(PREFIX.length);
  const ephemeral = (content) => interaction.reply({ content: content.slice(0, 2000), flags: MessageFlags.Ephemeral, ...silent });
  if (!isOperator(member)) return ephemeral('Ce panneau est réservé aux opérateurs MAGI.');
  const changed = (text) => log.notice('config', `${text} par ${member.user.tag}`, { guild });

  if (field === 'page' || field.startsWith('page:')) {
    const page = field === 'page' ? interaction.values?.[0] : field.slice('page:'.length);
    if (!PAGES[page]) return ephemeral('Page inconnue.');
    setSetting(guild.id, 'config_page', page);
    return interaction.update(panelPage(guild, page));
  }
  if (field.startsWith('persona_ch:')) {
    const persona = field.slice('persona_ch:'.length);
    if (!PERSONAS[persona]) return ephemeral('Persona inconnue.');
    setSettingList(guild.id, `persona_channels:${persona}`, interaction.values ?? []);
    await interaction.update(panelPage(guild, 'personas'));
    return changed(`salons de ${PERSONAS[persona].name} = ${(interaction.values ?? []).map((v) => `<#${v}>`).join(', ') || 'aucun'}`);
  }
  if (APPLY[field]) {
    const { section, apply } = APPLY[field];
    apply(guild, interaction.values ?? []);
    if (field === 'modules') {
      await syncCommands(guild).catch((err) => log.err('commandes', `échec enregistrement des commandes : ${err.message}`, { guild }));
      ensureGate(guild).catch((err) => log.err('filtre', `échec mise en place du filtre : ${err.message}`, { guild }));
    }
    setSetting(guild.id, 'config_page', section);
    await interaction.update(panelPage(guild, section));
    const values = (interaction.values ?? []).map((v) => (interaction.isChannelSelectMenu?.() ? `<#${v}>` : v));
    return changed(`${FIELD_LABELS[field] ?? field} = ${values.join(', ') || 'aucun'}`);
  }
  if (field === 'audit') return ephemeral(auditReport(guild));
  if (field === 'tickets_post') {
    const posted = await postTicketPanel(guild).catch((err) => err);
    if (posted instanceof Error) return ephemeral(`Impossible : ${posted.message}.`);
    await interaction.update(panelPage(guild, 'services'));
    return changed(`panneau de tickets publié dans ${posted.channel}`);
  }
  if (field === 'voice_hub_create') {
    const hub = await createHub(guild);
    await interaction.update(panelPage(guild, 'services'));
    return changed(`salon générateur ${hub} créé`);
  }
  if (field === 'backup') {
    backupGuild(guild);
    await interaction.update(panelPage(guild, 'securite'));
    return changed('structure sauvegardée');
  }
  if (field === 'honeypot') {
    const reason = `MAGI, demandé par ${member.user.tag}`;
    const existed = Boolean(honeypotOf(guild));
    if (existed) await disableHoneypot(guild, reason);
    else await enableHoneypot(guild, reason);
    await interaction.update(panelPage(guild, 'securite'));
    return changed(existed ? 'honeypot supprimé' : 'honeypot créé');
  }
  return ephemeral('Réglage inconnu.');
}
