import { StickerFormatType } from 'discord.js';
import { moduleEnabled } from '../config.js';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CACHED = 30;
const MIN_VIDEO_SECONDS = 0.5;
const SUPPORTED = /^(?:image\/(?:png|jpeg|webp|gif)|video\/(?:mp4|webm|quicktime)|audio\/(?:ogg|mpeg|mp3|wav|x-wav|mp4|aac|webm))$/;
const cache = new Map();

export function mediaOf(msg) {
  const items = [];
  for (const attachment of msg.attachments?.values() ?? []) {
    const type = attachment.contentType ?? '';
    if (type.startsWith('audio/') && !(msg.guild && moduleEnabled(msg.guild.id, 'vocaux'))) continue;
    if (SUPPORTED.test(type) && (attachment.size ?? 0) <= MAX_BYTES) items.push({ url: attachment.url, mime: type });
  }
  for (const embed of msg.embeds ?? []) {
    const animated = embed.data?.type === 'gifv';
    if (animated && embed.video?.proxyURL) items.push({ url: embed.video.proxyURL, mime: 'video/mp4', still: embed.thumbnail?.proxyURL });
    else if (animated && embed.thumbnail?.proxyURL) items.push({ url: embed.thumbnail.proxyURL });
    else if (embed.image?.proxyURL) items.push({ url: embed.image.proxyURL });
    else if (embed.data?.type === 'image' && embed.thumbnail?.proxyURL) items.push({ url: embed.thumbnail.proxyURL });
  }
  for (const sticker of msg.stickers?.values() ?? []) {
    if (sticker.format !== StickerFormatType.Lottie && sticker.url) items.push({ url: sticker.url });
  }
  return items;
}

export function emotesOf(msg) {
  const emotes = new Map((msg.content ?? '').matchAll(/<a?:(\w+):(\d+)>/g).map(([, name, id]) => [id, name]));
  return [...emotes].map(([id, name]) => ({ url: `https://cdn.discordapp.com/emojis/${id}.png?size=96`, label: `emote :${name}:` }));
}

export function mp4Seconds(buffer) {
  const at = buffer.indexOf('mvhd');
  if (at < 0 || at + 32 > buffer.length) return null;
  const long = buffer[at + 4] === 1;
  const scale = buffer.readUInt32BE(at + (long ? 24 : 16));
  const duration = long ? Number(buffer.readBigUInt64BE(at + 28)) : buffer.readUInt32BE(at + 20);
  return scale ? duration / scale : null;
}

export async function fetchLimited(url, maxBytes = MAX_BYTES) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok || Number(res.headers.get('content-length')) > maxBytes) return null;
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) return null;
      chunks.push(chunk);
    }
    return { buffer: Buffer.concat(chunks), type: res.headers.get('content-type') };
  } catch {
    return null;
  }
}

export async function inline({ url, mime, still }) {
  if (cache.has(url)) return cache.get(url);
  const file = await fetchLimited(url);
  if (!file) return null;
  const { buffer } = file;
  const type = (mime ?? file.type ?? '').split(';')[0].trim();
  if (!SUPPORTED.test(type)) return null;
  if (type === 'video/mp4' && (mp4Seconds(buffer) ?? 1) < MIN_VIDEO_SECONDS) return still ? inline({ url: still }) : null;
  const data = `data:${type};base64,${buffer.toString('base64')}`;
  cache.set(url, data);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
  return data;
}
