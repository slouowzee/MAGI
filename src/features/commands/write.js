import { ActionRowBuilder, ApplicationCommandOptionType as O, ButtonBuilder, ButtonStyle, ApplicationCommandType, ChannelType, MessageFlags, ModalBuilder, PermissionFlagsBits as P, TextInputBuilder, TextInputStyle } from 'discord.js';
import { PERSONAS } from '../../core/personas.js';
import { isOperator } from '../../core/installation.js';
import { speak } from '../../core/discord/webhooks.js';
import { log } from '../../core/log/log.js';
import { publicationEmbed } from '../admin/publications.js';
import { savePublication } from '../admin/publications-store.js';
import { db } from '../../core/db.js';

const PREFIX = 'magi-write:';
const ephemeral = { flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
const FORMS = { publication: 'Publication encadrée', message: 'Message simple de MAGI', ...Object.fromEntries(Object.entries(PERSONAS).map(([k, p]) => [k, `Voix de ${p.name}`])) };

export const WRITE_COMMANDS = [
  {
    tier: 'operateurs',
    data: {
      name: 'ecrire',
      type: ApplicationCommandType.ChatInput,
      description: 'Écrire toi-même un message publié par MAGI, ou modifier un message de MAGI (opérateurs)',
      options: [
        { type: O.String, name: 'forme', description: 'Comment le publier', required: true, choices: Object.entries(FORMS).map(([value, name]) => ({ name, value })) },
        { type: O.Channel, name: 'salon', description: 'Salon de destination, celui-ci par défaut', channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
        { type: O.String, name: 'modifier', description: "Lien ou identifiant d'un message de MAGI à modifier au lieu d'en publier un" },
      ],
    },
  },
  {
    tier: 'moderation',
    data: {
      name: 'clear',
      type: ApplicationCommandType.ChatInput,
      description: 'Supprimer les derniers messages du salon',
      options: [
        { type: O.Integer, name: 'nombre', description: 'Combien de messages, de 1 à 1000', required: true, min_value: 1, max_value: 1000 },
        { type: O.User, name: 'membre', description: 'Seulement les messages de ce membre' },
        { type: O.Boolean, name: 'magi', description: 'Seulement les messages de MAGI et de ses trois unités' },
      ],
    },
  },
];

const MAX_DELAY = 366 * 86_400_000;
const WHEN_HINT = '18h30, demain 9h, 31/10 20h, dans 2h';
const PARIS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const UNITS = { m: 60_000, min: 60_000, h: 3_600_000, j: 86_400_000, jour: 86_400_000, jours: 86_400_000 };
const DAYS_AHEAD = { "aujourd'hui": 0, demain: 1, 'après-demain': 2 };

const insertScheduled = db.query('INSERT INTO scheduled (guild_id, channel_id, author_id, form, title, text, due_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
const dueScheduled = db.query('SELECT * FROM scheduled WHERE done = 0 AND due_at <= ? ORDER BY due_at');
const pendingScheduled = db.query('SELECT * FROM scheduled WHERE guild_id = ? AND done = 0 ORDER BY due_at');
const closeScheduled = db.query('UPDATE scheduled SET done = 1 WHERE id = ? AND guild_id = ? AND done = 0');

function parisParts(ms) {
  const p = Object.fromEntries(PARIS.formatToParts(ms).map(({ type, value }) => [type, Number(value)]));
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute };
}

function fromParis(year, month, day, hour, minute) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const shown = parisParts(guess);
  return guess - (Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute) - guess);
}

