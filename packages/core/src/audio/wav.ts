/**
 * Encode mono Float32 PCM chunks as a 16-bit PCM WAV byte array.
 *
 * The recordable-audio core for multi-voice recordings: synthesize each cast
 * segment to PCM (e.g. via the app's neural TTS), concatenate the chunks here,
 * then upload/store the bytes and register a chapter_recordings row. Pure and
 * dependency-free, so the audio assembly is unit-testable without a browser.
 */
export function encodeWav(chunks: Float32Array[], sampleRate: number): Uint8Array {
  const samples = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const dataBytes = samples * 2; // 16-bit mono
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string): void => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  // RIFF / WAVE container.
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, 'WAVE');
  // fmt chunk (PCM).
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate = rate * channels * bytesPerSample
  view.setUint16(32, 2, true); // block align = channels * bytesPerSample
  view.setUint16(34, 16, true); // bits per sample
  // data chunk.
  writeString(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const clamped = Math.max(-1, Math.min(1, chunk[i]!));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}

/** Total duration (seconds) of the PCM chunks at a sample rate. */
export function pcmDurationSeconds(chunks: Float32Array[], sampleRate: number): number {
  if (sampleRate <= 0) return 0;
  return chunks.reduce((n, chunk) => n + chunk.length, 0) / sampleRate;
}
