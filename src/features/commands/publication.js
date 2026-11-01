import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, ContainerBuilder, MediaGalleryBuilder, MessageFlags, ModalBuilder, SectionBuilder, SeparatorBuilder, StringSelectMenuBuilder, TextDisplayBuilder, TextInputStyle, ThumbnailBuilder } from 'discord.js';
import { COLOR, SIGNATURE } from '../../core/discord/embeds.js';
import { fetchLimited } from '../../core/discord/media.js';
import { setSetting, setting } from '../../core/settings.js';
import { savePublication } from '../admin/publications-store.js';
import { resolveMentions, unknownNote } from './mentions.js';
import { discordTime } from '../../core/util.js';

export const COLORS = { magi: ['Rouge MAGI', COLOR], bleu: ['Bleu', 0x378add], vert: ['Vert', 0x1d9e75], jaune: ['Jaune', 0xef9f27], orange: ['Orange', 0xd85a30], violet: ['Violet', 0x7f77dd], rose: ['Rose', 0xd4537e], gris: ['Gris', 0x888780] };
export const MAX_IMAGES = 10;
export const MAX_TEXT = 4000;
const MAX_SECTIONS = 3;
const MAX_BUTTONS = 5;
const DRAFT_TTL = 30 * 60_000;
const MAX_UPLOAD = 25 * 1024 * 1024;
const IMAGE_TYPES = /^\.(png|jpe?g|gif|webp)$/;
const FILES = join(process.env.DB_PATH === ':memory:' ? tmpdir() : dirname(process.env.DB_PATH ?? 'data/magi.db'), 'programmes');
const drafts = new Map();
const text = (content) => new TextDisplayBuilder().setContent(content);
const metaKey = (messageId) => `publication:${messageId}`;
const RULE = /^[ \t]*-{3,}[ \t]*$/m;

function addText(card, value, first = (part) => card.addTextDisplayComponents(text(part))) {
  value.split(RULE).map((part) => part.trim()).filter(Boolean).forEach((part, i) => {
    if (i) card.addSeparatorComponents(new SeparatorBuilder()).addTextDisplayComponents(text(part));
    else first(part);
  });
}

export const publicationMeta = (guildId, messageId) => JSON.parse(setting(guildId, metaKey(messageId)) ?? 'null');
export const getDraft = (token) => drafts.get(token) ?? null;
export const dropDraft = (token) => drafts.delete(token);
export const textLength = (draft) => (draft.title?.length ?? 0) + draft.text.length + draft.sections.reduce((n, s) => n + s.text.length, 0) + SIGNATURE.length + 8;

export function createDraft(fields, now = Date.now()) {
  for (const [key, d] of drafts) if (now - d.created > DRAFT_TTL) drafts.delete(key);
  const draft = { token: crypto.randomUUID().slice(0, 12), created: now, when: null, editId: null, images: [], sections: [], buttons: [], ...fields };
  drafts.set(draft.token, draft);
  return draft;
}

export async function download(attachments, prefix) {
  const files = [];
  for (const a of attachments ?? []) {
    if (!/^image\//.test(a.contentType ?? '')) continue;
    const file = await fetchLimited(a.url, MAX_UPLOAD);
    if (!file) continue;
    const ext = extname(a.name ?? '').toLowerCase();
    files.push({ name: `${prefix}-${files.length + 1}${IMAGE_TYPES.test(ext) ? ext : '.png'}`, data: file.buffer });
  }
  return files;
}

export function publicationCard(draft, { final = false } = {}) {
  const ref = (file) => (file.data || final ? `attachment://${file.name}` : file.url);
  const card = new ContainerBuilder().setAccentColor(COLORS[draft.color]?.[1] ?? COLORS.magi[1]);
  addText(card, [draft.title && `### ${draft.title}`, draft.text].filter(Boolean).join('\n'));
  if (draft.images.length) card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(draft.images.map((file) => (item) => item.setURL(ref(file)))));
  for (const section of draft.sections) {
    card.addSeparatorComponents(new SeparatorBuilder());
    addText(card, section.text, section.thumb ? (part) => card.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text(part)).setThumbnailAccessory(new ThumbnailBuilder().setURL(ref(section.thumb)))) : undefined);
  }
  card.addTextDisplayComponents(text(`-# ${SIGNATURE}`));
  if (draft.buttons.length) card.addActionRowComponents(new ActionRowBuilder().addComponents(draft.buttons.map((b) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(b.label).setURL(b.url))));
  return card;
}

const allFiles = (draft) => [...draft.images, ...draft.sections.map((s) => s.thumb)].filter(Boolean);
const newFiles = (draft) => allFiles(draft).filter((f) => f.data).map((f) => ({ attachment: f.data, name: f.name }));
const metaOf = (draft) => ({ title: draft.title, text: draft.text, color: draft.color, images: draft.images.map((f) => f.name), sections: draft.sections.map((s) => ({ text: s.text, thumb: s.thumb?.name ?? null })), buttons: draft.buttons });

