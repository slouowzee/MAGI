import { db } from './db.js';

const enable = db.query('INSERT OR IGNORE INTO interventions (channel_id, guild_id) VALUES (?, ?)');
const disable = db.query('DELETE FROM interventions WHERE channel_id = ?');
const check = db.query('SELECT 1 FROM interventions WHERE channel_id = ?');
const list = db.query('SELECT channel_id FROM interventions WHERE guild_id = ?');

export function setInterventions(guildId, channelId, enabled) {
  if (enabled) enable.run(channelId, guildId);
  else disable.run(channelId);
}

export function interventionsAllowed(channelId) {
  return Boolean(check.get(channelId));
}

export function interventionChannels(guildId) {
  return list.all(guildId).map((r) => r.channel_id);
}

const clear = db.query('DELETE FROM interventions WHERE guild_id = ?');

export function replaceInterventions(guildId, channelIds) {
  clear.run(guildId);
  for (const id of channelIds) enable.run(id, guildId);
}
