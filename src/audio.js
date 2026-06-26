// Procedural sound effects via WebAudio — no audio assets required.

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.alarmNodes = null;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // 1s of white noise, reused for every shot/burst
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  _noiseBurst({ gain = 0.5, dur = 0.18, freq = 1800, q = 0.7, type = 'bandpass' }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  _blip({ freq = 880, dur = 0.07, gain = 0.18, type = 'square', slide = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  shot(suppressed) {
    if (suppressed) {
      this._noiseBurst({ gain: 0.30, dur: 0.09, freq: 750, q: 1.2, type: 'lowpass' });
      this._blip({ freq: 220, dur: 0.05, gain: 0.10, type: 'sine', slide: -140 });
    } else {
      this._noiseBurst({ gain: 0.85, dur: 0.22, freq: 1500, q: 0.5 });
      this._noiseBurst({ gain: 0.4, dur: 0.3, freq: 320, q: 0.8, type: 'lowpass' });
    }
  }

  enemyShot(dist) {
    const g = Math.max(0.06, 0.7 * (1 - dist / 80));
    this._noiseBurst({ gain: g, dur: 0.2, freq: 1200, q: 0.6 });
  }

  dryFire() { this._blip({ freq: 1400, dur: 0.04, gain: 0.1 }); }

  reload() {
    this._blip({ freq: 600, dur: 0.05, gain: 0.14 });
    setTimeout(() => this._blip({ freq: 900, dur: 0.05, gain: 0.14 }), 350);
    setTimeout(() => this._blip({ freq: 500, dur: 0.06, gain: 0.16 }), 900);
  }

  hit(kill) {
    this._blip({ freq: kill ? 320 : 1100, dur: 0.06, gain: 0.16, type: kill ? 'sawtooth' : 'square' });
  }

  hurt() {
    this._blip({ freq: 140, dur: 0.18, gain: 0.3, type: 'sawtooth', slide: -70 });
  }

  beep() { this._blip({ freq: 1320, dur: 0.06, gain: 0.12, type: 'sine' }); }

  planted() {
    [0, 140, 280].forEach((d, i) =>
      setTimeout(() => this._blip({ freq: 880 + i * 220, dur: 0.1, gain: 0.18, type: 'sine' }), d));
  }

  setAlarm(on) {
    if (!this.ctx) return;
    if (on && !this.alarmNodes) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 620;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 1.4;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 180;
      lfo.connect(lfoGain).connect(o.frequency);
      const g = this.ctx.createGain();
      g.gain.value = 0.05;
      o.connect(g).connect(this.master);
      o.start(); lfo.start();
      this.alarmNodes = { o, lfo, g };
    } else if (!on && this.alarmNodes) {
      const { o, lfo, g } = this.alarmNodes;
      g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.4);
      setTimeout(() => { try { o.stop(); lfo.stop(); } catch (e) {} }, 500);
      this.alarmNodes = null;
    }
  }

  stinger(win) {
    const seq = win ? [523, 659, 784, 1047] : [392, 330, 262, 196];
    seq.forEach((f, i) =>
      setTimeout(() => this._blip({ freq: f, dur: 0.28, gain: 0.16, type: 'triangle' }), i * 170));
  }
}