export function previewPayload(draft) {
  const control = (action, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`magi-write:draft:${action}:${draft.token}`).setLabel(label).setStyle(style);
  const when = draft.when ? ` · programmée pour ${discordTime(draft.when, 'F')}` : '';
  const controls = [
    control('modifier', 'Modifier'),
    draft.buttons.length < MAX_BUTTONS && control('bouton', 'Ajouter un bouton lien'),
    draft.sections.length < MAX_SECTIONS && control('section', 'Ajouter une section'),
    control('publier', draft.editId ? 'Mettre à jour' : draft.when ? 'Programmer' : 'Publier', ButtonStyle.Success),
    control('annuler', 'Annuler'),
  ].filter(Boolean);
  const removable = [
    ...draft.buttons.map((b, i) => ({ label: `Bouton « ${b.label} »`.slice(0, 100), value: `bouton:${i}` })),
    ...draft.sections.map((s, i) => ({ label: `Section « ${s.text.replace(/\s+/g, ' ').slice(0, 60)} »`.slice(0, 100), value: `section:${i}` })),
    ...(draft.images.length ? [{ label: `Les images (${draft.images.length})`, value: 'images' }] : []),
  ];
  const remove = removable.length ? [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`magi-write:draft:retirer:${draft.token}`).setPlaceholder('Retirer…').addOptions(removable))] : [];
  const where = draft.editId ? [] : [new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(`magi-write:draft:salon:${draft.token}`).setPlaceholder('Salon de publication').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setDefaultChannels(draft.channelId))];
  return { components: [text(`-# Aperçu · dans <#${draft.channelId}>${when}, visible par toi seul`), publicationCard(draft), new ActionRowBuilder().addComponents(controls), ...remove, ...where], files: newFiles(draft), attachments: [], allowedMentions: { parse: [] } };
}

export function removeFromDraft(draft, choice) {
  const [kind, index] = choice.split(':');
  if (kind === 'bouton') draft.buttons.splice(Number(index), 1);
  else if (kind === 'section') draft.sections.splice(Number(index), 1);
  else if (kind === 'images') draft.images = [];
}

export function draftModal(action, draft) {
  const modal = new ModalBuilder().setCustomId(`magi-write:draft:${action}-set:${draft.token}`).setTitle(action === 'bouton' ? 'Ajouter un bouton lien' : 'Ajouter une section');
  const input = (id, label, style, max, placeholder) => modal.addLabelComponents((l) => l.setLabel(label).setTextInputComponent((t) => (placeholder ? t.setPlaceholder(placeholder) : t).setCustomId(id).setStyle(style).setMaxLength(max).setRequired(true)));
  if (action === 'bouton') {
    input('texte', 'Texte du bouton', TextInputStyle.Short, 80, 'Rejoindre le vocal');
    input('url', 'Lien', TextInputStyle.Short, 512, 'https://');
  } else {
    input('texte', 'Texte de la section (Markdown Discord)', TextInputStyle.Paragraph, 1500, 'Une ligne --- seule ajoute un séparateur.');
    modal.addLabelComponents((l) => l.setLabel('Petite image à droite (facultatif)').setFileUploadComponent((u) => u.setCustomId('vignette').setRequired(false).setMaxValues(1)));
  }
  return modal;
}

export async function addFromModal(interaction, draft, action) {
  const value = interaction.fields.getTextInputValue('texte').trim();
  if (action === 'bouton') {
    const url = interaction.fields.getTextInputValue('url').trim();
    if (!/^https?:\/\/\S+$/.test(url)) return { error: 'Le lien doit commencer par https:// (ou http://).' };
    draft.buttons.push({ label: value, url });
    return {};
  }
  const { text: resolved, unknown } = resolveMentions(interaction.guild, value);
  const section = { text: resolved, thumb: (await download(interaction.fields.getUploadedFiles('vignette', false)?.values(), `vignette-${draft.sections.length + 1}`))[0] ?? null };
  if (textLength({ ...draft, sections: [...draft.sections, section] }) > MAX_TEXT) return { error: `Trop de texte : une publication est limitée à ${MAX_TEXT} caractères en tout.` };
  draft.sections.push(section);
  return { note: unknownNote(unknown) };
}

export function draftFromMeta(meta, target, fields) {
  const kept = (name) => (name ? { name, url: target.attachments.find((a) => a.name === name)?.url ?? null } : null);
  return createDraft({ ...fields, images: meta.images.map(kept), sections: meta.sections.map((s) => ({ text: s.text, thumb: kept(s.thumb) })), buttons: meta.buttons });
}

export async function publishDraft(guild, channel, draft) {
  const sent = await channel.send({ components: [publicationCard(draft, { final: true })], files: newFiles(draft), flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
  setSetting(guild.id, metaKey(sent.id), JSON.stringify(metaOf(draft)));
  savePublication({ guildId: guild.id, channelId: channel.id, messageId: sent.id, title: draft.title || draft.text.slice(0, 60) });
  return sent;
}

export async function updatePublication(guild, target, draft) {
  const keep = new Set(allFiles(draft).filter((f) => !f.data).map((f) => f.name));
  await target.edit({ components: [publicationCard(draft, { final: true })], files: newFiles(draft), attachments: [...target.attachments.values()].filter((a) => keep.has(a.name)) });
  setSetting(guild.id, metaKey(target.id), JSON.stringify(metaOf(draft)));
}

export function storeFiles(id, draft) {
  const files = allFiles(draft);
  if (!files.length) return metaOf(draft);
  mkdirSync(join(FILES, String(id)), { recursive: true });
  for (const file of files) writeFileSync(join(FILES, String(id), file.name), file.data);
  return metaOf(draft);
}

export function storedDraft(id, meta) {
  const load = (name) => (name && existsSync(join(FILES, String(id), name)) ? { name, data: readFileSync(join(FILES, String(id), name)) } : null);
  return { ...meta, images: meta.images.map(load).filter(Boolean), sections: meta.sections.map((s) => ({ text: s.text, thumb: load(s.thumb) })) };
}

export function dropFiles(id) {
  rmSync(join(FILES, String(id)), { recursive: true, force: true });
}
