import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { addressedPersonas, VOTE_INTENT, parseName, wantsDetail } from './triggers.js';

test('déclenche sur un nom en ouverture', () => {
  assert.deepEqual(parseName('magi, salut'), { persona: 'auto', vote: false, text: 'salut' });
  assert.deepEqual(parseName('MAGI salut'), { persona: 'auto', vote: false, text: 'salut' });
  assert.deepEqual(parseName('Melchior : pourquoi ça plante ?'), { persona: 'melchior', vote: false, text: 'pourquoi ça plante ?' });
  assert.equal(parseName('balthasar!').persona, 'balthasar');
  assert.equal(parseName('casper tu en penses quoi').persona, 'casper');
});

test('déclenche sur un nom placé n\'importe où', () => {
  assert.deepEqual(parseName("t'en penses quoi casper ?"), { persona: 'casper', vote: false, text: "t'en penses quoi casper ?" });
  assert.equal(parseName('merci magi').persona, 'auto');
  assert.equal(parseName('hey Melchior, tu peux regarder ?').persona, 'melchior');
  assert.equal(parseName('ok magi vote : pizza ce soir ?').vote, true);
});

test('ignore un nom dont on parle, ou un mot qui le contient', () => {
  assert.equal(parseName("j'ai revu l'épisode d'Evangelion avec les MAGI hier"), null);
  assert.equal(parseName("l'épisode des MAGI était fou"), null);
  assert.equal(parseName('tu connais le casper de ce jeu ?'), null);
  assert.equal(parseName('la magie du cinéma'), null);
  assert.equal(parseName('magie noire'), null);
  assert.equal(parseName('imagine'), null);
  assert.equal(parseName('melchiorsson est là'), null);
});

test('vote forcé', () => {
  assert.deepEqual(parseName('magi vote : on fait une soirée film ?'), { persona: 'auto', vote: true, text: 'on fait une soirée film ?' });
  assert.equal(parseName('magi votez pour moi').vote, false);
  assert.equal(parseName('casper vote pour moi').vote, false);
});

test('demande de réponse détaillée', () => {
  assert.ok(wantsDetail('explique-moi la récursivité'));
  assert.ok(wantsDetail('tu peux détailler ?'));
  assert.ok(wantsDetail('en détail stp'));
  assert.ok(wantsDetail('fais-moi un tuto docker'));
  assert.equal(wantsDetail('ça va ?'), false);
  assert.equal(wantsDetail("t'en penses quoi de l'ananas ?"), false);
});

test('toutes les unités interpellées sont repérées, pas celles dont on parle', () => {
  assert.deepEqual(addressedPersonas('balthasar et melchior, votez : on commande des pizzas ?'), ['balthasar', 'melchior']);
  assert.deepEqual(addressedPersonas('casper, tu es d’accord avec la réponse de melchior ?'), ['casper']);
  assert.equal(VOTE_INTENT.test('votez : on commande ?'), true);
  assert.equal(VOTE_INTENT.test('le votant arrive'), false);
});

test('demandes de résumé reconnues, apostrophes typographiques comprises', async () => {
  const { wantsSummary } = await import('./triggers.js');
  assert.deepEqual(
    ['magi, fait moi un petit résumé de ce qui s’est dit hier', 'résume la discussion', 'tu peux récap ce qui se passe ici ?', 'ce que j’ai raté ?', 'magi, salut', 'fais-moi un résumé du film Dune'].map(wantsSummary),
    [true, true, true, true, false, false],
  );
});

test('période du résumé : hier et aujourd’hui en heure de Paris', async () => {
  const { periodOf } = await import('../tools/channel.js');
  const now = Date.parse('2026-10-27T00:30:00+01:00');
  assert.deepEqual(periodOf('résume ce qui s’est dit hier', now), { day: '2026-10-26', label: 'hier' });
  assert.deepEqual(periodOf("récap d'aujourd’hui", now), { day: '2026-10-27', label: "aujourd'hui" });
  assert.equal(periodOf('résume la discussion', now), undefined);
});
