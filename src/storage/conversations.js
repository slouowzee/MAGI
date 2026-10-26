import { db } from './db.js';

const upsert = db.query(`INSERT INTO conversations (id, channel_id, data, at) VALUES (?1, ?2, ?3, ?4)
  ON CONFLICT(id) DO UPDATE SET data = ?3, at = ?4`);
const remove = db.query('DELETE FROM conversations WHERE id = ?');
const recent = db.query('SELECT data FROM conversations WHERE at > ? ORDER BY id');
const prune = db.query('DELETE FROM conversations WHERE at <= ?');
const maxId = db.query('SELECT max(id) AS id FROM conversations');

export function saveConversation(c) {
  const data = { ...c, participants: [...c.participants], personas: [...c.personas] };
  upsert.run(c.id, c.channelId, JSON.stringify(data), c.at);
}

export function deleteConversation(id) {
  remove.run(id);
}

export function loadConversations(since) {
  prune.run(since);
  return recent.all(since).map(({ data }) => {
    const c = JSON.parse(data);
    return { ...c, participants: new Set(c.participants), personas: new Set(c.personas) };
  });
}

export function lastConversationId() {
  return maxId.get().id ?? 0;
}
