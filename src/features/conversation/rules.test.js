import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { floodCheck, quickReaction, unitReaction } from './rules.js';

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

test('fin de conversation : réaction et fin, même après une question de l’unité', () => {
  assert.deepEqual(['ça ira.', "c'est sûr", 'Pas de souci', 'repos, soldat.', 'bien vu casper'].map((t) => quickReaction(t)?.emoji), ['👌', '👌', '👌', '🫡', '👌']);
  for (const t of ['ça ira.', 'repos, soldat.']) assert.ok(quickReaction(t).ends && quickReaction(t).always, t);
  assert.equal(quickReaction("c'est sûr que tu peux m'aider ?"), null);
});

test('merci écrit à la va-vite : reconnu', () => {
  for (const t of ['oki, merki', 'mercii', 'ok merci bcp', 'thx balthasar', 'super merci beaucoup']) assert.equal(quickReaction(t)?.emoji, '❤️', t);
  assert.equal(quickReaction('merci de me dire comment faire'), null);
});

test('réaction de l’unité : son emote si le serveur l’a, sinon l’emoji classique', () => {
  const emote = (name) => ({ id: name, name });
  const guild = { emojis: { cache: [emote('casper_love'), emote('casper_dodo'), emote('melchior_clope'), emote('balthasar_fiere')] } };
  const of = (text, persona) => {
    const quick = quickReaction(text);
    return unitReaction(guild, persona, quick.kind, quick.emoji);
  };
  assert.equal(of('merci', 'casper').name, 'casper_love');
  assert.equal(of('bonne nuit', 'casper').name, 'casper_dodo');
  assert.equal(of('repos, soldat.', 'melchior').name, 'melchior_clope');
  assert.equal(of('merci', 'balthasar').name, 'balthasar_fiere');
  assert.equal(of('ça ira', 'casper'), '👌');
  assert.equal(of('merci', undefined), '❤️');
  assert.equal(unitReaction({}, 'casper', 'merci', '❤️'), '❤️');
});
