import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits as P,
  StringSelectMenuBuilder,
} from 'discord.js';
import { PERSONAS } from '../core/personas.js';
import { auditReport } from '../features/security/audit.js';
import { backupGuild } from '../features/security/backup.js';
import { disableHoneypot, enableHoneypot, honeypotOf, refreshHoneypot } from '../features/security/honeypot.js';
import { restylePublications } from '../features/admin/publications.js';
import { replaceInterventions } from '../features/conversation/interventions.js';
import { setModerationMode } from '../features/moderation/store.js';
import { setSetting, setting } from '../core/settings.js';
import { moduleEnabled, MODULES, setActivePersonas, setModule, setSettingList } from '../core/config.js';
import { installAndReport, isOperator, magiCategory, operatorRole } from '../core/installation.js';
import { log } from '../core/log/log.js';
import { COMMANDS, syncCommands } from '../features/commands/commands.js';
import { ensureGate } from '../features/security/gate.js';
import { automodAllowList, setAutomodAllowList, setAutomodRules, syncAutomod } from '../features/security/automod.js';
import { postTicketPanel } from '../features/community/tickets.js';
import { createHub } from '../features/community/voice.js';
import { atLeast } from '../core/permissions.js';
import { PREFIX, PAGES, id, row, text, separator, pageOf } from './ui.js';
import { homeSection } from './pages/accueil.js';
import { conversationSection } from './pages/conversation.js';
import { statusSection } from './pages/statut.js';
import { personasSection } from './pages/personas.js';
import { communitySection } from './pages/communaute.js';
import { servicesSection } from './pages/services.js';
import { arrivalsSection } from './pages/arrivees.js';
import { securitySection } from './pages/securite.js';
import { automodSection } from './pages/automod.js';
import { serverSection } from './pages/serveur.js';
import { SERVER_ACTIONS } from './server-actions.js';
import { parseEmoji } from '../features/community/hall-of-fame.js';
import { milestoneMessages, orderMilestoneRoles, paliers, setMilestone } from '../features/community/synchro.js';
import { logsSection } from './pages/logs.js';
import { permissionsSection } from './pages/permissions.js';
import { repliesSection } from './pages/reponses.js';
import { forgetExample } from '../features/conversation/examples.js';
import { debugActive, debugBlocks } from '../features/debug/console.js';
import { COLOR } from '../core/discord/embeds.js';

const DEBUG_COLOR = 0xef9f27;
const V2 = MessageFlags.IsComponentsV2;

const silent = { allowedMentions: { parse: [] } };

const BUILDERS = {
  accueil: homeSection,
  conversation: conversationSection,
  statut: statusSection,
  personas: personasSection,
  reponses: repliesSection,
  communaute: communitySection,
  services: servicesSection,
  arrivees: arrivalsSection,
  securite: securitySection,
  automod: automodSection,
  serveur: serverSection,
  logs: logsSection,
  permissions: permissionsSection,
  debug: debugBlocks,
};

const pagesFor = (guild) => Object.keys(PAGES).filter((page) => page !== 'debug' || debugActive(guild.id));

function navigation(name, names) {
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

export function panelPage(guild, page = setting(guild.id, 'config_page') ?? 'accueil') {
  const names = pagesFor(guild);
  const name = names.includes(page) ? page : 'accueil';
  const debug = debugActive(guild.id);
  const title = name === 'accueil' ? 'Configuration de MAGI' : PAGES[name];
  const header = text(`## ${title}\n-# Page ${names.indexOf(name) + 1}/${names.length}`);
  const blocks = [header, separator(), ...BUILDERS[name](guild), separator(), ...navigation(name, names)];
  return { components: [new ContainerBuilder({ accent_color: debug ? DEBUG_COLOR : COLOR, components: blocks.map((b) => b.toJSON()) })], flags: V2 };
}

export function showPage(interaction, page) {
  setSetting(interaction.guild.id, 'config_page', page === 'accueil' ? null : page);
  return interaction.update(panelPage(interaction.guild, page));
}

export async function openPanel(interaction) {
  const { guild } = interaction;
  const refuse = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, ...silent });
  if (!isOperator(interaction.member)) return refuse("Tu n'as pas les droits : le panneau de configuration est réservé aux opérateurs MAGI.");
  const channel = setting(guild.id, 'config_channel');
  if (channel && interaction.channelId !== channel) return refuse(`Le panneau se trouve dans <#${channel}> : lance \`/magi config\` là-bas pour le republier.`);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  setSetting(guild.id, 'config_page', null);
  await refreshPanel(guild, { repost: true });
  return interaction.deleteReply();
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
  await resyncAutomod(guild);
  await orderMilestoneRoles(guild).catch((err) => log.err('synchro', `échec du rangement des rôles de palier : ${err.message}`, { guild }));
  await restylePublications(guild)
    .then((count) => count && log.notice('publications', `${count} publication${count > 1 ? 's' : ''} remise${count > 1 ? 's' : ''} au nouveau style`, { guild }))
    .catch((err) => log.err('publications', `échec remise en forme : ${err.message}`, { guild }));
}

