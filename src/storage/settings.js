import { db } from './db.js';

const get = db.query('SELECT value FROM settings WHERE guild_id = ? AND key = ?');
const set = db.query(`INSERT INTO settings (guild_id, key, value) VALUES (?1, ?2, ?3)
  ON CONFLICT(guild_id, key) DO UPDATE SET value = ?3`);
const remove = db.query('DELETE FROM settings WHERE guild_id = ? AND key = ?');

export function setting(guildId, key) {
  return get.get(guildId, key)?.value ?? null;
}

export function setSetting(guildId, key, value) {
  if (value === null || value === undefined) remove.run(guildId, key);
  else set.run(guildId, key, String(value));
}
