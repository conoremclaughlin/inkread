/**
 * Batch-import .txt / .md files into an inkread library through the API.
 *
 *   yarn workspace @inkread/web import:texts <directory> [--api http://127.0.0.1:6021]
 *
 * Auth: INKREAD_EMAIL + INKREAD_PASSWORD env vars (a user on the target
 * stack); SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY are read from .env.local.
 * Each file becomes one book: filename → title, markdown/ALL-CAPS/"Chapter"
 * headings → chapter breaks.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { textToChapters, type TextToChaptersOptions } from '@inkread/core';

function loadDotEnvLocal(): void {
  const path = resolve(import.meta.dirname, '../.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!;
  }
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const args = process.argv.slice(2);
  const apiFlag = args.indexOf('--api');
  const headingsFlag = args.indexOf('--headings');
  const headings = (headingsFlag >= 0 ? args[headingsFlag + 1] : 'auto') as NonNullable<
    TextToChaptersOptions['headings']
  >;
  const apiUrl = apiFlag >= 0 ? args[apiFlag + 1]! : (process.env.APP_URL ?? 'http://127.0.0.1:6021');
  const flagValueIndexes = new Set([apiFlag, headingsFlag].filter((i) => i >= 0).map((i) => i + 1));
  const directory = args.filter((a, i) => !a.startsWith('--') && !flagValueIndexes.has(i))[0];

  const email = process.env.INKREAD_EMAIL;
  const password = process.env.INKREAD_PASSWORD;
  if (!directory || !email || !password) {
    console.error(
      'Usage: INKREAD_EMAIL=you@example.com INKREAD_PASSWORD=... yarn workspace @inkread/web import:texts <directory> [--api <url>]',
    );
    process.exit(1);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    console.error(`Sign-in failed: ${error?.message ?? 'no session'}`);
    process.exit(1);
  }
  const token = data.session.access_token;

  const files = readdirSync(directory)
    .filter((name) => ['.txt', '.md', '.markdown'].includes(extname(name).toLowerCase()))
    .sort();
  if (files.length === 0) {
    console.error(`No .txt/.md files found in ${directory}`);
    process.exit(1);
  }

  let imported = 0;
  let failed = 0;
  for (const file of files) {
    const raw = readFileSync(join(directory, file), 'utf8');
    const title = basename(file, extname(file)).replace(/[-_]+/g, ' ').trim();
    const chapters = textToChapters(raw, title, { headings });
    if (chapters.length === 0) {
      console.warn(`skip  ${file} (no readable text)`);
      continue;
    }
    const response = await fetch(`${apiUrl}/api/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title, source: 'text', chapters }),
    });
    if (response.ok) {
      imported += 1;
      console.log(`ok    ${title} (${chapters.length} chapters)`);
    } else {
      failed += 1;
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      console.error(`fail  ${title}: ${body.error ?? response.status}`);
    }
  }
  console.log(`\nImported ${imported}/${files.length} (${failed} failed)`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
