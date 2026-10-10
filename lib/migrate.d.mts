import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database, dir: string): void;
export function MIGRATIONS_DIR(cwd: string): string;
