import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FortuneMemoryManager, SqliteProvider } from 'fortunememory';
import { backupDir, db } from '../../core/db.js';
import { setSetting, setting } from '../../core/settings.js';

const MAX_FACTS = 100;
const FACTS_IN_CONTEXT = 6;
const SUMMARIES_IN_CONTEXT = 3;
export const KEEP_MEMORY_COPIES = 7 * 86_400_000;

const dbPath = process.env.DB_PATH ?? 'data/magi.db';
const provider = new SqliteProvider(dbPath === ':memory:' ? ':memory:' : join(dirname(dbPath), 'memoire.db'));
const memory = new FortuneMemoryManager(provider);
const ready = provider.init().then(migrate);

const userScope = (guildId, userId) => `discord/${guildId}/${userId}`;
const conversationScope = (guildId, userId) => `${userScope(guildId, userId)}/conversations`;
const iso = (ms) => new Date(ms).toISOString();

async function migrate() {
  if (setting('global', 'memory_migrated')) return;
  for (const row of db.query('SELECT guild_id, user_id, fact, created_at FROM memories ORDER BY created_at').all()) {
    await memory.remember({ content: row.fact, type: 'fact', scope: userScope(row.guild_id, row.user_id), sourceKind: 'discord', sourceTrust: 'trusted', occurredAt: iso(row.created_at) });
  }
  for (const row of db.query('SELECT guild_id, channel_id, participants, summary, created_at FROM summaries ORDER BY created_at').all()) {
    for (const userId of JSON.parse(row.participants)) {
      await memory.remember({ content: row.summary, type: 'event', scope: conversationScope(row.guild_id, userId), sourceKind: 'discord', sourceLocator: row.channel_id, sourceTrust: 'external', occurredAt: iso(row.created_at) });
    }
  }
  setSetting('global', 'memory_migrated', '1');
}

async function relevant(query, options, limit) {
  const recent = await memory.list({ ...options, limit });
  if (!query?.trim()) return recent;
  const found = await memory.search(query, { ...options, limit });
  const ids = new Set(found.map((m) => m.id));
  return [...found, ...recent.filter((m) => !ids.has(m.id))].slice(0, limit);
}

export async function rememberFact(guildId, userId, fact, now = Date.now()) {
  await ready;
  const clean = fact.trim().slice(0, 300);
  if (!clean) return 'Rien à retenir.';
  const known = await memory.list({ scope: userScope(guildId, userId), type: 'fact', limit: MAX_FACTS });
  if (known.some((m) => m.content.toLowerCase() === clean.toLowerCase())) return 'Déjà retenu.';
  if (known.length >= MAX_FACTS) return `Limite de ${MAX_FACTS} souvenirs atteinte : il faut en oublier avant d'en ajouter.`;
  await memory.remember({ content: clean, type: 'fact', scope: userScope(guildId, userId), sourceKind: 'discord', sourceTrust: 'trusted', occurredAt: iso(now) });
  return `Retenu : ${clean}`;
}

export async function factsAbout(guildId, userId, limit = FACTS_IN_CONTEXT, query = '') {
  await ready;
  return (await relevant(query, { scope: userScope(guildId, userId), type: 'fact' }, limit)).map((m) => m.content);
}

export async function saveSummary(guildId, channelId, participantIds, summary, now = Date.now()) {
  await ready;
  for (const userId of new Set(participantIds)) {
    await memory.remember({ content: summary.trim(), type: 'event', scope: conversationScope(guildId, userId), sourceKind: 'discord', sourceLocator: channelId, sourceTrust: 'external', occurredAt: iso(now) });
  }
}

export async function summariesAbout(guildId, userId, limit = SUMMARIES_IN_CONTEXT, query = '') {
  await ready;
  return (await relevant(query, { scope: conversationScope(guildId, userId), type: 'event' }, limit)).map((m) => m.content);
}

export async function forgetGuild(guildId) {
  await ready;
  const sql = provider.require();
  const pattern = `discord/${guildId}/%`;
  const count = sql.prepare('SELECT count(*) AS n FROM fortune_memories WHERE scope LIKE ?').get(pattern).n;
  sql.prepare('DELETE FROM fortune_memories_fts WHERE id IN (SELECT id FROM fortune_memories WHERE scope LIKE ?)').run(pattern);
  sql.prepare('DELETE FROM fortune_memories WHERE scope LIKE ?').run(pattern);
  return count;
}

export async function backupMemory(path) {
  await ready;
  if (dbPath === ':memory:') return null;
  provider.require().exec(`VACUUM INTO '${path.replaceAll("'", "''")}'`);
  pruneMemoryCopies();
  return path;
}

export function pruneMemoryCopies(dir = backupDir, now = Date.now()) {
  if (!dir || !existsSync(dir)) return 0;
  const old = readdirSync(dir).filter((name) => name.startsWith('memoire-') && name.endsWith('.db') && now - statSync(join(dir, name)).mtimeMs > KEEP_MEMORY_COPIES);
  for (const name of old) rmSync(join(dir, name), { force: true });
  return old.length;
}

export async function forgetUser(guildId, userId) {
  await ready;
  const all = [];
  for (let batch; (batch = await memory.list({ scope: userScope(guildId, userId), limit: 100 })).length; ) {
    for (const m of batch) await memory.forget(m.id);
    all.push(...batch);
  }
  const sql = provider.require();
  sql.prepare("DELETE FROM fortune_memories_fts WHERE id IN (SELECT id FROM fortune_memories WHERE status = 'forgotten')").run();
  sql.prepare("DELETE FROM fortune_memories WHERE status = 'forgotten'").run();
  return { facts: all.filter((m) => m.type === 'fact').length, summaries: all.filter((m) => m.type === 'event').length };
}
