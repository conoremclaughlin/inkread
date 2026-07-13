'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  buildReaderHtml,
  formatPassageShare,
  HIGHLIGHT_COLORS,
  READER_THEMES,
  type Annotation,
  type Chapter,
  type HighlightColor,
  type ReaderTheme,
  type ReadingPosition,
} from '@inkread/core';
import type { BookSummary, ReaderPreferences } from '@/lib/data/repository';
import { WebTtsController } from '@/lib/tts';
import { KokoroTtsController } from '@/lib/tts/kokoro';
import { useIsElectron } from '@/lib/useIsElectron';

type TtsPlayer = WebTtsController | KokoroTtsController;
type TtsEngine = 'kokoro' | 'system';

interface ReaderProps {
  book: BookSummary;
  chapters: Chapter[];
  initialAnnotations: Annotation[];
  initialPosition: ReadingPosition | null;
  initialPreferences?: ReaderPreferences;
  /** Reading from the device cache; server writes are skipped. */
  offline?: boolean;
  /** Re-reading from the start — don't move the saved bookmark. */
  browseOnly?: boolean;
}

interface Selection {
  start: number;
  end: number;
  text: string;
}

const RATES = [0.9, 1.0, 1.15, 1.3, 1.5];
const DEFAULT_FONT_SIZE = 19;

const THEME_LABELS: Partial<Record<ReaderTheme, string>> = {
  paper: 'Paper',
  sepia: 'Sepia',
  calm: 'Calm',
  quiet: 'Quiet',
  night: 'Night',
  midnight: 'Midnight',
};

const THEME_PREVIEWS = (Object.keys(THEME_LABELS) as ReaderTheme[]).map((key) => ({
  key,
  label: THEME_LABELS[key]!,
  bg: READER_THEMES[key].bg,
  fg: READER_THEMES[key].fg,
}));

