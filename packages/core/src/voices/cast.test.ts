import { describe, expect, it } from 'vitest';
import { castChapter, type Speaker, type VoiceCast, type VoiceRule } from './cast';

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
