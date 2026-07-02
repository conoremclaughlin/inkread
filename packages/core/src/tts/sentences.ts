/**
 * Split chapter text into speakable sentences for the TTS queue.
 * Each sentence keeps its character offsets into the source text so the
 * reader can highlight the sentence currently being spoken.
 */

export interface Sentence {
  text: string;
  start: number;
  end: number;
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e',
  'fig', 'vol', 'no', 'pp', 'ed', 'inc', 'ltd', 'co', 'dept', 'est', 'approx',
  'a.m', 'p.m', 'u.s', 'u.k',
]);

function endsWithAbbreviation(text: string): boolean {
  const match = /([A-Za-z][A-Za-z.]*)\.$/.exec(text);
  if (!match) return false;
  const word = match[1]!.toLowerCase().replace(/\.$/, '');
  if (ABBREVIATIONS.has(word)) return true;
  // Single capital letter → an initial like "J."
  return /^[A-Z]$/.test(match[1]!);
}

export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  let start = 0;
  let i = 0;

  const push = (end: number): void => {
    const slice = text.slice(start, end);
    const trimmedLeading = slice.length - slice.trimStart().length;
    const trimmed = slice.trim();
    if (trimmed.length > 0) {
      sentences.push({
        text: trimmed,
        start: start + trimmedLeading,
        end: start + trimmedLeading + trimmed.length,
      });
    }
    start = end;
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\n') {
      push(i);
      i += 1;
      start = i;
      continue;
    }
    if (ch === '.' || ch === '!' || ch === '?') {
      // Consume any run of terminators plus closing quotes/brackets.
      let j = i + 1;
      while (j < text.length && /["'”’)\]!?.]/.test(text[j]!)) j += 1;
      const followedBySpace = j >= text.length || /\s/.test(text[j]!);
      const before = text.slice(start, i + 1);
      if (followedBySpace && !(ch === '.' && endsWithAbbreviation(before))) {
        push(j);
        i = j;
        continue;
      }
    }
    i += 1;
  }
  push(text.length);
  return sentences;
}
