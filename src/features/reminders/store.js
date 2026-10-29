import { db } from '../../core/db.js';

const MAX_PENDING = 20;
const MAX_DELAY = 366 * 24 * 3600_000;

const countPending = db.query('SELECT count(*) AS n FROM reminders WHERE guild_id = ? AND user_id = ? AND done = 0');
const insert = db.query('INSERT INTO reminders (guild_id, channel_id, user_id, text, due_at, persona, message_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
const selectDue = db.query('SELECT * FROM reminders WHERE done = 0 AND due_at <= ? ORDER BY due_at');
const selectPending = db.query('SELECT id, text, due_at FROM reminders WHERE guild_id = ? AND user_id = ? AND done = 0 ORDER BY due_at');
const close = db.query('UPDATE reminders SET done = 1 WHERE id = ?');
const cancel = db.query('UPDATE reminders SET done = 1 WHERE id = ? AND guild_id = ? AND user_id = ? AND done = 0');

export function addReminder({ guildId, channelId, userId, text, dueAt, persona = null, messageId = null }, now = Date.now()) {
  if (!Number.isFinite(dueAt)) return { error: 'Date invalide.' };
  if (dueAt <= now) return { error: 'Cette date est déjà passée.' };
  if (dueAt - now > MAX_DELAY) return { error: 'Un rappel ne peut pas dépasser un an.' };
  if (countPending.get(guildId, userId).n >= MAX_PENDING) return { error: `Limite de ${MAX_PENDING} rappels en attente atteinte.` };
  const { lastInsertRowid } = insert.run(guildId, channelId, userId, text.trim().slice(0, 500), dueAt, persona, messageId);
  return { id: Number(lastInsertRowid) };
}

export function dueReminders(now = Date.now()) {
  return selectDue.all(now);
}

export function markDone(id) {
  close.run(id);
}

export function pendingReminders(guildId, userId) {
  return selectPending.all(guildId, userId);
}

export function cancelReminder(id, guildId, userId) {
  return cancel.run(id, guildId, userId).changes > 0;
}

const selectGuild = db.query('SELECT id, user_id, text, due_at FROM reminders WHERE guild_id = ? AND done = 0 ORDER BY due_at');
const cancelAny = db.query('UPDATE reminders SET done = 1 WHERE id = ? AND guild_id = ? AND done = 0');

export function guildReminders(guildId) {
  return selectGuild.all(guildId);
}

export function cancelAnyReminder(id, guildId) {
  return cancelAny.run(id, guildId).changes > 0;
}
