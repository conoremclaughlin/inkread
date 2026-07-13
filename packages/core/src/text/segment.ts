import type { Chapter } from '../models/types';

/**
 * Plain text / Markdown → chapters. The import path for anything that isn't
 * a PDF: Google Docs exports, pasted text, .md notes.
 *
 * Paragraphs are blank-line separated; single newlines inside a block are
 * soft wraps and join with a space. Chapter breaks come from Markdown
 * headings (#, ##, ###), "Chapter/Part N" lines, or short ALL-CAPS lines.
 */

const TEXT_HEADING_PATTERN =
  /^(chapter|part|book|section|prologue|epilogue|introduction|preface|foreword|appendix)\b/i;

export interface TextToChaptersOptions {
  /**
   * 'auto' (default) also treats "Chapter N" and short ALL-CAPS lines as
   * headings; 'markdown' trusts only #/##/### lines — right for generated
   * or curated sources where shouty prose would misfire.
   */
  headings?: 'auto' | 'markdown';
}

function isHeadingBlock(lines: string[], mode: 'auto' | 'markdown'): boolean {
  if (lines.length !== 1) return false;
  const line = lines[0]!.trim();
  if (line.length === 0 || line.length > 80) return false;
  if (/^#{1,3}\s+\S/.test(line)) return true;
  if (mode === 'markdown') return false;
  if (TEXT_HEADING_PATTERN.test(line) && line.length < 60 && !/[.,;:]$/.test(line)) return true;
  // Short shouty lines ("PART TWO", "THE GARDEN") read as headings.
  const letters = line.replace(/[^A-Za-z]/g, '');
  return letters.length >= 3 && line === line.toUpperCase() && line.length <= 60;
}

function headingText(line: string): string {
  return line.replace(/^#{1,3}\s+/, '').trim();
}

export function textToChapters(
  text: string,
  fallbackTitle = 'Beginning',
  options?: TextToChaptersOptions,
): Chapter[] {
  const mode = options?.headings ?? 'auto';
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map((block) =>
      block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    )
    .filter((lines) => lines.length > 0);

  const chapters: Chapter[] = [];
  let current: { title: string; paragraphs: string[] } | undefined;

  const push = (): void => {
    if (current && (current.paragraphs.length > 0 || chapters.length > 0)) {
      chapters.push({ title: current.title, paragraphs: current.paragraphs });
    }
    current = undefined;
  };

  for (const lines of blocks) {
    if (isHeadingBlock(lines, mode)) {
      push();
      current = { title: headingText(lines[0]!), paragraphs: [] };
      continue;
    }
    if (!current) current = { title: fallbackTitle, paragraphs: [] };
    current.paragraphs.push(lines.join(' '));
  }
  push();

  return chapters.filter((chapter) => chapter.paragraphs.length > 0 || chapters.length === 1);
}
