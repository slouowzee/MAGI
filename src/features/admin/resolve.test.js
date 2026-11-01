import { test } from 'bun:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { findChannel, findRole, permissionBits, PERMISSION_NAMES, targetRole } = await import('./resolve.js');

const roles = new Map([
  ['g', { id: 'g', name: '@everyone', position: 0 }],
  ['111111111111111111', { id: '111111111111111111', name: 'Modo', position: 2 }],
  ['222222222222222222', { id: '222222222222222222', name: 'Admin', position: 9 }],
  ['333333333333333333', { id: '333333333333333333', name: 'Bot intégré', position: 1, managed: true }],
]);
roles.find = (fn) => [...roles.values()].find(fn);
const channels = new Map([['444444444444444444', { id: '444444444444444444', name: 'général' }]]);
channels.find = (fn) => [...channels.values()].find(fn);
const guild = { id: 'g', roles: { cache: roles }, channels: { cache: channels }, members: { me: { roles: { highest: { position: 5 } } } } };

test('retrouve rôles et salons par mention, identifiant ou nom', () => {
  assert.equal(findRole(guild, '<@&111111111111111111>').name, 'Modo');
  assert.equal(findRole(guild, '@modo').name, 'Modo');
  assert.equal(findChannel(guild, '<#444444444444444444>').name, 'général');
  assert.equal(findChannel(guild, '#Général').name, 'général');
  assert.equal(findChannel(guild, undefined, 'courant'), 'courant');
});

test('rôles intouchables : @everyone, intégrations, au-dessus de MAGI', () => {
  assert.equal(targetRole(guild, 'Modo').name, 'Modo');
  assert.throws(() => targetRole(guild, '@everyone'), /@everyone/);
  assert.throws(() => targetRole(guild, 'Bot intégré'), /intégration/);
  assert.throws(() => targetRole(guild, 'Admin'), /au-dessus/);
  assert.throws(() => targetRole(guild, 'Inconnu'), /introuvable/);
});

test('aucune permission dangereuse ne peut être accordée', () => {
  assert.equal(permissionBits(['voir_salon', 'bannir']).length, 2);
  for (const forbidden of ['administrateur', 'gerer_serveur', 'gerer_roles', 'gerer_webhooks', 'gerer_salons']) {
    assert.throws(() => permissionBits([forbidden]), /non autorisée/);
    assert.equal(PERMISSION_NAMES.includes(forbidden), false);
  }
});

test('permissions : une clé héritée de Object.prototype est refusée', () => {
  assert.throws(() => permissionBits(['constructor']), /non autorisée/);
});
