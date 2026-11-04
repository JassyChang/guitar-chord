// Chord detection (Essentia.js: HPCP -> ChordsDetection) and guitar chord diagrams.

const NOTE_INDEX = {
  C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, F: 5, 'E#': 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
};

// Common shape per root (low E -> high e, -1 = muted)
const SHAPES = {
  maj: [
    [-1, 3, 2, 0, 1, 0], // C
    [-1, 4, 6, 6, 6, 4], // C#
    [-1, -1, 0, 2, 3, 2], // D
    [-1, 6, 8, 8, 8, 6], // Eb
    [0, 2, 2, 1, 0, 0], // E
    [1, 3, 3, 2, 1, 1], // F
    [2, 4, 4, 3, 2, 2], // F#
    [3, 2, 0, 0, 0, 3], // G
    [4, 6, 6, 5, 4, 4], // Ab
    [-1, 0, 2, 2, 2, 0], // A
    [-1, 1, 3, 3, 3, 1], // Bb
    [-1, 2, 4, 4, 4, 2], // B
  ],
  min: [
    [-1, 3, 5, 5, 4, 3], // Cm
    [-1, 4, 6, 6, 5, 4], // C#m
    [-1, -1, 0, 2, 3, 1], // Dm
    [-1, 6, 8, 8, 7, 6], // Ebm
    [0, 2, 2, 0, 0, 0], // Em
    [1, 3, 3, 1, 1, 1], // Fm
    [2, 4, 4, 2, 2, 2], // F#m
    [3, 5, 5, 3, 3, 3], // Gm
    [4, 6, 6, 4, 4, 4], // G#m
    [-1, 0, 2, 2, 1, 0], // Am
    [-1, 1, 3, 3, 2, 1], // Bbm
    [-1, 2, 4, 4, 3, 2], // Bm
  ],
};

