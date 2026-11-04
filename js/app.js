import { parseYouTubeId, parseStartSeconds } from './youtube.js';
import { decodeBlob, toMono, Recorder } from './audio.js';
import { formatTime, notesToTab } from './tab.js';
import { chordDiagramSVG, chordShapeText } from './chords.js';

const $ = (id) => document.getElementById(id);
const SAMPLE_RATE = 22050; // Basic Pitch 需要 22050 Hz；和弦偵測也共用同一份訊號

const state = {
  blob: null,
  name: '',
  objectUrl: null,
  chords: [],
  tabText: '',
  busy: false,
};

/* ---------- 1. YouTube ---------- */
$('yt-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = $('yt-url').value;
  const id = parseYouTubeId(raw);
  const err = $('yt-error');
  const box = $('yt-player');
  if (!id) {
    err.textContent = '無法辨識這個 YouTube 網址，請確認格式（例如 https://youtu.be/xxxxxxxxxxx）。';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  const start = parseStartSeconds(raw);
  const src = `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0${start ? `&start=${start}` : ''}`;
  box.innerHTML = '';
  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.title = 'YouTube 影片播放器';
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  box.appendChild(iframe);
  box.hidden = false;
});

/* ---------- 2. 音訊來源 ---------- */
function selectTab(which) {
  const isFile = which === 'file';
  $('tab-file').setAttribute('aria-selected', String(isFile));
  $('tab-mic').setAttribute('aria-selected', String(!isFile));
  $('panel-file').hidden = !isFile;
  $('panel-mic').hidden = isFile;
}
$('tab-file').addEventListener('click', () => selectTab('file'));
$('tab-mic').addEventListener('click', () => selectTab('mic'));

function setSource(blob, name) {
  state.blob = blob;
  state.name = name;
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = URL.createObjectURL(blob);
  $('source-audio').src = state.objectUrl;
  $('source-name').textContent = `目前音訊：${name}（${(blob.size / 1024 / 1024).toFixed(2)} MB）`;
  $('source-info').hidden = false;
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
    recorder = new Recorder({
      onTick: (s) => {
        recStatus.textContent = `錄音中… 已錄 ${s} 秒`;
      },
    });
    try {
      recBtn.disabled = true;
      await recorder.start();
      recBtn.textContent = '■ 停止錄音';
      recBtn.classList.add('recording');
      recStatus.classList.add('live');
      $('analyze-btn').disabled = true;
    } catch (err) {
      recorder = null;
      recStatus.textContent = `無法使用麥克風：${err.name === 'NotAllowedError' ? '權限被拒絕' : err.message}`;
    } finally {
      recBtn.disabled = false;
    }
  } else {
    const secs = Math.floor((performance.now() - recorder.startedAt) / 1000);
    const blob = await recorder.stop();
    recorder = null;
    recBtn.textContent = '● 重新錄音';
    recBtn.classList.remove('recording');
    recStatus.classList.remove('live');
    recStatus.textContent = `錄音完成，共 ${secs} 秒`;
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    setSource(blob, `錄音 ${new Date().toLocaleTimeString('zh-TW', { hour12: false })}.${ext}`);
  }
});

/* ---------- 3. 分析 ---------- */
// 各階段在總進度中所佔比例
const STAGES = {
  decode: { from: 0, to: 0.08, label: '解碼音訊' },
  loadEssentia: { from: 0.08, to: 0.12, label: '載入 Essentia.js' },
  chords: { from: 0.12, to: 0.35, label: '偵測和弦' },
  loadModel: { from: 0.35, to: 0.42, label: '載入 Basic Pitch 模型' },
  notes: { from: 0.42, to: 0.95, label: '轉譜音符' },
  tab: { from: 0.95, to: 1, label: '產生六線譜' },
};

function setProgress(stage, frac = 0) {
  const s = STAGES[stage];
  const pct = Math.round((s.from + (s.to - s.from) * Math.min(1, Math.max(0, frac))) * 100);
  $('progress-bar').style.width = `${pct}%`;
  $('progress').setAttribute('aria-valuenow', String(pct));
  $('progress-pct').textContent = `${pct}%`;
  $('progress-stage').textContent = `${s.label}…`;
}

function showError(msg) {
  const el = $('analyze-error');
  el.textContent = msg;
  el.hidden = !msg;
}

