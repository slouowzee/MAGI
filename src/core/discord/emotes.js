import { log } from '../log/log.js';

const emotes = new Map();

export async function loadEmotes(client) {
  const found = await client.application.emojis.fetch().catch((err) => log.warning('bot', `emotes de l'application illisibles : ${err.message}`));
  emotes.clear();
  for (const emote of found?.values() ?? []) emotes.set(emote.name, emote);
  return emotes.size;
}

export const unitEmote = (persona, name, fallback = null) => emotes.get(`${persona}_${name}`) ?? fallback;
