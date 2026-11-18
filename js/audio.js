// 全部音效都用 WebAudio 即時合成，不需要任何音檔。
// 作法：每種聲音先用下面的小型 DSP 工具「烘焙」成 AudioBuffer（第一次用到才算，之後重複播放），
// 播放時每個聲音只要 3~8 個節點；再經過 殘響匯流排（自己生成的脈衝響應）→ 壓縮器 → 限幅器，疊再多也不會破音。
//
// 訊號路徑：
//   世界音效 ─┬→ bus ──────────────┐
//             └→ revIn → 殘響 → wet ┼→ duckG（閃光耳鳴時壓低）→ muffle（悶住）→ comp → 限幅 → master（音量）→ 喇叭
//   環境音 → ambBus ────────────────┘                                              ↑
//   介面／命中提示／耳鳴 → uiBus ───────────────────────────────────────────────────┘
const TAU = Math.PI * 2, PAN = 0.9, WET = 2, VARS = 3;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const rr = (a, b) => a + (b - a) * Math.random();
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);          // 不是正常數字就用預設值（呼叫端傳 NaN／undefined 也不會讓 WebAudio 丟錯）
// 距離衰減（公尺）：k 越大掉越快，floor = 再遠也聽得到的底限
const att = (dist, k, floor = 0) => Math.max(floor, 1 / (1 + Math.max(0, dist) * k));
const prng = (s) => () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h; };
const TRI = [[1, 1], [3, 0.11], [5, 0.04]];                       // 接近三角波的泛音
const bell = (t, len, p = 2) => Math.sin(Math.PI * clamp(t / len)) ** p;   // 鐘形包絡（呼嘯聲用）

// ═══ 離線合成工具：全部在 Float32Array 上運算 ═══
class D {
  constructor(sr, seed) { this.sr = sr; this.r = prng(seed); }
  z(sec) { return new Float32Array(Math.max(16, Math.round(sec * this.sr))); }
  rnd(a, b) { return a + (b - a) * this.r(); }
  noise(sec) { const x = this.z(sec), r = this.r; for (let i = 0; i < x.length; i++) x[i] = r() * 2 - 1; return x; }
  // 布朗噪音（低頻為主，隆隆聲用）
  brown(sec) { const x = this.z(sec), r = this.r; let y = 0; for (let i = 0; i < x.length; i++) { y = y * 0.996 + (r() * 2 - 1) * 0.08; x[i] = y; } return x; }
  // 雙二階濾波（RBJ）；f 可以是 Hz，或 (進度 0~1) => Hz 的函式（每 32 個取樣更新一次係數）
  filt(x, type, f, q = 0.707) {
    const sr = this.sr, n = x.length, fn = typeof f === 'function' ? f : null;
    let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const set = (hz) => {
      const w = TAU * clamp(hz, 12, sr * 0.45) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
      if (type === 'lp') { b1 = (1 - cs) / a0; b0 = b2 = b1 / 2; } else if (type === 'hp') { b1 = -(1 + cs) / a0; b0 = b2 = -b1 / 2; } else { b0 = al / a0; b1 = 0; b2 = -b0; }
      a1 = -2 * cs / a0; a2 = (1 - al) / a0;
    };
    set(fn ? fn(0) : f);
    for (let i = 0; i < n; i++) {
      if (fn && (i & 31) === 0) set(fn(i / n));
      const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y;
    }
    return x;
  }
  lp(x, f, q) { return this.filt(x, 'lp', f, q); }
  hp(x, f, q) { return this.filt(x, 'hp', f, q); }
  bp(x, f, q) { return this.filt(x, 'bp', f, q); }
  // 指數衰減包絡：atk 秒線性起音，之後以時間常數 tau 衰減
  dec(x, tau, atk = 0.0005) { const na = Math.max(1, Math.round(atk * this.sr)), k = Math.exp(-1 / (tau * this.sr)); let e = 1; for (let i = 0; i < x.length; i++) { if (i < na) x[i] *= i / na; else { x[i] *= e; e *= k; } } return x; }
  // 先漲後消的包絡 (1-e^(-t/a))·e^(-t/b)：尾音、隆隆聲用
  swell(x, a, b) { const ka = Math.exp(-1 / (a * this.sr)), kb = Math.exp(-1 / (b * this.sr)); let ea = 1, eb = 1; for (let i = 0; i < x.length; i++) { x[i] *= (1 - ea) * eb; ea *= ka; eb *= kb; } return x; }
  // 乘上任意包絡 fn(秒)；step > 1 = 每 step 個取樣才算一次、中間線性內插（變化慢的包絡用，省時間）
  mul(x, fn, step = 1) {
    const sr = this.sr, n = x.length;
    if (step <= 1) { for (let i = 0; i < n; i++) x[i] *= fn(i / sr); return x; }
    for (let i = 0, g0 = fn(0); i < n; i += step) { const g1 = fn((i + step) / sr), m = Math.min(step, n - i), dg = (g1 - g0) / step; for (let j = 0; j < m; j++) x[i + j] *= g0 + dg * j; g0 = g1; }
    return x;
  }
  // 正弦滑音：頻率從 f0 以時間常數 glide 滑向 f1
  sine(sec, f0, f1 = f0, glide = 0.05) { const x = this.z(sec), sr = this.sr, k = Math.exp(-1 / (glide * sr)), w1 = TAU * f1 / sr; let ph = 0, dw = TAU * (f0 - f1) / sr; for (let i = 0; i < x.length; i++) { ph += w1 + dw; dw *= k; x[i] = Math.sin(ph); } return x; }
  // 有泛音的音符：f0→f1 線性滑音、指數衰減；harm = [[第幾泛音, 音量], …]
  tone(sec, f0, f1 = f0, tau = sec / 4, harm = TRI, atk = 0.004) {
    const x = this.z(sec), sr = this.sr, n = x.length, na = Math.max(1, Math.round(atk * sr)), k = Math.exp(-1 / (tau * sr)), nh = harm.length, hs = harm.map((h) => h[0]), gs = harm.map((h) => h[1]), w0 = TAU * f0 / sr, dw = TAU * (f1 - f0) / sr / n;
    let ph = 0, e = 1;
    for (let i = 0; i < n; i++) { ph += w0 + dw * i; let v = 0; for (let j = 0; j < nh; j++) v += Math.sin(ph * hs[j]) * gs[j]; if (i < na) x[i] = v * i / na; else { x[i] = v * e; e *= k; } }
    return x;
  }
  // 鋸齒波音符（銅管感；之後要再過低通）
  saw(sec, f, tau, atk = 0.006) { const x = this.z(sec), inc = f / this.sr; let p = 0; for (let i = 0; i < x.length; i++) { p += inc; if (p > 1) p -= 1; x[i] = 2 * p - 1; } return this.dec(x, tau, atk); }
  // 敲擊泛音（金屬、玻璃、彈殼）：modes = [[Hz, 衰減秒, 音量], …]，k = 整體音高倍率。用二階共振遞迴產生衰減正弦，不必每個取樣算 sin
  ring(sec, modes, k = 1) {
    const x = this.z(sec), sr = this.sr, n = x.length;
    for (const [f, tau, g] of modes) { const w = TAU * Math.min(f * k, sr * 0.45) / sr, r = Math.exp(-1 / (tau * sr)), c = 2 * r * Math.cos(w), r2 = r * r; let a = 0, b = -g * Math.sin(w) / r; for (let i = 1; i < n; i++) { const y = c * a - r2 * b; b = a; a = y; x[i] += y; } }
    return x;
  }
  // 稀疏的顆粒噪音（碎石、火星、沙粒）：rate 每秒幾顆、tau 每顆的衰減、dens(t) 密度隨時間的變化
  grains(sec, rate, tau, dens) {
    const x = this.z(sec), sr = this.sr, r = this.r, k = Math.exp(-1 / (tau * sr)); let e = 0, p = rate / sr;
    for (let i = 0; i < x.length; i++) { if (dens && (i & 63) === 0) p = rate / sr * dens(i / sr); if (r() < p) e = Math.max(e, 0.2 + 0.8 * r() * r()); if (e > 1e-5) { x[i] = (r() * 2 - 1) * e; e *= k; } }
    return x;
  }
  // 緩慢的不規則起伏（-1~1），陣風、海浪、火焰用
  lfo(hz) { const a = [0, 1, 2].map((i) => [TAU * hz * (0.6 + i * 0.55 + this.r() * 0.3), this.r() * TAU]); return (t) => (Math.sin(a[0][0] * t + a[0][1]) + Math.sin(a[1][0] * t + a[1][1]) * 0.6 + Math.sin(a[2][0] * t + a[2][1]) * 0.4) / 2; }
  // 疊一層：先把 src 正規化到峰值 1，所以 g 就是這一層的峰值音量；at = 起始秒數
  add(dst, src, g = 1, at = 0) { let m = 0; for (let i = 0; i < src.length; i++) { const v = Math.abs(src[i]); if (v > m) m = v; } return this.put(dst, src, m > 0 ? g / m : 0, at); }
  // 疊一層（不正規化）
  put(dst, src, g = 1, at = 0) { const o = Math.round(at * this.sr), n = Math.min(src.length, dst.length - o); for (let i = 0; i < n; i++) dst[o + i] += src[i] * g; return dst; }
  // 飽和（tanh）：加諧波、把峰值壓扁，槍聲和爆炸的「力道」來源
  sat(x, k) { const m = 1 / Math.tanh(k); for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * k) * m; return x; }
  // 做成無縫循環：把最後 sec 秒交叉淡化到開頭
  loopify(x, sec) { const n = Math.round(sec * this.sr), m = x.length - n, y = x.slice(0, m); for (let i = 0; i < n; i++) { const a = i / n; y[i] = x[i] * Math.sqrt(a) + x[m + i] * Math.sqrt(1 - a); } return y; }
  // 收尾：正規化到指定峰值；fade > 0 時頭尾淡入淡出（避免爆音），循環用的緩衝傳 0
  fin(c, peak = 0.9, fade = 0.01) {
    const chs = c instanceof Float32Array ? [c] : c, nf = Math.round(fade * this.sr); let m = 0;
    for (const x of chs) for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > m) m = v; }
    const k = m > 0 ? peak / m : 0;
    for (const x of chs) { const n = x.length; for (let i = 0; i < n; i++) x[i] *= k; if (nf) { for (let i = 0; i < nf && i < n; i++) x[n - 1 - i] *= i / nf; for (let i = 0; i < 8; i++) x[i] *= i / 8; } }
    return chs;
  }
}

