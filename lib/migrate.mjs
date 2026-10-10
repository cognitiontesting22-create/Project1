import fs from 'node:fs';
import path from 'node:path';

/**
 * Applies lib/migrations/*.sql in filename order, tracking progress in SQLite's
 * `user_version`. Plain ESM (not TS) so the Next app and scripts/seed.mjs can
 * share one implementation.
 *
 * Migrations are append-only: add a new numbered file, never edit a shipped one.
 */
export function runMigrations(db, dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (let i = db.pragma('user_version', { simple: true }); i < files.length; i++) {
    const sql = fs.readFileSync(path.join(dir, files[i]), 'utf8');

    // `next build` runs several worker processes against this file at once, so
    // take the write lock *before* re-reading the version. Without the recheck
    // two workers could both apply the same ALTER TABLE.
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.pragma('user_version', { simple: true }) > i) {
        db.exec('ROLLBACK');
        continue;
      }
      db.exec(sql);
      db.pragma(`user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${files[i]} failed: ${err.message}`);
    }
  }
}

export const MIGRATIONS_DIR = (cwd) => path.join(cwd, 'lib', 'migrations');
