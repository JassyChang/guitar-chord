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
