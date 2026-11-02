import { test } from 'bun:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { db } = await import('../../core/db.js');
const { setSetting, setting } = await import('../../core/settings.js');
const { KEEP_AFTER_LEAVING, knownGuilds, sweepDepartures } = await import('./departures.js');
const { factsAbout, rememberFact } = await import('../memory/store.js');

test('données d’un serveur quitté : gardées 30 jours, effacées ensuite, mémoire comprise, gardées s’il revient', async () => {
  db.query('INSERT INTO memories (guild_id, user_id, fact, created_at) VALUES (?, ?, ?, ?)').run('111', 'u', 'aime le thé', 0);
  db.query('INSERT INTO memories (guild_id, user_id, fact, created_at) VALUES (?, ?, ?, ?)').run('222', 'u', 'aime le café', 0);
  setSetting('111', 'module:vote', 'on');
  setSetting('222', 'module:vote', 'on');
  await rememberFact('111', 'u', 'joue au piano');
  await rememberFact('222', 'u', 'joue de la guitare');
  assert.deepEqual(knownGuilds().sort(), ['111', '222']);
  assert.deepEqual(await sweepDepartures(['222'], 0), []);
  assert.equal(setting('global', 'left:111'), '0');
  assert.deepEqual(await sweepDepartures(['222'], KEEP_AFTER_LEAVING - 1), []);
  assert.deepEqual(await sweepDepartures(['222'], KEEP_AFTER_LEAVING), ['111']);
  assert.equal(db.query('SELECT COUNT(*) AS n FROM memories WHERE guild_id = ?').get('111').n, 0);
  assert.equal(setting('111', 'module:vote'), null);
  assert.deepEqual(await factsAbout('111', 'u'), []);
  assert.deepEqual(await factsAbout('222', 'u'), ['joue de la guitare']);
  assert.equal(setting('222', 'module:vote'), 'on');
  assert.equal(setting('global', 'left:111'), null);
  await sweepDepartures([], KEEP_AFTER_LEAVING);
  await sweepDepartures(['222'], KEEP_AFTER_LEAVING + 1);
  assert.equal(setting('global', 'left:222'), null);
  assert.equal(setting('222', 'module:vote'), 'on');
});
