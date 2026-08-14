import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { test as base, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Test fixtures: a throwaway account with a seeded book, signed in.
 *
 * Every test gets its own user (created through the Supabase admin API against
 * the local stack) and its own book, so tests never collide and nothing needs
 * cleaning up between runs — the user, and everything cascading off it, is
 * deleted afterwards. Credentials are generated per run and never leave the
 * local stack.
 */

function loadDotEnvLocal(): void {
  // Playwright runs from packages/web; fall back to a repo-root invocation.
  const candidates = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), 'packages/web/.env.local'),
  ];
  const path = candidates.find(existsSync);
  if (!path) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!;
  }
}
loadDotEnvLocal();

export const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54521';
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? '';
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? '';

let stackCheck: Promise<boolean> | undefined;

/** Is the local Supabase stack reachable? Checked once, cached for the run. */
export function stackIsUp(): Promise<boolean> {
  stackCheck ??= (async () => {
    if (!PUBLISHABLE_KEY || !SECRET_KEY) return false;
    try {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  })();
  return stackCheck;
}

/** Skip the calling suite when there's no stack to talk to (e.g. CI, offline). */
export function requireStack(): void {
  base.beforeEach(async () => {
    base.skip(!(await stackIsUp()), 'local Supabase stack is not running');
  });
}

export interface SeededChapter {
  title: string;
  paragraphs: string[];
}

/**
 * Ledger entries, generated so a chapter is genuinely several pages long —
 * pagination, scrolling and position-saving are only exercised by a chapter
 * that overflows the viewport. Deterministic, so offsets are stable per run.
 */
function ledgerEntries(count: number, offset: number): string[] {
  const weather = ['fog', 'a flat calm', 'rain from the south', 'a hard easterly', 'clear air'];
  const events = [
    'the ferry passed on time',
    'nothing passed at all',
    'a trawler sheltered in the lee until morning',
    'the bell buoy rang the whole watch',
    'two gulls argued on the rail',
  ];
  return Array.from({ length: count }, (_, i) => {
    const day = offset + i + 1;
    return (
      `Day ${day}. The keeper climbed the stair at the usual hour and found ${weather[day % weather.length]} ` +
      `waiting at the glass. He trimmed the wick, wound the clock, and wrote that ${events[day % events.length]}. ` +
      'The beam went out across the water and the town below forgot him for another night, which was the arrangement ' +
      'and which suited them both.'
    );
  });
}

/** The book every reader test opens: two chapters, prose long enough to page. */
export const BOOK_CHAPTERS: SeededChapter[] = [
  {
    title: 'The Lantern Room',
    paragraphs: [
      'The keeper climbed the stair each evening at the same hour, and the light went out across the water like a held breath.',
      'Below, the town forgot him. Above, the lamp remembered everything: every ship, every squall, every night the fog came in so thick the beam stopped at the glass.',
      ...ledgerEntries(30, 0),
    ],
  },
  {
    title: 'Salt and Paper',
    paragraphs: [
      'Spring brought the inspectors, who admired the brass and asked no questions about the ledger.',
      ...ledgerEntries(20, 100),
    ],
  },
];

export interface Seeded {
  userId: string;
  email: string;
  password: string;
  bookId: string;
  admin: SupabaseClient;
}

async function seedUserAndBook(): Promise<Seeded> {
  const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });
  const email = `e2e-${randomBytes(5).toString('hex')}@inkread.test`;
  const password = randomBytes(12).toString('hex');
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = data.user.id;

  const bookId = randomUUID();
  const { error: bookError } = await admin.from('books').insert({
    id: bookId,
    user_id: userId,
    title: 'The Lantern Keeper',
    author: 'E. Marsh',
    source: 'text',
    chapter_count: BOOK_CHAPTERS.length,
  });
  if (bookError) throw bookError;
  const { error: contentError } = await admin.from('chapters').insert(
    BOOK_CHAPTERS.map((chapter, index) => ({
      book_id: bookId,
      user_id: userId,
      chapter_index: index,
      title: chapter.title,
      paragraphs: chapter.paragraphs,
    })),
  );
  if (contentError) throw contentError;

  return { userId, email, password, bookId, admin };
}

/** Sign in through the app so the session cookie is set the way the app sets it. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/library', { timeout: 20_000 });
}

export const test = base.extend<{ seeded: Seeded; reader: { page: Page; seeded: Seeded } }>({
  seeded: async ({}, use) => {
    const seeded = await seedUserAndBook();
    await use(seeded);
    await seeded.admin.auth.admin.deleteUser(seeded.userId);
  },
  /** A signed-in page already open on the seeded book's first chapter. */
  reader: async ({ page, seeded }, use) => {
    await signIn(page, seeded.email, seeded.password);
    await page.goto(`/read/${seeded.bookId}`);
    await page.locator('p[data-po="0"]').waitFor();
    await use({ page, seeded });
  },
});

export { expect } from '@playwright/test';

/** Chapter text as the offset model sees it: paragraphs joined by newlines. */
export function chapterText(index: number): string {
  return BOOK_CHAPTERS[index]!.paragraphs.join('\n');
}
