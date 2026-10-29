import { readFileSync } from 'node:fs';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { backupDatabase, databaseSize, listBackups, tableCounts } from '../../core/db.js';
import { setSetting, setting } from '../../core/settings.js';
import { log } from '../../core/log/log.js';
import { flushAll } from '../../core/log/discord.js';
import { forcedProvider } from '../../core/llm/client.js';
import { refreshPanel } from '../../panel/index.js';
import { syncCommands } from '../commands/commands.js';
import { ACTIONS } from './actions.js';
import { importConfig, readConfig } from './config.js';

const PREFIX = 'magi-debug:';
const SESSION = 15 * 60_000;
const TOKEN_TTL = 5 * 60_000;
const SHOWN_TABLES = ['cases', 'infractions', 'reminders', 'settings', 'conversations', 'birthdays', 'synchro'];
const VERSION = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
const V2 = MessageFlags.IsComponentsV2;
const ephemeral = { flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
const pending = new Map();
const text = (content) => new TextDisplayBuilder().setContent(content);
const seconds = (ms) => Math.floor(ms / 1000);
const mb = (bytes) => `${(bytes / 1_048_576).toFixed(1)} Mo`;
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`${PREFIX}${id}`).setLabel(label).setStyle(style);

export const isDebugInteraction = (id) => id.startsWith(PREFIX);
export const debugUntil = (guildId) => Number(setting(guildId, 'debug_until') ?? 0);
export const debugActive = (guildId, now = Date.now()) => debugUntil(guildId) > now;
const isOwner = (interaction) => interaction.user.id === interaction.guild?.ownerId;
const refuse = (interaction) => interaction.reply({ content: "Tu n'as pas les droits : le mode débogage est réservé au propriétaire du serveur.", ...ephemeral });

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

export function consolePayload(guild, now = Date.now()) {
  const until = debugUntil(guild.id);
  const active = until > now;
  const container = new ContainerBuilder()
    .setAccentColor(active ? 0xef9f27 : 0x888780)
    .addTextDisplayComponents(text(`### Mode débogage\n${active ? `Actif jusqu'à <t:${seconds(until)}:t> (<t:${seconds(until)}:R>)` : 'Inactif'}\n-# Réservé au propriétaire. Chaque action est notée dans #magi-systeme, les suppressions demandent une confirmation et une copie de la base est faite avant.`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(text(systemInfo(guild)));
  if (active) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}action`)
          .setPlaceholder('Choisir une action')
          .addOptions(Object.entries(ACTIONS).map(([value, a]) => ({ label: a.label.slice(0, 100), value, description: a.confirm ? 'Demande une confirmation' : undefined }))),
      ),
    );
  }
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(active ? [button('extend', 'Prolonger 15 min'), button('refresh', 'Rafraîchir'), button('off', 'Couper', ButtonStyle.Danger)] : [button('on', 'Activer 15 min', ButtonStyle.Success)]),
  );
  return { components: [container], flags: V2, allowedMentions: { parse: [] } };
}

export async function openConsole(interaction) {
  if (!isOwner(interaction)) return refuse(interaction);
  if (interaction.options.getSubcommand() === 'importer') return importFile(interaction);
  return interaction.reply({ ...consolePayload(interaction.guild), flags: V2 | MessageFlags.Ephemeral });
}

async function importFile(interaction) {
  const { guild } = interaction;
  if (!debugActive(guild.id)) return interaction.reply({ content: "Active d'abord le mode débogage avec /debug console.", ...ephemeral });
  const file = interaction.options.getAttachment('fichier');
  if (file.size > 1_000_000) return interaction.reply({ content: 'Fichier trop gros pour une configuration.', ...ephemeral });
  let data;
  try {
    data = readConfig(await (await fetch(file.url)).text());
  } catch (err) {
    return interaction.reply({ content: `Impossible : ${err.message}.`, ...ephemeral });
  }
  const token = remember({ action: 'importer', data });
  return interaction.reply({
    content: `Importer la configuration de « ${data.guild?.name ?? '?'} » exportée <t:${seconds(Date.parse(data.at) || Date.now())}:R> : ${Object.keys(data.settings).length} réglages, mode de modération ${data.moderation} ? Les réglages du même nom sont remplacés.\n-# Une copie de la base est faite avant.`,
    components: [new ActionRowBuilder().addComponents(button(`ok:${token}`, 'Importer', ButtonStyle.Danger))],
    ...ephemeral,
  });
}

