import { db } from './db.js';

const MAX_FACTS = 30;
const FACTS_IN_CONTEXT = 10;
const SUMMARIES_IN_CONTEXT = 3;

const countFacts = db.query('SELECT count(*) AS n FROM memories WHERE guild_id = ? AND user_id = ?');
const findFact = db.query('SELECT 1 FROM memories WHERE guild_id = ? AND user_id = ? AND lower(fact) = lower(?)');
const insertFact = db.query('INSERT INTO memories (guild_id, user_id, fact, created_at) VALUES (?, ?, ?, ?)');
const selectFacts = db.query('SELECT fact FROM memories WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?');
const deleteFacts = db.query('DELETE FROM memories WHERE guild_id = ? AND user_id = ?');
const insertSummary = db.query('INSERT INTO summaries (guild_id, channel_id, participants, summary, created_at) VALUES (?, ?, ?, ?, ?)');
const selectSummaries = db.query(`SELECT summary FROM summaries WHERE guild_id = ?1 AND EXISTS (SELECT 1 FROM json_each(participants) WHERE value = ?2)
  ORDER BY created_at DESC, id DESC LIMIT ?3`);
const deleteSummaries = db.query('DELETE FROM summaries WHERE guild_id = ?1 AND EXISTS (SELECT 1 FROM json_each(participants) WHERE value = ?2)');

export function rememberFact(guildId, userId, fact, now = Date.now()) {
  const clean = fact.trim().slice(0, 300);
  if (!clean) return 'Rien à retenir.';
  if (findFact.get(guildId, userId, clean)) return 'Déjà retenu.';
  if (countFacts.get(guildId, userId).n >= MAX_FACTS) return `Limite de ${MAX_FACTS} souvenirs atteinte : il faut en oublier avant d'en ajouter.`;
  insertFact.run(guildId, userId, clean, now);
  return `Retenu : ${clean}`;
}

export function factsAbout(guildId, userId, limit = FACTS_IN_CONTEXT) {
  return selectFacts.all(guildId, userId, limit).map((r) => r.fact);
}

export function saveSummary(guildId, channelId, participantIds, summary, now = Date.now()) {
  insertSummary.run(guildId, channelId, JSON.stringify([...new Set(participantIds)]), summary.trim(), now);
}

export function summariesAbout(guildId, userId, limit = SUMMARIES_IN_CONTEXT) {
  return selectSummaries.all(guildId, userId, limit).map((r) => r.summary);
}

export function forgetUser(guildId, userId) {
  const facts = deleteFacts.run(guildId, userId).changes;
  const summaries = deleteSummaries.run(guildId, userId).changes;
  return { facts, summaries };
}