export function parseWhen(input, now = Date.now()) {
  const value = String(input ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!value) return { at: null };
  const relative = value.match(/^dans (\d+) ?(min|m|h|j|jours?)(?: ?(\d+))?$/) ?? value.match(/^(\d+) ?(min|j|jours?)$/);
  const clock = value.match(/^(?:(aujourd'hui|demain|après-demain) )?(?:à )?(\d{1,2}) ?[h:] ?(\d{2})?$/);
  const dated = value.match(/^(?:le )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))? (?:à )?(\d{1,2}) ?[h:] ?(\d{2})?$/);
  let at = null;
  if (relative) at = now + Number(relative[1]) * UNITS[relative[2]] + (relative[2] === 'h' && relative[3] ? Number(relative[3]) * 60_000 : 0);
  else if (clock || dated) {
    const today = parisParts(now);
    const [hour, minute] = clock ? [Number(clock[2]), Number(clock[3] ?? 0)] : [Number(dated[4]), Number(dated[5] ?? 0)];
    const year = dated?.[3] ? Number(dated[3].length === 2 ? `20${dated[3]}` : dated[3]) : today.year;
    const [month, day] = dated ? [Number(dated[2]), Number(dated[1])] : [today.month, today.day + (DAYS_AHEAD[clock[1]] ?? 0)];
    at = fromParis(year, month, day, hour, minute);
    const roll = clock ? !clock[1] && at <= now : !dated[3] && at <= now;
    if (roll) at = clock ? fromParis(year, month, day + 1, hour, minute) : fromParis(year + 1, month, day, hour, minute);
    const shown = parisParts(at);
    if (shown.hour !== hour || shown.minute !== minute || (dated && (shown.day !== day || shown.month !== month))) at = null;
  }
  if (!Number.isFinite(at)) return { error: `Date non comprise : « ${input} ». Exemples : ${WHEN_HINT}.` };
  if (at <= now) return { error: 'Cette date est déjà passée.' };
  if (at - now > MAX_DELAY) return { error: 'Pas plus d’un an à l’avance.' };
  return { at };
}

export function scheduleMessage({ guildId, channelId, authorId, form, title = '', text, at }) {
  return Number(insertScheduled.run(guildId, channelId, authorId, form, title, text, at).lastInsertRowid);
}

export const scheduledMessages = (guildId) => pendingScheduled.all(guildId);
export const cancelScheduled = (id, guildId) => closeScheduled.run(id, guildId).changes > 0;

async function publish(guild, channel, form, title, text) {
  if (PERSONAS[form]) return speak(channel, form, text);
  const sent = await channel.send(form === 'publication' ? { embeds: [publicationEmbed(guild, { titre: title, texte: text, entete: false })], allowedMentions: { parse: [] } } : { content: text, allowedMentions: { parse: [] } });
  if (form === 'publication') savePublication({ guildId: guild.id, channelId: channel.id, messageId: sent.id, title: title || text.slice(0, 60) });
  return sent;
}

export async function sendDueMessages(client, now = Date.now()) {
  for (const row of dueScheduled.all(now)) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild || !cancelScheduled(row.id, row.guild_id)) continue;
    const channel = guild.channels.cache.get(row.channel_id);
    if (!channel) {
      log.err('commandes', `message programmé n°${row.id} non envoyé : salon supprimé`, { guild });
      continue;
    }
    await publish(guild, channel, row.form, row.title, row.text)
      .then((sent) => log.notice('commandes', `message programmé n°${row.id} de <@${row.author_id}> publié : ${sent.url}`, { channel }))
      .catch((err) => log.err('commandes', `échec du message programmé n°${row.id} : ${err.message}`, { channel }));
  }
}

export const SCHEDULE_TOOLS = [
  {
    name: 'messages_programmes',
    description: 'Liste les messages programmés avec /ecrire qui ne sont pas encore partis.',
    parameters: { type: 'object', properties: {} },
    access: 'operator',
    readonly: true,
    async run({ guild }) {
      const list = scheduledMessages(guild.id);
      if (!list.length) return 'Aucun message programmé.';
      return `Messages programmés (recopie les dates telles quelles) :\n${list.map((r) => `- n°${r.id} · <#${r.channel_id}> · <t:${Math.floor(r.due_at / 1000)}:f> · par <@${r.author_id}> · ${(r.title || r.text).replace(/\s+/g, ' ').slice(0, 80)}`).join('\n')}`;
    },
  },
  {
    name: 'annuler_message_programme',
    description: 'Annule un message programmé avec /ecrire, par son numéro (messages_programmes pour le trouver).',
    parameters: { type: 'object', properties: { numero: { type: 'integer' } }, required: ['numero'] },
    access: 'operator',
    async run({ guild, member, args }) {
      if (!cancelScheduled(Number(args.numero), guild.id)) return `Aucun message programmé n°${args.numero} en attente.`;
      log.notice('commandes', `${member} a annulé le message programmé n°${args.numero}`, { guild });
      return `Message programmé n°${args.numero} annulé.`;
    },
  },
];