/** Parse "C#m" -> { root: 1, quality: 'min' }; null if unknown. */
export function parseChord(name) {
  const m = /^([A-G](?:#|b)?)(m)?$/.exec(name || '');
  if (!m || NOTE_INDEX[m[1]] == null) return null;
  return { root: NOTE_INDEX[m[1]], quality: m[2] ? 'min' : 'maj' };
}

export function chordShape(name) {
  const c = parseChord(name);
  return c ? SHAPES[c.quality][c.root] : null;
}

/** Chord diagram as an SVG string. */
export function chordDiagramSVG(name) {
  const frets = chordShape(name);
  const W = 120;
  const H = 150;
  if (!frets) {
    return `<svg viewBox="0 0 ${W} ${H}" class="chord-svg" role="img" aria-label="${name}"><text x="60" y="80" text-anchor="middle" class="svg-muted">No diagram</text></svg>`;
  }
  const left = 22;
  const top = 34;
  const sGap = 15; // string spacing
  const fGap = 20; // fret spacing
  const nFrets = 5;
  const fretted = frets.filter((f) => f > 0);
  const maxF = fretted.length ? Math.max(...fretted) : 0;
  const minF = fretted.length ? Math.min(...fretted) : 0;
  const base = maxF > nFrets ? minF : 1;
  const right = left + sGap * 5;
  let g = '';
  // frets
  for (let i = 0; i <= nFrets; i++) {
    const y = top + i * fGap;
    const cls = i === 0 && base === 1 ? 'svg-nut' : 'svg-line';
    g += `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="${cls}"/>`;
  }
  // strings
  for (let s = 0; s < 6; s++) {
    const x = left + s * sGap;
    g += `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + nFrets * fGap}" class="svg-line"/>`;
  }
  if (base > 1) {
    g += `<text x="${right + 6}" y="${top + fGap * 0.5 + 4}" class="svg-small">${base}fr</text>`;
  }
  // Barre: no open strings and the lowest fret sits on both outer played strings
  const played = frets.map((f, s) => ({ f, s })).filter((p) => p.f >= 0);
  const hasOpen = played.some((p) => p.f === 0);
  if (!hasOpen && played.length >= 4) {
    const first = played[0];
    const last = played[played.length - 1];
    if (first.f === minF && last.f === minF) {
      const y = top + (minF - base + 0.5) * fGap;
      g += `<rect x="${left + first.s * sGap - 6}" y="${y - 6}" width="${(last.s - first.s) * sGap + 12}" height="12" rx="6" class="svg-dot"/>`;
    }
  }
  frets.forEach((f, s) => {
    const x = left + s * sGap;
    if (f < 0) {
      g += `<text x="${x}" y="${top - 8}" text-anchor="middle" class="svg-small">×</text>`;
    } else if (f === 0) {
      g += `<circle cx="${x}" cy="${top - 12}" r="4" class="svg-open"/>`;
    } else {
      const y = top + (f - base + 0.5) * fGap;
      g += `<circle cx="${x}" cy="${y}" r="6" class="svg-dot"/>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chord-svg" role="img" aria-label="${name} chord diagram">${g}<text x="${(left + right) / 2}" y="${H - 6}" text-anchor="middle" class="svg-small">${frets.map((f) => (f < 0 ? 'x' : f)).join(' ')}</text></svg>`;
}

/** Plain-text shape, e.g. "x32010". */
export function chordShapeText(name) {
  const f = chordShape(name);
  if (!f) return '';
  return f.map((x) => (x < 0 ? 'x' : x > 9 ? `(${x})` : String(x))).join('');
}

let essentiaPromise = null;

/** Lazy-load the Essentia.js WASM build. */
export function loadEssentia() {
  if (!essentiaPromise) {
    essentiaPromise = (async () => {
      const [{ EssentiaWASM }, core] = await Promise.all([
        import('../vendor/essentia/essentia-wasm.es.js'),
        import('../vendor/essentia/essentia.js-core.es.js'),
      ]);
      // Wait for the WASM runtime to finish initialising
      const start = Date.now();
      while (typeof EssentiaWASM.EssentiaJS !== 'function') {
        if (Date.now() - start > 30000) throw new Error('Essentia.js took too long to initialise');
        await new Promise((r) => setTimeout(r, 50));
      }
      const Essentia = core.default;
      return { essentia: new Essentia(EssentiaWASM), wasm: EssentiaWASM };
    })();
    essentiaPromise.catch(() => {
      essentiaPromise = null;
    });
  }
  return essentiaPromise;
}

const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

/**
 * Detect chords.
 * @param {Float32Array} signal mono audio
 * @param {number} sampleRate
 * @param {(p:number)=>void} onProgress 0..1
 * @returns {Promise<{start:number,end:number,chord:string,strength:number}[]>}
 */
export async function detectChords(signal, sampleRate, onProgress = () => {}) {
  const { essentia, wasm } = await loadEssentia();
  const frameSize = 4096;
  const hopSize = 2048;
  const pcp = new wasm.VectorVectorFloat();
  const rms = [];
  const nFrames = Math.max(0, Math.floor((signal.length - frameSize) / hopSize) + 1);
  for (let i = 0; i < nFrames; i++) {
    const frameArr = signal.subarray(i * hopSize, i * hopSize + frameSize);
    let e = 0;
    for (let k = 0; k < frameArr.length; k++) e += frameArr[k] * frameArr[k];
    rms.push(Math.sqrt(e / frameArr.length));

    const frame = essentia.arrayToVector(frameArr);
    const windowed = essentia.Windowing(frame, true, frameSize, 'blackmanharris62').frame;
    const spectrum = essentia.Spectrum(windowed, frameSize).spectrum;
    const peaks = essentia.SpectralPeaks(spectrum, -1000, 5000, 100, 40, 'magnitude', sampleRate);
    const hpcp = essentia.HPCP(
      peaks.frequencies, peaks.magnitudes, true, 500, 8, 5000, false, 40, true,
      'unitMax', 440, sampleRate, 12, 'cosine', 1,
    ).hpcp;
    pcp.push_back(hpcp);
    for (const v of [frame, windowed, spectrum, peaks.frequencies, peaks.magnitudes, hpcp]) {
      v?.delete?.();
    }
    if (i % 40 === 0) {
      onProgress((i / nFrames) * 0.9);
      await yieldToUI();
    }
  }
  if (!nFrames) {
    pcp.delete?.();
    return [];
  }
  const res = essentia.ChordsDetection(pcp, hopSize, sampleRate, 1.5);
  const labels = [];
  const strengths = [];
  for (let i = 0; i < res.chords.size(); i++) {
    labels.push(res.chords.get(i));
    strengths.push(res.strength.get(i));
  }
  res.chords.delete?.();
  res.strength.delete?.();
  pcp.delete?.();
  onProgress(0.95);

  // Silent / weak frames become N (no chord)
  const maxRms = Math.max(...rms, 1e-9);
  for (let i = 0; i < labels.length; i++) {
    if ((rms[i] ?? 0) < maxRms * 0.04 || strengths[i] < 0.2) labels[i] = 'N';
  }

  const frameDur = hopSize / sampleRate;
  const segments = [];
  for (let i = 0; i < labels.length; i++) {
    const t = i * frameDur;
    const last = segments[segments.length - 1];
    if (last && last.chord === labels[i]) {
      last.end = t + frameDur;
      last._s.push(strengths[i]);
    } else {
      segments.push({ start: t, end: t + frameDur, chord: labels[i], _s: [strengths[i]] });
    }
  }
  // Merge very short segments into the previous one
  const minLen = 0.5;
  const merged = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (prev && (seg.end - seg.start < minLen || prev.chord === seg.chord)) {
      prev.end = seg.end;
      prev._s.push(...seg._s);
    } else {
      merged.push({ ...seg, _s: [...seg._s] });
    }
  }
  // Merging can create neighbours with the same chord; merge again
  const out = [];
  for (const seg of merged) {
    const prev = out[out.length - 1];
    if (prev && prev.chord === seg.chord) {
      prev.end = seg.end;
      prev._s.push(...seg._s);
    } else out.push(seg);
  }
  onProgress(1);
  return out
    .filter((s) => s.chord !== 'N')
    .map((s) => ({
      start: s.start,
      end: s.end,
      chord: s.chord,
      strength: s._s.reduce((a, b) => a + b, 0) / s._s.length,
    }));
}
