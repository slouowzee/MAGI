import { db } from '../../core/db.js';

const WINDOW = 30 * 24 * 3600_000;
export const MODES = ['observation', 'active', 'desactivee'];

const insert = db.query('INSERT INTO infractions (guild_id, user_id, reason, created_at) VALUES (?, ?, ?, ?)');
const count = db.query('SELECT count(*) AS n FROM infractions WHERE guild_id = ? AND user_id = ? AND revoked = 0 AND created_at > ?');
const list = db.query('SELECT reason, created_at FROM infractions WHERE guild_id = ? AND user_id = ? AND revoked = 0 AND created_at > ? ORDER BY created_at DESC');
const lastId = db.query('SELECT id FROM infractions WHERE guild_id = ? AND user_id = ? AND revoked = 0 ORDER BY created_at DESC, id DESC LIMIT 1');
const revoke = db.query('UPDATE infractions SET revoked = 1 WHERE id = ?');
const insertCase = db.query('INSERT INTO cases (guild_id, user_id, data, created_at) VALUES (?, ?, ?, ?)');
const getCaseQuery = db.query('SELECT * FROM cases WHERE id = ?');
const updateCase = db.query('UPDATE cases SET data = ? WHERE id = ?');
const casesOfQuery = db.query('SELECT * FROM cases WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?');
const getMode = db.query('SELECT mode, since FROM moderation WHERE guild_id = ?');
const setModeQuery = db.query(`INSERT INTO moderation (guild_id, mode, since) VALUES (?1, ?2, ?3)
  ON CONFLICT(guild_id) DO UPDATE SET mode = ?2, since = ?3`);

export function addInfraction(guildId, userId, reason, now = Date.now()) {
  return recordInfraction(guildId, userId, reason, now).count;
}

export function recordInfraction(guildId, userId, reason, now = Date.now()) {
  const { lastInsertRowid } = insert.run(guildId, userId, reason, now);
  return { id: Number(lastInsertRowid), count: count.get(guildId, userId, now - WINDOW).n };
}

export function revokeInfraction(id) {
  return revoke.run(id).changes > 0;
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

const parse = (row) => row && { id: row.id, guildId: row.guild_id, userId: row.user_id, at: row.created_at, ...JSON.parse(row.data) };

export function createCase(guildId, userId, data, now = Date.now()) {
  return Number(insertCase.run(guildId, userId, JSON.stringify(data), now).lastInsertRowid);
}

export function getCase(id) {
  return parse(getCaseQuery.get(id));
}

export function saveCase({ id, guildId, userId, at, ...data }) {
  updateCase.run(JSON.stringify(data), id);
}

export function casesOf(guildId, userId, limit = 10) {
  return casesOfQuery.all(guildId, userId, limit).map(parse);
}

const purgeInfractions = db.query('DELETE FROM infractions WHERE guild_id = ? AND user_id = ?');
const purgeCases = db.query('DELETE FROM cases WHERE guild_id = ? AND user_id = ?');
const allCases = db.query('SELECT * FROM cases WHERE guild_id = ? AND user_id = ? ORDER BY id');
const countAll = db.query('SELECT count(*) AS n FROM infractions WHERE guild_id = ? AND user_id = ?');

export function recordOf(guildId, userId) {
  return { cases: allCases.all(guildId, userId).map(parse), infractions: countAll.get(guildId, userId).n };
}

export function purgeMember(guildId, userId) {
  const record = recordOf(guildId, userId);
  purgeInfractions.run(guildId, userId);
  purgeCases.run(guildId, userId);
  return record;
}
