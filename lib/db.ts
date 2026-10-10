import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS_DIR, runMigrations } from './migrate.mjs';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = process.env.DATABASE_PATH ?? path.join(DATA_DIR, 'splitter.db');

// Next.js dev mode hot-reloads modules, which would otherwise leak a new
// connection (and re-run migrations) on every edit. Cache on globalThis.
const globalForDb = globalThis as unknown as { __db?: Database.Database };

function create(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);

  // `next build` collects page data in several worker processes at once, and
  // each one opens this file. Wait for the lock instead of failing instantly.
  db.pragma('busy_timeout = 5000');

  // Switching journal modes takes an exclusive lock, so only do it when the
  // file isn't already in WAL (the setting is persisted in the db header).
  const [{ journal_mode: mode }] = db.pragma('journal_mode') as { journal_mode: string }[];
  if (mode !== 'wal') db.pragma('journal_mode = WAL');

  db.pragma('foreign_keys = ON');
  runMigrations(db, MIGRATIONS_DIR(process.cwd()));
  return db;
}

export const db: Database.Database = globalForDb.__db ?? (globalForDb.__db = create());
