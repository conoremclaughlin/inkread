'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import {
  formatPassageShare,
  remainingUnlockCost,
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
import { KokoroTtsController, KOKORO_DEFAULT_VOICE } from '@/lib/tts/kokoro';
import { KOKORO_VOICES } from '@/lib/tts/voices';
import { useIsElectron } from '@/lib/useIsElectron';
import { CommentsDrawer } from '@/components/CommentsDrawer';
import { ReaderPaywall } from '@/components/ReaderPaywall';
import { ChapterView, type ReaderHandle } from '@/components/reader/ChapterView';
import {
  createLibrarySource,
  createPublicSource,
  type LoadedChapter,
  type PublicSourceInit,
} from '@/components/reader/source';

type TtsPlayer = WebTtsController | KokoroTtsController;
type TtsEngine = 'kokoro' | 'system';

interface ReaderProps {
  book: BookSummary;
  /** The owner's book, already in memory. Omit for the public reader. */
  chapters?: Chapter[];
  /**
   * Public-series mode: chapters load lazily through the entitlement gate and
   * writes are capability-gated. One reader, two data sources.
   */
  publicSeries?: Omit<PublicSourceInit, 'onAuthRequired'>;
  initialAnnotations: Annotation[];
  initialPosition: ReadingPosition | null;
  initialPreferences?: ReaderPreferences;
  /** Reading from the device cache; server writes are skipped. */
  offline?: boolean;
  /** Signed-in user id — enables deleting your own comments. */
  currentUserId?: string;
  /** Where the back link goes (defaults to the personal library). */
  backHref?: string;
  backLabel?: string;
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

/** Head … tail of a selection so a multi-page range is verifiable at a glance. */
function rangePreview(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length <= 90 ? s : `${s.slice(0, 42)} … ${s.slice(-42)}`;
}

export function Reader({
  book,
  chapters,
  publicSeries,
  initialAnnotations,
  initialPosition,
  initialPreferences,
  offline,
  currentUserId,
  backHref = '/library',
  backLabel = 'Library',
}: ReaderProps) {
  // The reader reads through a ChapterSource seam: the owner path wraps the
  // in-memory book (peek resolves synchronously, so behavior is identical to
  // before the seam existed), while a published series comes through a lazy,
  // entitlement-gated source. Same view, different data.
  const source = useMemo(
    () => (publicSeries ? createPublicSource(publicSeries) : createLibrarySource(chapters ?? [])),
    [chapters, publicSeries],
  );
  const [chapterIndex, setChapterIndex] = useState(
    Math.min(initialPosition?.chapterIndex ?? 0, source.count - 1),
  );
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<'fixed' | 'auto'>(
    (initialPreferences?.themeMode as 'fixed' | 'auto') ?? 'fixed',
  );
  const [fixedTheme, setFixedTheme] = useState<ReaderTheme>(
    (initialPreferences?.theme as ReaderTheme) ?? 'paper',
  );
  const [lightChoice, setLightChoice] = useState<ReaderTheme>(
    (initialPreferences?.lightTheme as ReaderTheme) ?? 'paper',
  );
  const [darkChoice, setDarkChoice] = useState<ReaderTheme>(
    (initialPreferences?.darkTheme as ReaderTheme) ?? 'night',
  );
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const theme: ReaderTheme =
    themeMode === 'auto' ? (systemDark ? darkChoice : lightChoice) : fixedTheme;
  const isDarkTheme = (t: ReaderTheme) => t === 'night' || t === 'midnight' || t === 'dark';
  const chooseTheme = (key: ReaderTheme) => {
    if (isDarkTheme(key)) setDarkChoice(key);
    else setLightChoice(key);
    if (themeMode === 'fixed') setFixedTheme(key);
  };
  const toggleAutoTheme = () => {
    if (themeMode === 'auto') {
      setFixedTheme(theme);
      setThemeMode('fixed');
    } else {
      if (isDarkTheme(fixedTheme)) setDarkChoice(fixedTheme);
      else setLightChoice(fixedTheme);
      setThemeMode('auto');
    }
  };
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
  const [noteEditor, setNoteEditor] = useState<
    {
      passage: string;
      draft: string;
      annotationId?: string;
      /** Set when saving a note that also creates a highlight for this range
       *  (e.g. from extend mode, where there's no live selection). */
      range?: { start: number; end: number; text: string };
    }
    | undefined
  >();
  const [acting, setActing] = useState<Annotation | undefined>();
  const [extend, setExtend] = useState<
    { anchor: number; anchorText: string; range?: { start: number; end: number; text: string } } | undefined
  >();
  const [ttsOpen, setTtsOpen] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [rate, setRate] = useState(initialPreferences?.ttsRate ?? 1.0);
  const [voice, setVoice] = useState(initialPreferences?.ttsVoice ?? KOKORO_DEFAULT_VOICE);
  const voiceRef = useRef(voice);
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
        body: JSON.stringify({
          theme: fixedTheme,
          themeMode,
          lightTheme: lightChoice,
          darkTheme: darkChoice,
          fontSize,
          pagination,
          ttsRate: rate,
          ttsVoice: voice,
        }),
      });
    }, 600);
  }, [fixedTheme, themeMode, lightChoice, darkChoice, fontSize, pagination, rate, voice]);

  const viewRef = useRef<ReaderHandle>(null);
  const activeTocRef = useRef<HTMLButtonElement>(null);
  const offsetRef = useRef(initialPosition?.offset ?? 0);
  const [furthest, setFurthest] = useState(initialPosition?.furthest);
  const ttsRef = useRef<TtsPlayer | null>(null);
  const ttsInit = useRef<Promise<TtsPlayer> | null>(null);
  const [ttsEngine, setTtsEngine] = useState<TtsEngine>();
  const [ttsProgress, setTtsProgress] = useState<number>();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The current chapter's body. The owner's is cached from the first render;
  // a public chapter is fetched, so the view shows the chapter's shell (title,
  // chrome, TOC) while the text is on its way.
  const [chapter, setChapter] = useState<LoadedChapter | undefined>(() =>
    source.peek(Math.min(initialPosition?.chapterIndex ?? 0, source.count - 1)),
  );
  const [loadingChapter, setLoadingChapter] = useState(false);
  /** Bumped after a purchase, to re-read the chapter now that it's unlocked. */
  const [chapterEpoch, setChapterEpoch] = useState(0);

  useEffect(() => {
    const cached = source.peek(chapterIndex);
    if (cached) {
      setChapter(cached);
      setLoadingChapter(false);
      source.prefetch(chapterIndex + 1);
      return;
    }
    let cancelled = false;
    setLoadingChapter(true);
    void source.getChapter(chapterIndex).then((loaded) => {
      if (cancelled) return;
      setChapter(loaded);
      setLoadingChapter(false);
      source.prefetch(chapterIndex + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [chapterIndex, chapterEpoch, source]);

  const chapterTitle = chapter?.title ?? source.titles[chapterIndex] ?? '';
  const chapterText = useMemo(() => chapter?.paragraphs?.join('\n') ?? '', [chapter]);
  const chapterAnnotations = useMemo(
    () => annotations.filter((a) => a.locator.chapterIndex === chapterIndex),
    [annotations, chapterIndex],
  );
  /** The live page view; undefined only before the first render. */
  const bridge = useCallback((): ReaderHandle | undefined => viewRef.current ?? undefined, []);

  const ttsContinueRef = useRef(false);
  const ttsStaleRef = useRef(false);
  // Guards against a doubled "finished" notification advancing two chapters at
  // once; reset each time a chapter's queue is (re)loaded below.
  const ttsAdvancingRef = useRef(false);

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
          if (ttsAdvancingRef.current) return;
          ttsAdvancingRef.current = true;
          setChapterIndex((index) => {
            if (index + 1 >= source.count) {
              ttsAdvancingRef.current = false;
              return index;
            }
            ttsContinueRef.current = true;
            offsetRef.current = 0;
            return index + 1;
          });
        }
      });
    },
    [bridge, source.count],
  );

  // Sentence transport that also crosses chapter boundaries: at the last line
  // Next flows into the next chapter's first line, and at the first line Prev
  // flows into the previous chapter's last line — routing through the same
  // chapterIndex authority as auto-advance, so the view and audio never split.
  const ttsNext = useCallback(() => {
    const tts = ttsRef.current;
    if (!tts) return;
    const { sentenceIndex, totalSentences, playing } = tts.status;
    if (totalSentences > 0 && sentenceIndex >= totalSentences - 1) {
      if (chapterIndex + 1 >= source.count) return;
      ttsContinueRef.current = playing;
      offsetRef.current = 0;
      setChapterIndex(chapterIndex + 1);
    } else {
      tts.next();
    }
  }, [chapterIndex, source.count]);

  const ttsPrev = useCallback(() => {
    const tts = ttsRef.current;
    if (!tts) return;
    const { sentenceIndex, playing } = tts.status;
    if (sentenceIndex <= 0) {
      if (chapterIndex <= 0) return;
      ttsContinueRef.current = playing;
      offsetRef.current = Number.MAX_SAFE_INTEGER;
      setChapterIndex(chapterIndex - 1);
    } else {
      tts.previous();
    }
  }, [chapterIndex]);

  // Returning listeners get the model warmed in the background, so the
  // first Listen of the session starts in ~a second instead of several.
  useEffect(() => {
    if (initialPreferences?.ttsUsed) void getTts().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the TTS queue on the chapter being read: manual navigation, page
  // flips at chapter edges, and auto-advance all funnel through here.
  useEffect(() => {
    const tts = ttsRef.current;
    if (!tts || !ttsOpen) return;
    ttsAdvancingRef.current = false;
    const resume = ttsContinueRef.current || tts.status.playing;
    ttsContinueRef.current = false;
    const offset =
      offsetRef.current >= Number.MAX_SAFE_INTEGER
        ? Math.max(0, chapterText.length - 1)
        : offsetRef.current;
    ttsStaleRef.current = false;
    tts.load(chapterText, offset);
    if (resume) tts.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIndex]);

  // A cross-page selection can't span chapters; cancel it on any chapter change.
  useEffect(() => {
    setExtend(undefined);
  }, [chapterIndex]);

  // Arrow keys turn pages even when focus is on the chrome (e.g. the extend bar).
  useEffect(() => {
    if (pagination !== 'paged') return;
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (event.key === 'ArrowRight') bridge()?.turnPage(1);
      else if (event.key === 'ArrowLeft') bridge()?.turnPage(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pagination, bridge]);

  /**
   * First Listen: load Kokoro (neural, local, cached after first download);
   * fall back to the system voice if the model can't load here.
   */
  const getTts = useCallback(async (): Promise<TtsPlayer> => {
    if (ttsRef.current) return ttsRef.current;
    // Coalesce concurrent callers (background preload + a Listen click) onto a
    // single init, so exactly one controller is ever created and stored.
    if (ttsInit.current) return ttsInit.current;
    ttsInit.current = (async (): Promise<TtsPlayer> => {
      let player: TtsPlayer;
      try {
        const kokoro = new KokoroTtsController();
        setTtsProgress(0);
        await kokoro.init((progress) => setTtsProgress(progress));
        kokoro.setVoice(voiceRef.current);
        player = kokoro;
        setTtsEngine('kokoro');
        if (!offline && !initialPreferences?.ttsUsed) {
          void fetch('/api/preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ttsUsed: true }),
          }).catch(() => undefined);
        }
      } catch (error) {
        console.warn('Kokoro TTS unavailable, using system voice:', error);
        player = new WebTtsController();
        setTtsEngine('system');
      }
      setTtsProgress(undefined);
      ttsRef.current = player;
      attachTtsListener(player);
      return player;
    })();
    try {
      return await ttsInit.current;
    } finally {
      ttsInit.current = null;
    }
  }, [attachTtsListener]);

  // Fully stop and drop the TTS engine (leaving the reader, or navigating away).
  const teardownTts = useCallback(() => {
    const tts = ttsRef.current;
    ttsRef.current = null;
    ttsInit.current = null;
    if (!tts) return;
    tts.setListener(undefined);
    if ('destroy' in tts) tts.destroy();
    else tts.stop();
    setTtsOpen(false);
    setTtsPlaying(false);
  }, []);

  const savePosition = useCallback(
    (offset: number) => {
      offsetRef.current = offset;
      // Reading moved while TTS was paused → the queue is now stale; the
      // next play should pick up from here, not from the old sentence.
      const tts = ttsRef.current;
      if (tts && !tts.status.playing) ttsStaleRef.current = true;
      setFurthest((prior) => {
        if (
          !prior ||
          chapterIndex > prior.chapterIndex ||
          (chapterIndex === prior.chapterIndex && offset > prior.offset)
        ) {
          return { chapterIndex, offset };
        }
        return prior;
      });
      // An anonymous reader still gets the in-session "furthest point" chrome;
      // only the server write needs a session (and is silent about it — being
      // nagged to sign in for scrolling would be obnoxious).
      if (!source.capabilities.canPersistPosition) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void fetch(`/api/books/${book.id}/position`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chapterIndex, offset }),
        }).catch(() => undefined);
      }, 800);
    },
    [book.id, chapterIndex, source],
  );

  const reloadAnnotations = useCallback(async () => {
    if (!source.capabilities.canAnnotate) return;
    const response = await fetch(`/api/books/${book.id}/annotations`);
    if (response.ok) {
      const body = (await response.json()) as { annotations: Annotation[] };
      setAnnotations(body.annotations);
    }
  }, [book.id, source]);

  // --- Page view events ------------------------------------------------------
  // The view reports in chapter offsets; the chrome owns what they mean.

  /** Laid out and ready — restore the reading position we were sent with. */
  const onViewReady = useCallback(() => {
    if (offsetRef.current > 0) viewRef.current?.scrollToOffset(offsetRef.current);
  }, []);

  const onExtendPoint = useCallback((range: { start: number; end: number; text: string }) => {
    setExtend((prev) => (prev ? { ...prev, range } : prev));
  }, []);

  const onTapHighlight = useCallback(
    (id: string) => {
      const annotation = annotations.find((a) => a.id === id);
      if (annotation) setActing(annotation);
    },
    [annotations],
  );

  /** A page turn ran off the chapter — flow into the neighbour. */
  const onPageEdge = useCallback(
    (direction: 'prev' | 'next') => {
      setChapterIndex((index) => {
        if (direction === 'next' && index + 1 < source.count) {
          offsetRef.current = 0;
          return index + 1;
        }
        if (direction === 'prev' && index > 0) {
          // Land on the last page of the previous chapter.
          offsetRef.current = Number.MAX_SAFE_INTEGER;
          return index - 1;
        }
        return index;
      });
    },
    [source.count],
  );

  const onTapPage = useCallback(() => {
    setTocOpen(false);
    setThemeOpen(false);
  }, []);

  // Tear down whichever TTS engine is live when leaving the reader.
  useEffect(() => {
    return () => teardownTts();
  }, [teardownTts]);

  const createHighlight = useCallback(
    async (start: number, end: number, passage: string, color: HighlightColor, note?: string) => {
      if (!chapter) return;
      // Annotating someone else's published book is fine (the row is yours) —
      // but you have to be signed in, so an anonymous reader is prompted here
      // rather than losing the highlight silently.
      if (!source.requireAuth(note ? 'note' : 'highlight')) return;
      await fetch(`/api/books/${book.id}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapterIndex,
          start,
          end,
          passage,
          note,
          color,
          chapterTitle,
        }),
      });
      await reloadAnnotations();
    },
    [book.id, chapter, chapterIndex, chapterTitle, reloadAnnotations, source],
  );

  const addHighlight = useCallback(
    async (color: HighlightColor, note?: string) => {
      if (!selection) return;
      await createHighlight(selection.start, selection.end, selection.text, color, note);
      setSelection(undefined);
    },
    [createHighlight, selection],
  );

  const recolorAnnotation = useCallback(
    async (id: string, color: HighlightColor) => {
      setActing((a) => (a && a.id === id ? { ...a, color } : a));
      await fetch(`/api/annotations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color }),
      });
      await reloadAnnotations();
    },
    [reloadAnnotations],
  );

  // Cross-page highlight: anchor at the selection, flip pages, tap the end.
  const startExtend = useCallback(() => {
    if (!selection) return;
    setExtend({
      anchor: selection.start,
      anchorText: selection.text,
      range: { start: selection.start, end: selection.end, text: selection.text },
    });
    bridge()?.beginExtend(selection.start, selection.end);
    setSelection(undefined);
  }, [bridge, selection]);

  const cancelExtend = useCallback(() => {
    bridge()?.endExtend();
    setExtend(undefined);
  }, [bridge]);

  const confirmExtend = useCallback(
    async (color: HighlightColor) => {
      const range = extend?.range;
      if (!range) return;
      bridge()?.endExtend();
      setExtend(undefined);
      await createHighlight(range.start, range.end, range.text, color);
    },
    [bridge, createHighlight, extend],
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

  /** Jump back to the furthest point ever read (used by the TOC and the pill). */
  const goToFurthest = useCallback(() => {
    if (!furthest) return;
    offsetRef.current = furthest.offset;
    setSelection(undefined);
    setTocOpen(false);
    setChapterIndex(furthest.chapterIndex);
  }, [furthest]);

  const toggleTts = useCallback(async () => {
    if (ttsOpen) {
      ttsRef.current?.stop();
      setTtsOpen(false);
      bridge()?.clearSentence();
      return;
    }
    setTtsOpen(true);
    const tts = await getTts();
    ttsStaleRef.current = false;
    tts.load(chapterText, offsetRef.current);
    tts.play();
  }, [bridge, chapterText, getTts, ttsOpen]);

  // Turn a page from the Listen bar. The turn reports a new offset shortly
  // (turn animation + scroll message), so listening resyncs to that page: now
  // if it's playing, on the next play otherwise.
  const ttsTurnPage = useCallback(
    (delta: number) => {
      bridge()?.turnPage(delta);
      const tts = ttsRef.current;
      if (!tts) return;
      ttsStaleRef.current = true;
      if (tts.status.playing) {
        window.setTimeout(() => {
          if (!ttsStaleRef.current) return;
          ttsStaleRef.current = false;
          tts.load(chapterText, offsetRef.current);
          tts.play();
        }, 260);
      }
    },
    [bridge, chapterText],
  );

  // "Listen from here" on a selection: start narration at the selection's head.
  const listenFromHere = useCallback(async () => {
    if (!selection) return;
    const start = selection.start;
    setSelection(undefined);
    setTtsOpen(true);
    const tts = await getTts();
    offsetRef.current = start;
    ttsStaleRef.current = false;
    tts.load(chapterText, start);
    tts.play();
  }, [selection, getTts, chapterText]);

  const cycleRate = useCallback(() => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]!;
    setRate(next);
    ttsRef.current?.setRate(next);
  }, [rate]);

  // A source with no chapters at all (an empty book) has nothing to show.
  if (source.count === 0) return null;

  const { canComment } = source.capabilities;
  /** Owner-only chrome: Notes and Voices are library tools, not reading tools. */
  const isLibrary = !publicSeries;

  // What "unlock the rest of the book" would cost from here — the paywall's
  // second offer. Same pricing rules the server charges (core), so the quote
  // and the charge can't drift.
  const pricing = source.pricing;
  const remainingBookCost = pricing
    ? remainingUnlockCost(pricing, pricing.chapterCount, source.unlocked ?? [])
    : 0;
  const remainingLocked =
    pricing && pricing.coinsPerChapter > 0 ? remainingBookCost / pricing.coinsPerChapter : 0;

  const themeColors = READER_THEMES[theme];
  const panelStyle = {
    background: themeColors.bg,
    color: themeColors.fg,
    borderColor: `color-mix(in srgb, ${themeColors.fg} 16%, transparent)`,
  };
  const mutedColor = `color-mix(in srgb, ${themeColors.fg} 60%, transparent)`;
  // Exposed as CSS vars on the shell so every popover inherits the active theme.
  const panelVars: Record<string, string> = {
    '--panel-bg': themeColors.bg,
    '--panel-fg': themeColors.fg,
    '--panel-muted': mutedColor,
    '--panel-border': `color-mix(in srgb, ${themeColors.fg} 16%, transparent)`,
    '--panel-accent': themeColors.accent,
    '--panel-accent-soft': `color-mix(in srgb, ${themeColors.accent} 18%, transparent)`,
    // A theme-derived hover/active tint — replaces a hardcoded cream that was
    // invisible/wrong on dark themes (night/midnight).
    '--panel-hover': `color-mix(in srgb, ${themeColors.fg} 9%, transparent)`,
  };
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

  // Open the Chapters list already scrolled to the current chapter, instead of
  // from the top — for long books that's a lot of scrolling to find your place.
  useEffect(() => {
    if (tocOpen) activeTocRef.current?.scrollIntoView({ block: 'center' });
  }, [tocOpen]);

  return (
    <div
      className="relative flex h-screen flex-col transition-colors"
      style={{ background: themeColors.bg, color: themeColors.fg, ...panelVars } as CSSProperties}
    >
      <header
        className={`flex h-12 shrink-0 select-none items-stretch justify-between text-sm ${
          isElectron ? 'electron-drag pl-20' : 'pl-2'
        }`}
      >
        <div className="flex min-w-0 items-stretch">
          <Link href={backHref} onClick={teardownTts} className={`${chromeButton} shrink-0 font-medium`}>
            ← {backLabel}
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
          <button
            onClick={() => {
              closeMenus();
              setCommentsOpen(true);
            }}
            className={chromeButton}
          >
            Comments
          </button>
          {isLibrary ? (
            <>
              <Link href={`/notes/${book.id}`} onClick={teardownTts} className={chromeButton}>
                Notes
              </Link>
              <Link href={`/voice/${book.id}`} onClick={teardownTts} className={chromeButton}>
                Voices
              </Link>
            </>
          ) : (
            <span className="flex items-center px-2.5 text-xs font-semibold opacity-70">
              {source.wallet ? `${source.wallet.balance} coins` : null}
            </span>
          )}
        </div>
      </header>

      <CommentsDrawer
        bookId={book.id}
        chapterIndex={chapterIndex}
        chapterTitle={chapterTitle}
        currentUserId={currentUserId}
        canPost={canComment}
        open={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        colors={{
          bg: themeColors.bg,
          fg: themeColors.fg,
          accent: themeColors.accent,
          muted: mutedColor,
          border: panelStyle.borderColor,
        }}
      />

      {/* min-h-0: a flex item defaults to min-height:auto, so without this the
          chapter's own height wins and the whole window scrolls instead of the
          page. (The old iframe hid this — it never grew with its content.) */}
      <div className={`relative min-h-0 flex-1 ${ttsOpen ? 'pb-14' : ''}`}>
        {chapter?.paragraphs && !chapter.locked ? (
          <ChapterView
            ref={viewRef}
            title={chapter.title}
            paragraphs={chapter.paragraphs}
            annotations={chapterAnnotations}
            theme={theme}
            fontSize={fontSize}
            pagination={pagination}
            onReady={onViewReady}
            onSelection={setSelection}
            onExtendPoint={onExtendPoint}
            onPosition={savePosition}
            onTapHighlight={onTapHighlight}
            onPageEdge={onPageEdge}
            onTap={onTapPage}
          />
        ) : chapter?.locked ? (
          // A locked chapter is a data state, not a different page: the reader
          // keeps its chrome, TOC and theme, and the body is the paywall.
          <div className="h-full overflow-y-auto px-6 py-10">
            <div className="mx-auto max-w-md">
              <h1 className="text-center font-serif text-2xl">{chapterTitle}</h1>
              <ReaderPaywall
                bookId={book.id}
                chapterIndex={chapterIndex}
                coinCost={chapter.coinCost}
                signedIn={canComment}
                balance={source.wallet?.balance ?? 0}
                remainingCount={remainingLocked}
                remainingBookCost={remainingBookCost}
                colors={{
                  bg: themeColors.bg,
                  fg: themeColors.fg,
                  accent: themeColors.accent,
                  muted: mutedColor,
                  border: panelStyle.borderColor,
                }}
                onUnlocked={async () => {
                  await source.onUnlocked?.(chapterIndex);
                  setChapterEpoch((epoch) => epoch + 1);
                }}
              />
            </div>
          </div>
        ) : loadingChapter ? (
          <div className="flex h-full items-center justify-center text-sm" style={{ color: mutedColor }}>
            Opening {chapterTitle}…
          </div>
        ) : null}

        {anyMenuOpen ? (
          <button
            aria-label="Close menu"
            className="absolute inset-0 z-10 cursor-default"
            onClick={closeMenus}
          />
        ) : null}

        {tocOpen ? (
          <nav className="absolute right-4 top-2 z-20 max-h-[70%] w-72 overflow-auto rounded-xl border border-[var(--panel-border)] bg-[var(--panel-bg)] p-2 text-[var(--panel-fg)] shadow-lg">
            {furthest && chapterIndex < furthest.chapterIndex ? (
              <button
                onClick={goToFurthest}
                className="mb-1 block w-full truncate rounded-lg px-3 py-2 text-left text-sm font-semibold text-[var(--panel-accent)] hover:bg-[var(--panel-hover)]"
              >
                ↩ Go to where I left off
              </button>
            ) : null}
            {source.titles.map((title, i) => {
              const current = i === chapterIndex;
              return (
                <button
                  key={i}
                  ref={current ? activeTocRef : undefined}
                  onClick={() => goToChapter(i)}
                  className={`block w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--panel-hover)] ${
                    current ? 'bg-[var(--panel-hover)] font-bold text-[var(--panel-accent)]' : ''
                  }`}
                >
                  {title}
                </button>
              );
            })}
          </nav>
        ) : null}

        {themeOpen ? (
          <div className="absolute right-4 top-2 z-20 w-60 rounded-xl border border-[var(--panel-border)] bg-[var(--panel-bg)] p-2 text-[var(--panel-fg)] shadow-lg">
            <button
              onClick={toggleAutoTheme}
              className={`mb-2 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition hover:border-[var(--panel-accent)] ${
                themeMode === 'auto' ? 'border-[var(--panel-accent)]' : 'border-transparent'
              }`}
            >
              <span className={themeMode === 'auto' ? 'font-bold text-[var(--panel-accent)]' : ''}>
                Follow system
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  themeMode === 'auto' ? 'bg-[var(--panel-accent)] text-[var(--panel-bg)]' : 'bg-[var(--panel-accent-soft)] text-[var(--panel-muted)]'
                }`}
              >
                {themeMode === 'auto' ? 'On' : 'Off'}
              </span>
            </button>
            {THEME_PREVIEWS.map((preview) => {
              const active = theme === preview.key;
              const otherPick =
                themeMode === 'auto' &&
                !active &&
                (preview.key === lightChoice || preview.key === darkChoice);
              return (
                <button
                  key={preview.key}
                  onClick={() => {
                    chooseTheme(preview.key);
                    if (themeMode === 'fixed') setThemeOpen(false);
                  }}
                  className={`mb-1 flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition hover:border-[var(--panel-accent)] ${
                    active
                      ? 'border-[var(--panel-accent)]'
                      : otherPick
                        ? 'border-[var(--panel-accent)]/40'
                        : 'border-transparent'
                  }`}
                >
                  <span
                    className="flex h-9 w-14 shrink-0 items-center justify-center rounded-md border border-black/10 font-serif text-xs"
                    style={{ background: preview.bg, color: preview.fg }}
                  >
                    Aa
                  </span>
                  <span
                    className={
                      active
                        ? 'font-bold text-[var(--panel-accent)]'
                        : otherPick
                          ? 'text-[var(--panel-accent)]/70'
                          : ''
                    }
                  >
                    {preview.label}
                  </span>
                  {otherPick ? (
                    <span className="ml-auto text-xs text-[var(--panel-muted)]">
                      {isDarkTheme(preview.key) ? 'dark' : 'light'}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {themeMode === 'auto' ? (
              <p className="px-3 pt-1 text-xs text-[var(--panel-muted)]">
                Following your system — {systemDark ? 'dark' : 'light'} now.
              </p>
            ) : null}
          </div>
        ) : null}

        {layoutOpen ? (
          <div className="absolute right-4 top-2 z-20 w-64 rounded-xl border border-[var(--panel-border)] bg-[var(--panel-bg)] p-2 text-[var(--panel-fg)] shadow-lg">
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
                className={`mb-1 flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition hover:border-[var(--panel-accent)] ${
                  pagination === option.key ? 'border-[var(--panel-accent)]' : 'border-transparent'
                }`}
              >
                <span className="shrink-0 text-[var(--panel-muted)]">{option.icon}</span>
                <span>
                  <span className={`block ${pagination === option.key ? 'font-bold text-[var(--panel-accent)]' : 'font-medium'}`}>
                    {option.label}
                  </span>
                  <span className="block text-xs text-[var(--panel-muted)]">{option.hint}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {typeOpen ? (
          <div className="absolute right-4 top-2 z-20 w-64 rounded-xl border border-[var(--panel-border)] bg-[var(--panel-bg)] p-4 text-[var(--panel-fg)] shadow-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--panel-muted)]">
                Text size
              </span>
              {fontSize !== DEFAULT_FONT_SIZE ? (
                <button
                  onClick={() => setFontSize(DEFAULT_FONT_SIZE)}
                  className="text-xs font-medium text-[var(--panel-accent)]"
                >
                  Reset
                </button>
              ) : null}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={() => setFontSize((s) => Math.max(14, s - 1))}
                className="flex h-10 w-16 items-center justify-center rounded-lg border border-[var(--panel-border)] text-sm transition hover:border-[var(--panel-accent)]"
              >
                A−
              </button>
              <span className="font-serif" style={{ fontSize: Math.min(fontSize, 24) }}>
                {fontSize}px
              </span>
              <button
                onClick={() => setFontSize((s) => Math.min(26, s + 1))}
                className="flex h-10 w-16 items-center justify-center rounded-lg border border-[var(--panel-border)] text-lg transition hover:border-[var(--panel-accent)]"
              >
                A+
              </button>
            </div>
          </div>
        ) : null}

        {selection ? (
          <div
            className="absolute bottom-16 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border px-5 py-2.5 shadow-xl"
            style={panelStyle}
          >
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
              onClick={() => selection && setNoteEditor({ passage: selection.text, draft: '' })}
              className="rounded-lg px-2 py-1 text-sm font-semibold transition hover:opacity-70"
              style={{ color: themeColors.accent }}
            >
              Note
            </button>
            <button
              onClick={() => void sharePassage()}
              className="rounded-lg px-2 py-1 text-sm font-semibold transition hover:opacity-70"
              style={{ color: themeColors.accent }}
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
            <button
              onClick={() => void listenFromHere()}
              className="rounded-lg px-2 py-1 text-sm font-semibold transition hover:opacity-70"
              style={{ color: themeColors.accent }}
            >
              Listen
            </button>
            {pagination === 'paged' ? (
              <button
                onClick={startExtend}
                className="rounded-lg px-2 py-1 text-sm font-semibold transition hover:opacity-70"
                style={{ color: themeColors.accent }}
              >
                Extend →
              </button>
            ) : null}
          </div>
        ) : null}

        {extend ? (
          <div
            className="absolute bottom-16 left-1/2 z-10 w-[min(92vw,32rem)] -translate-x-1/2 rounded-2xl border px-4 py-3 shadow-xl"
            style={panelStyle}
          >
            <p className="text-center text-xs" style={{ color: mutedColor }}>
              Click a word where the highlight should end.
            </p>
            {extend.range ? (
              <p className="mt-1 text-center text-xs italic" style={{ color: mutedColor }}>
                “{rangePreview(extend.range.text)}”
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((color) => (
                <button
                  key={color}
                  aria-label={`Save ${color} highlight`}
                  title={`Save as ${color}`}
                  onClick={() => void confirmExtend(color)}
                  className="h-5 w-5 rounded-full ring-[#26221c]/25 ring-offset-1 transition hover:scale-110 hover:ring-2"
                  style={{ background: `rgb(${HIGHLIGHT_COLORS[color]})` }}
                />
              ))}
              <button
                onClick={() => void confirmExtend('yellow')}
                className="ml-1 rounded-full px-3 py-1 text-sm font-semibold transition hover:opacity-90"
                style={{ background: themeColors.accent, color: themeColors.bg }}
              >
                Save
              </button>
              <button
                onClick={() => {
                  const range = extend.range;
                  bridge()?.endExtend();
                  setExtend(undefined);
                  if (range) setNoteEditor({ passage: range.text, draft: '', range });
                }}
                className="rounded-lg px-2 py-1 text-sm font-semibold transition hover:opacity-70"
                style={{ color: themeColors.accent }}
              >
                Note
              </button>
              <button
                onClick={cancelExtend}
                className="rounded-lg px-2 py-1 text-sm font-semibold transition hover:opacity-70"
                style={{ color: mutedColor }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {noteEditor ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 p-6">
            <div className="w-full max-w-md rounded-2xl border p-5 shadow-2xl" style={panelStyle}>
              <p className="max-h-20 overflow-hidden text-sm italic" style={{ color: mutedColor }}>
                “{noteEditor.passage.slice(0, 200)}”
              </p>
              <textarea
                autoFocus
                value={noteEditor.draft}
                onChange={(e) =>
                  setNoteEditor((prev) => (prev ? { ...prev, draft: e.target.value } : prev))
                }
                placeholder="Your note…"
                rows={4}
                className="mt-3 w-full resize-none rounded-lg border bg-transparent p-3 text-sm outline-none"
                style={{ borderColor: panelStyle.borderColor, color: themeColors.fg }}
              />
              <div className="mt-3 flex justify-end gap-3 text-sm">
                <button
                  onClick={() => setNoteEditor(undefined)}
                  className="px-3 py-2"
                  style={{ color: mutedColor }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const editor = noteEditor;
                    const note = editor.draft.trim();
                    setNoteEditor(undefined);
                    if (editor.annotationId) {
                      void fetch(`/api/annotations/${editor.annotationId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ note: note || null }),
                      }).then(reloadAnnotations);
                    } else if (editor.range) {
                      // Extend → Note: create the highlight for the extended range.
                      void createHighlight(
                        editor.range.start,
                        editor.range.end,
                        editor.range.text,
                        'yellow',
                        note || undefined,
                      );
                    } else {
                      void addHighlight('yellow', note || undefined);
                    }
                  }}
                  className="rounded-full px-4 py-2 font-semibold"
                  style={{ background: themeColors.accent, color: themeColors.bg }}
                >
                  {noteEditor.annotationId ? 'Save' : 'Save note'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {acting ? (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 p-6"
            onClick={() => setActing(undefined)}
          >
            <div
              className="w-full max-w-md rounded-2xl border p-5 shadow-2xl"
              style={panelStyle}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="max-h-28 overflow-hidden text-sm italic" style={{ color: mutedColor }}>
                “{acting.passage.slice(0, 240)}”
              </p>
              {acting.note ? (
                <p
                  className="mt-3 whitespace-pre-wrap text-sm"
                  style={{ color: themeColors.fg }}
                >
                  {acting.note}
                </p>
              ) : null}
              <div className="mt-4 flex items-center gap-2">
                {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((color) => (
                  <button
                    key={color}
                    onClick={() => void recolorAnnotation(acting.id, color)}
                    className="h-6 w-6 rounded-full border-2 transition"
                    style={{
                      background: `rgb(${HIGHLIGHT_COLORS[color]})`,
                      borderColor: acting.color === color ? themeColors.fg : 'transparent',
                    }}
                    aria-label={`Recolor highlight ${color}`}
                  />
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between text-sm">
                <button
                  onClick={() => {
                    const id = acting.id;
                    setActing(undefined);
                    void fetch(`/api/annotations/${id}`, { method: 'DELETE' }).then(
                      reloadAnnotations,
                    );
                  }}
                  className="px-2 py-1 font-semibold"
                  style={{ color: '#cf4f3e' }}
                >
                  Remove
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={() => setActing(undefined)}
                    className="px-3 py-2"
                    style={{ color: mutedColor }}
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      setNoteEditor({
                        passage: acting.passage,
                        draft: acting.note ?? '',
                        annotationId: acting.id,
                      });
                      setActing(undefined);
                    }}
                    className="rounded-full px-4 py-2 font-semibold"
                    style={{ background: themeColors.accent, color: themeColors.bg }}
                  >
                    {acting.note ? 'Edit note' : 'Add note'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {ttsOpen ? (
          <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[var(--panel-bg)]/85 px-3 py-1 text-[var(--panel-fg)] shadow-md ring-1 ring-[var(--panel-border)] backdrop-blur-sm">
            {ttsProgress !== undefined ? (
              <span className="px-1 text-xs text-[var(--panel-muted)]">
                Preparing voice… {ttsProgress}%
              </span>
            ) : (
              <>
                {pagination === 'paged' ? (
                  <button
                    aria-label="Previous page"
                    onClick={() => ttsTurnPage(-1)}
                    className="p-1 text-[var(--panel-muted)] transition hover:text-[var(--panel-fg)]"
                  >
                    <PlayerIcon d="M18 6 L12 12 L18 18 M12 6 L6 12 L12 18" />
                  </button>
                ) : null}
                <button
                  aria-label="Previous sentence"
                  onClick={ttsPrev}
                  className="p-1 text-[var(--panel-muted)] transition hover:text-[var(--panel-fg)]"
                >
                  <PlayerIcon d="M19 5 L9 12 L19 19 Z M7 5 v14" />
                </button>
                <button
                  aria-label={ttsPlaying ? 'Pause' : 'Play'}
                  onClick={() => {
                    const tts = ttsRef.current;
                    if (!tts) return;
                    if (ttsPlaying) {
                      tts.stop();
                      return;
                    }
                    // Starting playback should read from what's on screen: in
                    // paged mode the page is the unit, so always resync to it;
                    // in scroll mode, resync only if reading moved while paused.
                    if (ttsStaleRef.current || pagination === 'paged') {
                      ttsStaleRef.current = false;
                      tts.load(chapterText, offsetRef.current);
                    }
                    tts.play();
                  }}
                  className="p-1 text-[var(--panel-accent)] transition hover:opacity-75"
                >
                  {ttsPlaying ? (
                    <PlayerIcon filled d="M7 5 h3.5 v14 H7 Z M13.5 5 H17 v14 h-3.5 Z" />
                  ) : (
                    <PlayerIcon filled d="M8 5 L19 12 L8 19 Z" />
                  )}
                </button>
                <button
                  aria-label="Next sentence"
                  onClick={ttsNext}
                  className="p-1 text-[var(--panel-muted)] transition hover:text-[var(--panel-fg)]"
                >
                  <PlayerIcon d="M5 5 L15 12 L5 19 Z M17 5 v14" />
                </button>
                {pagination === 'paged' ? (
                  <button
                    aria-label="Next page"
                    onClick={() => ttsTurnPage(1)}
                    className="p-1 text-[var(--panel-muted)] transition hover:text-[var(--panel-fg)]"
                  >
                    <PlayerIcon d="M6 6 L12 12 L6 18 M12 6 L18 12 L12 18" />
                  </button>
                ) : null}
                <button onClick={cycleRate} className="p-1 text-sm font-bold text-[var(--panel-muted)]">
                  {rate.toFixed(2).replace(/0$/, '')}×
                </button>
                {ttsEngine === 'kokoro' ? (
                  <select
                    aria-label="Voice"
                    value={voice}
                    onChange={(e) => {
                      setVoice(e.target.value);
                      voiceRef.current = e.target.value;
                      const tts = ttsRef.current;
                      if (tts instanceof KokoroTtsController) tts.setVoice(e.target.value);
                    }}
                    className="max-w-32 rounded-lg border border-[var(--panel-border)] bg-transparent px-1.5 py-1 text-xs text-[var(--panel-muted)] outline-none"
                  >
                    {KOKORO_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                ) : null}
                {ttsEngine === 'system' ? (
                  <span className="text-xs text-[var(--panel-muted)]" title="Neural voice unavailable; using the system voice">
                    system voice
                  </span>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      {furthest && chapterIndex < furthest.chapterIndex ? (
        <button
          onClick={goToFurthest}
          className="absolute bottom-14 right-6 z-10 rounded-full bg-[var(--panel-bg)] px-4 py-2 text-xs font-semibold text-[var(--panel-accent)] shadow-lg ring-1 ring-[var(--panel-border)] transition hover:bg-[var(--panel-accent-soft)]"
        >
          Resume at {source.titles[furthest.chapterIndex] ?? 'furthest point'} →
        </button>
      ) : null}

      <footer className="flex h-10 shrink-0 select-none items-stretch justify-between px-2 text-sm">
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
          {chapterIndex + 1} / {source.count} · {chapterTitle}
        </span>
        <button
          disabled={pagination === 'scroll' && chapterIndex >= source.count - 1}
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
