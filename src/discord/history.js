import { PERSONAS, personaLabel } from '../personas.js';
import { personaOf, REPLY_HEADER } from './webhooks.js';

const MAX_MESSAGES = 12;
const WINDOW = 30 * 60_000;
const MAX_CHARS = 600;
const MAX_REMEMBERED = 500;
const GIF_LINK = /https?:\/\/(?:[\w-]+\.)*(?:tenor\.com|giphy\.com)\/\S+/gi;
const answeredTo = new Map();

function kind(attachment) {
  const type = attachment.contentType ?? '';
  if (type === 'image/gif') return 'gif';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'vidéo';
  if (type.startsWith('audio/')) return 'audio';
  return 'fichier';
}

export function describe(msg, text = msg.content) {
  const parts = [text.replace(REPLY_HEADER, '').replace(GIF_LINK, '[gif]').trim()];
  for (const attachment of msg.attachments?.values() ?? []) parts.push(`[${kind(attachment)}]`);
  for (const sticker of msg.stickers?.values() ?? []) parts.push(`[sticker ${sticker.name}]`);
  return parts.filter(Boolean).join(' ');
}

export function displayName(msg) {
  const persona = personaOf(msg);
  if (persona) return personaLabel(persona);
  return msg.member?.displayName ?? msg.author.globalName ?? msg.author.username;
}

export function rememberAnswer(sent, name) {
  if (!sent?.id) return;
  answeredTo.set(sent.id, name);
  if (answeredTo.size > MAX_REMEMBERED) answeredTo.delete(answeredTo.keys().next().value);
}

function replyTarget(msg) {
  if (answeredTo.has(msg.id)) return answeredTo.get(msg.id);
  const quoted = msg.webhookId && msg.content.match(REPLY_HEADER)?.[1];
  if (quoted) return msg.guild?.members.cache.get(quoted)?.displayName ?? null;
  const user = msg.mentions?.repliedUser;
  if (!user) return null;
  if (user.bot) return user.username;
  return msg.guild?.members.cache.get(user.id)?.displayName ?? user.globalName ?? user.username;
}

function label({ author, speaker, replyTo }, persona) {
  if (speaker) {
    const name = speaker === persona ? `Toi, ${PERSONAS[persona].name}` : personaLabel(speaker);
    return replyTo ? `${name} (à ${replyTo})` : name;
  }
  return replyTo ? `${author} (en réponse à ${replyTo})` : author;
}

export function toTranscript(records, persona) {
  return records
    .map((record) => {
      const text = record.content.trim().slice(0, MAX_CHARS);
      return text ? `${label(record, persona)} : ${text}` : null;
    })
    .filter(Boolean);
}

export function conversationPrompt(lines, target) {
  return [
    'Messages récents du salon, du plus ancien au plus récent :',
    ...lines,
    '',
    `Tu réponds maintenant à ${target}, dont le message est le dernier ci-dessus. Les autres messages sont du contexte : chaque ligne est de la personne nommée au début, ne prête pas à ${target} ce qu'une autre personne a dit et ne réponds pas à sa place. Les lignes « Toi » sont tes propres messages, adressés à la personne indiquée.`,
  ].join('\n');
}

function record(msg, botId) {
  if (msg.webhookId) {
    const speaker = personaOf(msg);
    return speaker ? { speaker, content: describe(msg), replyTo: replyTarget(msg) } : null;
  }
  if (msg.author.bot || msg.author.id === botId) return null;
  return { userId: msg.author.id, author: displayName(msg), content: describe(msg), replyTo: replyTarget(msg) };
}

export function transcriptLine(msg) {
  const speaker = personaOf(msg);
  if (msg.webhookId && !speaker) return null;
  const text = describe(msg).slice(0, 400);
  return text ? `${label({ author: displayName(msg), speaker, replyTo: replyTarget(msg) }, null)} : ${text}` : null;
}

export async function conversationFor(message, persona, text) {
  const now = message.createdTimestamp;
  const fetched = await message.channel.messages.fetch({ limit: MAX_MESSAGES, before: message.id }).catch(() => null);
  const records = [...(fetched?.values() ?? [])]
    .filter((m) => now - m.createdTimestamp <= WINDOW)
    .reverse()
    .map((m) => record(m, message.client.user.id))
    .filter(Boolean);
  const target = displayName(message);
  records.push({ userId: message.author.id, author: target, content: describe(message, text), replyTo: replyTarget(message) });
  const participants = [...new Map(records.filter((r) => r.userId).map((r) => [r.userId, { id: r.userId, name: r.author }])).values()];
  return { turns: [{ role: 'user', content: conversationPrompt(toTranscript(records, persona), target) }], participants, target };
}
