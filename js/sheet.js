// Song-sheet layout: beat grid -> measures -> rows of
//   chord names / 6-line tab / lyrics, all aligned on the same character columns.
// Pure logic, no DOM; testable in Node.

import { STRING_NAMES, formatTime } from './tab.js';

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/**
 * Beat times covering the whole song. The last entry is an end boundary (>= duration).
 * @param {{beats:number[], duration:number, bpm:number, useDetected:boolean}} o
 */
export function buildBeatGrid({ beats = [], duration, bpm, useDetected }) {
  let grid;
  let iv;
  if (useDetected && beats.length >= 2) {
    grid = beats.slice();
    iv = median(grid.slice(1).map((t, i) => t - grid[i]));
  } else {
    iv = 60 / Math.max(20, bpm || 120);
    grid = [beats[0] ?? 0];
  }
  if (!(iv > 0.05)) iv = 0.5;
  while (grid[0] > iv * 0.5) grid.unshift(grid[0] - iv);
  while (grid[grid.length - 1] < duration) grid.push(grid[grid.length - 1] + iv);
  if (grid.length < 2) grid.push(grid[0] + iv);
  return grid;
}

/**
 * Snap chord segments to the beat grid: each beat takes the chord that covers most of it,
 * then chords lasting fewer than `minBeats` beats are absorbed by their neighbour.
 * Removes the flicker that vocals and passing notes cause.
 */
export function snapChordsToBeats(chords, grid, minBeats = 2) {
  if (!chords.length || grid.length < 2) return chords;
  const sorted = [...chords].sort((a, b) => a.start - b.start);
  const perBeat = [];
  for (let i = 0; i < grid.length - 1; i++) {
    const a = grid[i];
    const b = grid[i + 1];
    const cover = new Map();
    for (const c of sorted) {
      if (c.end <= a) continue;
      if (c.start >= b) break;
      const ov = Math.min(b, c.end) - Math.max(a, c.start);
      cover.set(c.chord, (cover.get(c.chord) || 0) + ov);
    }
    let best = '';
    let bestOv = (b - a) * 0.4; // need 40% of the beat
    for (const [name, ov] of cover) {
      if (ov > bestOv) {
        best = name;
        bestOv = ov;
      }
    }
    perBeat.push(best);
  }
  const runs = [];
  perBeat.forEach((c, i) => {
    const last = runs[runs.length - 1];
    if (last && last.chord === c) last.n++;
    else runs.push({ chord: c, i, n: 1 });
  });
  // Absorb short runs (but keep short gaps of silence as gaps)
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k];
    if (!r.chord || r.n >= minBeats) continue;
    const prev = runs[k - 1];
    const next = runs[k + 1];
    if (prev?.chord) r.chord = prev.chord;
    else if (next?.chord) r.chord = next.chord;
  }
  const out = [];
  for (const r of runs) {
    if (!r.chord) continue;
    const last = out[out.length - 1];
    const start = grid[r.i];
    const end = grid[r.i + r.n];
    if (last && last.chord === r.chord && Math.abs(last.end - start) < 1e-6) last.end = end;
    else out.push({ chord: r.chord, start, end });
  }
  return out;
}

/**
 * Guess which beat is "1": chord changes usually land on the downbeat, and the
 * downbeat strum is often the loudest. Returns the shift for buildMeasures().
 */
export function estimateDownbeatShift(grid, chords, onsets, beatsPerBar) {
  const bpb = beatsPerBar;
  if (bpb < 2 || grid.length < bpb * 2) return 0;
  const beatOf = (t) => {
    let best = 0;
    for (let i = 1; i < grid.length; i++) if (Math.abs(grid[i] - t) < Math.abs(grid[best] - t)) best = i;
    return best;
  };
  const changes = new Array(bpb).fill(0);
  chords.forEach((c, i) => i > 0 && changes[beatOf(c.start) % bpb]++);
  const strength = new Array(bpb).fill(0);
  const count = new Array(bpb).fill(0);
  for (let i = 0; i < grid.length - 1; i++) {
    let s = 0;
    for (const o of onsets) if (Math.abs(o.time - grid[i]) < 0.07) s = Math.max(s, o.strength);
    strength[i % bpb] += s;
    count[i % bpb]++;
  }
  const meanS = strength.map((s, i) => s / Math.max(1, count[i]));
  const maxS = Math.max(...meanS, 1e-9);
  const totalC = changes.reduce((a, b) => a + b, 0);
  let best = 0;
  let bestScore = -1;
  for (let ph = 0; ph < bpb; ph++) {
    const score = (totalC ? (changes[ph] / totalC) * 0.6 : 0) + (meanS[ph] / maxS) * 0.4;
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = ph;
    }
  }
  return best;
}

