import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { conversationPrompt, describe, toTranscript } from './history.js';

test('chaque ligne porte son auteur, la persona se reconnaît et voit à qui elle répondait', () => {
  const lines = toTranscript(
    [
      { author: 'starf__', content: 'Encule ta pote' },
      { speaker: 'casper', content: 'Original.', replyTo: 'starf__' },
      { author: 'Faceless', content: "t'es nulle en répartie" },
      { speaker: 'melchior', content: 'Les deux se valent.' },
      { author: 'Faceless', content: 'prouve-le', replyTo: 'Casper' },
    ],
    'casper',
  );
  assert.deepEqual(lines, [
    'starf__ : Encule ta pote',
    'Toi, Casper (à starf__) : Original.',
    "Faceless : t'es nulle en répartie",
    'Melchior (MAGI) : Les deux se valent.',
    'Faceless (en réponse à Casper) : prouve-le',
  ]);
});

test('la consigne finale désigne la personne à qui répondre', () => {
  const prompt = conversationPrompt(['Slou : magi, on en est où ?', 'Faceless : dommage Casper'], 'Faceless');
  assert.match(prompt, /Faceless : dommage Casper\n\nTu réponds maintenant à Faceless/);
});

test('ignore les messages vides et tronque les longs', () => {
  const lines = toTranscript([{ author: 'A', content: '   ' }, { author: 'B', content: 'x'.repeat(1000) }], 'melchior');
  assert.deepEqual(lines, [`B : ${'x'.repeat(600)}`]);
});

test('gifs et pièces jointes signalés', () => {
  const msg = {
    content: 'regarde https://tenor.com/view/edaters-when-discord-is-down-123',
    attachments: new Map([['1', { contentType: 'image/png' }]]),
    stickers: new Map(),
  };
  assert.equal(describe(msg), 'regarde [gif] [image]');
});

test("l'en-tête de réponse d'une persona n'apparaît pas dans le contexte", () => {
  assert.equal(describe({ content: '-# ↪ <@42> [dommage Casper](https://discord.com/channels/1/2/3)\nProfite, ça ne durera pas.' }), 'Profite, ça ne durera pas.');
});

test('emojis personnalisés réduits à leur nom', () => {
  assert.equal(describe({ content: "j'te shutdown <a:nerd_fast:1159963109797134377> <:pepe:123456789012345678>" }), "j'te shutdown :nerd_fast: :pepe:");
});
