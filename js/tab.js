// 將 MIDI 音符轉換為標準調音 (EADGBE) 六線譜，偏好低把位、好按的指法。
// 純邏輯模組，不依賴 DOM，可在 Node 中測試。

// 弦由低到高：E2 A2 D3 G3 B3 E4（MIDI 編號）
export const TUNING = [40, 45, 50, 55, 59, 64];
export const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];
export const MAX_FRET = 15;
const MAX_NOTES_PER_EVENT = 6;

const LOWEST = TUNING[0];
const HIGHEST = TUNING[5] + MAX_FRET;

/** 將超出吉他音域的音以八度移入可彈範圍。 */
export function foldIntoRange(midi) {
  let m = Math.round(midi);
  while (m < LOWEST) m += 12;
  while (m > HIGHEST) m -= 12;
  return m;
}

/**
 * 把時間接近的音符合併成「事件」（同時發聲的音）。
 * @param {{startTimeSeconds:number,durationSeconds:number,pitchMidi:number,amplitude:number}[]} notes
 * @param {number} window 視為同時的秒數
 */
export function groupNotes(notes, window = 0.06) {
  const sorted = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  const events = [];
  for (const n of sorted) {
    const last = events[events.length - 1];
    if (last && n.startTimeSeconds - last.time <= window) {
      last.notes.push(n);
    } else {
      events.push({ time: n.startTimeSeconds, notes: [n] });
    }
  }
  for (const ev of events) {
    // 同音高只留一個（取最大音量），並限制最多音數（保留音量最大者）
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

/** 單一音在每條弦上的可能位置。 */
function positionsFor(pitch) {
  const out = [];
  for (let s = 0; s < 6; s++) {
    const fret = pitch - TUNING[s];
    if (fret >= 0 && fret <= MAX_FRET) out.push({ string: s, fret });
  }
  return out;
}

/** 指法本身的難度：品位越高、跨度越大越難；空弦最輕鬆。 */
function shapeCost(fingering) {
  const fretted = fingering.filter((p) => p.fret > 0).map((p) => p.fret);
  let cost = 0;
  for (const p of fingering) cost += p.fret === 0 ? 0 : 1 + p.fret * 0.6;
  if (fretted.length) {
    const span = Math.max(...fretted) - Math.min(...fretted);
    cost += span * 1.5;
    if (span > 3) cost += (span - 3) * 8;
    // 超過 5 品額外懲罰，進一步偏好低把位
    const hi = Math.max(...fretted);
    if (hi > 5) cost += (hi - 5) * 1.2;
  }
  return cost;
}

/** 指法的「手位置」（按弦品位的平均，空弦不計）。 */
function handPosition(fingering) {
  const fretted = fingering.filter((p) => p.fret > 0).map((p) => p.fret);
  if (!fretted.length) return null;
  return fretted.reduce((a, b) => a + b, 0) / fretted.length;
}

/** 列舉一個事件所有可行指法（每音一條不同的弦），只保留成本最低的前 k 個。 */
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
    // 無法同時彈奏：丟掉最低的音再試
    return candidateFingerings(pitches.slice(1), k);
  }
  return results
    .map((f) => ({ fingering: f, cost: shapeCost(f), pos: handPosition(f) }))
    .sort((a, b) => a.cost - b.cost)
    .slice(0, k);
}

/**
 * 以 Viterbi 動態規劃為所有事件選出整體最好彈的指法：
 * 每個事件本身成本 + 手位置移動成本。
 */
export function assignFingerings(events) {
  const cands = events.map((ev) => candidateFingerings(ev.notes.map((n) => n.pitchMidi)));
  const n = events.length;
  if (!n) return [];
  const dp = [];
  const back = [];
  dp[0] = cands[0].map((c) => c.cost);
  back[0] = cands[0].map(() => -1);
  // 記錄每條路徑上最近一次的手位置，讓空弦事件不會重置位置
  const lastPos = [cands[0].map((c) => c.pos ?? 1)];
  for (let i = 1; i < n; i++) {
    const gap = events[i].time - events[i - 1].time;
    // 間隔越長，換把位越不痛
    const moveWeight = gap > 1.5 ? 0.3 : 1.2;
    dp[i] = [];
    back[i] = [];
    lastPos[i] = [];
    for (let j = 0; j < cands[i].length; j++) {
      const c = cands[i][j];
      let best = Infinity;
      let arg = 0;
      for (let p = 0; p < cands[i - 1].length; p++) {
        const prevPos = lastPos[i - 1][p];
        const move = c.pos == null ? 0 : Math.abs(c.pos - prevPos);
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
  // 回溯
  let j = dp[n - 1].indexOf(Math.min(...dp[n - 1]));
  const chosen = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    chosen[i] = cands[i][j] ? cands[i][j].fingering : [];
    j = back[i][j];
  }
  return events.map((ev, i) => ({ time: ev.time, fingering: chosen[i] }));
}

export function formatTime(sec) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * 把指法事件排成文字六線譜。
 * @param {{time:number,fingering:{string:number,fret:number}[]}[]} tabEvents
 * @param {{lineWidth?:number, secondsPerDash?:number}} opts
 * @returns {string}
 */
export function renderTab(tabEvents, opts = {}) {
  const lineWidth = opts.lineWidth ?? 60;
  const secondsPerDash = opts.secondsPerDash ?? 0.15;
  const blocks = [];
  let rows = null;
  let rowStart = 0;
  let width = 0;

  const flush = () => {
    if (!rows) return;
    const header = `[${formatTime(rowStart)}]`;
    const lines = [];
    for (let s = 5; s >= 0; s--) lines.push(`${STRING_NAMES[s]}|${rows[s]}|`);
    blocks.push(`${header}\n${lines.join('\n')}`);
    rows = null;
  };
  const startRow = (t) => {
    rows = ['-', '-', '-', '-', '-', '-'];
    width = 1;
    rowStart = t;
  };

  for (let i = 0; i < tabEvents.length; i++) {
    const ev = tabEvents[i];
    if (!ev.fingering.length) continue;
    const cells = new Array(6).fill('');
    for (const p of ev.fingering) cells[p.string] = String(p.fret);
    const colW = Math.max(...cells.map((c) => c.length));
    const next = tabEvents[i + 1];
    const gap = next ? next.time - ev.time : 0.3;
    const dashes = Math.max(1, Math.min(6, Math.round(gap / secondsPerDash)));
    if (!rows || width + colW + dashes > lineWidth) {
      flush();
      startRow(ev.time);
    }
    for (let s = 0; s < 6; s++) {
      rows[s] += cells[s].padEnd(colW, '-') + '-'.repeat(dashes);
    }
    width += colW + dashes;
  }
  flush();
  return blocks.join('\n\n');
}

/** 一次完成：音符 → 六線譜文字。 */
export function notesToTab(notes, opts) {
  const events = groupNotes(notes).filter((e) => e.notes.length);
  const tabEvents = assignFingerings(events);
  return { tabEvents, text: renderTab(tabEvents, opts) };
}
