import { PERSONAS, personaLabel } from '../personas.js';
import { personaOf, REPLY_HEADER } from './webhooks.js';
import { isOperator } from '../server/installation.js';
import { inline, mediaOf } from './media.js';

const MAX_MESSAGES = 12;
const MAX_CONTEXT = 20;
const WINDOW = 30 * 60_000;
const MAX_CHARS = 600;
const MAX_MEDIA = 3;
const MAX_QUOTED = 3;
const LEAD_IN = 2 * 60_000;
const CUSTOM_EMOJI = /<a?:(\w+):\d+>/g;
const MAX_REMEMBERED = 500;
const GIF_LINK = /https?:\/\/(?:[\w-]+\.)*(?:tenor\.com|giphy\.com)\/\S+/gi;
const HAS_GIF_LINK = /https?:\/\/(?:[\w-]+\.)*(?:tenor\.com|giphy\.com)\//i;
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
  const parts = [text.replace(REPLY_HEADER, '').replace(GIF_LINK, '[gif]').replace(CUSTOM_EMOJI, ':$1:').trim()];
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

function label({ author, speaker, replyTo, role, quoted }, persona) {
  const self = speaker === persona;
  const name = speaker ? (self ? `Toi, ${PERSONAS[persona].name}` : PERSONAS[speaker].name) : author;
  const notes = [speaker && !self && 'MAGI', quoted && 'message cité', role, replyTo && (speaker ? `à ${replyTo}` : `en réponse à ${replyTo}`)].filter(Boolean);
  return notes.length ? `${name} (${notes.join(', ')})` : name;
}

function roleOf(msg) {
  if (msg.author.id === msg.guild?.ownerId) return 'propriétaire du serveur';
  return msg.member && isOperator(msg.member) ? 'opérateur MAGI' : null;
}

export function toTranscript(records, persona) {
  return records
    .map((record) => {
      const text = record.content.trim().slice(0, MAX_CHARS);
      const pieces = record.pieces?.length ? ` [pièce jointe n°${record.pieces.join(', n°')}]` : '';
      return text ? `${label(record, persona)} : ${text}${pieces}` : null;
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

function quotedId(msg) {
  if (msg.webhookId) return msg.content.match(REPLY_HEADER)?.[0].match(/\/(\d+)\)\s*$/)?.[1] ?? null;
  return msg.reference?.messageId ?? null;
}

function record(msg, botId) {
  if (msg.webhookId) {
    const speaker = personaOf(msg);
    return speaker ? { id: msg.id, speaker, content: describe(msg), replyTo: replyTarget(msg) } : null;
  }
  if (msg.author.bot || msg.author.id === botId) return null;
  return { id: msg.id, msg, userId: msg.author.id, author: displayName(msg), role: roleOf(msg), content: describe(msg), replyTo: replyTarget(msg) };
}

async function attachMedia(records) {
  const wanted = [];
  for (const record of [...records].reverse()) {
    for (const item of (record.msg ? mediaOf(record.msg) : []).reverse()) if (wanted.length < MAX_MEDIA) wanted.push({ record, item });
  }
  wanted.reverse();
  const parts = [];
  for (const { record, item } of wanted) {
    const data = await inline(item);
    if (!data) continue;
    const n = parts.length / 2 + 1;
    record.pieces = [...(record.pieces ?? []), n];
    parts.push({ type: 'text', text: `Pièce jointe n°${n} :` }, { type: 'image_url', image_url: { url: data } });
  }
  return parts;
}

export function transcriptLine(msg) {
  const speaker = personaOf(msg);
  if (msg.webhookId && !speaker) return null;
  const text = describe(msg).slice(0, 400);
  return text ? `${label({ author: displayName(msg), speaker, replyTo: replyTarget(msg) }, null)} : ${text}` : null;
}

export async function conversationFor(message, persona, text, conversation = null, claimed = () => false) {
  const now = message.createdTimestamp;
  const botId = message.client.user.id;
  const fresh = conversation && conversation.messages.length <= 1;
  const leadIn = (m) => fresh && m.author?.id === message.author.id && now - m.createdTimestamp <= LEAD_IN && !claimed(m.id);
  const belongs = (m) => conversation.messages.includes(m.id) || leadIn(m);
  const fetched = await message.channel.messages.fetch({ limit: conversation ? 50 : MAX_MESSAGES, before: message.id }).catch(() => null);
  const records = [...(fetched?.values() ?? [])]
    .filter((m) => (conversation ? belongs(m) : now - m.createdTimestamp <= WINDOW))
    .reverse()
    .map((m) => record(m, botId))
    .filter(Boolean)
    .slice(-MAX_CONTEXT);
  let quotedRef = message.reference?.messageId;
  for (let depth = 0; quotedRef && depth < MAX_QUOTED && !records.some((r) => r.id === quotedRef); depth++) {
    const m = await message.channel.messages.fetch(quotedRef).catch(() => null);
    const quoted = m && record(m, botId);
    if (!quoted) break;
    records.unshift({ ...quoted, quoted: true });
    quotedRef = quotedId(m);
  }
  const target = displayName(message);
  const unfurled = mediaOf(message).length || !HAS_GIF_LINK.test(message.content) ? message : await Bun.sleep(1_500).then(() => message.channel.messages.fetch(message.id)).catch(() => message);
  records.push({ id: message.id, msg: unfurled, userId: message.author.id, author: target, role: roleOf(message), content: describe(message, text), replyTo: replyTarget(message) });
  const participants = [...new Map(records.filter((r) => r.userId).map((r) => [r.userId, { id: r.userId, name: r.author }])).values()];
  const media = await attachMedia(records);
  const prompt = conversationPrompt(toTranscript(records, persona), target);
  const included = records.map((r) => r.id).filter(Boolean);
  return { turns: [{ role: 'user', content: media.length ? [{ type: 'text', text: prompt }, ...media] : prompt }], participants, target, included };
}
