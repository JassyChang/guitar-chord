// Client for the Whisper worker.
export const WHISPER_SAMPLE_RATE = 16000;
export const WHISPER_MODELS = {
  tiny: { id: 'Xenova/whisper-tiny', label: 'Whisper tiny (~40 MB)' },
  base: { id: 'Xenova/whisper-base', label: 'Whisper base (~80 MB)' },
};

let worker = null;

/**
 * @param {Float32Array} signal 16 kHz mono
 * @param {{model:string, language:string}} opts
 * @param {(e:{type:string,p?:number,loaded?:number,total?:number})=>void} onEvent
 * @returns {Promise<{text:string,start:number,end:number}[]>}
 */
export function transcribeLyrics(signal, { model, language }, onEvent) {
  return new Promise((resolve, reject) => {
    if (!worker) worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'done') resolve(data.words);
      else if (data.type === 'error') reject(new Error(data.message));
      else onEvent(data);
    };
    worker.onerror = (e) => {
      worker.terminate();
      worker = null;
      reject(new Error(e.message || 'Could not start the Whisper worker'));
    };
    worker.postMessage({ signal, model: WHISPER_MODELS[model]?.id || model, language });
  });
}
