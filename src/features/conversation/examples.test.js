import { test } from 'bun:test';
import assert from 'node:assert/strict';

const { examplesNote, learn, learnedExamples, pickExamples, registerOf, rememberReply, REGISTERS, SEEDS, staleness, unlearn } = await import('./examples.js');

test('type de message reconnu, bavardage par défaut', () => {
  const cases = {
    "je me sens vraiment pas bien ce soir": 'confidence',
    'Casper t’es nulle': 'chambrage',
    "j'ai eu mon permis !": 'nouvelle',
    'pizza ananas, oui ou non ?': 'debat',
    'pourquoi le ciel est bleu ?': 'question',
    'je fais des crêpes ce soir': 'bavardage',
  };
  for (const [text, register] of Object.entries(cases)) assert.equal(registerOf(text), register, text);
});

test('banque : exemples de la bonne unité, du même type d’abord, appris en priorité, jamais plus de 5', () => {
  for (const persona of ['melchior', 'balthasar', 'casper']) for (const register of Object.keys(REGISTERS)) assert.ok(SEEDS.some((e) => e.persona === persona && e.register === register), `${persona} ${register}`);
  const random = () => 0.5;
  const shown = pickExamples('g-banque', 'casper', 'debat', random);
  assert.equal(shown.length, 5);
  assert.ok(shown.every((e) => e.persona === 'casper'));
  assert.ok(shown.slice(0, 2).every((e) => e.register === 'debat'));
  assert.equal(learn('g-banque', { persona: 'casper', input: 'Slou : tu préfères le thé ou le café ?', output: 'Café, et serré. Le thé, c’est de l’eau chaude qui a des ambitions.', by: 'owner' }), true);
  assert.equal(learn('g-banque', { persona: 'casper', input: 'x', output: 'Café, et serré. Le thé, c’est de l’eau chaude qui a des ambitions.', by: 'owner' }), false);
  assert.equal(pickExamples('g-banque', 'casper', 'debat', random)[0].output, 'Café, et serré. Le thé, c’est de l’eau chaude qui a des ambitions.');
  assert.equal(learnedExamples('g-banque')[0].register, 'debat');
  assert.match(examplesNote('g-banque', 'casper', 'debat', random), /^Ce message : Question de goût[\s\S]*« Slou : tu préfères le thé ou le café \? » → « Café, et serré/);
  assert.equal(unlearn('g-banque', 'Café, et serré. Le thé, c’est de l’eau chaude qui a des ambitions.'), true);
  assert.equal(learnedExamples('g-banque').length, 0);
});

test('réponse usée : formule toute faite ou même début qu’une réponse récente', () => {
  assert.match(staleness('g-use', 'melchior', 'Hypothèse notée. Rien ne le prouve.'), /formule usée/);
  rememberReply('g-use', 'casper', 'Franchement ton bot a intérêt à faire le café.');
  assert.match(staleness('g-use', 'casper', 'Franchement ton bot, il est où ?'), /commence comme/);
  assert.equal(staleness('g-use', 'casper', 'Bravo, trois semaines bien investies.'), null);
  assert.equal(staleness('g-use', 'melchior', 'Franchement ton bot a intérêt à faire le café.'), null);
});
