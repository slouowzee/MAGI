import { RESTJSONErrorCodes } from 'discord.js';
import { PERSONAS } from './personas.js';

const WEBHOOK_NAME = 'MAGI';
const cache = new Map();

async function webhookFor(channel) {
  const parent = channel.isThread() ? channel.parent : channel;
  const cached = cache.get(parent.id);
  if (cached) return cached;

  const me = channel.client.user.id;
  const existing = (await parent.fetchWebhooks()).find((wh) => wh.owner?.id === me && wh.name === WEBHOOK_NAME);
  const webhook = existing ?? (await parent.createWebhook({ name: WEBHOOK_NAME, reason: 'Voix des personas MAGI' }));
  cache.set(parent.id, webhook);
  return webhook;
}

function payload(channel, persona, content, components) {
  const { name, avatar } = PERSONAS[persona];
  return {
    content,
    components,
    withComponents: Boolean(components?.length),
    username: name,
    avatarURL: avatar,
    threadId: channel.isThread() ? channel.id : undefined,
    allowedMentions: { parse: [] },
  };
}

async function withWebhook(channel, action) {
  try {
    return await action(await webhookFor(channel));
  } catch (err) {
    if (err.code !== RESTJSONErrorCodes.UnknownWebhook) throw err;
    cache.delete((channel.isThread() ? channel.parent : channel).id);
    return action(await webhookFor(channel));
  }
}

export function speak(channel, persona, content, components) {
  return withWebhook(channel, (wh) => wh.send(payload(channel, persona, content, components)));
}
