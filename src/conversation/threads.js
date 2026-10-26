const EXPIRY = 10 * 60_000;
const FOLLOW_UP = 3 * 60_000;
const MAX_MESSAGES = 40;
const channels = new Map();
let nextId = 1;

function live(channelId, now) {
  const list = (channels.get(channelId) ?? []).filter((c) => now - c.at <= EXPIRY);
  channels.set(channelId, list);
  return list;
}

const latest = (list) => list.reduce((best, c) => (!best || c.at > best.at ? c : best), null);

export function findConversation({ channelId, authorId, referenceId, mentionIds = [], persona }, now = Date.now()) {
  const list = live(channelId, now);
  const quoted = referenceId && list.find((c) => c.messages.includes(referenceId));
  if (quoted) return quoted;
  const mentioned = latest(list.filter((c) => mentionIds.some((id) => c.participants.has(id))));
  if (mentioned) return mentioned;
  const mine = list.filter((c) => c.participants.has(authorId));
  return latest(mine.filter((c) => c.personas.has(persona))) ?? latest(mine);
}

export function followUpConversation(channelId, userId, now = Date.now()) {
  return latest(live(channelId, now).filter((c) => c.follow?.userId === userId && now <= c.follow.until));
}

export function openConversation({ channelId, guildId }, now = Date.now()) {
  const conversation = { id: nextId++, channelId, guildId, participants: new Set(), personas: new Set(), persona: null, messages: [], follow: null, startedAt: now, at: now };
  live(channelId, now).push(conversation);
  return conversation;
}

export function addMessage(conversation, messageId, authorId, now = Date.now()) {
  if (!conversation.messages.includes(messageId)) conversation.messages.push(messageId);
  if (conversation.messages.length > MAX_MESSAGES) conversation.messages.splice(0, conversation.messages.length - MAX_MESSAGES);
  if (authorId) conversation.participants.add(authorId);
  conversation.at = now;
}

export function answered(conversation, { persona, messageIds, userId, asked = false }, now = Date.now()) {
  conversation.persona = persona;
  conversation.personas.add(persona);
  for (const id of messageIds) addMessage(conversation, id, null, now);
  conversation.follow = userId ? { userId, asked, until: now + (asked ? EXPIRY : FOLLOW_UP) } : null;
}

export function awaitingAnswer(conversation, userId, now = Date.now()) {
  const follow = conversation?.follow;
  return Boolean(follow?.asked && follow.userId === userId && now <= follow.until);
}

export function closeConversation(conversation) {
  if (!conversation) return null;
  channels.set(conversation.channelId, (channels.get(conversation.channelId) ?? []).filter((c) => c !== conversation));
  return conversation;
}

export function expiredConversations(now = Date.now()) {
  const ended = [];
  for (const [channelId, list] of channels) {
    ended.push(...list.filter((c) => now - c.at > EXPIRY));
    channels.set(channelId, list.filter((c) => now - c.at <= EXPIRY));
  }
  return ended;
}