function milestoneModal(guild, threshold) {
  const current = milestoneMessages(guild.id)[threshold] ?? '';
  const role = paliers(guild.id)[threshold];
  return new ModalBuilder()
    .setCustomId(id(`synchro_palier_set:${threshold}`))
    .setTitle(`Palier de synchronisation ${threshold} %`)
    .addLabelComponents((l) =>
      l
        .setLabel('Message d’annonce (vide = par défaut)')
        .setDescription('{membre} et {taux} sont remplacés. Melchior le poste sous le message, 30 s.')
        .setTextInputComponent((t) => {
          t.setCustomId('message').setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(false).setPlaceholder(`Taux de synchronisation : ${threshold} %.`);
          if (current) t.setValue(current);
          return t;
        }),
    )
    .addLabelComponents((l) =>
      l.setLabel('Rôle donné à ce palier (vide = aucun)').setRoleSelectMenuComponent((r) => {
        r.setCustomId('role').setRequired(false).setMaxValues(1);
        if (role) r.setDefaultRoles(role);
        return r;
      }),
    );
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
  tickets_channel: 'salon des tickets',
  voice_hub: 'salon vocal générateur',
  gate_min_age: 'âge minimal à l’arrivée',
  gate_rules: 'critères du filtre',
  raid_threshold: 'seuil anti-raid',
  automod_presets: 'filtres AutoMod',
  presence_items: 'infos du statut',
  presence_night: 'veille la nuit',
  presence_idle: 'veille sans messages',
  server_style: 'style du serveur',
  server_mode: 'mode de mise en place',
  server_sep: 'séparateur',
  server_case: 'casse',
  server_decor: 'décor des catégories',
  server_naming: 'options de nommage',
  server_features: 'éléments à mettre en place',
  automod_rules: 'règles AutoMod',
  automod_mentions: 'mentions AutoMod',
};
const single = (key) => (guild, values) => setSetting(guild.id, key, values[0] ?? null);
const resyncAutomod = (guild) => syncAutomod(guild).catch((err) => log.err('automod', `échec synchronisation : ${err.message}`, { guild }));

const APPLY = {
  personas: { page: 'personas', apply: (guild, values) => setActivePersonas(guild.id, values) },
  muted: { page: 'personas', apply: (guild, values) => setSettingList(guild.id, 'muted_channels', values) },
  interventions: { page: 'conversation', apply: (guild, values) => replaceInterventions(guild.id, values) },
  stars_threshold: { page: 'communaute', apply: single('stars_threshold') },
  stars_channel: { page: 'communaute', apply: single('stars_channel') },
  birthday_channel: { page: 'communaute', apply: single('birthday_channel') },
  tickets_channel: { page: 'services', apply: single('tickets_channel') },
  voice_hub: { page: 'services', apply: single('voice_hub') },
  welcome: { page: 'arrivees', apply: single('welcome_channel') },
  gate_min_age: { page: 'arrivees', apply: single('gate_min_age') },
  gate_rules: { page: 'arrivees', apply: (guild, values) => setSettingList(guild.id, 'gate_rules', values) },
  raid_threshold: { page: 'arrivees', apply: single('raid_threshold') },
  moderation: { page: 'securite', apply: (guild, values) => setModerationMode(guild.id, values[0]) },
  automod_presets: { page: 'automod', apply: (guild, values) => setSettingList(guild.id, 'automod_presets', values) },
  automod_rules: { page: 'automod', apply: (guild, values) => setAutomodRules(guild.id, values) },
  automod_mentions: { page: 'automod', apply: single('automod_mentions') },
  log_level: { page: 'logs', apply: single('log_level') },
  presence_items: { page: 'statut', apply: (guild, values) => setSettingList(guild.id, 'presence_items', values) },
  presence_night: { page: 'statut', apply: single('presence_night') },
  presence_idle: { page: 'statut', apply: single('presence_idle') },
  server_style: { page: 'serveur', apply: single('server_style') },
  server_mode: { page: 'serveur', apply: single('server_mode') },
  server_sep: { page: 'serveur', apply: single('server_sep') },
  server_case: { page: 'serveur', apply: single('server_case') },
  server_decor: { page: 'serveur', apply: single('server_decor') },
  server_naming: {
    page: 'serveur',
    apply: (guild, values) => {
      setSetting(guild.id, 'server_emoji', values.includes('emoji') ? 'oui' : 'non');
      setSetting(guild.id, 'server_lang', values.includes('en') ? 'en' : 'fr');
    },
  },
  server_features: { page: 'serveur', apply: (guild, values) => setSetting(guild.id, 'server_features', values.join(',') || 'aucune') },
};

