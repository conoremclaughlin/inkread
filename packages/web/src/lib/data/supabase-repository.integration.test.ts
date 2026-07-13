import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseLibraryRepository } from './supabase-repository';

/**
 * Integration test against the local Supabase stack: real Postgres, real
 * RLS. Creates a throwaway user, drives the full repository surface, and
 * cleans up. Skips itself when the stack isn't running (CI without docker)
 * or when keys aren't configured.
 *
 * Config comes from the environment or packages/web/.env.local (gitignored);
 * grab the values from `supabase status` — SUPABASE_SECRET_KEY is the
 * "Secret" key.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnvLocal(): void {
  const path = resolve(import.meta.dirname, '../../../.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!;
  }
}
loadDotEnvLocal();

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54521';
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? '';
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? '';

async function stackIsUp(): Promise<boolean> {
  if (!PUBLISHABLE_KEY || !SECRET_KEY) return false;
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const up = await stackIsUp();

describe.skipIf(!up)('SupabaseLibraryRepository (integration)', () => {
  let admin: SupabaseClient;
  let client: SupabaseClient;
  let repository: SupabaseLibraryRepository;
  let userId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });
    const email = `repo-test-${Math.random().toString(36).slice(2, 10)}@inkread.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: 'integration-test-pw',
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;

    client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
    const { error: signInError } = await client.auth.signInWithPassword({
      email,
      password: 'integration-test-pw',
    });
    if (signInError) throw signInError;
    repository = new SupabaseLibraryRepository(client, userId);
  });

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it('round-trips a book with content through RLS', async () => {
    const book = await repository.createBook({
      title: 'Integration Book',
      author: 'Test Author',
      source: 'text',
      chapters: [
        { title: 'One', paragraphs: ['First paragraph.', 'Second paragraph.'] },
        { title: 'Two', paragraphs: ['Third paragraph.'] },
      ],
    });
    expect(book.chapterCount).toBe(2);

    const books = await repository.listBooks();
    expect(books.map((b) => b.id)).toContain(book.id);

    const chapters = await repository.getChapters(book.id);
    expect(chapters).toHaveLength(2);
    expect(chapters![0]!.paragraphs[1]).toBe('Second paragraph.');
  });

  it('manages annotations and reading positions', async () => {
    const book = (await repository.listBooks())[0]!;
    const annotation = await repository.createAnnotation({
      bookId: book.id,
      kind: 'highlight',
      chapterIndex: 0,
      start: 0,
      end: 16,
      passage: 'First paragraph.',
      color: 'green',
      chapterTitle: 'One',
    });
    expect(annotation.locator).toEqual({ chapterIndex: 0, start: 0, end: 16 });

    await repository.updateAnnotationNote(annotation.id, 'a thought');
    const annotations = await repository.listAnnotations(book.id);
    expect(annotations[0]!.note).toBe('a thought');
    expect(annotations[0]!.kind).toBe('note');

    await repository.savePosition({ bookId: book.id, chapterIndex: 1, offset: 42 });
    const position = await repository.getPosition(book.id);
    expect(position).toMatchObject({ chapterIndex: 1, offset: 42 });

    await repository.deleteAnnotation(annotation.id);
    expect(await repository.listAnnotations(book.id)).toHaveLength(0);
  });

  it('cannot see another user\'s books (RLS)', async () => {
    const otherEmail = `repo-test-other-${Math.random().toString(36).slice(2, 10)}@inkread.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email: otherEmail,
      password: 'integration-test-pw',
      email_confirm: true,
    });
    if (error) throw error;
    try {
      const otherClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
        auth: { persistSession: false },
      });
      await otherClient.auth.signInWithPassword({
        email: otherEmail,
        password: 'integration-test-pw',
      });
      const otherRepository = new SupabaseLibraryRepository(otherClient, data.user.id);
      expect(await otherRepository.listBooks()).toHaveLength(0);
      const mine = (await repository.listBooks())[0]!;
      expect(await otherRepository.getBook(mine.id)).toBeUndefined();
    } finally {
      await admin.auth.admin.deleteUser(data.user.id);
    }
  });

  it('deletes a book and cascades its content', async () => {
    const book = (await repository.listBooks())[0]!;
    await repository.deleteBook(book.id);
    expect(await repository.getBook(book.id)).toBeUndefined();
    expect(await repository.getChapters(book.id)).toBeUndefined();
  });
});

// Surface an explicit marker in output when skipped so a green run without
// the stack isn't mistaken for full coverage.
describe.skipIf(up)('SupabaseLibraryRepository (integration)', () => {
  it.skip('skipped: local Supabase stack not running', () => {});
});
