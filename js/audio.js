// 全部音效都用 WebAudio 即時合成，不需要任何音檔。
export class Sfx {
  constructor() { this.ctx = null; this.vol = 0.6; }

  // 瀏覽器規定要有使用者點擊後才能出聲
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = this.vol;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, len);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }

  _out(gain, pan) {
    const g = this.ctx.createGain(); g.gain.value = gain;
    if (pan && this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(this.master); }
    else g.connect(this.master);
    return g;
  }
  _noise(dur, freq, type, gain, pan, q = 0.8) {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this._out(1, pan);
    const env = c.createGain(); env.gain.setValueAtTime(gain, t); env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(env); env.connect(g);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }
  _tone(f0, f1, dur, gain, wave = 'sine', pan = 0, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = wave;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const env = c.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(gain, t + 0.005); env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(env); env.connect(this._out(1, pan));
    o.start(t); o.stop(t + dur + 0.02);
  }

  // dist/pan：對手開槍時依距離變小聲、依方向左右偏
  shot(snd, dist = 0, pan = 0) {
    if (!this.ctx) return;
    const att = dist > 0 ? Math.max(0.12, 1 / (1 + dist * 0.07)) : 1;
    const g = snd.gain * att * 0.55;
    this._noise(snd.dur, snd.f * (dist > 0 ? 0.7 : 1), 'lowpass', g, pan);
    this._noise(snd.dur * 0.35, snd.f * 2.5, 'bandpass', g * 0.6, pan, 1.5);
    this._tone(snd.thump * 1.6, snd.thump * 0.5, snd.dur * 0.7, g * 0.9, 'triangle', pan);
  }
  explosion(dist = 0, pan = 0) {
    if (!this.ctx) return;
    const att = Math.max(0.2, 1 / (1 + dist * 0.05));
    this._noise(0.9, 380, 'lowpass', 1.1 * att, pan);
    this._noise(0.25, 1800, 'bandpass', 0.5 * att, pan);
    this._tone(90, 28, 0.7, 1.0 * att, 'sine', pan);
  }
  hit(head) { if (!this.ctx) return; if (head) { this._tone(1900, 1500, 0.09, 0.3, 'square'); this._tone(2600, 2400, 0.12, 0.2, 'sine', 0, 0.03); } else this._tone(1100, 800, 0.06, 0.25, 'square'); }
  kill() { if (!this.ctx) return; this._tone(880, 880, 0.12, 0.3, 'triangle'); this._tone(1320, 1320, 0.25, 0.3, 'triangle', 0, 0.1); }
  hurt() { if (!this.ctx) return; this._tone(160, 70, 0.18, 0.6, 'sawtooth'); this._noise(0.1, 500, 'lowpass', 0.4, 0); }
  blockBreak(dist = 0) { if (!this.ctx) return; const a = Math.max(0.15, 1 / (1 + dist * 0.1)); this._noise(0.18, 600, 'lowpass', 0.45 * a, 0); this._tone(140, 60, 0.12, 0.3 * a, 'triangle'); }
  dry() { if (!this.ctx) return; this._tone(900, 700, 0.03, 0.15, 'square'); }
  reload(step) { if (!this.ctx) return; this._noise(0.05, step ? 2600 : 1600, 'bandpass', 0.3, 0, 3); this._tone(step ? 500 : 320, 200, 0.04, 0.15, 'square'); }
  swap() { if (!this.ctx) return; this._noise(0.07, 1200, 'bandpass', 0.2, 0, 2); }
  jump() { if (!this.ctx) return; this._noise(0.08, 300, 'lowpass', 0.15, 0); }
  land() { if (!this.ctx) return; this._noise(0.1, 220, 'lowpass', 0.3, 0); }
  step() { if (!this.ctx) return; this._noise(0.05, 260 + Math.random() * 80, 'lowpass', 0.09, 0); }
  // 對手的腳步聲：22 公尺內聽得到，越近越大聲、有左右方向
  stepRemote(dist, pan) { if (!this.ctx) return; const a = Math.max(0, 1 - dist / 22); if (a <= 0) return; this._noise(0.07, 330 + Math.random() * 90, 'lowpass', 0.4 * a, pan); this._tone(110, 70, 0.05, 0.22 * a, 'sine', pan); }
  landRemote(dist, pan) { if (!this.ctx) return; const a = Math.max(0, 1 - dist / 24); if (a <= 0) return; this._noise(0.13, 240, 'lowpass', 0.6 * a, pan); this._tone(90, 50, 0.1, 0.35 * a, 'sine', pan); }
  bounce(dist = 0) { if (!this.ctx) return; this._tone(700, 400, 0.05, 0.2 * Math.max(0.2, 1 / (1 + dist * 0.1)), 'triangle'); }
  pickup() { if (!this.ctx) return; this._tone(660, 990, 0.12, 0.25, 'sine'); this._tone(990, 1320, 0.15, 0.2, 'sine', 0, 0.08); }
  ui() { if (!this.ctx) return; this._tone(700, 900, 0.05, 0.12, 'sine'); }
  beep(hi) { if (!this.ctx) return; this._tone(hi ? 1040 : 520, hi ? 1040 : 520, hi ? 0.35 : 0.12, 0.25, 'triangle'); }
  win() { if (!this.ctx) return; [523, 659, 784, 1047].forEach((f, i) => this._tone(f, f, 0.25, 0.25, 'triangle', 0, i * 0.11)); }
  lose() { if (!this.ctx) return; [392, 330, 262].forEach((f, i) => this._tone(f, f * 0.97, 0.3, 0.25, 'triangle', 0, i * 0.16)); }
}
