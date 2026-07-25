import { describe, expect, it } from 'vitest';
import {
  attributeSentences,
  castChapter,
  toggleSentenceSpeaker,
  type Speaker,
  type VoiceCast,
  type VoiceRule,
} from './cast';

const NARRATOR: Speaker = { id: 'nar', name: 'Narrator', voiceId: 'v-nar' };
const ALICE: Speaker = { id: 'alice', name: 'Alice', voiceId: 'v-alice' };
const BOB: Speaker = { id: 'bob', name: 'Bob', voiceId: 'v-bob' };

function cast(rules: VoiceRule[], speakers = [NARRATOR, ALICE, BOB]): VoiceCast {
  return { bookId: 'b1', speakers, rules, defaultSpeakerId: 'nar' };
}

describe('castChapter', () => {
  it('attributes everything to the narrator when there are no rules', () => {
    const segs = castChapter(['Hello world. Second sentence.'], 0, cast([]));
    expect(segs).toHaveLength(1); // merged into one narrator run
    expect(segs[0]!.speakerId).toBe('nar');
    expect(segs[0]!.voiceId).toBe('v-nar');
    expect(segs[0]!.text).toContain('Hello world');
    expect(segs[0]!.text).toContain('Second sentence');
  });

  it('routes pattern-matched dialogue to its speaker (grep by quote)', () => {
    const segs = castChapter(
      ['The sun rose. "Good morning," she said.'],
      0,
      cast([{ kind: 'pattern', pattern: '^"', speakerId: 'alice' }]),
    );
    expect(segs.map((s) => s.speakerId)).toEqual(['nar', 'alice']);
    expect(segs[1]!.voiceId).toBe('v-alice');
    expect(segs[1]!.text.startsWith('"Good morning')).toBe(true);
  });

  it('applies a manual range and splits the narration around it', () => {
    // text: "One. Two. Three." — the sentence "Two." spans offsets 5..9.
    const segs = castChapter(
      ['One. Two. Three.'],
      0,
      cast([{ kind: 'manual', chapterIndex: 0, start: 5, end: 9, speakerId: 'alice' }]),
    );
    expect(segs.map((s) => s.speakerId)).toEqual(['nar', 'alice', 'nar']);
    expect(segs[1]!.text).toBe('Two.');
  });

  it('lets a manual range override a pattern match', () => {
    const rules: VoiceRule[] = [
      { kind: 'pattern', pattern: '^"', speakerId: 'alice' },
      { kind: 'manual', chapterIndex: 0, start: 14, end: 40, speakerId: 'bob' },
    ];
    const segs = castChapter(['The sun rose. "Good morning," she said.'], 0, cast(rules));
    // The quoted sentence starts at 14 → manual (bob) wins over the pattern (alice).
    expect(segs.map((s) => s.speakerId)).toEqual(['nar', 'bob']);
  });

  it('only applies manual rules for the given chapter', () => {
    const rules: VoiceRule[] = [{ kind: 'manual', chapterIndex: 3, start: 0, end: 99, speakerId: 'alice' }];
    const segs = castChapter(['Hello there.'], 0, cast(rules));
    expect(segs[0]!.speakerId).toBe('nar'); // manual rule is for chapter 3, not 0
  });

  it('ignores a malformed pattern instead of throwing', () => {
    const run = () =>
      castChapter(['Hello there.'], 0, cast([{ kind: 'pattern', pattern: '(', speakerId: 'alice' }]));
    expect(run).not.toThrow();
    expect(run().every((s) => s.speakerId === 'nar')).toBe(true);
  });

  it('is not confused by a global flag on a pattern (stateful test())', () => {
    const segs = castChapter(
      ['"A." "B." "C."'],
      0,
      cast([{ kind: 'pattern', pattern: '^"', flags: 'g', speakerId: 'alice' }]),
    );
    // All three quoted sentences → alice, merged into one run.
    expect(segs).toHaveLength(1);
    expect(segs[0]!.speakerId).toBe('alice');
  });

  it('leaves voiceId undefined when the speaker is missing from the cast', () => {
    const segs = castChapter(['Hi there.'], 0, {
      bookId: 'b1',
      speakers: [],
      rules: [],
      defaultSpeakerId: 'ghost',
    });
    expect(segs[0]!.speakerId).toBe('ghost');
    expect(segs[0]!.voiceId).toBeUndefined();
  });

  it('returns nothing for empty chapters', () => {
    expect(castChapter([], 0, cast([]))).toEqual([]);
    expect(castChapter([''], 0, cast([]))).toEqual([]);
  });
});

describe('attributeSentences', () => {
  it('attributes each sentence separately (unmerged), unlike castChapter', () => {
    const paragraphs = ['One. Two. "Three," said Alice.'];
    const c = cast([{ kind: 'pattern', pattern: '^"', speakerId: 'alice' }]);
    // Per-sentence: two narrator sentences stay separate.
    expect(attributeSentences(paragraphs, 0, c).map((s) => s.speakerId)).toEqual([
      'nar',
      'nar',
      'alice',
    ]);
    // castChapter merges the adjacent narrator sentences into one segment.
    expect(castChapter(paragraphs, 0, c).map((s) => s.speakerId)).toEqual(['nar', 'alice']);
  });

  it('resolves each sentence to its speaker voice', () => {
    const sentences = attributeSentences(['Hi there.'], 0, cast([]));
    expect(sentences[0]!.voiceId).toBe('v-nar');
  });
});

describe('toggleSentenceSpeaker', () => {
  it('assigns a sentence range to a speaker', () => {
    const rules = toggleSentenceSpeaker([], 0, 5, 9, 'alice');
    expect(rules).toEqual([{ kind: 'manual', chapterIndex: 0, start: 5, end: 9, speakerId: 'alice' }]);
  });

  it('re-clicking the same speaker clears the override (toggle off)', () => {
    const assigned = toggleSentenceSpeaker([], 0, 5, 9, 'alice');
    expect(toggleSentenceSpeaker(assigned, 0, 5, 9, 'alice')).toEqual([]);
  });

  it('re-assigns to a different speaker, replacing the range in place', () => {
    const assigned = toggleSentenceSpeaker([], 0, 5, 9, 'alice');
    const reassigned = toggleSentenceSpeaker(assigned, 0, 5, 9, 'bob');
    expect(reassigned).toEqual([{ kind: 'manual', chapterIndex: 0, start: 5, end: 9, speakerId: 'bob' }]);
  });

  it('leaves other rules and ranges untouched', () => {
    const base: VoiceRule[] = [
      { kind: 'pattern', pattern: '^"', speakerId: 'alice' },
      { kind: 'manual', chapterIndex: 0, start: 0, end: 4, speakerId: 'bob' },
    ];
    const out = toggleSentenceSpeaker(base, 0, 5, 9, 'alice');
    expect(out).toHaveLength(3);
    expect(out).toContainEqual(base[0]); // pattern preserved
    expect(out).toContainEqual(base[1]); // other manual range preserved
  });
});
