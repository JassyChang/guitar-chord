// Run tempo, onset and chord detection in a module worker; fall back to the main thread.
import { detectTempo, detectOnsets } from './rhythm.js';
import { detectChords } from './chords.js';

/**
 * @param {{rhythmSignal:Float32Array, chordSignal:Float32Array, chordRate:number}} input
 * @param {{onProgress:(step:string,p:number)=>void, onTempo:(t)=>void, onOnsets:(o)=>void}} cb
 * @returns {Promise<{tempo, onsets, chords}>}
 */
export function analyzeWithEssentia(input, cb) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./essentia-worker.js', import.meta.url), { type: 'module' });
    } catch {
      return mainThread(input, cb).then(resolve, reject);
    }
    let tempo = null;
    let onsets = [];
    let started = false;
    worker.onmessage = ({ data }) => {
      started = true;
      if (data.type === 'progress') cb.onProgress(data.step, data.p);
      else if (data.type === 'tempo') {
        tempo = data.tempo;
        cb.onTempo(tempo);
      } else if (data.type === 'onsets') {
        onsets = data.onsets;
        cb.onOnsets(onsets);
      } else if (data.type === 'chords') {
        worker.terminate();
        resolve({ tempo, onsets, chords: data.chords });
      } else if (data.type === 'error') {
        worker.terminate();
        reject(new Error(data.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      // Module workers unsupported or failed to load: retry on the main thread
      if (!started) mainThread(input, cb).then(resolve, reject);
      else reject(new Error(e.message || 'Essentia worker failed'));
    };
    // Copies (not transfers) so the caller keeps its buffers
    worker.postMessage(input);
  });
}

async function mainThread(input, cb) {
  cb.onProgress('tempo', 0);
  await new Promise((r) => setTimeout(r, 30));
  const tempo = await detectTempo(input.rhythmSignal);
  cb.onTempo(tempo);
  const onsets = await detectOnsets(input.rhythmSignal);
  cb.onOnsets(onsets);
  const chords = await detectChords(input.chordSignal, input.chordRate, (p) => cb.onProgress('chords', p));
  return { tempo, onsets, chords };
}
