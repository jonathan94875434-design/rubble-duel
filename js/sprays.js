import * as THREE from 'three';

// 噴漆圖案：全部用畫布現畫（粗黑邊 + 色塊，像噴漆模板），不需要圖檔。
const S = 256;
const out = (g, w = 14) => { g.lineWidth = w; g.strokeStyle = '#111'; g.lineJoin = g.lineCap = 'round'; g.stroke(); };
const drips = (g, col, xs) => { g.fillStyle = col; for (const [x, y, h] of xs) { g.fillRect(x - 4, y, 8, h); g.beginPath(); g.arc(x, y + h, 5.5, 0, 6.283); g.fill(); } };
const text = (g, t, col, size, y = 150) => {
  g.font = `900 ${size}px "Arial Black", Impact, system-ui, sans-serif`; g.textAlign = 'center'; g.lineJoin = 'round';
  g.lineWidth = 18; g.strokeStyle = '#111'; g.strokeText(t, S / 2, y); g.fillStyle = col; g.fillText(t, S / 2, y);
};

export const SPRAYS = {
  skull: { name: '骷髏', draw(g) {
    g.fillStyle = '#f2f2ea'; g.beginPath(); g.arc(128, 108, 72, Math.PI, 0); g.lineTo(200, 150); g.quadraticCurveTo(190, 176, 168, 178); g.lineTo(168, 208); g.lineTo(88, 208); g.lineTo(88, 178); g.quadraticCurveTo(66, 176, 56, 150); g.closePath(); g.fill(); out(g);
    g.fillStyle = '#111'; g.beginPath(); g.ellipse(100, 118, 20, 24, 0, 0, 6.283); g.fill(); g.beginPath(); g.ellipse(156, 118, 20, 24, 0, 0, 6.283); g.fill();
    g.beginPath(); g.moveTo(128, 140); g.lineTo(140, 164); g.lineTo(116, 164); g.closePath(); g.fill();
    g.fillRect(106, 180, 6, 28); g.fillRect(125, 180, 6, 28); g.fillRect(144, 180, 6, 28);
    drips(g, '#f2f2ea', [[96, 206, 22], [160, 206, 34]]);
  } },
  gg: { name: 'GG', draw(g) { text(g, 'GG', '#ffb238', 150, 178); drips(g, '#ffb238', [[76, 180, 30], [176, 180, 44]]); } },
  ez: { name: 'EZ', draw(g) { text(g, 'EZ', '#3cf0c0', 150, 178); drips(g, '#3cf0c0', [[92, 180, 38], [168, 180, 24]]); } },
  smile: { name: '笑臉', draw(g) {
    g.fillStyle = '#ffd83a'; g.beginPath(); g.arc(128, 128, 88, 0, 6.283); g.fill(); out(g);
    g.fillStyle = '#111'; g.beginPath(); g.ellipse(98, 104, 11, 17, 0, 0, 6.283); g.fill(); g.beginPath(); g.ellipse(158, 104, 11, 17, 0, 0, 6.283); g.fill();
    g.beginPath(); g.arc(128, 132, 50, 0.15 * Math.PI, 0.85 * Math.PI); out(g, 11);
    drips(g, '#ffd83a', [[86, 204, 26]]);
  } },
  crown: { name: '皇冠', draw(g) {
    g.fillStyle = '#ffc61a'; g.beginPath(); g.moveTo(44, 190); g.lineTo(36, 82); g.lineTo(86, 132); g.lineTo(128, 60); g.lineTo(170, 132); g.lineTo(220, 82); g.lineTo(212, 190); g.closePath(); g.fill(); out(g);
    g.fillStyle = '#e5352b'; for (const [x, y] of [[36, 80], [128, 58], [220, 80]]) { g.beginPath(); g.arc(x, y, 13, 0, 6.283); g.fill(); out(g, 8); }
    g.fillStyle = '#111'; g.fillRect(44, 196, 168, 12);
  } },
  target: { name: '靶心', draw(g) {
    for (const [r, c] of [[92, '#f2f2ea'], [66, '#e5352b'], [40, '#f2f2ea'], [16, '#e5352b']]) { g.fillStyle = c; g.beginPath(); g.arc(128, 128, r, 0, 6.283); g.fill(); out(g, 8); }
    g.fillStyle = '#111'; g.fillRect(124, 20, 8, 48); g.fillRect(124, 188, 8, 48); g.fillRect(20, 124, 48, 8); g.fillRect(188, 124, 48, 8);
  } },
  boom: { name: '爆炸', draw(g) {
    g.fillStyle = '#ff5a1f'; g.beginPath();
    for (let i = 0; i < 24; i++) { const a = (i / 24) * 6.283, r = i % 2 ? 62 : 108 - (i % 4) * 6; g.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r); }
    g.closePath(); g.fill(); out(g);
    g.fillStyle = '#ffd83a'; g.beginPath();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * 6.283 + 0.2, r = i % 2 ? 30 : 58; g.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r); }
    g.closePath(); g.fill(); out(g, 8);
  } },
  heart: { name: '心碎', draw(g) {
    g.fillStyle = '#ff3d6e'; g.beginPath(); g.moveTo(128, 214); g.bezierCurveTo(20, 140, 40, 40, 128, 92); g.bezierCurveTo(216, 40, 236, 140, 128, 214); g.closePath(); g.fill(); out(g);
    g.beginPath(); g.moveTo(128, 92); g.lineTo(108, 124); g.lineTo(140, 146); g.lineTo(116, 176); g.lineTo(128, 214); out(g, 9);
    drips(g, '#ff3d6e', [[104, 196, 30]]);
  } },
};
export const SPRAY_IDS = Object.keys(SPRAYS);

const canvases = {}, texes = {};
export function sprayCanvas(id) {
  if (!SPRAYS[id]) id = SPRAY_IDS[0];
  if (!canvases[id]) {
    const c = canvases[id] = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    SPRAYS[id].draw(g);
    // 噴漆的顆粒感：邊緣隨機擦掉一些小點
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${0.25 + Math.random() * 0.5})`; g.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5); }
    g.globalCompositeOperation = 'source-over';
  }
  return canvases[id];
}
export function sprayTex(id) {
  if (!SPRAYS[id]) id = SPRAY_IDS[0];
  if (!texes[id]) { const t = texes[id] = new THREE.CanvasTexture(sprayCanvas(id)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; }
  return texes[id];
}
