import { parseYouTubeId, parseStartSeconds } from './youtube.js';
import { decodeBlob, toMono, Recorder } from './audio.js';
import { formatTime, fingerNotes } from './tab.js';
import { chordDiagramSVG, chordShapeText } from './chords.js';
import { buildBeatGrid, buildMeasures, layoutSheet, sheetToText, snapChordsToBeats } from './sheet.js';
import { alignLyrics, cleanWhisperWords, linesFromWords, editLine, allWords } from './lyrics-align.js';
import { confidenceLabel } from './rhythm.js';
import { Metronome } from './metronome.js';

const $ = (id) => document.getElementById(id);
const CHORD_RATE = 22050; // Basic Pitch needs 22050 Hz; chord detection shares it
const RHYTHM_RATE = 44100; // RhythmExtractor2013 requires 44.1 kHz
const WHISPER_RATE = 16000;

const state = {
  blob: null,
  name: '',
  objectUrl: null,
  busy: false,
  analysis: null, // { duration, chords, tabEvents, noteCount, whisperWords }
  lyrics: [], // [{start,end,text,words}]
  tempo: { detected: null, manualBpm: null, beatsPerBar: 4, shift: 0 },
  view: { showTab: true, perRow: 4, sub: 2, follow: true },
  rows: [],
  chords: [], // beat-snapped chords shown everywhere
  activeRow: -1,
};

/* ================= Tempo panel ================= */
const metronome = new Metronome({ onBeat: (b) => flashBeat(b) });

function effectiveBpm() {
  return state.tempo.manualBpm ?? state.tempo.detected?.bpm ?? 120;
}

function renderTempoPanel() {
  const t = state.tempo;
  const bpm = t.manualBpm ?? t.detected?.bpm;
  const input = $('bpm-input');
  if (document.activeElement !== input) input.value = bpm ? Math.round(bpm) : '';
  $('bpm-source').textContent = t.manualBpm != null
    ? (t.detected ? `manual (detected ${Math.round(t.detected.bpm)})` : 'manual')
    : t.detected ? 'detected' : 'not detected yet';
  const conf = $('tempo-confidence');
  if (t.detected) {
    const label = confidenceLabel(t.detected.confidence);
    conf.className = `conf ${label.toLowerCase().replace(' ', '-')}`;
    conf.innerHTML = `${label} <span class="v">(${t.detected.confidence.toFixed(2)} / 5.32)</span>`;
  } else {
    conf.className = 'conf';
    conf.textContent = '—';
  }
  $('bpm-reset').hidden = !(t.manualBpm != null && t.detected);
  metronome.bpm = effectiveBpm();
  metronome.beatsPerBar = t.beatsPerBar;
  renderBeatDots();
}

function renderBeatDots() {
  const box = $('beat-dots');
  if (box.children.length === state.tempo.beatsPerBar) return;
  box.innerHTML = '';
  for (let i = 0; i < state.tempo.beatsPerBar; i++) box.appendChild(document.createElement('span'));
}

function flashBeat(b) {
  const dots = $('beat-dots').children;
  for (let i = 0; i < dots.length; i++) {
    dots[i].classList.toggle('on', i === b);
    dots[i].classList.toggle('down', i === 0);
  }
}

function setManualBpm(bpm) {
  if (!(bpm >= 30 && bpm <= 260)) return;
  state.tempo.manualBpm = Math.round(bpm * 10) / 10;
  renderTempoPanel();
  scheduleSheetRender();
}

$('bpm-input').addEventListener('change', (e) => setManualBpm(parseFloat(e.target.value)));
$('bpm-reset').addEventListener('click', () => {
  state.tempo.manualBpm = null;
  renderTempoPanel();
  scheduleSheetRender();
});
$('timesig').addEventListener('change', (e) => {
  state.tempo.beatsPerBar = +e.target.value;
  state.tempo.shift = 0;
  renderTempoPanel();
  scheduleSheetRender();
});

let taps = [];
$('tap-btn').addEventListener('click', () => {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
  taps.push(now);
  taps = taps.slice(-8);
  const btn = $('tap-btn');
  if (taps.length < 2) {
    btn.textContent = 'Tap again…';
    return;
  }
  const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
  setManualBpm(60000 / iv);
  btn.textContent = `Tap tempo (${taps.length} taps)`;
  clearTimeout(btn._t);
  btn._t = setTimeout(() => (btn.textContent = 'Tap tempo'), 2200);
});

