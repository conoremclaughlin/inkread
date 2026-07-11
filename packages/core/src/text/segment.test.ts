import { describe, expect, it } from 'vitest';
import { textToChapters } from './segment';

describe('textToChapters', () => {
  it('splits chapters on markdown headings and joins soft-wrapped lines', () => {
    const text = [
      '# The Garden',
      '',
      'First paragraph line one',
      'continues on line two.',
      '',
      'Second paragraph.',
      '',
      '## Winter',
      '',
      'Winter body text.',
    ].join('\n');
    const chapters = textToChapters(text);
    expect(chapters.map((c) => c.title)).toEqual(['The Garden', 'Winter']);
    expect(chapters[0]!.paragraphs).toEqual([
      'First paragraph line one continues on line two.',
      'Second paragraph.',
    ]);
  });

  it('detects "Chapter N" and ALL-CAPS headings in plain text', () => {
    const text = [
      'Chapter 1',
      '',
      'Body of chapter one.',
      '',
      'PART TWO',
      '',
      'Body of part two.',
    ].join('\n');
    const chapters = textToChapters(text);
    expect(chapters.map((c) => c.title)).toEqual(['Chapter 1', 'PART TWO']);
  });

  it('falls back to a single chapter when there are no headings', () => {
    const chapters = textToChapters('Just one paragraph.\n\nAnd another.', 'My Doc');
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe('My Doc');
    expect(chapters[0]!.paragraphs).toHaveLength(2);
  });

  it('does not treat ordinary sentences as headings', () => {
    const text = 'A short line.\n\nFollowed by more text here.';
    const chapters = textToChapters(text);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.paragraphs).toHaveLength(2);
  });

  it('handles windows line endings and empty input', () => {
    expect(textToChapters('One.\r\n\r\nTwo.')[0]!.paragraphs).toEqual(['One.', 'Two.']);
    expect(textToChapters('')).toEqual([]);
  });
});
