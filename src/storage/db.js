import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const dbPath = process.env.DB_PATH ?? 'data/magi.db';
mkdirSync(dirname(dbPath), { recursive: true });

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
db.exec(`CREATE TABLE IF NOT EXISTS synchro (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
)`);
