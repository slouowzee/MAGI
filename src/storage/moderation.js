import { db } from './db.js';

const WINDOW = 30 * 24 * 3600_000;
export const MODES = ['observation', 'active', 'desactivee'];

const insert = db.query('INSERT INTO infractions (guild_id, user_id, reason, created_at) VALUES (?, ?, ?, ?)');
const count = db.query('SELECT count(*) AS n FROM infractions WHERE guild_id = ? AND user_id = ? AND revoked = 0 AND created_at > ?');
const list = db.query('SELECT reason, created_at FROM infractions WHERE guild_id = ? AND user_id = ? AND revoked = 0 AND created_at > ? ORDER BY created_at DESC');
const lastId = db.query('SELECT id FROM infractions WHERE guild_id = ? AND user_id = ? AND revoked = 0 ORDER BY created_at DESC, id DESC LIMIT 1');
const revoke = db.query('UPDATE infractions SET revoked = 1 WHERE id = ?');
const getMode = db.query('SELECT mode, since FROM moderation WHERE guild_id = ?');
const setModeQuery = db.query(`INSERT INTO moderation (guild_id, mode, since) VALUES (?1, ?2, ?3)
  ON CONFLICT(guild_id) DO UPDATE SET mode = ?2, since = ?3`);

export function addInfraction(guildId, userId, reason, now = Date.now()) {
  insert.run(guildId, userId, reason, now);
  return count.get(guildId, userId, now - WINDOW).n;
}

export function activeInfractions(guildId, userId, now = Date.now()) {
  return list.all(guildId, userId, now - WINDOW);
}

export function revokeLastInfraction(guildId, userId) {
  const row = lastId.get(guildId, userId);
  if (!row) return false;
  revoke.run(row.id);
  return true;
}

export function moderationMode(guildId, now = Date.now()) {
  const row = getMode.get(guildId);
  if (row) return row;
  setModeQuery.run(guildId, 'observation', now);
  return { mode: 'observation', since: now };
}

export function setModerationMode(guildId, mode, now = Date.now()) {
  if (!MODES.includes(mode)) throw new Error(`mode inconnu : ${mode}`);
  setModeQuery.run(guildId, mode, now);
}