export function startScheduled(client) {
  setInterval(() => sendDueMessages(client).catch(() => {}), 15_000);
}

const messageId = (ref) => String(ref ?? '').match(/(\d{17,20})\/?$/)?.[1] ?? null;

function writeModal({ form, channelId, editId, title = '', text = '' }) {
  const rows = [];
  if (form === 'publication') rows.push(new TextInputBuilder().setCustomId('titre').setLabel('Titre (facultatif)').setStyle(TextInputStyle.Short).setMaxLength(256).setRequired(false).setValue(title));
  const body = new TextInputBuilder().setCustomId('texte').setLabel('Texte, publié tel quel (Markdown Discord)').setStyle(TextInputStyle.Paragraph).setMaxLength(form === 'publication' ? 4000 : 2000).setRequired(true);
  if (text) body.setValue(text.slice(0, form === 'publication' ? 4000 : 2000));
  rows.push(body);
  if (!editId) rows.push(new TextInputBuilder().setCustomId('quand').setLabel('Quand ? Vide = tout de suite').setStyle(TextInputStyle.Short).setMaxLength(40).setRequired(false).setPlaceholder(WHEN_HINT));
  return new ModalBuilder()
    .setCustomId(`${PREFIX}${form}:${channelId}:${editId ?? ''}`)
    .setTitle(editId ? 'Modifier le message de MAGI' : 'Écrire un message')
    .addComponents(rows.map((input) => new ActionRowBuilder().addComponents(input)));
}

export async function openWrite(interaction) {
  if (!isOperator(interaction.member)) return interaction.reply({ content: "Tu n'as pas les droits : publier au nom de MAGI est réservé aux opérateurs MAGI.", ...ephemeral });
  const form = interaction.options.getString('forme');
  const channel = interaction.options.getChannel('salon') ?? interaction.channel;
  const editId = messageId(interaction.options.getString('modifier'));
  if (!editId) return interaction.showModal(writeModal({ form, channelId: channel.id }));
  if (PERSONAS[form]) return interaction.reply({ content: 'Les messages des unités ne se modifient pas : choisis Publication encadrée ou Message simple.', ...ephemeral });
  const target = await channel.messages.fetch(editId).catch(() => null);
  if (!target || target.author.id !== interaction.client.user.id) return interaction.reply({ content: `Message de MAGI introuvable dans ${channel} : donne son lien, et le salon s'il est ailleurs.`, ...ephemeral });
  const embed = target.embeds[0];
  return interaction.showModal(writeModal({ form, channelId: channel.id, editId, title: embed?.title ?? '', text: embed?.description ?? target.content }));
}

export const isWriteModal = (id) => id.startsWith(PREFIX);

