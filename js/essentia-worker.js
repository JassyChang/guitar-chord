// Runs Essentia (tempo + chords) off the main thread so the page stays responsive.
import { detectTempo } from './rhythm.js';
import { detectChords, loadEssentia } from './chords.js';

self.onmessage = async ({ data }) => {
  const post = (msg) => self.postMessage(msg);
  try {
    post({ type: 'progress', step: 'tempo', p: 0 });
    await loadEssentia();
    const tempo = await detectTempo(data.rhythmSignal);
    post({ type: 'tempo', tempo });
    const chords = await detectChords(data.chordSignal, data.chordRate, (p) =>
      post({ type: 'progress', step: 'chords', p }),
    );
    post({ type: 'chords', chords });
  } catch (err) {
    post({ type: 'error', message: err?.message || String(err) });
  }
};
