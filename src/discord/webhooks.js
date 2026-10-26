import { escapeMarkdown, RESTJSONErrorCodes } from 'discord.js';
import { readFileSync } from 'node:fs';
import { PERSONAS } from '../personas.js';

const AVATAR_VERSION = 12;
const cache = new Map();
const cleanups = new Map();
const avatarFile = (persona) => readFileSync(new URL(`../../assets/avatars/${persona}.png`, import.meta.url));
const webhookName = (persona) => `MAGI ${PERSONAS[persona].name} v${AVATAR_VERSION}`;
const CURRENT = new Set(Object.keys(PERSONAS).map(webhookName));
const parentOf = (channel) => (channel.isThread() ? channel.parent : channel);
const keyOf = (channel, persona) => `${parentOf(channel).id}:${persona}`;

export function personaOf(msg) {
  if (!msg.webhookId || msg.applicationId !== msg.client.application?.id) return null;
  return Object.keys(PERSONAS).find((key) => [PERSONAS[key].name, PERSONAS[key].legacy].includes(msg.author.username)) ?? null;
}

async function loadWebhook(parent, persona) {
  const me = parent.client.user.id;
  const owned = (await parent.fetchWebhooks()).filter((wh) => wh.owner?.id === me);
  if (!cleanups.has(parent.id)) {
    const old = owned.filter((wh) => wh.name.startsWith('MAGI') && !CURRENT.has(wh.name));
    cleanups.set(parent.id, Promise.all(old.map((wh) => wh.delete('Ancienne version des avatars').catch(() => {}))));
  }
  await cleanups.get(parent.id);
  return (
    owned.find((wh) => wh.name === webhookName(persona)) ??
    (await parent.createWebhook({ name: webhookName(persona), avatar: avatarFile(persona), reason: `Voix de ${PERSONAS[persona].name}` }))
  );
}

function webhookFor(channel, persona) {
  const key = keyOf(channel, persona);
  if (!cache.has(key)) {
    const pending = loadWebhook(parentOf(channel), persona).catch((err) => {
      if (cache.get(key) === pending) cache.delete(key);
      throw err;
    });
    cache.set(key, pending);
  }
  return cache.get(key);
}

export const REPLY_HEADER = /^-# ↪ <@(\d+)>[^\n]*\n?/;

export function replyHeader(msg) {
  const text = msg.content.replace(/https?:\/\/\S+/g, 'lien').replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
  const snippet = text.length > 50 ? `${text.slice(0, 50)}…` : text || 'message';
  return `-# ↪ <@${msg.author.id}> [${escapeMarkdown(snippet)}](${msg.url})`;
}

function payload(channel, persona, content, { components, embeds, mentions = [], replyTo }) {
  const { name, avatar } = PERSONAS[persona];
  return {
    content: replyTo ? `${replyHeader(replyTo)}\n${content}` : content,
    components,
    embeds,
    withComponents: Boolean(components?.length),
    username: name,
    avatarURL: avatar,
    threadId: channel.isThread() ? channel.id : undefined,
    allowedMentions: { parse: [], users: mentions },
  };
}

async function withWebhook(channel, persona, action) {
  const pending = webhookFor(channel, persona);
  try {
    return await action(await pending);
  } catch (err) {
    if (err.code !== RESTJSONErrorCodes.UnknownWebhook) throw err;
    const key = keyOf(channel, persona);
    if (cache.get(key) === pending) cache.delete(key);
    return action(await webhookFor(channel, persona));
  }
}

export function speak(channel, persona, content, options = {}) {
  return withWebhook(channel, persona, (wh) => wh.send(payload(channel, persona, content, options)));
}
