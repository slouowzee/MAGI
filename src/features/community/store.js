import { db } from '../../core/db.js';

const upsertBirthday = db.query(`INSERT INTO birthdays (guild_id, user_id, month, day) VALUES (?1, ?2, ?3, ?4)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET month = ?3, day = ?4`);
const removeBirthday = db.query('DELETE FROM birthdays WHERE guild_id = ? AND user_id = ?');
const birthdaysOn = db.query('SELECT user_id FROM birthdays WHERE guild_id = ? AND month = ? AND day = ?');
const birthdayOf = db.query('SELECT month, day FROM birthdays WHERE guild_id = ? AND user_id = ?');
const getSynchro = db.query('SELECT points, last_at FROM synchro WHERE guild_id = ? AND user_id = ?');
const putSynchro = db.query(`INSERT INTO synchro (guild_id, user_id, points, last_at) VALUES (?1, ?2, ?3, ?4)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET points = ?3, last_at = ?4`);
const topSynchro = db.query('SELECT user_id, points FROM synchro WHERE guild_id = ? ORDER BY points DESC LIMIT ?');
const countSynchro = db.query(`INSERT INTO synchro (guild_id, user_id, points, last_at, week, week_points) VALUES (?1, ?2, ?3, ?4, ?5, 1)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET points = ?3, last_at = ?4, week_points = CASE WHEN week = ?5 THEN week_points + 1 ELSE 1 END, week = ?5`);
const rankSynchro = db.query('SELECT count(*) + 1 AS rank FROM synchro WHERE guild_id = ? AND points > ?');
const topWeek = db.query('SELECT user_id, week_points FROM synchro WHERE guild_id = ? AND week = ? ORDER BY week_points DESC LIMIT ?');

export function setBirthday(guildId, userId, month, day) {
  upsertBirthday.run(guildId, userId, month, day);
}

export function deleteBirthday(guildId, userId) {
  return removeBirthday.run(guildId, userId).changes > 0;
}

export function birthdayOfUser(guildId, userId) {
  return birthdayOf.get(guildId, userId) ?? null;
}

export function birthdaysToday(guildId, month, day) {
  return birthdaysOn.all(guildId, month, day).map((r) => r.user_id);
}

export function synchroOf(guildId, userId) {
  return getSynchro.get(guildId, userId) ?? { points: 0, last_at: 0 };
}

export function saveSynchro(guildId, userId, points, at) {
  putSynchro.run(guildId, userId, points, at);
}

export function synchroTop(guildId, limit = 5) {
  return topSynchro.all(guildId, limit);
}

export function countActivity(guildId, userId, points, at, week) {
  countSynchro.run(guildId, userId, points, at, week);
}

export const synchroRank = (guildId, points) => rankSynchro.get(guildId, points).rank;
export const weekTop = (guildId, week, limit = 5) => topWeek.all(guildId, week, limit);
