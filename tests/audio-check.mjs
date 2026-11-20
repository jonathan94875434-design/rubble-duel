// 音效自動檢查：耳朵聽不到就用量的。
// 每個公開的聲音都用 OfflineAudioContext（44.1kHz 立體聲）算出來，量峰值／RMS／有效長度／左右聲道／頻譜，
// 再加上：1000rpm 連發壓力測試、距離遞減、各類槍的頻譜差異、循環音與環境音的停止、節點有沒有洩漏、遊戲本體能不能開機。
//   cd tests && node audio-check.mjs          （要先有本機伺服器 http://localhost:8765/；測線上版就設 BASE=網址）
import puppeteer from 'puppeteer-core';
import { CHROME } from './load.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || 'http://localhost:8765/').replace(/\/?$/, '/');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio'], protocolTimeout: 300000 });
let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
// 本機伺服器是單執行緒的，別的測試同時在跑時偶爾會斷線 → 載入失敗就重試
const open = async (path, ready) => {
  const page = await browser.newPage(), errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').includes('favicon')) errs.push(m.text() + ' @' + (m.location().url || '')); });
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message + '\n' + (e.stack || '')));
  for (let i = 0; i < 5; i++) {
    errs.length = 0;
    await page.goto(BASE + path, { waitUntil: 'load' }).catch(() => {});
    if (await page.waitForFunction(ready, { timeout: 12000 }).then(() => true, () => false)) break;
  }
  return { page, errs };
};

