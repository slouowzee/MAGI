import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = ':memory:';
const { KEEP_MEMORY_COPIES, pruneMemoryCopies } = await import('./store.js');

test('copies de la mémoire supprimées après 7 jours, copies de la base intactes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'magi-copies-'));
  try {
    const now = Date.now();
    for (const name of ['memoire-vieille.db', 'memoire-recente.db', 'magi-vieille.db']) writeFileSync(join(dir, name), 'x');
    const old = (now - KEEP_MEMORY_COPIES - 60_000) / 1000;
    for (const name of ['memoire-vieille.db', 'magi-vieille.db']) utimesSync(join(dir, name), old, old);
    assert.equal(pruneMemoryCopies(dir, now), 1);
    assert.equal(existsSync(join(dir, 'memoire-vieille.db')), false);
    assert.equal(existsSync(join(dir, 'memoire-recente.db')), true);
    assert.equal(existsSync(join(dir, 'magi-vieille.db')), true);
    assert.equal(pruneMemoryCopies(null, now), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
