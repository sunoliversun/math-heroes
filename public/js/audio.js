// Procedural sound effects + gentle background music using the Web Audio API.
// No audio files needed — everything is synthesized. Kid-friendly, soft tones.

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicGain = null;
    this.musicTimer = null;
  }

  // Must be called from a user gesture (browser autoplay policy).
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  toggle() { this.enabled = !this.enabled; this.master.gain.value = this.enabled ? 0.5 : 0; return this.enabled; }

  _beep(freq, dur, type = 'sine', vol = 0.3, when = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  correct() { // happy rising arpeggio
    [523, 659, 784, 1047].forEach((f, i) => this._beep(f, 0.18, 'triangle', 0.3, i * 0.07));
  }
  wrong() { // soft low buzz (not scary)
    this._beep(200, 0.18, 'sine', 0.25);
    this._beep(150, 0.22, 'sine', 0.2, 0.08);
  }
  collect() { this._beep(880, 0.1, 'square', 0.18); this._beep(1320, 0.12, 'square', 0.15, 0.05); }
  jump() { this._beep(440, 0.12, 'sine', 0.2); this._beep(660, 0.1, 'sine', 0.15, 0.05); }
  coin() { this._beep(988, 0.08, 'square', 0.15); this._beep(1319, 0.1, 'square', 0.12, 0.04); }
  stage() { [523, 587, 659, 784, 880].forEach((f, i) => this._beep(f, 0.25, 'triangle', 0.3, i * 0.1)); }
  win() {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this._beep(f, 0.3, 'triangle', 0.35, i * 0.15));
  }
  buy() { this._beep(660, 0.1, 'triangle', 0.25); this._beep(990, 0.12, 'triangle', 0.2, 0.06); }

  // A simple looping pentatonic background melody so it never sounds "wrong".
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const scale = [261.6, 293.7, 329.6, 392.0, 440.0, 523.2];
    let step = 0;
    const tick = () => {
      if (!this.enabled) return;
      const note = scale[Math.floor(Math.random() * scale.length)];
      this._beep(note, 0.5, 'sine', 0.05);
      if (Math.random() < 0.5) this._beep(note / 2, 0.8, 'triangle', 0.04, 0.0);
      step++;
    };
    this.musicTimer = setInterval(tick, 600);
  }
  stopMusic() { if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; } }
}