// ═══ 1. 離線算圖量測（借試聽板那一頁當宿主，不受遊戲本體改動影響）═══
const { page, errs } = await open('dev/audio.html', 'window.__board');
const out = await page.evaluate(async () => {
  const { Sfx } = await import('/js/audio.js?check=' + Date.now());
  const SR = 44100, rows = [], checks = [], notes = [];
  const ok = (name, cond, extra = '') => checks.push([!!cond, name, extra]);
  const dB = (v) => 20 * Math.log10(Math.max(v, 1e-9));
  // 固定亂數種子，數字才能重現
  let seed = 20261118; Math.random = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  // 數一共建立了幾個節點
  let nodes = 0;
  for (const k of ['createGain', 'createBufferSource', 'createBiquadFilter', 'createStereoPanner', 'createOscillator', 'createConvolver', 'createDynamicsCompressor', 'createWaveShaper', 'createDelay']) {
    const o = BaseAudioContext.prototype[k]; BaseAudioContext.prototype[k] = function (...a) { nodes++; return o.apply(this, a); };
  }
  // 記錄每個緩衝烘焙花了多久（第一次 = 冷啟動，之後 = JIT 熱了以後）
  const bakes = {}, _b = Sfx.prototype._b;
  Sfx.prototype._b = function (key, fn, sr) {
    if (this.bufs.has(key)) return _b.call(this, key, fn, sr);
    const t = performance.now(), b = _b.call(this, key, fn, sr), ms = performance.now() - t, e = bakes[key] || (bakes[key] = { cold: ms, warm: ms, sec: b.duration });
    e.warm = Math.min(e.warm, ms); return b;
  };

  const fft = (re, im) => {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < h; k++) { const a = i + k, b = a + h, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
    }
  };
  // 頻譜：重心（Hz，以振幅加權）＋五個頻帶的能量比例（<120 / 120~500 / 500~2k / 2k~6k / >6k）
  const spectrum = (L, R, from = 0, N = 65536) => {
    const re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < N && from + i < L.length; i++) re[i] = (L[from + i] + R[from + i]) / 2;
    fft(re, im); let sm = 0, sf = 0, tot = 0; const b = [0, 0, 0, 0, 0];
    for (let k = 1; k < N / 2; k++) { const f = k * SR / N, p = re[k] * re[k] + im[k] * im[k], m = Math.sqrt(p); sm += m; sf += m * f; tot += p; b[f < 120 ? 0 : f < 500 ? 1 : f < 2000 ? 2 : f < 6000 ? 3 : 4] += p; }
    return { cen: sm ? sf / sm : 0, bands: b.map((v) => (tot ? v / tot : 0)), bandAt: (f0, f1) => { let s = 0; for (let k = Math.ceil(f0 * N / SR); k <= f1 * N / SR; k++) s += re[k] * re[k] + im[k] * im[k]; return tot ? s / tot : 0; } };
  };
  // 峰值、RMS（算到有效長度為止）、有效長度（最後一個超過 -60dBFS 的取樣）、總能量、左右聲道能量差（dB，正 = 偏左）
  const analyze = (buf) => {
    const { L, R } = buf, n = L.length; let peak = 0, nan = 0, last = -1, eL = 0, eR = 0;
    for (let i = 0; i < n; i++) { const l = L[i], r = R[i]; if (!Number.isFinite(l) || !Number.isFinite(r)) { nan++; continue; } const a = Math.max(Math.abs(l), Math.abs(r)); if (a > peak) peak = a; if (a > 0.001) last = i; eL += l * l; eR += r * r; }
    const sp = spectrum(L, R);
    return { peak, nan, dur: (last + 1) / SR, rms: Math.sqrt((eL + eR) / (2 * Math.max(1, last + 1))), en: 10 * Math.log10((eL + eR) / 2 / SR + 1e-12), lr: 10 * Math.log10((eL + 1e-12) / (eR + 1e-12)), cen: sp.cen, bands: sp.bands };
  };
  const winRms = (buf, a, b) => { const { L, R } = buf; let e = 0, i0 = Math.round(a * SR), i1 = Math.min(L.length, Math.round(b * SR)); for (let i = i0; i < i1; i++) e += L[i] * L[i] + R[i] * R[i]; return Math.sqrt(e / (2 * Math.max(1, i1 - i0))); };
  // 算一段：前面先空 T0 秒（Chrome 的壓縮器剛建立時會有一小段不正常的增益，真實遊戲裡 AudioContext 早就在跑了，不會遇到），
  // 之後 fn(sfx, at) 裡直接呼叫的聲音在 t=0 發出；at(秒, f) = 算到那個時間點再呼叫（跟遊戲裡的呼叫方式一樣）。回傳的波形從 t=0 開始
  const T0 = 0.5;
  const render = async (fn, sec = 3, env) => {
    const off = new OfflineAudioContext(2, Math.round(SR * (sec + T0)), SR), sfx = new Sfx(); sfx.vol = 1; if (env) sfx.setEnv(env); sfx.init(off);
    let made = 0, err = null;
    const at = (t, f) => off.suspend(T0 + t).then(() => { try { f(sfx); } catch (e) { err = err || e; } off.resume(); });
    off.suspend(T0).then(() => { const n0 = nodes; try { fn(sfx, at); } catch (e) { err = err || e; } made = nodes - n0; off.resume(); });
    const ab = await off.startRendering(), i0 = Math.round(T0 * SR), buf = { L: ab.getChannelData(0).subarray(i0), R: ab.getChannelData(1).subarray(i0) }; await new Promise((r) => setTimeout(r, 0));
    if (err) throw err;
    return { buf, sfx, nodes: made, a: analyze(buf) };
  };

  const K = {
    pistol: { f: 1800, dur: 0.12, thump: 180, gain: 0.6, kind: 'pistol' }, smg: { f: 2200, dur: 0.1, thump: 210, gain: 0.6, kind: 'smg' }, rifle: { f: 1400, dur: 0.16, thump: 150, gain: 0.8, kind: 'rifle' },
    shotgun: { f: 800, dur: 0.3, thump: 90, gain: 1.0, kind: 'shotgun' }, sniper: { f: 700, dur: 0.42, thump: 70, gain: 1.1, kind: 'sniper' }, lmg: { f: 1000, dur: 0.18, thump: 110, gain: 0.9, kind: 'lmg' }, launcher: { f: 500, dur: 0.5, thump: 60, gain: 1.0, kind: 'launcher' },
  };
  const SURFS = ['concrete', 'metal', 'wood', 'dirt', 'sand', 'rock'];
  // [名稱, 呼叫, 秒數, 選項]；選項 c:false = 本來就不在正中間（不檢查左右平衡）
  const sounds = [
    ...Object.keys(K).map((k) => ['shot ' + k, (s) => s.shot(K[k])]),
    ['shot rifle d15', (s) => s.shot(K.rifle, 15, 0)], ['shot rifle d40', (s) => s.shot(K.rifle, 40, 0)],
    ['explosion', (s) => s.explosion(), 4], ['explosion d15', (s) => s.explosion(15, 0), 4], ['explosion d40', (s) => s.explosion(40, 0), 4], ['explosion size2', (s) => s.explosion(0, 0, 2), 5],
    ['hit', (s) => s.hit(false)], ['hit head', (s) => s.hit(true)], ['kill', (s) => s.kill()], ['hurt', (s) => s.hurt()], ['blockBreak', (s) => s.blockBreak(0)], ['dry', (s) => s.dry()],
    ['reload 0', (s) => s.reload(0)], ['reload 1', (s) => s.reload(1)], ['reload 2', (s) => s.reload(2)], ['reload 1 pistol', (s) => s.reload(1, 'pistol')], ['reload 1 shotgun', (s) => s.reload(1, 'shotgun')], ['reload 1 sniper', (s) => s.reload(1, 'sniper')],
    ['swap', (s) => s.swap()], ['throw', (s) => s.throw()], ['flashbang', (s) => s.flashbang(0, 0, 0)], ['flashbang ring2', (s) => s.flashbang(0, 0, 2), 4], ['hiss', (s) => s.hiss(0, 0)], ['molotov', (s) => s.molotov(0, 0)], ['bounce', (s) => s.bounce(0)],
    ['buy', (s) => s.buy()], ['deny', (s) => s.deny()], ['pickup', (s) => s.pickup()], ['ui', (s) => s.ui()], ['beep lo', (s) => s.beep(false)], ['beep hi', (s) => s.beep(true)], ['win', (s) => s.win()], ['lose', (s) => s.lose()],
    ['jump', (s) => s.jump()], ['land', (s) => s.land()], ['step', (s) => s.step(), 3, { c: false }],
    ...SURFS.map((f) => ['step ' + f, (s) => s.step(f), 3, { c: false }]), ...SURFS.map((f) => ['land ' + f, (s) => s.land(f)]),
    ['stepRemote d5', (s) => s.stepRemote(5, 0)], ['landRemote d5', (s) => s.landRemote(5, 0)],
    ...[...SURFS, 'flesh'].map((f) => ['impact ' + f, (s) => s.impact(f, 3, 0), 3, { c: false }]),
    ['whiz', (s) => s.whiz(0)], ['knifeSwing', (s) => s.knifeSwing()], ['knifeHit flesh', (s) => s.knifeHit(true)], ['knifeHit wall', (s) => s.knifeHit(false)],
    ['shell', (s) => s.shell(0.3), 3, { c: false }], ['spray', (s) => s.spray()], ['emote', (s) => s.emote()], ['respawn', (s) => s.respawn()], ['roundStart', (s) => s.roundStart()], ['voiceBlip on', (s) => s.voiceBlip(true)], ['voiceBlip off', (s) => s.voiceBlip(false)],
    ['loop fire', (s) => s.loop('a', 'fire', 1, 0), 3], ['loop hiss', (s) => s.loop('a', 'hiss', 1, 0), 3],
    ['ambient wind', (s) => s.ambient('wind'), 5], ['ambient harbor', (s) => s.ambient('harbor'), 5], ['ambient desert', (s) => s.ambient('desert'), 5], ['ambient cave', (s) => s.ambient('cave'), 5],
  ];
  const R = {};
  for (const [name, fn, sec = 3, o = {}] of sounds) {
    const r = await render(fn, sec); R[name] = r; rows.push({ name, ...r.a, nodes: r.nodes, made: r.sfx.stat.made, ended: r.sfx.stat.ended });
    const a = r.a, bad = [];
    if (!(a.peak > 0.01)) bad.push('太小聲 peak=' + a.peak.toFixed(4)); if (!(a.peak <= 1.0)) bad.push('破音 peak=' + a.peak.toFixed(3)); if (a.nan) bad.push('NaN×' + a.nan);
    if (o.c !== false && Math.abs(a.lr) > 3) bad.push('應該置中卻偏了 ' + a.lr.toFixed(1) + 'dB');
    ok('聲音正常：' + name, !bad.length, bad.join('、'));
  }

  // ── 這幾個例子的長度要在合理範圍 ──
  const inR = (name, lo, hi) => ok(`有效長度 ${name} 在 ${lo}~${hi}s`, R[name].a.dur >= lo && R[name].a.dur <= hi, R[name].a.dur.toFixed(2) + 's');
  inR('shot pistol', 0.3, 0.6); inR('shot sniper', 1.0, 1.5); inR('explosion', 1.5, 2.5);

  // ── 左右：pan=-1 要明顯偏左、pan=+1 要明顯偏右 ──
  const pans = [];
  for (const [name, fn] of [['shot rifle d10', (s, p) => s.shot(K.rifle, 10, p)], ['shot sniper d40', (s, p) => s.shot(K.sniper, 40, p)], ['explosion d10', (s, p) => s.explosion(10, p)], ['flashbang d5', (s, p) => s.flashbang(5, p, 0)], ['hiss d5', (s, p) => s.hiss(5, p)], ['molotov d5', (s, p) => s.molotov(5, p)],
    ['stepRemote d5', (s, p) => s.stepRemote(5, p)], ['landRemote d5', (s, p) => s.landRemote(5, p, 'metal')], ['impact d5', (s, p) => s.impact('dirt', 5, p)], ['whiz', (s, p) => s.whiz(p)], ['bounce d5', (s, p) => s.bounce(5, p)], ['blockBreak d5', (s, p) => s.blockBreak(5, p)], ['loop fire', (s, p) => s.loop('a', 'fire', 1, p)]]) {
    const l = (await render((s) => fn(s, -1), 3)).a, r = (await render((s) => fn(s, 1), 3)).a; pans.push({ name, l: l.lr, r: r.lr });
    ok('左右定位：' + name, l.lr > 6 && r.lr < -6, `pan-1 → L-R ${l.lr.toFixed(1)}dB、pan+1 → ${r.lr.toFixed(1)}dB`);
  }

  // ── 壓力測試：40 發步槍、1000rpm ──
  const burst = await render((s, at) => { s.shot(K.rifle); for (let i = 1; i < 40; i++) at(i * 0.06, (s) => { s.shot(K.rifle); s.shell(0.3); }); }, 4);
  rows.push({ name: '★ 40 發步槍 1000rpm', ...burst.a, nodes: burst.nodes, made: burst.sfx.stat.made, ended: burst.sfx.stat.ended });
  ok('壓力：40 發步槍 1000rpm 不破音、沒有 NaN', burst.a.peak <= 1.0 && burst.a.peak > 0.3 && !burst.a.nan, `peak=${burst.a.peak.toFixed(3)} rms=${burst.a.rms.toFixed(3)}`);
  const chaos = await render((s, at) => {
    s.ambient('wind'); s.loop('f1', 'fire', 1, -0.5); s.loop('f2', 'fire', 0.7, 0.6); s.shot(K.lmg);
    for (let i = 1; i < 50; i++) at(i * 0.06, (s) => { s.shot(K.lmg); s.shot(K.rifle, 12, 0.5); s.impact('concrete', 4, -0.3); s.shell(); if (i % 5 === 0) s.step('metal'); if (i === 8 || i === 20) s.explosion(i === 8 ? 0 : 9, 0.4, i === 8 ? 2 : 1); if (i === 12) s.flashbang(2, 0, 0); if (i === 30) { s.shot(K.sniper); s.shot(K.shotgun); s.hit(true); s.kill(); s.hurt(); } });
  }, 5);
  rows.push({ name: '★ 大混戰（全部疊在一起）', ...chaos.a, nodes: chaos.nodes, made: chaos.sfx.stat.made, ended: chaos.sfx.stat.ended });
  ok('壓力：槍＋爆炸＋閃光＋火＋環境音全部疊在一起也不破音', chaos.a.peak <= 1.0 && !chaos.a.nan, `peak=${chaos.a.peak.toFixed(3)}`);
  ok('每發槍聲的節點數 ≤ 8', R['shot rifle'].nodes <= 8 && R['shot rifle d15'].nodes <= 8 && R['shot rifle d40'].nodes <= 8, `自己 ${R['shot rifle'].nodes}、15m ${R['shot rifle d15'].nodes}、40m ${R['shot rifle d40'].nodes}`);

  // ── 距離：越遠越小聲，而且音色跟著變（高頻比例變少）──
  for (const [k, names] of [['步槍', ['shot rifle', 'shot rifle d15', 'shot rifle d40']], ['爆炸', ['explosion', 'explosion d15', 'explosion d40']]]) {
    const a = names.map((n) => R[n].a), hi = a.map((x) => x.bands[3] + x.bands[4]);
    ok(`距離遞減（${k} 0/15/40m）`, a[0].peak > a[1].peak && a[1].peak > a[2].peak && a[0].en > a[1].en && a[1].en > a[2].en, 'peak ' + a.map((x) => x.peak.toFixed(3)).join(' > ') + '、能量 ' + a.map((x) => x.en.toFixed(1)).join(' > ') + 'dB');
    // 音色用頻譜重心看（越遠越低）；40m 的高頻佔比要不到近處的一半。（0m 與 15m 的高頻「佔比」不直接比：自己開槍時限幅器會把最前面的爆音壓掉一些）
    ok(`距離改變音色（${k}：越遠越悶）`, a[0].cen > a[1].cen && a[1].cen > a[2].cen && hi[2] < hi[0] * 0.5, '頻譜重心 ' + a.map((x) => Math.round(x.cen)).join(' → ') + 'Hz、>2kHz 能量佔比 ' + hi.map((x) => (x * 100).toFixed(1) + '%').join(' → '));
  }

  // ── 各類槍的聲音要分得出來：兩兩比較頻譜重心、頻帶能量、長度 ──
  const kinds = Object.keys(K), dist = (a, b) => Math.abs(Math.log2(a.cen / b.cen)) + a.bands.reduce((s, v, i) => s + Math.abs(v - b.bands[i]), 0) / 2 + Math.abs(Math.log(a.dur / b.dur)) / 2;
  let minD = 9, minPair = ''; const pairs = [];
  for (let i = 0; i < kinds.length; i++) for (let j = i + 1; j < kinds.length; j++) { const d = dist(R['shot ' + kinds[i]].a, R['shot ' + kinds[j]].a); pairs.push([kinds[i], kinds[j], d]); if (d < minD) { minD = d; minPair = kinds[i] + '↔' + kinds[j]; } }
  ok('七類槍兩兩都分得出來（差異分數 > 0.2）', minD > 0.2, `最接近的是 ${minPair} = ${minD.toFixed(2)}`);
  // 遊戲裡現在的每一把槍（snd.kind 還沒加的話就看得出猜成哪一類）
  const weapons = [];
  try {
    const { WEAPONS } = await import('/js/weapons.js?check=' + Date.now());
    for (const [id, w] of Object.entries(WEAPONS)) { if (!w.snd) continue; if (!(w.snd.gain > 0)) { notes.push(`weapons.js：${id} 的 snd.gain = 0（設計上就是無聲，shot() 會直接略過）`); continue; } const r = await render((s) => s.shot(w.snd)); weapons.push({ name: id, kind: [...r.sfx.guns.values()][0].kind + (w.snd.kind ? '' : '（猜）'), ...r.a, nodes: r.nodes }); }
    const bad = weapons.filter((w) => !(w.peak > 0.01 && w.peak <= 1 && !w.nan)); ok('weapons.js 裡每一把槍都發得出聲音', !bad.length, bad.map((w) => w.name).join(','));
  } catch (e) { notes.push('weapons.js 讀不到（別人正在改？）：' + e.message); }

  // ── 循環音：gain 傳 0 之後要安靜下來並釋放 ──
  { const r = await render((s, at) => { s.loop('a', 'fire', 1, 0); at(1, (s) => { s.loop('a', 'fire', 0); r0 = s.loops.size; }); }, 3); var r0; const on = winRms(r.buf, 0.3, 0.9), off = winRms(r.buf, 1.8, 3);
    ok('循環音：loop(key, kind, 0) 之後安靜並釋放', on > 0.005 && off < 1e-5 && r0 === 0 && r.sfx.stat.made === r.sfx.stat.ended, `播放中 rms=${on.toFixed(4)}、停止後 rms=${off.toExponential(1)}、音源 ${r.sfx.stat.made}/${r.sfx.stat.ended}`); }
  { const r = await render((s, at) => { s.loop('a', 'fire', 1, -1); s.loop('b', 'fire', 1, 1); s.loop('c', 'hiss', 1, 0); at(0.5, (s) => s.loop('a', 'fire', 0.3, 0.5)); at(1, (s) => s.stopLoops()); }, 3); const on = winRms(r.buf, 0.3, 0.9), off = winRms(r.buf, 1.5, 3);
    ok('循環音：stopLoops() 全部停掉', on > 0.005 && off < 1e-5 && r.sfx.loops.size === 0 && r.sfx.stat.made === 3 && r.sfx.stat.ended === 3, `播放中 rms=${on.toFixed(4)}、停止後 rms=${off.toExponential(1)}`); }
  // ── 環境音：null 會淡出、換場景時交叉淡化中間不會斷 ──
  { const r = await render((s, at) => { s.ambient('wind'); at(1.5, (s) => s.ambient(null)); }, 5); const on = winRms(r.buf, 0.9, 1.5), off = winRms(r.buf, 4.3, 5);
    ok('環境音：ambient(null) 淡出後安靜', on > 0.002 && off < 1e-5 && r.sfx.stat.made === r.sfx.stat.ended, `播放中 rms=${on.toFixed(4)}、之後 rms=${off.toExponential(1)}、音源 ${r.sfx.stat.made}/${r.sfx.stat.ended}`); }
  { const r = await render((s, at) => { s.ambient('wind'); at(2.5, (s) => s.ambient('cave')); }, 7); const w = []; for (let t = 1.5; t < 6.75; t += 0.25) w.push(winRms(r.buf, t, t + 0.25));
    ok('環境音：wind → cave 交叉淡化沒有斷掉', Math.min(...w) > 0.002 && r.sfx.stat.made === 4 && r.sfx.stat.ended === 2, `每 0.25s 的 rms 最小 ${Math.min(...w).toFixed(4)}、最大 ${Math.max(...w).toFixed(4)}`); }
  // 還沒 init 就指定環境音／空間 → init 之後生效
  { const off = new OfflineAudioContext(2, SR * 3, SR), s = new Sfx(); s.vol = 1; s.ambient('harbor'); s.setEnv({ reverb: 0.6, size: 2 }); s.init(off); const ab = await off.startRendering(), a = analyze({ L: ab.getChannelData(0), R: ab.getChannelData(1) });
    ok('init 之前呼叫 ambient／setEnv，init 之後會生效', a.peak > 0.01 && s.env.size === 2 && s.env.reverb === 0.6, `peak=${a.peak.toFixed(3)}`); }
  // 循環用的緩衝接縫要連續（不會每一圈「喀」一聲）
  { const bad = []; let worst = 0;
    for (const nm of ['loop fire', 'loop hiss', 'ambient wind', 'ambient harbor', 'ambient desert', 'ambient cave']) for (const [key, b] of R[nm].sfx.bufs) for (let c = 0; c < b.numberOfChannels; c++) {
      const x = b.getChannelData(c), n = x.length, d = new Float32Array(n - 1); for (let i = 0; i < n - 1; i++) d[i] = Math.abs(x[i + 1] - x[i]); d.sort();
      const seam = Math.abs(x[0] - x[n - 1]), ratio = seam / (d[Math.floor(n * 0.999)] || 1e-9); worst = Math.max(worst, ratio); if (ratio > 1.5) bad.push(`${key}[${c}] ${ratio.toFixed(1)}×`);
    }
    ok('循環緩衝的接縫連續', !bad.length, bad.length ? bad.join('、') : `接縫跳動最大只有內部 99.9% 位數的 ${worst.toFixed(2)} 倍`); }

  // ── 閃光彈：耳鳴聲在、世界被壓低、最後平滑收掉 ──
  { const r = R['flashbang ring2'], L = r.buf.L, Rr = r.buf.R, sp = spectrum(L, Rr, Math.round(0.8 * SR), 32768), tone = sp.bandAt(4100, 4280), tail = winRms(r.buf, 3.2, 4);
    let jump = 0; for (let i = Math.round(1.5 * SR); i < L.length - 1; i++) jump = Math.max(jump, Math.abs(L[i + 1] - L[i]));
    ok('閃光彈：耳鳴聲（≈4.2kHz）存在並平滑淡出', tone > 0.8 && tail < 1e-5 && jump < 0.05, `0.8s 後 4.1~4.3kHz 佔 ${(tone * 100).toFixed(0)}%、結束後 rms=${tail.toExponential(1)}、最大取樣跳動 ${jump.toFixed(4)}`); }
  { const r = await render((s, at) => { s.loop('a', 'fire', 1, 0); at(1, (s) => s.duck(0.9, 1.5)); }, 4.5); const a = winRms(r.buf, 0.4, 0.95), b = winRms(r.buf, 1.15, 1.45), c = winRms(r.buf, 3.2, 4.4);
    ok('duck：壓低至少 12dB，之後恢復', dB(a) - dB(b) > 12 && Math.abs(dB(a) - dB(c)) < 3, `之前 ${dB(a).toFixed(1)}dB、壓低時 ${dB(b).toFixed(1)}dB、恢復後 ${dB(c).toFixed(1)}dB`); }
  { const a = (await render((s, at) => { s.loop('a', 'fire', 1, 0); at(1, (s) => s.flashbang(0, 0, 2)); }, 2)).buf, b = (await render((s) => s.loop('a', 'fire', 1, 0), 2)).buf, sa = spectrum(a.L, a.R, Math.round(1.3 * SR), 16384), sb = spectrum(b.L, b.R, Math.round(1.3 * SR), 16384);
    notes.push(`閃光彈 ring=2：0.3s 後世界音（<3kHz）能量佔比 ${(sa.bandAt(60, 3000) * 100).toFixed(1)}%（沒被閃時 ${(sb.bandAt(60, 3000) * 100).toFixed(1)}%），整體 rms ${winRms(a, 1.3, 1.6).toFixed(4)} vs ${winRms(b, 1.3, 1.6).toFixed(4)}`); }

  // ── 空間：殘響越多越長，尾巴就越長 ──
  { const d = []; for (const env of [{ reverb: 0, size: 1 }, { reverb: 0.3, size: 1.1 }, { reverb: 0.8, size: 2.6 }]) { const r = await render((s) => s.shot(K.rifle), 5, env); d.push(r.a); }
    ok('setEnv：乾 → 預設 → 地下道，尾音越來越長而且都不破音', d[0].dur < d[1].dur && d[1].dur < d[2].dur && d.every((x) => x.peak <= 1 && !x.nan), '步槍有效長度 ' + d.map((x) => x.dur.toFixed(2) + 's').join(' → '));
    const r = await render((s, at) => { s.shot(K.rifle); at(0.5, (s) => s.setEnv({ reverb: 0.7, size: 2.2 })); at(1, (s) => s.shot(K.rifle)); }, 5); ok('setEnv：播放中途換空間沒有 NaN／破音', r.a.peak <= 1 && !r.a.nan, `peak=${r.a.peak.toFixed(3)} 長度 ${r.a.dur.toFixed(2)}s`); }

  // ── 頻率限制 ──
  { const r = await render((s, at) => { for (let i = 0; i < 100; i++) at(0.01 * (i + 1), (s) => s.impact('dirt', 3, 0)); }, 2); ok('impact 內部限制 ≤ 20 次／秒', r.sfx.stat.made >= 10 && r.sfx.stat.made <= 21, `1 秒內呼叫 100 次 → 實際發聲 ${r.sfx.stat.made} 次`);
    const b = await render((s) => { for (let i = 0; i < 50; i++) { s.impact('metal', 3, 0); s.whiz(0); s.shell(0); } }, 1); ok('同一瞬間狂呼叫只會發一次', b.sfx.stat.made <= 4, `impact/whiz/shell 各 50 次 → ${b.sfx.stat.made} 個音源`); }

  // ── API：每個方法都在；沒 init 時全部安靜地什麼都不做；init 之後全部呼叫一輪不出錯 ──
  const API = { shot: [K.rifle, 10, 0.3], explosion: [10, 0.3, 1], hit: [true], kill: [], hurt: [], blockBreak: [3], dry: [], reload: [1, 'rifle'], swap: [], throw: [], flashbang: [5, 0.2, 1], hiss: [5, 0.2], buy: [], deny: [], jump: [], land: ['wood'], step: ['metal'], stepRemote: [5, 0.2, 'dirt'], landRemote: [5, 0.2, 'sand'], bounce: [4], pickup: [], ui: [], beep: [true], win: [], lose: [],
    impact: ['metal', 5, 0.2], whiz: [0.4], knifeSwing: [], knifeHit: [true], molotov: [5, 0.2], loop: ['k', 'fire', 0.5, 0.1], stopLoops: [], ambient: ['wind'], shell: [0.3], spray: [], emote: [], respawn: [], roundStart: [], voiceBlip: [true], duck: [0.8, 1], setEnv: [{ reverb: 0.5, size: 2 }], setVolume: [0.5], preload: [[K.rifle]] };
  { const dead = new Sfx(), missing = Object.keys(API).filter((k) => typeof dead[k] !== 'function'), threw = [];
    for (const [k, a] of Object.entries(API)) { try { dead[k](...a); dead[k](); } catch (e) { threw.push(k + ': ' + e.message); } }
    ok('公開方法都存在', !missing.length && typeof dead.init === 'function', missing.join(','));
    ok('沒 init 時每個方法都是安靜的空動作', !threw.length && dead.ctx === null, threw.join(' | '));
    const live = [], weird = [];
    const r = await render((s) => { for (const [k, a] of Object.entries(API)) { try { s[k](...a); } catch (e) { live.push(k + ': ' + e.message); } }
      // 奇怪的參數也不能出錯
      for (const f of [() => s.shot(undefined), () => s.shot({}), () => s.shot({ kind: 'nope' }), () => s.shot({ kind: 'sniper' }, 500, 3), () => s.step('lava'), () => s.impact(undefined), () => s.impact('glass', -5, NaN), () => s.reload(7, 'x'), () => s.reload(true), () => s.explosion(1e9, 0, 0), () => s.explosion(0, 0, 99), () => s.loop('z', 'nope', 5, 9), () => s.ambient('nope'), () => s.setEnv({}), () => s.setEnv(), () => s.duck(), () => s.shell(-1), () => s.stepRemote(999, 0), () => s.init(), () => s.init(new Event('x')),
        () => s.shot(K.rifle, NaN, NaN), () => s.shot({ kind: 'knife', f: 0, dur: 0, thump: 0, gain: 0 }), () => s.explosion(NaN, NaN, NaN), () => s.stepRemote(NaN, 0), () => s.landRemote(undefined), () => s.impact('metal', NaN), () => s.flashbang(NaN, 0, NaN), () => s.flashbang(NaN, NaN, 1), () => s.molotov(NaN), () => s.hiss(NaN), () => s.bounce(NaN), () => s.blockBreak(NaN, NaN),
        () => s.loop('q', 'fire', NaN, NaN), () => s.loop('q2', 'fire', 1, NaN), () => s.duck(NaN, NaN, NaN), () => s.setEnv(null), () => s.setEnv({ reverb: NaN, size: 'x' }), () => s.shell(NaN), () => s.preload([null, {}, { kind: 'knife', gain: 0 }]), () => s.preload(null), () => s.setVolume(NaN), () => s.setVolume('0.5'), () => s.setVolume(1)]) { try { f(); } catch (e) { weird.push(f.toString().slice(6, 60) + ' → ' + e.message); } } }, 3);
    ok('init 之後全部呼叫一輪不出錯、不破音', !live.length && r.a.peak <= 1 && !r.a.nan, live.join(' | ') + ` peak=${r.a.peak.toFixed(3)}`);
    ok('奇怪的參數不會讓它掛掉', !weird.length, weird.join(' | ')); }
  // 舊的呼叫方式（main.js / combat.js 現在的寫法）都還能用
  { const e = []; const r = await render((s) => { try { s.shot({ f: 1400, dur: 0.16, thump: 150, gain: 0.8 }); s.shot({ f: 900, dur: 0.3, thump: 100, gain: 1 }, 12, -0.4); s.explosion(8, 0.2); s.blockBreak(6); s.reload(0); s.reload(1); s.flashbang(4, 0.1, 1.5); s.hiss(3, 0); s.step(); s.land(); s.stepRemote(6, 0.3); s.landRemote(6, 0.3); s.bounce(5); s.beep(false); } catch (x) { e.push(x.message); } });
    ok('舊的呼叫方式都相容', !e.length && r.a.peak > 0.05 && !r.a.nan, e.join(' | ')); }

  // ── 離線算圖時，一次性的聲音播完都會回報結束（= 輸出鏈被拆掉）──
  { const all = [burst, ...Object.entries(R).filter(([n]) => !n.startsWith('loop') && !n.startsWith('ambient')).map(([, r]) => r)], leak = all.filter((r) => r.sfx.stat.made !== r.sfx.stat.ended).length;
    ok('一次性的聲音播完都有收掉（離線）', leak === 0, `${all.length} 段裡有 ${leak} 段 made≠ended；40 發連發 = ${burst.sfx.stat.made}/${burst.sfx.stat.ended}`); }

  const slow = Object.entries(bakes).sort((a, b) => b[1].warm - a[1].warm).slice(0, 24).map(([k, v]) => ({ key: k, cold: v.cold, warm: v.warm, sec: v.sec }));
  return { rows, checks, notes, pans, pairs, weapons, slow, bakeTotal: Object.values(bakes).reduce((s, v) => s + v.warm, 0), bakeN: Object.keys(bakes).length };
}).catch((e) => ({ fatal: e.message + '\n' + (e.stack || '') }));

