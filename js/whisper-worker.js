// Lyrics transcription with Whisper (transformers.js) in a module worker.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';

env.allowLocalModels = false;

const CHUNK_S = 30;
const RATE = 16000;
let asr = null;
let loadedModel = '';

self.onmessage = async ({ data }) => {
  const post = (m) => self.postMessage(m);
  try {
    const { signal, model, language } = data;
    if (!asr || loadedModel !== model) {
      const files = new Map();
      asr = await pipeline('automatic-speech-recognition', model, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total) {
            files.set(p.file, { loaded: p.loaded, total: p.total });
            let loaded = 0;
            let total = 0;
            for (const f of files.values()) {
              loaded += f.loaded;
              total += f.total;
            }
            post({ type: 'download', loaded, total });
          }
        },
      });
      loadedModel = model;
    }
    const chunkLen = CHUNK_S * RATE;
    const nChunks = Math.max(1, Math.ceil(signal.length / chunkLen));
    let peak = 0;
    for (let i = 0; i < signal.length; i += 64) peak = Math.max(peak, Math.abs(signal[i]));
    const words = [];
    for (let c = 0; c < nChunks; c++) {
      post({ type: 'progress', p: c / nChunks });
      const chunk = signal.subarray(c * chunkLen, Math.min(signal.length, (c + 1) * chunkLen));
      let e = 0;
      for (let i = 0; i < chunk.length; i += 16) e = Math.max(e, Math.abs(chunk[i]));
      if (chunk.length < RATE || e < peak * 0.05) continue; // skip silence
      // Cap tokens per 30 s window (~2x normal singing) and discourage loops
      const opts = { return_timestamps: 'word', task: 'transcribe', max_new_tokens: 200, repetition_penalty: 1.1 };
      if (language) opts.language = language;
      const out = await asr(chunk, opts);
      const offset = c * CHUNK_S;
      for (const ch of out.chunks || []) {
        const [s, en] = ch.timestamp || [];
        if (s == null) continue;
        words.push({ text: ch.text, start: s + offset, end: (en ?? s + 0.3) + offset });
      }
    }
    post({ type: 'progress', p: 1 });
    post({ type: 'done', words });
  } catch (err) {
    post({ type: 'error', message: err?.message || String(err) });
  }
};
