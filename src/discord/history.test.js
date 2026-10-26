import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { describe, toConversation } from './history.js';

test('les messages de la persona deviennent ses tours, les autres sont attribués', () => {
  const turns = toConversation(
    [
      { author: 'Slou', content: 'magi, pizza ou sushi ?' },
      { speaker: 'casper', content: 'Sushi, évidemment.' },
      { author: 'Léa', content: 'moi je dis pizza' },
      { speaker: 'melchior', content: 'Les deux se valent.' },
      { author: 'Slou', content: 'et toi casper, pourquoi ?' },
    ],
    'casper',
  );
  assert.deepEqual(turns, [
    { role: 'user', content: 'Slou : magi, pizza ou sushi ?' },
    { role: 'assistant', content: 'Sushi, évidemment.' },
    { role: 'user', content: 'Léa : moi je dis pizza\nMelchior (MAGI) : Les deux se valent.\nSlou : et toi casper, pourquoi ?' },
  ]);
});

test('ignore les messages vides et tronque les longs', () => {
  const turns = toConversation([{ author: 'A', content: '   ' }, { author: 'B', content: 'x'.repeat(1000) }], 'melchior');
  assert.equal(turns.length, 1);
  assert.equal(turns[0].content, `B : ${'x'.repeat(600)}`);
});

test('gifs et pièces jointes signalés, destinataire des réponses indiqué', () => {
  const msg = {
    content: 'regarde https://tenor.com/view/edaters-when-discord-is-down-123',
    attachments: new Map([['1', { contentType: 'image/png' }]]),
    stickers: new Map(),
  };
  assert.equal(describe(msg), 'regarde [gif] [image]');
  const turns = toConversation(
    [
      { author: 'Slou', content: '[gif]' },
      { author: 'Faceless', content: 'prouve-le', replyTo: 'Casper' },
    ],
    'casper',
  );
  assert.equal(turns[0].content, 'Slou : [gif]\nFaceless (en réponse à Casper) : prouve-le');
});
