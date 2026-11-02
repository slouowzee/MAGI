import { db } from '../../core/db.js';
import { listSettings, setSetting, setting } from '../../core/settings.js';
import { log } from '../../core/log/log.js';
import { dropFiles } from '../commands/publication.js';
import { forgetGuild } from '../memory/store.js';

export const KEEP_AFTER_LEAVING = 30 * 86_400_000;
const LEFT = 'left:';
const DAY = 86_400_000;

const guildTables = () =>
  db
    .query("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map(({ name }) => name)
    .filter((name) => db.query(`PRAGMA table_info(${name})`).all().some((c) => c.name === 'guild_id'));

export function knownGuilds() {
  const ids = new Set();
  for (const table of guildTables()) for (const { guild_id: id } of db.query(`SELECT DISTINCT guild_id FROM ${table}`).all()) if (/^\d+$/.test(id)) ids.add(id);
  return [...ids];
}

export function markLeft(guildId, now = Date.now()) {
  if (!setting('global', `${LEFT}${guildId}`)) setSetting('global', `${LEFT}${guildId}`, now);
}

export const markBack = (guildId) => setSetting('global', `${LEFT}${guildId}`, null);

export async function purgeGuild(guildId) {
  for (const { id } of db.query('SELECT id FROM scheduled WHERE guild_id = ?').all(guildId)) dropFiles(id);
  let rows = await forgetGuild(guildId);
  for (const table of guildTables()) rows += db.query(`DELETE FROM ${table} WHERE guild_id = ?`).run(guildId).changes;
  markBack(guildId);
  return rows;
}

export async function sweepDepartures(present, now = Date.now()) {
  for (const id of present) markBack(id);
  for (const id of knownGuilds()) if (!present.includes(id)) markLeft(id, now);
  const purged = [];
  for (const { key, value } of listSettings('global', LEFT)) {
    const id = key.slice(LEFT.length);
    if (now - Number(value) < KEEP_AFTER_LEAVING) continue;
    log.notice('installation', `données du serveur ${id} effacées, ${await purgeGuild(id)} lignes, 30 jours après le départ de MAGI`);
    purged.push(id);
  }
  return purged;
}

export function startDepartures(client) {
  const sweep = () => sweepDepartures([...client.guilds.cache.keys()]).catch((err) => log.err('installation', `effacement des serveurs quittés impossible : ${err.message}`));
  sweep();
  setInterval(sweep, DAY);
}
