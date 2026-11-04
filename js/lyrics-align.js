// Lyric lines: build from Whisper words, align pasted lyrics to Whisper timestamps,
// or spread them evenly. Pure logic, no DOM; testable in Node.
//
// A line is { start, end, text, words: [{ text, start }] }.

const CJK_CHAR = /[぀-ヿ㐀-䶿一-鿿가-힣豈-﫿]/;

/** Split a line into display words. CJK text is split per character. */
export function splitWords(text) {
  const out = [];
  for (const chunk of text.trim().split(/\s+/)) {
    if (!chunk) continue;
    if (CJK_CHAR.test(chunk)) {
      // keep runs of non-CJK (e.g. "OK") together, split CJK per char, attach punctuation
      const parts = chunk.match(/[぀-ヿ㐀-䶿一-鿿가-힣豈-﫿][^\p{L}\p{N}]*|[^぀-ヿ㐀-䶿一-鿿가-힣豈-﫿]+/gu);
      out.push(...(parts || [chunk]));
    } else out.push(chunk);
  }
  return out;
}

export const normalize = (w) => w.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}']/gu, '').replace(/'/g, '');

/** Drop Whisper's typical non-lyric output on music: [Music], ♪, (applause)... */
export function cleanWhisperWords(words) {
  const out = [];
  let inBracket = false;
  for (const w of words) {
    const t = (w.text || '').trim();
    if (!t) continue;
    if (/^[[(]/.test(t)) inBracket = true;
    const skip = inBracket || /[♪♫]/.test(t);
    if (/[\])]$/.test(t)) inBracket = false;
    if (skip || !normalize(t)) continue;
    out.push({ text: t, start: w.start, end: w.end });
  }
  return removeLoops(out);
}

/**
 * Whisper on music often gets stuck repeating a phrase. Keep at most two consecutive
 * copies of any 2-10 word phrase (four for a single word).
 */
export function removeLoops(words) {
  let ws = words;
  for (let n = 1; n <= 10; n++) {
    const maxCopies = n === 1 ? 4 : 2; // allow "na na na na"
    const out = [];
    let i = 0;
    while (i < ws.length) {
      const key = (k) => ws.slice(k, k + n).map((w) => normalize(w.text)).join(' ');
      const phrase = key(i);
      let copies = 1;
      while (i + (copies + 1) * n <= ws.length && key(i + copies * n) === phrase) copies++;
      if (copies > maxCopies && i + n <= ws.length) {
        out.push(...ws.slice(i, i + n * maxCopies));
        i += n * copies;
      } else {
        out.push(ws[i]);
        i++;
      }
    }
    ws = out;
  }
  return ws;
}

/** Group Whisper words into lines at pauses, sentence ends, or max length. */
export function linesFromWords(words, { gap = 1.0, maxWords = 9 } = {}) {
  const lines = [];
  let cur = null;
  for (const w of words) {
    const prev = cur?.words[cur.words.length - 1];
    const brk =
      !cur ||
      w.start - (prev.end ?? prev.start) > gap ||
      cur.words.length >= maxWords ||
      /[.?!。？！]$/.test(prev.text);
    if (brk) {
      cur = { start: w.start, end: w.end ?? w.start + 0.4, words: [] };
      lines.push(cur);
    }
    cur.words.push({ text: w.text, start: w.start });
    cur.end = w.end ?? w.start + 0.4;
  }
  for (const l of lines) l.text = joinWords(l.words.map((w) => w.text));
  return lines;
}

function joinWords(ws) {
  let s = '';
  for (const w of ws) {
    const glue = s && !(CJK_CHAR.test(s.slice(-1)) && CJK_CHAR.test(w[0])) ? ' ' : '';
    s += glue + w;
  }
  return s;
}

/** Spread a line's words evenly between start and end. */
export function spreadWords(text, start, end) {
  const ws = splitWords(text);
  const span = Math.max(0.2, end - start);
  return ws.map((t, i) => ({ text: t, start: start + (span * i) / Math.max(1, ws.length) }));
}

/** Pasted lyrics with no timing: one line per equal slice of [songStart, songEnd]. */
export function distributeEvenly(text, songStart, songEnd) {
  const raw = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const step = (songEnd - songStart) / Math.max(1, raw.length);
  return raw.map((t, i) => {
    const start = songStart + i * step;
    const end = start + step;
    return { start, end, text: t, words: spreadWords(t, start, start + step * 0.9) };
  });
}

function similarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > Math.max(m, n) * 0.5) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

