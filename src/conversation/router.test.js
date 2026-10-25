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

test('conversation : participants suivis, fin détectée après 10 minutes', async () => {
  const { expiredConversations, joinConversation } = await import('./router.js');
  joinConversation('conv', 'g', 'slou', 0);
  rememberPersona('conv', 'casper', 1_000);
  joinConversation('conv', 'g', 'lea', 2_000);
  assert.deepEqual(expiredConversations(5 * 60_000), []);
  const [ended] = expiredConversations(13 * 60_000);
  assert.equal(ended.channelId, 'conv');
  assert.equal(ended.startedAt, 0);
  assert.deepEqual([...ended.participants], ['slou', 'lea']);
  assert.equal(activePersona('conv', 13 * 60_000), null);
});

test("une question posée par la persona attend une réponse", async () => {
  const { awaitingAnswer } = await import('./router.js');
  rememberPersona('q', 'balthasar', 0, 'slou');
  assert.equal(awaitingAnswer('q', 'slou', 1_000), true);
  assert.equal(awaitingAnswer('q', 'lea', 1_000), false);
  assert.equal(awaitingAnswer('q', 'slou', 11 * 60_000), false);
  rememberPersona('q', 'balthasar', 0);
  assert.equal(awaitingAnswer('q', 'slou', 1_000), false);
});
