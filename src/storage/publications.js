import { db } from './db.js';

const insert = db.query('INSERT INTO publications (guild_id, channel_id, message_id, title, created_at) VALUES (?, ?, ?, ?, ?)');
const recent = db.query('SELECT * FROM publications WHERE guild_id = ? ORDER BY created_at DESC, id DESC LIMIT 25');
const rename = db.query('UPDATE publications SET title = ? WHERE id = ?');
const remove = db.query('DELETE FROM publications WHERE id = ?');

export function savePublication({ guildId, channelId, messageId, title }, now = Date.now()) {
  insert.run(guildId, channelId, messageId, title, now);
}

export function recentPublications(guildId) {
  return recent.all(guildId);
}

export function findPublication(guildId, ref) {
  const list = recentPublications(guildId);
  const query = String(ref ?? '').trim().toLowerCase();
  if (!query) return list[0] ?? null;
  const id = query.match(/\d{17,20}(?!.*\d{17,20})/)?.[0];
  return list.find((p) => p.message_id === id) ?? list.find((p) => p.title.toLowerCase() === query) ?? list.find((p) => p.title.toLowerCase().includes(query)) ?? null;
}

export function renamePublication(id, title) {
  rename.run(title, id);
}

export function deletePublication(id) {
  remove.run(id);
}