// ═══ 槍聲 ═══
// f0/d0/th0 = 這類槍的基準 snd.f / snd.dur / snd.thump（同類的不同槍會依自己的數值在基準上微調音色）
// ck/ckT 爆音高通 Hz／衰減、bd/bq/bdT 本體帶通 Hz／Q／衰減、th/thT 低頻量／衰減、tl 尾音長度、tlF 尾音低通、tg 尾音量
// drv 飽和、send 殘響送出量、lvl 峰值、mech 機件聲 [[秒, 音量, Hz], …]（霰彈槍泵動、狙擊槍拉栓、自動槍的槍機）
const GUN = {
  pistol:   { f0: 1800, d0: 0.12, th0: 180, ck: 3800, ckT: 0.004, bd: 1700, bq: 0.9, bdT: 0.018, th: 0.55, thT: 0.022, tl: 0.26, tlF: 3200, tg: 0.24, drv: 1.6, send: 0.1, lvl: 0.8, mech: [[0.045, 0.07, 3400]] },
  smg:      { f0: 2200, d0: 0.1, th0: 210, ck: 4800, ckT: 0.003, bd: 2400, bq: 1.1, bdT: 0.012, th: 0.45, thT: 0.016, tl: 0.2, tlF: 3800, tg: 0.2, drv: 1.4, send: 0.09, lvl: 0.72, mech: [[0.03, 0.06, 3800]] },
  rifle:    { f0: 1400, d0: 0.16, th0: 150, ck: 3400, ckT: 0.005, bd: 1450, bq: 0.8, bdT: 0.026, th: 0.65, thT: 0.032, tl: 0.42, tlF: 2700, tg: 0.3, drv: 2.0, send: 0.2, lvl: 0.9, mech: [[0.04, 0.07, 3000]] },
  shotgun:  { f0: 800, d0: 0.3, th0: 90, ck: 1900, ckT: 0.01, bd: 600, bq: 0.5, bdT: 0.06, th: 0.8, thT: 0.06, tl: 0.62, tlF: 1700, tg: 0.36, drv: 2.8, send: 0.28, lvl: 1.0, mech: [[0.33, 0.14, 1500], [0.47, 0.18, 1900]] },
  sniper:   { f0: 700, d0: 0.42, th0: 70, ck: 3000, ckT: 0.006, bd: 900, bq: 0.7, bdT: 0.045, th: 0.85, thT: 0.075, tl: 0.9, tlF: 2100, tg: 0.38, drv: 2.4, send: 0.38, lvl: 1.0, mech: [[0.52, 0.1, 2100], [0.62, 0.07, 1300], [0.86, 0.12, 2400]] },
  lmg:      { f0: 1000, d0: 0.18, th0: 110, ck: 2400, ckT: 0.006, bd: 820, bq: 0.9, bdT: 0.034, th: 0.75, thT: 0.042, tl: 0.5, tlF: 2000, tg: 0.3, drv: 2.3, send: 0.22, lvl: 0.92, mech: [[0.045, 0.1, 2200]] },
  launcher: { f0: 500, d0: 0.5, th0: 60, send: 0.25, lvl: 0.9 },
};
// snd.kind 沒給（或不認得）時，從 f / dur 猜是哪一類槍
function kindOf(s) {
  if (GUN[s.kind]) return s.kind;
  if (!s.f) return 'rifle';
  const dur = s.dur || 0.16;
  if (s.f <= 550) return 'launcher';
  if (dur >= 0.38) return 'sniper';
  if (s.f >= 2000) return 'smg';
  if (s.f >= 1600) return 'pistol';
  if (dur >= 0.27) return s.f >= 880 ? 'pistol' : 'shotgun';   // 左輪 = 很重的手槍
  return s.f > 1050 ? 'rifle' : 'lmg';
}
// 近處聽到的槍聲：爆音＋本體＋低頻衝擊（中置）＋左右不相關的尾音與早期反射
function gunNear(d, e) {
  const K = e.K, fr = Math.pow(clamp(e.f / K.f0, 0.5, 2), 0.7), tl = K.tl * Math.pow(clamp(e.dur / K.d0, 0.5, 2), 0.6), fe = 45 + e.th * 0.45;
  const T = Math.max(tl * 1.45 + 0.06, K.mech[K.mech.length - 1][0] + 0.12), M = d.z(T);
  d.add(M, d.dec(d.hp(d.noise(K.ckT * 9), K.ck * fr, 0.7), K.ckT, 0.0002), 1);                         // 爆音：高通白噪，只有幾毫秒
  d.add(M, d.dec(d.bp(d.noise(K.bdT * 9), K.bd * fr, K.bq), K.bdT, 0.0004), 1.1);                       // 本體：中頻帶通噪音
  d.add(M, d.dec(d.bp(d.noise(K.bdT * 14), K.bd * fr * 0.4, 0.7), K.bdT * 1.7, 0.001), 0.7);            // 胸腔感
  d.add(M, d.dec(d.sine(K.thT * 8, fe * 3, fe, K.thT * 0.35), K.thT, 0.0015), K.th);                    // 低頻衝擊：正弦很快往下滑到 fe
  d.sat(M, K.drv);
  const slap = d.lp(M.slice(0, d.z(0.1).length), 1700);
  const ch = (a, b) => {
    const x = M.slice(), tn = d.hp(d.lp(d.noise(T), (p) => K.tlF * fr * (1 - 0.72 * p), 0.6), 160);
    d.add(x, d.swell(tn, 0.005, tl / 4.6), K.tg);                                                       // 尾音：越來越暗的擴散噪音
    d.put(x, slap, 0.2, a); d.put(x, slap, 0.11, b); return x;                                          // 附近牆面彈回來的早期反射
  };
  const L = ch(d.rnd(0.017, 0.03), d.rnd(0.06, 0.085)), R = ch(d.rnd(0.026, 0.042), d.rnd(0.075, 0.11));
  for (const [at, g, f] of K.mech) {                                                                    // 機件聲
    const c = d.z(0.08); d.add(c, d.dec(d.bp(d.noise(0.06), f, 2), 0.007, 0.0005), 1); d.add(c, d.ring(0.06, [[f * 0.62, 0.012, 1], [f * 1.9, 0.008, 0.6]]), 0.6);
    d.put(L, c, g, at); d.put(R, c, g * 0.9, at);
  }
  return d.fin([L, R], K.lvl, 0.012);
}
// 遠處聽到的槍聲：沒有爆音，只剩悶悶的轟聲、回音和在建築之間滾動的尾音
function gunFar(d, e) {
  const K = e.K, fr = Math.pow(clamp(e.f / K.f0, 0.5, 2), 0.7), tl = K.tl * Math.pow(clamp(e.dur / K.d0, 0.5, 2), 0.6) * 1.3 + 0.22, T = tl * 1.4 + 0.1, M = d.z(T), fe = 45 + e.th * 0.45;
  d.add(M, d.dec(d.lp(d.noise(K.bdT * 30), K.bd * fr * 0.55, 0.7), K.bdT * 2.4, 0.002), 1);
  d.add(M, d.dec(d.sine(K.thT * 14, fe * 2, fe * 0.8, K.thT), K.thT * 2, 0.003), 0.9 * K.th);
  d.add(M, d.dec(d.bp(d.noise(0.06), K.ck * fr * 0.45, 0.8), K.ckT * 1.5, 0.0005), 0.3);                // 殘留的一點點爆音
  d.sat(M, 1.4);
  const echo = d.lp(M.slice(), 480);
  const ch = (a, b) => {
    const x = M.slice(), tn = d.lp(d.noise(T), (p) => K.tlF * fr * (0.4 - 0.27 * p), 0.6);
    d.add(x, d.swell(tn, 0.03, tl / 4.6), 0.5);
    d.put(x, echo, 0.42, a); d.put(x, echo, 0.2, b); return x;
  };
  return d.fin([ch(d.rnd(0.08, 0.12), d.rnd(0.2, 0.26)), ch(d.rnd(0.12, 0.17), d.rnd(0.26, 0.33))], K.lvl * 0.8, 0.02);
}
// 火箭筒／榴彈槍：發射管的「咚」；dur 長的（火箭）多一段推進器呼嘯
function launcherBuf(d, e, far) {
  const wh = clamp((e.dur - 0.18) / 0.3), T = 0.5 + wh * 0.8, M = d.z(T), k = far ? 0.6 : 1;
  d.add(M, d.dec(d.bp(d.noise(0.4), e.f * 0.52, 4.5), 0.045, 0.001), 1.1);
  d.add(M, d.dec(d.sine(0.5, e.th * 2, e.th * 0.7, 0.04), 0.08, 0.002), 1);
  if (!far) d.add(M, d.dec(d.hp(d.noise(0.05), 2600), 0.005, 0.0003), 0.4);                             // 氣爆
  d.sat(M, 1.8);
  const ch = () => {
    const x = M.slice();
    if (wh > 0) d.add(x, d.dec(d.bp(d.noise(T), (p) => (380 + 2100 * Math.min(1, p * 1.8)) * k, 1), 0.12 + wh * 0.18, 0.06), 0.75 * wh);
    d.add(x, d.swell(d.lp(d.noise(T), 900 * k, 0.6), 0.01, 0.09), 0.3);
    return far ? d.lp(x, 900) : x;
  };
  return d.fin([ch(), ch()], far ? 0.7 : 0.9, 0.02);
}

// ═══ 爆炸 ═══
function boomNear(d) {
  const T = 2.5, M = d.z(T);
  d.add(M, d.dec(d.hp(d.noise(0.08), 1800, 0.7), 0.01, 0.0002), 0.9);                                   // 爆裂的瞬間
  d.add(M, d.dec(d.lp(d.noise(1.5), (p) => 6000 * Math.exp(-p * 6) + 200, 0.7), 0.16, 0.001), 1.3);     // 噪音爆發，很快變悶
  d.add(M, d.dec(d.bp(d.noise(1.5), 380, 0.5), 0.2, 0.002), 0.9);                                       // 中頻的轟鳴（小喇叭也聽得到）
  d.add(M, d.dec(d.sine(1.4, 170, 42, 0.12), 0.22, 0.003), 1.1);                                        // 低頻下墜
  d.add(M, d.dec(d.sine(0.5, 280, 85, 0.04), 0.07, 0.0015), 0.9);                                       // 打在胸口的那一下
  d.sat(M, 2.4);
  const ch = () => {
    const x = M.slice();
    d.add(x, d.swell(d.lp(d.noise(T), 210, 0.7), 0.04, 0.26), 0.6);                                                                    // 滾動的低頻尾音
    d.add(x, d.swell(d.hp(d.lp(d.noise(T), (p) => 1600 * Math.exp(-p * 3) + 260, 0.6), 130), 0.02, 0.25), 0.5);
    d.add(x, d.dec(d.bp(d.grains(T, 70, 0.004, (t) => t < 0.1 ? 0 : Math.exp(-(t - 0.1) / 0.36)), 2600, 0.6), 0.5, 0.001), 0.32);                           // 碎片落地的劈啪聲
    d.add(x, d.dec(d.bp(d.grains(T, 14, 0.02, (t) => t < 0.25 ? 0 : Math.exp(-(t - 0.25) / 0.4)), 500, 1), 0.5, 0.001), 0.3);                             // 比較大的石塊（越晚落地的越小聲）
    return x;
  };
  return d.fin([ch(), ch()], 1, 0.05);
}
function boomFar(d) {
  const T = 2.7, M = d.z(T);
  d.add(M, d.dec(d.lp(d.noise(1.2), 520, 0.7), 0.2, 0.004), 1.2);
  d.add(M, d.dec(d.sine(1.4, 120, 46, 0.15), 0.28, 0.006), 1.0);
  d.sat(M, 1.6);
  const echo = d.lp(M.slice(), 320);
  const ch = (a, b) => { const x = M.slice(); d.add(x, d.swell(d.lp(d.noise(T), 190), 0.08, 0.34), 0.7); d.put(x, echo, 0.4, a); d.put(x, echo, 0.2, b); return x; };
  return d.fin([ch(0.13, 0.31), ch(0.19, 0.4)], 0.9, 0.05);
}

