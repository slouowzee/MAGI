import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { splitMessage } from './split.js';

test('un message court reste entier', () => {
  assert.deepEqual(splitMessage('Bonjour !'), ['Bonjour !']);
});

test('un message long est découpé sous la limite de Discord, de préférence aux retours à la ligne', () => {
  const paragraph = 'mot '.repeat(300).trim();
  const parts = splitMessage(`${paragraph}\n${paragraph}`);
  assert.ok(parts.length >= 2);
  assert.ok(parts.every((p) => p.length <= 2000));
  assert.equal(parts[0], paragraph);
  assert.equal(parts.join(' ').split(/\s+/).length, 600);
});

test('un bloc sans espace est coupé net', () => {
  const parts = splitMessage('x'.repeat(4000));
  assert.ok(parts.every((p) => p.length <= 2000));
  assert.equal(parts.join(''), 'x'.repeat(4000));
});