/**
 * Align pasted lyrics to Whisper words (weighted LCS on normalized words).
 * Falls back to even spacing when there is too little overlap.
 * @returns {{lines: object[], matched: number, method: 'aligned'|'even'}}
 */
export function alignLyrics(text, whisperWords, songStart, songEnd) {
  const rawLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!rawLines.length) return { lines: [], matched: 0, method: 'even' };

  // Whisper tokens: split CJK chunks per char, interpolating times
  const ref = [];
  for (const w of whisperWords || []) {
    const parts = splitWords(w.text);
    const end = w.end ?? w.start + 0.3;
    parts.forEach((p, i) => {
      const n = normalize(p);
      if (n) ref.push({ n, t: w.start + ((end - w.start) * i) / parts.length });
    });
  }

  const lyr = []; // {n, line, idx}
  const lineWords = rawLines.map((l, li) => {
    const ws = splitWords(l);
    ws.forEach((w, idx) => lyr.push({ n: normalize(w), line: li, idx }));
    return ws;
  });

  if (ref.length < 3) return { lines: distributeEvenly(text, songStart, songEnd), matched: 0, method: 'even' };

  // Weighted LCS
  const A = lyr.length;
  const B = ref.length;
  const W = B + 1;
  const dp = new Float32Array((A + 1) * W);
  const dir = new Uint8Array((A + 1) * W); // 1 = match, 2 = up, 3 = left
  for (let i = 1; i <= A; i++) {
    for (let j = 1; j <= B; j++) {
      let best = dp[(i - 1) * W + j];
      let d = 2;
      if (dp[i * W + j - 1] > best) {
        best = dp[i * W + j - 1];
        d = 3;
      }
      const sim = lyr[i - 1].n ? similarity(lyr[i - 1].n, ref[j - 1].n) : 0;
      if (sim >= 0.67) {
        const v = dp[(i - 1) * W + j - 1] + sim;
        if (v > best) {
          best = v;
          d = 1;
        }
      }
      dp[i * W + j] = best;
      dir[i * W + j] = d;
    }
  }
  const time = new Array(A).fill(null);
  let matched = 0;
  for (let i = A, j = B; i > 0 && j > 0; ) {
    const d = dir[i * W + j];
    if (d === 1) {
      time[i - 1] = ref[j - 1].t;
      matched++;
      i--;
      j--;
    } else if (d === 2) i--;
    else j--;
  }
  if (matched < Math.max(3, A * 0.15)) {
    return { lines: distributeEvenly(text, songStart, songEnd), matched, method: 'even' };
  }

  // Fill unmatched word times by linear interpolation over word index
  const known = time.map((t, i) => (t == null ? null : i)).filter((i) => i != null);
  const firstK = known[0];
  const lastK = known[known.length - 1];
  for (let i = 0; i < A; i++) {
    if (time[i] != null) continue;
    if (i < firstK) {
      // spread leading words between songStart and the first match
      time[i] = songStart + ((time[firstK] - songStart) * i) / firstK;
    } else if (i > lastK) {
      const rest = A - 1 - lastK;
      time[i] = time[lastK] + ((songEnd - time[lastK]) * (i - lastK)) / (rest + 1);
    } else {
      let a = i - 1;
      while (time[a] == null) a--;
      let b = i + 1;
      while (time[b] == null) b++;
      time[i] = time[a] + ((time[b] - time[a]) * (i - a)) / (b - a);
    }
  }
  // Keep monotonic
  for (let i = 1; i < A; i++) if (time[i] < time[i - 1]) time[i] = time[i - 1];

  const lines = [];
  let k = 0;
  rawLines.forEach((t, li) => {
    const words = lineWords[li].map((w) => ({ text: w, start: time[k++] }));
    lines.push({ text: t, start: words[0]?.start ?? songStart, words });
  });
  lines.forEach((l, i) => {
    const next = lines[i + 1]?.start ?? songEnd;
    const lastWord = l.words[l.words.length - 1]?.start ?? l.start;
    l.end = Math.max(lastWord + 0.4, Math.min(next, lastWord + 3));
  });
  return { lines, matched, method: 'aligned' };
}

/** Apply an inline edit: keep word times if the word count is unchanged, else re-spread. */
export function editLine(line, newText) {
  const ws = splitWords(newText);
  if (ws.length === line.words.length) {
    return { ...line, text: newText, words: line.words.map((w, i) => ({ ...w, text: ws[i] })) };
  }
  const end = line.end ?? line.start + Math.max(1, ws.length * 0.4);
  return { ...line, text: newText, words: spreadWords(newText, line.start, end) };
}

export const allWords = (lines) => lines.flatMap((l) => l.words);
