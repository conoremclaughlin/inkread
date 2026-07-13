import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KokoroTtsController } from './kokoro';

/**
 * The controller's queue/prefetch/guard logic, with the Worker and
 * AudioContext boundaries mocked. The model itself is exercised by manual
 * browser verification; these tests pin the orchestration.
 */

type WorkerMessage = { type: string; [key: string]: unknown };

class MockWorker {
  static instances: MockWorker[] = [];
  posted: WorkerMessage[] = [];
  onmessage: ((event: { data: WorkerMessage }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;

  constructor() {
    MockWorker.instances.push(this);
  }

  postMessage(msg: WorkerMessage): void {
    this.posted.push(msg);
  }

  terminate(): void {}

  /** Test helper: emit a message from the "worker". */
  emit(msg: WorkerMessage): void {
    this.onmessage?.({ data: msg });
  }
}

class MockSourceNode {
  static instances: MockSourceNode[] = [];
  buffer: unknown;
  playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  started = false;
  stopped = false;

  constructor() {
    MockSourceNode.instances.push(this);
  }
  connect(): void {}
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

class MockAudioContext {
  destination = {};
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data, length, sampleRate, duration: length / sampleRate };
  }
  createBufferSource() {
    return new MockSourceNode();
  }
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
}

function lastWorker(): MockWorker {
  return MockWorker.instances[MockWorker.instances.length - 1]!;
}

function emitAudioFor(requestId: number, length = 24000): void {
  lastWorker().emit({
    type: 'audio',
    id: requestId,
    samples: new Float32Array(length),
    samplingRate: 24000,
  });
}

async function readyController(): Promise<KokoroTtsController> {
  const controller = new KokoroTtsController();
  const init = controller.init(() => {});
  lastWorker().emit({ type: 'ready' });
  await init;
  return controller;
}

/** Flush pending microtasks so awaited generation promises settle. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const TEXT = 'First sentence. Second sentence. Third sentence. Fourth sentence. Fifth one.';

beforeEach(() => {
  MockWorker.instances = [];
  MockSourceNode.instances = [];
  vi.stubGlobal('Worker', MockWorker);
  vi.stubGlobal('AudioContext', MockAudioContext);
  vi.stubGlobal('navigator', {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('KokoroTtsController', () => {
  it('reports download progress and resolves init on ready', async () => {
    const controller = new KokoroTtsController();
    const progress: number[] = [];
    const init = controller.init((p) => progress.push(p));
    lastWorker().emit({ type: 'progress', progress: 40 });
    lastWorker().emit({ type: 'progress', progress: 90 });
    lastWorker().emit({ type: 'ready' });
    await init;
    expect(progress).toEqual([40, 90]);
    // Without WebGPU in the environment, the worker is asked for wasm.
    expect(lastWorker().posted[0]).toEqual({ type: 'init', device: 'wasm' });
  });

  it('rejects init when the model fails to load', async () => {
    const controller = new KokoroTtsController();
    const init = controller.init(() => {});
    lastWorker().emit({ type: 'error', message: 'no network' });
    await expect(init).rejects.toThrow('no network');
  });

  it('requests the current sentence plus prefetch on play', async () => {
    const controller = await readyController();
    controller.load(TEXT);
    controller.play();
    await tick();
    const generates = lastWorker().posted.filter((m) => m.type === 'generate');
    expect(generates.map((m) => m.text)).toEqual([
      'Second sentence.',
      'Third sentence.',
      'First sentence.',
    ]);
  });

  it('plays received audio and advances to the next sentence when it ends', async () => {
    const controller = await readyController();
    const seen: number[] = [];
    controller.setListener((status) => seen.push(status.sentenceIndex));
    controller.load(TEXT);
    controller.play();
    await tick();
    const first = lastWorker().posted.find((m) => m.type === 'generate' && m.text === 'First sentence.')!;
    emitAudioFor(first.id as number);
    await tick();

    const source = MockSourceNode.instances[0]!;
    expect(source.started).toBe(true);
    expect(controller.status.sentenceIndex).toBe(0);

    source.onended?.();
    await tick();
    expect(controller.status.sentenceIndex).toBe(1);
    // Second sentence was prefetched, but its audio hasn't arrived yet in
    // this test, so no new source starts until we deliver it.
    const second = lastWorker().posted.find((m) => m.type === 'generate' && m.text === 'Second sentence.')!;
    emitAudioFor(second.id as number);
    await tick();
    expect(MockSourceNode.instances).toHaveLength(2);
    expect(MockSourceNode.instances[1]!.started).toBe(true);
  });

  it('does not resume playback that was stopped mid-generation', async () => {
    const controller = await readyController();
    controller.load(TEXT);
    controller.play();
    await tick();
    controller.stop();
    const first = lastWorker().posted.find((m) => m.type === 'generate' && m.text === 'First sentence.')!;
    emitAudioFor(first.id as number);
    await tick();
    expect(MockSourceNode.instances.every((s) => !s.started)).toBe(true);
    expect(controller.status.playing).toBe(false);
  });

  it('skips sentences whose generation fails instead of halting', async () => {
    const controller = await readyController();
    controller.load(TEXT);
    controller.play();
    await tick();
    const first = lastWorker().posted.find((m) => m.type === 'generate' && m.text === 'First sentence.')!;
    lastWorker().emit({ type: 'generror', id: first.id, message: 'bad phonemes' });
    await tick();
    expect(controller.status.sentenceIndex).toBe(1);
    expect(controller.status.playing).toBe(true);
  });

  it('jumps with next/previous and applies live rate changes', async () => {
    const controller = await readyController();
    controller.load(TEXT);
    controller.play();
    await tick();
    controller.next();
    expect(controller.status.sentenceIndex).toBe(1);
    controller.previous();
    expect(controller.status.sentenceIndex).toBe(0);

    const first = lastWorker().posted.filter((m) => m.type === 'generate' && m.text === 'First sentence.');
    emitAudioFor(first[first.length - 1]!.id as number);
    await tick();
    const playing = MockSourceNode.instances.find((s) => s.started)!;
    controller.setRate(1.5);
    expect(playing.playbackRate.value).toBe(1.5);
  });

  it('resumes from a character offset', async () => {
    const controller = await readyController();
    // Offset inside the third sentence (starts after the first two).
    controller.load(TEXT, TEXT.indexOf('Third') + 2);
    expect(controller.status.sentence?.text).toBe('Third sentence.');
  });
});