// ═══ 腳步（依地面材質）═══
// th/thT/tg 腳跟悶響 Hz／衰減／量、sc/sq/scT/sg 鞋底摩擦、ck 硬地喀聲、ring/rg 共鳴、grit/gg 砂礫 [每秒顆數, 衰減, Hz]、soft 起音變慢
const SURF = {
  concrete: { th: 150, thT: 0.02, tg: 1, sc: 1500, sq: 0.8, scT: 0.016, sg: 0.6, ck: 0.35 },
  metal:    { th: 190, thT: 0.018, tg: 0.8, sc: 2700, sq: 1.2, scT: 0.012, sg: 0.3, ck: 0.4, ring: [[412, 0.07, 1], [977, 0.055, 0.7], [1723, 0.04, 0.5], [2630, 0.03, 0.3]], rg: 0.7 },
  wood:     { th: 200, thT: 0.028, tg: 1, sc: 820, sq: 2.2, scT: 0.026, sg: 0.6, ck: 0.12, ring: [[236, 0.04, 1], [518, 0.025, 0.5]], rg: 0.6 },
  dirt:     { th: 105, thT: 0.03, tg: 1, sc: 900, sq: 0.6, scT: 0.03, sg: 0.4, grit: [500, 0.003, 2400], gg: 0.35 },
  sand:     { th: 90, thT: 0.034, tg: 0.6, sc: 3300, sq: 0.6, scT: 0.05, sg: 0.8, soft: 0.012, grit: [900, 0.002, 5200], gg: 0.25 },
  rock:     { th: 170, thT: 0.016, tg: 0.9, sc: 2400, sq: 1, scT: 0.012, sg: 0.5, ck: 0.5, grit: [350, 0.004, 3200], gg: 0.3 },
};
// 呼叫端傳方塊名稱也認得
const ALIAS = { stone: 'rock', gravel: 'rock', brick: 'concrete', cement: 'concrete', steel: 'metal', iron: 'metal', plank: 'wood', crate: 'wood', grass: 'dirt', soil: 'dirt', ground: 'dirt', body: 'flesh', player: 'flesh' };
const surfOf = (s, flesh) => { s = ALIAS[s] || s; return SURF[s] || (flesh && s === 'flesh') ? s : 'concrete'; };
function stepBuf(d, S, heavy) {
  const k = heavy ? 0.72 : d.rnd(0.9, 1.1), w = heavy ? 1.6 : 1, x = d.z(heavy ? 0.42 : 0.28);
  const hit = (at, g) => {
    d.add(x, d.dec(d.lp(d.noise(0.12), S.th * 2.2 * k, 0.8), S.thT * w, S.soft || 0.001), g * S.tg, at);
    d.add(x, d.dec(d.sine(0.12, S.th * 1.4 * k, S.th * 0.6 * k, 0.02), S.thT * 1.3 * w, 0.002), g * S.tg * 0.8, at);
    d.add(x, d.dec(d.bp(d.noise(0.2), S.sc * k, S.sq), S.scT * w, S.soft || 0.001), g * S.sg, at);
    if (S.ck) d.add(x, d.dec(d.hp(d.noise(0.02), 3500), 0.0015, 0.0003), g * S.ck, at);
    if (S.ring) d.add(x, d.ring(0.2, S.ring, k * d.rnd(0.94, 1.06)), g * S.rg, at);
    if (S.grit) d.add(x, d.bp(d.grains(0.1, S.grit[0], S.grit[1], (t) => Math.exp(-t / 0.035)), S.grit[2] * k, 0.7), g * S.gg, at);
  };
  hit(0, 1);
  if (heavy) hit(d.rnd(0.018, 0.035), 0.8); else hit(d.rnd(0.055, 0.085), 0.3);   // 落地 = 兩腳一前一後；走路 = 腳跟 → 腳尖
  return d.fin(x, 0.9, 0.01);
}

// ═══ 子彈打到東西 ═══
const RICO = { metal: 0.35, rock: 0.25, concrete: 0.18 };        // 各材質出現跳彈聲的機率
function impactBuf(d, s) {
  const x = d.z(s === 'metal' ? 0.4 : 0.26), k = d.rnd(0.85, 1.2);
  const tick = (g) => d.add(x, d.dec(d.hp(d.noise(0.02), 4000), 0.0012, 0.0002), g);
  const band = (f, q, tau, g, atk) => d.add(x, d.dec(d.bp(d.noise(tau * 8), f * k, q), tau, atk), g);
  const grit = (rate, f, tau, g) => d.add(x, d.bp(d.grains(0.2, rate, 0.003, (t) => Math.exp(-t / tau)), f * k, 0.7), g);
  const thud = (f, tau, g) => d.add(x, d.dec(d.sine(tau * 8, f * 1.5, f * 0.6, tau), tau, 0.001), g);
  if (s === 'metal') { tick(0.7); d.add(x, d.ring(0.4, [[1250, 0.09, 1], [2890, 0.07, 0.8], [4380, 0.05, 0.6], [6150, 0.035, 0.4], [8700, 0.02, 0.25]], k), 0.8); band(3200, 0.8, 0.008, 0.5); }   // 鏘
  else if (s === 'wood') { tick(0.3); d.add(x, d.ring(0.2, [[480, 0.03, 1], [1150, 0.018, 0.5], [1900, 0.01, 0.25]], k), 0.9); band(900, 1, 0.012, 0.6); grit(500, 3500, 0.03, 0.25); }   // 咚＋木屑
  else if (s === 'dirt') { thud(110, 0.025, 0.9); band(1100, 0.6, 0.03, 0.6, 0.003); grit(600, 2200, 0.04, 0.3); }                      // 噗
  else if (s === 'sand') { thud(90, 0.02, 0.5); band(2600, 0.5, 0.045, 0.8, 0.005); grit(900, 5000, 0.05, 0.25); }                      // 沙
  else if (s === 'flesh') { thud(140, 0.03, 1); band(650, 1.4, 0.022, 0.7, 0.002); band(1700, 1, 0.01, 0.3); d.add(x, d.dec(d.lp(d.noise(0.1), 300), 0.02), 0.6); }   // 悶悶濕濕的一聲
  else { const rock = s === 'rock'; tick(rock ? 0.8 : 0.6); band(rock ? 2700 : 1800, 0.8, 0.008, 0.9); thud(190, 0.012, 0.5); grit(rock ? 500 : 800, rock ? 3600 : 2800, rock ? 0.035 : 0.06, rock ? 0.3 : 0.4); if (rock) d.add(x, d.ring(0.1, [[3100, 0.012, 1], [4700, 0.008, 0.6]], k), 0.25); }
  return d.fin(x, 0.9, 0.01);
}
// 跳彈：往下滑的尖嘯
function ricoBuf(d) {
  const T = 0.42, f0 = d.rnd(3200, 5200), f1 = f0 * d.rnd(0.3, 0.5), x = d.z(T), e = (y) => d.dec(y, 0.085, 0.004);
  d.add(x, e(d.sine(T, f0, f1, 0.11)), 0.7); d.add(x, e(d.sine(T, f0 * 1.013, f1 * 1.02, 0.11)), 0.4);
  d.add(x, e(d.bp(d.noise(T), (p) => f1 + (f0 - f1) * Math.exp(-p * T / 0.11), 9)), 0.5);
  return d.fin(x, 0.8, 0.02);
}
// 子彈擦身而過：超音速的「啪」＋掠過的「咻」
function whizBuf(d) {
  const T = 0.22, x = d.z(T), f0 = d.rnd(5000, 7500);
  d.add(x, d.dec(d.hp(d.noise(0.01), 3500), 0.0008, 0.0001), 0.9);
  d.add(x, d.dec(d.bp(d.noise(T), (p) => f0 * Math.exp(-p * 2.6) + 500, 3.5), 0.04, 0.003), 0.8);
  d.add(x, d.dec(d.bp(d.noise(0.2), 1100, 0.7), 0.05, 0.01), 0.25);
  return d.fin(x, 0.9, 0.02);
}

