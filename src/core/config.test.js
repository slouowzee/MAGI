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

test('statut : en direct, veille la nuit ou sans messages, hors ligne avec reprise, rotation', async () => {
  const { inNight, presenceState, rotationTexts } = await import('../features/presence/presence.js');
  const { setModules } = await import('./config.js');
  const m = (model, paused = null, latency = 2_000) => ({ model, paused, latency });
  const day = Date.parse('2026-10-28T13:00:00Z');
  const base = { status: [m('a'), m('b')], now: day, night: '1-8', idleAfter: 30 * 60_000, lastMessage: day - 60_000, rotation: 'Système MAGI · 3/3 unités actives' };
  assert.deepEqual(presenceState({ ...base, live: 'Casper répond à slou' }), { status: 'online', text: 'Casper répond à slou' });
  assert.deepEqual(presenceState({ ...base, status: [m('a', day + 600_000), m('b')] }), { status: 'online', text: 'Système MAGI · 3/3 unités actives' });
  assert.equal(presenceState({ ...base, now: Date.parse('2026-10-28T02:00:00Z') }).status, 'idle');
  assert.equal(presenceState({ ...base, lastMessage: day - 31 * 60_000 }).status, 'idle');
  assert.equal(presenceState({ ...base, lastMessage: day - 31 * 60_000, idleAfter: 0 }).status, 'online');
  assert.deepEqual(presenceState({ ...base, status: [m('a', Date.parse('2026-10-28T14:42:00Z')), m('b', Date.parse('2026-10-28T15:00:00Z'))] }), { status: 'dnd', text: 'Unités hors ligne, reprise vers 15:42' });
  assert.ok(inNight(23, '23-7') && inNight(3, '23-7') && !inNight(12, '23-7') && !inNight(3, 'aucune'));

  setModules('g-statut', ['commandes', 'statut']);
  const guild = { id: 'g-statut', memberCount: 42, members: { cache: new Map() }, scheduledEvents: { fetch: async () => new Map() } };
  const texts = await rotationTexts(guild, [m('a', null, 20_000)], day);
  assert.equal(texts[0], 'Unités saturées, réponses plus lentes');
  assert.ok(texts.includes('Veille sur 42 membres') && texts.includes('/chuchoter pour parler en privé à une unité'));
  assert.ok(!texts.some((t) => t.includes('Hall of Fame')));
  assert.ok(texts.every((t) => t.length <= 128));
});

test('persona par défaut selon le salon, fils compris', async () => {
  const { personaForChannel, setSettingList } = await import('./config.js');
  setSettingList('g-persona', 'persona_channels:melchior', ['dev']);
  const guild = { id: 'g-persona' };
  assert.equal(personaForChannel({ id: 'dev', guild }), 'melchior');
  assert.equal(personaForChannel({ id: 'fil', parentId: 'dev', isThread: () => true, guild }), 'melchior');
  assert.equal(personaForChannel({ id: 'general', guild }), null);
});