function form(key, action) {
  return new ModalBuilder()
    .setCustomId(`${PREFIX}form:${key}`)
    .setTitle(action.label.slice(0, 45))
    .addComponents(
      action.fields.map((f) => {
        const input = new TextInputBuilder().setCustomId(f.id).setLabel(f.label.slice(0, 45)).setStyle(f.long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(f.required).setMaxLength(f.long ? 4000 : 200);
        if (f.placeholder) input.setPlaceholder(f.placeholder);
        return new ActionRowBuilder().addComponents(input);
      }),
    );
}

async function execute(interaction, { action: key, params = {}, data }, { confirmed = false } = {}) {
  const { guild, member } = interaction;
  const ctx = { guild, member, client: interaction.client, params, restart: false };
  const label = key === 'importer' ? 'Importer une configuration' : ACTIONS[key].label;
  let output;
  try {
    if (confirmed) backupDatabase(key.replace(/_/g, '-'));
    if (key === 'importer') {
      output = `Configuration importée : ${importConfig(guild, data)} réglages.`;
      await syncCommands(guild).catch(() => {});
      await refreshPanel(guild).catch(() => {});
    } else output = await ACTIONS[key].run(ctx);
    const summary = (typeof output === 'string' ? output : output.content).split('\n')[0].slice(0, 200);
    log.notice('debug', `${member} · ${label} : ${summary}`, { guild });
  } catch (err) {
    output = `Impossible : ${err.message}.`;
    log.warning('debug', `${member} · ${label} : ${err.message}`, { guild });
  }
  const payload = typeof output === 'string' ? { content: output.slice(0, 2000) } : { content: output.content.slice(0, 2000), files: output.files };
  await interaction.editReply({ ...payload, components: [] });
  if (ctx.restart) {
    await flushAll();
    setTimeout(() => process.exit(0), 1_500);
  }
}

async function prepare(interaction, key, params) {
  const action = ACTIONS[key];
  let summary;
  try {
    summary = action.confirm?.({ guild: interaction.guild, member: interaction.member, client: interaction.client, params }) ?? null;
  } catch (err) {
    return interaction.reply({ content: `Impossible : ${err.message}.`, ...ephemeral });
  }
  if (summary) {
    const token = remember({ action: key, params });
    return interaction.reply({ content: `${summary}\n-# Une copie de la base est faite avant.`, components: [new ActionRowBuilder().addComponents(button(`ok:${token}`, 'Confirmer', ButtonStyle.Danger))], ...ephemeral });
  }
  await interaction.deferReply(ephemeral);
  return execute(interaction, { action: key, params });
}

export async function handleDebugInteraction(interaction) {
  if (!isOwner(interaction)) return refuse(interaction);
  const { guild, member } = interaction;
  const [kind, arg] = interaction.customId.slice(PREFIX.length).split(':');
  if (kind === 'on' || kind === 'extend') {
    setSetting(guild.id, 'debug_until', Date.now() + SESSION);
    log.notice('debug', `${member} a ${kind === 'on' ? 'activé' : 'prolongé'} le mode débogage pour 15 min`, { guild });
    return interaction.update(consolePayload(guild));
  }
  if (kind === 'off') {
    setSetting(guild.id, 'debug_until', null);
    log.notice('debug', `${member} a coupé le mode débogage`, { guild });
    return interaction.update(consolePayload(guild));
  }
  if (kind === 'refresh') return interaction.update(consolePayload(guild));
  if (!debugActive(guild.id)) return interaction.reply({ content: 'Le mode débogage est coupé : réactive-le dans la console.', ...ephemeral });
  if (kind === 'action') {
    const key = interaction.values[0];
    return ACTIONS[key].fields ? interaction.showModal(form(key, ACTIONS[key])) : prepare(interaction, key, {});
  }
  if (kind === 'form' && ACTIONS[arg]) return prepare(interaction, arg, Object.fromEntries(ACTIONS[arg].fields.map((f) => [f.id, interaction.fields.getTextInputValue(f.id) ?? ''])));
  if (kind === 'ok') {
    const entry = pending.get(arg);
    pending.delete(arg);
    if (!entry || Date.now() - entry.at > TOKEN_TTL) return interaction.update({ content: 'Cette confirmation a expiré, recommence.', components: [] });
    await interaction.update({ content: 'En cours…', components: [] });
    return execute(interaction, entry, { confirmed: true });
  }
  return interaction.reply({ content: 'Action inconnue.', ...ephemeral });
}

export function restoreLogLevels(client, now = Date.now()) {
  for (const guild of client.guilds.cache.values()) {
    const until = Number(setting(guild.id, 'log_level_until') ?? 0);
    if (!until || until > now) continue;
    const before = setting(guild.id, 'log_level_before');
    setSetting(guild.id, 'log_level', before === 'notice' ? null : before);
    setSetting(guild.id, 'log_level_until', null);
    setSetting(guild.id, 'log_level_before', null);
    log.notice('debug', `Logs revenus au niveau ${before ?? 'notice'}`, { guild });
  }
}

export function startDebugTimers(client) {
  restoreLogLevels(client);
  setInterval(() => restoreLogLevels(client), 60_000).unref();
}
