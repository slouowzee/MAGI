import { readFileSync } from 'node:fs';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, SeparatorBuilder, StringSelectMenuBuilder, TextDisplayBuilder, TextInputStyle } from 'discord.js';
import { backupDatabase, databaseSize, listBackups, tableCounts } from '../../core/db.js';
import { setSetting, setting } from '../../core/settings.js';
import { log } from '../../core/log/log.js';
import { flushAll } from '../../core/log/discord.js';
import { forcedProvider } from '../../core/llm/client.js';
import { panelPage, refreshPanel, showPage } from '../../panel/index.js';
import { ACTIONS } from './actions.js';

const PREFIX = 'magi-debug:';
const SESSION = 15 * 60_000;
const TOKEN_TTL = 5 * 60_000;
const FOREVER = 'infini';
const SHOWN_TABLES = ['cases', 'infractions', 'reminders', 'settings', 'conversations', 'birthdays', 'synchro'];
const VERSION = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
const ephemeral = { flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
const pending = new Map();
const text = (content) => new TextDisplayBuilder().setContent(content);
const seconds = (ms) => Math.floor(ms / 1000);
const mb = (bytes) => `${(bytes / 1_048_576).toFixed(1)} Mo`;
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`${PREFIX}${id}`).setLabel(label).setStyle(style);

export const isDebugInteraction = (id) => id.startsWith(PREFIX);
export const debugUntil = (guildId) => setting(guildId, 'debug_until');
export const debugActive = (guildId, now = Date.now()) => debugUntil(guildId) === FOREVER || Number(debugUntil(guildId) ?? 0) > now;
const isOwner = (interaction) => interaction.user.id === interaction.guild?.ownerId;

export function debugLine(guildId) {
  const until = debugUntil(guildId);
  return until === FOREVER ? "jusqu'à désactivation" : `jusqu'à <t:${seconds(Number(until))}:t> (<t:${seconds(Number(until))}:R>)`;
}

function remember(entry) {
  const token = crypto.randomUUID().slice(0, 12);
  pending.set(token, { ...entry, at: Date.now() });
  for (const [key, value] of pending) if (Date.now() - value.at > TOKEN_TTL) pending.delete(key);
  return token;
}

export function systemInfo(guild) {
  const up = process.uptime();
  const counts = tableCounts().filter((t) => SHOWN_TABLES.includes(t.name)).map((t) => `${t.name} ${t.rows}`).join(' · ');
  return [
    `**MAGI ${VERSION}** · en ligne depuis ${Math.floor(up / 3600)} h ${Math.floor((up % 3600) / 60)} min · mémoire ${mb(process.memoryUsage().rss)}`,
    `**Base** : ${mb(databaseSize())} · ${counts}`,
    `**Copies de la base** : ${listBackups().length} · **logs Discord** : ${setting(guild.id, 'log_level') ?? 'notice'} · **modèle forcé** : ${forcedProvider() ?? 'aucun'}`,
  ].join('\n');
}

export function debugBlocks(guild) {
  const forever = debugUntil(guild.id) === FOREVER;
  return [
    text(`**Mode débogage actif ${debugLine(guild.id)}**\n-# Réservé au propriétaire. Chaque action est notée dans #magi-systeme, les suppressions demandent une confirmation et une copie de la base est faite avant.`),
    new SeparatorBuilder(),
    text(systemInfo(guild)),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}action`)
        .setPlaceholder('Choisir une action')
        .addOptions(Object.entries(ACTIONS).map(([value, a]) => ({ label: a.label.slice(0, 100), value, description: a.confirm ? 'Demande une confirmation' : undefined }))),
    ),
    new ActionRowBuilder().addComponents(forever ? [button('on:15', 'Limiter à 15 min'), button('off', 'Désactiver', ButtonStyle.Danger)] : [button('extend', 'Prolonger 15 min'), button(`on:${FOREVER}`, "Jusqu'à désactivation"), button('off', 'Désactiver', ButtonStyle.Danger)]),
  ];
}

export function activationBlocks(guild) {
  if (debugActive(guild.id)) return [text(`**Mode débogage** : actif ${debugLine(guild.id)}`), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('magi-config:goto:debug').setLabel('Ouvrir le débogage').setStyle(ButtonStyle.Primary), button('off', 'Désactiver', ButtonStyle.Danger))];
  return [text('**Mode débogage**\n-# Réservé au propriétaire : outils pour tout corriger ou réinitialiser. Le panneau passe en mode débogage tant qu’il est actif.'), new ActionRowBuilder().addComponents(button('on:15', 'Débogage 15 min'), button(`on:${FOREVER}`, "Jusqu'à désactivation"))];
}

function form(key, action) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}form:${key}`).setTitle(action.label.slice(0, 45));
  for (const f of action.fields) {
    modal.addLabelComponents((label) => {
      label.setLabel(f.label.slice(0, 45));
      if (f.choices) return label.setStringSelectMenuComponent((s) => s.setCustomId(f.id).setRequired(f.required).addOptions(Object.entries(f.choices).map(([value, name]) => ({ label: name.slice(0, 100), value }))));
      if (f.file) return label.setFileUploadComponent((u) => u.setCustomId(f.id).setRequired(f.required).setMaxValues(1));
      if (f.user) return label.setUserSelectMenuComponent((u) => u.setCustomId(f.id).setRequired(f.required).setMaxValues(1).setPlaceholder('Chercher un membre'));
      return label.setTextInputComponent((t) => {
        t.setCustomId(f.id).setStyle(f.long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(f.required).setMaxLength(f.long ? 4000 : 200);
        if (f.placeholder) t.setPlaceholder(f.placeholder);
        return t;
      });
    });
  }
  return modal;
}

