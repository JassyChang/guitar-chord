// Tempo and beat positions with Essentia.js RhythmExtractor2013 (needs 44.1 kHz audio).
import { loadEssentia } from './chords.js';

export const RHYTHM_SAMPLE_RATE = 44100;

/**
 * @param {Float32Array} signal mono, 44.1 kHz
 * @returns {Promise<{bpm:number, confidence:number, beats:number[]}>}
 */
export async function detectTempo(signal) {
  const { essentia } = await loadEssentia();
  const vec = essentia.arrayToVector(signal);
  const r = essentia.RhythmExtractor2013(vec, 208, 'multifeature', 40);
  const beats = [];
  for (let i = 0; i < r.ticks.size(); i++) beats.push(r.ticks.get(i));
  const out = { bpm: r.bpm, confidence: r.confidence, beats };
  for (const v of [vec, r.ticks, r.estimates, r.bpmIntervals]) v?.delete?.();
  return out;
}

/** Essentia's documented confidence ranges for the multifeature method (0 - 5.32). */
export function confidenceLabel(c) {
  if (c > 3.5) return 'Excellent';
  if (c >= 1.5) return 'Good';
  if (c >= 1) return 'Low';
  return 'Very low';
}

/**
 * Strum / note onsets with Essentia SuperFluxExtractor, plus a loudness jump per onset.
 * Weak onsets (pick noise, ringing, decay wobble) are dropped.
 * @param {Float32Array} signal mono, 44.1 kHz
 * @returns {Promise<{time:number, strength:number}[]>}
 */
export async function detectOnsets(signal) {
  const { essentia } = await loadEssentia();
  const sr = RHYTHM_SAMPLE_RATE;
  const vec = essentia.arrayToVector(signal);
  // combine 60 ms: the strings of one strum count as a single hit
  // Sensitive settings (light up-strokes are quiet); weak detections are filtered below
  const r = essentia.SuperFluxExtractor(vec, 60, 2048, 256, 4, sr, 0.01);
  const times = [];
  for (let i = 0; i < r.onsets.size(); i++) times.push(r.onsets.get(i));
  vec.delete?.();
  r.onsets.delete?.();

  const rms = (a, b) => {
    const i0 = Math.max(0, Math.floor(a * sr));
    const i1 = Math.min(signal.length, Math.floor(b * sr));
    let s = 0;
    for (let i = i0; i < i1; i++) s += signal[i] * signal[i];
    return Math.sqrt(s / Math.max(1, i1 - i0));
  };
  const all = times.map((t) => ({ time: t, strength: Math.max(0, rms(t, t + 0.05) - rms(t - 0.06, t - 0.01)) }));
  if (!all.length) return [];
  const sorted = all.map((o) => o.strength).sort((a, b) => a - b);
  const ref = sorted[Math.floor(sorted.length * 0.75)] || 1e-9;
  return all
    .filter((o) => o.strength >= ref * 0.2)
    .map((o) => ({ time: o.time, strength: o.strength / ref }));
}
