import { test, expect } from 'bun:test';
import { emotesOf, inline, mediaOf, mp4Seconds } from './media.js';

function mp4(seconds) {
  const header = Buffer.alloc(32);
  header.write('mvhd', 0);
  header.writeUInt32BE(1000, 16);
  header.writeUInt32BE(Math.round(seconds * 1000), 20);
  return Buffer.concat([Buffer.from('\0\0\0\x20ftypisom'), header]);
}

const files = { 'https://gif.test/court.mp4': mp4(0.3), 'https://gif.test/long.mp4': mp4(2), 'https://gif.test/fixe.webp': Buffer.from('RIFF') };
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => (files[url] ? Promise.resolve(new Response(files[url], { headers: { 'content-type': url.endsWith('webp') ? 'image/webp' : 'video/mp4' } })) : realFetch(url, init));

const gifv = (video) => ({ embeds: [{ data: { type: 'gifv' }, video: { url: video }, thumbnail: { url: 'https://gif.test/fixe.webp' } }] });

test('emotes du serveur : une image par emote distincte, animées comprises', () => {
  expect(emotesOf({ content: 'ok <:casper_juge:12> <a:danse:34> <:casper_juge:12>' })).toEqual([
    { url: 'https://cdn.discordapp.com/emojis/12.png?size=96', label: 'emote :casper_juge:' },
    { url: 'https://cdn.discordapp.com/emojis/34.png?size=96', label: 'emote :danse:' },
  ]);
  expect(emotesOf({ content: 'rien' })).toEqual([]);
  expect(emotesOf({})).toEqual([]);
});

test('durée lue dans l’en-tête mp4', () => {
  expect(mp4Seconds(mp4(0.3))).toBe(0.3);
  expect(mp4Seconds(Buffer.from('rien'))).toBeNull();
});

test('gif animé : la vidéo entière, sauf si elle est trop courte pour Gemini', async () => {
  const [long] = mediaOf(gifv('https://gif.test/long.mp4'));
  expect(await inline(long)).toStartWith('data:video/mp4;base64,');
  const [court] = mediaOf(gifv('https://gif.test/court.mp4'));
  expect(await inline(court)).toBe(`data:image/webp;base64,${files['https://gif.test/fixe.webp'].toString('base64')}`);
});

test('messages vocaux joints seulement si le module est actif', async () => {
  const { setModules, MODULES } = await import('../config.js');
  const msg = { guild: { id: 'g-vocaux' }, attachments: new Map([['1', { url: 'https://cdn.test/vocal.ogg', contentType: 'audio/ogg', size: 2000 }]]) };
  expect(mediaOf(msg)).toEqual([{ url: 'https://cdn.test/vocal.ogg', mime: 'audio/ogg' }]);
  setModules('g-vocaux', Object.keys(MODULES).filter((m) => m !== 'vocaux'));
  expect(mediaOf(msg)).toEqual([]);
});
