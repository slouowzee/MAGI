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
import { disableHoneypot, enableHoneypot, honeypotOf } from '../security/honeypot.js';
import { latestBackup } from '../storage/backups.js';
import { interventionChannels, replaceInterventions } from '../storage/interventions.js';
import { MODES, moderationMode, setModerationMode } from '../storage/moderation.js';
import { setSetting, setting } from '../storage/settings.js';
import { activePersonas, enabledModules, MODULES, mutedChannels, setActivePersonas, setModules, setMutedChannels } from './config.js';
import { installAndReport, isOperator, logChannel, operatorRole } from './installation.js';
import { atLeast, currentLevel, inviteUrl, LEVELS } from './permissions.js';

const PREFIX = 'magi-config:';
const SECTIONS = ['permissions', 'modules', 'salons', 'securite'];
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
  return { embeds: [new EmbedBuilder().setColor(COLOR).setTitle('Permissions').setDescription(lines.join('\n'))], components: [row(buttons)] };
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
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle('Modules et personas').setDescription(description)],
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
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle('Salons').setDescription(description)],
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
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle('Sécurité').setDescription(description)],
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

const BUILDERS = { permissions: permissionsSection, modules: modulesSection, salons: channelsSection, securite: securitySection };

export function panelSection(guild, name) {
  return BUILDERS[name](guild);
}

function configChannel(guild) {
  return guild.channels.cache.get(setting(guild.id, 'config_channel')) ?? null;
}

async function ensureConfigChannel(guild) {
  const existing = configChannel(guild);
  if (existing) return existing;
  const role = operatorRole(guild);
  const channel = await guild.channels.create({
    name: 'magi-config',
    type: ChannelType.GuildText,
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
  const ids = JSON.parse(setting(guild.id, 'config_panel') ?? '{}');
  const next = {};
  for (const name of SECTIONS) {
    const old = ids[name] ? await channel.messages.fetch(ids[name]).catch(() => null) : null;
    if (old && !repost) {
      await old.edit(panelSection(guild, name));
      next[name] = old.id;
      continue;
    }
    await old?.delete().catch(() => {});
    next[name] = (await channel.send({ ...panelSection(guild, name), ...silent })).id;
  }
  setSetting(guild.id, 'config_panel', JSON.stringify(next));
  return channel;
}

export async function setupGuild(guild) {
  await installAndReport(guild);
  await refreshPanel(guild).catch((err) => console.error(`[${guild.name}] panneau de config impossible :`, err.message));
}

export function isPanelInteraction(customId) {
  return customId.startsWith(PREFIX);
}

const APPLY = {
  modules: { section: 'modules', apply: (guild, values) => setModules(guild.id, values) },
  personas: { section: 'modules', apply: (guild, values) => setActivePersonas(guild.id, values) },
  moderation: { section: 'modules', apply: (guild, values) => setModerationMode(guild.id, values[0]) },
  muted: { section: 'salons', apply: (guild, values) => setMutedChannels(guild.id, values) },
  interventions: { section: 'salons', apply: (guild, values) => replaceInterventions(guild.id, values) },
  welcome: { section: 'salons', apply: (guild, values) => setSetting(guild.id, 'welcome_channel', values[0] ?? null) },
};

export async function handlePanelInteraction(interaction) {
  const { guild, member } = interaction;
  const field = interaction.customId.slice(PREFIX.length);
  const ephemeral = (content) => interaction.reply({ content: content.slice(0, 2000), flags: MessageFlags.Ephemeral, ...silent });
  if (!isOperator(member)) return ephemeral('Ce panneau est réservé aux opérateurs MAGI.');
  const log = (text) => logChannel(guild)?.send({ content: `Configuration : ${text} (par ${member}).`, ...silent }).catch(() => {});

  if (APPLY[field]) {
    const { section, apply } = APPLY[field];
    apply(guild, interaction.values ?? []);
    await interaction.update(panelSection(guild, section));
    return log(`${field} → ${(interaction.values ?? []).join(', ') || 'aucun'}`);
  }
  if (field === 'audit') return ephemeral(auditReport(guild));
  if (field === 'backup') {
    backupGuild(guild);
    await interaction.update(panelSection(guild, 'securite'));
    return log('structure sauvegardée');
  }
  if (field === 'honeypot') {
    const reason = `MAGI, demandé par ${member.user.tag}`;
    const existed = Boolean(honeypotOf(guild));
    if (existed) await disableHoneypot(guild, reason);
    else await enableHoneypot(guild, reason);
    await interaction.update(panelSection(guild, 'securite'));
    return log(existed ? 'salon piège supprimé' : 'salon piège créé');
  }
  return ephemeral('Réglage inconnu.');
}
