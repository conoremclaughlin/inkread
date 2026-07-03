import { splitSentences, type Sentence } from '@inkread/core';

export interface WebTtsStatus {
  playing: boolean;
  sentence?: Sentence;
  sentenceIndex: number;
  totalSentences: number;
  finished: boolean;
}

/**
 * Sentence-queue TTS over the browser speechSynthesis API — the web twin of
 * the mobile TtsController, sharing core's sentence splitter so the reader
 * can highlight the sentence being spoken.
 */
export class WebTtsController {
  private sentences: Sentence[] = [];
  private index = 0;
  private playing = false;
  private rate = 1.0;
  private listener?: (status: WebTtsStatus) => void;
  private generation = 0;

  setListener(listener: ((status: WebTtsStatus) => void) | undefined): void {
    this.listener = listener;
  }

  load(text: string, startOffset = 0): void {
    this.stop();
    this.sentences = splitSentences(text);
    const index = this.sentences.findIndex((s) => s.end > startOffset);
    this.index = index === -1 ? 0 : index;
    this.notify();
  }

  setRate(rate: number): void {
    this.rate = rate;
    if (this.playing) {
      this.cancelSpeech();
      this.speakCurrent();
    }
  }

  getRate(): number {
    return this.rate;
  }

  get status(): WebTtsStatus {
    return {
      playing: this.playing,
      sentence: this.sentences[this.index],
      sentenceIndex: this.index,
      totalSentences: this.sentences.length,
      finished: this.index >= this.sentences.length,
    };
  }

  play(): void {
    if (this.sentences.length === 0) return;
    this.playing = true;
    this.speakCurrent();
    this.notify();
  }

  stop(): void {
    this.playing = false;
    this.cancelSpeech();
    this.notify();
  }

  next(): void {
    this.jumpTo(this.index + 1);
  }

  previous(): void {
    this.jumpTo(this.index - 1);
  }

  private jumpTo(index: number): void {
    if (index < 0 || index >= this.sentences.length) return;
    this.cancelSpeech();
    this.index = index;
    if (this.playing) this.speakCurrent();
    this.notify();
  }

  private cancelSpeech(): void {
    this.generation += 1;
    window.speechSynthesis.cancel();
  }

  private speakCurrent(): void {
    const sentence = this.sentences[this.index];
    if (!sentence) {
      this.playing = false;
      this.notify();
      return;
    }
    const generation = this.generation;
    const utterance = new SpeechSynthesisUtterance(sentence.text);
    utterance.rate = this.rate;
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.onend = () => {
      if (generation !== this.generation || !this.playing) return;
      this.index += 1;
      this.speakCurrent();
      this.notify();
    };
    utterance.onerror = () => {
      if (generation !== this.generation) return;
      this.playing = false;
      this.notify();
    };
    window.speechSynthesis.speak(utterance);
  }

  private notify(): void {
    this.listener?.(this.status);
  }
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const english = voices.filter((v) => v.lang.startsWith('en'));
  const pool = english.length > 0 ? english : voices;
  return (
    pool.find((v) => /premium|enhanced|natural/i.test(v.name)) ??
    pool.find((v) => v.localService) ??
    pool[0]
  );
}
