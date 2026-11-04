// Plays a strumming pattern: a low "thump" for down-strokes, a bright "tick" for up-strokes,
// louder on accents, plus a faint click on every beat to keep time.
export class StrumPlayer {
  constructor({ onSlot } = {}) {
    this.onSlot = onSlot || (() => {});
    this.running = false;
    this.bpm = 100;
    this.speed = 1;
    this.pattern = null;
  }

  start(pattern) {
    if (pattern) this.pattern = pattern;
    if (this.running || !this.pattern) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx ||= new Ctx();
    this.ctx.resume?.();
    this.noise ||= this.makeNoise();
    this.running = true;
    this.slot = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.onSlot(-1);
  }

  slotDuration() {
    return 60 / (this.bpm * this.speed) / this.pattern.sub;
  }

  schedule() {
    const p = this.pattern;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      const i = this.slot % p.slots.length;
      const s = p.slots[i];
      if (i % p.sub === 0) this.tick(this.nextTime, i === 0);
      if (s.dir) this.strum(this.nextTime, s.dir, s.accent);
      const delay = Math.max(0, (this.nextTime - this.ctx.currentTime) * 1000);
      setTimeout(() => this.running && this.onSlot(i), delay);
      this.nextTime += this.slotDuration();
      this.slot++;
    }
  }

  makeNoise() {
    const len = Math.floor(this.ctx.sampleRate * 0.25);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  strum(t, dir, accent) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const down = dir === 'D';
    filter.type = down ? 'lowpass' : 'highpass';
    filter.frequency.value = down ? 900 : 2800;
    const peak = (down ? 0.9 : 0.45) * (accent ? 1.8 : 1);
    const len = down ? 0.09 : 0.05;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
    src.stop(t + len + 0.02);
    // pitched body so down/up are easy to tell apart on phone speakers
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.frequency.value = down ? 160 : 1300;
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(peak * 0.5, t + 0.003);
    og.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(og).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }

  tick(t, downbeat) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.value = downbeat ? 2000 : 1600;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.04);
  }
}