// ═══ 其他戰鬥音效 ═══
function hitBuf(d, head) {
  const x = d.z(head ? 0.22 : 0.1);
  d.add(x, d.dec(d.hp(d.noise(0.01), 2500), 0.001, 0.0002), head ? 0.5 : 0.6);
  if (head) d.add(x, d.ring(0.22, [[1900, 0.035, 1], [2850, 0.045, 0.6], [4130, 0.03, 0.4], [5800, 0.018, 0.25]]), 1);                   // 爆頭：清脆的「叮」
  else { d.add(x, d.ring(0.1, [[1100, 0.014, 1], [3300, 0.008, 0.3]]), 1); d.add(x, d.dec(d.bp(d.noise(0.05), 2300, 1.5), 0.006), 0.5); }  // 命中：短促的「噠」
  return d.fin(x, 0.9, 0.01);
}
function killBuf(d) {
  const x = d.z(0.6); d.add(x, d.dec(d.sine(0.1, 220, 90, 0.02), 0.03, 0.001), 0.5);
  d.add(x, d.tone(0.3, 880, 880, 0.05), 0.8); d.add(x, d.tone(0.5, 1320, 1320, 0.11), 0.8, 0.1); d.add(x, d.tone(0.5, 2640, 2640, 0.07, [[1, 1]]), 0.2, 0.1);
  return d.fin(x, 0.9, 0.02);
}
function hurtBuf(d) {
  const x = d.z(0.32);
  d.add(x, d.sat(d.dec(d.sine(0.3, 170, 62, 0.07), 0.07, 0.003), 3.5), 0.9); d.add(x, d.dec(d.lp(d.noise(0.2), 520), 0.035, 0.001), 0.6); d.add(x, d.dec(d.bp(d.noise(0.1), 1300, 1.2), 0.012), 0.3);
  return d.fin(x, 0.9, 0.02);
}
function breakBuf(d) {
  const x = d.z(0.42), k = d.rnd(0.85, 1.2);
  d.add(x, d.dec(d.sine(0.2, 150 * k, 58, 0.03), 0.04, 0.001), 0.8); d.add(x, d.dec(d.lp(d.noise(0.3), 650 * k, 0.7), 0.045, 0.001), 0.9);
  d.add(x, d.bp(d.grains(0.4, 160, 0.004, (t) => Math.exp(-t / 0.08)), 1800 * k, 0.6), 0.55); d.add(x, d.bp(d.grains(0.4, 60, 0.003, (t) => Math.exp(-t / 0.11)), 4000, 0.8), 0.25);   // 碎塊散落
  return d.fin(x, 0.9, 0.02);
}
function dryBuf(d) {
  const x = d.z(0.08), c = (at, g, k) => { d.add(x, d.ring(0.05, [[880 * k, 0.005, 1], [2900 * k, 0.004, 0.7], [5200 * k, 0.002, 0.4]]), g, at); d.add(x, d.dec(d.hp(d.noise(0.01), 3000), 0.001, 0.0002), g * 0.6, at); };
  c(0, 0.9, 1); c(0.022, 0.4, 1.3); return d.fin(x, 0.9, 0.01);
}
// 換彈：stage 0 退彈匣、1 上彈匣＋拉槍機、2 中途的喀聲；grp 決定音高（手槍輕、機槍重、霰彈槍是泵動）
const RGRP = { pistol: 'light', smg: 'light', rifle: 'mid', lmg: 'heavy', sniper: 'heavy', launcher: 'heavy', shotgun: 'pump' };
function reloadBuf(d, stage, grp) {
  const p = { light: 1.35, mid: 1, heavy: 0.72, pump: 0.85 }[grp], x = d.z(stage === 1 ? 0.5 : 0.26);
  const clack = (at, f, g, tau = 0.008) => { d.add(x, d.dec(d.bp(d.noise(0.08), f * p, 2.2), tau, 0.0004), g, at); d.add(x, d.ring(0.08, [[f * 0.47 * p, 0.014, 1], [f * 1.63 * p, 0.009, 0.6], [f * 2.9 * p, 0.005, 0.35]]), g * 0.6, at); d.add(x, d.dec(d.hp(d.noise(0.01), 3500), 0.0012, 0.0002), g * 0.5, at); };
  const slide = (at, len, f0, f1, g) => d.add(x, d.mul(d.bp(d.noise(len), (q) => (f0 + (f1 - f0) * q) * p, 1.6), (t) => bell(t, len, 1.5)), g, at);
  const thunk = (at, g) => d.add(x, d.dec(d.sine(0.1, 200 * p, 115 * p, 0.02), 0.024, 0.002), g, at);
  if (grp === 'pump') {
    if (stage === 0) { clack(0, 1100, 0.6, 0.012); slide(0.02, 0.07, 900, 1400, 0.3); }                                    // 塞一顆彈
    else if (stage === 1) { clack(0, 1100, 0.5, 0.012); clack(0.17, 1500, 0.8); slide(0.19, 0.09, 1300, 800, 0.4); clack(0.31, 1900, 0.9); }   // 塞彈 → 泵動
    else clack(0, 1300, 0.6);
  } else if (stage === 0) { clack(0, 2300, 0.7); slide(0.03, 0.11, 1500, 800, 0.4); thunk(0.12, 0.3); }                    // 卡榫 → 彈匣滑出
  else if (stage === 1) { slide(0, 0.06, 800, 1500, 0.35); clack(0.06, 1500, 0.9, 0.011); thunk(0.06, 0.5); clack(0.22, 2200, 0.7); slide(0.235, 0.07, 2000, 1200, 0.35); clack(0.31, 2700, 1); }   // 彈匣到位 → 槍機後拉 → 復進
  else clack(0, 2000, 0.7);
  return d.fin(x, 0.9, 0.01);
}
function swapBuf(d) {
  const x = d.z(0.26);
  d.add(x, d.mul(d.bp(d.noise(0.14), (p) => 700 + 900 * p, 0.7), (t) => bell(t, 0.14)), 0.5);                              // 布料摩擦
  d.add(x, d.dec(d.bp(d.noise(0.05), 2100, 2), 0.007, 0.0004), 0.8, 0.11); d.add(x, d.ring(0.08, [[1150, 0.012, 1], [3300, 0.007, 0.5]]), 0.45, 0.11); d.add(x, d.dec(d.sine(0.08, 170, 95, 0.02), 0.02, 0.002), 0.35, 0.11);   // 握住槍
  return d.fin(x, 0.9, 0.01);
}
function throwBuf(d) {
  const x = d.z(0.3);
  d.add(x, d.ring(0.06, [[4300, 0.012, 1], [6500, 0.008, 0.6]]), 0.3);                                                     // 拔插銷
  d.add(x, d.mul(d.bp(d.noise(0.26), (p) => 500 + 1700 * Math.sin(Math.PI * Math.pow(p, 0.6)), 1.3), (t) => bell(t, 0.26)), 0.9, 0.02);   // 揮臂
  return d.fin(x, 0.9, 0.01);
}
function flashBuf(d) {
  const T = 0.75, M = d.z(T);
  d.add(M, d.dec(d.hp(d.noise(0.05), 2800), 0.006, 0.0002), 1); d.add(M, d.dec(d.bp(d.noise(0.4), 3200, 0.7), 0.035, 0.0003), 0.9);
  d.add(M, d.dec(d.sine(0.2, 1800, 600, 0.03), 0.03, 0.0005), 0.5); d.add(M, d.dec(d.lp(d.noise(0.5), 800), 0.06, 0.001), 0.7);
  d.sat(M, 2.2);
  d.add(M, d.ring(0.6, [[2930, 0.1, 1], [4710, 0.08, 0.6], [7300, 0.05, 0.3]]), 0.22);                                     // 金屬外殼的餘音
  const ch = () => { const x = M.slice(); d.add(x, d.swell(d.hp(d.noise(T), 1200), 0.004, 0.1), 0.3); return x; };
  return d.fin([ch(), ch()], 0.95, 0.03);
}
function hissBuf(d) {
  const T = 1.9, pop = d.z(0.2); d.add(pop, d.dec(d.lp(d.noise(0.2), 700), 0.03, 0.001), 1); d.add(pop, d.dec(d.hp(d.noise(0.03), 3000), 0.004, 0.0003), 0.6);
  const ch = () => {
    const x = d.z(T), fl = d.lfo(7); d.put(x, pop, 0.6);
    d.add(x, d.mul(d.swell(d.bp(d.noise(T), (p) => 2600 + 900 * p, 0.7), 0.03, 0.42), (t) => 0.85 + 0.15 * fl(t), 64), 0.8, 0.02);
    d.add(x, d.swell(d.hp(d.noise(T), 5500), 0.02, 0.3), 0.35, 0.02); return x;
  };
  return d.fin([ch(), ch()], 0.85, 0.05);
}
function bounceBuf(d) {
  const x = d.z(0.2), k = d.rnd(0.85, 1.2);
  d.add(x, d.ring(0.2, [[1450, 0.025, 1], [2380, 0.02, 0.7], [3900, 0.012, 0.45], [6100, 0.006, 0.25]], k), 0.8); d.add(x, d.dec(d.lp(d.noise(0.08), 420), 0.014, 0.0008), 0.7); d.add(x, d.dec(d.hp(d.noise(0.01), 3500), 0.001, 0.0002), 0.5);
  return d.fin(x, 0.9, 0.01);
}
function jumpBuf(d) {
  const x = d.z(0.18);
  d.add(x, d.mul(d.bp(d.noise(0.16), (p) => 350 + 500 * p, 0.7), (t) => bell(t, 0.16)), 0.8); d.add(x, d.dec(d.bp(d.noise(0.05), 1500, 1), 0.01, 0.001), 0.5); d.add(x, d.dec(d.lp(d.noise(0.08), 260), 0.02, 0.002), 0.6);
  return d.fin(x, 0.9, 0.01);
}
function swingBuf(d) {
  const T = 0.24, x = d.z(T), f = d.rnd(2300, 3100);
  d.add(x, d.mul(d.bp(d.noise(T), (p) => 500 + f * Math.sin(Math.PI * Math.pow(p, 0.75)), 1.8), (t) => bell(t, T)), 0.9); d.add(x, d.mul(d.hp(d.noise(T), 5000), (t) => bell(t, T, 4)), 0.2);
  return d.fin(x, 0.9, 0.01);
}
function knifeBuf(d, flesh) {
  const x = d.z(0.3);
  if (flesh) { d.add(x, d.dec(d.sine(0.2, 150, 60, 0.03), 0.035, 0.001), 1); d.add(x, d.dec(d.bp(d.noise(0.2), (p) => 900 - 500 * p, 1.6), 0.03, 0.002), 0.8); d.add(x, d.dec(d.lp(d.noise(0.15), 320), 0.025), 0.6); d.add(x, d.dec(d.hp(d.noise(0.05), 3000), 0.004), 0.25); }   // 刺進去
  else { d.add(x, d.ring(0.3, [[2140, 0.045, 1], [3730, 0.035, 0.8], [5920, 0.025, 0.5], [8300, 0.015, 0.3]], d.rnd(0.9, 1.1)), 0.8); d.add(x, d.dec(d.hp(d.noise(0.02), 3500), 0.0015, 0.0002), 0.7); d.add(x, d.dec(d.bp(d.noise(0.1), 4200, 2), 0.02, 0.003), 0.35, 0.01); d.add(x, d.dec(d.lp(d.noise(0.05), 500), 0.01), 0.4); }   // 刀刃敲在牆上
  return d.fin(x, 0.9, 0.01);
}
// 汽油彈：瓶子砸碎（一堆高頻小泛音）→ 點燃的「呼」
function molotovBuf(d) {
  const T = 1.9, M = d.z(T), sh = d.z(0.5);
  d.add(M, d.dec(d.hp(d.noise(0.03), 3500), 0.003, 0.0002), 0.9);
  for (let i = 0; i < 22; i++) d.put(sh, d.ring(0.12, [[d.rnd(2400, 9500), d.rnd(0.008, 0.045), 1]]), d.rnd(0.2, 1), d.r() ** 2 * 0.3);
  d.add(M, sh, 0.7); d.add(M, d.hp(d.grains(0.5, 220, 0.002, (t) => Math.exp(-t / 0.1)), 5000), 0.35);
  d.add(M, d.dec(d.sine(0.5, 130, 62, 0.1), 0.13, 0.03), 0.5, 0.08);
  const ch = () => {
    const x = M.slice();
    d.add(x, d.mul(d.lp(d.noise(T), (p) => 260 + 1500 * Math.sin(Math.PI * Math.min(1, p * 2.2) / 2), 0.7), (t) => Math.min(1, t / 0.14) ** 2 * Math.exp(-Math.max(0, t - 0.14) / 0.36), 32), 0.85, 0.05);
    d.add(x, d.hp(d.grains(T, 30, 0.003, (t) => t < 0.15 ? 0 : Math.exp(-(t - 0.15) / 0.6)), 1500), 0.3); return x;
  };
  return d.fin([ch(), ch()], 0.9, 0.05);
}
// 彈殼落地：彈跳三四下，間隔越來越短
function shellBuf(d) {
  const x = d.z(0.42), f = d.rnd(3500, 4700); let at = 0, g = 1;
  for (let i = 0; i < 4; i++) {
    const k = d.rnd(0.93, 1.08);
    d.put(x, d.ring(0.12, [[f * k, 0.03, 1], [f * 1.52 * k, 0.024, 0.6], [f * 2.31 * k, 0.016, 0.4], [f * 3.4 * k, 0.008, 0.2]]), g * 0.4, at); d.put(x, d.dec(d.hp(d.noise(0.008), 5000), 0.0008, 0.0002), g * 0.3, at);
    at += d.rnd(0.085, 0.13) * Math.pow(0.6, i); g *= 0.55;
  }
  return d.fin(x, 0.8, 0.01);
}
function sprayBuf(d) {
  const x = d.z(0.62), fl = d.lfo(23), env = (t) => Math.min(1, t / 0.02) * (t > 0.4 ? Math.max(0, 1 - (t - 0.4) / 0.07) : 1) * (0.85 + 0.15 * fl(t));
  for (const at of [0, 0.065]) d.add(x, d.ring(0.05, [[2350, 0.009, 1], [3900, 0.006, 0.6]], d.rnd(0.9, 1.1)), 0.35, at);   // 罐子裡的鋼珠
  d.add(x, d.mul(d.hp(d.noise(0.5), 4200), env, 16), 0.75, 0.11); d.add(x, d.mul(d.bp(d.noise(0.5), 7200, 1.5), env, 16), 0.4, 0.11);   // 噴漆
  return d.fin(x, 0.8, 0.01);
}

