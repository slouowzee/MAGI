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

test('rappel : délai relatif exact, persona et message d’origine conservés, phrase propre', async () => {
  const { dueFrom, reminderLine, stamp } = await import('../tools/reminders.js');
  const now = Date.parse('2026-10-28T14:11:50Z');
  assert.equal(dueFrom({ minutes: 1, date: '2026-10-28T15:12:00+01:00' }, now), now + 60_000);
  assert.equal(dueFrom({ date: '2026-10-28T18:00:00+01:00' }, now), Date.parse('2026-10-28T17:00:00Z'));
  const { id } = addReminder({ ...base, userId: 'p', dueAt: now + 60_000, persona: 'casper', messageId: 'm1' }, now);
  const saved = dueReminders(now + 61_000).find((r) => r.id === id);
  assert.equal(saved.persona, 'casper');
  assert.equal(saved.message_id, 'm1');
  assert.equal(reminderLine('casper', 'Finir la tâche'), "C'est l'heure : finir la tâche.");
  assert.equal(reminderLine('melchior', 'PR de MAGI !'), 'Rappel : PR de MAGI.');
  assert.match(stamp(now + 60_000, now), /^à <t:\d+:t> \(<t:\d+:R>\)$/);
  assert.match(stamp(now + 3 * 86_400_000, now), /^le <t:\d+:F>/);
});
