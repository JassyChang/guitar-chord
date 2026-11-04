// Strumming patterns: detection from onsets + beat grid, presets, editing, text output.
// Pure logic, no DOM; testable in Node.
//
// A pattern is { beats, sub, slots: [{ dir: 'D' | 'U' | null, accent: boolean }] }
// with beats * sub slots per measure. Hand-motion rule: even slots are down-strokes
// (on the beat / on "&" in 16ths), odd slots are up-strokes.

export const ARROW = { D: '↓', U: '↑' };

/** Strum resolution for "8th notes" in a time signature (6/8 counts eighths as beats). */
export const eighthSub = (beatsPerBar) => (beatsPerBar === 6 ? 1 : 2);

export const PRESETS = [
  { id: 'folk', name: 'Folk / pop  D-DU-UDU', beats: 4, sub: 2, pattern: 'D.DU.UDU' },
  { id: 'downs', name: 'Quarter downs  D-D-D-D', beats: 4, sub: 2, pattern: 'D.D.D.D.' },
  { id: 'eighths', name: 'Straight 8ths  DUDUDUDU', beats: 4, sub: 2, pattern: 'DUDUDUDU' },
  { id: 'rock', name: 'Rock 8ths (all down)', beats: 4, sub: 2, pattern: 'DDDDDDDD', accents: '>...>...' },
  { id: 'reggae', name: 'Reggae offbeat  -U-U-U-U', beats: 4, sub: 2, pattern: '.U.U.U.U' },
  { id: 'ballad', name: 'Pop ballad  D--U-UDU', beats: 4, sub: 2, pattern: 'D..U.UDU' },
  { id: 'sixteen', name: '16th groove  D-DU-UDU x2', beats: 4, sub: 4, pattern: 'D.DU.UDUD.DU.UDU' },
  { id: 'waltz', name: '3/4 waltz  D-DUDU', beats: 3, sub: 2, pattern: 'D.DUDU', accents: '>.....' },
  { id: 'six8', name: '6/8 ballad  D-D-U-D-D-U', beats: 6, sub: 1, pattern: 'DDUDDU', accents: '>..>..' },
];

/** 'D.DU' + accents '>...' -> pattern object */
export function patternFromString(str, beats, sub, accents = '') {
  return {
    beats,
    sub,
    slots: [...str].map((c, i) => ({
      dir: c === 'D' ? 'D' : c === 'U' ? 'U' : null,
      accent: accents[i] === '>',
    })),
  };
}

export const presetPattern = (p) => patternFromString(p.pattern, p.beats, p.sub, p.accents);

/** Direction-only key, e.g. 'D.DU.UDU'. */
export const patternKey = (p) => (p ? p.slots.map((s) => s.dir || '.').join('') : '');

/** Count labels: sub 1 -> 1 2 3, sub 2 -> 1 & 2 &, sub 4 -> 1 e & a. */
export function slotLabels(beats, sub) {
  const names = sub === 4 ? ['', 'e', '&', 'a'] : sub === 2 ? ['', '&'] : [''];
  const out = [];
  for (let b = 1; b <= beats; b++) for (let j = 0; j < sub; j++) out.push(j === 0 ? String(b) : names[j]);
  return out;
}

/** Tap cycle: ↓ -> ↑ -> rest -> ↓. */
export function cycleSlot(p, i) {
  const next = { D: 'U', U: null, null: 'D' };
  return { ...p, slots: p.slots.map((s, k) => (k === i ? { ...s, dir: next[s.dir] } : s)) };
}

export function toggleAccent(p, i) {
  return { ...p, slots: p.slots.map((s, k) => (k === i ? { ...s, accent: !s.accent } : s)) };
}

const hamming = (a, b) => {
  let d = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d;
};

/** The key that is closest (Hamming) to all others: the "typical" pattern. */
function medoid(keys) {
  if (!keys.length) return null;
  const counts = new Map();
  for (const k of keys) counts.set(k, (counts.get(k) || 0) + 1);
  let best = null;
  let bestCost = Infinity;
  for (const cand of counts.keys()) {
    let cost = 0;
    for (const [k, n] of counts) cost += hamming(cand, k) * n;
    // tie-break: more frequent wins
    cost -= counts.get(cand) * 1e-3;
    if (cost < bestCost) {
      bestCost = cost;
      best = cand;
    }
  }
  return best;
}

