import { test } from 'bun:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { addReminder, cancelReminder, dueReminders, markDone, pendingReminders } = await import('./reminders.js');

const base = { guildId: 'g', channelId: 'c', userId: 'slou', text: 'sortir le chat' };

test('refuse les dates passées, invalides ou trop lointaines', () => {
  assert.equal(addReminder({ ...base, dueAt: 500 }, 1_000).error, 'Cette date est déjà passée.');
  assert.equal(addReminder({ ...base, dueAt: NaN }, 1_000).error, 'Date invalide.');
  assert.match(addReminder({ ...base, dueAt: 1_000 + 400 * 24 * 3600_000 }, 1_000).error, /un an/);
});

test('un rappel échu est livré une seule fois, un rappel annulé jamais', () => {
  const { id } = addReminder({ ...base, dueAt: 5_000 }, 1_000);
  const other = addReminder({ ...base, text: 'appeler maman', dueAt: 6_000 }, 1_000);
  assert.deepEqual(pendingReminders('g', 'slou').map((r) => r.text), ['sortir le chat', 'appeler maman']);
  assert.equal(cancelReminder(other.id, 'g', 'lea'), false);
  assert.equal(cancelReminder(other.id, 'g', 'slou'), true);
  assert.deepEqual(dueReminders(4_000), []);
  assert.deepEqual(dueReminders(10_000).map((r) => r.id), [id]);
  markDone(id);
  assert.deepEqual(dueReminders(10_000), []);
});
