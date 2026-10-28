import { db } from './db.js';

const get = db.query('SELECT value FROM settings WHERE guild_id = ? AND key = ?');
const set = db.query(`INSERT INTO settings (guild_id, key, value) VALUES (?1, ?2, ?3)
  ON CONFLICT(guild_id, key) DO UPDATE SET value = ?3`);
const remove = db.query('DELETE FROM settings WHERE guild_id = ? AND key = ?');
const listing = db.query("SELECT key, value FROM settings WHERE guild_id = ? AND key LIKE ? ESCAPE '\\' ORDER BY key");
const count = db.query("SELECT count(*) AS n FROM settings WHERE guild_id = ? AND key LIKE ? ESCAPE '\\'");

export function setting(guildId, key) {
  return get.get(guildId, key)?.value ?? null;
}

const like = (prefix) => `${prefix.replace(/[\\%_]/g, '\\$&')}%`;

export function listSettings(guildId, prefix) {
  return listing.all(guildId, like(prefix));
}

export function countSettings(guildId, prefix) {
  return count.get(guildId, like(prefix)).n;
}

export function setSetting(guildId, key, value) {
  if (value === null || value === undefined) remove.run(guildId, key);
  else set.run(guildId, key, String(value));
}
