'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  buildReaderHtml,
  formatPassageShare,
  HIGHLIGHT_COLORS,
  type Annotation,
  type Chapter,
  type HighlightColor,
  type ReaderTheme,
  type ReadingPosition,
} from '@inkread/core';
import type { BookSummary } from '@/lib/data/repository';
import { WebTtsController } from '@/lib/tts';

interface ReaderProps {
  book: BookSummary;
  chapters: Chapter[];
  initialAnnotations: Annotation[];
  initialPosition: ReadingPosition | null;
}

interface Selection {
  start: number;
  end: number;
  text: string;
}

const RATES = [0.9, 1.0, 1.15, 1.3, 1.5];

const THEME_PREVIEWS: { key: ReaderTheme; label: string; bg: string; fg: string }[] = [
  { key: 'light', label: 'Light', bg: '#ffffff', fg: '#1a1a1a' },
  { key: 'sepia', label: 'Sepia', bg: '#f5ecd9', fg: '#3a3226' },
  { key: 'dark', label: 'Dark', bg: '#121212', fg: '#d8d4cd' },
];

type ReaderBridge = {
  scrollToOffset: (offset: number) => void;
  turnPage: (delta: number) => void;
  markSentence: (start: number, end: number) => void;
  clearSentence: () => void;
};

