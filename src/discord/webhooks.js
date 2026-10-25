import { RESTJSONErrorCodes } from 'discord.js';
import { readFileSync } from 'node:fs';
import { PERSONAS } from '../personas.js';

const AVATAR_VERSION = 12;
const cache = new Map();
const avatarFile = (persona) => readFileSync(new URL(`../../assets/avatars/${persona}.png`, import.meta.url));
const webhookName = (persona) => `MAGI ${PERSONAS[persona].name} v${AVATAR_VERSION}`;
const CURRENT = new Set(Object.keys(PERSONAS).map(webhookName));
const parentOf = (channel) => (channel.isThread() ? channel.parent : channel);

async function webhookFor(channel, persona) {
  const parent = parentOf(channel);
  const key = `${parent.id}:${persona}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const me = channel.client.user.id;
  const owned = (await parent.fetchWebhooks()).filter((wh) => wh.owner?.id === me);
  for (const old of owned.filter((wh) => wh.name.startsWith('MAGI') && !CURRENT.has(wh.name)).values()) await old.delete('Ancienne version des avatars').catch(() => {});
  const webhook =
    owned.find((wh) => wh.name === webhookName(persona)) ??
    (await parent.createWebhook({ name: webhookName(persona), avatar: avatarFile(persona), reason: `Voix de ${PERSONAS[persona].name}` }));
  cache.set(key, webhook);
  return webhook;
}

function payload(channel, persona, content, components, mentions = []) {
  const { name, avatar } = PERSONAS[persona];
  return {
    content,
    components,
    withComponents: Boolean(components?.length),
    username: name,
    avatarURL: avatar,
    threadId: channel.isThread() ? channel.id : undefined,
    allowedMentions: { parse: [], users: mentions },
  };
}

async function withWebhook(channel, persona, action) {
  try {
    return await action(await webhookFor(channel, persona));
  } catch (err) {
    if (err.code !== RESTJSONErrorCodes.UnknownWebhook) throw err;
    cache.delete(`${parentOf(channel).id}:${persona}`);
    return action(await webhookFor(channel, persona));
  }
}

export function speak(channel, persona, content, components, mentions) {
  return withWebhook(channel, persona, (wh) => wh.send(payload(channel, persona, content, components, mentions)));
}
