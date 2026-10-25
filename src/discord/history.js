import { PERSONAS, personaByName } from '../personas.js';

const MAX_MESSAGES = 12;
const WINDOW = 30 * 60_000;
const MAX_CHARS = 600;

export function toConversation(records, persona) {
  const turns = [];
  for (const { author, speaker, content } of records) {
    const text = content.trim().slice(0, MAX_CHARS);
    if (!text) continue;
    const role = speaker === persona ? 'assistant' : 'user';
    const line = role === 'assistant' ? text : `${speaker ? PERSONAS[speaker].name : author} : ${text}`;
    const last = turns.at(-1);
    if (last?.role === role) last.content += `\n${line}`;
    else turns.push({ role, content: line });
  }
  return turns;
}

function record(msg, botId) {
  if (msg.webhookId) {
    const speaker = personaByName(msg.author.username);
    return speaker ? { speaker, content: msg.content } : null;
  }
  if (msg.author.bot || msg.author.id === botId) return null;
  return { userId: msg.author.id, author: msg.member?.displayName ?? msg.author.username, content: msg.content };
}

export function transcriptLine(msg) {
  const persona = msg.webhookId ? personaByName(msg.author.username) : null;
  if (msg.webhookId && !persona) return null;
  const author = persona ? PERSONAS[persona].name : msg.member?.displayName ?? msg.author.username;
  return msg.content.trim() ? `${author} : ${msg.content.trim().slice(0, 400)}` : null;
}

export async function conversationFor(message, persona, text) {
  const now = message.createdTimestamp;
  const fetched = await message.channel.messages.fetch({ limit: MAX_MESSAGES, before: message.id }).catch(() => null);
  const records = [...(fetched?.values() ?? [])]
    .filter((m) => now - m.createdTimestamp <= WINDOW)
    .reverse()
    .map((m) => record(m, message.client.user.id))
    .filter(Boolean);
  records.push({ userId: message.author.id, author: message.member?.displayName ?? message.author.username, content: text });
  const participants = [...new Map(records.filter((r) => r.userId).map((r) => [r.userId, { id: r.userId, name: r.author }])).values()];
  return { turns: toConversation(records, persona), participants };
}
