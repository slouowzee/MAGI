import { deleteConversation, lastConversationId, loadConversations, saveConversation } from './store.js';

const EXPIRY = 10 * 60_000;
const FOLLOW_UP = 3 * 60_000;
const MAX_MESSAGES = 40;
const MAX_LINES = 6;
const channels = new Map();
let nextId = lastConversationId() + 1;

function stored(channelId) {
  if (!channels.has(channelId)) channels.set(channelId, []);
  return channels.get(channelId);
}

for (const c of loadConversations(Date.now() - 24 * 3600_000)) stored(c.channelId).push(c);

function live(channelId, now) {
  return stored(channelId).filter((c) => now - c.at <= EXPIRY);
}

const latest = (list) => list.reduce((best, c) => (!best || c.at > best.at ? c : best), null);

export function locateConversation({ channelId, authorId, referenceId, mentionIds = [], persona }, now = Date.now()) {
  const list = live(channelId, now);
  const quoted = referenceId && list.find((c) => c.messages.includes(referenceId));
  if (quoted) return { conversation: quoted, by: 'reference' };
  const mentioned = latest(list.filter((c) => mentionIds.some((id) => c.participants.has(id))));
  if (mentioned) return { conversation: mentioned, by: 'mention' };
  const mine = list.filter((c) => c.participants.has(authorId));
  const withPersona = latest(mine.filter((c) => c.personas.has(persona)));
  if (withPersona) return { conversation: withPersona, by: 'persona' };
  const recent = latest(mine);
  return { conversation: recent, by: recent ? 'author' : null };
}

export function followUpConversation(channelId, userId, now = Date.now()) {
  return latest(live(channelId, now).filter((c) => c.follow?.userId === userId && now <= c.follow.until));
}

export function openConversation({ channelId, guildId }, now = Date.now()) {
  const conversation = { id: nextId++, channelId, guildId, participants: new Set(), personas: new Set(), persona: null, messages: [], lines: [], follow: null, startedAt: now, at: now };
  stored(channelId).push(conversation);
  saveConversation(conversation);
  return conversation;
}

export function addMessage(conversation, messageId, authorId, now = Date.now(), line = null) {
  if (line) conversation.lines = [...conversation.lines, line.slice(0, 200)].slice(-MAX_LINES);
  if (!conversation.messages.includes(messageId)) conversation.messages.push(messageId);
  if (conversation.messages.length > MAX_MESSAGES) conversation.messages.splice(0, conversation.messages.length - MAX_MESSAGES);
  if (authorId) conversation.participants.add(authorId);
  conversation.at = now;
  saveConversation(conversation);
}

export function answered(conversation, { persona, messageIds, userId, asked = false, text = null }, now = Date.now()) {
  conversation.persona = persona;
  conversation.personas.add(persona);
  for (const id of messageIds) addMessage(conversation, id, null, now);
  if (text) conversation.lines = [...conversation.lines, `${persona} : ${text.slice(0, 200)}`].slice(-MAX_LINES);
  conversation.follow = userId ? { userId, asked, until: now + (asked ? EXPIRY : FOLLOW_UP) } : null;
  saveConversation(conversation);
}

export function awaitingAnswer(conversation, userId, now = Date.now()) {
  const follow = conversation?.follow;
  return Boolean(follow?.asked && follow.userId === userId && now <= follow.until);
}

export function closeConversation(conversation) {
  if (!conversation) return null;
  channels.set(conversation.channelId, stored(conversation.channelId).filter((c) => c !== conversation));
  deleteConversation(conversation.id);
  return conversation;
}

export function closeAllConversations(guildId) {
  let closed = 0;
  for (const list of channels.values()) for (const c of [...list]) if (c.guildId === guildId && closeConversation(c)) closed++;
  return closed;
}

export function expiredConversations(now = Date.now()) {
  const ended = [];
  for (const [channelId, list] of channels) {
    const gone = list.filter((c) => now - c.at > EXPIRY);
    for (const c of gone) deleteConversation(c.id);
    ended.push(...gone);
    channels.set(channelId, list.filter((c) => now - c.at <= EXPIRY));
  }
  return ended;
}

export function isClaimed(channelId, messageId, now = Date.now()) {
  return live(channelId, now).some((c) => c.messages.includes(messageId));
}