$('metro-btn').addEventListener('click', () => {
  const btn = $('metro-btn');
  if (metronome.running) {
    metronome.stop();
    flashBeat(-1);
  } else {
    metronome.bpm = effectiveBpm();
    metronome.start();
  }
  btn.setAttribute('aria-pressed', String(metronome.running));
  btn.textContent = `Metronome: ${metronome.running ? 'on' : 'off'}`;
});

/* ================= YouTube ================= */
$('yt-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = $('yt-url').value;
  const id = parseYouTubeId(raw);
  const err = $('yt-error');
  const box = $('yt-player');
  if (!id) {
    err.textContent = "That doesn't look like a YouTube link (e.g. https://youtu.be/xxxxxxxxxxx).";
    err.hidden = false;
    return;
  }
  err.hidden = true;
  const start = parseStartSeconds(raw);
  box.innerHTML = '';
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0${start ? `&start=${start}` : ''}`;
  iframe.title = 'YouTube player';
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  box.appendChild(iframe);
  box.hidden = false;
});

/* ================= Audio source ================= */
function selectTab(which) {
  const isFile = which === 'file';
  $('tab-file').setAttribute('aria-selected', String(isFile));
  $('tab-mic').setAttribute('aria-selected', String(!isFile));
  $('panel-file').hidden = !isFile;
  $('panel-mic').hidden = isFile;
}
$('tab-file').addEventListener('click', () => selectTab('file'));
$('tab-mic').addEventListener('click', () => selectTab('mic'));

const audioEl = $('source-audio');

function setSource(blob, name) {
  state.blob = blob;
  state.name = name;
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = URL.createObjectURL(blob);
  audioEl.src = state.objectUrl;
  $('source-name').textContent = `Loaded: ${name} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`;
  $('source-name').hidden = false;
  $('player-bar').hidden = false;
  document.body.classList.add('has-player');
  $('analyze-btn').disabled = state.busy;
}

$('file-input').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) setSource(file, file.name);
});

const recBtn = $('rec-btn');
const recStatus = $('rec-status');
let recorder = null;
if (!Recorder.supported()) {
  recBtn.disabled = true;
  $('mic-unsupported').hidden = false;
}
recBtn.addEventListener('click', async () => {
  if (!recorder) {
    recorder = new Recorder({ onTick: (s) => (recStatus.textContent = `Recording… ${s} s`) });
    try {
      recBtn.disabled = true;
      await recorder.start();
      recBtn.textContent = '■ Stop recording';
      recBtn.classList.add('recording');
      recStatus.classList.add('live');
      $('analyze-btn').disabled = true;
    } catch (err) {
      recorder = null;
      recStatus.textContent = `Microphone unavailable: ${err.name === 'NotAllowedError' ? 'permission denied' : err.message}`;
    } finally {
      recBtn.disabled = false;
    }
  } else {
    const secs = Math.floor((performance.now() - recorder.startedAt) / 1000);
    const blob = await recorder.stop();
    recorder = null;
    recBtn.textContent = '● Record again';
    recBtn.classList.remove('recording');
    recStatus.classList.remove('live');
    recStatus.textContent = `Recorded ${secs} s`;
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    setSource(blob, `Recording ${new Date().toLocaleTimeString([], { hour12: false })}.${ext}`);
  }
});

/* ================= Progress (per step) ================= */
const STEP_DEFS = [
  { id: 'decode', name: 'Decode audio', weight: 4 },
  { id: 'tempo', name: 'Tempo & beats (Essentia)', weight: 14 },
  { id: 'chords', name: 'Chords (Essentia)', weight: 14 },
  { id: 'notes', name: 'Notes → tab (Basic Pitch)', weight: 40 },
  { id: 'lyrics', name: 'Lyrics (Whisper)', weight: 26 },
  { id: 'sheet', name: 'Build song sheet', weight: 2 },
];
const steps = {};
let overallMax = 0;

function initSteps(lyricsOn) {
  const ol = $('steps');
  ol.innerHTML = '';
  overallMax = 0;
  for (const d of STEP_DEFS) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="ico">○</span><span class="name"></span><span class="detail"></span><div class="mini"><div></div></div>';
    li.querySelector('.name').textContent = d.name;
    ol.appendChild(li);
    steps[d.id] = { ...d, el: li, p: 0, status: 'pending' };
  }
  if (!lyricsOn) setStep('lyrics', 'skipped', 0, 'off');
  updateOverall();
}

function setStep(id, status, p, detail) {
  const s = steps[id];
  if (!s) return;
  if (status) s.status = status;
  if (p != null) s.p = Math.max(0, Math.min(1, p));
  const li = s.el;
  li.className = s.status + (s.indeterminate && s.status === 'running' ? ' indeterminate' : '');
  li.querySelector('.ico').textContent = { pending: '○', running: '', done: '✓', error: '!', skipped: '–' }[s.status];
  li.querySelector('.mini > div').style.width = `${(s.status === 'done' ? 1 : s.p) * 100}%`;
  if (detail != null) li.querySelector('.detail').textContent = detail;
  updateOverall();
}

function updateOverall() {
  let total = 0;
  let done = 0;
  const running = [];
  for (const s of Object.values(steps)) {
    if (s.status === 'skipped') continue;
    total += s.weight;
    done += s.weight * (s.status === 'done' || s.status === 'error' ? 1 : s.p);
    if (s.status === 'running') running.push(s.name.replace(/ \(.*\)/, ''));
  }
  const pct = Math.max(overallMax, total ? Math.round((done / total) * 100) : 0);
  overallMax = pct;
  $('progress-bar').style.width = `${pct}%`;
  $('progress').setAttribute('aria-valuenow', String(pct));
  $('progress-pct').textContent = `${pct}%`;
  $('progress-stage').textContent = running.length ? `${running.join(' + ')}…` : pct >= 100 ? 'Done' : 'Working…';
}

function showError(msg) {
  $('analyze-error').textContent = msg;
  $('analyze-error').hidden = !msg;
}

/* ================= Analysis ================= */
$('analyze-btn').addEventListener('click', analyze);

async function analyze() {
  if (!state.blob || state.busy) return;
  state.busy = true;
  $('analyze-btn').disabled = true;
  recBtn.disabled = true;
  $('file-input').disabled = true;
  showError('');
  const lyricsModel = $('whisper-model').value;
  const lyricsOn = lyricsModel !== 'off';
  $('progress-wrap').hidden = false;
  initSteps(lyricsOn);

  try {
    setStep('decode', 'running', 0);
    const audioBuffer = await decodeBlob(state.blob);
    if (audioBuffer.duration > 600) throw new Error('Audio is longer than 10 minutes; please trim it first (phones run out of memory).');
    const duration = audioBuffer.duration;
    const s22 = await toMono(audioBuffer, CHORD_RATE);
    setStep('decode', null, 0.5);
    const s44 = await toMono(audioBuffer, RHYTHM_RATE);
    const s16 = lyricsOn ? await toMono(audioBuffer, WHISPER_RATE) : null;
    setStep('decode', 'done', 1, formatTime(duration));

    // Essentia (worker) and Basic Pitch (main thread, WebGL) run side by side
    steps.tempo.indeterminate = true;
    setStep('tempo', 'running', 0, '');
    const essentiaJob = import('./essentia-client.js')
      .then(({ analyzeWithEssentia }) =>
        analyzeWithEssentia(
          { rhythmSignal: s44, chordSignal: s22, chordRate: CHORD_RATE },
          {
            onProgress: (step, p) => {
              if (step === 'chords') setStep('chords', 'running', p);
            },
            onTempo: (tempo) => {
              state.tempo.detected = tempo.beats.length ? tempo : null;
              renderTempoPanel();
              setStep('tempo', tempo.beats.length ? 'done' : 'error', 1,
                tempo.beats.length ? `${Math.round(tempo.bpm)} BPM` : 'no beat found');
              setStep('chords', 'running', 0);
            },
          },
        ),
      )
      .then((r) => {
        setStep('chords', 'done', 1, `${new Set(r.chords.map((c) => c.chord)).size} chords`);
        return r.chords;
      })
      .catch((err) => {
        console.error(err);
        for (const id of ['tempo', 'chords']) if (steps[id].status !== 'done') setStep(id, 'error', 1, 'failed');
        return [];
      });

    const notesJob = (async () => {
      setStep('notes', 'running', 0, 'loading model');
      const { transcribe } = await import('./transcribe.js');
      const notes = await transcribe(s22, $('sensitivity').value, (p) => setStep('notes', 'running', p, `${Math.round(p * 100)}%`));
      const tabEvents = fingerNotes(notes);
      setStep('notes', 'done', 1, `${notes.length} notes`);
      return { notes, tabEvents };
    })().catch((err) => {
      console.error(err);
      setStep('notes', 'error', 1, 'failed');
      return { notes: [], tabEvents: [] };
    });

    const [chords, { notes, tabEvents }] = await Promise.all([essentiaJob, notesJob]);

    state.analysis = { duration, chords, tabEvents, noteCount: notes.length, whisperWords: [] };
    const span = songSpan();

    // Lyrics last: biggest download, most memory
    if (lyricsOn) {
      setStep('lyrics', 'running', 0, 'loading model');
      try {
        const { transcribeLyrics } = await import('./lyrics.js');
        const words = await transcribeLyrics(s16, { model: lyricsModel, language: $('whisper-lang').value }, (e) => {
          if (e.type === 'download' && e.total > 1e6) {
            setStep('lyrics', 'running', (e.loaded / e.total) * 0.3, `model ${Math.round(e.loaded / 1e6)}/${Math.round(e.total / 1e6)} MB`);
          } else if (e.type === 'progress') {
            setStep('lyrics', 'running', 0.3 + e.p * 0.7, `transcribing ${Math.round(e.p * 100)}%`);
          }
        });
        state.analysis.whisperWords = cleanWhisperWords(words);
        setStep('lyrics', 'done', 1, `${state.analysis.whisperWords.length} words`);
      } catch (err) {
        console.error(err);
        setStep('lyrics', 'error', 1, 'failed');
        showError(`Lyrics transcription failed (${err.message}). The rest of the sheet is ready; you can still paste lyrics.`);
      }
    }

    setStep('sheet', 'running', 0);
    buildLyricLines(span);
    state.tempo.shift = 0;
    renderResults();
    setStep('sheet', 'done', 1);
    $('lyrics-apply').disabled = false;
    $('results').hidden = false;
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    const msg = err?.name === 'EncodingError' || /decode/i.test(err?.message || '')
      ? "Couldn't decode this file. Try mp3, m4a or wav."
      : `Analysis failed: ${err?.message || err}`;
    showError(msg);
    for (const s of Object.values(steps)) if (s.status === 'running') setStep(s.id, 'error', 1);
  } finally {
    state.busy = false;
    $('analyze-btn').disabled = !state.blob;
    recBtn.disabled = !Recorder.supported();
    $('file-input').disabled = false;
  }
}

/** Where the music actually is (for spreading pasted lyrics). */
function songSpan() {
  const a = state.analysis;
  const times = [...a.chords.map((c) => c.start), ...a.tabEvents.map((e) => e.time)];
  if (!times.length) return [0, a.duration];
  const lastEnd = Math.max(...a.chords.map((c) => c.end), ...a.tabEvents.map((e) => e.time + 0.5));
  return [Math.min(...times), Math.min(a.duration, lastEnd)];
}

function buildLyricLines(span = songSpan()) {
  const pasted = $('lyrics-paste').value.trim();
  const ww = state.analysis.whisperWords;
  const msg = $('lyrics-msg');
  if (pasted) {
    const r = alignLyrics(pasted, ww, span[0], span[1]);
    state.lyrics = r.lines;
    msg.textContent = r.method === 'aligned'
      ? `Pasted lyrics aligned using ${r.matched} matched words.`
      : ww.length
        ? 'Too few words matched the transcription, so lines are spread evenly. Adjust times by editing below.'
        : 'Lines spread evenly across the song (no Whisper timing available).';
  } else {
    state.lyrics = linesFromWords(ww);
    msg.textContent = '';
  }
}

$('lyrics-apply').addEventListener('click', () => {
  if (!state.analysis) return;
  buildLyricLines();
  renderLyricsEditor();
  renderSheet();
});

/* ================= Results ================= */
function renderResults() {
  renderTempoPanel();
  state.chords = [];
  renderSheet(); // also renders the chord list
  renderLyricsEditor();
}

let sheetTimer = null;
function scheduleSheetRender() {
  if (!state.analysis) return;
  clearTimeout(sheetTimer);
  sheetTimer = setTimeout(renderSheet, 250);
}

function renderSheet() {
  const a = state.analysis;
  if (!a) return;
  const t = state.tempo;
  const useDetected = t.manualBpm == null && !!t.detected;
  const grid = buildBeatGrid({ beats: t.detected?.beats || [], duration: a.duration, bpm: effectiveBpm(), useDetected });
  const measures = buildMeasures(grid, t.beatsPerBar, t.shift);
  const chords = snapChordsToBeats(a.chords, grid, 2);
  const chordsChanged = JSON.stringify(chords) !== JSON.stringify(state.chords);
  state.chords = chords;
  if (chordsChanged) renderChords();
  state.rows = layoutSheet({
    grid,
    measures,
    tabEvents: a.tabEvents,
    chords,
    words: allWords(state.lyrics),
    measuresPerRow: state.view.perRow,
    subdivision: state.view.sub,
    showTab: state.view.showTab,
  });

  const sheet = $('sheet');
  sheet.classList.toggle('simple', !state.view.showTab);
  sheet.innerHTML = '';
  const frag = document.createDocumentFragment();
  state.rows.forEach((row, i) => {
    if (row.empty) return;
    const div = document.createElement('div');
    div.className = 'block';
    div.dataset.row = String(i);
    const tbtn = document.createElement('button');
    tbtn.type = 'button';
    tbtn.className = 'block-time';
    tbtn.textContent = `▶ ${row.label}`;
    tbtn.addEventListener('click', () => seek(row.start));
    const pre = document.createElement('pre');
    for (const line of row.lines) {
      const span = document.createElement('span');
      span.className = `l-${line.kind}`;
      span.textContent = `${line.text}\n`;
      pre.appendChild(span);
    }
    div.append(tbtn, pre);
    frag.appendChild(div);
  });
  sheet.appendChild(frag);
  if (!sheet.children.length) sheet.innerHTML = '<p class="hint">Nothing detected. Try a higher sensitivity or a cleaner recording.</p>';
  fitSheetFont();
  state.activeRow = -1;
  highlight();

  const bpm = Math.round(effectiveBpm());
  $('sheet-meta').textContent =
    `${bpm} BPM · ${$('timesig').selectedOptions[0].text} · ${measures.length} bars · ${a.noteCount} notes · ` +
    `${new Set(chords.map((c) => c.chord)).size} chords · ${state.lyrics.length} lyric lines. ` +
    'If bar lines look early or late, nudge them with ◀ ▶.';
}

/** Pick a font size so a typical row fits the screen width. */
function fitSheetFont() {
  const sheet = $('sheet');
  const widths = state.rows.filter((r) => !r.empty).map((r) => r.width).sort((x, y) => x - y);
  if (!widths.length) return;
  const typical = widths[Math.floor(widths.length * 0.9)] || widths[widths.length - 1];
  const avail = sheet.clientWidth - 22;
  const simple = !state.view.showTab;
  const px = Math.max(simple ? 12 : 9, Math.min(simple ? 17 : 15, avail / (typical * 0.61)));
  sheet.style.setProperty('--sheet-font', `${px.toFixed(1)}px`);
}
window.addEventListener('resize', () => state.analysis && fitSheetFont());

function seek(t) {
  audioEl.currentTime = Math.max(0, t);
  audioEl.play().catch(() => {});
}

function renderLyricsEditor() {
  const ol = $('lyrics-editor');
  ol.innerHTML = '';
  if (!state.lyrics.length) {
    ol.innerHTML = '<li class="hint">No lyrics yet. Turn on Whisper or paste lyrics above, then analyse or apply.</li>';
    return;
  }
  state.lyrics.forEach((line, i) => {
    const li = document.createElement('li');
    const tb = document.createElement('button');
    tb.type = 'button';
    tb.className = 't';
    tb.textContent = formatTime(line.start);
    tb.addEventListener('click', () => seek(line.start));
    const input = document.createElement('input');
    input.type = 'text';
    input.value = line.text;
    input.setAttribute('aria-label', `Lyric line at ${formatTime(line.start)}`);
    input.addEventListener('input', () => {
      state.lyrics[i] = editLine(state.lyrics[i], input.value);
      scheduleSheetRender();
    });
    li.append(tb, input);
    ol.appendChild(li);
  });
}

function renderChords() {
  const chords = state.chords;
  const tl = $('chord-timeline');
  tl.innerHTML = '';
  for (const c of chords) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<span class="t"></span><span class="c"></span>';
    b.querySelector('.t').textContent = formatTime(c.start);
    b.querySelector('.c').textContent = c.chord;
    b.addEventListener('click', () => seek(c.start));
    li.appendChild(b);
    tl.appendChild(li);
  }
  if (!chords.length) tl.innerHTML = '<li class="hint">No clear chords detected.</li>';

  const dg = $('chord-diagrams');
  dg.innerHTML = '';
  for (const name of [...new Set(chords.map((c) => c.chord))]) {
    const div = document.createElement('div');
    div.className = 'diagram';
    div.innerHTML = `<div class="name"></div>${chordDiagramSVG(name)}`;
    div.querySelector('.name').textContent = name;
    dg.appendChild(div);
  }
  if (!dg.children.length) dg.innerHTML = '<p class="hint">—</p>';
}

/* ---------- Playback highlight ---------- */
function highlight() {
  const t = audioEl.currentTime;
  const idx = state.rows.findIndex((r) => !r.empty && t >= r.start && t < r.end);
  if (idx !== state.activeRow) {
    state.activeRow = idx;
    const sheet = $('sheet');
    sheet.querySelectorAll('.block.active').forEach((b) => b.classList.remove('active'));
    const el = sheet.querySelector(`.block[data-row="${idx}"]`);
    if (el) {
      el.classList.add('active');
      if (state.view.follow && !audioEl.paused) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  const cur = state.chords.find((c) => t >= c.start && t < c.end);
  $('now-chord').textContent = cur ? cur.chord : '—';
  const lines = $('lyrics-editor').children;
  state.lyrics.forEach((l, i) => lines[i]?.classList.toggle('active', t >= l.start && t < (l.end ?? l.start + 3)));
}
audioEl.addEventListener('timeupdate', highlight);
audioEl.addEventListener('seeked', highlight);

/* ---------- Sheet toolbar ---------- */
function setView(showTab) {
  state.view.showTab = showTab;
  $('view-full').setAttribute('aria-pressed', String(showTab));
  $('view-simple').setAttribute('aria-pressed', String(!showTab));
  renderSheet();
}
$('view-full').addEventListener('click', () => setView(true));
$('view-simple').addEventListener('click', () => setView(false));
$('per-row').addEventListener('change', (e) => {
  state.view.perRow = +e.target.value;
  renderSheet();
});
$('grid-res').addEventListener('change', (e) => {
  state.view.sub = +e.target.value;
  renderSheet();
});
$('shift-left').addEventListener('click', () => {
  state.tempo.shift -= 1;
  renderSheet();
});
$('shift-right').addEventListener('click', () => {
  state.tempo.shift += 1;
  renderSheet();
});
$('follow').addEventListener('change', (e) => (state.view.follow = e.target.checked));

/* ---------- Copy ---------- */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  $('copy-msg').textContent = 'Copied to clipboard ✓';
  setTimeout(() => ($('copy-msg').textContent = ''), 2500);
}

$('copy-sheet').addEventListener('click', () => {
  if (!state.analysis) return;
  const used = [...new Set(state.chords.map((c) => c.chord))]
    .map((c) => `${c} ${chordShapeText(c)}`)
    .join('   ');
  const head = [
    state.name,
    `Tempo: ${Math.round(effectiveBpm())} BPM   Time: ${$('timesig').selectedOptions[0].text}   Tuning: EADGBE`,
    used ? `Chords: ${used}` : '',
  ].filter(Boolean).join('\n');
  copyText(`${head}\n\n${sheetToText(state.rows)}\n`);
});

renderTempoPanel();
