import { Database } from 'bun:sqlite';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const dbPath = process.env.DB_PATH ?? 'data/magi.db';
const memoryDb = dbPath === ':memory:';
export const backupDir = memoryDb ? null : join(dirname(dbPath), 'copies');
const restoreMarker = memoryDb ? null : join(dirname(dbPath), 'restaurer');
const KEEP_BACKUPS = 10;
if (!memoryDb) mkdirSync(dirname(dbPath), { recursive: true });

if (restoreMarker && existsSync(restoreMarker)) {
  const source = join(backupDir, basename(readFileSync(restoreMarker, 'utf8').trim()));
  if (existsSync(source)) {
    for (const suffix of ['-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
    copyFileSync(source, dbPath);
  }
  rmSync(restoreMarker, { force: true });
}

export const db = new Database(dbPath, { create: true });
db.exec('PRAGMA journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS guilds (
  guild_id TEXT PRIMARY KEY,
  operator_role_id TEXT,
  log_channel_id TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  fact TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  participants TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
)`);
db.exec(`CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);
const reminderColumns = db.query('PRAGMA table_info(reminders)').all().map((c) => c.name);
for (const column of ['persona', 'message_id']) if (!reminderColumns.includes(column)) db.exec(`ALTER TABLE reminders ADD COLUMN ${column} TEXT`);
db.exec(`CREATE TABLE IF NOT EXISTS infractions (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
)`);
db.exec(`CREATE TABLE IF NOT EXISTS moderation (
  guild_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  since INTEGER NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS interventions (
  channel_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS publications (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS settings (
  guild_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (guild_id, key)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  channel_id TEXT NOT NULL,
  data TEXT NOT NULL,
  at INTEGER NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS birthdays (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  month INTEGER NOT NULL,
  day INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS scheduled (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  form TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
)`);
if (!db.query('PRAGMA table_info(scheduled)').all().some((c) => c.name === 'draft')) db.exec('ALTER TABLE scheduled ADD COLUMN draft TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS synchro (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
)`);

export function listBackups() {
  if (!backupDir || !existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((name) => name.endsWith('.db'))
    .map((name) => ({ name, at: statSync(join(backupDir, name)).mtimeMs, size: statSync(join(backupDir, name)).size }))
    .sort((a, b) => b.at - a.at);
}

export function backupDatabase(label = 'copie') {
  if (!backupDir) return null;
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `magi-${stamp}-${label.replace(/[^a-z0-9-]/gi, '')}.db`;
  db.exec(`VACUUM INTO '${join(backupDir, name).replaceAll("'", "''")}'`);
  for (const old of listBackups().filter((b) => b.name.startsWith('magi-')).slice(KEEP_BACKUPS)) rmSync(join(backupDir, old.name), { force: true });
  return name;
}

export function scheduleRestore(name) {
  const found = listBackups().find((b) => b.name === name);
  if (!found || !restoreMarker) throw new Error(`copie introuvable : ${name}`);
  writeFileSync(restoreMarker, found.name);
  return found.name;
}

export function tableCounts() {
  return db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map(({ name }) => ({ name, rows: db.query(`SELECT count(*) AS n FROM "${name}"`).get().n }));
}

export function databaseSize() {
  if (memoryDb) return 0;
  return ['', '-wal'].reduce((total, suffix) => total + (existsSync(`${dbPath}${suffix}`) ? statSync(`${dbPath}${suffix}`).size : 0), 0);
}
