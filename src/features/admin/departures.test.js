import { test } from 'bun:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { db } = await import('../../core/db.js');
const { setSetting, setting } = await import('../../core/settings.js');
const { KEEP_AFTER_LEAVING, knownGuilds, sweepDepartures } = await import('./departures.js');

test('données d’un serveur quitté : gardées 30 jours, effacées ensuite, gardées s’il revient', () => {
  db.query('INSERT INTO memories (guild_id, user_id, fact, created_at) VALUES (?, ?, ?, ?)').run('111', 'u', 'aime le thé', 0);
  db.query('INSERT INTO memories (guild_id, user_id, fact, created_at) VALUES (?, ?, ?, ?)').run('222', 'u', 'aime le café', 0);
  setSetting('111', 'module:vote', 'on');
  setSetting('222', 'module:vote', 'on');
  assert.deepEqual(knownGuilds().sort(), ['111', '222']);
  assert.deepEqual(sweepDepartures(['222'], 0), []);
  assert.equal(setting('global', 'left:111'), '0');
  assert.deepEqual(sweepDepartures(['222'], KEEP_AFTER_LEAVING - 1), []);
  assert.deepEqual(sweepDepartures(['222'], KEEP_AFTER_LEAVING), ['111']);
  assert.equal(db.query('SELECT COUNT(*) AS n FROM memories WHERE guild_id = ?').get('111').n, 0);
  assert.equal(setting('111', 'module:vote'), null);
  assert.equal(setting('222', 'module:vote'), 'on');
  assert.equal(setting('global', 'left:111'), null);
  sweepDepartures([], KEEP_AFTER_LEAVING);
  sweepDepartures(['222'], KEEP_AFTER_LEAVING + 1);
  assert.equal(setting('global', 'left:222'), null);
  assert.equal(setting('222', 'module:vote'), 'on');
});