const NOT_EMOJI = 'Ce n\u2019est pas un emoji : colle un emoji, ou un emoji du serveur sous la forme <:nom:id> (tape \\:nom: dans Discord pour l\u2019obtenir).';

const pickEmoji = (field, page, title, summary) => async ({ interaction, guild, show, changed }) => {
  const value = interaction.values?.[0];
  if (value === 'autre') {
    const input = new TextInputBuilder().setCustomId('emoji').setLabel('Emoji, ou emoji du serveur <:nom:id>').setStyle(TextInputStyle.Short).setMaxLength(60).setRequired(true);
    return interaction.showModal(new ModalBuilder().setCustomId(id(`${field}_set`)).setTitle(title).addComponents(row(input)));
  }
  if (value !== 'actuel') setSetting(guild.id, field, value);
  await show(page);
  return value === 'actuel' ? null : changed(summary(value));
};

const saveEmoji = (field, page, summary) => async ({ interaction, guild, show, changed, ephemeral }) => {
  const emoji = parseEmoji(interaction.fields.getTextInputValue('emoji'));
  if (!emoji) return ephemeral(NOT_EMOJI);
  setSetting(guild.id, field, emoji);
  await show(page);
  return changed(summary(emoji));
};

const forget = (summary) => async ({ interaction, guild, show, changed }) => {
  const removed = forgetExample(guild.id, Number(interaction.values?.[0]));
  await show('reponses');
  return removed ? changed(summary) : null;
};

const goodEmojiSummary = (value) => `emoji de la banque d'exemples (ajout) = ${value}`;
const badEmojiSummary = (value) => `emoji de la banque d'exemples (retrait) = ${value}`;
const starsEmojiSummary = (value) => `emoji du Hall of Fame = ${value}`;

const FIELD_ACTIONS = {
  __proto__: null,
  examples_good: pickEmoji('examples_good', 'reponses', 'Emoji pour ajouter une r\u00E9ponse', goodEmojiSummary),
  examples_bad: pickEmoji('examples_bad', 'reponses', 'Emoji pour retirer une r\u00E9ponse', badEmojiSummary),
  examples_good_set: saveEmoji('examples_good', 'reponses', goodEmojiSummary),
  examples_bad_set: saveEmoji('examples_bad', 'reponses', badEmojiSummary),
  stars_emoji: pickEmoji('stars_emoji', 'communaute', 'Emoji du Hall of Fame', starsEmojiSummary),
  stars_emoji_set: saveEmoji('stars_emoji', 'communaute', starsEmojiSummary),
  tone_forget: forget('message retir\u00E9 du ton du serveur'),
  examples_forget: forget('r\u00E9ponse retir\u00E9e de la banque d\u2019exemples'),
  synchro_palier({ interaction, guild }) {
    interaction.message?.edit(panelPage(guild)).catch(() => {});
    return interaction.showModal(milestoneModal(guild, interaction.values?.[0]));
  },
  async digest({ guild, show, changed }) {
    const on = setting(guild.id, 'digest') === 'off';
    setSetting(guild.id, 'digest', on ? 'on' : 'off');
    await show('logs');
    return changed(`résumé quotidien ${on ? 'activé' : 'coupé'}`);
  },
  automod_allow({ interaction, guild }) {
    const input = new TextInputBuilder().setCustomId('mots').setLabel('Un mot ou une expression par ligne').setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(false);
    const current = automodAllowList(guild.id).join('\n');
    if (current) input.setValue(current);
    return interaction.showModal(new ModalBuilder().setCustomId(id('automod_allow_set')).setTitle('Liste blanche AutoMod').addComponents(row(input)));
  },
  async automod_allow_set({ interaction, guild, show, changed }) {
    const words = setAutomodAllowList(guild.id, interaction.fields.getTextInputValue('mots'));
    resyncAutomod(guild);
    await show('automod');
    return changed(`liste blanche AutoMod = ${words.length} mot(s)`);
  },
  audit: ({ guild, ephemeral }) => ephemeral(auditReport(guild)),
  async tickets_post({ guild, show, changed, ephemeral }) {
    const posted = await postTicketPanel(guild).catch((err) => err);
    if (posted instanceof Error) return ephemeral(`Impossible : ${posted.message}.`);
    await show('services');
    return changed(`panneau de tickets publié dans ${posted.channel}`);
  },
  async voice_hub_create({ guild, show, changed }) {
    const hub = await createHub(guild);
    await show('services');
    return changed(`salon générateur ${hub} créé`);
  },
  async backup({ guild, show, changed }) {
    backupGuild(guild);
    await show('securite');
    return changed('structure sauvegard\u00E9e');
  },
  async honeypot({ guild, member, show, changed }) {
    const reason = `MAGI, demandé par ${member.user.tag}`;
    const existed = Boolean(honeypotOf(guild));
    if (existed) await disableHoneypot(guild, reason);
    else await enableHoneypot(guild, reason);
    resyncAutomod(guild);
    await show('securite');
    return changed(existed ? 'honeypot supprim\u00E9' : 'honeypot cr\u00E9\u00E9');
  },
};

