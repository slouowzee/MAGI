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

test('statut dynamique : en délibération, relais, hors ligne', async () => {
  const { presenceText } = await import('./presence.js');
  const m = (model, paused = null) => ({ model, paused });
  assert.deepEqual(presenceText(1, [m('a')]), { text: 'En délibération…', status: 'online' });
  assert.deepEqual(presenceText(0, [m('a'), m('b')]), { text: 'Prêt', status: 'online' });
  assert.deepEqual(presenceText(0, [m('gemini-3.5-flash-lite', 1), m('gemini-3.1-flash-lite')]), { text: 'gemini-3.5-flash-lite saturé, relais gemini-3.1-flash-lite', status: 'idle' });
  assert.equal(presenceText(0, [m('a', 1)]).status, 'dnd');
});

test('persona par défaut selon le salon, fils compris', async () => {
  const { personaForChannel, setSettingList } = await import('./config.js');
  setSettingList('g-persona', 'persona_channels:melchior', ['dev']);
  const guild = { id: 'g-persona' };
  assert.equal(personaForChannel({ id: 'dev', guild }), 'melchior');
  assert.equal(personaForChannel({ id: 'fil', parentId: 'dev', isThread: () => true, guild }), 'melchior');
  assert.equal(personaForChannel({ id: 'general', guild }), null);
});
