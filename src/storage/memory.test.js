import { test } from 'bun:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { factsAbout, forgetUser, rememberFact, saveSummary, summariesAbout } = await import('./memory.js');

test('retenir, dédoublonner et relire les faits les plus récents en premier', () => {
  assert.equal(rememberFact('g', 'slou', 'Je suis dev Python', 1), 'Retenu : Je suis dev Python');
  assert.equal(rememberFact('g', 'slou', 'je suis dev python', 2), 'Déjà retenu.');
  rememberFact('g', 'slou', "J'ai un chat qui s'appelle Pixel", 3);
  rememberFact('g', 'lea', 'Léa joue au tennis', 4);
  assert.deepEqual(factsAbout('g', 'slou'), ["J'ai un chat qui s'appelle Pixel", 'Je suis dev Python']);
  assert.deepEqual(factsAbout('autre-serveur', 'slou'), []);
});

test('résumés retrouvés par participant, oubli complet', () => {
  saveSummary('g', 'salon', ['slou', 'lea'], 'Débat pizza contre sushi.', 10);
  saveSummary('g', 'salon', ['lea'], 'Léa a parlé de son match.', 11);
  assert.deepEqual(summariesAbout('g', 'slou'), ['Débat pizza contre sushi.']);
  assert.deepEqual(forgetUser('g', 'slou'), { facts: 2, summaries: 1 });
  assert.deepEqual(factsAbout('g', 'slou'), []);
  assert.deepEqual(summariesAbout('g', 'lea'), ['Léa a parlé de son match.']);
});
