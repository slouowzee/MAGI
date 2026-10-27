import { test } from 'bun:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { factsAbout, forgetUser, rememberFact, saveSummary, summariesAbout } = await import('./memory.js');

test('retenir, dédoublonner et relire les faits les plus récents en premier', async () => {
  assert.equal(await rememberFact('g', 'slou', 'Je suis dev Python', 1), 'Retenu : Je suis dev Python');
  assert.equal(await rememberFact('g', 'slou', 'je suis dev python', 2), 'Déjà retenu.');
  await rememberFact('g', 'slou', "J'ai un chat qui s'appelle Pixel", 3);
  await rememberFact('g', 'lea', 'Léa joue au tennis', 4);
  assert.deepEqual(await factsAbout('g', 'slou'), ["J'ai un chat qui s'appelle Pixel", 'Je suis dev Python']);
  assert.deepEqual(await factsAbout('autre-serveur', 'slou'), []);
});

test('les souvenirs liés au message passent devant les plus récents', async () => {
  for (const [i, fact] of ['Max joue de la guitare', 'Max a un chien nommé Rex', 'Max habite à Lyon', 'Max travaille de nuit'].entries()) await rememberFact('g', 'max', fact, 100 + i);
  assert.equal((await factsAbout('g', 'max', 1, 'tu joues toujours de la guitare ?'))[0], 'Max joue de la guitare');
  assert.equal((await factsAbout('g', 'max', 1))[0], 'Max travaille de nuit');
});

test('résumés retrouvés par participant, oubli complet et définitif', async () => {
  await saveSummary('g', 'salon', ['slou', 'lea'], 'Débat pizza contre sushi.', 10);
  await saveSummary('g', 'salon', ['lea'], 'Léa a parlé de son match.', 11);
  assert.deepEqual(await summariesAbout('g', 'slou'), ['Débat pizza contre sushi.']);
  assert.deepEqual(await forgetUser('g', 'slou'), { facts: 2, summaries: 1 });
  assert.deepEqual(await factsAbout('g', 'slou'), []);
  assert.deepEqual(await summariesAbout('g', 'lea', 3), ['Léa a parlé de son match.', 'Débat pizza contre sushi.']);
});