if (out.fatal) { ok('離線量測跑得完', false, out.fatal); }
else {
  const f = (v, n = 3) => v.toFixed(n).padStart(7), pct = (b) => b.map((v) => String(Math.round(v * 100)).padStart(3)).join('');
  console.log('\n名稱                          peak     rms   長度s   能量dB  L-R dB  重心Hz   頻帶%(<120|<500|<2k|<6k|>6k) 節點 音源');
  for (const r of out.rows) console.log(`${r.name.padEnd(28)}${f(r.peak)} ${f(r.rms, 4)} ${f(r.dur, 2)} ${f(r.en, 1)} ${f(r.lr, 1)} ${String(Math.round(r.cen)).padStart(7)}   ${pct(r.bands)}        ${String(r.nodes).padStart(3)}  ${r.made}/${r.ended}`);
  if (out.weapons.length) { console.log('\nweapons.js 的每一把槍      類型          peak     rms   長度s  重心Hz   頻帶%              節點'); for (const r of out.weapons) console.log(`${r.name.padEnd(12)}${r.kind.padEnd(16)}${f(r.peak)} ${f(r.rms, 4)} ${f(r.dur, 2)} ${String(Math.round(r.cen)).padStart(7)}   ${pct(r.bands)}   ${String(r.nodes).padStart(3)}`); }
  console.log('\n槍聲類型兩兩的差異分數（|log2 重心比| + 頻帶差/2 + |ln 長度比|/2）：'); console.log('  ' + out.pairs.map(([a, b, d]) => `${a}↔${b} ${d.toFixed(2)}`).join('  '));
  console.log('\n烘焙時間最久的 24 個緩衝（毫秒；冷 = 第一次、熱 = JIT 之後）：'); for (const s of out.slow) console.log(`  ${s.key.padEnd(34)} 冷 ${s.cold.toFixed(1).padStart(6)}  熱 ${s.warm.toFixed(1).padStart(6)}  （${s.sec.toFixed(2)}s 的聲音）`);
  console.log(`  全部 ${out.bakeN} 個緩衝烘焙一次共 ${out.bakeTotal.toFixed(0)}ms（熱）`);
  for (const n of out.notes) console.log('NOTE  ' + n);
  console.log('');
  for (const [c, name, extra] of out.checks) ok(name, c, extra);
}