// ═══ 介面與提示音 ═══
function buyBuf(d) {
  const x = d.z(0.34);
  d.add(x, d.tone(0.2, 880, 880, 0.03), 0.7); d.add(x, d.tone(0.28, 1320, 1320, 0.05), 0.8, 0.055); d.add(x, d.ring(0.25, [[2640, 0.05, 1], [3960, 0.04, 0.5], [5280, 0.025, 0.3]]), 0.3, 0.055); d.add(x, d.dec(d.hp(d.noise(0.03), 5000), 0.006), 0.15, 0.055);
  return d.fin(x, 0.9, 0.02);
}
function denyBuf(d) {
  const x = d.z(0.26), b = () => d.mul(d.sat(d.tone(0.09, 215, 175, 9, [[1, 1], [2, 0.3], [3, 0.5]], 0.003), 2.5), (t) => t > 0.065 ? Math.max(0, 1 - (t - 0.065) / 0.02) : 1);
  d.add(x, b(), 0.8); d.add(x, b(), 0.7, 0.115); return d.fin(d.lp(x, 2600), 0.9, 0.01);
}
function pickupBuf(d) {
  const x = d.z(0.5);
  d.add(x, d.tone(0.2, 660, 990, 0.05), 0.8); d.add(x, d.tone(0.35, 990, 1320, 0.08), 0.75, 0.08); d.add(x, d.ring(0.3, [[2640, 0.06, 1], [3960, 0.04, 0.6]]), 0.2, 0.16);
  return d.fin(x, 0.9, 0.02);
}
function uiBuf(d) { const x = d.z(0.09); d.add(x, d.tone(0.07, 700, 900, 0.018, [[1, 1], [2, 0.2]], 0.002), 0.8); d.add(x, d.dec(d.bp(d.noise(0.02), 2600, 1.5), 0.003, 0.0003), 0.4); return d.fin(x, 0.9, 0.01); }
function beepBuf(d, hi) {
  const f = hi ? 1040 : 520, len = hi ? 0.38 : 0.13, x = d.tone(len + 0.06, f, f, 9, [[1, 1], [2, 0.18], [3, 0.11], [5, 0.04]], 0.004);
  return d.fin(d.mul(x, (t) => t > len ? Math.max(0, 1 - (t - len) / 0.05) : 1 - 0.25 * t / len), 0.9, 0.005);
}
function jingle(d, notes, step, glide, final) {
  const x = d.z(notes.length * step + 0.95);
  notes.forEach((f, i) => { d.add(x, d.tone(0.5, f, f * glide, 0.1), 0.8, i * step); d.add(x, d.tone(0.5, f * 2.005, f * 2.005 * glide, 0.07, [[1, 1]]), 0.18, i * step); });
  final(x); return x;
}
const winBuf = (d) => d.fin(jingle(d, [523.25, 659.25, 783.99, 1046.5], 0.11, 1, (x) => { for (const f of [523.25, 783.99, 1046.5, 1318.5]) d.add(x, d.tone(0.9, f, f, 0.22, [[1, 1], [2, 0.3]], 0.02), 0.3, 0.44); }), 0.9, 0.05);
const loseBuf = (d) => d.fin(d.lp(jingle(d, [392, 329.63, 261.63], 0.16, 0.97, (x) => d.add(x, d.tone(0.85, 130.81, 123, 0.22, [[1, 1], [2, 0.5], [3, 0.25]], 0.01), 0.6, 0.48)), 2600), 0.9, 0.05);
function emoteBuf(d) {
  const x = d.z(0.36);
  d.add(x, d.mul(d.bp(d.noise(0.26), (p) => 400 + 2200 * p * p, 1.5), (t) => bell(t, 0.26)), 0.8); d.add(x, d.tone(0.14, 1320, 1320, 0.03, [[1, 1]]), 0.25, 0.17); d.add(x, d.tone(0.14, 1760, 1760, 0.035, [[1, 1]]), 0.25, 0.21);
  return d.fin(x, 0.9, 0.01);
}
function respawnBuf(d) {
  const x = d.z(0.85);
  d.add(x, d.mul(d.tone(0.55, 220, 880, 9, [[1, 1], [1.5, 0.4], [2, 0.3]], 0.05), (t) => bell(t, 0.55, 1.5) * (0.8 + 0.2 * Math.sin(TAU * 14 * t))), 0.6);   // 往上升的嗡鳴
  d.add(x, d.mul(d.hp(d.noise(0.55), 3000), (t) => (t / 0.55) ** 2 * (t > 0.5 ? Math.max(0, (0.55 - t) / 0.05) : 1)), 0.25);
  d.add(x, d.tone(0.33, 1760, 1760, 0.07, [[1, 1], [2, 0.3]]), 0.5, 0.5); d.add(x, d.tone(0.33, 2637, 2637, 0.05, [[1, 1]]), 0.25, 0.5);
  return d.fin(x, 0.9, 0.02);
}
// 回合開始：倒吸的氣音 → 低音重擊＋銅管和弦
function roundBuf(d) {
  const x = d.z(1.1), stab = d.z(0.9);
  d.add(x, d.mul(d.hp(d.noise(0.14), 1500), (t) => (t / 0.14) ** 3), 0.3);
  for (const f of [146.83, 220, 293.66]) d.put(stab, d.saw(0.9, f, 0.2), 1);
  d.add(x, d.lp(stab, (p) => 2600 * Math.exp(-p * 3) + 300, 0.9), 0.8, 0.14); d.add(x, d.dec(d.sine(0.6, 140, 55, 0.08), 0.16, 0.002), 0.8, 0.14); d.add(x, d.dec(d.hp(d.noise(0.05), 2500), 0.006), 0.3, 0.14);
  return d.fin(x, 0.9, 0.05);
}
function voiceBuf(d, on) {
  const x = d.z(on ? 0.09 : 0.17);
  d.add(x, d.tone(0.07, on ? 1050 : 1350, on ? 1500 : 820, 0.025, [[1, 1], [2, 0.25]], 0.003), 0.8); d.add(x, d.dec(d.bp(d.noise(0.02), 3000, 1.2), 0.003, 0.0003), 0.35);
  if (!on) d.add(x, d.dec(d.bp(d.noise(0.1), 2300, 0.8), 0.03, 0.002), 0.3, 0.05);                                          // 放開時的無線電雜訊
  return d.fin(x, 0.9, 0.01);
}

// ═══ 循環音（火焰等）═══
const LOOPS = {
  fire(d) {
    const T = 4.4, ch = () => {
      const x = d.z(T), a = d.lfo(1.1), b = d.lfo(2.7);
      d.add(x, d.mul(d.bp(d.noise(T), 250, 0.6), (t) => 0.65 + 0.35 * a(t), 64), 0.5);      // 火焰的低吼
      d.add(x, d.lp(d.noise(T), 110), 0.15);
      d.add(x, d.mul(d.bp(d.noise(T), 1500, 0.5), (t) => 0.6 + 0.4 * b(t), 64), 0.14);      // 嘶嘶聲
      d.add(x, d.hp(d.grains(T, 18, 0.002), 1800), 0.6);                                    // 劈啪
      d.add(x, d.bp(d.grains(T, 3, 0.01), 650, 1.2), 0.45);                                 // 偶爾比較大的爆裂
      return d.loopify(x, 0.4);
    };
    return d.fin([ch(), ch()], 0.85, 0);
  },
  hiss(d) {                                                                                 // 煙霧彈持續噴煙
    const T = 3.4, ch = () => { const x = d.z(T), fl = d.lfo(5); d.add(x, d.mul(d.bp(d.noise(T), 2800, 0.7), (t) => 0.85 + 0.15 * fl(t), 64), 0.8); d.add(x, d.hp(d.noise(T), 5500), 0.3); return d.loopify(x, 0.4); };
    return d.fin([ch(), ch()], 0.6, 0);
  },
};

