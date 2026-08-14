import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chapter } from '@inkread/core';
import { createLibrarySource, createPublicSource } from './source';

const CHAPTERS: Chapter[] = [
  { title: 'One', paragraphs: ['First.', 'Second.'] },
  { title: 'Two', paragraphs: ['Third.'] },
];

describe('createLibrarySource', () => {
  it('serves the owner the whole book, unlocked and synchronously', async () => {
    const source = createLibrarySource(CHAPTERS);
    expect(source.count).toBe(2);
    expect(source.titles).toEqual(['One', 'Two']);
    // peek resolving same-tick is what keeps the owner's reader gap-free.
    expect(source.peek(0)).toMatchObject({ title: 'One', locked: false, coinCost: 0 });
    expect((await source.getChapter(1)).paragraphs).toEqual(['Third.']);
    expect(source.capabilities).toEqual({
      canAnnotate: true,
      canPersistPosition: true,
      canComment: true,
    });
    expect(source.requireAuth('highlight')).toBe(true);
  });
});

describe('createPublicSource', () => {
  const fetchMock = vi.fn();

  function chapterResponse(body: unknown, ok = true) {
    return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
  }

  function source(overrides: Partial<Parameters<typeof createPublicSource>[0]> = {}) {
    return createPublicSource({
      bookId: 'b1',
      titles: ['One', 'Two', 'Three'],
      signedIn: true,
      balance: 40,
      unlocked: [],
      pricing: { freeChapterCount: 1, coinsPerChapter: 10 },
      ...overrides,
    });
  }

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('exposes the full table of contents even when bodies are not loaded', () => {
    const s = source();
    expect(s.count).toBe(3);
    expect(s.titles).toEqual(['One', 'Two', 'Three']);
    expect(s.peek(0)).toBeUndefined();
  });

  it('serves the chapter the page was rendered with without a fetch', async () => {
    const s = source({
      initial: { index: 0, title: 'One', paragraphs: ['Free body.'], locked: false, coinCost: 0 },
    });
    expect(s.peek(0)?.paragraphs).toEqual(['Free body.']);
    await s.getChapter(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads a chapter lazily and caches it', async () => {
    fetchMock.mockReturnValue(
      chapterResponse({ chapter: { title: 'Two', paragraphs: ['Body.'], locked: false, coinCost: 0 } }),
    );
    const s = source();
    expect((await s.getChapter(1)).paragraphs).toEqual(['Body.']);
    expect(s.peek(1)?.title).toBe('Two');
    await s.getChapter(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/books/b1/read/1');
  });

  it('coalesces concurrent requests for the same chapter', async () => {
    fetchMock.mockReturnValue(
      chapterResponse({ chapter: { title: 'Two', paragraphs: ['Body.'], locked: false, coinCost: 0 } }),
    );
    const s = source();
    await Promise.all([s.getChapter(1), s.getChapter(1), s.getChapter(1)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a paid chapter as locked, with no body and a price', async () => {
    fetchMock.mockReturnValue(
      chapterResponse({ chapter: { title: 'Two', locked: true, coinCost: 10 } }),
    );
    const chapter = await source().getChapter(1);
    expect(chapter).toMatchObject({ locked: true, coinCost: 10 });
    expect(chapter.paragraphs).toBeUndefined();
  });

  it('treats an unreachable chapter as locked rather than blank', async () => {
    fetchMock.mockReturnValue(chapterResponse({ error: 'Not found' }, false));
    const chapter = await source().getChapter(2);
    expect(chapter).toMatchObject({ index: 2, title: 'Three', locked: true, coinCost: 10 });
  });

  it('re-reads the body and the balance after an unlock', async () => {
    fetchMock
      .mockReturnValueOnce(chapterResponse({ chapter: { title: 'Two', locked: true, coinCost: 10 } }))
      .mockReturnValueOnce(
        chapterResponse({ chapter: { title: 'Two', paragraphs: ['Bought.'], locked: false, coinCost: 0 } }),
      )
      .mockReturnValueOnce(chapterResponse({ balance: 30 }));
    const s = source();
    expect((await s.getChapter(1)).locked).toBe(true);
    await s.onUnlocked!(1);
    expect(s.peek(1)?.paragraphs).toEqual(['Bought.']);
    expect(s.unlocked?.has(1)).toBe(true);
    expect(s.wallet?.balance).toBe(30);
  });

  it('keeps the unlock when the wallet refresh fails', async () => {
    fetchMock
      .mockReturnValueOnce(
        chapterResponse({ chapter: { title: 'Two', paragraphs: ['Bought.'], locked: false, coinCost: 0 } }),
      )
      .mockRejectedValueOnce(new Error('offline'));
    const s = source();
    await s.onUnlocked!(1);
    expect(s.peek(1)?.paragraphs).toEqual(['Bought.']);
    expect(s.wallet?.balance).toBe(40); // stale, but harmless
  });

  it('lets a signed-in reader annotate and keep their place in someone else’s book', () => {
    const s = source();
    expect(s.capabilities).toEqual({
      canAnnotate: true,
      canPersistPosition: true,
      canComment: true,
    });
    expect(s.requireAuth('highlight')).toBe(true);
  });

  it('prompts an anonymous reader to sign in instead of writing', () => {
    const onAuthRequired = vi.fn();
    const s = source({ signedIn: false, onAuthRequired });
    expect(s.capabilities).toEqual({
      canAnnotate: false,
      canPersistPosition: false,
      canComment: false,
    });
    expect(s.requireAuth('note')).toBe(false);
    expect(onAuthRequired).toHaveBeenCalledWith('note');
  });

  it('ignores prefetch outside the book', () => {
    const s = source();
    s.prefetch(-1);
    s.prefetch(99);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