function beatIndexAt(grid, t) {
  let lo = 0;
  let hi = grid.length - 2;
  if (t < grid[0] || t >= grid[grid.length - 1]) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (grid[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Detect the strumming pattern(s).
 * @param {object} o
 * @param {{time:number,strength:number}[]} o.onsets
 * @param {number[]} o.grid beat grid
 * @param {{beats:number[],start:number,end:number}[]} o.measures
 * @param {number} o.beatsPerBar
 * @param {number} [o.tempoConfidence] Essentia confidence 0..5.32
 */
export function detectStrumming({ onsets, grid, measures, beatsPerBar, tempoConfidence = 0 }) {
  const bpb = beatsPerBar;
  const sub8 = eighthSub(bpb);
  const sub16 = sub8 * 2;
  const valid = onsets.filter((o) => beatIndexAt(grid, o.time) >= 0);
  if (valid.length < 4) return null;

  // 1. 8ths or 16ths? Count hits that sit clearly between 8th positions.
  let between = 0;
  for (const o of valid) {
    const b = beatIndexAt(grid, o.time);
    const x = ((o.time - grid[b]) / (grid[b + 1] - grid[b])) * sub16;
    const r = Math.round(x);
    if (Math.abs(x - r) < 0.25 && r % 2 === 1) between++;
  }
  const sub = between / valid.length >= 0.2 ? sub16 : sub8;
  const L = bpb * sub;

  // 2. Beat -> (measure, beat-in-measure); only full measures are used
  const beatPos = new Map();
  measures.forEach((m, mi) => {
    if (m.beats.length === bpb) m.beats.forEach((b, k) => beatPos.set(b, { mi, k }));
  });

  // 3. Snap onsets into measure slots (strongest hit per slot)
  const strength = new Map(); // mi -> Float32Array(L)
  let aligned = 0;
  let errSum = 0;
  for (const o of valid) {
    let b = beatIndexAt(grid, o.time);
    const x = ((o.time - grid[b]) / (grid[b + 1] - grid[b])) * sub;
    let r = Math.round(x);
    const err = Math.abs(x - r);
    if (err > 0.35) continue;
    aligned++;
    errSum += err;
    if (r === sub) {
      b += 1;
      r = 0;
    }
    const pos = beatPos.get(b);
    if (!pos) continue;
    if (!strength.has(pos.mi)) strength.set(pos.mi, new Float32Array(L));
    const arr = strength.get(pos.mi);
    const slot = pos.k * sub + r;
    arr[slot] = Math.max(arr[slot], o.strength || 1);
  }

  const keyOf = (arr) => [...arr].map((v, i) => (v > 0 ? (i % 2 === 0 ? 'D' : 'U') : '.')).join('');
  const perMeasure = new Map(); // mi -> key
  for (const [mi, arr] of strength) {
    if (arr.filter((v) => v > 0).length >= 2) perMeasure.set(mi, keyOf(arr));
  }
  if (perMeasure.size < 2) return null;

  // 4. Main pattern = most typical measure, refined by a per-slot vote so a few
  //    missed (quiet) up-strokes don't drop a slot from the pattern
  const tol = Math.max(1, Math.round(L * 0.15));
  const vote = (idxs, around) => {
    const members = idxs.filter((i) => perMeasure.has(i) && (!around || hamming(perMeasure.get(i), around) <= tol + 1));
    if (members.length < 2) return around;
    const hits = new Array(L).fill(0);
    for (const i of members) [...perMeasure.get(i)].forEach((c, k) => c !== '.' && hits[k]++);
    return hits.map((h, k) => (h / members.length >= 0.4 ? (k % 2 === 0 ? 'D' : 'U') : '.')).join('');
  };
  const mainKey = vote([...perMeasure.keys()], medoid([...perMeasure.values()]));

  // 5. Sections: 4-bar phrases whose typical pattern differs from the main one
  const fullIdx = measures.map((m, i) => (m.beats.length === bpb ? i : -1)).filter((i) => i >= 0);
  const windows = [];
  for (let w = 0; w < fullIdx.length; w += 4) {
    const idx = fullIdx.slice(w, w + 4);
    const keys = idx.map((i) => perMeasure.get(i)).filter(Boolean);
    const k = keys.length >= 2 ? medoid(keys) : null;
    windows.push({ idx, key: k, differs: k != null && hamming(k, mainKey) > tol });
  }
  const minWindows = windows.length < 6 ? 1 : 2;
  const groups = [];
  for (const w of windows) {
    const last = groups[groups.length - 1];
    if (w.differs && last && last.open && hamming(last.key, w.key) <= tol) {
      last.windows.push(w);
    } else if (w.differs) {
      groups.push({ key: w.key, windows: [w], open: true });
    } else if (last) last.open = false;
  }
  const sections = groups
    .filter((g) => g.windows.length >= minWindows)
    .map((g) => {
      const idx = g.windows.flatMap((w) => w.idx);
      const key = vote(idx, medoid(idx.map((i) => perMeasure.get(i)).filter(Boolean)));
      return { start: measures[idx[0]].start, end: measures[idx[idx.length - 1]].end, idx, key };
    })
    .filter((s) => s.key && hamming(s.key, mainKey) > tol);

  // 6. Accents: slots that are clearly louder than the measure's typical hit
  const accentsFor = (key, idxs) => {
    const sum = new Float32Array(L);
    const cnt = new Float32Array(L);
    for (const mi of idxs) {
      const arr = strength.get(mi);
      const k = perMeasure.get(mi);
      if (!arr || !k || hamming(k, key) > tol) continue;
      const hits = [...arr].filter((v) => v > 0).sort((a, b) => a - b);
      const med = hits[Math.floor(hits.length / 2)] || 1;
      for (let i = 0; i < L; i++) if (arr[i] > 0) {
        sum[i] += arr[i] / med;
        cnt[i]++;
      }
    }
    return [...key].map((c, i) => (c !== '.' && cnt[i] >= 2 && sum[i] / cnt[i] >= 1.4 ? '>' : '.')).join('');
  };
  const sectionIdx = new Set(sections.flatMap((s) => s.idx));
  const mainIdx = [...perMeasure.keys()].filter((i) => !sectionIdx.has(i));

  // 7. Confidence
  let consistent = 0;
  for (const [mi, k] of perMeasure) {
    const sec = sections.find((s) => s.idx.includes(mi));
    if (hamming(k, sec ? sec.key : mainKey) <= tol) consistent++;
  }
  const consistency = consistent / perMeasure.size;
  const alignment = aligned ? (aligned / valid.length) * (1 - errSum / aligned / 0.35) : 0;
  const tempoScore = Math.min(1, tempoConfidence / 3.5);
  let confidence = 0.45 * consistency + 0.35 * alignment + 0.2 * tempoScore;
  if (perMeasure.size < 4) confidence *= 0.6;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    sub,
    confidence,
    label: confidence >= 0.6 ? 'Detected' : 'Suggested',
    main: patternFromString(mainKey, bpb, sub, accentsFor(mainKey, mainIdx)),
    sections: sections.map((s) => ({
      start: s.start,
      end: s.end,
      pattern: patternFromString(s.key, bpb, sub, accentsFor(s.key, s.idx)),
    })),
    measuresUsed: perMeasure.size,
  };
}

/**
 * Strum arrows for the song sheet, only on measures where the pattern changes.
 * @param {(measureIndex:number)=>object|null} patternAt
 * @returns {{time:number,text:string}[]}
 */
export function strumMarks(measures, grid, patternAt) {
  const marks = [];
  let prevKey = null;
  measures.forEach((m, mi) => {
    const p = patternAt(mi);
    if (!p || m.beats.length !== p.beats) return;
    const key = `${patternKey(p)}|${p.slots.map((s) => (s.accent ? '>' : '.')).join('')}|${p.sub}`;
    if (key === prevKey) return;
    prevKey = key;
    p.slots.forEach((s, i) => {
      if (!s.dir) return;
      const b = m.beats[Math.floor(i / p.sub)];
      const j = i % p.sub;
      const time = grid[b] + ((grid[b + 1] - grid[b]) * j) / p.sub;
      marks.push({ time, text: ARROW[s.dir] + (s.accent ? '>' : '') }); // arrow stays on the beat column
    });
  });
  return marks;
}

/** Plain-text grid:  1  &  2  & / >        / ↓     ↓  ↑ */
export function patternToText(p, indent = '') {
  const labels = slotLabels(p.beats, p.sub);
  const cell = (s) => s.padEnd(3);
  const counts = labels.map(cell).join('').trimEnd();
  const accents = p.slots.map((s) => cell(s.accent ? '>' : '')).join('').trimEnd();
  const arrows = p.slots.map((s) => cell(s.dir ? ARROW[s.dir] : '')).join('').trimEnd();
  return [counts, accents, arrows].filter((l, i) => i !== 1 || l.trim()).map((l) => indent + l).join('\n');
}
