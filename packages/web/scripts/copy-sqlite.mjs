#!/usr/bin/env node
/**
 * Copies the SQLite WASM runtime into public/ so the worker can load it
 * outside the bundler — Turbopack can't statically resolve sqlite-wasm's
 * internal dynamic worker URLs. Runs on postinstall; output is gitignored.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve('@sqlite.org/sqlite-wasm/package.json'));
const source = join(pkg, 'dist');
const target = join(here, '../public/sqlite');

const FILES = ['index.mjs', 'sqlite3.wasm', 'sqlite3-worker1.mjs', 'sqlite3-opfs-async-proxy.js'];
mkdirSync(target, { recursive: true });
for (const file of FILES) {
  copyFileSync(join(source, file), join(target, file));
}
console.log(`copy-sqlite: ${FILES.join(', ')} → public/sqlite/`);
