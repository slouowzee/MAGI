import { personaLabel } from '../personas.js';
import { personaOf } from './webhooks.js';

const MAX_MESSAGES = 12;
const WINDOW = 30 * 60_000;
const MAX_CHARS = 600;
const GIF_LINK = /https?:\/\/(?:[\w-]+\.)*(?:tenor\.com|giphy\.com)\/\S+/gi;

function kind(attachment) {
  const type = attachment.contentType ?? '';
  if (type === 'image/gif') return 'gif';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'vidéo';
  if (type.startsWith('audio/')) return 'audio';
  return 'fichier';
}

export function describe(msg, text = msg.content) {
  const parts = [text.replace(GIF_LINK, '[gif]').trim()];
  for (const attachment of msg.attachments?.values() ?? []) parts.push(`[${kind(attachment)}]`);
  for (const sticker of msg.stickers?.values() ?? []) parts.push(`[sticker ${sticker.name}]`);
  return parts.filter(Boolean).join(' ');
}

function nameOf(msg) {
  const persona = personaOf(msg);
  if (persona) return personaLabel(persona);
  return msg.member?.displayName ?? msg.author.globalName ?? msg.author.username;
}

function replyTarget(msg) {
  const user = msg.mentions?.repliedUser;
  if (!user) return null;
  if (user.bot) return user.username;
  return msg.guild?.members.cache.get(user.id)?.displayName ?? user.globalName ?? user.username;
}

function header(author, replyTo) {
  return replyTo ? `${author} (en réponse à ${replyTo})` : author;
}

export function toConversation(records, persona) {
  const turns = [];
  for (const { author, speaker, content, replyTo } of records) {
    const text = content.trim().slice(0, MAX_CHARS);
    if (!text) continue;
    const role = speaker === persona ? 'assistant' : 'user';
    const line = role === 'assistant' ? text : `${header(speaker ? personaLabel(speaker) : author, replyTo)} : ${text}`;
    const last = turns.at(-1);
    if (last?.role === role) last.content += `\n${line}`;
    else turns.push({ role, content: line });
  }
  return turns;
}

function record(msg, botId) {
  if (msg.webhookId) {
    const speaker = personaOf(msg);
    return speaker ? { speaker, content: msg.content, replyTo: replyTarget(msg) } : null;
  }
  if (msg.author.bot || msg.author.id === botId) return null;
  return { userId: msg.author.id, author: nameOf(msg), content: describe(msg), replyTo: replyTarget(msg) };
}

export function transcriptLine(msg) {
  if (msg.webhookId && !personaOf(msg)) return null;
  const text = describe(msg).slice(0, 400);
  return text ? `${header(nameOf(msg), replyTarget(msg))} : ${text}` : null;
}

export async function conversationFor(message, persona, text) {
  const now = message.createdTimestamp;
  const fetched = await message.channel.messages.fetch({ limit: MAX_MESSAGES, before: message.id }).catch(() => null);
  const records = [...(fetched?.values() ?? [])]
    .filter((m) => now - m.createdTimestamp <= WINDOW)
    .reverse()
    .map((m) => record(m, message.client.user.id))
    .filter(Boolean);
  records.push({ userId: message.author.id, author: nameOf(message), content: describe(message, text), replyTo: replyTarget(message) });
  const participants = [...new Map(records.filter((r) => r.userId).map((r) => [r.userId, { id: r.userId, name: r.author }])).values()];
  return { turns: toConversation(records, persona), participants };
}