function readForm(interaction, action) {
  return Object.fromEntries(
    action.fields.map((f) => {
      if (f.choices) return [f.id, interaction.fields.getStringSelectValues(f.id)?.[0] ?? ''];
      if (f.file) return [f.id, interaction.fields.getUploadedFiles(f.id, false)?.first()?.url ?? ''];
      if (f.user) return [f.id, interaction.fields.getSelectedUsers(f.id, false)?.first()?.id ?? ''];
      return [f.id, interaction.fields.getTextInputValue(f.id) ?? ''];
    }),
  );
}

async function execute(interaction, { action: key, params = {} }, { confirmed = false } = {}) {
  const { guild, member } = interaction;
  const ctx = { guild, member, client: interaction.client, params, restart: false };
  const { label } = ACTIONS[key];
  let output;
  try {
    if (confirmed) backupDatabase(key.replace(/_/g, '-'));
    output = await ACTIONS[key].run(ctx);
    const summary = (typeof output === 'string' ? output : output.content).split('\n')[0].slice(0, 200);
    log.notice('debug', `${member} · ${label} : ${summary}`, { guild });
  } catch (err) {
    output = `Impossible : ${err.message}.`;
    log.warning('debug', `${member} · ${label} : ${err.message}`, { guild });
  }
  const payload = typeof output === 'string' ? { content: output.slice(0, 2000) } : { content: output.content.slice(0, 2000), files: output.files };
  await interaction.editReply({ ...payload, components: [] });
  if (ctx.restart) {
    setSetting('global', 'last_stop', Date.now());
    await flushAll();
    setTimeout(() => process.exit(0), 1_500);
  }
}

async function prepare(interaction, key, params) {
  const action = ACTIONS[key];
  await interaction.deferReply(ephemeral);
  let summary;
  try {
    summary = (await action.confirm?.({ guild: interaction.guild, member: interaction.member, client: interaction.client, params })) ?? null;
  } catch (err) {
    return interaction.editReply({ content: `Impossible : ${err.message}.` });
  }
  if (!summary) return execute(interaction, { action: key, params });
  const token = remember({ action: key, params });
  return interaction.editReply({ content: `${summary}\n-# Une copie de la base est faite avant.`, components: [new ActionRowBuilder().addComponents(button(`ok:${token}`, 'Confirmer', ButtonStyle.Danger))] });
}

export async function handleDebugInteraction(interaction) {
  if (!isOwner(interaction)) return interaction.reply({ content: "Tu n'as pas les droits : le mode débogage est réservé au propriétaire du serveur.", ...ephemeral });
  const { guild, member } = interaction;
  const [kind, arg] = interaction.customId.slice(PREFIX.length).split(':');
  if (kind === 'on' || kind === 'extend') {
    const forever = arg === FOREVER;
    setSetting(guild.id, 'debug_until', forever ? FOREVER : Date.now() + SESSION);
    log.notice('debug', `${member} a ${kind === 'extend' ? 'prolongé' : 'activé'} le mode débogage ${forever ? "jusqu'à désactivation" : 'pour 15 min'}`, { guild });
    return showPage(interaction, 'debug');
  }
  if (kind === 'off') {
    endDebug(guild);
    log.notice('debug', `${member} a désactivé le mode débogage`, { guild });
    return showPage(interaction, 'accueil');
  }
  if (!debugActive(guild.id)) return interaction.reply({ content: 'Le mode débogage est désactivé : réactive-le depuis l’accueil du panneau.', ...ephemeral });
  if (kind === 'action') {
    const key = interaction.values[0];
    interaction.message?.edit(panelPage(guild)).catch(() => {});
    return ACTIONS[key].fields ? interaction.showModal(form(key, ACTIONS[key])) : prepare(interaction, key, {});
  }
  if (kind === 'form' && ACTIONS[arg]) return prepare(interaction, arg, readForm(interaction, ACTIONS[arg]));
  if (kind === 'ok') {
    const entry = pending.get(arg);
    pending.delete(arg);
    if (!entry || Date.now() - entry.at > TOKEN_TTL) return interaction.update({ content: 'Cette confirmation a expiré, recommence.', components: [] });
    await interaction.update({ content: 'En cours…', components: [] });
    return execute(interaction, entry, { confirmed: true });
  }
  return interaction.reply({ content: 'Action inconnue.', ...ephemeral });
}

function endDebug(guild) {
  setSetting(guild.id, 'debug_until', null);
  setSetting(guild.id, 'stars_test', null);
}

export function tickDebug(client, now = Date.now()) {
  for (const guild of client.guilds.cache.values()) {
    const until = debugUntil(guild.id);
    if (until && until !== FOREVER && Number(until) <= now) {
      endDebug(guild);
      log.notice('debug', 'Mode débogage terminé : les 15 min sont écoulées', { guild });
      refreshPanel(guild).catch(() => {});
    }
    const levelUntil = Number(setting(guild.id, 'log_level_until') ?? 0);
    if (!levelUntil || levelUntil > now) continue;
    const before = setting(guild.id, 'log_level_before');
    setSetting(guild.id, 'log_level', before === 'notice' ? null : before);
    setSetting(guild.id, 'log_level_until', null);
    setSetting(guild.id, 'log_level_before', null);
    log.notice('debug', `Logs revenus au niveau ${before ?? 'notice'}`, { guild });
  }
}

export function startDebugTimers(client) {
  tickDebug(client);
  setInterval(() => tickDebug(client), 30_000).unref();
}
