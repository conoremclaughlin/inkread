import { splitSentences } from '../tts/sentences';

/**
 * Multi-voice "casting": attribute a chapter's text to speakers so each line
 * can be read (live or recorded) in a distinct voice — so a listener can tell
 * who's speaking. Pure and offset-based, like the rest of the reader, so it's
 * fully testable and identical across web (the editor) and playback.
 *
 * A cast is built in the web editor two ways, both supported here:
 *   - pattern rules ("grepping"): sentences matching a regex → a speaker
 *     (e.g. quoted dialogue → a character, or a name → its speaker), and
 *   - manual rules: an explicit chapter offset range → a speaker (select-to-
 *     assign in the editor).
 * Manual wins over pattern; anything unclaimed falls to the narrator.
 */

export interface Speaker {
  id: string;
  /** "Narrator", "Alice", … — shown in the editor and (optionally) the reader. */
  name: string;
  /** Platform TTS voice identifier (expo-speech / speechSynthesis / server voice). */
  voiceId: string;
}

export type VoiceRule =
  | { kind: 'manual'; chapterIndex: number; start: number; end: number; speakerId: string }
  | { kind: 'pattern'; pattern: string; flags?: string; speakerId: string };

export interface VoiceCast {
  bookId: string;
  speakers: Speaker[];
  rules: VoiceRule[];
  /** Speaker used for any line no rule claims (the narrator). */
  defaultSpeakerId: string;
}

/** One contiguous run of a chapter attributed to a single speaker. */
export interface AttributedSegment {
  text: string;
  start: number;
  end: number;
  speakerId: string;
  /** Resolved from the cast's speakers; undefined if the speaker is missing. */
  voiceId?: string;
}

type ManualRule = Extract<VoiceRule, { kind: 'manual' }>;
interface CompiledPattern {
  re: RegExp;
  speakerId: string;
}

/**
 * One sentence attributed to a speaker (unmerged). The editor renders these as
 * a clickable, colour-coded list — click a sentence to override its speaker.
 */
export interface AttributedSentence {
  text: string;
  start: number;
  end: number;
  speakerId: string;
  voiceId?: string;
}

/**
 * Per-sentence attribution for a chapter: manual range → pattern → narrator.
 * `paragraphs.join('\n')` matches the reader's offset convention, so manual
 * ranges line up with annotation offsets.
 */
export function attributeSentences(
  paragraphs: string[],
  chapterIndex: number,
  cast: VoiceCast,
): AttributedSentence[] {
  const text = paragraphs.join('\n');
  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];

  const manual = cast.rules.filter(
    (rule): rule is ManualRule => rule.kind === 'manual' && rule.chapterIndex === chapterIndex,
  );
  const patterns: CompiledPattern[] = [];
  for (const rule of cast.rules) {
    if (rule.kind !== 'pattern') continue;
    try {
      // Strip the global flag — test() would otherwise be stateful across lines.
      patterns.push({
        re: new RegExp(rule.pattern, (rule.flags ?? '').replace(/g/g, '')),
        speakerId: rule.speakerId,
      });
    } catch {
      // Skip a malformed pattern rather than break the whole cast.
    }
  }
  const voiceById = new Map(cast.speakers.map((speaker) => [speaker.id, speaker.voiceId]));

  const speakerFor = (sentence: { text: string; start: number }): string => {
    for (const rule of manual) {
      if (sentence.start >= rule.start && sentence.start < rule.end) return rule.speakerId;
    }
    for (const pattern of patterns) {
      if (pattern.re.test(sentence.text)) return pattern.speakerId;
    }
    return cast.defaultSpeakerId;
  };

  return sentences.map((sentence) => {
    const speakerId = speakerFor(sentence);
    return {
      text: sentence.text,
      start: sentence.start,
      end: sentence.end,
      speakerId,
      voiceId: voiceById.get(speakerId),
    };
  });
}

/**
 * Attribute a chapter and merge adjacent same-speaker sentences into segments —
 * the "script" real-time playback and recording consume.
 */
export function castChapter(
  paragraphs: string[],
  chapterIndex: number,
  cast: VoiceCast,
): AttributedSegment[] {
  const text = paragraphs.join('\n');
  const segments: AttributedSegment[] = [];
  for (const sentence of attributeSentences(paragraphs, chapterIndex, cast)) {
    const last = segments[segments.length - 1];
    if (last && last.speakerId === sentence.speakerId) {
      last.end = sentence.end;
      last.text = text.slice(last.start, sentence.end);
    } else {
      segments.push({ ...sentence });
    }
  }
  return segments;
}

/**
 * Editor helper: toggle a sentence's manual speaker override. Clicking a
 * sentence already assigned to `speakerId` clears the override (reverting to
 * pattern/narrator); otherwise it (re)assigns that exact range to `speakerId`.
 * Pure so the editor's core edit is unit-testable.
 */
export function toggleSentenceSpeaker(
  rules: VoiceRule[],
  chapterIndex: number,
  start: number,
  end: number,
  speakerId: string,
): VoiceRule[] {
  const isSame = (rule: VoiceRule): boolean =>
    rule.kind === 'manual' &&
    rule.chapterIndex === chapterIndex &&
    rule.start === start &&
    rule.end === end;
  const existing = rules.find(isSame) as ManualRule | undefined;
  const without = rules.filter((rule) => !isSame(rule));
  if (existing && existing.speakerId === speakerId) return without; // toggle off
  return [...without, { kind: 'manual', chapterIndex, start, end, speakerId }];
}
