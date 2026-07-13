/**
 * Web Worker that owns the Kokoro TTS model (~90-300MB, fetched once and
 * cached by the browser). Generation runs here so the reader UI never janks.
 *
 * In:  {type:'init', device}              → {type:'progress'…} then {type:'ready'}
 *      {type:'generate', id, text, voice} → {type:'audio', id, samples, samplingRate}
 * Out: {type:'error', message} / {type:'generror', id, message}
 */
import { KokoroTTS } from 'kokoro-js';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

let tts: KokoroTTS | null = null;

interface InitMessage {
  type: 'init';
  device: 'webgpu' | 'wasm';
}
interface GenerateMessage {
  type: 'generate';
  id: number;
  text: string;
  voice: string;
}

self.onmessage = async (event: MessageEvent<InitMessage | GenerateMessage>) => {
  const msg = event.data;

  if (msg.type === 'init') {
    try {
      const files = new Map<string, { loaded: number; total: number }>();
      tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        // WebGPU runs fp32 well; wasm needs the quantized weights to be usable.
        dtype: msg.device === 'webgpu' ? 'fp32' : 'q8',
        device: msg.device,
        progress_callback: (p) => {
          if (p.status === 'progress' && 'file' in p) {
            files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
            let loaded = 0;
            let total = 0;
            for (const f of files.values()) {
              loaded += f.loaded;
              total += f.total;
            }
            if (total > 0) {
              self.postMessage({ type: 'progress', progress: Math.round((loaded / total) * 100) });
            }
          }
        },
      });
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (msg.type === 'generate') {
    if (!tts) {
      self.postMessage({ type: 'generror', id: msg.id, message: 'model not initialized' });
      return;
    }
    try {
      const audio = await tts.generate(msg.text, { voice: msg.voice as never });
      const samples = audio.audio;
      (self as unknown as Worker).postMessage(
        { type: 'audio', id: msg.id, samples, samplingRate: audio.sampling_rate },
        [samples.buffer],
      );
    } catch (error) {
      self.postMessage({
        type: 'generror',
        id: msg.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
