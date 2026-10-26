import { StickerFormatType } from 'discord.js';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CACHED = 30;
const SUPPORTED = /^(?:image\/(?:png|jpeg|webp|gif)|video\/(?:mp4|webm|quicktime))$/;
const cache = new Map();

export function mediaOf(msg) {
  const items = [];
  for (const attachment of msg.attachments?.values() ?? []) {
    if (SUPPORTED.test(attachment.contentType ?? '') && (attachment.size ?? 0) <= MAX_BYTES) items.push({ url: attachment.url, mime: attachment.contentType });
  }
  for (const embed of msg.embeds ?? []) {
    const animated = embed.data?.type === 'gifv';
    if (animated && embed.thumbnail?.url) items.push({ url: embed.thumbnail.url });
    else if (animated && embed.video?.url) items.push({ url: embed.video.url, mime: 'video/mp4' });
    else if (embed.image?.url) items.push({ url: embed.image.url });
    else if (embed.data?.type === 'image' && embed.thumbnail?.url) items.push({ url: embed.thumbnail.url });
  }
  for (const sticker of msg.stickers?.values() ?? []) {
    if (sticker.format !== StickerFormatType.Lottie && sticker.url) items.push({ url: sticker.url });
  }
  return items;
}

export async function inline({ url, mime }) {
  if (cache.has(url)) return cache.get(url);
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res?.ok) return null;
  const type = (mime ?? res.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!SUPPORTED.test(type)) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_BYTES) return null;
  const data = `data:${type};base64,${buffer.toString('base64')}`;
  cache.set(url, data);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
  return data;
}
