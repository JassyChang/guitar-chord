// Look-ahead Web Audio metronome. Accents beat 1 of each bar.
export class Metronome {
  constructor({ onBeat } = {}) {
    this.bpm = 120;
    this.beatsPerBar = 4;
    this.onBeat = onBeat || (() => {});
    this.running = false;
  }

  start() {
    if (this.running) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx ||= new Ctx();
    this.ctx.resume?.();
    this.running = true;
    this.beat = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
  }

  schedule() {
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.click(this.nextTime, this.beat % this.beatsPerBar === 0);
      const beatInBar = this.beat % this.beatsPerBar;
      const delay = Math.max(0, (this.nextTime - this.ctx.currentTime) * 1000);
      setTimeout(() => this.running && this.onBeat(beatInBar), delay);
      this.nextTime += 60 / this.bpm;
      this.beat++;
    }
  }

  click(t, accent) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = accent ? 1500 : 1000;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.5, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }
}
