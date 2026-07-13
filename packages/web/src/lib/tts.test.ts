import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebTtsController } from './tts';

/** speechSynthesis-backed fallback controller, with the browser API mocked. */

class MockUtterance {
  static instances: MockUtterance[] = [];
  rate = 1;
  voice: unknown;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public text: string) {
    MockUtterance.instances.push(this);
  }
}

const synthesis = {
  spoken: [] as MockUtterance[],
  speak(utterance: MockUtterance) {
    this.spoken.push(utterance);
  },
  cancel: vi.fn(),
  getVoices: () => [] as unknown[],
};

beforeEach(() => {
  MockUtterance.instances = [];
  synthesis.spoken = [];
  synthesis.cancel.mockClear();
  vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);
  vi.stubGlobal('window', { speechSynthesis: synthesis });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const TEXT = 'Alpha one. Beta two. Gamma three.';

describe('WebTtsController', () => {
  it('speaks sentences in order as each finishes', () => {
    const controller = new WebTtsController();
    controller.load(TEXT);
    controller.play();
    expect(synthesis.spoken.map((u) => u.text)).toEqual(['Alpha one.']);
    synthesis.spoken[0]!.onend?.();
    expect(synthesis.spoken.map((u) => u.text)).toEqual(['Alpha one.', 'Beta two.']);
    expect(controller.status.sentenceIndex).toBe(1);
  });

  it('ignores stale onend after stop (generation guard)', () => {
    const controller = new WebTtsController();
    controller.load(TEXT);
    controller.play();
    const first = synthesis.spoken[0]!;
    controller.stop();
    first.onend?.();
    expect(synthesis.spoken).toHaveLength(1);
    expect(controller.status.playing).toBe(false);
  });

  it('starts from a character offset and finishes at the end', () => {
    const controller = new WebTtsController();
    const listener = vi.fn();
    controller.setListener(listener);
    controller.load(TEXT, TEXT.indexOf('Beta') + 1);
    controller.play();
    expect(synthesis.spoken[0]!.text).toBe('Beta two.');
    synthesis.spoken[0]!.onend?.();
    synthesis.spoken[1]!.onend?.();
    expect(controller.status.finished).toBe(true);
    expect(controller.status.playing).toBe(false);
  });

  it('halts on utterance error', () => {
    const controller = new WebTtsController();
    controller.load(TEXT);
    controller.play();
    synthesis.spoken[0]!.onerror?.();
    expect(controller.status.playing).toBe(false);
  });
});
