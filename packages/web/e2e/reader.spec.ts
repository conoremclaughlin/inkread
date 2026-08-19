import { BOOK_CHAPTERS, expect, requireStack, test } from './fixtures';

/**
 * The web reader, end to end.
 *
 * Everything here needs a real browser: layout (the chapter fills the page,
 * columns paginate), live selection, and the round trip from a gesture to
 * Postgres and back after a reload. The offset arithmetic underneath is unit
 * tested — these tests prove the wiring, not the maths.
 */

requireStack();

test.describe('reader', () => {
  test('renders the chapter in the page, not an iframe', async ({ reader }) => {
    const { page } = reader;
    // The old reader shipped a whole document into an iframe; the native one
    // renders into the host document, which is what makes selection, theming
    // and the TTS mark ordinary React.
    await expect(page.locator('iframe')).toHaveCount(0);

    const paragraphs = page.locator('p[data-po]');
    await expect(paragraphs).toHaveCount(BOOK_CHAPTERS[0]!.paragraphs.length);
    await expect(paragraphs.first()).toHaveText(BOOK_CHAPTERS[0]!.paragraphs[0]!);

    // data-po carries each paragraph's offset into paragraphs.join('\n').
    const offsets = await paragraphs.evaluateAll((nodes) =>
      nodes.map((node) => Number(node.getAttribute('data-po'))),
    );
    let expected = 0;
    for (const [index, paragraph] of BOOK_CHAPTERS[0]!.paragraphs.entries()) {
      expect(offsets[index]).toBe(expected);
      expected += paragraph.length + 1;
    }
  });

  test('fills the reading area', async ({ reader }) => {
    const { page } = reader;
    const viewport = page.locator('.inkread-reader');
    const box = await viewport.boundingBox();
    const size = page.viewportSize()!;
    expect(box!.width).toBeGreaterThan(size.width * 0.9);
    // Between the 48px header and the 40px footer.
    expect(box!.height).toBeGreaterThan(size.height * 0.7);
  });

  test('highlights a selection and keeps it across a reload', async ({ reader }) => {
    const { page } = reader;
    const first = page.locator('p[data-po="0"]');

    // Select "keeper" in the first paragraph, by character offsets.
    await first.evaluate((node) => {
      const text = node.firstChild!;
      const range = document.createRange();
      range.setStart(text, 4);
      range.setEnd(text, 10);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });

    await page.getByRole('button', { name: 'Highlight green' }).click();
    const highlight = page.locator('[data-hl]');
    await expect(highlight).toHaveText('keeper');

    await page.reload();
    await expect(page.locator('[data-hl]')).toHaveText('keeper');
    // Rendered as a fill, not as a class name only.
    await expect(page.locator('[data-hl]')).toHaveAttribute('style', /background/);
  });

  test('remembers the reading position', async ({ reader }) => {
    const { page } = reader;
    const scroller = page.locator('.inkread-reader');
    // The chapter is longer than the window — that's what makes this real.
    expect(
      await scroller.evaluate((node) => node.scrollHeight - node.clientHeight),
    ).toBeGreaterThan(0);
    await scroller.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    // The position save is debounced (800ms) behind a scroll settle (250ms).
    await page.waitForTimeout(1600);
    const saved = await page.evaluate(async () => {
      const response = await fetch(`/api/books/${location.pathname.split('/').pop()}/position`);
      return (await response.json()) as { position: { offset: number } | null };
    });
    expect(saved.position?.offset ?? 0).toBeGreaterThan(0);

    // Reopening lands back where reading stopped, not at the top.
    await page.reload();
    await page.locator('p[data-po="0"]').waitFor();
    await expect
      .poll(async () => scroller.evaluate((node) => node.scrollTop), { timeout: 8000 })
      .toBeGreaterThan(0);
  });

  test('turns pages in paged mode and flows into the next chapter', async ({ reader }) => {
    const { page } = reader;
    await page.getByRole('button', { name: 'Layout' }).click();
    await page.getByRole('button', { name: 'Pages Flip like a book' }).click();

    const content = page.locator('.inkread-reader > div').first();
    await expect(content).toHaveCSS('column-fill', 'auto');
    // Columns, so the chapter is wider than one page.
    expect(
      await content.evaluate((node) => {
        node.style.overflow = 'hidden';
        const extent = node.scrollWidth - node.clientWidth;
        node.style.overflow = 'visible';
        return extent;
      }),
    ).toBeGreaterThan(0);

    const atStart = await content.evaluate((node) => getComputedStyle(node).transform);
    await page.getByRole('button', { name: 'Next ›' }).click();
    await page.waitForTimeout(400);
    const afterTurn = await content.evaluate((node) => getComputedStyle(node).transform);
    expect(afterTurn).not.toBe(atStart);

    // Keep turning: past the last page the reader flows into chapter two.
    for (let i = 0; i < 25; i += 1) {
      await page.getByRole('button', { name: 'Next ›' }).click();
      await page.waitForTimeout(280);
      if (await page.getByText(`2 / 2 · ${BOOK_CHAPTERS[1]!.title}`).isVisible()) break;
    }
    await expect(page.getByText(`2 / 2 · ${BOOK_CHAPTERS[1]!.title}`)).toBeVisible();
    await expect(page.locator('p[data-po="0"]')).toHaveText(BOOK_CHAPTERS[1]!.paragraphs[0]!);
  });

  test('navigates by chapter from the table of contents', async ({ reader }) => {
    const { page } = reader;
    await page.getByRole('button', { name: 'Chapters' }).click();
    await page.getByRole('button', { name: BOOK_CHAPTERS[1]!.title }).click();
    await expect(page.locator('h1')).toHaveText(BOOK_CHAPTERS[1]!.title);
    await expect(page.locator('p[data-po="0"]')).toHaveText(BOOK_CHAPTERS[1]!.paragraphs[0]!);
  });

  test('repaints the page when the theme changes', async ({ reader }) => {
    const { page } = reader;
    const viewport = page.locator('.inkread-reader');
    const paper = await viewport.evaluate((node) => getComputedStyle(node).backgroundColor);
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('button', { name: /Aa\s*Night/ }).click();
    const night = await viewport.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(night).not.toBe(paper);
    expect(night).toBe('rgb(18, 18, 18)');
  });
});
