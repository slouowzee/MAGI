import { ActionRowBuilder, ApplicationCommandOptionType as O, ApplicationCommandType, ChannelType, MessageFlags, ModalBuilder, PermissionFlagsBits as P, TextInputBuilder, TextInputStyle } from 'discord.js';
import { PERSONAS } from '../../core/personas.js';
import { isOperator } from '../../core/installation.js';
import { speak } from '../../core/discord/webhooks.js';
import { log } from '../../core/log/log.js';
import { publicationEmbed } from '../admin/publications.js';
import { savePublication } from '../admin/publications-store.js';

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

const messageId = (ref) => String(ref ?? '').match(/(\d{17,20})\/?$/)?.[1] ?? null;

function writeModal({ form, channelId, editId, title = '', text = '' }) {
  const rows = [];
  if (form === 'publication') rows.push(new TextInputBuilder().setCustomId('titre').setLabel('Titre (facultatif)').setStyle(TextInputStyle.Short).setMaxLength(256).setRequired(false).setValue(title));
  const body = new TextInputBuilder().setCustomId('texte').setLabel('Texte, publié tel quel (Markdown Discord)').setStyle(TextInputStyle.Paragraph).setMaxLength(form === 'publication' ? 4000 : 2000).setRequired(true);
  if (text) body.setValue(text.slice(0, form === 'publication' ? 4000 : 2000));
  rows.push(body);
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
  if (!interaction.isModalSubmit() || !isOperator(interaction.member)) return;
  const [form, channelId, editId] = interaction.customId.slice(PREFIX.length).split(':');
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
    log.notice('commandes', `message de MAGI modifié par ${interaction.user.tag}`, { channel });
    return interaction.reply({ content: `Message modifié : ${target.url}`, ...ephemeral });
  }
  const sent = PERSONAS[form] ? await speak(channel, form, text) : await channel.send({ ...payload, allowedMentions: { parse: [] } });
  if (form === 'publication') savePublication({ guildId: guild.id, channelId: channel.id, messageId: sent.id, title: title || text.slice(0, 60) });
  log.notice('commandes', `message écrit par ${interaction.user.tag} publié (${FORMS[form]})`, { channel });
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
  log.notice('commandes', `clear : ${deleted} message(s)${author ? ` de ${author.tag}` : ''}${onlyMagi ? ' de MAGI' : ''} supprimé(s) par ${interaction.user.tag}`, { channel });
  return interaction.editReply({ content: `${deleted} message(s) supprimé(s)${who}.${old ? ` ${old} trop ancien(s) (plus de 14 jours) laissé(s) : Discord ne permet pas de les supprimer en lot.` : ''}` });
}
