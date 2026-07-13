/**
 * Core domain types shared between the conversion pipeline, the reader,
 * and the export/share features. Everything here is plain data — safe to
 * persist as JSON and to pass across the WebView bridge.
 */

/** A single positioned text run extracted from a PDF page (pdf.js item, normalized). */
export interface PdfTextItem {
  text: string;
  /** Left edge, PDF user-space units. */
  x: number;
  /** Baseline y, PDF user-space units. Origin is bottom-left: larger y = higher on page. */
  y: number;
  fontSize: number;
  /** Advance width of the run, when the extractor provides it. */
  width?: number;
  fontName?: string;
}

export interface PdfPage {
  /** 1-based page number in the source PDF. */
  pageNumber: number;
  width: number;
  height: number;
  items: PdfTextItem[];
}

/** A reflowable chapter produced by segmentation — the unit the reader renders. */
export interface Chapter {
  title: string;
  paragraphs: string[];
  /** Marks headings promoted from the PDF but kept inside a chapter body. */
  kind?: 'chapter' | 'frontmatter';
  /** Source PDF pages this chapter spans, for provenance / debugging. */
  sourcePages?: { from: number; to: number };
}

export interface BookMeta {
  id: string;
  title: string;
  author?: string;
  language?: string;
  /** Where this book came from. */
  source: 'pdf' | 'epub' | 'text';
  createdAt: string;
}

export type AnnotationKind = 'highlight' | 'note';

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';

/**
 * Locates a text range inside a chapter by character offsets into the
 * chapter's plain text (paragraphs joined with '\n'). Simple, stable for
 * books we generated ourselves, and cheap to resolve in the reader.
 */
export interface TextLocator {
  chapterIndex: number;
  start: number;
  end: number;
}

export interface Annotation {
  id: string;
  bookId: string;
  kind: AnnotationKind;
  locator: TextLocator;
  /** The passage text as highlighted (denormalized so exports never need the book). */
  passage: string;
  /** The user's note, when kind === 'note' (a note always anchors to a passage). */
  note?: string;
  color: HighlightColor;
  chapterTitle?: string;
  createdAt: string;
}

/** Reading position, persisted per book. */
export interface ReadingPosition {
  bookId: string;
  chapterIndex: number;
  /** Character offset into the chapter plain text of the first visible line. */
  offset: number;
  updatedAt: string;
  /**
   * High-water mark — the furthest point ever read. Only moves forward;
   * drives progress display and "resume where I got to" while the current
   * position freely moves backwards for re-reading.
   */
  furthest?: { chapterIndex: number; offset: number };
}
