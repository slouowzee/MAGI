import { ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SectionBuilder, SeparatorBuilder, TextDisplayBuilder, ThumbnailBuilder, ActionRowBuilder } from 'discord.js';
import { logChannels } from '../../core/installation.js';
import { bumpStat } from '../../core/log/digest.js';
import { casesOf, createCase, getCase, saveCase } from './store.js';

const KINDS = { spam: 'Spam', indesirable: 'Contenu indésirable', flagrant: 'Infraction flagrante', honeypot: 'Honeypot' };
const COLORS = { observation: 0x888780, avertissement: 0xef9f27, exclusion: 0xd85a30, ban: 0xe24b4a, annulee: 0x1d9e75 };
const UPDATE_EVERY = 2_000;
const timers = new Map();
const text = (content) => new TextDisplayBuilder().setContent(content);
const stamp = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

export const excludedOf = (c) => c.excluded ?? Boolean(c.timeout || c.status === 'exclu');
const counted = (c) => Boolean(c.infractionId) && !c.infractionRevoked;

export function severityOf(c) {
  if (c.observing) return 'observation';
  if (c.status === 'annulee' || (!c.banned && !excludedOf(c) && !counted(c))) return 'annulee';
  if (c.banned) return 'ban';
  if (excludedOf(c)) return 'exclusion';
  return 'avertissement';
}

export function stateLine(c) {
  const parts = [
    excludedOf(c) && `exclu${c.excludedUntil ? ` jusqu'à ${stamp(c.excludedUntil, 't')}` : ''}`,
    c.banned && 'banni',
    c.infractionId && (c.infractionRevoked ? 'infraction retirée' : `infraction ${c.infraction}/30 j`),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'plus aucune sanction en cours';
}

const button = (action, id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`magi-mod:${action}:${id}`).setLabel(label).setStyle(style);

export function caseButtons(c) {
  const rows = [];
  if (!c.observing && c.status !== 'annulee') {
    const undo = [
      excludedOf(c) && button('cas-lever', c.id, "Lever l'exclusion"),
      c.banned && button('cas-debannir', c.id, 'Débannir'),
      counted(c) && button('cas-infraction', c.id, "Retirer l'infraction"),
    ].filter(Boolean);
    if (undo.length > 1) undo.push(button('cas-annuler', c.id, 'Tout annuler', ButtonStyle.Primary));
    if (undo.length) rows.push(new ActionRowBuilder().addComponents(undo));
  }
  const open = c.status !== 'annulee';
  const more = [
    open && !c.banned && !excludedOf(c) && button('cas-exclure', c.id, 'Exclure 24 h'),
    open && !c.banned && button('cas-bannir', c.id, 'Bannir', ButtonStyle.Danger),
    button('historique', c.userId, 'Historique'),
  ].filter(Boolean);
  rows.push(new ActionRowBuilder().addComponents(more));
  return rows;
}

export function caseCard(c, { avatar = null, joinedAt = null, createdAt = null } = {}) {
  const who = [`<@${c.userId}>`, createdAt && `compte créé ${stamp(createdAt)}`, joinedAt && `arrivé ${stamp(joinedAt)}`, c.channelId && `<#${c.channelId}>`].filter(Boolean).join(' · ');
  const header = `### Cas #${c.id} · ${KINDS[c.kind] ?? c.kind}${c.observing ? ' (observation)' : ''}\n${who}`;
  const lines = [
    `**Motif** : ${c.reasons.join(', ')}${c.verdict && c.verdict !== 'flagrant' ? ` · avis du modèle : ${c.verdict}` : ''}`,
    `**${c.observing ? 'Aurait fait' : 'Sanction'}** : ${c.action}${c.deleted > 1 ? ` · ${c.deleted} messages ${c.observing ? 'concernés' : 'supprimés'}` : ''}`,
    !c.observing && `**En cours** : ${stateLine(c)}`,
    c.sample && `> ${c.sample.replace(/\s+/g, ' ').slice(0, 300)}${c.deleted > 1 ? ` *(et ${c.deleted - 1} autre${c.deleted > 2 ? 's' : ''})*` : ''}`,
  ].filter(Boolean);
  const container = new ContainerBuilder().setAccentColor(COLORS[severityOf(c)]);
  if (avatar) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text(header)).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)));
  else container.addTextDisplayComponents(text(header));
  container.addTextDisplayComponents(text(lines.join('\n')));
  if (c.events?.length) container.addSeparatorComponents(new SeparatorBuilder()).addTextDisplayComponents(text(c.events.slice(-6).map((e) => `-# ${stamp(e.at, 't')} · ${e.text}`).join('\n')));
  for (const row of caseButtons(c)) container.addActionRowComponents(row);
  return container;
}

