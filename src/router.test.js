import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { activePersona, forgetPersona, randomPersona, rememberPersona } from './router.js';

test('persona aléatoire parmi les trois', () => {
  assert.equal(randomPersona(() => 0), 'melchior');
  assert.equal(randomPersona(() => 0.5), 'balthasar');
  assert.equal(randomPersona(() => 0.99), 'casper');
});

test('persona mémorisée par salon, oubliée après 10 minutes', () => {
  rememberPersona('salon', 'casper', 0);
  assert.equal(activePersona('salon', 9 * 60_000), 'casper');
  assert.equal(activePersona('salon', 11 * 60_000), null);
  assert.equal(activePersona('autre-salon', 0), null);
  rememberPersona('salon', 'melchior', 0);
  forgetPersona('salon');
  assert.equal(activePersona('salon', 0), null);
});