export function Reader({ book, chapters, initialAnnotations, initialPosition }: ReaderProps) {
  const [chapterIndex, setChapterIndex] = useState(
    Math.min(initialPosition?.chapterIndex ?? 0, chapters.length - 1),
  );
  const [theme, setTheme] = useState<ReaderTheme>('sepia');
  const [fontSize, setFontSize] = useState(19);
  const [pagination, setPagination] = useState<'scroll' | 'paged'>('scroll');
  const [annotations, setAnnotations] = useState(initialAnnotations);
  const [selection, setSelection] = useState<Selection>();
  const [tocOpen, setTocOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [ttsOpen, setTtsOpen] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [rate, setRate] = useState(1.0);
  const [isElectron, setIsElectron] = useState(false);

  useEffect(() => {
    setIsElectron(navigator.userAgent.includes('Electron'));
  }, []);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const offsetRef = useRef(initialPosition?.offset ?? 0);
  const ttsRef = useRef<WebTtsController | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const chapter = chapters[chapterIndex];
  const chapterText = useMemo(() => chapter?.paragraphs.join('\n') ?? '', [chapter]);
  const chapterAnnotations = useMemo(
    () => annotations.filter((a) => a.locator.chapterIndex === chapterIndex),
    [annotations, chapterIndex],
  );
  const html = useMemo(
    () =>
      chapter ? buildReaderHtml(chapter, chapterAnnotations, { theme, fontSize, pagination }) : '',
    [chapter, chapterAnnotations, theme, fontSize, pagination],
  );

  const bridge = useCallback((): ReaderBridge | undefined => {
    return (iframeRef.current?.contentWindow as (Window & { __reader?: ReaderBridge }) | null)
      ?.__reader;
  }, []);

  const getTts = useCallback((): WebTtsController => {
    if (!ttsRef.current) ttsRef.current = new WebTtsController();
    return ttsRef.current;
  }, []);

  const savePosition = useCallback(
    (offset: number) => {
      offsetRef.current = offset;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void fetch(`/api/books/${book.id}/position`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chapterIndex, offset }),
        });
      }, 800);
    },
    [book.id, chapterIndex],
  );

  const reloadAnnotations = useCallback(async () => {
    const response = await fetch(`/api/books/${book.id}/annotations`);
    if (response.ok) {
      const body = (await response.json()) as { annotations: Annotation[] };
      setAnnotations(body.annotations);
    }
  }, [book.id]);

  // Bridge messages from the reader iframe.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; payload?: string };
      if (data?.source !== 'inkread-reader' || !data.payload) return;
      const msg = JSON.parse(data.payload) as { type: string; [key: string]: unknown };
      switch (msg.type) {
        case 'ready':
          if (offsetRef.current > 0) bridge()?.scrollToOffset(offsetRef.current);
          break;
        case 'selection':
          if (msg.clear) setSelection(undefined);
          else
            setSelection({
              start: Number(msg.start),
              end: Number(msg.end),
              text: String(msg.text ?? ''),
            });
          break;
        case 'scroll':
          savePosition(Number(msg.offset) || 0);
          break;
        case 'tapHighlight': {
          const annotation = annotations.find((a) => a.id === msg.id);
          if (annotation && confirm(`Remove this ${annotation.note ? 'note' : 'highlight'}?\n\n“${annotation.passage.slice(0, 140)}”`)) {
            void fetch(`/api/annotations/${annotation.id}`, { method: 'DELETE' }).then(
              reloadAnnotations,
            );
          }
          break;
        }
        case 'pageEdge':
          setChapterIndex((index) => {
            if (msg.dir === 'next' && index + 1 < chapters.length) {
              offsetRef.current = 0;
              return index + 1;
            }
            if (msg.dir === 'prev' && index > 0) {
              // Land on the last page of the previous chapter.
              offsetRef.current = Number.MAX_SAFE_INTEGER;
              return index - 1;
            }
            return index;
          });
          break;
        case 'tap':
          setTocOpen(false);
          setThemeOpen(false);
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [annotations, bridge, chapters.length, reloadAnnotations, savePosition]);

  // TTS wiring.
  useEffect(() => {
    const tts = getTts();
    tts.setListener((status) => {
      setTtsPlaying(status.playing);
      if (status.playing && status.sentence) {
        bridge()?.markSentence(status.sentence.start, status.sentence.end);
      }
      if (status.playing && !status.sentence && status.finished) {
        setChapterIndex((index) => {
          if (index + 1 < chapters.length) {
            setTimeout(() => {
              tts.load(chapters[index + 1]!.paragraphs.join('\n'), 0);
              tts.play();
            }, 300);
            return index + 1;
          }
          tts.stop();
          return index;
        });
      }
    });
    return () => {
      tts.setListener(undefined);
      tts.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addHighlight = useCallback(
    async (color: HighlightColor, note?: string) => {
      if (!selection || !chapter) return;
      await fetch(`/api/books/${book.id}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapterIndex,
          start: selection.start,
          end: selection.end,
          passage: selection.text,
          note,
          color,
          chapterTitle: chapter.title,
        }),
      });
      setSelection(undefined);
      await reloadAnnotations();
    },
    [book.id, chapter, chapterIndex, reloadAnnotations, selection],
  );

  const sharePassage = useCallback(async () => {
    if (!selection) return;
    const text = formatPassageShare(book, selection.text);
    if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(text);
      alert('Passage copied to clipboard.');
    }
  }, [book, selection]);

  const goToChapter = useCallback((index: number) => {
    offsetRef.current = 0;
    setSelection(undefined);
    setTocOpen(false);
    setChapterIndex(index);
  }, []);

  const toggleTts = useCallback(() => {
    const tts = getTts();
    if (ttsOpen) {
      tts.stop();
      setTtsOpen(false);
      bridge()?.clearSentence();
    } else {
      tts.load(chapterText, offsetRef.current);
      setTtsOpen(true);
      tts.play();
    }
  }, [bridge, chapterText, getTts, ttsOpen]);

  const cycleRate = useCallback(() => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]!;
    setRate(next);
    getTts().setRate(next);
  }, [getTts, rate]);

  if (!chapter) return null;

  return (
    <div className="flex h-screen flex-col">
      <header
        className={`flex items-center justify-between border-b border-[#e6dfd4] bg-[#faf7f2] px-4 py-2 text-sm ${
          isElectron ? 'electron-drag pl-20 pt-3' : ''
        }`}
      >
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/" className="electron-no-drag shrink-0 font-medium text-[#8b5e3c]">
            ← Library
          </Link>
          <span className="truncate font-semibold">{book.title}</span>
        </div>
        <div className="electron-no-drag flex shrink-0 items-center gap-4">
          <button onClick={() => { setThemeOpen(false); setTocOpen((v) => !v); }} className="text-[#8b5e3c]">
            Chapters
          </button>
          <button onClick={() => { setTocOpen(false); setThemeOpen((v) => !v); }} className="text-[#8b5e3c]">
            Theme
          </button>
          <button
            onClick={() => setPagination((p) => (p === 'scroll' ? 'paged' : 'scroll'))}
            className="text-[#8b5e3c]"
            title={pagination === 'scroll' ? 'Switch to page flipping' : 'Switch to scrolling'}
          >
            {pagination === 'scroll' ? 'Pages' : 'Scroll'}
          </button>
          <button onClick={() => setFontSize((s) => Math.max(14, s - 1))} className="text-[#8b5e3c]">
            A-
          </button>
          <button onClick={() => setFontSize((s) => Math.min(26, s + 1))} className="text-[#8b5e3c]">
            A+
          </button>
          <button onClick={toggleTts} className={ttsOpen ? 'text-[#b3402a]' : 'text-[#8b5e3c]'}>
            {ttsOpen ? 'Stop' : 'Listen'}
          </button>
          <Link href={`/notes/${book.id}`} className="text-[#8b5e3c]">
            Notes
          </Link>
        </div>
      </header>

      <div className="relative flex-1">
        <iframe
          ref={iframeRef}
          srcDoc={html}
          sandbox="allow-scripts allow-same-origin"
          className="h-full w-full border-0"
          title={chapter.title}
        />

        {tocOpen || themeOpen ? (
          <button
            aria-label="Close menu"
            className="absolute inset-0 z-10 cursor-default"
            onClick={() => {
              setTocOpen(false);
              setThemeOpen(false);
            }}
          />
        ) : null}

        {tocOpen ? (
          <nav className="absolute right-4 top-2 z-20 max-h-[70%] w-72 overflow-auto rounded-xl border border-[#e6dfd4] bg-white p-2 shadow-lg">
            {chapters.map((c, i) => (
              <button
                key={i}
                onClick={() => goToChapter(i)}
                className={`block w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-[#faf7f2] ${
                  i === chapterIndex ? 'font-bold text-[#8b5e3c]' : ''
                }`}
              >
                {c.title}
              </button>
            ))}
          </nav>
        ) : null}

        {themeOpen ? (
          <div className="absolute right-4 top-2 z-20 w-56 rounded-xl border border-[#e6dfd4] bg-white p-2 shadow-lg">
            {THEME_PREVIEWS.map((preview) => (
              <button
                key={preview.key}
                onClick={() => {
                  setTheme(preview.key);
                  setThemeOpen(false);
                }}
                className={`mb-1 flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition hover:border-[#8b5e3c] ${
                  theme === preview.key ? 'border-[#8b5e3c]' : 'border-transparent'
                }`}
              >
                <span
                  className="flex h-9 w-14 shrink-0 items-center justify-center rounded-md border border-black/10 font-serif text-xs"
                  style={{ background: preview.bg, color: preview.fg }}
                >
                  Aa
                </span>
                <span className={theme === preview.key ? 'font-bold text-[#8b5e3c]' : ''}>
                  {preview.label}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {selection ? (
          <div className="absolute bottom-16 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full bg-white px-5 py-2.5 shadow-xl ring-1 ring-[#e6dfd4]">
            {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((color) => (
              <button
                key={color}
                aria-label={`Highlight ${color}`}
                onClick={() => void addHighlight(color)}
                className="h-5 w-5 rounded-full"
                style={{ background: `rgb(${HIGHLIGHT_COLORS[color]})` }}
              />
            ))}
            <button
              onClick={() => {
                const note = prompt('Add note', '');
                if (note !== null) void addHighlight('yellow', note.trim() || undefined);
              }}
              className="text-sm font-semibold text-[#8b5e3c]"
            >
              Note
            </button>
            <button onClick={() => void sharePassage()} className="text-sm font-semibold text-[#8b5e3c]">
              Share
            </button>
          </div>
        ) : null}

        {ttsOpen ? (
          <div className="absolute bottom-16 right-6 z-10 flex items-center gap-4 rounded-full bg-white px-5 py-2.5 shadow-xl ring-1 ring-[#e6dfd4]">
            <button onClick={() => getTts().previous()}>⏮</button>
            <button onClick={() => (ttsPlaying ? getTts().stop() : getTts().play())} className="text-xl text-[#8b5e3c]">
              {ttsPlaying ? '⏸' : '▶'}
            </button>
            <button onClick={() => getTts().next()}>⏭</button>
            <button onClick={cycleRate} className="text-sm font-bold text-[#6b6459]">
              {rate.toFixed(2).replace(/0$/, '')}×
            </button>
          </div>
        ) : null}
      </div>

      <footer className="flex items-center justify-between border-t border-[#e6dfd4] bg-[#faf7f2] px-4 py-2 text-sm">
        <button
          disabled={chapterIndex === 0}
          onClick={() => goToChapter(chapterIndex - 1)}
          className="text-[#8b5e3c] disabled:opacity-30"
        >
          ‹ Prev
        </button>
        <span className="truncate text-xs text-[#6b6459]">
          {chapterIndex + 1} / {chapters.length} · {chapter.title}
        </span>
        <button
          disabled={chapterIndex >= chapters.length - 1}
          onClick={() => goToChapter(chapterIndex + 1)}
          className="text-[#8b5e3c] disabled:opacity-30"
        >
          Next ›
        </button>
      </footer>
    </div>
  );
}
