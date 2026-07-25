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
 * Attribute one chapter's sentences to speakers, merging adjacent same-speaker
 * sentences into segments. `paragraphs.join('\n')` matches the reader's offset
 * convention, so manual ranges line up with annotation offsets.
 */
export function castChapter(
  paragraphs: string[],
  chapterIndex: number,
  cast: VoiceCast,
): AttributedSegment[] {
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

  const segments: AttributedSegment[] = [];
  for (const sentence of sentences) {
    const speakerId = speakerFor(sentence);
    const last = segments[segments.length - 1];
    if (last && last.speakerId === speakerId) {
      last.end = sentence.end;
      last.text = text.slice(last.start, sentence.end);
    } else {
      segments.push({
        text: sentence.text,
        start: sentence.start,
        end: sentence.end,
        speakerId,
        voiceId: voiceById.get(speakerId),
      });
    }
  }
  return segments;
}
