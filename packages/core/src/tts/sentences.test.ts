import { describe, expect, it } from 'vitest';
import { splitSentences } from './sentences';

describe('splitSentences', () => {
  it('splits on terminal punctuation', () => {
    const result = splitSentences('First sentence. Second one! Third?');
    expect(result.map((s) => s.text)).toEqual([
      'First sentence.',
      'Second one!',
      'Third?',
    ]);
  });

  it('keeps offsets that map back to the source text', () => {
    const text = 'Alpha beta. Gamma delta.';
    for (const s of splitSentences(text)) {
      expect(text.slice(s.start, s.end)).toBe(s.text);
    }
  });

  it('does not split on common abbreviations or initials', () => {
    const result = splitSentences('Dr. Smith met J. Doe at 5 p.m. sharp. Then they left.');
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe('Dr. Smith met J. Doe at 5 p.m. sharp.');
  });

  it('keeps closing quotes with the sentence', () => {
    const result = splitSentences('“Stop!” she said. He did.');
    expect(result.map((s) => s.text)).toEqual(['“Stop!”', 'she said.', 'He did.']);
  });

  it('treats newlines as boundaries', () => {
    const result = splitSentences('A heading\nBody text here.');
    expect(result.map((s) => s.text)).toEqual(['A heading', 'Body text here.']);
  });

  it('handles empty input', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   ')).toEqual([]);
  });
});
