import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
const { addMessage, answered, awaitingAnswer, closeConversation, expiredConversations, followUpConversation, locateConversation, openConversation } = await import('./threads.js');
const findConversation = (where, now) => locateConversation(where, now).conversation;
const { loadConversations } = await import('../storage/conversations.js');

function conversation(channelId, authorId, messageId, now = 0) {
  const c = openConversation({ channelId, guildId: 'g' }, now);
  addMessage(c, messageId, authorId, now);
  return c;
}

test('deux conversations en parallèle dans un salon, chacun retrouve la sienne', () => {
  const slou = conversation('s1', 'slou', 'm1');
  answered(slou, { persona: 'melchior', messageIds: ['r1'], userId: 'slou' }, 1_000);
  const faceless = conversation('s1', 'faceless', 'm2', 2_000);
  answered(faceless, { persona: 'casper', messageIds: ['r2'], userId: 'faceless' }, 3_000);

  assert.equal(findConversation({ channelId: 's1', authorId: 'slou' }, 4_000), slou);
  assert.equal(findConversation({ channelId: 's1', authorId: 'faceless' }, 4_000), faceless);
  assert.equal(followUpConversation('s1', 'slou', 4_000), slou);
  assert.equal(followUpConversation('s1', 'faceless', 4_000), faceless);
  assert.equal(findConversation({ channelId: 's1', authorId: 'lea', referenceId: 'r2' }, 4_000), faceless);
});

test('mentionner un participant fait rejoindre sa conversation', () => {
  const slou = conversation('s2', 'slou', 'm1');
  assert.equal(findConversation({ channelId: 's2', authorId: 'lea', mentionIds: ['slou'] }, 1_000), slou);
  assert.equal(findConversation({ channelId: 's2', authorId: 'lea' }, 1_000), null);
});

test('quand on parle à une autre persona, la conversation où elle est déjà présente est préférée', () => {
  const avecCasper = conversation('s3', 'slou', 'm1');
  answered(avecCasper, { persona: 'casper', messageIds: ['r1'] }, 1_000);
  const avecMelchior = conversation('s3', 'slou', 'm2', 2_000);
  answered(avecMelchior, { persona: 'melchior', messageIds: ['r2'] }, 3_000);
  assert.equal(findConversation({ channelId: 's3', authorId: 'slou', persona: 'casper' }, 4_000), avecCasper);
  assert.equal(findConversation({ channelId: 's3', authorId: 'slou' }, 4_000), avecMelchior);
});

test('suite sans le nom limitée dans le temps, question en attente, fin et expiration', () => {
  const c = conversation('s4', 'slou', 'm1');
  answered(c, { persona: 'balthasar', messageIds: ['r1'], userId: 'slou', asked: true }, 0);
  assert.equal(awaitingAnswer(c, 'slou', 5 * 60_000), true);
  assert.equal(awaitingAnswer(c, 'lea', 5 * 60_000), false);
  answered(c, { persona: 'balthasar', messageIds: ['r2'], userId: 'slou' }, 0);
  assert.equal(followUpConversation('s4', 'slou', 2 * 60_000), c);
  assert.equal(followUpConversation('s4', 'slou', 4 * 60_000), null);
  assert.deepEqual(expiredConversations(5 * 60_000), []);
  assert.deepEqual(expiredConversations(11 * 60_000).filter((e) => e.channelId === 's4'), [c]);
  const other = conversation('s4', 'slou', 'm3', 12 * 60_000);
  assert.equal(closeConversation(other), other);
  assert.equal(findConversation({ channelId: 's4', authorId: 'slou' }, 12 * 60_000), null);
});

test('les conversations sont sauvegardées et rechargées avec leurs participants', () => {
  const c = conversation('s5', 'slou', 'm1', 1_000);
  answered(c, { persona: 'casper', messageIds: ['r1'], userId: 'slou' }, 2_000);
  const saved = loadConversations(0).find((s) => s.id === c.id);
  expect(saved.participants.has('slou')).toBe(true);
  expect(saved.personas.has('casper')).toBe(true);
  expect(saved.messages).toEqual(['m1', 'r1']);
  closeConversation(c);
  expect(loadConversations(0).some((s) => s.id === c.id)).toBe(false);
});
