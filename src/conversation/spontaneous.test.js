import { test } from 'bun:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { canIntervene } = await import('./spontaneous.js');
const { interventionChannels, interventionsAllowed, setInterventions } = await import('../storage/interventions.js');

test('salons autorisés activables et désactivables', () => {
  setInterventions('g', 'c1', true);
  setInterventions('g', 'c2', true);
  setInterventions('g', 'c2', false);
  assert.equal(interventionsAllowed('c1'), true);
  assert.equal(interventionsAllowed('c2'), false);
  assert.deepEqual(interventionChannels('g'), ['c1']);
});

test('un salon jamais visité peut recevoir une intervention', () => {
  assert.equal(canIntervene('neuf', 0), true);
});
