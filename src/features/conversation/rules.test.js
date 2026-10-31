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

test('réaction de l’unité : son emote si l’application l’a, sinon l’emoji classique', async () => {
  const emote = (name) => ({ id: name, name });
  const { loadEmotes } = await import('../../core/discord/emotes.js');
  await loadEmotes({ application: { emojis: { fetch: async () => new Map(['casper_love', 'casper_dodo', 'melchior_clope', 'balthasar_love'].map((name) => [name, emote(name)])) } } });
  const of = (text, persona) => {
    const quick = quickReaction(text);
    return unitReaction(persona, quick.kind, quick.emoji);
  };
  assert.equal(of('merci', 'casper').name, 'casper_love');
  assert.equal(of('bonne nuit', 'casper').name, 'casper_dodo');
  assert.equal(of('repos, soldat.', 'melchior').name, 'melchior_clope');
  assert.equal(of('merci', 'balthasar').name, 'balthasar_love');
  assert.equal(of('ça ira', 'casper'), '👌');
  assert.equal(of('merci', undefined), '❤️');
  assert.equal(unitReaction('melchior', 'merci', '❤️'), '❤️');
  await loadEmotes({ application: { emojis: { fetch: async () => new Map() } } });
});

test('réaction d’humeur : rare, jamais de fête sur une mauvaise nouvelle, rien sur une confidence chez Casper', async () => {
  const { loadEmotes } = await import('../../core/discord/emotes.js');
  const { moodReaction, quietChoices, quietEmote } = await import('./rules.js');
  const names = ['casper_fete', 'casper_nargue', 'casper_cache', 'balthasar_inquiete', 'melchior_loupe'];
  await loadEmotes({ application: { emojis: { fetch: async () => new Map(names.map((name) => [name, { id: name, name }])) } } });
  const sure = () => 0;
  assert.equal(moodReaction('casper', 'nouvelle', "j'ai eu mon code du premier coup !", sure).name, 'casper_fete');
  assert.equal(moodReaction('casper', 'nouvelle', "j'ai eu mon code", () => 0.5), null);
  assert.equal(moodReaction('casper', 'nouvelle', 'je viens de me faire larguer', sure), null);
  assert.equal(moodReaction('balthasar', 'nouvelle', 'je viens de me faire larguer', sure).name, 'balthasar_inquiete');
  assert.equal(moodReaction('casper', 'confidence', 'je me sens seul', sure), null);
  assert.equal(moodReaction('casper', 'bavardage', 'je fais des crêpes', sure), null);
  assert.deepEqual(quietChoices(['casper', 'melchior', 'balthasar']).map((q) => q.choice), ['casper_nargue', 'casper_cache', 'casper_fete', 'melchior_loupe']);
  assert.deepEqual(quietChoices(['melchior']).map((q) => q.choice), ['melchior_loupe']);
  assert.equal(quietEmote('casper_cache').name, 'casper_cache');
  assert.equal(quietEmote('casper'), null);
  assert.equal(quietEmote('ignorer'), null);
  await loadEmotes({ application: { emojis: { fetch: async () => new Map() } } });
});