// ═══ 環境音（每種 = 兩層不同長度的循環，疊起來幾乎聽不出重複）═══
// 風：f 中心頻率、sw 陣風時頻率擺動、low 低頻隆隆量、hiss 高頻沙沙量
const windBed = (f, sw, q, low, hiss) => (d) => {
  const T = 7.5, ch = () => {
    const y = d.z(T), a = d.lfo(0.11), b = d.lfo(0.23), c = d.lfo(0.31);
    d.add(y, d.mul(d.bp(d.noise(T), (p) => f + sw * a(p * T), q), (t) => 0.55 + 0.45 * b(t), 64), 1);
    d.add(y, d.lp(d.noise(T), 150), low);
    if (hiss) d.add(y, d.mul(d.bp(d.noise(T), 3000, 0.6), (t) => { const v = 0.5 + 0.5 * c(t); return 0.2 + 0.8 * v * v; }, 64), hiss);
    return d.loopify(y, 0.5);
  };
  return d.fin([ch(), ch()], 0.8, 0);
};
// 幾陣呼嘯而過的風（窄頻帶、鐘形起伏）
const gusts = (f0, f1, q) => (d) => {
  const T = 10, ch = () => {
    const y = d.z(T);
    for (let i = 0; i < 4; i++) { const len = d.rnd(1.6, 2.8), f = d.rnd(f0, f1), w = d.lfo(0.4); d.add(y, d.mul(d.bp(d.noise(len), (p) => f * (1 + 0.25 * w(p * len)), q), (t) => bell(t, len), 64), d.rnd(0.4, 1), d.rnd(0, T - 3)); }
    return d.loopify(y, 0.5);
  };
  return d.fin([ch(), ch()], 0.8, 0);
};
function harborBed(d) {
  const T = 8.5, ch = (det) => {
    const y = d.z(T), sw = d.lfo(0.17), sp = d.lfo(0.4);
    d.add(y, d.mul(d.bp(d.noise(T), 520, 0.5), (t) => { const v = 0.5 + 0.5 * sw(t); return 0.25 + 0.75 * v * v; }, 64), 0.8);     // 海浪
    d.add(y, d.mul(d.bp(d.noise(T), 1900, 0.9), (t) => { const v = Math.max(0, sp(t)); return v * v; }, 64), 0.3);                // 拍岸的水花
    d.add(y, d.ring(T, [[58 + det, 1e9, 0.7], [116.3, 1e9, 1], [174.6 + det, 1e9, 0.4]]), 0.22);                                  // 遠處機具的低頻嗡嗡聲
    return d.loopify(y, 0.5);
  };
  return d.fin([ch(0), ch(0.4)], 0.8, 0);
}
// 遠處的金屬碰撞聲（帶回音）
function harborEv(d) {
  const T = 11.5, L = d.z(T), R = d.z(T);
  for (let i = 0; i < 3; i++) {
    const c = d.lp(d.ring(1.6, [[310, 0.4, 1], [742, 0.3, 0.6], [1180, 0.2, 0.4], [1975, 0.12, 0.25]], d.rnd(0.7, 1.3)), 1400), at = d.rnd(0.2, T - 3), pn = d.r(), g = d.rnd(0.3, 0.8);
    for (const [dl, eg] of [[0, 1], [0.19, 0.4], [0.41, 0.2]]) { d.add(L, c, g * eg * (1 - pn * 0.7), at + dl); d.add(R, c, g * eg * (0.3 + pn * 0.7), at + dl); }
  }
  return d.fin([d.loopify(L, 0.5), d.loopify(R, 0.5)], 0.8, 0);
}
// 沙漠：一陣一陣被風捲起的沙粒
function flurries(d) {
  const T = 10, ch = () => {
    const y = d.z(T);
    for (let i = 0; i < 4; i++) { const len = d.rnd(1, 2.2); d.add(y, d.mul(d.hp(d.grains(len, 2500, 0.0015), 3500), (t) => bell(t, len), 64), d.rnd(0.4, 1), d.rnd(0, T - 2.5)); }
    return d.loopify(y, 0.5);
  };
  return d.fin([ch(), ch()], 0.8, 0);
}
function caveBed(d) {
  const T = 8.5, ch = () => {
    const y = d.z(T), a = d.lfo(0.09), b = d.lfo(0.2);
    d.add(y, d.lp(d.brown(T), 75), 0.6);                                                              // 很深的低頻隆隆（耳機才聽得到）
    d.add(y, d.mul(d.lp(d.noise(T), 170), (t) => 0.7 + 0.3 * a(t), 64), 0.5);
    d.add(y, d.mul(d.bp(d.noise(T), 230, 2.5), (t) => 0.4 + 0.6 * Math.abs(b(t)), 64), 0.35);         // 坑道裡的氣流
    d.add(y, d.bp(d.noise(T), 150, 22), 0.3);                                                         // 洞穴共鳴
    return d.loopify(y, 0.5);
  };
  return d.fin([ch(), ch()], 0.8, 0);
}
// 滴水聲（音高往上滑的短音＋洞穴回音）
function caveDrips(d) {
  const T = 11.5, L = d.z(T), R = d.z(T);
  for (let i = 0; i < 7; i++) {
    const f = d.rnd(1100, 2600), dr = d.dec(d.sine(0.25, f, f * 1.45, 0.02), 0.03, 0.001), at = d.rnd(0.1, T - 1.5), pn = d.r(), g = d.rnd(0.3, 1);
    for (const [dl, eg] of [[0, 1], [0.13, 0.45], [0.29, 0.25], [0.5, 0.12]]) { d.add(L, dr, g * eg * (1 - pn * 0.7), at + dl); d.add(R, dr, g * eg * (0.3 + pn * 0.7), at + dl); }
  }
  return d.fin([d.loopify(L, 0.5), d.loopify(R, 0.5)], 0.8, 0);
}
// g = 整體音量；L = [[烘焙函式, 這層的音量], …]
const AMB = {
  wind:   { g: 0.1, L: [[windBed(430, 260, 0.9, 0.2, 0), 1], [gusts(700, 1500, 6), 0.45]] },
  desert: { g: 0.1, L: [[windBed(560, 300, 0.8, 0.1, 0.8), 1], [flurries, 0.4]] },
  harbor: { g: 0.085, L: [[harborBed, 1], [harborEv, 0.4]] },
  cave:   { g: 0.085, L: [[caveBed, 1], [caveDrips, 0.35]] },
};

// 殘響的脈衝響應：左右不相關的噪音 × 指數衰減（rt 秒掉 60dB），高頻掉得比較快，前面加幾個早期反射
function makeIR(c, rt) {
  const sr = c.sampleRate, n = Math.round(sr * (rt * 1.1 + 0.08)), buf = c.createBuffer(2, n, sr), pre = Math.round(sr * 0.008);
  for (let ch = 0; ch < 2; ch++) {
    const x = buf.getChannelData(ch), r = prng(7919 * (ch + 1) + Math.round(rt * 1000)); let y = 0, a = 1, e = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      if (((i - pre) & 63) === 0) a = 1 - Math.exp(-TAU * (800 + 9000 * Math.exp(-t / (rt * 0.3))) / sr);
      y += a * (r() * 2 - 1 - y); const v = y * Math.exp(-6.91 * t / rt) * (1 - Math.exp(-t / 0.003)); x[i] = v; e += v * v;
    }
    const k = 1 / Math.sqrt(e || 1); for (let i = pre; i < n; i++) x[i] *= k;                         // 擴散尾音的能量正規化成 1，殘響量才好預測
    for (let j = 0; j < 8; j++) x[Math.min(n - 1, pre + Math.round(sr * (0.003 + r() * Math.min(0.08, rt * 0.06))))] += (r() > 0.5 ? 1 : -1) * (0.3 - j * 0.03);
  }
  return buf;
}

export class Sfx {
  constructor() {
    this.ctx = null; this.vol = 0.6;
    this.env = { reverb: 0.28, size: 0.9 };        // 空間：殘響量 0~1、殘響時間（秒）；用 setEnv 依地圖調整
    this.bufs = new Map(); this.guns = new Map(); this.loops = new Map();
    this.amb = null; this.ambKind = null; this.last = {}; this.lastT = {};
    this.stat = { made: 0, ended: 0 };            // 建立／播完的音源數（兩者相減 = 還在響的音源，測試用來確認沒有節點洩漏）
    this._q = []; this._qt = 0; this._ft = false;
  }

