import { describe, expect, it } from 'vitest';
import { cleanGoogleDocText, googleDocToChapters } from './googleDoc';

describe('cleanGoogleDocText', () => {
  it('strips the BOM and comment markers, including multi-letter runs', () => {
    const raw = '﻿Title line[a][b]\nBody with a marker[aa][ab][bz] mid-run.';
    expect(cleanGoogleDocText(raw)).toBe('Title line\nBody with a marker mid-run.');
  });

  it('preserves bracketed prose like [sic] and [3]', () => {
    const raw = 'He said [sic] it was fine [3].';
    expect(cleanGoogleDocText(raw)).toBe('He said [sic] it was fine [3].');
  });
});

describe('googleDocToChapters', () => {
  it('treats every line as a paragraph and only # lines as headings', () => {
    const raw = [
      '# Chapter One',
      'First paragraph on one line.',
      'SECOND LINE IS SHOUTY PROSE',
      '# Chapter Two',
      'More text.',
    ].join('\n');
    const chapters = googleDocToChapters(raw, 'Doc');
    expect(chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two']);
    expect(chapters[0]!.paragraphs).toEqual([
      'First paragraph on one line.',
      'SECOND LINE IS SHOUTY PROSE',
    ]);
  });

  it('falls back to a single chapter with the given title', () => {
    const chapters = googleDocToChapters('Line one.\nLine two.', 'My Doc');
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe('My Doc');
    expect(chapters[0]!.paragraphs).toEqual(['Line one.', 'Line two.']);
  });

  it('drops a first line that repeats the document title', () => {
    const chapters = googleDocToChapters(
      'Pipeline Check[a]\nActual first paragraph.',
      'Pipeline-Check',
    );
    expect(chapters[0]!.paragraphs).toEqual(['Actual first paragraph.']);
  });
});
