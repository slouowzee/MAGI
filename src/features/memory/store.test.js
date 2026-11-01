import { test } from 'bun:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { factsAbout, forgetUser, rememberFact, saveSummary, summariesAbout } = await import('./store.js');

test('retenir, dédoublonner et relire les faits les plus récents en premier', async () => {
  assert.equal(await rememberFact('g-store', 'slou', 'Je suis dev Python', 1), 'Retenu : Je suis dev Python');
  assert.equal(await rememberFact('g-store', 'slou', 'je suis dev python', 2), 'Déjà retenu.');
  await rememberFact('g-store', 'slou', "J'ai un chat qui s'appelle Pixel", 3);
  await rememberFact('g-store', 'lea', 'Léa joue au tennis', 4);
  assert.deepEqual(await factsAbout('g-store', 'slou'), ["J'ai un chat qui s'appelle Pixel", 'Je suis dev Python']);
  assert.deepEqual(await factsAbout('autre-serveur', 'slou'), []);
});

test('les souvenirs liés au message passent devant les plus récents', async () => {
  for (const [i, fact] of ['Max joue de la guitare', 'Max a un chien nommé Rex', 'Max habite à Lyon', 'Max travaille de nuit'].entries()) await rememberFact('g-store', 'max', fact, 100 + i);
  assert.equal((await factsAbout('g-store', 'max', 1, 'tu joues toujours de la guitare ?'))[0], 'Max joue de la guitare');
  assert.equal((await factsAbout('g-store', 'max', 1))[0], 'Max travaille de nuit');
});

test('résumés retrouvés par participant, oubli complet et définitif', async () => {
  await saveSummary('g-store', 'salon', ['slou', 'lea'], 'Débat pizza contre sushi.', 10);
  await saveSummary('g-store', 'salon', ['lea'], 'Léa a parlé de son match.', 11);
  assert.deepEqual(await summariesAbout('g-store', 'slou'), ['Débat pizza contre sushi.']);
  assert.deepEqual(await forgetUser('g-store', 'slou'), { facts: 2, summaries: 1 });
  assert.deepEqual(await factsAbout('g-store', 'slou'), []);
  assert.deepEqual(await summariesAbout('g-store', 'lea', 3), ['Léa a parlé de son match.', 'Débat pizza contre sushi.']);
});

test('outil oublier : efface aussi les messages servant d’exemple de ton', async () => {
  const { MEMORY_TOOLS } = await import('./tools.js');
  const { learnTone, toneCountOf } = await import('../conversation/examples.js');
  learnTone('g-oubli-ton', { authorId: 'lea', author: 'Lea', text: 'salut la bande', by: 'op' });
  const output = await MEMORY_TOOLS.find((t) => t.name === 'oublier').run({ guild: { id: 'g-oubli-ton' }, member: { id: 'lea', displayName: 'Lea' } });
  assert.equal(toneCountOf('g-oubli-ton', 'lea'), 0);
  assert.match(output, /1 message\(s\) d'exemple/);
});
