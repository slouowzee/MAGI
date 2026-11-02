import { test } from 'bun:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { db } = await import('../../core/db.js');
const { setSetting, setting } = await import('../../core/settings.js');
const { PURGES, purge, purgeCount } = await import('./purges.js');

test('purges : seulement le serveur visé, la banque sans le ton, tout d’un coup', () => {
  for (const guild of ['p1', 'p2']) {
    setSetting(guild, 'star:1', 'carte');
    setSetting(guild, 'star:2', 'carte');
    setSetting(guild, 'module:etoiles', 'on');
    db.query('INSERT INTO synchro (guild_id, user_id, points) VALUES (?, ?, ?)').run(guild, 'u', 10);
    db.query("INSERT INTO examples (guild_id, persona, register, input, output, created_at) VALUES (?, 'casper', 'debat', 'a', 'b', 0)").run(guild);
    db.query("INSERT INTO examples (guild_id, persona, register, input, output, created_at) VALUES (?, 'serveur', 'ton', 'a', 'c', 0)").run(guild);
  }
  assert.equal(purgeCount('p1', 'hall'), 2);
  assert.equal(purge('p1', 'hall'), 2);
  assert.equal(setting('p1', 'star:1'), null);
  assert.equal(setting('p1', 'module:etoiles'), 'on');
  assert.equal(setting('p2', 'star:1'), 'carte');
  assert.equal(purge('p1', 'banque'), 1);
  assert.equal(purgeCount('p1', 'ton'), 1);
  assert.equal(purgeCount('p1', 'tout'), 2);
  assert.equal(purge('p1', 'tout'), 2);
  assert.equal(purgeCount('p1', 'tout'), 0);
  assert.equal(purgeCount('p2', 'tout'), 5);
  assert.throws(() => purgeCount('p1', 'inconnu'), /choix inconnu/);
  assert.ok(Object.keys(PURGES).length + 1 <= 25);
  for (const p of Object.values(PURGES)) assert.ok(p.label.length <= 100, p.label);
});