// ═══ 2. 真的 AudioContext（靜音輸出）：節點不會越積越多 ═══
const rt = await page.evaluate(async () => {
  const { Sfx } = await import('/js/audio.js?rt=' + Date.now()), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const s = new Sfx(); s.vol = 1; s.init(); await s.ctx.resume().catch(() => {}); await sleep(300);
  const rifle = { f: 1400, dur: 0.16, thump: 150, gain: 0.8, kind: 'rifle' }, t0 = s.ctx.currentTime, hist = [];
  s.ambient('wind'); s.loop('f', 'fire', 0.8, 0.3);
  let worst = 0;
  for (let i = 0; i < 150; i++) {                    // 9 秒的 1000rpm 連發，同時有對手的槍聲、彈著、腳步、爆炸
    const t = performance.now();
    s.shot(rifle); s.shell(); s.shot(rifle, 20, -0.5); s.impact('concrete', 5, 0.2); s.loop('f', 'fire', 0.5 + 0.3 * Math.sin(i), Math.sin(i / 7));
    if (i % 6 === 0) s.step('metal'); if (i % 40 === 5) s.explosion(8, 0.3); if (i === 60) s.flashbang(3, 0, 1.5);
    worst = Math.max(worst, performance.now() - t);
    if (i % 25 === 24) hist.push(s.stat.made - s.stat.ended);
    await sleep(60);
  }
  const during = s.stat.made - s.stat.ended, advanced = s.ctx.currentTime - t0;
  s.loop('f', 'fire', 0); s.ambient(null); await sleep(5200);
  const res = { state: s.ctx.state, sr: s.ctx.sampleRate, advanced, hist, during, after: s.stat.made - s.stat.ended, made: s.stat.made, loops: s.loops.size, worst, bufs: s.bufs.size };
  await s.ctx.close(); return res;
}).catch((e) => ({ fatal: e.message }));
if (rt.fatal) ok('即時測試跑得完', false, rt.fatal);
else {
  ok('真的 AudioContext 有在跑', rt.state === 'running' && rt.advanced > 5, `state=${rt.state} ${rt.sr}Hz，跑了 ${rt.advanced.toFixed(1)}s`);
  ok('連發 9 秒期間，同時存在的音源數量穩定（沒有越積越多）', Math.max(...rt.hist.slice(2)) <= Math.max(60, rt.hist[1] * 1.6), `每 1.5 秒取樣：${rt.hist.join(', ')}（共建立 ${rt.made} 個）`);
  ok('全部停下來之後，所有音源都結束並拆線', rt.after === 0 && rt.loops === 0, `連發中 ${rt.during} 個 → 停止 5 秒後剩 ${rt.after} 個`);
  console.log(`NOTE  即時連發時，單一影格裡呼叫音效最久花 ${rt.worst.toFixed(1)}ms（含第一次烘焙）；共烘焙 ${rt.bufs} 個緩衝`);
}
// 試聽板：每個按鈕都按一次、每個滑桿都動一下，不能出錯
{
  const n = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), bs = [...document.querySelectorAll('#board button')];
    for (const id of ['dist', 'pan', 'rev', 'size']) { const el = document.getElementById(id); el.value = id === 'dist' ? 20 : id === 'pan' ? -0.6 : id === 'rev' ? 0.6 : 2; el.dispatchEvent(new Event('input')); }
    const amb = document.getElementById('amb'); amb.value = 'cave'; amb.dispatchEvent(new Event('change'));
    for (const b of bs) { b.click(); await sleep(15); }
    await sleep(400); window.sfx.stopLoops(); window.sfx.ambient(null);
    return { n: bs.length, made: window.sfx.stat.made, state: window.sfx.ctx && window.sfx.ctx.state };
  }).catch((e) => ({ fatal: e.message }));
  ok('試聽板：所有按鈕都按得動、沒有錯誤', !n.fatal && n.n > 50 && n.made > 50 && errs.length === 0, n.fatal || `${n.n} 個按鈕、發出 ${n.made} 個音源、ctx=${n.state} ` + errs.join('\n').slice(0, 600));
}
await page.close();

