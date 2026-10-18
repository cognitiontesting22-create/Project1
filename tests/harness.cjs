/**
 * Shared setup for the tests that run the query layer against a real SQLite
 * file. Require it before anything from .test-build:
 *
 *   - DATABASE_PATH points at a fresh throwaway file, so data/splitter.db is
 *     never touched and every test file gets its own database, migrated by the
 *     app itself on first use.
 *   - `server-only` throws outside a React Server build; here it's a no-op.
 *   - db.ts imports the shared migration runner, which tsc doesn't copy. The
 *     test files run in parallel, so the copy is written under a temporary
 *     name and renamed into place: a reader never sees a half-written file.
 */
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tally-')), 'test.db');

const serverOnly = require.resolve('server-only');
const stub = new Module(serverOnly);
stub.loaded = true;
require.cache[serverOnly] = stub;

const build = path.join(__dirname, '..', '.test-build');
const partial = path.join(build, `migrate.mjs.${process.pid}`);
fs.copyFileSync(path.join(__dirname, '..', 'lib', 'migrate.mjs'), partial);
fs.renameSync(partial, path.join(build, 'migrate.mjs'));