  // 瀏覽器規定要有使用者點擊後才能出聲。ctx：測試時可以傳 OfflineAudioContext 進來離線算圖
  init(ctx) {
    if (this.ctx) { if (this._rt && this.ctx.state === 'suspended') { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); } return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (ctx && typeof ctx.createGain !== 'function') ctx = null;      // 被直接當成事件處理函式時，傳進來的會是 Event
    if (!ctx && !AC) return;
    const c = ctx || new AC(), G = (v = 1) => { const g = c.createGain(); g.gain.value = v; return g; };
    this._rt = typeof OfflineAudioContext === 'undefined' || !(c instanceof OfflineAudioContext);
    this.master = G(clamp(num(this.vol, 0.6))); this.master.connect(c.destination);
    // 限幅器：訊號先縮成 1/4 再進波形整形器；曲線在 ±0.8 以內完全線性，超過之後平滑地壓到 0.98 以內 → 輸出絕不超過 1
    const N = 4096, cv = new Float32Array(N + 1), sh = c.createWaveShaper(), pre = G(0.25);
    for (let i = 0; i <= N; i++) { const x = (i / N * 2 - 1) * 4, a = Math.abs(x); cv[i] = Math.sign(x) * (a <= 0.8 ? a : 0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18)); }
    sh.curve = cv;
    const comp = this.comp = c.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 9; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.13;
    comp.connect(pre); pre.connect(sh); sh.connect(this.master);
    this.uiBus = G(); this.uiBus.connect(comp);
    this.muffle = c.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.Q.value = 0.5; this.muffle.frequency.value = this._top = Math.min(20000, c.sampleRate * 0.45);
    this.duckG = G(); this.duckG.connect(this.muffle); this.muffle.connect(comp);
    this.bus = G(); this.bus.connect(this.duckG);
    this.ambBus = G(); this.ambBus.connect(this.duckG);
    this.wet = G(this.env.reverb * WET); this.wet.connect(this.duckG);
    this.revIn = c.createBiquadFilter(); this.revIn.type = 'highpass'; this.revIn.frequency.value = 140;   // 低頻不進殘響，免得糊成一團
    this.ctx = c; this.conv = null; this._reverb(this.env.size);
    if (this.ambKind) { const k = this.ambKind; this.ambKind = null; this.ambient(k); }
    if (this._rt) this.preload();
  }
  setVolume(v) { this.vol = clamp(num(v, this.vol)); if (this.master) this.master.gain.setTargetAtTime(this.vol, this.ctx.currentTime, 0.02); }

  // 依地圖設定空間感：reverb 0~1（殘響量，開闊廣場 ≈0.2、地下道 ≈0.7）、size = 殘響時間（秒）
  setEnv(o) {
    const reverb = clamp(num(o && o.reverb, this.env.reverb)), size = clamp(num(o && o.size, this.env.size), 0.15, 6);
    const resize = Math.abs(size - this.env.size) > 0.01; this.env = { reverb, size };
    if (!this.ctx) return;
    this.wet.gain.setTargetAtTime(reverb * WET, this.ctx.currentTime, 0.1);
    if (resize) this._reverb(size);
  }
  _reverb(size) {
    const c = this.ctx, t = c.currentTime, old = this.conv, cv = c.createConvolver(), g = c.createGain();
    cv.normalize = false; cv.buffer = makeIR(c, size); g.gain.value = old ? 0 : 1;
    this.revIn.connect(cv); cv.connect(g); g.connect(this.wet); this.conv = { cv, g };
    if (old) { g.gain.setTargetAtTime(1, t, 0.08); old.g.gain.setTargetAtTime(0, t, 0.08); setTimeout(() => { try { this.revIn.disconnect(old.cv); } catch { /* 已拆 */ } old.g.disconnect(); }, 900); }   // 換空間時交叉淡化
  }

  // 暫時把世界的聲音壓低並悶住（閃光彈震聾）：amount 0~1、seconds = 多久完全恢復
  duck(amount = 0.8, seconds = 1.5, at = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + Math.max(0, num(at)), a = clamp(num(amount, 0.8)), lo = 1 - a * 0.96, flo = this._top * Math.pow(500 / this._top, a), T = Math.max(0.1, num(seconds, 1.5));
    for (const [p, v, hi, ramp] of [[this.duckG.gain, lo, 1, 'linearRampToValueAtTime'], [this.muffle.frequency, flo, this._top, 'exponentialRampToValueAtTime']]) {
      const cur = p.value; p.cancelScheduledValues(t); p.setValueAtTime(cur, t);
      p[ramp](v, t + 0.05); p.setValueAtTime(v, t + 0.05 + T * 0.3); p[ramp](hi, t + 0.05 + T);
    }
  }

  // ── 內部工具 ──
  // 烘焙並快取一個緩衝：fn(D) 回傳各聲道的 Float32Array（AudioBuffer 可以有自己的取樣率，播放時會自動轉換）
  _b(key, fn, half = false) {
    const sr = half ? Math.max(16000, Math.round(this.ctx.sampleRate / 2)) : this.ctx.sampleRate;   // half：比較長、高頻不多的聲音用一半取樣率烘焙，省一半時間與記憶體
    let b = this.bufs.get(key);
    if (!b) { const chs = fn(new D(sr, hash(key))); b = this.ctx.createBuffer(chs.length, chs[0].length, sr); chs.forEach((x, i) => b.getChannelData(i).set(x)); this.bufs.set(key, b); }
    return b;
  }
  // 從 n 個變體裡隨機挑一個，不跟上一次重複
  _var(key, n) { let i = (Math.random() * n) | 0; if (i === this.last[key]) i = (i + 1) % n; return this.last[key] = i; }
  // 頻率限制：距離上次不到 gap 秒就回傳 false
  _rl(key, gap) { const t = this.ctx.currentTime, l = this.lastT[key]; if (l !== undefined && t >= l && t - l < gap) return false; this.lastT[key] = t; return true; }
  // 播放烘焙好的緩衝。buf = 單一 AudioBuffer，或 [[緩衝, 音量], …]（多層共用同一條輸出鏈）
  // o：g 音量、pan 左右 -1~1、rate 播放速率、at 延遲秒、lp 低通 Hz（距離感）、send 殘響送出量、ui 走介面匯流排（不受耳鳴壓低、不進殘響）
  _play(buf, { g = 1, pan = 0, rate = 1, at = 0, lp = 0, send = 0, ui = false } = {}) {
    const layers = Array.isArray(buf) ? buf : [[buf, 1]]; if (!layers.length || !(g > 0)) return;      // 沒東西可播、音量是 0 或 NaN → 不建任何節點
    const c = this.ctx, t = c.currentTime + Math.max(0, num(at)), out = c.createGain(); out.gain.value = g;
    let tail = out, sg = null, left = layers.length;
    if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = 0.6; tail.connect(f); tail = f; }
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(pan, -1, 1) * PAN; tail.connect(p); tail = p; }
    tail.connect(ui ? this.uiBus : this.bus);
    if (send > 0 && !ui && this.env.reverb > 0) { sg = c.createGain(); sg.gain.value = send; tail.connect(sg); sg.connect(this.revIn); }
    for (const [b, lg] of layers) {
      const src = c.createBufferSource(); src.buffer = b; src.playbackRate.value = rate;
      if (lg === 1) src.connect(out); else { const l = c.createGain(); l.gain.value = lg; src.connect(l); l.connect(out); }
      src.onended = () => { this.stat.ended++; if (--left === 0) { tail.disconnect(); if (sg) sg.disconnect(); } };   // 全部播完就拆線，讓整條鏈被回收
      this.stat.made++; src.start(t);
    }
  }
  _one(key, fn, o) { if (this.ctx) this._play(this._b(key, fn), o); }
  _gun(snd) {
    const kind = kindOf(snd), K = GUN[kind], f = snd.f || K.f0, dur = snd.dur || K.d0, th = snd.thump || K.th0, key = `gun:${kind}:${f}:${dur}:${th}`;
    let e = this.guns.get(key); if (!e) this.guns.set(key, e = { K, kind, key, f, dur, th, near: [], far: [] });
    return e;
  }
  _gunBuf(e, far, i) { const a = far ? e.far : e.near; return a[i] || (a[i] = this._b(`${e.key}:${far ? 'f' : 'n'}${i}`, (d) => (e.kind === 'launcher' ? launcherBuf(d, e, far) : far ? gunFar(d, e) : gunNear(d, e)))); }
  // 預先烘焙（分散在好幾個影格做，避免第一次開槍或爆炸時卡一下）。snds = 這一局會用到的武器 snd 陣列，可不傳
  preload(snds = []) {
    if (!this.ctx) return;
    for (const s of snds || []) { if (!s || s.gain === 0) continue; const e = this._gun(s); for (let i = 0; i < VARS; i++) this._q.push(() => this._gunBuf(e, false, i), () => i < 2 && this._gunBuf(e, true, i)); }
    if (!this._warm) {
      this._warm = true;
      const B = (key, fn, half) => this._q.push(() => this._b(key, fn, half));
      for (let i = 0; i < 4; i++) B(`step:concrete:${i}`, (d) => stepBuf(d, SURF.concrete, false));
      for (let i = 0; i < 3; i++) { B(`imp:concrete:${i}`, (d) => impactBuf(d, 'concrete')); B(`imp:flesh:${i}`, (d) => impactBuf(d, 'flesh')); B('shell:' + i, shellBuf); B('brk:' + i, breakBuf); B('rico:' + i, ricoBuf); B('whiz:' + i, whizBuf); B('bounce:' + i, bounceBuf); }
      for (let i = 0; i < 2; i++) { B(`land:concrete:${i}`, (d) => stepBuf(d, SURF.concrete, true)); B('boom:n' + i, boomNear, true); B('hurt:' + i, hurtBuf); B('swing:' + i, swingBuf); B('molotov:' + i, molotovBuf); for (const g of ['light', 'mid', 'heavy', 'pump']) B(`rl:${i}:${g}`, (d) => reloadBuf(d, i, g)); }
      B('boom:f', boomFar, true); B('hit:b', (d) => hitBuf(d, false)); B('hit:h', (d) => hitBuf(d, true)); B('kill', killBuf); B('flash', flashBuf); B('hiss', hissBuf); B('jump', jumpBuf); B('dry', dryBuf); B('swap', swapBuf); B('throw', throwBuf);
      B('knife:f', (d) => knifeBuf(d, true)); B('knife:w', (d) => knifeBuf(d, false)); B('round', roundBuf); B('respawn', respawnBuf); B('loop:fire', LOOPS.fire, true);
    }
    if (!this._qt) { const run = () => { const f = this._q.shift(); if (!f) { this._qt = 0; return; } try { f(); } catch { /* 烘焙失敗就等用到時再試 */ } this._qt = setTimeout(run, 20); }; this._qt = setTimeout(run, 50); }
  }

  // ── 槍聲。snd = weapons.js 的 { f, dur, thump, gain, kind }；dist 公尺（0 = 自己開的槍）、pan -1~1 ──
  // 距離不只改音量：越遠爆音越少、轟聲與尾音越多，並依音速延遲一點點
  shot(snd, dist = 0, pan = 0) {
    if (!this.ctx) return;
    snd = snd || {};
    const lvl = (snd.gain != null ? snd.gain : 0.8) * 0.85 * rr(0.94, 1.06); if (!(lvl > 0)) return;      // gain 0（例如刀）= 無聲
    const e = this._gun(snd), K = e.K, v = this._var(e.key, VARS), rate = rr(0.97, 1.03);
    if (dist <= 0) return void this._play(this._gunBuf(e, false, v), { g: lvl, pan, rate, send: K.send });
    const far = smooth(2, 50, dist), nw = Math.pow(1 - far, 1.3), L = [];
    if (nw > 0.02) L.push([this._gunBuf(e, false, v), nw]);
    if (far > 0.02) L.push([this._gunBuf(e, true, v % 2), far * 1.15]);
    this._play(L, { g: lvl * att(dist, 0.07, 0.1), pan, rate, at: Math.min(0.15, dist / 343), lp: dist > 3 ? 1200 + 16000 * Math.exp(-dist / 16) : 0, send: K.send * (1 + far * 1.6) });
  }
  // 爆炸：size = 規模（1 = 手榴彈；越大越低沉、越大聲）
  explosion(dist = 0, pan = 0, size = 1) {
    if (!this.ctx) return;
    const s = clamp(+size || 1, 0.4, 3), far = smooth(4, 60, dist), nw = Math.pow(1 - far, 1.3), L = [];
    if (nw > 0.02) L.push([this._b('boom:n' + this._var('boom', 2), boomNear, true), nw]);
    if (far > 0.02) L.push([this._b('boom:f', boomFar, true), far * 1.1]);
    this._play(L, { g: att(dist, 0.05, 0.2) * Math.min(1.4, Math.pow(s, 0.5)), pan, rate: clamp(Math.pow(s, -0.3), 0.6, 1.4) * rr(0.96, 1.04), at: Math.min(0.15, dist / 343), lp: dist > 6 ? 900 + 14000 * Math.exp(-dist / 20) : 0, send: 0.35 + far * 0.4 });
  }
  // 子彈打到東西：surface = concrete/metal/wood/dirt/sand/rock/flesh；內部限制每秒最多 20 次
  impact(surface, dist = 0, pan = 0) {
    if (!this.ctx || !this._rl('imp', 0.05)) return;
    const s = surfOf(surface, true), a = att(dist, 0.09) * Math.max(0, 1 - dist / 60); if (a < 0.01) return;
    this._play(this._b(`imp:${s}:${this._var('imp' + s, 3)}`, (d) => impactBuf(d, s)), { g: 0.36 * a * rr(0.85, 1.15), pan, rate: rr(0.9, 1.1), send: 0.1 });
    if (RICO[s] && Math.random() < RICO[s]) this._play(this._b('rico:' + this._var('rico', 3), ricoBuf), { g: 0.2 * a, pan: clamp(pan + rr(-0.3, 0.3), -1, 1), rate: rr(0.85, 1.25), at: 0.01, send: 0.2 });   // 跳彈
  }
  // 子彈擦身而過
  whiz(pan = 0) { if (!this.ctx || !this._rl('whiz', 0.07)) return; this._play(this._b('whiz:' + this._var('whiz', 3), whizBuf), { g: 0.4, pan, rate: rr(0.9, 1.15), send: 0.08 }); }
  // 彈殼落地（delay 秒後）
  shell(delay = 0.3) { if (!this.ctx || !this._rl('shell', 0.04)) return; this._play(this._b('shell:' + this._var('shell', 3), shellBuf), { g: 0.16 * rr(0.7, 1.1), pan: rr(0.15, 0.5), rate: rr(0.92, 1.1), at: Math.max(0, delay) + rr(0, 0.05), send: 0.06 }); }

  hit(head) { this._one(head ? 'hit:h' : 'hit:b', (d) => hitBuf(d, head), { g: head ? 0.27 : 0.21, rate: rr(0.97, 1.03), ui: true }); }
  kill() { this._one('kill', killBuf, { g: 0.3, ui: true }); }
  hurt() { this._one('hurt:' + this._var('hurt', 2), hurtBuf, { g: 0.42, rate: rr(0.92, 1.08), ui: true }); }
  blockBreak(dist = 0, pan = 0) { if (!this.ctx || !this._rl('brk', 0.03)) return; this._play(this._b('brk:' + this._var('brk', 3), breakBuf), { g: 0.34 * att(dist, 0.1, 0.15), pan, rate: rr(0.9, 1.1), send: 0.12 }); }
  dry() { this._one('dry', dryBuf, { g: 0.18, rate: rr(0.97, 1.03) }); }
  // 換彈：stage 0 = 退彈匣、1 = 上彈匣＋拉槍機、2 = 中途多一聲喀；kind = 槍的種類（可不傳）
  reload(stage = 0, kind) { const st = stage === true ? 1 : clamp(stage | 0, 0, 2), grp = RGRP[kind] || 'mid'; this._one(`rl:${st}:${grp}`, (d) => reloadBuf(d, st, grp), { g: 0.24, rate: rr(0.96, 1.04), send: 0.05 }); }
  swap() { this._one('swap', swapBuf, { g: 0.16, rate: rr(0.95, 1.05) }); }
  throw() { this._one('throw', throwBuf, { g: 0.2, rate: rr(0.95, 1.05) }); }
  // 閃光彈：爆裂聲；被閃到的人（ring = 秒數）世界的聲音會被壓低，並有一段平滑淡出的耳鳴
  flashbang(dist = 0, pan = 0, ring = 0) {
    if (!this.ctx) return;
    const at = Math.min(0.15, Math.max(0, num(dist)) / 343);
    this._play(this._b('flash', flashBuf), { g: att(dist, 0.06, 0.15), pan, rate: rr(0.96, 1.04), at, lp: dist > 8 ? Math.max(1800, 16000 - dist * 260) : 0, send: 0.35 });
    if (ring > 0) { const k = clamp(0.45 + ring * 0.25); this.duck(0.92 * k, ring, at + 0.03); this._ring(ring, at + 0.02, 0.1 * k); }   // 閃越久，聾得越徹底、耳鳴越大聲
  }
  _ring(sec, at, lvl) {
    const c = this.ctx, t = c.currentTime + at, T = sec * 1.25 + 0.3, n = 96, cv = new Float32Array(n), g = c.createGain();
    for (let i = 0; i < n; i++) { const p = i / (n - 1); cv[i] = lvl * Math.min(1, p * 30) * Math.pow(1 - p, 2.2); }   // 起音快，之後平滑地淡到 0
    g.gain.value = 0; g.gain.setValueCurveAtTime(cv, t, T); g.connect(this.uiBus);
    let left = 2;
    for (const f of [4186, 4189]) { const o = c.createOscillator(); o.frequency.value = f; o.connect(g); o.onended = () => { this.stat.ended++; if (--left === 0) g.disconnect(); }; this.stat.made++; o.start(t); o.stop(t + T + 0.02); }
  }
  hiss(dist = 0, pan = 0) { this._one('hiss', hissBuf, { g: 0.28 * att(dist, 0.08, 0.1), pan, rate: rr(0.95, 1.05), send: 0.1 }); }
  // 汽油彈：瓶子砸碎＋點燃（之後持續燃燒的聲音用 loop(key, 'fire', …)）
  molotov(dist = 0, pan = 0) { this._one('molotov:' + this._var('molo', 2), molotovBuf, { g: 0.55 * att(dist, 0.06, 0.12), pan, rate: rr(0.95, 1.05), at: Math.min(0.15, dist / 343), send: 0.2 }); }
  bounce(dist = 0, pan = 0) { this._one('bounce:' + this._var('bnc', 3), bounceBuf, { g: 0.22 * att(dist, 0.1, 0.2), pan, rate: rr(0.9, 1.1), send: 0.1 }); }
  knifeSwing() { this._one('swing:' + this._var('swing', 2), swingBuf, { g: 0.22, rate: rr(0.92, 1.1) }); }
  // flesh：true = 砍到人、false = 砍到牆
  knifeHit(flesh) { this._one(flesh ? 'knife:f' : 'knife:w', (d) => knifeBuf(d, flesh), { g: flesh ? 0.4 : 0.32, rate: rr(0.93, 1.07), send: 0.08 }); }
  spray() { this._one('spray', sprayBuf, { g: 0.22, rate: rr(0.96, 1.04) }); }
  emote() { this._one('emote', emoteBuf, { g: 0.2 }); }
  respawn() { this._one('respawn', respawnBuf, { g: 0.28, ui: true }); }
  roundStart() { this._one('round', roundBuf, { g: 0.38, ui: true }); }
  // 按住說話：on = 按下（上揚的喀聲）、放開（下降＋雜訊）
  voiceBlip(on) { this._one(on ? 'voice:1' : 'voice:0', (d) => voiceBuf(d, on), { g: 0.14, ui: true }); }
  buy() { this._one('buy', buyBuf, { g: 0.18, ui: true }); }
  deny() { this._one('deny', denyBuf, { g: 0.18, ui: true }); }
  pickup() { this._one('pickup', pickupBuf, { g: 0.21, ui: true }); }
  ui() { this._one('ui', uiBuf, { g: 0.13, ui: true }); }
  beep(hi) { this._one(hi ? 'beep:1' : 'beep:0', (d) => beepBuf(d, hi), { g: 0.21, ui: true }); }
  win() { this._one('win', winBuf, { g: 0.28, ui: true }); }
  lose() { this._one('lose', loseBuf, { g: 0.28, ui: true }); }

  // ── 腳步。surface = concrete/metal/wood/dirt/sand/rock（不傳 = concrete）；每一步的變體、音高、音量都略有不同 ──
  _foot(surface, heavy, g, pan, lp = 0) {
    const s = surfOf(surface), i = this._var((heavy ? 'ld' : 'st') + s, heavy ? 2 : 4);
    this._play(this._b(`${heavy ? 'land' : 'step'}:${s}:${i}`, (d) => stepBuf(d, SURF[s], heavy)), { g: g * rr(0.85, 1.15), pan, rate: rr(0.93, 1.07), lp, send: 0.08 });
  }
  jump() { this._one('jump', jumpBuf, { g: 0.12, rate: rr(0.94, 1.06) }); }
  land(surface) { if (this.ctx) this._foot(surface, true, 0.24, 0); }
  step(surface) { if (this.ctx) this._foot(surface, false, 0.13, (this._ft = !this._ft) ? -0.1 : 0.1); }   // 左右腳輪流
  // 對手的腳步聲：22 公尺內聽得到，越近越大聲、越遠越悶，有左右方向
  stepRemote(dist, pan, surface) { if (!this.ctx) return; const a = Math.max(0, 1 - dist / 22); if (a > 0) this._foot(surface, false, 0.42 * a, pan, 1600 + 7000 * a); }
  landRemote(dist, pan, surface) { if (!this.ctx) return; const a = Math.max(0, 1 - dist / 24); if (a > 0) this._foot(surface, true, 0.4 * a, pan, 1600 + 7000 * a); }

  // ── 循環音：用 key 辨識；同一個 key 再呼叫 = 更新音量與方向；gain 傳 0 = 淡出並釋放。kind：'fire' 火焰、'hiss' 噴煙 ──
  loop(key, kind = 'fire', gain = 1, pan = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime; let L = this.loops.get(key);
    if (!(gain > 0.001)) { if (L) this._endLoop(key, L, 0.25); return; }
    if (!L) {
      if (this.loops.size >= 12) return;
      const k = LOOPS[kind] ? kind : 'fire', src = c.createBufferSource(), g = c.createGain(), p = c.createStereoPanner ? c.createStereoPanner() : null;
      src.buffer = this._b('loop:' + k, LOOPS[k], true); src.loop = true; src.playbackRate.value = rr(0.92, 1.08); g.gain.value = 0;
      src.connect(g); if (p) { g.connect(p); p.connect(this.bus); } else g.connect(this.bus);
      src.onended = () => { this.stat.ended++; (p || g).disconnect(); };
      this.stat.made++; src.start(t, Math.random() * src.buffer.duration);            // 起點隨機，幾團火同時燒才不會相位重疊
      this.loops.set(key, L = { src, g, p, gv: -1, pv: 9 });
    }
    const gv = clamp(gain, 0, 2) * 0.36, pv = clamp(pan, -1, 1) * PAN;
    if (Math.abs(gv - L.gv) > 0.004) { L.gv = gv; L.g.gain.setTargetAtTime(gv, t, 0.08); }
    if (L.p && Math.abs(pv - L.pv) > 0.01) { L.pv = pv; L.p.pan.setTargetAtTime(pv, t, 0.08); }
  }
  _endLoop(key, L, fade) { const t = this.ctx.currentTime; this.loops.delete(key); L.g.gain.cancelScheduledValues(t); L.g.gain.setTargetAtTime(0, t, fade / 4); L.src.stop(t + fade * 2); }
  stopLoops() { if (!this.ctx) return; for (const [k, L] of [...this.loops]) this._endLoop(k, L, 0.08); }

  // ── 環境音：'wind' 開闊廢墟的風、'harbor' 港口（低鳴、水聲、遠處金屬聲）、'desert' 乾燥的風沙、'cave' 坑道（隆隆聲、滴水）、null = 關掉 ──
  // 換的時候約 1.5 秒交叉淡化；還沒 init 就呼叫也可以，會在 init 時開始播
  ambient(kind) {
    kind = AMB[kind] ? kind : null;
    if (!this.ctx) { this.ambKind = kind; return; }
    if (kind === this.ambKind) return;
    this.ambKind = kind;
    const c = this.ctx, t = c.currentTime, old = this.amb; this.amb = null;
    if (old) { old.g.gain.cancelScheduledValues(t); old.g.gain.setTargetAtTime(0, t, 0.4); for (const s of old.srcs) s.stop(t + 2.6); }
    if (!kind) return;
    const A = AMB[kind], g = c.createGain(), srcs = []; let left = A.L.length;
    g.gain.value = 0; g.gain.setTargetAtTime(A.g, t, 0.45); g.connect(this.ambBus);
    A.L.forEach(([fn, lg], i) => {
      const src = c.createBufferSource(), l = c.createGain(); src.buffer = this._b(`amb:${kind}:${i}`, fn, true); src.loop = true; src.playbackRate.value = i ? rr(0.96, 1.04) : 1; l.gain.value = lg;
      src.connect(l); l.connect(g); src.onended = () => { this.stat.ended++; if (--left === 0) g.disconnect(); };
      this.stat.made++; src.start(t, Math.random() * src.buffer.duration); srcs.push(src);
    });
    this.amb = { g, srcs };
  }
}