const PlayerIcon = ({ d, filled }: { d: string; filled?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={filled ? 0 : 2}
    strokeLinejoin="round"
    strokeLinecap="round"
  >
    <path d={d} />
  </svg>
);

type ReaderBridge = {
  scrollToOffset: (offset: number) => void;
  turnPage: (delta: number) => void;
  markSentence: (start: number, end: number) => void;
  clearSentence: () => void;
};

export function Reader({
  book,
  chapters,
  initialAnnotations,
  initialPosition,
  initialPreferences,
  offline,
  browseOnly,
}: ReaderProps) {
  const [chapterIndex, setChapterIndex] = useState(
    Math.min(initialPosition?.chapterIndex ?? 0, chapters.length - 1),
  );
  const [theme, setTheme] = useState<ReaderTheme>(
    (initialPreferences?.theme as ReaderTheme) ?? 'paper',
  );
  const [fontSize, setFontSize] = useState(initialPreferences?.fontSize ?? DEFAULT_FONT_SIZE);
  const [pagination, setPagination] = useState<'scroll' | 'paged'>(
    initialPreferences?.pagination ?? 'scroll',
  );

  const [annotations, setAnnotations] = useState(initialAnnotations);
  const [selection, setSelection] = useState<Selection>();
  const [tocOpen, setTocOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string>();
  const [ttsOpen, setTtsOpen] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [rate, setRate] = useState(initialPreferences?.ttsRate ?? 1.0);
  const isElectron = useIsElectron();

  // Persist reading settings (debounced) so they follow the user.
  const prefsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prefsLoaded = useRef(false);
  useEffect(() => {
    if (!prefsLoaded.current) {
      prefsLoaded.current = true;
      return;
    }
    if (offline) return;
    if (prefsTimer.current) clearTimeout(prefsTimer.current);
    prefsTimer.current = setTimeout(() => {
      void fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, fontSize, pagination, ttsRate: rate }),
      });
    }, 600);
  }, [theme, fontSize, pagination, rate]);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const offsetRef = useRef(initialPosition?.offset ?? 0);
  const ttsRef = useRef<TtsPlayer | null>(null);
  const [ttsEngine, setTtsEngine] = useState<TtsEngine>();
  const [ttsProgress, setTtsProgress] = useState<number>();
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

  const ttsContinueRef = useRef(false);

  const attachTtsListener = useCallback(
    (tts: TtsPlayer) => {
      tts.setListener((status) => {
        setTtsPlaying(status.playing);
        if (status.playing && status.sentence) {
          bridge()?.markSentence(status.sentence.start, status.sentence.end);
        }
        // Ran off the end of the chapter → flow into the next one; the
        // chapter-change effect below reloads the queue and resumes.
        if (!status.sentence && status.finished && status.totalSentences > 0) {
          setChapterIndex((index) => {
            if (index + 1 >= chapters.length) return index;
            ttsContinueRef.current = true;
            offsetRef.current = 0;
            return index + 1;
          });
        }
      });
    },
    [bridge, chapters.length],
  );

  // Keep the TTS queue on the chapter being read: manual navigation, page
  // flips at chapter edges, and auto-advance all funnel through here.
  useEffect(() => {
    const tts = ttsRef.current;
    if (!tts || !ttsOpen) return;
    const resume = ttsContinueRef.current || tts.status.playing;
    ttsContinueRef.current = false;
    const offset =
      offsetRef.current >= Number.MAX_SAFE_INTEGER
        ? Math.max(0, chapterText.length - 1)
        : offsetRef.current;
    tts.load(chapterText, offset);
    if (resume) tts.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIndex]);

  /**
   * First Listen: load Kokoro (neural, local, cached after first download);
   * fall back to the system voice if the model can't load here.
   */
  const getTts = useCallback(async (): Promise<TtsPlayer> => {
    if (ttsRef.current) return ttsRef.current;
    let player: TtsPlayer;
    try {
      const kokoro = new KokoroTtsController();
      setTtsProgress(0);
      await kokoro.init((progress) => setTtsProgress(progress));
      player = kokoro;
      setTtsEngine('kokoro');
    } catch (error) {
      console.warn('Kokoro TTS unavailable, using system voice:', error);
      player = new WebTtsController();
      setTtsEngine('system');
    }
    setTtsProgress(undefined);
    ttsRef.current = player;
    attachTtsListener(player);
    return player;
  }, [attachTtsListener]);

  const savePosition = useCallback(
    (offset: number) => {
      offsetRef.current = offset;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (browseOnly) return;
      saveTimer.current = setTimeout(() => {
        void fetch(`/api/books/${book.id}/position`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chapterIndex, offset }),
        }).catch(() => undefined);
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

  // Tear down whichever TTS engine is live when leaving the reader.
  useEffect(() => {
    return () => {
      const tts = ttsRef.current;
      if (!tts) return;
      tts.setListener(undefined);
      if ('destroy' in tts) tts.destroy();
      else tts.stop();
    };
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

  const [copied, setCopied] = useState(false);
  const sharePassage = useCallback(async () => {
    if (!selection) return;
    await navigator.clipboard.writeText(formatPassageShare(book, selection.text));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [book, selection]);

  const goToChapter = useCallback((index: number) => {
    offsetRef.current = 0;
    setSelection(undefined);
    setTocOpen(false);
    setChapterIndex(index);
  }, []);

  const toggleTts = useCallback(async () => {
    if (ttsOpen) {
      ttsRef.current?.stop();
      setTtsOpen(false);
      bridge()?.clearSentence();
      return;
    }
    setTtsOpen(true);
    const tts = await getTts();
    tts.load(chapterText, offsetRef.current);
    tts.play();
  }, [bridge, chapterText, getTts, ttsOpen]);

  const cycleRate = useCallback(() => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]!;
    setRate(next);
    ttsRef.current?.setRate(next);
  }, [rate]);

  if (!chapter) return null;

  const chrome = THEME_PREVIEWS.find((preview) => preview.key === theme)!;
  // Chrome controls sit quietly on the page color until hovered — the whole
  // window reads as one book page.
  const chromeButton =
    'electron-no-drag flex h-full items-center px-2.5 opacity-55 transition hover:opacity-100';
  const closeMenus = () => {
    setTocOpen(false);
    setThemeOpen(false);
    setLayoutOpen(false);
    setTypeOpen(false);
  };
  const anyMenuOpen = tocOpen || themeOpen || layoutOpen || typeOpen;

  return (
    <div
      className="flex h-screen flex-col transition-colors"
      style={{ background: chrome.bg, color: chrome.fg }}
    >
      <header
        className={`flex h-12 shrink-0 items-stretch justify-between text-sm ${
          isElectron ? 'electron-drag pl-20' : 'pl-2'
        }`}
      >
        <div className="flex min-w-0 items-stretch">
          <Link href="/" className={`${chromeButton} shrink-0 font-medium`}>
            ← Library
          </Link>
          <span className="flex items-center truncate px-1.5 font-semibold opacity-80">
            {book.title}
          </span>
        </div>
        <div className="flex shrink-0 items-stretch pr-2">
          <button onClick={() => { closeMenus(); setTocOpen(!tocOpen); }} className={chromeButton}>
            Chapters
          </button>
          <button onClick={() => { closeMenus(); setThemeOpen(!themeOpen); }} className={chromeButton}>
            Theme
          </button>
          <button
            onClick={() => { closeMenus(); setLayoutOpen(!layoutOpen); }}
            className={chromeButton}
          >
            Layout
          </button>
          <button
            onClick={() => { closeMenus(); setTypeOpen(!typeOpen); }}
            className={`${chromeButton} ${fontSize !== DEFAULT_FONT_SIZE ? 'font-semibold !opacity-90' : ''}`}
            title="Typography"
          >
            Aa{fontSize !== DEFAULT_FONT_SIZE ? '·' : ''}
          </button>
          <button
            onClick={() => void toggleTts()}
            className={`${chromeButton} ${ttsOpen ? 'font-semibold !opacity-100' : ''}`}
          >
            {ttsOpen ? 'Stop' : 'Listen'}
          </button>
          <Link href={`/notes/${book.id}`} className={chromeButton}>
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

        {anyMenuOpen ? (
          <button
            aria-label="Close menu"
            className="absolute inset-0 z-10 cursor-default"
            onClick={closeMenus}
          />
        ) : null}

        {tocOpen ? (
          <nav className="absolute right-4 top-2 z-20 max-h-[70%] w-72 overflow-auto rounded-xl border border-[#e6dfd4] bg-white p-2 text-[#26221c] shadow-lg">
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
          <div className="absolute right-4 top-2 z-20 w-56 rounded-xl border border-[#e6dfd4] bg-white p-2 text-[#26221c] shadow-lg">
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

        {layoutOpen ? (
          <div className="absolute right-4 top-2 z-20 w-64 rounded-xl border border-[#e6dfd4] bg-white p-2 text-[#26221c] shadow-lg">
            {(
              [
                {
                  key: 'scroll' as const,
                  label: 'Scroll',
                  hint: 'One continuous flow',
                  icon: (
                    <svg viewBox="0 0 36 44" className="h-10 w-8">
                      <rect x="2" y="2" width="32" height="40" rx="3" fill="none" stroke="currentColor" />
                      {[9, 15, 21, 27, 33].map((y) => (
                        <line key={y} x1="7" y1={y} x2="29" y2={y} stroke="currentColor" strokeWidth="2" opacity="0.6" />
                      ))}
                      <path d="M18 36 l-3 -3 h6 z" fill="currentColor" opacity="0.6" />
                    </svg>
                  ),
                },
                {
                  key: 'paged' as const,
                  label: 'Pages',
                  hint: 'Flip like a book',
                  icon: (
                    <svg viewBox="0 0 36 44" className="h-10 w-8">
                      <rect x="2" y="2" width="32" height="40" rx="3" fill="none" stroke="currentColor" />
                      <line x1="18" y1="4" x2="18" y2="40" stroke="currentColor" opacity="0.4" />
                      {[10, 16, 22, 28].map((y) => (
                        <g key={y} opacity="0.6">
                          <line x1="6" y1={y} x2="15" y2={y} stroke="currentColor" strokeWidth="2" />
                          <line x1="21" y1={y} x2="30" y2={y} stroke="currentColor" strokeWidth="2" />
                        </g>
                      ))}
                    </svg>
                  ),
                },
              ]
            ).map((option) => (
              <button
                key={option.key}
                onClick={() => {
                  setPagination(option.key);
                  setLayoutOpen(false);
                }}
                className={`mb-1 flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition hover:border-[#8b5e3c] ${
                  pagination === option.key ? 'border-[#8b5e3c]' : 'border-transparent'
                }`}
              >
                <span className="shrink-0 text-[#6b6459]">{option.icon}</span>
                <span>
                  <span className={`block ${pagination === option.key ? 'font-bold text-[#8b5e3c]' : 'font-medium'}`}>
                    {option.label}
                  </span>
                  <span className="block text-xs text-[#6b6459]">{option.hint}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {typeOpen ? (
          <div className="absolute right-4 top-2 z-20 w-64 rounded-xl border border-[#e6dfd4] bg-white p-4 text-[#26221c] shadow-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-[#6b6459]">
                Text size
              </span>
              {fontSize !== DEFAULT_FONT_SIZE ? (
                <button
                  onClick={() => setFontSize(DEFAULT_FONT_SIZE)}
                  className="text-xs font-medium text-[#8b5e3c]"
                >
                  Reset
                </button>
              ) : null}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={() => setFontSize((s) => Math.max(14, s - 1))}
                className="flex h-10 w-16 items-center justify-center rounded-lg border border-[#e6dfd4] text-sm transition hover:border-[#8b5e3c]"
              >
                A−
              </button>
              <span className="font-serif" style={{ fontSize: Math.min(fontSize, 24) }}>
                {fontSize}px
              </span>
              <button
                onClick={() => setFontSize((s) => Math.min(26, s + 1))}
                className="flex h-10 w-16 items-center justify-center rounded-lg border border-[#e6dfd4] text-lg transition hover:border-[#8b5e3c]"
              >
                A+
              </button>
            </div>
          </div>
        ) : null}

        {selection ? (
          <div className="absolute bottom-16 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full bg-white px-5 py-2.5 text-[#26221c] shadow-xl ring-1 ring-[#e6dfd4]">
            {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((color) => (
              <button
                key={color}
                aria-label={`Highlight ${color}`}
                onClick={() => void addHighlight(color)}
                className="h-5 w-5 rounded-full ring-[#26221c]/25 ring-offset-1 transition hover:scale-110 hover:ring-2"
                style={{ background: `rgb(${HIGHLIGHT_COLORS[color]})` }}
              />
            ))}
            <button
              onClick={() => setNoteDraft('')}
              className="rounded-lg px-2 py-1 text-sm font-semibold text-[#8b5e3c] transition hover:bg-[#f0e6da]"
            >
              Note
            </button>
            <button
              onClick={() => void sharePassage()}
              className="rounded-lg px-2 py-1 text-sm font-semibold text-[#8b5e3c] transition hover:bg-[#f0e6da]"
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
        ) : null}

        {noteDraft !== undefined && selection ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 p-6">
            <div className="w-full max-w-md rounded-2xl bg-white p-5 text-[#26221c] shadow-2xl">
              <p className="max-h-20 overflow-hidden text-sm italic text-[#6b6459]">
                “{selection.text.slice(0, 200)}”
              </p>
              <textarea
                autoFocus
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Your note…"
                rows={4}
                className="mt-3 w-full resize-none rounded-lg border border-[#e6dfd4] p-3 text-sm outline-none focus:border-[#8b5e3c]"
              />
              <div className="mt-3 flex justify-end gap-3 text-sm">
                <button onClick={() => setNoteDraft(undefined)} className="px-3 py-2 text-[#6b6459]">
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const note = noteDraft.trim();
                    setNoteDraft(undefined);
                    void addHighlight('yellow', note || undefined);
                  }}
                  className="rounded-full bg-[#8b5e3c] px-4 py-2 font-semibold text-white"
                >
                  Save note
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {ttsOpen ? (
          <div className="absolute bottom-16 right-6 z-10 flex items-center gap-4 rounded-full bg-white px-5 py-2.5 shadow-xl ring-1 ring-[#e6dfd4]">
            {ttsProgress !== undefined ? (
              <span className="text-sm text-[#6b6459]">
                Preparing voice… {ttsProgress}%
              </span>
            ) : (
              <>
                <button
                  aria-label="Previous sentence"
                  onClick={() => ttsRef.current?.previous()}
                  className="p-1 text-[#6b6459] transition hover:text-[#26221c]"
                >
                  <PlayerIcon d="M19 5 L9 12 L19 19 Z M7 5 v14" />
                </button>
                <button
                  aria-label={ttsPlaying ? 'Pause' : 'Play'}
                  onClick={() =>
                    ttsPlaying ? ttsRef.current?.stop() : ttsRef.current?.play()
                  }
                  className="p-1 text-[#8b5e3c] transition hover:opacity-75"
                >
                  {ttsPlaying ? (
                    <PlayerIcon filled d="M7 5 h3.5 v14 H7 Z M13.5 5 H17 v14 h-3.5 Z" />
                  ) : (
                    <PlayerIcon filled d="M8 5 L19 12 L8 19 Z" />
                  )}
                </button>
                <button
                  aria-label="Next sentence"
                  onClick={() => ttsRef.current?.next()}
                  className="p-1 text-[#6b6459] transition hover:text-[#26221c]"
                >
                  <PlayerIcon d="M5 5 L15 12 L5 19 Z M17 5 v14" />
                </button>
                <button onClick={cycleRate} className="p-1 text-sm font-bold text-[#6b6459]">
                  {rate.toFixed(2).replace(/0$/, '')}×
                </button>
                {ttsEngine === 'system' ? (
                  <span className="text-xs text-[#6b6459]" title="Neural voice unavailable; using the system voice">
                    system voice
                  </span>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      <footer className="flex h-10 shrink-0 items-stretch justify-between px-2 text-sm">
        <button
          disabled={pagination === 'scroll' && chapterIndex === 0}
          onClick={() =>
            pagination === 'paged' ? bridge()?.turnPage(-1) : goToChapter(chapterIndex - 1)
          }
          className="flex items-center px-3 opacity-55 transition hover:opacity-100 disabled:opacity-20"
        >
          ‹ Prev
        </button>
        <span className="flex items-center truncate text-xs opacity-50">
          {chapterIndex + 1} / {chapters.length} · {chapter.title}
        </span>
        <button
          disabled={pagination === 'scroll' && chapterIndex >= chapters.length - 1}
          onClick={() =>
            pagination === 'paged' ? bridge()?.turnPage(1) : goToChapter(chapterIndex + 1)
          }
          className="flex items-center px-3 opacity-55 transition hover:opacity-100 disabled:opacity-20"
        >
          Next ›
        </button>
      </footer>
    </div>
  );
}
