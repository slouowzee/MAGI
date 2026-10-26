import { test } from 'bun:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { activePersonas, enabledModules, isMuted, moduleEnabled, setActivePersonas, setModules, setMutedChannels } = await import('./config.js');

test('modules actifs par défaut sauf la bienvenue, puis réglables', () => {
  assert.equal(moduleEnabled('config-test', 'vote'), true);
  assert.equal(moduleEnabled('config-test', 'bienvenue'), false);
  setModules('config-test', ['vote', 'bienvenue']);
  assert.deepEqual(enabledModules('config-test'), ['vote', 'bienvenue']);
  assert.equal(moduleEnabled('config-test', 'rappels'), false);
});

test('personas actives et salons muets', () => {
  assert.deepEqual(activePersonas('config-test'), ['melchior', 'balthasar', 'casper']);
  setActivePersonas('config-test', ['casper', 'inconnue']);
  assert.deepEqual(activePersonas('config-test'), ['casper']);
  setActivePersonas('config-test', []);
  assert.deepEqual(activePersonas('config-test'), ['melchior', 'balthasar', 'casper']);
  setMutedChannels('config-test', ['1']);
  assert.equal(isMuted({ id: '1', guild: { id: 'config-test' } }), true);
  assert.equal(isMuted({ id: '2', parentId: '1', guild: { id: 'config-test' }, isThread: () => true }), true);
  assert.equal(isMuted({ id: '3', guild: { id: 'config-test' } }), false);
});
