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
import { activePersonas, enabledModules, MODULES, mutedChannels, setActivePersonas, setModules, setMutedChannels } from './config.js';
import { installAndReport, isOperator, logChannels, magiCategory, operatorRole } from './installation.js';
import { log } from '../logging/log.js';
import { DISCORD_LEVELS, discordLevel } from '../logging/discord.js';
import { atLeast, currentLevel, inviteUrl, LEVELS } from './permissions.js';

const PREFIX = 'magi-config:';
const PAGES = { modules: 'Modules', salons: 'Salons', logs: 'Logs', securite: 'Sécurité', permissions: 'Permissions' };
const DEFAULT_PAGE = 'modules';
const COLOR = 0xd65c62;
const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum];
const silent = { allowedMentions: { parse: [] } };
const MODE_LABELS = { observation: 'Observation (note sans agir)', active: 'Active (agit)', desactivee: 'Désactivée' };

const id = (field) => PREFIX + field;
const channels = (ids) => (ids.length ? ids.map((c) => `<#${c}>`).join(', ') : 'aucun');
const row = (component) => new ActionRowBuilder().addComponents(component);

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
  const personas = activePersonas(guild.id);
  const { mode } = moderationMode(guild.id);
  const description = [
    ...Object.entries(MODULES).map(([key, label]) => `${enabled.includes(key) ? 'Actif' : 'Coupé'} : ${label}`),
    '',
    `Personas actives : ${personas.map((p) => PERSONAS[p].name).join(', ')}`,
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
          .setCustomId(id('personas'))
          .setPlaceholder('Personas actives')
          .setMinValues(1)
          .setMaxValues(Object.keys(PERSONAS).length)
          .addOptions(Object.entries(PERSONAS).map(([value, p]) => ({ label: p.name, value, default: personas.includes(value) }))),
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
  securite: 'anti-nuke, salon piège, SSH et sudo du VPS',
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

function channelsSection(guild) {
  const muted = mutedChannels(guild.id);
  const interventions = interventionChannels(guild.id);
  const welcome = setting(guild.id, 'welcome_channel');
  const description = [
    `MAGI se tait dans : ${channels(muted)}`,
    `Interventions spontanées autorisées dans : ${channels(interventions)}`,
    `Salon de bienvenue : ${channels(welcome ? [welcome] : [])}`,
  ].join('\n');
  const select = (field, placeholder, defaults, max) => {
    const menu = new ChannelSelectMenuBuilder().setCustomId(id(field)).setPlaceholder(placeholder).setChannelTypes(TEXT_CHANNELS).setMinValues(0).setMaxValues(max);
    if (defaults.length) menu.setDefaultChannels(defaults.slice(0, max));
    return row(menu);
  };
  return {
    description,
    components: [
      select('muted', 'Salons où MAGI se tait', muted, 25),
      select('interventions', 'Salons des interventions spontanées', interventions, 25),
      select('welcome', 'Salon de bienvenue', welcome ? [welcome] : [], 1),
    ],
  };
}

function securitySection(guild) {
  const trap = honeypotOf(guild);
  const backup = latestBackup(guild.id);
  const description = [
    `Salon piège : ${trap ? `${trap}` : 'aucun'}`,
    `Dernière sauvegarde de la structure : ${backup ? `<t:${Math.floor(backup.createdAt / 1000)}:R>` : 'aucune'}`,
    `Anti-nuke : ${enabledModules(guild.id).includes('antinuke') ? 'actif' : 'coupé'}`,
  ].join('\n');
  return {
    description,
    components: [
      row([
        new ButtonBuilder().setCustomId(id('audit')).setLabel('Lancer l’audit').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(id('backup')).setLabel('Sauvegarder maintenant').setStyle(ButtonStyle.Secondary),
        trap
          ? new ButtonBuilder().setCustomId(id('honeypot')).setLabel('Supprimer le salon piège').setStyle(ButtonStyle.Danger)
          : new ButtonBuilder().setCustomId(id('honeypot')).setLabel('Créer le salon piège').setStyle(ButtonStyle.Secondary),
      ]),
    ],
  };
}

const BUILDERS = { modules: modulesSection, salons: channelsSection, logs: logsSection, securite: securitySection, permissions: permissionsSection };

function currentPage(guild) {
  const page = setting(guild.id, 'config_page');
  return PAGES[page] ? page : DEFAULT_PAGE;
}

export function panelPage(guild, name = currentPage(guild)) {
  const { description, components } = BUILDERS[name](guild);
  const names = Object.keys(PAGES);
  const nav = row(
    names.map((page) =>
      new ButtonBuilder()
        .setCustomId(id(`page:${page}`))
        .setLabel(PAGES[page])
        .setStyle(page === name ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(page === name),
    ),
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
  await refreshHoneypot(guild).catch((err) => log.err('honeypot', `échec mise à jour du salon piège : ${err.message}`, { guild }));
  await restylePublications(guild)
    .then((count) => count && log.notice('publications', `${count} publication(s) remise(s) en forme`, { guild }))
    .catch((err) => log.err('publications', `échec remise en forme : ${err.message}`, { guild }));
}

export function isPanelInteraction(customId) {
  return customId.startsWith(PREFIX);
}

const FIELD_LABELS = { modules: 'modules', personas: 'personas', moderation: 'modération', muted: 'salons muets', interventions: 'salons des interventions', welcome: 'salon de bienvenue', log_level: 'niveau des logs' };

const APPLY = {
  modules: { section: 'modules', apply: (guild, values) => setModules(guild.id, values) },
  personas: { section: 'modules', apply: (guild, values) => setActivePersonas(guild.id, values) },
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

  if (field.startsWith('page:')) {
    const page = field.slice('page:'.length);
    if (!PAGES[page]) return ephemeral('Page inconnue.');
    setSetting(guild.id, 'config_page', page);
    return interaction.update(panelPage(guild, page));
  }
  if (APPLY[field]) {
    const { section, apply } = APPLY[field];
    apply(guild, interaction.values ?? []);
    setSetting(guild.id, 'config_page', section);
    await interaction.update(panelPage(guild, section));
    const values = (interaction.values ?? []).map((v) => (interaction.isChannelSelectMenu?.() ? `<#${v}>` : v));
    return changed(`${FIELD_LABELS[field] ?? field} = ${values.join(', ') || 'aucun'}`);
  }
  if (field === 'audit') return ephemeral(auditReport(guild));
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
    return changed(existed ? 'salon piège supprimé' : 'salon piège créé');
  }
  return ephemeral('Réglage inconnu.');
}
