import { db } from '../../core/db.js';

const KEEP = 7;
const insert = db.query('INSERT INTO backups (guild_id, data, created_at) VALUES (?, ?, ?)');
const prune = db.query('DELETE FROM backups WHERE guild_id = ?1 AND id NOT IN (SELECT id FROM backups WHERE guild_id = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2)');
const latest = db.query('SELECT data, created_at FROM backups WHERE guild_id = ? ORDER BY created_at DESC, id DESC LIMIT 1');

export function saveBackup(guildId, data, now = Date.now()) {
  insert.run(guildId, JSON.stringify(data), now);
  prune.run(guildId, KEEP);
}

export function latestBackup(guildId) {
  const row = latest.get(guildId);
  return row ? { data: JSON.parse(row.data), createdAt: row.created_at } : null;
}