const PREFIXED_ACTIONS = {
  async 'synchro_palier_set:'({ interaction, guild, show, changed, ephemeral }, rest) {
    const threshold = Number(rest);
    const message = interaction.fields.getTextInputValue('message');
    const roleId = interaction.fields.getSelectedRoles('role', false)?.first()?.id ?? null;
    try {
      setMilestone(guild, threshold, { message, roleId });
    } catch (err) {
      return ephemeral(`Impossible : ${err.message}.`);
    }
    orderMilestoneRoles(guild).catch((err) => log.err('synchro', `échec du rangement des rôles de palier : ${err.message}`, { guild }));
    await show('communaute');
    return changed(`palier ${threshold} % : ${roleId ? `<@&${roleId}>` : 'sans rôle'}, ${message.trim() ? 'message perso' : 'message par défaut'}`);
  },
  async 'module:'({ guild, show, changed, ephemeral }, key) {
    if (!MODULES[key]) return ephemeral('Module inconnu.');
    const on = !moduleEnabled(guild.id, key);
    setModule(guild.id, key, on);
    if (COMMANDS.some((c) => c.module === key)) await syncCommands(guild).catch((err) => log.err('commandes', `échec enregistrement des commandes : ${err.message}`, { guild }));
    if (key === 'automod') resyncAutomod(guild);
    if (key === 'filtre_arrivee') ensureGate(guild).catch((err) => log.err('filtre', `échec mise en place du filtre : ${err.message}`, { guild }));
    await show(pageOf(key));
    return changed(`${MODULES[key]} ${on ? 'activé' : 'coupé'}`);
  },
  async 'persona_ch:'({ interaction, guild, show, changed, ephemeral }, persona) {
    if (!PERSONAS[persona]) return ephemeral('Persona inconnue.');
    const values = interaction.values ?? [];
    setSettingList(guild.id, `persona_channels:${persona}`, values);
    await show('personas');
    return changed(`salons de ${PERSONAS[persona].name} = ${values.map((v) => `<#${v}>`).join(', ') || 'aucun'}`);
  },
};

async function applyField({ interaction, guild, show, changed }, field) {
  const { page, apply } = APPLY[field];
  apply(guild, interaction.values ?? []);
  if (field.startsWith('automod_')) resyncAutomod(guild);
  await show(page);
  const values = (interaction.values ?? []).map((v) => (interaction.isChannelSelectMenu?.() ? `<#${v}>` : v));
  return changed(`${FIELD_LABELS[field] ?? field} = ${values.join(', ') || 'aucun'}`);
}

export async function handlePanelInteraction(interaction) {
  const { guild, member } = interaction;
  const field = interaction.customId.slice(PREFIX.length);
  const ephemeral = (content) => interaction.reply({ content: content.slice(0, 2000), flags: MessageFlags.Ephemeral, ...silent });
  if (!isOperator(member)) return ephemeral('Ce panneau est r\u00E9serv\u00E9 aux op\u00E9rateurs MAGI.');
  const show = (page) => showPage(interaction, page);
  const changed = (summary) => log.notice('config', `${summary} par ${member.displayName}`, { guild });
  const ctx = { interaction, guild, member, ephemeral, show, changed };
  if (field === 'page' || field.startsWith('page:') || field.startsWith('goto:')) {
    const page = field === 'page' ? interaction.values?.[0] : field.split(':')[1];
    return pagesFor(guild).includes(page) ? show(page) : ephemeral(PAGES[page] ? 'Cette page n\u2019est pas disponible.' : 'Page inconnue.');
  }
  if (SERVER_ACTIONS[field]) return SERVER_ACTIONS[field](interaction);
  if (FIELD_ACTIONS[field]) return FIELD_ACTIONS[field](ctx);
  const prefix = Object.keys(PREFIXED_ACTIONS).find((key) => field.startsWith(key));
  if (prefix) return PREFIXED_ACTIONS[prefix](ctx, field.slice(prefix.length));
  if (APPLY[field]) return applyField(ctx, field);
  return ephemeral('R\u00E9glage inconnu.');
}
