import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * TtsController queue logic with expo-speech mocked. We capture the onDone /
 * onError callbacks handed to Speech.speak so the test can drive utterance
 * completion deterministically — the same way the OS synthesizer would.
 */

interface SpokenCall {
  text: string;
  onDone?: () => void;
  onError?: () => void;
}
const spoken: SpokenCall[] = [];

vi.mock('expo-speech', () => ({
  speak: (text: string, opts: { onDone?: () => void; onError?: () => void }) => {
    spoken.push({ text, onDone: opts?.onDone, onError: opts?.onError });
  },
  stop: vi.fn(async () => {}),
  getAvailableVoicesAsync: vi.fn(async () => []),
}));

import { TtsController, type TtsStatus } from './TtsController';

/** The reader advances a chapter on exactly this edge — mirror it precisely. */
function isChapterEndEdge(status: TtsStatus): boolean {
  return (
    !status.sentence &&
    status.sentenceIndex >= status.totalSentences &&
    status.totalSentences > 0
  );
}

beforeEach(() => {
  spoken.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

const TEXT = 'Alpha one. Beta two. Gamma three.';

describe('TtsController', () => {
  it('speaks sentences in order as each finishes', () => {
    const controller = new TtsController();
    controller.load(TEXT);
    controller.play();
    expect(spoken.map((s) => s.text)).toEqual(['Alpha one.']);
    spoken[0]!.onDone?.();
    expect(spoken.map((s) => s.text)).toEqual(['Alpha one.', 'Beta two.']);
    expect(controller.status.sentenceIndex).toBe(1);
  });

  it('emits exactly one chapter-end notification when the last sentence ends', () => {
    const controller = new TtsController();
    const edges: number[] = [];
    controller.setListener((status) => {
      if (isChapterEndEdge(status)) edges.push(status.sentenceIndex);
    });
    // One sentence: the first is also the last, so ending it runs off the end —
    // the edge the reader turns into a chapter advance. Two notifications here
    // would advance the reader two chapters at once.
    controller.load('Only sentence.');
    controller.play();
    spoken[0]!.onDone?.();
    expect(edges).toHaveLength(1);
  });

  it('ignores a stale onDone after stop (generation guard)', () => {
    const controller = new TtsController();
    controller.load(TEXT);
    controller.play();
    const first = spoken[0]!;
    controller.stop();
    first.onDone?.();
    expect(spoken).toHaveLength(1);
    expect(controller.status.playing).toBe(false);
  });

  it('halts on utterance error', () => {
    const controller = new TtsController();
    controller.load(TEXT);
    controller.play();
    spoken[0]!.onError?.();
    expect(controller.status.playing).toBe(false);
  });

  it('starts from a character offset', () => {
    const controller = new TtsController();
    controller.load(TEXT, TEXT.indexOf('Beta') + 1);
    controller.play();
    expect(spoken[0]!.text).toBe('Beta two.');
  });
});
