import { splitSentences, type Sentence } from '@inkread/core';
import type { WebTtsStatus } from '../tts';

/**
 * Neural TTS over Kokoro-82M running locally in a Web Worker. Same surface
 * as WebTtsController so the reader can treat engines interchangeably.
 * Sentences are synthesized ahead of playback (current + next two) so page
 * turns feel gapless after the first utterance.
 */

export const KOKORO_DEFAULT_VOICE = 'af_heart';
const PREFETCH_AHEAD = 2;

interface PendingGeneration {
  resolve: (buffer: AudioBuffer) => void;
  reject: (error: Error) => void;
}

export class KokoroTtsController {
  private worker?: Worker;
  private audioContext?: AudioContext;
  private source?: AudioBufferSourceNode;
  private sentences: Sentence[] = [];
  private buffers = new Map<number, AudioBuffer>();
  private pending = new Map<number, PendingGeneration>();
  private requests = new Map<number, number>();
  private nextRequestId = 1;
  private index = 0;
  private playing = false;
  private rate = 1.0;
  private voice = KOKORO_DEFAULT_VOICE;
  private generation = 0;
  private listener?: (status: WebTtsStatus) => void;

  /** Load the model; resolves when ready. Progress is 0-100. */
  async init(onProgress: (progress: number) => void): Promise<void> {
    const device = 'gpu' in navigator && navigator.gpu ? 'webgpu' : 'wasm';
    this.worker = new Worker(new URL('./kokoro-worker.ts', import.meta.url));
    this.audioContext = new AudioContext();

    await new Promise<void>((resolve, reject) => {
      this.worker!.onmessage = (event) => {
        const msg = event.data as { type: string; [key: string]: unknown };
        if (msg.type === 'progress') onProgress(Number(msg.progress));
        else if (msg.type === 'ready') resolve();
        else if (msg.type === 'error') reject(new Error(String(msg.message)));
      };
      this.worker!.onerror = (event) => reject(new Error(event.message || 'worker failed'));
      this.worker!.postMessage({ type: 'init', device });
    });

    // Steady-state message handling after init.
    this.worker.onmessage = (event) => {
      const msg = event.data as {
        type: string;
        id?: number;
        samples?: Float32Array;
        samplingRate?: number;
        message?: string;
      };
      if (msg.type !== 'audio' && msg.type !== 'generror') return;
      const sentenceIndex = this.requests.get(msg.id!);
      this.requests.delete(msg.id!);
      if (sentenceIndex === undefined) return;
      const pending = this.pending.get(sentenceIndex);
      this.pending.delete(sentenceIndex);
      if (msg.type === 'generror') {
        pending?.reject(new Error(msg.message ?? 'generation failed'));
        return;
      }
      const buffer = this.audioContext!.createBuffer(1, msg.samples!.length, msg.samplingRate!);
      buffer.getChannelData(0).set(msg.samples!);
      this.buffers.set(sentenceIndex, buffer);
      pending?.resolve(buffer);
    };
  }

  destroy(): void {
    this.stop();
    this.worker?.terminate();
    void this.audioContext?.close();
  }

  setListener(listener: ((status: WebTtsStatus) => void) | undefined): void {
    this.listener = listener;
  }

  setVoice(voice: string): void {
    if (voice === this.voice) return;
    this.voice = voice;
    this.buffers.clear();
    if (this.playing) {
      this.generation += 1;
      this.stopSource();
      void this.speakCurrent();
    }
  }

  getVoice(): string {
    return this.voice;
  }

  load(text: string, startOffset = 0): void {
    // Cancel in-flight audio without stop()'s notify: at a chapter end the old
    // index is past-the-end, so that notify would masquerade as a fresh
    // "finished" event and advance the chapter a second time. Swap the queue in
    // first, then emit exactly one clean status for the new chapter.
    this.generation += 1;
    this.playing = false;
    this.stopSource();
    this.sentences = splitSentences(text);
    this.buffers.clear();
    const index = this.sentences.findIndex((s) => s.end > startOffset);
    this.index = index === -1 ? 0 : index;
    // Pre-synthesize the first sentence so pressing play is near-instant.
    void this.requestBuffer(this.index)?.catch(() => undefined);
    this.notify();
  }

  setRate(rate: number): void {
    this.rate = rate;
    if (this.source) this.source.playbackRate.value = rate;
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
    if (this.sentences.length === 0 || this.playing) return;
    this.playing = true;
    void this.speakCurrent();
    this.notify();
  }

  stop(): void {
    this.generation += 1;
    this.playing = false;
    this.stopSource();
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
    this.generation += 1;
    this.stopSource();
    this.index = index;
    if (this.playing) void this.speakCurrent();
    this.notify();
  }

  private stopSource(): void {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        // already stopped
      }
      this.source = undefined;
    }
  }

  private requestBuffer(index: number): Promise<AudioBuffer> | undefined {
    const sentence = this.sentences[index];
    if (!sentence || !this.worker) return undefined;
    const cached = this.buffers.get(index);
    if (cached) return Promise.resolve(cached);
    const existing = this.pending.get(index);
    if (existing) {
      return new Promise((resolve, reject) => {
        const prior = this.pending.get(index)!;
        this.pending.set(index, {
          resolve: (b) => {
            prior.resolve(b);
            resolve(b);
          },
          reject: (e) => {
            prior.reject(e);
            reject(e);
          },
        });
      });
    }
    const id = this.nextRequestId++;
    this.requests.set(id, index);
    const promise = new Promise<AudioBuffer>((resolve, reject) => {
      this.pending.set(index, { resolve, reject });
    });
    this.worker.postMessage({ type: 'generate', id, text: sentence.text, voice: this.voice });
    return promise;
  }

  private async speakCurrent(): Promise<void> {
    const sentence = this.sentences[this.index];
    if (!sentence) {
      this.playing = false;
      this.notify();
      return;
    }
    const generation = this.generation;
    // Kick off prefetch for upcoming sentences alongside the current one.
    for (let ahead = 1; ahead <= PREFETCH_AHEAD; ahead++) {
      void this.requestBuffer(this.index + ahead)?.catch(() => undefined);
    }
    let buffer: AudioBuffer;
    try {
      const request = this.requestBuffer(this.index);
      if (!request) return;
      buffer = await request;
    } catch {
      // Skip unspeakable sentences rather than halting the whole chapter.
      if (generation !== this.generation || !this.playing) return;
      this.index += 1;
      void this.speakCurrent();
      return;
    }
    if (generation !== this.generation || !this.playing) return;

    await this.audioContext!.resume();
    const source = this.audioContext!.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this.rate;
    source.connect(this.audioContext!.destination);
    source.onended = () => {
      if (generation !== this.generation || !this.playing) return;
      // Free memory behind us; long chapters would otherwise accumulate PCM.
      this.buffers.delete(this.index - 2);
      this.index += 1;
      // Reflect the advance immediately while the next buffer loads. When we
      // run off the end, speakCurrent's terminal branch is the *sole* notifier
      // so the chapter-advance edge (finished, no sentence) fires exactly once
      // — otherwise a functional setChapterIndex would advance twice.
      if (this.index < this.sentences.length) this.notify();
      void this.speakCurrent();
    };
    this.source = source;
    source.start();
    this.notify();
  }

  private notify(): void {
    this.listener?.(this.status);
  }
}
