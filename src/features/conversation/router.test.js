import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { randomPersona } from './router.js';

test('persona aléatoire parmi les trois, ou parmi celles autorisées', () => {
  assert.equal(randomPersona(() => 0), 'melchior');
  assert.equal(randomPersona(() => 0.5), 'balthasar');
  assert.equal(randomPersona(() => 0.99), 'casper');
  assert.equal(randomPersona(() => 0.99, ['melchior', 'casper']), 'casper');
});