// ═══ 3. 遊戲本體開得起來，而且用的是新的音效引擎 ═══
{
  const { page, errs } = await open('?nolock=1', 'window.__game && window.__game.sfx');
  await sleep(1500);
  const g = await page.evaluate(async () => {
    const s = window.__game && window.__game.sfx; if (!s) return { none: true };
    const e = []; try { s.init(); for (const k of ['ui', 'buy', 'step', 'jump', 'land', 'hit', 'kill', 'dry', 'swap']) s[k](); s.shot({ f: 1400, dur: 0.16, thump: 150, gain: 0.8 }); s.shot({ f: 900, dur: 0.3, thump: 100, gain: 1 }, 12, 0.4); s.explosion(10, 0.2); s.reload(0); s.reload(1); s.stepRemote(5, 0.2); s.flashbang(5, 0, 0.5); } catch (x) { e.push(x.message + '\n' + x.stack); }
    await new Promise((r) => setTimeout(r, 1200));
    return { e, hasNew: typeof s.impact === 'function' && typeof s.setEnv === 'function', state: s.ctx && s.ctx.state, made: s.stat && s.stat.made, phase: window.__game.phase };
  }).catch((e) => ({ fatal: e.message }));
  const mine = errs.filter((x) => /audio\.js|sfx|Sfx/.test(x)), other = errs.filter((x) => !mine.includes(x));
  if (g.none || g.fatal) ok('遊戲開機：找得到 __game.sfx', false, g.fatal || '頁面沒有 __game（別的檔案正在改？）' + errs.join('\n').slice(0, 500));
  else {
    ok('遊戲開機：__game.sfx 是新的引擎，實際呼叫沒有丟錯', g.hasNew && !g.e.length && g.made > 10, `ctx=${g.state} 音源 ${g.made} 個 ${g.e.join(' | ')}`);
    ok('遊戲開機：沒有跟音效有關的 console／頁面錯誤', mine.length === 0, mine.join('\n').slice(0, 800));
  }
  if (other.length) console.log(`WARN  遊戲頁有 ${other.length} 個跟音效無關的錯誤（其他檔案正在改寫中？）：\n      ` + other.join('\n').slice(0, 700).replace(/\n/g, '\n      '));
  else console.log('NOTE  遊戲頁沒有任何 console／頁面錯誤');
  await page.close();
}

await browser.close();
console.log(fails ? `\n✗ ${fails} 項沒過` : '\n✓ 全部通過');
process.exit(fails ? 1 : 0);