async function details(guild, c) {
  const member = guild.members.cache.get(c.userId) ?? (await guild.members.fetch(c.userId).catch(() => null));
  const user = member?.user ?? (await guild.client.users.fetch(c.userId).catch(() => null));
  return { avatar: user?.displayAvatarURL?.({ size: 128 }) ?? null, joinedAt: member?.joinedTimestamp ?? null, createdAt: user?.createdTimestamp ?? null };
}

export async function cardPayload(guild, c) {
  return { components: [caseCard(c, await details(guild, c))], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

export async function openCase(guild, userId, data, now = Date.now()) {
  const c = { kind: 'spam', reasons: [], verdict: null, action: '', deleted: 1, sample: '', events: [], status: 'active', observing: false, ...data };
  const id = createCase(guild.id, userId, c, now);
  const opened = { ...c, id, guildId: guild.id, userId, at: now };
  bumpStat(guild.id, 'cas');
  const channel = logChannels(guild).moderation ?? logChannels(guild).logs;
  const sent = channel ? await channel.send(await cardPayload(guild, opened)).catch(() => null) : null;
  if (sent) {
    opened.messageId = sent.id;
    opened.channelLog = channel.id;
    saveCase(opened);
  }
  return opened;
}

export async function refreshCase(guild, id) {
  const c = getCase(id);
  const channel = c?.channelLog && guild.channels.cache.get(c.channelLog);
  const message = channel && (await channel.messages.fetch(c.messageId).catch(() => null));
  if (message) await message.edit(await cardPayload(guild, c)).catch(() => {});
}

export function updateCase(guild, id, change, { now = Date.now(), event = null } = {}) {
  const c = getCase(id);
  if (!c) return null;
  const next = { ...c, ...(typeof change === 'function' ? change(c) : change) };
  if (event) next.events = [...(c.events ?? []), { at: now, text: event }];
  saveCase(next);
  if (!timers.has(id)) timers.set(id, setTimeout(() => timers.delete(id) && refreshCase(guild, id), UPDATE_EVERY).unref?.() ?? true);
  return next;
}

export async function alertCase(guild, c, roleId, line) {
  const channel = c.channelLog && guild.channels.cache.get(c.channelLog);
  if (!channel || !roleId) return;
  await channel.send({ content: `<@&${roleId}> ${line}`, allowedMentions: { roles: [roleId] }, reply: c.messageId ? { messageReference: c.messageId, failIfNotExists: false } : undefined }).catch(() => {});
}

export function history(guildId, userId) {
  const list = casesOf(guildId, userId, 10);
  if (!list.length) return `Aucun cas pour <@${userId}>.`;
  return [`**Historique de <@${userId}>** (${list.length} dernier${list.length > 1 ? 's' : ''} cas)`, ...list.map((c) => `- #${c.id} · ${stamp(c.at, 'd')} · ${KINDS[c.kind] ?? c.kind} · ${c.action}${c.status === 'annulee' ? ' · **annulée**' : c.observing ? ' · observation' : ''}`)].join('\n');
}
