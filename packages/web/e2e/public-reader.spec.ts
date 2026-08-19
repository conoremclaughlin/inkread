import { BOOK_CHAPTERS, expect, requireStack, signIn, test } from './fixtures';

/**
 * The public reader — the same reader component, pointed at a published series.
 *
 * What matters here is that the *view* is one thing and the *data* is two: an
 * anonymous visitor gets the free head and a paywall, a signed-in reader gets
 * their unlocks, and the chrome (chapters, theme, listen, discussion) is the
 * same either way. Also that a locked chapter never ships its text.
 */

requireStack();

const chapterUrl = (bookId: string, index: number) => `/series/${bookId}/read/${index}`;

test.describe('public reader', () => {
  test('reads the free chapter anonymously, in the real reader', async ({ page, series }) => {
    await page.goto(chapterUrl(series.bookId, 0));
    await expect(page.locator('p[data-po="0"]')).toHaveText(BOOK_CHAPTERS[0]!.paragraphs[0]!);
    // Not the old lean page: this is the reader, with its chrome.
    await expect(page.getByRole('button', { name: 'Chapters' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Listen' })).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByText(`1 / ${BOOK_CHAPTERS.length}`)).toBeVisible();
  });

  test('shows a paywall instead of a paid chapter, and never ships its text', async ({
    page,
    series,
  }) => {
    const response = await page.goto(chapterUrl(series.bookId, 1));
    await expect(page.getByRole('heading', { name: 'This chapter is locked' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Sign in to unlock — ${series.coinsPerChapter} coins` }),
    ).toBeVisible();

    // The body must not be in the payload at all — a paywall you can read
    // around is not a paywall.
    const html = (await response!.text()).toLowerCase();
    for (const paragraph of BOOK_CHAPTERS[1]!.paragraphs) {
      expect(html).not.toContain(paragraph.slice(0, 40).toLowerCase());
    }
  });

  test('keeps the table of contents usable across locked chapters', async ({ page, series }) => {
    await page.goto(chapterUrl(series.bookId, 0));
    await page.getByRole('button', { name: 'Chapters' }).click();
    // Titles are public even where the bodies are not.
    await expect(page.getByRole('button', { name: BOOK_CHAPTERS[1]!.title })).toBeVisible();
    await page.getByRole('button', { name: BOOK_CHAPTERS[1]!.title }).click();
    await expect(page.getByRole('heading', { name: 'This chapter is locked' })).toBeVisible();
  });

  test('invites an anonymous reader to sign in rather than posting', async ({ page, series }) => {
    await page.goto(chapterUrl(series.bookId, 0));
    await page.getByRole('button', { name: 'Comments' }).click();
    await expect(page.getByText('to join the discussion.')).toBeVisible();
  });

  test('unlocks a chapter with coins and reveals the text in place', async ({ page, series }) => {
    await signIn(page, series.email, series.password);
    await page.goto(chapterUrl(series.bookId, 1));

    // Signup granted the demo wallet; the reader shows what it can spend.
    await expect(page.getByText(/^\d+ coins$/).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'This chapter is locked' })).toBeVisible();

    await page
      .getByRole('button', { name: `Unlock this chapter — ${series.coinsPerChapter} coins` })
      .click();

    // No reload: the source refetches the body and the reader renders it.
    await expect(page.locator('p[data-po="0"]')).toHaveText(BOOK_CHAPTERS[1]!.paragraphs[0]!);
    await expect(page.getByRole('heading', { name: 'This chapter is locked' })).toHaveCount(0);

    // And it stays bought.
    await page.reload();
    await expect(page.locator('p[data-po="0"]')).toHaveText(BOOK_CHAPTERS[1]!.paragraphs[0]!);
  });

  test('lets a signed-in reader highlight a book they do not own', async ({ page, series }) => {
    await signIn(page, series.email, series.password);
    await page.goto(chapterUrl(series.bookId, 0));
    await page.locator('p[data-po="0"]').evaluate((node) => {
      const text = node.firstChild!;
      const range = document.createRange();
      range.setStart(text, 4);
      range.setEnd(text, 10);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.getByRole('button', { name: 'Highlight blue' }).click();
    await expect(page.locator('[data-hl]')).toHaveText('keeper');
    await page.reload();
    await expect(page.locator('[data-hl]')).toHaveText('keeper');
  });
});
