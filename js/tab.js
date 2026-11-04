// MIDI notes -> playable fingerings in standard tuning (EADGBE), preferring low positions.
// Pure logic, no DOM; testable in Node.

// Strings low -> high: E2 A2 D3 G3 B3 E4 (MIDI numbers)
export const TUNING = [40, 45, 50, 55, 59, 64];
export const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];
export const MAX_FRET = 15;
const MAX_NOTES_PER_EVENT = 6;

const LOWEST = TUNING[0];
const HIGHEST = TUNING[5] + MAX_FRET;

/** Move notes outside the guitar range into it by octaves. */
export function foldIntoRange(midi) {
  let m = Math.round(midi);
  while (m < LOWEST) m += 12;
  while (m > HIGHEST) m -= 12;
  return m;
}

/**
 * Merge notes that start (almost) together into events.
 * @param {{startTimeSeconds:number,durationSeconds:number,pitchMidi:number,amplitude:number}[]} notes
 * @param {number} window seconds treated as simultaneous
 */
export function groupNotes(notes, window = 0.06) {
  const sorted = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  const events = [];
  for (const n of sorted) {
    const last = events[events.length - 1];
    if (last && n.startTimeSeconds - last.time <= window) last.notes.push(n);
    else events.push({ time: n.startTimeSeconds, notes: [n] });
  }
  for (const ev of events) {
    // One note per pitch (loudest), at most 6 notes (loudest kept)
    const byPitch = new Map();
    for (const n of ev.notes) {
      const p = foldIntoRange(n.pitchMidi);
      const prev = byPitch.get(p);
      if (!prev || prev.amplitude < n.amplitude) byPitch.set(p, { ...n, pitchMidi: p });
    }
    ev.notes = [...byPitch.values()]
      .sort((a, b) => b.amplitude - a.amplitude)
      .slice(0, MAX_NOTES_PER_EVENT)
      .sort((a, b) => a.pitchMidi - b.pitchMidi);
  }
  return events;
}

function positionsFor(pitch) {
  const out = [];
  for (let s = 0; s < 6; s++) {
    const fret = pitch - TUNING[s];
    if (fret >= 0 && fret <= MAX_FRET) out.push({ string: s, fret });
  }
  return out;
}

/** Difficulty of a shape: higher frets and wider stretches cost more; open strings are free. */
function shapeCost(fingering) {
  const fretted = fingering.filter((p) => p.fret > 0).map((p) => p.fret);
  let cost = 0;
  for (const p of fingering) cost += p.fret === 0 ? 0 : 1 + p.fret * 0.6;
  if (fretted.length) {
    const span = Math.max(...fretted) - Math.min(...fretted);
    cost += span * 1.5;
    if (span > 3) cost += (span - 3) * 8;
    const hi = Math.max(...fretted);
    if (hi > 5) cost += (hi - 5) * 1.2;
  }
  return cost;
}

function handPosition(fingering) {
  const fretted = fingering.filter((p) => p.fret > 0).map((p) => p.fret);
  if (!fretted.length) return null;
  return fretted.reduce((a, b) => a + b, 0) / fretted.length;
}

/** All ways to play the pitches on distinct strings; keep the k cheapest. */
export function candidateFingerings(pitches, k = 12) {
  const options = pitches.map(positionsFor);
  const results = [];
  const used = new Array(6).fill(false);
  const cur = [];
  (function rec(i) {
    if (i === pitches.length) {
      results.push(cur.map((p) => ({ ...p })));
      return;
    }
    for (const pos of options[i]) {
      if (used[pos.string]) continue;
      used[pos.string] = true;
      cur.push(pos);
      rec(i + 1);
      cur.pop();
      used[pos.string] = false;
    }
  })(0);
  if (!results.length && pitches.length > 1) {
    // Not playable together: drop the lowest note and retry
    return candidateFingerings(pitches.slice(1), k);
  }
  return results
    .map((f) => ({ fingering: f, cost: shapeCost(f), pos: handPosition(f) }))
    .sort((a, b) => a.cost - b.cost)
    .slice(0, k);
}

/** Viterbi over events: shape cost + cost of moving the hand. */
export function assignFingerings(events) {
  const cands = events.map((ev) => candidateFingerings(ev.notes.map((n) => n.pitchMidi)));
  const n = events.length;
  if (!n) return [];
  const dp = [cands[0].map((c) => c.cost)];
  const back = [cands[0].map(() => -1)];
  const lastPos = [cands[0].map((c) => c.pos ?? 1)];
  for (let i = 1; i < n; i++) {
    const gap = events[i].time - events[i - 1].time;
    const moveWeight = gap > 1.5 ? 0.3 : 1.2; // shifting is easier after a long gap
    dp[i] = [];
    back[i] = [];
    lastPos[i] = [];
    for (let j = 0; j < cands[i].length; j++) {
      const c = cands[i][j];
      let best = Infinity;
      let arg = 0;
      for (let p = 0; p < cands[i - 1].length; p++) {
        const move = c.pos == null ? 0 : Math.abs(c.pos - lastPos[i - 1][p]);
        const v = dp[i - 1][p] + c.cost + move * moveWeight;
        if (v < best) {
          best = v;
          arg = p;
        }
      }
      dp[i][j] = best;
      back[i][j] = arg;
      lastPos[i][j] = c.pos ?? lastPos[i - 1][arg];
    }
  }
  let j = dp[n - 1].indexOf(Math.min(...dp[n - 1]));
  const chosen = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    chosen[i] = cands[i][j] ? cands[i][j].fingering : [];
    j = back[i][j];
  }
  return events.map((ev, i) => ({ time: ev.time, fingering: chosen[i] }));
}

/** Notes -> [{time, fingering:[{string,fret}]}] */
export function fingerNotes(notes) {
  return assignFingerings(groupNotes(notes).filter((e) => e.notes.length));
}

export function formatTime(sec) {
  const s = Math.max(0, sec);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
