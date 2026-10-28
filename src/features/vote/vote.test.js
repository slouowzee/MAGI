import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { announcement, tally } from './vote.js';

const v = (persona, verdict) => ({ persona, verdict });

test('unanimité', () => {
  const r = tally([v('melchior', 'APPROUVÉ'), v('balthasar', 'APPROUVÉ'), v('casper', 'APPROUVÉ')]);
  assert.deepEqual(r, { outcome: 'adoptée', pour: 3, contre: 0, abstentions: 0, total: 3, minority: [] });
  assert.equal(announcement(r), "**MAGI · Résolution adoptée à l'unanimité.**");
  assert.equal(announcement(tally([v('a', 'REFUSÉ'), v('b', 'REFUSÉ'), v('c', 'REFUSÉ')])), "**MAGI · Résolution rejetée à l'unanimité.**");
});

test('2 contre 1 : la persona minoritaire est identifiée', () => {
  const r = tally([v('melchior', 'REFUSÉ'), v('balthasar', 'APPROUVÉ'), v('casper', 'APPROUVÉ')]);
  assert.deepEqual(r.minority, ['melchior']);
  assert.equal(announcement(r), '**MAGI · Résolution adoptée, 2 contre 1.**');
  const rejet = tally([v('melchior', 'REFUSÉ'), v('balthasar', 'APPROUVÉ'), v('casper', 'REFUSÉ')]);
  assert.equal(announcement(rejet), '**MAGI · Résolution rejetée, 2 contre 1.**');
  assert.deepEqual(rejet.minority, ['balthasar']);
});

test('abstention : majorité à 2 sans minorité, ou délibération impossible', () => {
  const r = tally([v('melchior', 'APPROUVÉ'), v('balthasar', 'APPROUVÉ'), v('casper', 'ABSTENTION')]);
  assert.equal(announcement(r), '**MAGI · Résolution adoptée, 2 contre 0, 1 abstention.**');
  assert.deepEqual(r.minority, []);
  const impossible = tally([v('melchior', 'APPROUVÉ'), v('balthasar', 'REFUSÉ'), v('casper', 'ABSTENTION')]);
  assert.equal(impossible.outcome, 'impossible');
  assert.equal(announcement(impossible), '**MAGI · Délibération impossible.** Aucune majorité.');
});

test('vote à deux unités : unanimité requise, sinon délibération impossible', () => {
  const accord = tally([v('melchior', 'APPROUVÉ'), v('balthasar', 'APPROUVÉ')]);
  assert.equal(announcement(accord), "**MAGI · Résolution adoptée à l'unanimité.**");
  assert.equal(tally([v('melchior', 'APPROUVÉ'), v('balthasar', 'REFUSÉ')]).outcome, 'impossible');
});
