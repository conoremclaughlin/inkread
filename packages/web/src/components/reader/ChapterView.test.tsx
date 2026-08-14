// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '@inkread/core';
import { ChapterView, type ReaderHandle } from './ChapterView';

/**
 * These assert the contract the reader chrome depends on: the rendered DOM
 * carries the offset model (data-po per paragraph, highlights split at
 * annotation boundaries), and the imperative handle behaves like the old
 * `window.__reader` bridge did. Geometry (page turns, scroll follow) is jsdom's
 * blind spot — that math lives in pager.ts, tested separately, and the real
 * layout is verified in the browser.
 */

// jsdom ships no layout, so it has no scrollIntoView; following the spoken
// sentence is a browser-verified behavior, not a jsdom one.
Element.prototype.scrollIntoView = vi.fn();

const PARAGRAPHS = ['First paragraph here.', 'Second paragraph, longer.', 'Third one.'];

function annotation(overrides: Partial<Annotation> & { start: number; end: number }): Annotation {
  const { start, end, ...rest } = overrides;
  return {
    id: 'a1',
    bookId: 'b1',
    kind: 'highlight',
    locator: { chapterIndex: 0, start, end },
    passage: 'x',
    color: 'green',
    createdAt: '2026-08-13T00:00:00Z',
    ...rest,
  };
}

function renderView(props: Partial<React.ComponentProps<typeof ChapterView>> = {}) {
  const ref = createRef<ReaderHandle>();
  const view = render(
    <ChapterView
      ref={ref}
      title="Chapter One"
      paragraphs={PARAGRAPHS}
      annotations={[]}
      theme="paper"
      fontSize={19}
      pagination="scroll"
      {...props}
    />,
  );
  return { ref, ...view };
}

afterEach(cleanup);

describe('ChapterView rendering', () => {
  it('renders the chapter as real DOM with data-po offsets', () => {
    const { container } = renderView();
    expect(container.querySelector('h1')?.textContent).toBe('Chapter One');
    const paragraphs = Array.from(container.querySelectorAll('p[data-po]'));
    expect(paragraphs.map((p) => p.getAttribute('data-po'))).toEqual(['0', '22', '48']);
    // Offsets match paragraphs.join('\n') — the model every locator uses.
    expect(PARAGRAPHS.join('\n').slice(22, 47)).toBe(PARAGRAPHS[1]);
  });

  it('splits a paragraph at highlight boundaries and tags the annotation', () => {
    const { container } = renderView({ annotations: [annotation({ start: 6, end: 15 })] });
    const highlight = container.querySelector('[data-hl="a1"]');
    expect(highlight?.textContent).toBe('paragraph');
    expect(container.querySelector('p[data-po="0"]')?.textContent).toBe(PARAGRAPHS[0]);
  });

  it('underlines a highlight that carries a note', () => {
    const { container } = renderView({
      annotations: [annotation({ start: 6, end: 15, note: 'why this matters' })],
    });
    expect(container.querySelector('[data-hl="a1"]')?.className).toContain('hl-note');
  });

  it('desaturates highlight fills on dark themes so the text stays legible', () => {
    const light = renderView({ annotations: [annotation({ start: 0, end: 5 })] });
    const lightFill = light.container.querySelector<HTMLElement>('[data-hl]')!.style.background;
    cleanup();
    const dark = renderView({
      theme: 'night',
      annotations: [annotation({ start: 0, end: 5 })],
    });
    const darkFill = dark.container.querySelector<HTMLElement>('[data-hl]')!.style.background;
    expect(darkFill).not.toBe(lightFill);
  });
});