$('analyze-btn').addEventListener('click', async () => {
  if (!state.blob || state.busy) return;
  state.busy = true;
  $('analyze-btn').disabled = true;
  recBtn.disabled = true;
  $('file-input').disabled = true;
  showError('');
  $('progress-wrap').hidden = false;
  try {
    setProgress('decode', 0);
    const audioBuffer = await decodeBlob(state.blob);
    if (audioBuffer.duration > 600) {
      throw new Error('音訊超過 10 分鐘，請先剪短再分析（手機記憶體有限）。');
    }
    const signal = await toMono(audioBuffer, SAMPLE_RATE);
    setProgress('decode', 1);

    // 和弦（Essentia.js）
    setProgress('loadEssentia', 0);
    const chordsMod = await import('./chords.js');
    await chordsMod.loadEssentia();
    setProgress('loadEssentia', 1);
    const chords = await chordsMod.detectChords(signal, SAMPLE_RATE, (p) => setProgress('chords', p));

    // 音符（Basic Pitch）
    setProgress('loadModel', 0);
    const { transcribe } = await import('./transcribe.js');
    setProgress('loadModel', 0.5);
    let modelLoaded = false;
    const notes = await transcribe(signal, $('sensitivity').value, (p) => {
      if (!modelLoaded) {
        modelLoaded = true;
        setProgress('loadModel', 1);
      }
      setProgress('notes', p);
    });

    setProgress('tab', 0);
    const lineWidth = window.innerWidth < 520 ? 44 : 72;
    const { text, tabEvents } = notesToTab(notes, { lineWidth });
    setProgress('tab', 1);
    $('progress-stage').textContent = '分析完成';

    state.chords = chords;
    state.tabText = text;
    renderResults(chords, text, notes.length, tabEvents.length, audioBuffer.duration);
  } catch (err) {
    console.error(err);
    const msg = err?.name === 'EncodingError' || /decode/i.test(err?.message || '')
      ? '無法解碼此音檔，請改用 mp3 / m4a / wav。'
      : `分析失敗：${err?.message || err}`;
    showError(msg);
    $('progress-stage').textContent = '發生錯誤';
  } finally {
    state.busy = false;
    $('analyze-btn').disabled = !state.blob;
    recBtn.disabled = !Recorder.supported();
    $('file-input').disabled = false;
  }
});

/* ---------- 4. 結果 ---------- */
function renderResults(chords, tabText, noteCount, eventCount, duration) {
  const tl = $('chord-timeline');
  tl.innerHTML = '';
  if (!chords.length) {
    tl.innerHTML = '<li class="hint">沒有偵測到明顯的和弦。</li>';
  }
  for (const c of chords) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.start = String(c.start);
    b.innerHTML = `<span class="t">${formatTime(c.start)}</span><span class="c"></span>`;
    b.querySelector('.c').textContent = c.chord;
    b.addEventListener('click', () => {
      const a = $('source-audio');
      a.currentTime = c.start;
      a.play().catch(() => {});
    });
    li.appendChild(b);
    tl.appendChild(li);
  }

  const unique = [...new Set(chords.map((c) => c.chord))];
  const dg = $('chord-diagrams');
  dg.innerHTML = '';
  for (const name of unique) {
    const div = document.createElement('div');
    div.className = 'diagram';
    div.innerHTML = `<div class="name"></div>${chordDiagramSVG(name)}`;
    div.querySelector('.name').textContent = name;
    dg.appendChild(div);
  }
  if (!unique.length) dg.innerHTML = '<p class="hint">—</p>';

  $('tab-meta').textContent = `長度 ${formatTime(duration)}，偵測到 ${noteCount} 個音符、${eventCount} 個彈奏點。方括號內為該行開始時間。`;
  $('tab-output').textContent = tabText || '（沒有偵測到音符，可嘗試提高靈敏度）';
  $('copy-msg').textContent = '';
  $('results').hidden = false;
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 播放時標示目前和弦
$('source-audio').addEventListener('timeupdate', () => {
  const t = $('source-audio').currentTime;
  const buttons = $('chord-timeline').querySelectorAll('button');
  let active = null;
  buttons.forEach((b) => {
    if (+b.dataset.start <= t) active = b;
    b.classList.remove('active');
  });
  active?.classList.add('active');
});

function chordsAsText() {
  if (!state.chords.length) return '和弦時間軸：（無）';
  const lines = state.chords.map(
    (c) => `${formatTime(c.start).padStart(5)}  ${c.chord.padEnd(4)} ${chordShapeText(c.chord)}`,
  );
  return `和弦時間軸（時間 和弦 指法 E-A-D-G-B-e）：\n${lines.join('\n')}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 後備方案：舊瀏覽器或非安全來源
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
  $('copy-msg').textContent = '已複製到剪貼簿 ✓';
  setTimeout(() => ($('copy-msg').textContent = ''), 2500);
}

const header = () => `${state.name}\n標準調音 EADGBE\n`;
$('copy-tab').addEventListener('click', () => copyText(`${header()}\n${state.tabText}\n`));
$('copy-all').addEventListener('click', () =>
  copyText(`${header()}\n${chordsAsText()}\n\n六線譜：\n${state.tabText}\n`),
);
