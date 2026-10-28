import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { floodCheck, quickReaction } from './rules.js';

test('réaction rapide aux messages courts', () => {
  assert.deepEqual(
    [quickReaction('merci magi').emoji, quickReaction('Merci beaucoup Casper !').emoji, quickReaction('mdr casper').emoji, quickReaction('ok melchior').emoji],
    ['❤️', '❤️', '😄', '👍'],
  );
  assert.equal(quickReaction('bonne nuit balthasar').ends, true);
  assert.equal(quickReaction('mdr').ends, false);
});

test('pas de réaction rapide dès que le message dit autre chose', () => {
  assert.equal(quickReaction('merci magi, et tu peux aussi m’expliquer les closures ?'), null);
  assert.equal(quickReaction('ok mais pourquoi ?'), null);
  assert.equal(quickReaction('magi'), null);
});

test('anti-flood : un avertissement, puis silence, puis de nouveau autorisé', () => {
  assert.equal(floodCheck('u', 0), 'ok');
  assert.equal(floodCheck('u', 1_000), 'warn');
  assert.equal(floodCheck('u', 2_000), 'ignore');
  assert.equal(floodCheck('u', 6_000), 'ok');
  assert.equal(floodCheck('u', 7_000), 'warn');
  assert.equal(floodCheck('autre', 7_000), 'ok');
});
