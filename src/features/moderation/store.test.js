import { test } from 'bun:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { activeInfractions, moderationMode, recordInfraction, revokeLastInfraction, setModerationMode } = await import('./store.js');

const DAY = 24 * 3600_000;

test('infractions comptées sur 30 jours, annulables', () => {
  assert.equal(recordInfraction('g', 'u', 'spam', 0).count, 1);
  assert.equal(recordInfraction('g', 'u', 'spam', 10 * DAY).count, 2);
  assert.equal(recordInfraction('g', 'u', 'spam', 35 * DAY).count, 2);
  assert.equal(revokeLastInfraction('g', 'u'), true);
  assert.equal(activeInfractions('g', 'u', 35 * DAY).length, 1);
  assert.equal(recordInfraction('g', 'autre', 'spam', 35 * DAY).count, 1);
});

test('mode observation par défaut, modifiable', () => {
  assert.deepEqual(moderationMode('g2', 5), { mode: 'observation', since: 5 });
  setModerationMode('g2', 'active', 9);
  assert.equal(moderationMode('g2').mode, 'active');
  assert.throws(() => setModerationMode('g2', 'turbo'), /inconnu/);
});
