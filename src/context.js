import { PERSONAS, personaByName } from './personas.js';

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
  return { author: msg.member?.displayName ?? msg.author.username, content: msg.content };
}

export async function conversationFor(message, persona, text) {
  const now = message.createdTimestamp;
  const fetched = await message.channel.messages.fetch({ limit: MAX_MESSAGES, before: message.id }).catch(() => null);
  const records = [...(fetched?.values() ?? [])]
    .filter((m) => now - m.createdTimestamp <= WINDOW)
    .reverse()
    .map((m) => record(m, message.client.user.id))
    .filter(Boolean);
  records.push({ author: message.member?.displayName ?? message.author.username, content: text });
  return toConversation(records, persona);
}
