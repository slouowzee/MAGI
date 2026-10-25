import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { parseName, wantsDetail, wantsInstall } from './triggers.js';

test("reconnaît une demande d'installation sous plusieurs formulations", () => {
  for (const text of [
    'installe-toi',
    'installe toi stp',
    'réinstalle-toi',
    'configure-toi',
    'initialise-toi',
    'mets-toi en place',
    'fais ton installation',
    'relance ta config',
    'vérifie ton installation',
    'termine ta mise en place',
    'vérifie la hiérarchie',
    'verifie tes rôles',
  ]) assert.ok(wantsInstall(text), text);
});

test("n'y voit pas une demande d'installation", () => {
  for (const text of [
    'installe minecraft sur le serveur',
    "c'est quoi une installation électrique ?",
    'configure le serveur pour une communauté gaming',
    'setup un serveur discord',
  ]) assert.equal(wantsInstall(text), false, text);
});

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