/**
 * Group beats into measures. `shift` moves the first downbeat later by N beats
 * (the beats before it become a pickup measure).
 * @returns {{start:number,end:number,beats:number[]}[]} beats = indices into grid
 */
export function buildMeasures(grid, beatsPerBar, shift = 0) {
  const n = grid.length - 1; // number of beat intervals
  const bpb = Math.max(1, beatsPerBar);
  const s = ((shift % bpb) + bpb) % bpb;
  const groups = [];
  let i = 0;
  if (s > 0) {
    groups.push(range(0, Math.min(s, n)));
    i = s;
  }
  for (; i < n; i += bpb) groups.push(range(i, Math.min(i + bpb, n)));
  return groups
    .filter((g) => g.length)
    .map((g) => ({ beats: g, start: grid[g[0]], end: grid[g[g.length - 1] + 1] }));
}

function range(a, b) {
  const out = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

const CJK = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
/** Display width in monospace columns (CJK = 2). */
export function strWidth(s) {
  let w = 0;
  for (const ch of s) w += CJK.test(ch) ? 2 : 1;
  return w;
}
const padTo = (s, w, ch = ' ') => s + ch.repeat(Math.max(0, w - strWidth(s)));

/**
 * Lay out the sheet.
 * @param {object} o
 * @param {number[]} o.grid beat grid (from buildBeatGrid)
 * @param {{start,end,beats}[]} o.measures
 * @param {{time:number,fingering:{string,fret}[]}[]} o.tabEvents
 * @param {{start:number,chord:string}[]} o.chords
 * @param {{text:string,start:number}[]} o.words lyric words with times
 * @param {number} o.measuresPerRow
 * @param {number} o.subdivision slots per beat (2 = eighths, 4 = sixteenths)
 * @param {boolean} o.showTab
 * @param {{time:number,text:string}[]} [o.strums] strum arrows (only where the pattern changes)
 */
export function layoutSheet(o) {
  const { grid, measures, tabEvents = [], words = [], strums = [] } = o;
  let chords = o.chords || [];
  const sub = Math.max(1, o.subdivision || 2);
  const perRow = Math.max(1, o.measuresPerRow || 4);
  const showTab = o.showTab !== false;

  // Slots: every beat split into `sub` positions
  const slots = [];
  measures.forEach((m, mi) => {
    for (const b of m.beats) {
      const t0 = grid[b];
      const t1 = grid[b + 1];
      for (let j = 0; j < sub; j++) {
        slots.push({ time: t0 + ((t1 - t0) * j) / sub, measure: mi, frets: null, chord: '', lyric: '', strum: '' });
      }
    }
  });
  if (!slots.length) return [];
  const times = slots.map((s) => s.time);
  const nearest = (t) => {
    let lo = 0;
    let hi = times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && t - times[lo - 1] < times[lo] - t) lo -= 1;
    return slots[lo];
  };

  for (const ev of tabEvents) {
    if (!ev.fingering?.length) continue;
    const slot = nearest(ev.time);
    slot.frets ||= new Array(6).fill('');
    for (const p of ev.fingering) if (!slot.frets[p.string]) slot.frets[p.string] = String(p.fret);
  }
  chords = [...chords].sort((a, b) => a.start - b.start);
  for (const c of chords) nearest(c.start).chord = c.chord;
  for (const st of strums) {
    const slot = nearest(st.time);
    if (!slot.strum) slot.strum = st.text;
  }
  for (const w of words) {
    const text = (w.text || '').trim();
    if (!text) continue;
    const slot = nearest(w.start);
    slot.lyric = slot.lyric ? `${slot.lyric} ${text}` : text;
  }

  const chordAt = (t) => {
    let cur = null;
    for (const c of chords) {
      if (c.start <= t + 1e-6) cur = c;
      else break;
    }
    return cur && (cur.end == null || t < cur.end) ? cur.chord : '';
  };

  const rows = [];
  for (let r = 0; r < measures.length; r += perRow) {
    const ms = measures.slice(r, r + perRow);
    const first = r;
    const last = r + ms.length - 1;
    const rowSlots = slots.filter((s) => s.measure >= first && s.measure <= last);
    // Repeat the active chord at the start of each row for readability
    if (rowSlots.length && !rowSlots[0].chord) {
      const active = chordAt(ms[0].start);
      if (active) rowSlots[0] = { ...rowSlots[0], chord: active };
    }
    // Place every slot at a column. Text on the chord/lyric lines may run into the
    // following empty slots; a slot only moves right when its own text would collide.
    const lineStrum = [];
    const lineChord = [];
    const lineLyric = [];
    const tabLines = Array.from({ length: 6 }, () => []);
    const bars = [];
    const put = (arr, col, text) => {
      let c = col;
      for (const ch of text) {
        arr[c++] = ch;
        if (strWidth(ch) === 2) arr[c++] = '';
      }
    };
    let nextMin = 0;
    let chordCur = 0;
    let strumCur = 0;
    let lyricCur = 0;
    let prevMeasure = -1;
    for (const s of rowSlots) {
      if (s.measure !== prevMeasure) {
        prevMeasure = s.measure;
        if (showTab) {
          bars.push(nextMin);
          nextMin += 1;
        }
      }
      const has = s.frets || s.chord || s.lyric || s.strum;
      if (!showTab && !has) continue;
      const pos = Math.max(nextMin, s.chord ? chordCur : 0, s.lyric ? lyricCur : 0, s.strum ? strumCur : 0);
      if (s.strum) {
        put(lineStrum, pos, s.strum);
        strumCur = pos + strWidth(s.strum) + 1;
      }
      if (s.chord) {
        put(lineChord, pos, s.chord);
        chordCur = pos + strWidth(s.chord) + 1;
      }
      if (s.lyric) {
        put(lineLyric, pos, s.lyric);
        lyricCur = pos + strWidth(s.lyric) + 1;
      }
      const fretW = s.frets ? Math.max(...s.frets.map((f) => f.length)) : 0;
      if (s.frets) for (let k = 0; k < 6; k++) if (s.frets[k]) put(tabLines[k], pos, s.frets[k]);
      nextMin = pos + (showTab ? (fretW ? fretW + 1 : 1) : 1);
    }
    const toStr = (arr, fill, len) => {
      let out = '';
      for (let c = 0; c < len; c++) out += arr[c] === undefined ? fill : arr[c];
      return out;
    };
    let chordLine;
    let lyricLine;
    let strumLine;
    const tab = [];
    if (showTab) {
      const endCol = nextMin;
      for (const b of bars) for (const t of tabLines) t[b] = '|';
      for (let k = 0; k < 6; k++) tab[k] = `${STRING_NAMES[k]}${toStr(tabLines[k], '-', endCol)}|`;
      strumLine = ` ${toStr(lineStrum, ' ', lineStrum.length)}`;
      chordLine = ` ${toStr(lineChord, ' ', lineChord.length)}`;
      lyricLine = ` ${toStr(lineLyric, ' ', lineLyric.length)}`;
    } else {
      strumLine = toStr(lineStrum, ' ', lineStrum.length);
      chordLine = toStr(lineChord, ' ', lineChord.length);
      lyricLine = toStr(lineLyric, ' ', lineLyric.length);
    }
    const lines = [];
    const chordTrim = chordLine.trimEnd();
    const lyricTrim = lyricLine.trimEnd();
    const strumTrim = strumLine.trimEnd();
    if (strumTrim) lines.push({ kind: 'strum', text: strumTrim });
    if (chordTrim) lines.push({ kind: 'chord', text: chordTrim });
    if (showTab) for (let k = 5; k >= 0; k--) lines.push({ kind: 'tab', text: tab[k] });
    if (lyricTrim) lines.push({ kind: 'lyric', text: lyricTrim });
    rows.push({
      start: ms[0].start,
      end: ms[ms.length - 1].end,
      label: formatTime(ms[0].start),
      lines,
      width: Math.max(0, ...lines.map((l) => strWidth(l.text))),
      empty: !chordTrim && !lyricTrim && !rowSlots.some((s) => s.frets),
    });
  }
  return rows;
}

/** Plain text version of the rows. */
export function sheetToText(rows) {
  return rows
    .filter((r) => !r.empty)
    .map((r) => `[${r.label}]\n${r.lines.map((l) => l.text).join('\n')}`)
    .join('\n\n');
}
