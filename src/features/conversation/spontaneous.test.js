import { test } from 'bun:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { canIntervene, claimJudge, judgeRequest } = await import('./spontaneous.js');
const { interventionChannels, interventionsAllowed, setInterventions } = await import('./interventions.js');

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

test('un seul passage du juge par minute et par salon', () => {
  assert.equal(claimJudge('juge', 0), true);
  assert.equal(claimJudge('juge', 59_999), false);
  assert.equal(claimJudge('autre', 59_999), true);
  assert.equal(claimJudge('juge', 60_000), true);
});

test('le juge choisit entre ignorer, une unité active et les emotes disponibles', async () => {
  const { loadEmotes } = await import('../../core/discord/emotes.js');
  const load = (names) => loadEmotes({ application: { emojis: { fetch: async () => new Map(names.map((name) => [name, { id: name, name }])) } } });
  await load(['casper_mdr', 'melchior_hmm']);
  const { messages, choices } = judgeRequest(['casper', 'balthasar'], ['Léa : mdr']);
  await load([]);
  assert.deepEqual(choices, ['ignorer', 'casper', 'balthasar', 'casper_mdr']);
  assert.match(messages[0].content, /casper_mdr \(franchement drôle\)/);
  assert.equal(judgeRequest(['casper'], ['Léa : mdr']).choices.length, 2);
});
