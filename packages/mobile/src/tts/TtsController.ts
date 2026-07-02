import * as Speech from 'expo-speech';
import { splitSentences, type Sentence } from '@inkread/core';

export interface TtsStatus {
  playing: boolean;
  sentenceIndex: number;
  sentence?: Sentence;
  totalSentences: number;
}

export type TtsListener = (status: TtsStatus) => void;

/**
 * Sentence-queue TTS over expo-speech (AVSpeechSynthesizer on iOS).
 * Speaks one sentence at a time so we can track and highlight progress;
 * the small utterance gap is barely audible with the enhanced voices.
 */
export class TtsController {
  private sentences: Sentence[] = [];
  private index = 0;
  private playing = false;
  private voice?: string;
  private rate = 1.0;
  private listener?: TtsListener;
  /** Guards against stale onDone callbacks after a stop/jump. */
  private generation = 0;

  setListener(listener: TtsListener | undefined): void {
    this.listener = listener;
  }

  load(chapterText: string, startOffset = 0): void {
    this.stop();
    this.sentences = splitSentences(chapterText);
    this.index = Math.max(
      0,
      this.sentences.findIndex((s) => s.end > startOffset),
    );
    this.notify();
  }

  setVoice(voice: string | undefined): void {
    this.voice = voice;
    if (this.playing) this.restartCurrent();
  }

  setRate(rate: number): void {
    this.rate = rate;
    if (this.playing) this.restartCurrent();
  }

  getRate(): number {
    return this.rate;
  }

  get status(): TtsStatus {
    return {
      playing: this.playing,
      sentenceIndex: this.index,
      sentence: this.sentences[this.index],
      totalSentences: this.sentences.length,
    };
  }

  play(): void {
    if (this.sentences.length === 0) return;
    this.playing = true;
    this.speakCurrent();
    this.notify();
  }

  stop(): void {
    this.generation += 1;
    this.playing = false;
    void Speech.stop();
    this.notify();
  }

  next(): void {
    this.jumpTo(this.index + 1);
  }

  previous(): void {
    this.jumpTo(this.index - 1);
  }

  jumpTo(index: number): void {
    if (index < 0 || index >= this.sentences.length) return;
    this.generation += 1;
    void Speech.stop();
    this.index = index;
    if (this.playing) this.speakCurrent();
    this.notify();
  }

  /** True when the queue ran to the end of the chapter. */
  get finished(): boolean {
    return this.index >= this.sentences.length;
  }

  private restartCurrent(): void {
    this.generation += 1;
    void Speech.stop();
    this.speakCurrent();
  }

  private speakCurrent(): void {
    const sentence = this.sentences[this.index];
    if (!sentence) {
      this.playing = false;
      this.notify();
      return;
    }
    const generation = this.generation;
    Speech.speak(sentence.text, {
      voice: this.voice,
      rate: this.rate,
      onDone: () => {
        if (generation !== this.generation || !this.playing) return;
        this.index += 1;
        this.speakCurrent();
        this.notify();
      },
      onError: () => {
        if (generation !== this.generation) return;
        this.playing = false;
        this.notify();
      },
    });
  }

  private notify(): void {
    this.listener?.(this.status);
  }
}

/** Prefer the enhanced/premium on-device voices for the book's language. */
export async function pickBestVoice(language = 'en'): Promise<Speech.Voice | undefined> {
  const voices = await Speech.getAvailableVoicesAsync();
  const forLanguage = voices.filter((v) => v.language?.toLowerCase().startsWith(language));
  const pool = forLanguage.length > 0 ? forLanguage : voices;
  const premium = pool.find((v) => /premium/i.test(v.quality ?? '') || /premium/i.test(v.identifier));
  if (premium) return premium;
  const enhanced = pool.find((v) => /enhanced/i.test(v.quality ?? '') || /enhanced/i.test(v.identifier));
  return enhanced ?? pool[0];
}
