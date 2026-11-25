import * as THREE from 'three';

// 特殊塗裝的花紋：每一種都用程式在小畫布上畫，第一次用到才畫，之後共用。
// 槍的貼圖座標是「公尺」（gunmodel.js 的 merge：側面 u = 槍身前後、v = 上下），
// rep = 每公尺重複幾次、off = 位移；畫面左邊（u 小）是槍口那一端。
// 不是無縫的圖一律用「鏡射重複」，接縫才不會一刀切開。

const TAU = Math.PI * 2;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const lerp = (a, b, t) => a + (b - a) * t;

// 一團一團柔和的光（星雲、火焰底色用）
function blob(c, x, y, r, col, a) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, col.replace('A', a)); g.addColorStop(1, col.replace('A', 0));
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
}

const DRAW = {
  // 赤焰龍：黑漆底＋金色祥雲。龍盤在槍托上（畫布右邊），龍頭在握把前面朝槍口，火沿著護木一路噴到槍口
  // 畫布：橫向 u 0 = 狙擊槍護木前端、1 = 槍托底；直向涵蓋槍托的高度
  dragon: { w: 1024, h: 256, rep: [1.16, 5.2], off: [0.7, 0.68], draw(c, w, h, r) {
    const bg = c.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#22100a'); bg.addColorStop(0.5, '#0f0706'); bg.addColorStop(1, '#22100a');
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) blob(c, w * (0.7 + i * 0.06), h * (0.3 + r() * 0.4), h * 0.4, 'rgba(150,20,10,A)', 0.4);   // 龍身後面暗紅色的光
    // 祥雲：一圈一圈的捲雲
    c.lineCap = 'round';
    for (let i = 0; i < 34; i++) {
      const x = r() * w, y = r() * h, s = 6 + r() * 12;
      c.strokeStyle = `rgba(222,170,70,${0.3 + r() * 0.3})`; c.lineWidth = 2.2;
      for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(x + k * s * 1.3, y + (k % 2) * s * 0.4, s * (1 - k * 0.18), Math.PI * 0.9, Math.PI * 2.4); c.stroke(); }
    }
    // 身體的路徑：t = 0 尾巴（槍托底）→ t = 1 龍頭（握把前面），上下盤兩圈
    const P = (t) => [lerp(w * 1.0, w * 0.66, t), h * 0.5 + Math.sin(t * 11 + 0.4) * h * 0.26 * (1 - t * 0.55)];
    const R = (t) => h * lerp(0.035, 0.1, Math.min(1, t * 1.4));
    // 噴出來的火：從嘴巴沿著護木往左邊（槍口）一路變細變淡
    const [hx, hy] = P(1), hr = R(1) * 1.3, mx = hx - hr * 2.6, my = hy + hr * 0.15;
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 140; i++) {
      const t = Math.pow(r(), 0.8), x = lerp(mx, 0, t), spread = h * (0.04 + t * 0.12);
      blob(c, x, my + (r() - 0.5) * spread + Math.sin(t * 14) * h * 0.03, h * (0.06 + (1 - t) * 0.08), t < 0.4 ? 'rgba(255,170,40,A)' : 'rgba(255,80,10,A)', 0.34 * (1 - t * 0.6));
    }
    c.globalCompositeOperation = 'source-over';
    // 背鰭
    for (let t = 0.04; t < 0.95; t += 0.02) {
      const [x, y] = P(t), [x2, y2] = P(t + 0.012), a = Math.atan2(y2 - y, x2 - x) + Math.PI / 2, rr = R(t);
      c.fillStyle = (t * 50) % 2 < 1 ? '#ff8a1a' : '#ffc84a';
      c.beginPath(); c.moveTo(x + Math.cos(a) * rr * 0.7, y + Math.sin(a) * rr * 0.7);
      c.lineTo(x + Math.cos(a + 0.5) * rr * 1.7, y + Math.sin(a + 0.5) * rr * 1.7); c.lineTo(x2 + Math.cos(a) * rr * 0.7, y2 + Math.sin(a) * rr * 0.7); c.fill();
    }
    // 爪子
    for (const t of [0.35, 0.72]) {
      const [x, y] = P(t), rr = R(t), d = y < h * 0.5 ? 1 : -1;
      c.strokeStyle = '#ffcf5a'; c.lineWidth = 2.6;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x - rr * 0.6, y + d * rr * 1.5, x - rr * 1.3, y + d * rr * 1.9); c.stroke();
      for (let k = -1; k <= 1; k++) { c.beginPath(); c.moveTo(x - rr * 1.3, y + d * rr * 1.9); c.quadraticCurveTo(x - rr * (1.7 + k * 0.3), y + d * rr * (2.2 + k * 0.2), x - rr * (2 + k * 0.4), y + d * rr * (1.9 + k * 0.5)); c.stroke(); }
    }
    // 身體：一顆一顆的圓接成管子，先畫暗的影子再畫亮的
    for (const [dy, col] of [[0.25, '#5a0606'], [0, null]]) {
      for (let t = 0; t <= 1; t += 0.002) {
        const [x, y] = P(t), rr = R(t);
        if (col) c.fillStyle = col;
        else { const g = c.createRadialGradient(x, y - rr * 0.4, rr * 0.1, x, y, rr); g.addColorStop(0, '#ff6a2a'); g.addColorStop(0.6, '#c01414'); g.addColorStop(1, '#6a0808'); c.fillStyle = g; }
        c.beginPath(); c.arc(x, y + dy * rr, rr, 0, TAU); c.fill();
      }
    }
    // 鱗片
    c.lineWidth = 1.3;
    for (let t = 0.02; t < 0.97; t += 0.009) {
      const [x, y] = P(t), rr = R(t);
      for (const o of [-0.45, 0, 0.45]) { c.strokeStyle = 'rgba(255,190,80,0.55)'; c.beginPath(); c.arc(x, y + o * rr, rr * 0.32, Math.PI * 0.15, Math.PI * 0.85); c.stroke(); }
    }
    // 金色的腹甲
    c.strokeStyle = '#e8b04a'; c.lineWidth = 2.6;
    c.beginPath(); for (let t = 0; t <= 0.98; t += 0.008) { const [x, y] = P(t), rr = R(t); t ? c.lineTo(x, y + rr * 0.7) : c.moveTo(x, y + rr * 0.7); } c.stroke();
    // 龍頭（朝左＝朝槍口，張嘴）
    c.fillStyle = '#b81212';
    c.beginPath(); c.moveTo(hx + hr * 0.6, hy - hr); c.quadraticCurveTo(hx - hr * 1.2, hy - hr * 1.3, hx - hr * 2.6, hy - hr * 0.35);
    c.lineTo(hx - hr * 2.7, hy + hr * 0.05); c.lineTo(hx - hr * 1.2, hy + hr * 0.1); c.lineTo(hx - hr * 2.3, hy + hr * 0.55);
    c.quadraticCurveTo(hx - hr * 0.6, hy + hr * 1.1, hx + hr * 0.6, hy + hr * 0.8); c.closePath(); c.fill();
    c.fillStyle = '#ff5a1a'; c.beginPath(); c.moveTo(hx - hr * 1.2, hy - hr * 0.95); c.quadraticCurveTo(hx - hr * 2, hy - hr * 0.9, hx - hr * 2.5, hy - hr * 0.42); c.lineTo(hx - hr * 1.3, hy - hr * 0.45); c.fill();
    c.fillStyle = '#fff4c8'; for (let i = 0; i < 4; i++) { const x = hx - hr * (1.4 + i * 0.3); c.beginPath(); c.moveTo(x, hy); c.lineTo(x - hr * 0.1, hy + hr * 0.22); c.lineTo(x - hr * 0.2, hy); c.fill(); }   // 牙
    c.fillStyle = '#ffe14a'; c.beginPath(); c.ellipse(hx - hr * 0.9, hy - hr * 0.55, hr * 0.26, hr * 0.17, -0.2, 0, TAU); c.fill();      // 眼睛
    c.fillStyle = '#100'; c.beginPath(); c.ellipse(hx - hr * 0.9, hy - hr * 0.55, hr * 0.07, hr * 0.15, 0, 0, TAU); c.fill();
    c.strokeStyle = '#ffcf5a'; c.lineWidth = 3.4;                                                                                         // 角
    for (const k of [0, 1]) { c.beginPath(); c.moveTo(hx - hr * 0.2 + k * hr * 0.4, hy - hr * 0.95); c.quadraticCurveTo(hx + hr * (0.8 + k * 0.5), hy - hr * (2.0 - k * 0.2), hx + hr * (1.9 + k * 0.4), hy - hr * (1.6 - k * 0.4)); c.stroke(); }
    c.lineWidth = 1.8; c.strokeStyle = 'rgba(255,214,120,0.9)';                                                                          // 鬍鬚
    for (const k of [0, 1]) { c.beginPath(); c.moveTo(hx - hr * 2.3, hy - hr * 0.3 + k * hr * 0.6); c.bezierCurveTo(hx - hr * 1.5, hy + hr * (1.2 + k), hx + hr * 0.5, hy - hr * (0.2 - k), hx + hr * 2.2, hy + hr * (1.4 + k * 0.4)); c.stroke(); }
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 80; i++) { c.fillStyle = `rgba(255,${150 + r() * 100 | 0},60,${0.4 + r() * 0.5})`; c.beginPath(); c.arc(r() * w * 0.7, my + (r() - 0.5) * h * 0.5, 0.8 + r() * 1.8, 0, TAU); c.fill(); }   // 火星
    c.globalCompositeOperation = 'source-over';
  } },

  // 星河：深藍底的星雲＋滿滿的星星
  galaxy: { w: 512, h: 512, rep: [2.2, 2.2], draw(c, w, h, r) {
    c.fillStyle = '#04050f'; c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'lighter';
    const cols = ['rgba(120,40,200,A)', 'rgba(40,90,210,A)', 'rgba(30,170,190,A)', 'rgba(200,40,150,A)'];
    for (let i = 0; i < 34; i++) blob(c, r() * w, r() * h, 40 + r() * 120, cols[i % 4], 0.16 + r() * 0.2);
    for (let i = 0; i < 520; i++) { const s = r() < 0.92 ? 0.5 + r() : 1.5 + r() * 1.4; c.fillStyle = `rgba(255,255,255,${0.35 + r() * 0.65})`; c.beginPath(); c.arc(r() * w, r() * h, s, 0, TAU); c.fill(); }
    for (let i = 0; i < 12; i++) {   // 亮星的十字光芒
      const x = r() * w, y = r() * h, l = 6 + r() * 10; blob(c, x, y, l, 'rgba(200,230,255,A)', 0.7);
      c.strokeStyle = 'rgba(230,245,255,0.8)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x - l, y); c.lineTo(x + l, y); c.moveTo(x, y - l); c.lineTo(x, y + l); c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
  } },

  // 煉獄：下面燒得最亮，往上變暗紅
  inferno: { w: 512, h: 256, rep: [2.2, 4], off: [0, 0.5], draw(c, w, h, r) {
    const g = c.createLinearGradient(0, h, 0, 0); g.addColorStop(0, '#ffcc3a'); g.addColorStop(0.3, '#ff6a00'); g.addColorStop(0.65, '#8a1000'); g.addColorStop(1, '#1a0300');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 70; i++) {   // 一條一條往上竄的火舌
      const x = r() * w, ht = h * (0.35 + r() * 0.6), wd = 10 + r() * 26, lean = (r() - 0.5) * 40;
      const fg = c.createLinearGradient(0, h, 0, h - ht); fg.addColorStop(0, 'rgba(255,220,90,0.55)'); fg.addColorStop(0.5, 'rgba(255,110,20,0.35)'); fg.addColorStop(1, 'rgba(255,40,0,0)');
      c.fillStyle = fg; c.beginPath(); c.moveTo(x - wd, h);
      c.bezierCurveTo(x - wd, h - ht * 0.5, x + lean - wd * 0.3, h - ht * 0.7, x + lean, h - ht);
      c.bezierCurveTo(x + lean + wd * 0.3, h - ht * 0.7, x + wd, h - ht * 0.5, x + wd, h); c.fill();
    }
    for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(255,${180 + r() * 70 | 0},80,${0.3 + r() * 0.6})`; c.beginPath(); c.arc(r() * w, r() * h * 0.8, 0.7 + r() * 1.6, 0, TAU); c.fill(); }
    c.globalCompositeOperation = 'source-over';
  } },

  // 雷霆：暗紫色雲層裡劈下好幾道分岔的閃電
  storm: { w: 512, h: 256, rep: [1.8, 4], off: [0, 0.5], draw(c, w, h, r) {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2a1450'); g.addColorStop(1, '#0c0820');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) blob(c, r() * w, r() * h * 0.7, 30 + r() * 60, 'rgba(10,6,24,A)', 0.5);
    const bolt = (x, y, len, wd, depth) => {
      c.lineWidth = wd; c.beginPath(); c.moveTo(x, y);
      for (let k = 0; k < len; k++) {
        x += (r() - 0.5) * 26; y += 8 + r() * 10; c.lineTo(x, y);
        if (depth < 2 && r() < 0.18) { c.stroke(); bolt(x, y, (len - k) * 0.5 | 0, wd * 0.55, depth + 1); c.lineWidth = wd; c.beginPath(); c.moveTo(x, y); }
        if (y > h) break;
      }
      c.stroke();
    };
    c.lineJoin = 'round'; c.shadowColor = '#b08cff'; c.shadowBlur = 14; c.strokeStyle = '#efe6ff';
    for (let i = 0; i < 5; i++) bolt(w * (0.08 + i * 0.2 + r() * 0.08), -4, 24, 3.2, 0);
    c.shadowBlur = 0;
  } },

  // 霓彩漸層：金 → 桃紅 → 紫 → 藍，沿著槍身方向
  fade: { w: 256, h: 32, rep: [2.2, 1], draw(c, w, h) {
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#ffe14b'); g.addColorStop(0.35, '#ff5fa8'); g.addColorStop(0.7, '#9b4bff'); g.addColorStop(1, '#3b6bff');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  } },

  // 冰晶：淡藍底、一塊一塊的晶面、白色裂紋
  ice: { w: 256, h: 256, rep: [3, 3], draw(c, w, h, r) {
    const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#d8f4ff'); g.addColorStop(1, '#4fa6e0');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      const x = r() * w, y = r() * h, s = 12 + r() * 34, n = 3 + (r() * 3 | 0);
      c.fillStyle = r() < 0.5 ? `rgba(255,255,255,${0.1 + r() * 0.25})` : `rgba(20,70,130,${0.08 + r() * 0.18})`;
      c.beginPath(); for (let k = 0; k < n; k++) { const a = (k / n) * TAU + r(); c.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s); } c.fill();
    }
    c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 1;
    for (let i = 0; i < 26; i++) { let x = r() * w, y = r() * h; c.beginPath(); c.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; c.lineTo(x, y); } c.stroke(); }
  } },

  // 電路板：深綠底、直角走線、焊點、晶片
  circuit: { w: 256, h: 256, rep: [4, 4], draw(c, w, h, r) {
    c.fillStyle = '#0b2e1c'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#2fdc78'; c.lineWidth = 1.6; c.lineCap = 'square';
    for (let i = 0; i < 46; i++) {
      let x = (r() * 32 | 0) * 8, y = (r() * 32 | 0) * 8; c.beginPath(); c.moveTo(x, y);
      for (let k = 0; k < 4; k++) { if (r() < 0.5) x += ((r() * 9 | 0) - 4) * 8; else y += ((r() * 9 | 0) - 4) * 8; c.lineTo(x, y); }
      c.stroke(); c.fillStyle = '#7dffb4'; c.beginPath(); c.arc(x, y, 2.6, 0, TAU); c.fill();
    }
    for (let i = 0; i < 7; i++) {
      const x = r() * w, y = r() * h, cw = 18 + r() * 24, ch = 12 + r() * 16;
      c.fillStyle = '#9fb0a6'; for (let k = 3; k < cw - 2; k += 4) { c.fillRect(x + k, y - 3, 1.6, ch + 6); }
      c.fillStyle = '#111814'; c.fillRect(x, y, cw, ch);
    }
  } },

  // 大理石：白底、灰藍色的紋路，偶爾一條金線
  marble: { w: 256, h: 256, rep: [3, 3], draw(c, w, h, r) {
    c.fillStyle = '#eef1f6'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const gold = r() < 0.12; c.strokeStyle = gold ? `rgba(200,160,70,${0.5 + r() * 0.4})` : `rgba(90,105,140,${0.12 + r() * 0.35})`;
      c.lineWidth = gold ? 1.2 : 0.6 + r() * 2.4;
      const x = r() * w, y = r() * h; c.beginPath(); c.moveTo(x, y);
      c.bezierCurveTo(x + (r() - 0.5) * 200, y + (r() - 0.5) * 200, x + (r() - 0.5) * 200, y + (r() - 0.5) * 200, x + (r() - 0.5) * 260, y + (r() - 0.5) * 260); c.stroke();
    }
  } },

  // 蜂巢：金色六角格、黑邊，有幾格比較暗
  hex: { w: 240, h: 208, rep: [5, 5], draw(c, w, h, r) {
    c.fillStyle = '#16110a'; c.fillRect(0, 0, w, h);
    const s = 20, dx = s * 1.5, dy = s * Math.sqrt(3);
    for (let i = -1; i < w / dx + 1; i++) for (let j = -1; j < h / dy + 1; j++) {
      const x = i * dx, y = j * dy + (i & 1 ? dy / 2 : 0), v = r();
      c.fillStyle = v < 0.15 ? '#5a4310' : v < 0.85 ? '#d4a017' : '#ffd760';
      c.beginPath(); for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; c.lineTo(x + Math.cos(a) * (s - 2.2), y + Math.sin(a) * (s - 2.2)); } c.fill();
    }
  } },

  // 櫻吹雪：淡粉底、五瓣的櫻花和飄落的花瓣、幾枝深色樹枝
  sakura: { w: 256, h: 256, rep: [3, 3], draw(c, w, h, r) {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#fff3f6'); g.addColorStop(1, '#ffd0de');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#3a2228'; c.lineCap = 'round';
    for (let i = 0; i < 4; i++) { let x = r() * w, y = r() * h; c.lineWidth = 4; c.beginPath(); c.moveTo(x, y); for (let k = 0; k < 5; k++) { x += 10 + r() * 30; y += (r() - 0.5) * 30; c.lineTo(x, y); c.lineWidth *= 0.8; } c.stroke(); }
    const petal = (x, y, s, a, col) => { c.fillStyle = col; c.save(); c.translate(x, y); c.rotate(a); c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(s * 0.6, -s * 0.5, s, -s * 0.1); c.lineTo(s * 0.85, 0); c.lineTo(s, s * 0.1); c.quadraticCurveTo(s * 0.6, s * 0.5, 0, 0); c.fill(); c.restore(); };
    for (let i = 0; i < 26; i++) {
      const x = r() * w, y = r() * h, s = 8 + r() * 8, a0 = r() * TAU, col = r() < 0.7 ? '#ff8fb4' : '#ffffff';
      for (let k = 0; k < 5; k++) petal(x, y, s, a0 + (k / 5) * TAU, col);
      c.fillStyle = '#c2185b'; c.beginPath(); c.arc(x, y, s * 0.2, 0, TAU); c.fill();
    }
    for (let i = 0; i < 30; i++) petal(r() * w, r() * h, 4 + r() * 5, r() * TAU, 'rgba(255,140,180,0.85)');
  } },

  // 虎紋：橘色底、一條條粗細不一的黑色斑紋
  tiger: { w: 512, h: 256, rep: [2.6, 4], draw(c, w, h, r) {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#f2a43a'); g.addColorStop(0.5, '#e07a12'); g.addColorStop(1, '#f2a43a');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = '#140c06';
    for (let i = 0; i < 46; i++) {
      const x = r() * w, wd = 9 + r() * 16, lean = (r() - 0.5) * 70, y0 = r() * h * 0.25, y1 = h - r() * h * 0.25;
      c.beginPath(); c.moveTo(x, y0);
      c.bezierCurveTo(x + wd + lean * 0.3, lerp(y0, y1, 0.33), x - wd + lean * 0.6, lerp(y0, y1, 0.66), x + lean, y1);
      c.bezierCurveTo(x - wd * 1.5 + lean * 0.6, lerp(y0, y1, 0.66), x - wd * 0.5 + lean * 0.3, lerp(y0, y1, 0.33), x, y0); c.fill();
    }
  } },

  // 數位迷彩：方格像素，四種灰藍綠
  digital: { w: 128, h: 128, rep: [5, 5], pixel: true, draw(c, w, h, r) {
    const pal = ['#5f7f86', '#3f5a60', '#9fb6b8', '#24343a'], s = 4;
    c.fillStyle = pal[0]; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      c.fillStyle = pal[1 + (r() * 3 | 0)];
      const x = (r() * w / s | 0) * s, y = (r() * h / s | 0) * s, bw = (1 + (r() * 5 | 0)) * s, bh = (1 + (r() * 3 | 0)) * s;
      c.fillRect(x, y, bw, bh);
    }
  } },
};

const cache = {};
// 某一種花紋的貼圖（沒有畫布的環境回傳 null）
export function finishTex(id) {
  if (id in cache) return cache[id];
  const d = DRAW[id];
  if (!d || typeof document === 'undefined') return (cache[id] = null);
  const cv = document.createElement('canvas'); cv.width = d.w; cv.height = d.h;
  d.draw(cv.getContext('2d'), d.w, d.h, rng(id.length * 977 + d.w));
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.repeat.set(d.rep[0], d.rep[1]);
  if (d.off) t.offset.set(d.off[0], d.off[1]);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (d.pixel) t.magFilter = THREE.NearestFilter;
  return (cache[id] = t);
}

// 介面上用的小色票：花紋畫布本身（第一次用到才畫）
export function finishCanvas(id) { const t = finishTex(id); return t ? t.image : null; }
