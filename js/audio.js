// Audio decoding, resampling and microphone recording.

let sharedCtx = null;
function audioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!sharedCtx) sharedCtx = new Ctx();
  return sharedCtx;
}

/** Decode a Blob/File into an AudioBuffer. */
export async function decodeBlob(blob) {
  const buf = await blob.arrayBuffer();
  const ctx = audioContext();
  return await new Promise((resolve, reject) => {
    // Older Safari only supports the callback form
    const p = ctx.decodeAudioData(buf, resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
}

/** Mono Float32Array at the target sample rate. */
export async function toMono(audioBuffer, targetRate) {
  const length = Math.ceil(audioBuffer.duration * targetRate);
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new Offline(1, length, targetRate);
  const src = off.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return types.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
}

/** Simple recorder: start() / stop() -> Blob, reports elapsed seconds. */
export class Recorder {
  constructor({ onTick } = {}) {
    this.onTick = onTick || (() => {});
    this.chunks = [];
    this.timer = null;
  }

  static supported() {
    return !!(navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const mimeType = pickMimeType();
    this.mr = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.mr.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.mr.start(250);
    this.startedAt = performance.now();
    this.onTick(0);
    this.timer = setInterval(() => {
      this.onTick(Math.floor((performance.now() - this.startedAt) / 1000));
    }, 200);
  }

  stop() {
    return new Promise((resolve) => {
      clearInterval(this.timer);
      this.mr.onstop = () => {
        this.stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(this.chunks, { type: this.mr.mimeType || 'audio/webm' }));
      };
      this.mr.stop();
    });
  }
}
