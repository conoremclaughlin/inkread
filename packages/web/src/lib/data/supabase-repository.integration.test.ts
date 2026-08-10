import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseLibraryRepository } from './supabase-repository';
import { getPublicChapter, getPublicSeries, listActiveSeries } from './public';

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

  it('appends chapters without touching annotations', async () => {
    const book = (await repository.listBooks())[0]!;
    const before = await repository.listAnnotations(book.id);

    const updated = await repository.appendChapters(book.id, [
      { title: 'Three', paragraphs: ['Appended paragraph.'] },
    ]);
    expect(updated.chapterCount).toBe(book.chapterCount + 1);

    const chapters = await repository.getChapters(book.id);
    expect(chapters).toHaveLength(book.chapterCount + 1);
    expect(chapters![chapters!.length - 1]!.title).toBe('Three');
    expect(chapters![0]!.paragraphs[0]).toBe('First paragraph.');

    expect(await repository.listAnnotations(book.id)).toEqual(before);
  });

  it('inserts chapters mid-book, shifting later anchors atomically', async () => {
    const book = await repository.createBook({
      title: 'Insert Test',
      source: 'text',
      chapters: [
        { title: 'Alpha', paragraphs: ['A.'] },
        { title: 'Gamma', paragraphs: ['C.'] },
      ],
    });
    const annotation = await repository.createAnnotation({
      bookId: book.id,
      kind: 'highlight',
      chapterIndex: 1,
      start: 0,
      end: 2,
      passage: 'C.',
      color: 'blue',
      chapterTitle: 'Gamma',
    });
    await repository.savePosition({ bookId: book.id, chapterIndex: 1, offset: 1 });

    const updated = await repository.insertChapters(
      book.id,
      [{ title: 'Beta', paragraphs: ['B.'] }],
      1,
    );
    expect(updated.chapterCount).toBe(3);
    expect(await repository.getChapterTitles(book.id)).toEqual(['Alpha', 'Beta', 'Gamma']);

    const [shifted] = await repository.listAnnotations(book.id);
    expect(shifted!.id).toBe(annotation.id);
    expect(shifted!.locator.chapterIndex).toBe(2);
    expect((await repository.getPosition(book.id))?.chapterIndex).toBe(2);

    await repository.deleteBook(book.id);
  });

  it('keeps the furthest pointer as a forward-only high-water mark', async () => {
    const book = (await repository.listBooks())[0]!;
    await repository.savePosition({ bookId: book.id, chapterIndex: 2, offset: 100 });
    // Moving backwards (re-reading) keeps furthest at chapter 2.
    await repository.savePosition({ bookId: book.id, chapterIndex: 0, offset: 5 });
    const position = await repository.getPosition(book.id);
    expect(position?.chapterIndex).toBe(0);
    expect(position?.furthest).toEqual({ chapterIndex: 2, offset: 100 });
    // Reading past it moves the mark forward again.
    await repository.savePosition({ bookId: book.id, chapterIndex: 2, offset: 200 });
    expect((await repository.getPosition(book.id))?.furthest).toEqual({
      chapterIndex: 2,
      offset: 200,
    });
  });

  it('merges preference patches per user', async () => {
    expect(await repository.getPreferences()).toEqual({});
    await repository.savePreferences({ theme: 'midnight', fontSize: 21 });
    await repository.savePreferences({ pagination: 'paged' });
    expect(await repository.getPreferences()).toEqual({
      theme: 'midnight',
      fontSize: 21,
      pagination: 'paged',
    });
  });

  it('lets any reader see chapter comments but only the author delete them', async () => {
    const book = await repository.createBook({
      title: 'Comment Book',
      source: 'text',
      chapters: [{ title: 'One', paragraphs: ['A chapter to discuss.'] }],
    });

    const comment = await repository.createComment({
      bookId: book.id,
      chapterIndex: 0,
      body: '  Loved this chapter.  ',
    });
    expect(comment.body).toBe('Loved this chapter.'); // trimmed
    expect(comment.authorId).toBe(userId);
    expect(comment.authorName).toBeTruthy(); // email local-part

    expect((await repository.listComments(book.id, 0)).map((c) => c.id)).toEqual([comment.id]);
    expect(await repository.listComments(book.id, 1)).toHaveLength(0); // per-chapter

    // Another reader can READ (the social layer) but not DELETE (RLS).
    const otherEmail = `repo-test-reader-${Math.random().toString(36).slice(2, 10)}@inkread.test`;
    const { data: other, error } = await admin.auth.admin.createUser({
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
      const otherRepo = new SupabaseLibraryRepository(otherClient, other.user.id);

      expect((await otherRepo.listComments(book.id, 0)).map((c) => c.id)).toEqual([comment.id]);
      // RLS silently blocks the delete — the comment survives.
      await otherRepo.deleteComment(comment.id);
      expect(await repository.listComments(book.id, 0)).toHaveLength(1);
    } finally {
      await admin.auth.admin.deleteUser(other.user.id);
    }

    // The author can delete their own comment.
    await repository.deleteComment(comment.id);
    expect(await repository.listComments(book.id, 0)).toHaveLength(0);

    await repository.deleteBook(book.id);
  });

  it('publishes a book, tallies comment votes, and exposes it to the public anon reads', async () => {
    const book = await repository.createBook({
      title: 'Serial X',
      source: 'text',
      chapters: [{ title: 'One', paragraphs: ['A chapter to discuss.'] }],
    });

    // Private → invisible to the anon (public) read path.
    expect(await getPublicSeries(book.id)).toBeUndefined();

    await repository.setBookPublication(book.id, { visibility: 'public', status: 'ongoing' });
    expect((await listActiveSeries()).map((s) => s.id)).toContain(book.id);

    const comment = await repository.createComment({
      bookId: book.id,
      chapterIndex: 0,
      body: 'Great opener.',
    });

    // A second reader votes on the public comment.
    const otherEmail = `repo-test-vote-${Math.random().toString(36).slice(2, 10)}@inkread.test`;
    const { data: other, error } = await admin.auth.admin.createUser({
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
      const otherRepo = new SupabaseLibraryRepository(otherClient, other.user.id);

      // Two upvotes → score 2 (trigger keeps the denormalized tallies in step).
      await repository.voteOnComment(comment.id, 1);
      await otherRepo.voteOnComment(comment.id, 1);
      let detail = await getPublicSeries(book.id);
      expect(detail?.comments[0]).toMatchObject({ score: 2, upvotes: 2, downvotes: 0 });
      expect(await repository.listMyVotes([comment.id])).toEqual({ [comment.id]: 1 });

      // Owner switches to a downvote → up 1, down 1, score 0.
      await repository.voteOnComment(comment.id, -1);
      expect((await repository.listMyVotes([comment.id]))[comment.id]).toBe(-1);
      detail = await getPublicSeries(book.id);
      expect(detail?.comments[0]).toMatchObject({ score: 0, upvotes: 1, downvotes: 1 });

      // Owner clears their vote → only the reader's upvote remains, score 1.
      await repository.voteOnComment(comment.id, 0);
      expect(await repository.listMyVotes([comment.id])).toEqual({});
      detail = await getPublicSeries(book.id);
      expect(detail?.comments[0]).toMatchObject({ score: 1, upvotes: 1, downvotes: 0 });
    } finally {
      await admin.auth.admin.deleteUser(other.user.id);
    }

    await repository.deleteBook(book.id);
  });

  it('gates paid chapters behind coin unlocks and shares revenue with the author', async () => {
    const author = await repository.getWallet();
    const book = await repository.createBook({
      title: 'Paywalled Serial',
      source: 'text',
      chapters: [
        { title: 'Free One', paragraphs: ['Free bait.'] },
        { title: 'Paid Two', paragraphs: ['Locked gold.'] },
        { title: 'Paid Three', paragraphs: ['More locked gold.'] },
      ],
    });
    // Publish and price it: chapter 0 free, chapters 1–2 cost 10 coins each.
    await repository.setBookPublication(book.id, {
      visibility: 'public',
      status: 'ongoing',
      freeChapterCount: 1,
      coinsPerChapter: 10,
    });
    const series = await getPublicSeries(book.id);
    expect(series?.series).toMatchObject({ freeChapterCount: 1, coinsPerChapter: 10 });

    // Anonymous visitor: free head readable, paid chapter withheld.
    expect((await getPublicChapter(book.id, 0))?.paragraphs).toEqual(['Free bait.']);
    const anonLocked = await getPublicChapter(book.id, 1);
    expect(anonLocked).toMatchObject({ locked: true, coinCost: 10 });
    expect(anonLocked?.paragraphs).toBeUndefined();

    const readerEmail = `repo-test-coins-${Math.random().toString(36).slice(2, 10)}@inkread.test`;
    const { data: reader, error } = await admin.auth.admin.createUser({
      email: readerEmail,
      password: 'integration-test-pw',
      email_confirm: true,
    });
    if (error) throw error;
    try {
      const readerClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
        auth: { persistSession: false },
      });
      await readerClient.auth.signInWithPassword({
        email: readerEmail,
        password: 'integration-test-pw',
      });
      const readerRepo = new SupabaseLibraryRepository(readerClient, reader.user.id);

      // New readers get the demo signup grant.
      expect((await readerRepo.getWallet()).balance).toBe(100);

      // A paid chapter is locked until purchased.
      expect(await readerRepo.readChapter(book.id, 1)).toMatchObject({
        locked: true,
        coinCost: 10,
        paragraphs: undefined,
      });

      const bought = await readerRepo.unlockChapter(book.id, 1);
      expect(bought).toMatchObject({ coinsSpent: 10, balance: 90 });
      expect(bought.unlocked).toContain(1);
      expect(await readerRepo.listMyUnlocks(book.id)).toEqual([1]);

      // Now the body flows through the gate.
      expect((await readerRepo.readChapter(book.id, 1))?.paragraphs).toEqual(['Locked gold.']);

      // Re-buying is free; buying the book only charges the still-locked ch2.
      expect((await readerRepo.unlockChapter(book.id, 1)).coinsSpent).toBe(0);
      const rest = await readerRepo.unlockBook(book.id);
      expect(rest).toMatchObject({ coinsSpent: 10, balance: 80 });
      expect(rest.unlocked).toEqual([1, 2]);

      // Demo top-up mints coins into the wallet.
      expect(await readerRepo.topUpDemo(50)).toBe(130);

      // The author earned the 20 coins the reader spent (demo revenue share).
      expect((await repository.getWallet()).balance).toBe(author.balance + 20);
    } finally {
      await admin.auth.admin.deleteUser(reader.user.id);
    }

    await repository.deleteBook(book.id);
  });

  it('stores a book voice cast; readers read it, only the owner writes', async () => {
    const book = await repository.createBook({
      title: 'Voiced Book',
      source: 'text',
      chapters: [{ title: 'One', paragraphs: ['Narration. "Dialogue," said Alice.'] }],
    });

    expect(await repository.getVoiceCast(book.id)).toBeUndefined();

    const cast = {
      bookId: book.id,
      speakers: [
        { id: 'nar', name: 'Narrator', voiceId: 'v-nar' },
        { id: 'alice', name: 'Alice', voiceId: 'v-alice' },
      ],
      rules: [{ kind: 'pattern' as const, pattern: '^"', speakerId: 'alice' }],
      defaultSpeakerId: 'nar',
    };
    await repository.saveVoiceCast(cast);

    const loaded = await repository.getVoiceCast(book.id);
    expect(loaded?.speakers.map((s) => s.id)).toEqual(['nar', 'alice']);
    expect(loaded?.rules).toHaveLength(1);
    expect(loaded?.defaultSpeakerId).toBe('nar');

    // Upsert replaces in place.
    await repository.saveVoiceCast({ ...cast, defaultSpeakerId: 'alice' });
    expect((await repository.getVoiceCast(book.id))?.defaultSpeakerId).toBe('alice');

    // Another reader can READ but not WRITE (RLS) — the owner's cast survives.
    const otherEmail = `repo-test-voice-${Math.random().toString(36).slice(2, 10)}@inkread.test`;
    const { data: other, error } = await admin.auth.admin.createUser({
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
      const otherRepo = new SupabaseLibraryRepository(otherClient, other.user.id);

      expect((await otherRepo.getVoiceCast(book.id))?.speakers).toHaveLength(2);
      await otherRepo
        .saveVoiceCast({ ...cast, defaultSpeakerId: 'hijacked' })
        .catch(() => undefined); // RLS blocks it — may throw or no-op
      expect((await repository.getVoiceCast(book.id))?.defaultSpeakerId).toBe('alice');
    } finally {
      await admin.auth.admin.deleteUser(other.user.id);
    }

    await repository.deleteBook(book.id);
  });

  it('registers chapter recordings; readers read, only the owner writes', async () => {
    const book = await repository.createBook({
      title: 'Recorded Book',
      source: 'text',
      chapters: [{ title: 'One', paragraphs: ['Audio here.'] }],
    });

    expect(await repository.getChapterRecording(book.id, 0)).toBeUndefined();

    const rec = await repository.saveChapterRecording({
      bookId: book.id,
      chapterIndex: 0,
      storagePath: `${book.id}/0.wav`,
      durationSeconds: 12.5,
    });
    expect(rec.storagePath).toBe(`${book.id}/0.wav`);
    expect(rec.durationSeconds).toBe(12.5);
    expect((await repository.getChapterRecording(book.id, 0))?.id).toBe(rec.id);
    expect(await repository.listChapterRecordings(book.id)).toHaveLength(1);

    // Upsert per (book, chapter) replaces in place.
    await repository.saveChapterRecording({
      bookId: book.id,
      chapterIndex: 0,
      storagePath: `${book.id}/0-v2.wav`,
    });
    expect((await repository.getChapterRecording(book.id, 0))?.storagePath).toBe(`${book.id}/0-v2.wav`);
    expect(await repository.listChapterRecordings(book.id)).toHaveLength(1);

    // Reader reads; non-owner write is RLS-blocked.
    const otherEmail = `repo-test-rec-${Math.random().toString(36).slice(2, 10)}@inkread.test`;
    const { data: other, error } = await admin.auth.admin.createUser({
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
      const otherRepo = new SupabaseLibraryRepository(otherClient, other.user.id);
      expect((await otherRepo.getChapterRecording(book.id, 0))?.storagePath).toBe(
        `${book.id}/0-v2.wav`,
      );
      await otherRepo
        .saveChapterRecording({ bookId: book.id, chapterIndex: 0, storagePath: 'hijack.wav' })
        .catch(() => undefined);
      expect((await repository.getChapterRecording(book.id, 0))?.storagePath).toBe(
        `${book.id}/0-v2.wav`,
      );
    } finally {
      await admin.auth.admin.deleteUser(other.user.id);
    }

    await repository.deleteBook(book.id);
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
