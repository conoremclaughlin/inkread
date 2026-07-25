import { describe, expect, it } from 'vitest';
import { encodeWav, pcmDurationSeconds } from './wav';

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

describe('encodeWav', () => {
  it('writes a valid RIFF/WAVE header', () => {
    const wav = encodeWav([new Float32Array([0, 0.5, -0.5])], 22050);
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(ascii(wav, 36, 4)).toBe('data');
    const view = new DataView(wav.buffer);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(22050); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits/sample
  });

  it('sizes the buffer as 44-byte header + 2 bytes/sample', () => {
    const wav = encodeWav([new Float32Array(100), new Float32Array(50)], 16000);
    expect(wav.length).toBe(44 + 150 * 2);
    const view = new DataView(wav.buffer);
    expect(view.getUint32(40, true)).toBe(150 * 2); // data chunk size
    expect(view.getUint32(4, true)).toBe(36 + 150 * 2); // RIFF size
  });

  it('concatenates chunks in order', () => {
    const wav = encodeWav([new Float32Array([1]), new Float32Array([-1])], 8000);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(0x7fff); // +1 → max
    expect(view.getInt16(46, true)).toBe(-0x8000); // -1 → min
  });

  it('clamps out-of-range samples', () => {
    const wav = encodeWav([new Float32Array([2, -2])], 8000);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });

  it('produces a header-only file for no audio', () => {
    const wav = encodeWav([], 44100);
    expect(wav.length).toBe(44);
    expect(new DataView(wav.buffer).getUint32(40, true)).toBe(0);
  });
});

describe('pcmDurationSeconds', () => {
  it('computes duration from samples and rate', () => {
    expect(pcmDurationSeconds([new Float32Array(16000), new Float32Array(8000)], 16000)).toBe(1.5);
    expect(pcmDurationSeconds([], 44100)).toBe(0);
    expect(pcmDurationSeconds([new Float32Array(10)], 0)).toBe(0);
  });
});