describe('ChapterView TTS marks', () => {
  it('tints only the marked sentence and clears it again', () => {
    const { ref, container } = renderView();
    act(() => ref.current!.markSentence(0, 5));
    expect(container.querySelector('.tts-mark')?.textContent).toBe('First');
    // The rest of the paragraph is untouched.
    expect(container.querySelector('p[data-po="0"]')?.textContent).toBe(PARAGRAPHS[0]);
    act(() => ref.current!.clearSentence());
    expect(container.querySelector('.tts-mark')).toBeNull();
  });

  it('layers the mark inside a highlight rather than replacing it', () => {
    const { ref, container } = renderView({ annotations: [annotation({ start: 0, end: 21 })] });
    act(() => ref.current!.markSentence(0, 5));
    const marked = container.querySelector('.tts-mark');
    expect(marked?.textContent).toBe('First');
    expect(marked?.closest('[data-hl="a1"]')).not.toBeNull();
  });

  it('drops the mark when the chapter changes', () => {
    const { ref, container, rerender } = renderView();
    act(() => ref.current!.markSentence(0, 5));
    expect(container.querySelector('.tts-mark')).not.toBeNull();
    rerender(
      <ChapterView
        ref={ref}
        title="Chapter Two"
        paragraphs={['Another chapter entirely.']}
        annotations={[]}
        theme="paper"
        fontSize={19}
        pagination="scroll"
      />,
    );
    expect(container.querySelector('.tts-mark')).toBeNull();
  });
});

describe('ChapterView host events', () => {
  it('announces readiness so the host can restore the reading position', () => {
    const onReady = vi.fn();
    renderView({ onReady });
    expect(onReady).toHaveBeenCalled();
  });

  it('reports a tapped highlight by id', () => {
    const onTapHighlight = vi.fn();
    const { container } = renderView({
      annotations: [annotation({ start: 6, end: 15 })],
      onTapHighlight,
    });
    act(() => {
      container.querySelector<HTMLElement>('[data-hl="a1"]')!.click();
    });
    expect(onTapHighlight).toHaveBeenCalledWith('a1');
  });

  it('reports a plain tap on the page (dismissing the chrome)', () => {
    const onTap = vi.fn();
    const { container } = renderView({ onTap });
    act(() => {
      container.querySelector<HTMLElement>('p[data-po="0"]')!.click();
    });
    expect(onTap).toHaveBeenCalled();
  });

  it('turns a selection into chapter offsets', () => {
    const onSelection = vi.fn();
    const { container } = renderView({ onSelection });
    const paragraph = container.querySelector('p[data-po="22"]')!;
    const range = document.createRange();
    range.setStart(paragraph.firstChild!, 0);
    range.setEnd(paragraph.firstChild!, 6);
    const selection = window.getSelection()!;
    act(() => {
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(onSelection).toHaveBeenCalledWith({ start: 22, end: 28, text: 'Second' });
  });

  it('clears the selection when it collapses', () => {
    const onSelection = vi.fn();
    renderView({ onSelection });
    act(() => {
      window.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(onSelection).toHaveBeenCalledWith(undefined);
  });

  it('ignores selections made outside the chapter (page chrome)', () => {
    const onSelection = vi.fn();
    renderView({ onSelection });
    const stray = document.createElement('p');
    stray.textContent = 'a note draft';
    document.body.appendChild(stray);
    const range = document.createRange();
    range.setStart(stray.firstChild!, 0);
    range.setEnd(stray.firstChild!, 6);
    act(() => {
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(onSelection).not.toHaveBeenCalled();
    stray.remove();
  });

  it('suppresses selection reporting while extending', () => {
    const onSelection = vi.fn();
    const { ref, container } = renderView({ onSelection });
    act(() => ref.current!.beginExtend(0, 5));
    const paragraph = container.querySelector('p[data-po="0"]')!;
    const range = document.createRange();
    range.setStart(paragraph.firstChild!, 0);
    range.setEnd(paragraph.firstChild!, 5);
    act(() => {
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(onSelection).not.toHaveBeenCalledWith({ start: 0, end: 5, text: 'First' });
  });

  it('does not turn pages in scroll mode', () => {
    const onPageEdge = vi.fn();
    const { ref } = renderView({ onPageEdge });
    act(() => ref.current!.turnPage(1));
    expect(onPageEdge).not.toHaveBeenCalled();
  });
});