export async function handleWriteModal(interaction) {
  if (!isOperator(interaction.member)) return interaction.reply({ content: 'Réservé aux opérateurs MAGI.', ...ephemeral });
  const [form, channelId, editId] = interaction.customId.slice(PREFIX.length).split(':');
  if (form === 'annuler') {
    const cancelled = cancelScheduled(Number(channelId), interaction.guild.id);
    if (cancelled) log.notice('commandes', `${interaction.member} a annulé le message programmé n°${channelId}`, { guild: interaction.guild });
    return interaction.update({ content: cancelled ? `Message programmé n°${channelId} annulé.` : 'Ce message est déjà parti ou annulé.', components: [] });
  }
  if (!interaction.isModalSubmit()) return;
  const { guild } = interaction;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return interaction.reply({ content: 'Salon introuvable.', ...ephemeral });
  const text = interaction.fields.getTextInputValue('texte');
  const title = form === 'publication' ? interaction.fields.getTextInputValue('titre') : '';
  const payload = form === 'publication' ? { content: null, embeds: [publicationEmbed(guild, { titre: title, texte: text, entete: false })] } : { content: text, embeds: [] };
  if (editId) {
    const target = await channel.messages.fetch(editId).catch(() => null);
    if (!target) return interaction.reply({ content: 'Message introuvable.', ...ephemeral });
    await target.edit(payload);
    log.notice('commandes', `${interaction.member} a réécrit un message de MAGI : ${target.url}`, { channel });
    return interaction.reply({ content: `Message modifié : ${target.url}`, ...ephemeral });
  }
  const when = parseWhen(interaction.fields.getTextInputValue('quand'));
  if (when.error) return interaction.reply({ content: `${when.error}\n-# Ton texte :\n${text}`.slice(0, 2000), ...ephemeral });
  if (when.at) {
    const id = scheduleMessage({ guildId: guild.id, channelId: channel.id, authorId: interaction.user.id, form, title, text, at: when.at });
    log.notice('commandes', `${interaction.member} a programmé un message (${FORMS[form].toLowerCase()}) dans ${channel} pour <t:${Math.floor(when.at / 1000)}:f>`, { channel });
    return interaction.reply({
      content: `Message n°${id} programmé dans ${channel} pour <t:${Math.floor(when.at / 1000)}:F> (<t:${Math.floor(when.at / 1000)}:R>).`,
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}annuler:${id}`).setLabel('Annuler').setStyle(ButtonStyle.Danger))],
      ...ephemeral,
    });
  }
  const sent = await publish(guild, channel, form, title, text);
  log.notice('commandes', `${interaction.member} a publié un message (${FORMS[form].toLowerCase()}) : ${sent.url}`, { channel });
  return interaction.reply({ content: `Publié : ${sent.url}`, ...ephemeral });
}

const TWO_WEEKS = 14 * 86_400_000 - 60_000;
const MAX_PAGES = 20;

export const fromMagi = (message, botId) => message.author.id === botId || message.applicationId === botId;

export async function sweep(channel, count, keep, now = Date.now()) {
  let before;
  let deleted = 0;
  let old = 0;
  for (let page = 0; page < MAX_PAGES && deleted + old < count; page++) {
    const batch = [...(await channel.messages.fetch({ limit: 100, before })).values()];
    if (!batch.length) break;
    before = batch.at(-1).id;
    const wanted = batch.filter(keep).slice(0, count - deleted - old);
    const fresh = wanted.filter((m) => now - m.createdTimestamp < TWO_WEEKS);
    old += wanted.length - fresh.length;
    if (fresh.length) deleted += (await channel.bulkDelete(fresh, true)).size;
    if (fresh.length < wanted.length || batch.length < 100) break;
  }
  return { deleted, old };
}

export async function clear(interaction) {
  const { channel, member } = interaction;
  if (!member.permissionsIn(channel).has(P.ManageMessages) && !isOperator(member)) return interaction.reply({ content: "Tu n'as pas les droits : il faut pouvoir gérer les messages de ce salon.", ...ephemeral });
  if (!channel.permissionsFor(interaction.guild.members.me)?.has(P.ManageMessages)) return interaction.reply({ content: "Je n'ai pas la permission Gérer les messages dans ce salon.", ...ephemeral });
  await interaction.deferReply(ephemeral);
  const count = interaction.options.getInteger('nombre');
  const author = interaction.options.getUser('membre');
  const onlyMagi = interaction.options.getBoolean('magi');
  const { deleted, old } = await sweep(channel, count, (m) => (!author || m.author.id === author.id) && (!onlyMagi || fromMagi(m, interaction.client.user.id)));
  const who = `${author ? ` de ${author}` : ''}${onlyMagi ? ' de MAGI' : ''}`;
  log.notice('commandes', `${interaction.member} a supprimé ${deleted} message${deleted > 1 ? 's' : ''}${author ? ` de ${author}` : ''}${onlyMagi ? ' de MAGI' : ''}`, { channel });
  return interaction.editReply({ content: `${deleted} message(s) supprimé(s)${who}.${old ? ` ${old} trop ancien(s) (plus de 14 jours) laissé(s) : Discord ne permet pas de les supprimer en lot.` : ''}` });
}
