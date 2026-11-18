import * as THREE from 'three';
import { WSKINS } from './skins.js';

// 槍枝與投擲物的模型：全部用程式拼（側面輪廓擠出＋車削＋方塊），真實比例、單位公尺。
// 座標：原點 = 右手虎口（握把後上緣），槍口朝 -Z，+Y 向上，+X 是射手的右邊。
// buildGun(id, wskin) 回傳的 group.userData：
//   muzzle 槍口、sightY 瞄準線高度、eject 拋殼口（沒有 = null）、gripL 左手扶的位置（刀 = null）、
//   kind 'rifle'|'pistol'|'launcher'|'knife'、len 全長、
//   parts 會動的零件（mag / bolt / pump / cyl / drum / rocket / hammer / lens / aim）、rest 這些零件的原位、
//   gripAng 握把後傾角、eyeZ 瞄準時眼睛在槍的哪個 z、hold 左手握法、anim 動畫用的數值（給 viewmodel.js）
// 預覽與截圖：dev/guns.html、tests/shot-guns.mjs

const HP = Math.PI / 2, TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _m = new THREE.Matrix4(), _e = new THREE.Euler();

// ───────── 貼圖（小張 canvas，全部共用）─────────
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const texs = {};
function tex(key, w, h, rep, draw, srgb) {
  if (key in texs) return texs[key];
  if (typeof document === 'undefined') return (texs[key] = null);
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h, rng(w * 31 + h * 7 + key.length));
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return (texs[key] = t);
}
// 細雜訊＋幾道刮痕：乘在粗糙度上，金屬才不會像塑膠一樣平
const noiseTex = () => tex('noise', 128, 128, [13, 13], (c, w, h, r) => {
  const d = c.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = 196 + r() * 59; d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255; }
  c.putImageData(d, 0, 0);
  c.globalAlpha = 0.3; c.lineWidth = 0.7;
  for (let i = 0; i < 46; i++) { c.strokeStyle = r() < 0.5 ? '#fff' : '#888'; c.beginPath(); const x = r() * w, y = r() * h; c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 50, y + (r() - 0.5) * 10); c.stroke(); }
});
// 木紋（灰階，顏色由材質決定）：沿著槍身方向的細條紋
const woodTex = () => tex('wood', 256, 64, [3.1, 10], (c, w, h, r) => {
  c.fillStyle = '#e2e2e2'; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 110; i++) {
    const y = r() * h, v = (90 + r() * 130) | 0, a = (r() - 0.5) * 7;
    c.strokeStyle = `rgba(${v},${v},${v},${0.2 + r() * 0.45})`; c.lineWidth = 0.4 + r() * 1.7;
    c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(w * 0.3, y + a, w * 0.7, y - a, w, y); c.stroke();
  }
}, true);
// 碳纖維斜紋
const weaveTex = () => tex('weave', 32, 32, [80, 80], (c) => {
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { c.fillStyle = ((x + y) & 3) < 2 ? '#ffffff' : '#6c6c6c'; c.fillRect(x * 8, y * 8, 8, 8); }
}, true);
// 瞄準鏡的分劃：中間透明，外圈一道黑邊
const reticleTex = () => tex('reticle', 256, 256, [1, 1], (c, w) => {
  const g = c.createRadialGradient(w / 2, w / 2, w * 0.36, w / 2, w / 2, w * 0.5);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.75, 'rgba(0,0,0,0.85)'); g.addColorStop(1, 'rgba(0,0,0,1)');
  c.fillStyle = g; c.fillRect(0, 0, w, w);
  c.fillStyle = 'rgba(8,8,8,0.95)';
  c.fillRect(0, w / 2 - 0.75, w * 0.44, 1.5); c.fillRect(w * 0.56, w / 2 - 0.75, w * 0.44, 1.5); c.fillRect(w / 2 - 0.75, w * 0.56, 1.5, w * 0.44); c.fillRect(w / 2 - 0.75, 0, 1.5, w * 0.36);
  c.fillRect(0, w / 2 - 2.5, w * 0.3, 5); c.fillRect(w * 0.7, w / 2 - 2.5, w * 0.3, 5); c.fillRect(w / 2 - 2.5, w * 0.7, 5, w * 0.3);
  c.fillStyle = 'rgba(255,40,30,0.95)'; c.beginPath(); c.arc(w / 2, w / 2, 2.2, 0, TAU); c.fill();
}, true);

// ───────── 材質（依名字快取，所有槍共用）─────────
const mats = new Map();
function M(key, o, Cls = THREE.MeshStandardMaterial) { let m = mats.get(key); if (!m) { m = new Cls(o); m.name = key; mats.set(key, m); } return m; }
const pbr = (key, color, metalness, roughness, x) => M(key, { color, metalness, roughness, roughnessMap: noiseTex(), ...x });
const S = {
  get steel() { return pbr('steel', 0x50545b, 0.9, 0.5); },            // 一般鋼件
  get dark() { return pbr('dark', 0x202226, 0.85, 0.56); },            // 發黑處理的槍管、機件
  get chrome() { return pbr('chrome', 0xbfc3c9, 1, 0.24); },           // 拋光槍機
  get poly() { return pbr('poly', 0x212327, 0, 0.78); },               // 聚合物
  get rubber() { return pbr('rubber', 0x131315, 0, 1); },
  get brass() { return pbr('brass', 0xc9a04a, 1, 0.32); },
  get olive() { return pbr('olive', 0x4c5a34, 0.25, 0.66); },          // 彈藥漆
  get red() { return pbr('red', 0xb3261e, 0, 0.55); },
  get mark() { return pbr('mark', 0xd9b62e, 0, 0.6); },
  get white() { return pbr('white', 0xe6e6de, 0, 0.6); },
  get tan() { return pbr('tan', 0x8d7f63, 0.1, 0.7); },
  get glass() { return M('glass', { color: 0x0a1626, metalness: 1, roughness: 0.05 }); },   // 鍍膜鏡片：幾乎只反射環境
  get amber() { return M('amber', { color: 0x5a2f0c, metalness: 0, roughness: 0.1 }); },    // 玻璃瓶
  get rag() { return M('rag', { color: 0xcfc6b0, metalness: 0, roughness: 1 }); },
  get flame() { return M('flame', { color: 0x000000, emissive: 0xff7a1a, emissiveIntensity: 5, roughness: 1 }); },
  get hole() { return M('hole', { color: 0x040404 }, THREE.MeshBasicMaterial); },           // 槍口、開孔
  get mask() { const m = M('mask', { colorWrite: false }, THREE.MeshBasicMaterial); m.userData.order = -10; return m; },   // 只寫深度：瞄準時鏡筒裡看得到後面的世界
  get reticle() { const m = M('reticle', { map: reticleTex(), transparent: true, depthWrite: false, toneMapped: false }, THREE.MeshBasicMaterial); m.userData.keepUV = true; m.userData.order = 10; return m; },
};
const wood = (c) => M('wood:' + c, { color: c, metalness: 0, roughness: 0.66, roughnessMap: noiseTex(), map: woodTex() });
const glowM = (c) => M('glow:' + c, { color: 0x000000, emissive: c, emissiveIntensity: 2.6, roughness: 0.5, metalness: 0 });
// 塗裝的質感：[金屬度, 粗糙度, 護木／托的明暗倍率, 貼圖]
const FIN = {
  sand: [0.1, 0.74, 0.7], snow: [0.05, 0.62, 0.8], carbon: [0.55, 0.34, 1.7, 'weave'], crimson: [0.75, 0.36, 0.26],
  gold: [1, 0.24, 0.72], neon: [0.6, 0.4, 0.62], toxic: [0.3, 0.56, 0.62],
};
// 這把槍這個塗裝要用的材質：body 機匣、furn 護木／托／握把、glow 發光條（沒有 = null）
function look(def, wskin) {
  const sk = WSKINS[wskin] || {}, c = sk.color, glow = sk.glow ? glowM(sk.glow) : null;
  if (c === null || c === undefined) {
    const b = def.body, f = def.furn;
    return { body: pbr(`p:${b}`, b[0], b[1], b[2]), furn: f[1] === 'wood' ? wood(f[0]) : pbr(`p:${f}`, f[0], f[1], f[2]), glow };
  }
  const f = FIN[wskin] || [0.3, 0.55, 0.7], map = f[3] ? weaveTex() : null;
  return {
    body: pbr(`sk:${wskin}:b`, c, f[0], f[1], { map }),
    furn: pbr(`sk:${wskin}:f`, new THREE.Color(c).multiplyScalar(f[2]), f[0] * 0.7, Math.min(1, f[1] + 0.14), { map }),
    glow,
  };
}

// ───────── 幾何小工具 ─────────
function G(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { if (rx || ry || rz) g.applyMatrix4(_m.makeRotationFromEuler(_e.set(rx, ry, rz))); return g.translate(x, y, z); }
// 沿 Z 軸車削：pts = [[z, 半徑], …]，外表面由後往前寫（z 遞減），往回寫就是內壁。每一段各自平滑，段與段之間是硬邊
function latheZ(pts, seg = 12, smooth = false) {
  const pos = [], nor = [], bn = [];
  for (let i = 0; i < pts.length - 1; i++) { const nz = pts[i + 1][1] - pts[i][1], nr = pts[i][0] - pts[i + 1][0], l = Math.hypot(nz, nr) || 1; bn.push([nz / l, nr / l]); }
  const vn = (i, e) => {   // 第 i 段在端點 e(0/1) 的法線
    if (!smooth) return bn[i];
    const j = e ? i + 1 : i - 1; if (j < 0 || j >= bn.length || pts[i + e][1] === 0) return bn[i];
    const z = bn[i][0] + bn[j][0], r = bn[i][1] + bn[j][1], l = Math.hypot(z, r) || 1; return [z / l, r / l];
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const [z0, r0] = pts[i], [z1, r1] = pts[i + 1]; if (r0 === 0 && r1 === 0) continue;
    const n0 = vn(i, 0), n1 = vn(i, 1);
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * TAU, b = ((j + 1) / seg) * TAU, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
      const A = [r0 * ca, r0 * sa, z0, n0[1] * ca, n0[1] * sa, n0[0]], B = [r0 * cb, r0 * sb, z0, n0[1] * cb, n0[1] * sb, n0[0]];
      const C = [r1 * cb, r1 * sb, z1, n1[1] * cb, n1[1] * sb, n1[0]], D = [r1 * ca, r1 * sa, z1, n1[1] * ca, n1[1] * sa, n1[0]];
      const tri = (p, q, r) => {
        const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        const mn = bn[i], mid = (a + b) / 2, d = cx * mn[1] * Math.cos(mid) + cy * mn[1] * Math.sin(mid) + cz * mn[0];
        for (const t of d >= 0 ? [p, q, r] : [p, r, q]) { pos.push(t[0], t[1], t[2]); nor.push(t[3], t[4], t[5]); }
      };
      if (r0 > 0) tri(A, C, B);
      if (r1 > 0) tri(A, D, C);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
function shape(pts, holes) {
  const v = pts.map((p) => new THREE.Vector2(p[0], p[1])); if (THREE.ShapeUtils.isClockWise(v)) v.reverse();
  const s = new THREE.Shape(v);
  for (const h of holes || []) s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1]))));
  return s;
}
function extrude(pts, w, b, holes) {
  b = Math.max(0, Math.min(b, w / 2 - 0.0002));
  const g = new THREE.ExtrudeGeometry(shape(pts, holes), { depth: w - 2 * b, steps: 1, curveSegments: 1, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1 });
  return g.translate(0, 0, -(w - 2 * b) / 2);
}
// 同材質的幾何合併成一個（都轉成不共用頂點），貼圖座標改用位置投影（單位公尺，貼圖自己的 repeat 決定密度）
function merge(list, keepUV) {
  const gs = list.map((g) => (g.index ? g.toNonIndexed() : g)); let n = 0;
  for (const g of gs) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2); let o = 0;
  for (const g of gs) {
    P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3);
    if (keepUV && g.attributes.uv) U.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  if (!keepUV) for (let i = 0; i < n; i += 3) {   // 每個三角形看它朝哪個軸，就從那個軸投影
    const a = i * 3, ux = P[a + 3] - P[a], uy = P[a + 4] - P[a + 1], uz = P[a + 5] - P[a + 2], vx = P[a + 6] - P[a], vy = P[a + 7] - P[a + 1], vz = P[a + 8] - P[a + 2];
    const cx = Math.abs(uy * vz - uz * vy), cy = Math.abs(uz * vx - ux * vz), cz = Math.abs(ux * vy - uy * vx);
    for (let k = 0; k < 3; k++) {
      const p = (i + k) * 3, u = (i + k) * 2;
      if (cx >= cy && cx >= cz) { U[u] = P[p + 2]; U[u + 1] = P[p + 1]; } else if (cy >= cz) { U[u] = P[p + 2]; U[u + 1] = P[p]; } else { U[u] = P[p]; U[u + 1] = P[p + 1]; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  for (const q of list) q.dispose();
  return g;
}

// 零件收集器：一直往「零件｜材質」的桶子裡丟幾何，最後 bake() 每桶合併成一個 Mesh。座標一律寫槍的座標
class Kit {
  constructor() { this.bins = new Map(); this.cur = ''; this.piv = { '': [0, 0, 0] }; this.par = {}; }
  put(m, g) { let b = this.bins.get(this.cur); if (!b) this.bins.set(this.cur, (b = new Map())); let a = b.get(m); if (!a) b.set(m, (a = [])); a.push(g); return this; }
  // 之後加的東西都算在這個會動的零件上；(x,y,z) 是它的轉軸／基準點。part() 不帶參數 = 回到槍身
  part(name = '', x = 0, y = 0, z = 0, parent = '') { this.cur = name; if (name && !this.piv[name]) { this.piv[name] = [x, y, z]; this.par[name] = parent; } return this; }
  box(m, w, h, d, x, y, z, rx, ry, rz) { return this.put(m, G(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz)); }
  // 圓柱：預設沿 Z（r 是後端半徑、o.r2 前端），o.ax = 'x' | 'y' 換軸
  cyl(m, r, len, x, y, z, o = {}) {
    const g = new THREE.CylinderGeometry(r, o.r2 ?? r, len, o.seg || 12, 1, !!o.open);
    if (o.ax === 'x') g.rotateZ(HP); else if (o.ax !== 'y') g.rotateX(HP);
    return this.put(m, G(g, x, y, z, o.rx, o.ry, o.rz));
  }
  // 車削（軸線在 x,y、沿 Z）：pts = [[z, r], …]；o.sx / o.sy 把截面壓成橢圓
  lathe(m, pts, x = 0, y = 0, o = {}) {
    const g = latheZ(pts, o.seg || 12, o.smooth);
    if (o.sx || o.sy) g.scale(o.sx || 1, o.sy || 1, 1);
    return this.put(m, g.translate(x, y, 0));
  }
  // 側面輪廓 [[z, y], …] 往左右擠出 w 寬（中心在 x），o.b 倒角、o.holes 開孔
  prof(m, pts, w, x = 0, o = {}) { return this.put(m, extrude(pts, w, o.b ?? 0.002, o.holes).rotateY(-HP).translate(x, 0, 0)); }
  // 截面 [[x, y], …] 沿 Z 從 z0 擠到 z1
  sect(m, pts, z0, z1, o = {}) { const lo = Math.min(z0, z1), hi = Math.max(z0, z1); return this.put(m, extrude(pts, hi - lo, o.b ?? 0.002, o.holes).translate(0, 0, (lo + hi) / 2)); }
  ring(m, R, r, x, y, z, o = {}) { const g = new THREE.TorusGeometry(R, r, o.rs || 5, o.ts || 12); if (o.ax === 'y') g.rotateX(HP); else if (o.ax === 'x') g.rotateY(HP); return this.put(m, G(g, x, y, z, o.rx, o.ry, o.rz)); }
  ball(m, r, x, y, z, ws = 8, hs = 6) { return this.put(m, new THREE.SphereGeometry(r, ws, hs).translate(x, y, z)); }
  disc(m, r, x, y, z, dir = -1, seg = 10) { const g = new THREE.CircleGeometry(r, seg); if (dir < 0) g.rotateY(Math.PI); return this.put(m, g.translate(x, y, z)); }
  bake() {
    const gr = { '': new THREE.Group() }; let tris = 0;
    for (const n in this.piv) if (n) { gr[n] = new THREE.Group(); gr[n].name = n; }
    for (const n in this.piv) if (n) { const p = this.piv[n], q = this.piv[this.par[n]] || [0, 0, 0]; gr[n].position.set(p[0] - q[0], p[1] - q[1], p[2] - q[2]); gr[this.par[n] || ''].add(gr[n]); }
    for (const [n, bin] of this.bins) for (const [mat, list] of bin) {
      const g = merge(list, mat.userData.keepUV), p = this.piv[n]; g.translate(-p[0], -p[1], -p[2]);
      const me = new THREE.Mesh(g, mat); if (mat.userData.order !== undefined) me.renderOrder = mat.userData.order;
      gr[n].add(me); tris += g.attributes.position.count / 3;
    }
    const root = gr['']; delete gr['']; root.userData.parts = gr; root.userData.tris = tris;
    return root;
  }
}

// ───────── 各種槍共用的零件 ─────────
const oct = (hw, y0, y1, c) => [[-hw, y0 + c], [-hw + c, y0], [hw - c, y0], [hw, y0 + c], [hw, y1 - c], [hw - c, y1], [-hw + c, y1], [-hw, y1 - c]];
// 皮卡汀尼導軌：底座＋一排齒
function rail(k, m, y, z0, z1, w = 0.021) {
  k.box(m, w * 0.7, 0.0045, z0 - z1, 0, y + 0.002, (z0 + z1) / 2);
  for (let z = z0 - 0.004; z > z1 + 0.003; z -= 0.0125) k.box(m, w, 0.0034, 0.0066, 0, y + 0.0058, z);
}
// 手槍式握把：原點就是握把後上緣，整支往後斜 a（弧度）
function grip(k, m, a = 0.31, len = 0.106, w = 0.03) {
  const c = Math.cos(a), s = Math.sin(a), P = (f, d) => [d * s - f * c, -d * c - f * s];
  k.prof(m, [P(-0.006, -0.014), P(0, 0.002), P(0.001, 0.05), P(-0.004, len), P(0.046, len + 0.004), P(0.049, len * 0.5), P(0.045, 0.03), P(0.05, -0.02)], w, 0, { b: 0.0075 });
}
// 扳機護弓＋扳機
function guard(k, m, zr = -0.05, zf = -0.108, yb = -0.03, yt = 0.004, w = 0.012) {
  k.box(m, w, 0.0032, zr - zf + 0.004, 0, yb - 0.0016, (zr + zf) / 2);
  k.box(m, w, yt - yb + 0.003, 0.0032, 0, (yt + yb - 0.003) / 2, zf + 0.0016, 0.12);
  const z = (zr + zf) / 2 + 0.004;
  k.prof(S.steel, [[z, yt + 0.002], [z - 0.007, yt + 0.002], [z - 0.011, yt - 0.012], [z - 0.008, yt - 0.023], [z - 0.004, yt - 0.022], [z - 0.005, yt - 0.01]], 0.006, 0, { b: 0.0012 });
}
// 機械瞄具：後面是覘孔環、前面是準星柱＋護翼，頂端都在 sy
function irons(k, m, yb, sy, zr, zf) {
  k.box(m, 0.02, 0.007, 0.018, 0, yb + 0.0035, zr);
  for (const s of [-1, 1]) k.box(m, 0.0036, sy - yb - 0.004, 0.005, s * 0.0092, (yb + sy - 0.004) / 2 + 0.002, zr);
  k.ring(m, 0.0074, 0.0019, 0, sy, zr, { rs: 4, ts: 14 });
  k.box(m, 0.02, 0.007, 0.018, 0, yb + 0.0035, zf);
  k.box(m, 0.0022, sy - yb - 0.005, 0.0028, 0, (yb + 0.005 + sy) / 2, zf);
  for (const s of [-1, 1]) k.box(m, 0.0028, sy - yb + 0.003, 0.012, s * 0.0092, (yb + sy + 0.003) / 2 + 0.003, zf, 0, 0, -s * 0.1);
}
// 手槍的缺口照門＋片狀準星（帶白點）
function notch(k, m, sy, zr, zf, base) {
  for (const s of [-1, 1]) { k.box(m, 0.0052, sy - base, 0.007, s * 0.0058, (sy + base) / 2, zr); k.box(S.white, 0.002, 0.002, 0.0004, s * 0.0058, sy - 0.0022, zr + 0.0036); }
  k.box(m, 0.016, (sy - base) * 0.45, 0.007, 0, base + (sy - base) * 0.225, zr);
  k.box(m, 0.0036, sy - base, 0.008, 0, (sy + base) / 2, zf); k.box(S.white, 0.002, 0.002, 0.0004, 0, sy - 0.0022, zf + 0.0041);
}
// AR 式伸縮托：緩衝管＋托身＋托底板
function m4stock(k, L, y, z0) {
  k.cyl(S.dark, 0.0135, 0.2, 0, y, z0 + 0.1).cyl(S.steel, 0.0178, 0.008, 0, y, z0 + 0.006, { seg: 10 });
  const t = y + 0.019;
  k.prof(L.furn, [[z0 + 0.07, t], [z0 + 0.226, t], [z0 + 0.238, t - 0.012], [z0 + 0.238, y - 0.1], [z0 + 0.224, y - 0.108], [z0 + 0.18, y - 0.086], [z0 + 0.115, y - 0.028], [z0 + 0.07, y - 0.022]], 0.04, 0, { b: 0.006 });
  k.box(S.rubber, 0.034, 0.104, 0.008, 0, y - 0.047, z0 + 0.241);
  k.box(S.dark, 0.0405, 0.008, 0.03, 0, y - 0.03, z0 + 0.135, -0.72);   // 調整撥桿
}
// 瞄準鏡：鏡筒（車削，兩端內凹）＋調節鈕＋鏡環。接目鏡的鏡片另外做成 lens（平常）／aim（瞄準時看得穿）兩個零件
function scope(k, y, zr, len, rt, re, ro, mountY, seeThrough) {
  const zf = zr - len, oc = len * 0.22, bell = len * 0.27, zt = zr - len * 0.47;
  k.lathe(S.dark, [[zr - 0.012, re - 0.003], [zr, re - 0.003], [zr, re], [zr - 0.014, re + 0.0012], [zr - 0.02, re], [zr - oc * 0.62, re], [zr - oc, rt + 0.0015], [zr - oc - 0.004, rt],
    [zf + bell, rt], [zf + bell * 0.6, ro], [zf, ro], [zf, ro - 0.003], [zf + 0.014, ro - 0.003]], 0, y, { seg: 14 });
  k.disc(S.glass, ro - 0.003, 0, y, zf + 0.014, -1, 14);
  k.box(S.dark, rt * 2 + 0.006, rt * 2 + 0.006, 0.03, 0, y, zt);                                         // 調節鈕座
  k.cyl(S.dark, 0.011, 0.016, 0, y + rt + 0.01, zt, { ax: 'y', seg: 10 }).cyl(S.steel, 0.0118, 0.004, 0, y + rt + 0.004, zt, { ax: 'y', seg: 10 });
  k.cyl(S.dark, 0.011, 0.016, rt + 0.01, y, zt, { ax: 'x', seg: 10 }).cyl(S.dark, 0.009, 0.012, -rt - 0.008, y, zt, { ax: 'x', seg: 10 });
  for (const z of [zr - oc - 0.022, zf + bell + 0.02]) {
    k.cyl(S.steel, rt + 0.0045, 0.014, 0, y, z, { seg: 12 });
    k.box(S.steel, 0.014, y - rt - mountY + 0.004, 0.014, 0, (y - rt + mountY) / 2, z).box(S.steel, 0.024, 0.008, 0.018, 0, mountY + 0.004, z);
  }
  k.part('lens').disc(S.glass, re - 0.003, 0, y, zr - 0.012, 1, 14);
  if (seeThrough) k.part('aim').disc(S.mask, re - 0.003, 0, y, zr - 0.012, 1, 20).disc(S.reticle, re - 0.003, 0, y, zr - 0.0116, 1, 20);
  k.part();
}
// 槍管（實心）＋槍口的黑洞
function barrel(k, m, y, z0, z1, r, bore = r * 0.55) { k.cyl(m, r, z0 - z1, 0, y, (z0 + z1) / 2, { seg: 10 }); k.disc(S.hole, bore, 0, y, z1 - 0.0004); }

// ───────── 每一把槍 ─────────
const GUNS = {};

// VK-30 突擊步槍：AR 平台，30 發彎彈匣、伸縮托、八角護木、摺疊機械瞄具
GUNS.ar = { kind: 'rifle', body: [0x2f3237, 0.75, 0.56], furn: [0x4b5a48, 0.05, 0.78], build(k, L) {
  const B = 0.056;
  k.prof(L.body, [[0.04, 0.046], [0.04, 0.014], [0.006, 0.006], [-0.108, 0.004], [-0.112, -0.012], [-0.182, -0.006], [-0.19, 0.02], [-0.19, 0.046]], 0.03, 0, { b: 0.003 });   // 下機匣
  k.prof(L.body, [[0.04, 0.044], [0.04, 0.074], [0.032, 0.08], [-0.192, 0.08], [-0.192, 0.044]], 0.034, 0, { b: 0.005 });                                                   // 上機匣
  k.box(S.dark, 0.002, 0.013, 0.056, 0.0164, 0.06, -0.103).box(S.chrome, 0.0026, 0.007, 0.04, 0.0164, 0.06, -0.1);                                                          // 拋殼口
  k.box(L.body, 0.008, 0.014, 0.014, 0.018, 0.064, -0.06, 0, 0.5);                                                                                                           // 彈殼導片
  k.cyl(S.steel, 0.0036, 0.0312, 0, 0.03, -0.172, { ax: 'x', seg: 8 }).cyl(S.steel, 0.0036, 0.0312, 0, 0.03, 0.02, { ax: 'x', seg: 8 });
  k.cyl(S.steel, 0.0052, 0.0324, 0, 0.02, -0.024, { ax: 'x', seg: 8 }).box(S.steel, 0.002, 0.005, 0.02, -0.0162, 0.02, -0.036);                                              // 快慢機
  k.box(S.steel, 0.002, 0.016, 0.008, -0.016, 0.038, -0.112).box(S.steel, 0.0025, 0.009, 0.009, 0.016, 0.03, -0.092);
  rail(k, S.dark, 0.08, 0.034, -0.498);
  k.sect(L.furn, oct(0.022, 0.03, 0.08, 0.009), -0.192, -0.5, { b: 0.0025 });                                                                                                // 護木
  for (let i = 0; i < 6; i++) k.box(S.hole, 0.0446, 0.007, 0.03, 0, 0.055, -0.226 - i * 0.048);
  k.cyl(S.steel, 0.0245, 0.012, 0, 0.055, -0.196, { seg: 8 });
  barrel(k, S.dark, B, -0.19, -0.612, 0.0085, 0);
  k.lathe(S.dark, [[-0.606, 0.0085], [-0.612, 0.0112], [-0.654, 0.0112], [-0.66, 0.0098], [-0.66, 0.006], [-0.636, 0.006]], 0, B, { seg: 10 }).disc(S.hole, 0.006, 0, B, -0.636);   // 防火帽
  k.box(S.hole, 0.0228, 0.003, 0.024, 0, B, -0.634).box(S.hole, 0.003, 0.0228, 0.024, 0, B, -0.634);
  k.box(S.dark, 0.022, 0.012, 0.008, 0, 0.068, 0.043).box(S.hole, 0.001, 0.006, 0.09, -0.0172, 0.064, -0.125);                                                               // 後蓋、拉柄滑槽
  k.part('bolt', -0.018, 0.064, -0.165).cyl(S.steel, 0.0048, 0.018, -0.026, 0.064, -0.165, { ax: 'x', seg: 8 }).part();                                                      // 左側拉柄
  m4stock(k, L, B, 0.04);
  grip(k, L.furn, 0.31);
  guard(k, S.dark);
  k.part('mag', -0.147, 0, 0);
  k.prof(S.poly, [[-0.118, 0.02], [-0.118, -0.06], [-0.126, -0.13], [-0.142, -0.186], [-0.202, -0.17], [-0.186, -0.115], [-0.178, -0.05], [-0.176, 0.02]], 0.024, 0, { b: 0.003 });
  k.prof(S.poly, [[-0.138, -0.181], [-0.141, -0.193], [-0.207, -0.176], [-0.204, -0.164]], 0.028, 0, { b: 0.003 });
  if (L.glow) k.box(L.glow, 0.0246, 0.004, 0.05, 0, -0.1, -0.156, 0.2);
  k.part();
  irons(k, S.dark, 0.086, 0.122, 0.018, -0.478);
  if (L.glow) k.box(L.glow, 0.0452, 0.003, 0.27, 0, 0.0715, -0.345).box(L.glow, 0.0408, 0.003, 0.09, 0, 0.066, 0.2);
  return { muzzle: V(0, B, -0.66), sightY: 0.122, eject: V(0.021, 0.06, -0.1), gripL: V(0, 0.03, -0.35), gripAng: 0.31, eyeZ: 0.2,
    anim: { reload: 'mag', cycle: 'auto', magDir: V(0, -0.97, -0.24), magGrab: V(-0.013, -0.11, -0.15), boltTravel: 0.07, boltGrab: V(-0.03, 0.064, -0.16), shell: [0.0029, 0.022] } };
} };

// 蜂鳥 衝鋒槍：方正的聚合物機匣、直彈匣插在扳機前面、短槍管、骨架摺疊托
GUNS.smg = { kind: 'rifle', body: [0x474c5c, 0.35, 0.6], furn: [0x24262b, 0, 0.8], build(k, L) {
  const B = 0.046;
  k.prof(L.body, [[0.055, 0.03], [0.055, 0.07], [0.045, 0.076], [-0.255, 0.076], [-0.262, 0.066], [-0.262, 0.03]], 0.036, 0, { b: 0.005 });
  k.prof(L.furn, [[0.05, 0.032], [0.046, 0.012], [0.006, 0.006], [-0.1, 0.004], [-0.1, -0.03], [-0.152, -0.034], [-0.154, 0.006], [-0.25, 0.008], [-0.254, -0.012], [-0.27, -0.012], [-0.27, 0.032]], 0.032, 0, { b: 0.004 });
  k.box(S.dark, 0.002, 0.014, 0.046, 0.0174, 0.058, -0.1).box(S.chrome, 0.0026, 0.008, 0.034, 0.0174, 0.058, -0.098);
  k.box(S.hole, 0.001, 0.007, 0.1, -0.0182, 0.062, -0.15);                                                 // 拉柄的滑槽
  k.cyl(S.steel, 0.005, 0.0332, 0, 0.02, -0.024, { ax: 'x', seg: 8 }).cyl(S.steel, 0.0034, 0.0366, 0, 0.04, 0.03, { ax: 'x', seg: 8 }).cyl(S.steel, 0.0034, 0.0366, 0, 0.04, -0.22, { ax: 'x', seg: 8 });
  rail(k, S.dark, 0.076, 0.043, -0.25);
  barrel(k, S.dark, B, -0.26, -0.3, 0.008, 0);
  k.lathe(S.dark, [[-0.296, 0.008], [-0.3, 0.0108], [-0.334, 0.0108], [-0.338, 0.0092], [-0.338, 0.0055], [-0.32, 0.0055]], 0, B, { seg: 10 }).disc(S.hole, 0.0055, 0, B, -0.32);
  for (let i = 0; i < 3; i++) k.box(S.hole, 0.0218, 0.0026, 0.005, 0, B, -0.308 - i * 0.009);
  k.part('bolt', -0.019, 0.062, -0.185).cyl(S.steel, 0.0048, 0.018, -0.027, 0.062, -0.185, { ax: 'x', seg: 8 }).part();
  // 骨架托（展開）＋鉸鏈
  k.prof(L.furn, [[0.055, 0.07], [0.25, 0.07], [0.262, 0.06], [0.262, -0.03], [0.248, -0.036], [0.236, -0.02], [0.13, 0.034], [0.055, 0.04]], 0.02, 0, { b: 0.004, holes: [[[0.085, 0.061], [0.238, 0.061], [0.238, -0.006], [0.135, 0.046], [0.085, 0.049]]] });
  k.box(S.rubber, 0.026, 0.094, 0.006, 0, 0.015, 0.265).box(S.steel, 0.03, 0.036, 0.012, 0, 0.055, 0.058);
  grip(k, L.furn, 0.3);
  guard(k, L.furn, -0.05, -0.1);
  k.part('mag', -0.126, 0, 0).box(S.dark, 0.022, 0.2, 0.036, 0, -0.085, -0.127, 0.07).box(S.poly, 0.026, 0.008, 0.042, 0, -0.187, -0.134, 0.07);
  if (L.glow) k.box(L.glow, 0.0226, 0.05, 0.004, 0, -0.12, -0.1105, 0.07);
  k.part();
  irons(k, S.dark, 0.082, 0.11, 0.03, -0.235);
  if (L.glow) k.box(L.glow, 0.0368, 0.003, 0.21, 0, 0.049, -0.13);
  return { muzzle: V(0, B, -0.338), sightY: 0.11, eject: V(0.021, 0.058, -0.1), gripL: V(0, 0.007, -0.204), gripAng: 0.3, eyeZ: 0.2,
    anim: { reload: 'mag', cycle: 'auto', recip: true, magDir: V(0, -0.997, -0.07), magGrab: V(-0.012, -0.12, -0.13), boltTravel: 0.07, boltGrab: V(-0.03, 0.062, -0.18), shell: [0.0026, 0.016] } };
} };

// 破門者 霰彈槍：泵動式，木托＋木護木，槍管下面一根彈倉管
GUNS.shotgun = { kind: 'rifle', body: [0x26282d, 0.9, 0.42], furn: [0x7c4a2b, 'wood'], build(k, L) {
  const B = 0.035, T = 0.0095;
  k.prof(L.body, [[-0.255, 0.052], [-0.06, 0.052], [-0.03, 0.03], [-0.022, -0.002], [-0.036, -0.022], [-0.255, -0.022]], 0.04, 0, { b: 0.006 });   // 機匣
  k.box(S.hole, 0.024, 0.002, 0.078, 0, -0.0215, -0.2);                                                                                            // 底下的裝彈口
  k.box(S.dark, 0.002, 0.022, 0.066, 0.0194, 0.028, -0.165).box(S.chrome, 0.0026, 0.016, 0.058, 0.0194, 0.028, -0.165);                           // 拋殼口
  k.cyl(S.steel, 0.004, 0.041, 0, -0.008, -0.07, { ax: 'x', seg: 8 }).cyl(S.steel, 0.003, 0.0408, 0, 0.012, -0.14, { ax: 'x', seg: 8 });
  guard(k, S.dark, -0.04, -0.102, -0.062, -0.022, 0.014);
  k.lathe(S.dark, [[-0.25, 0.0108], [-0.66, 0.0108], [-0.66, 0.0092], [-0.62, 0.0092]], 0, B, { seg: 12 }).disc(S.hole, 0.0092, 0, B, -0.62);       // 槍管（中空）
  k.ball(S.brass, 0.003, 0, B + 0.0128, -0.65);                                                                                                    // 準星珠
  k.lathe(S.dark, [[-0.25, 0.0115], [-0.622, 0.0115], [-0.622, 0.0135], [-0.64, 0.0135], [-0.644, 0.011], [-0.644, 0]], 0, T, { seg: 12 });         // 彈倉管
  k.box(S.dark, 0.011, 0.03, 0.012, 0, 0.022, -0.6);                                                                                               // 槍管箍
  k.part('pump', 0, T, -0.435);
  const pp = [[-0.345, 0.015], [-0.35, 0.0235]];
  for (let i = 0; i < 5; i++) { const z = -0.357 - i * 0.032; pp.push([z, 0.0248], [z - 0.025, 0.0248], [z - 0.029, 0.0222]); }
  pp.push([-0.52, 0.0235], [-0.526, 0.015]);
  k.lathe(L.furn, pp, 0, T, { seg: 12, sy: 1.1 });
  for (const s of [-1, 1]) k.box(S.dark, 0.003, 0.008, 0.14, s * 0.0135, T + 0.012, -0.29);                                                         // 連桿
  if (L.glow) k.box(L.glow, 0.05, 0.003, 0.15, 0, T + 0.002, -0.435);
  k.part();
  // 半手槍式握把的木托
  k.prof(L.furn, [[-0.034, 0.026], [-0.006, 0.004], [0.006, -0.004], [0.03, -0.014], [0.08, -0.004], [0.105, 0.016], [0.318, 0.012], [0.324, 0], [0.322, -0.116], [0.3, -0.122],
    [0.12, -0.064], [0.07, -0.07], [0.046, -0.098], [0.012, -0.106], [-0.004, -0.092], [-0.041, -0.03], [-0.04, -0.02]], 0.04, 0, { b: 0.009 });
  k.prof(S.rubber, [[0.322, 0.004], [0.336, 0], [0.334, -0.118], [0.32, -0.122]], 0.038, 0, { b: 0.006 });
  if (L.glow) k.box(L.glow, 0.0404, 0.003, 0.15, 0, -0.02, 0.2, 0.16);
  return { muzzle: V(0, B, -0.66), sightY: 0.0545, eject: V(0.022, 0.028, -0.165), gripL: V(0, T - 0.027, -0.435), gripAng: 0.5, eyeZ: 0.15,
    anim: { reload: 'shell', cycle: 'pump', pumpTravel: 0.085, port: V(0, -0.03, -0.2), shell: [0.0098, 0.056, 'hull'] } };
} };

// M-12 射手步槍：半自動、長護木、中倍率瞄準鏡、12 發直彈匣、固定式貼腮托
GUNS.dmr = { kind: 'rifle', body: [0x6f6553, 0.3, 0.64], furn: [0x554c40, 0.05, 0.8], build(k, L) {
  const B = 0.056, SY = 0.123;
  k.prof(L.body, [[0.045, 0.046], [0.045, 0.014], [0.006, 0.006], [-0.112, 0.004], [-0.116, -0.016], [-0.186, -0.012], [-0.2, 0.014], [-0.2, 0.046]], 0.032, 0, { b: 0.003 });
  k.prof(L.body, [[0.045, 0.044], [0.045, 0.076], [0.036, 0.082], [-0.216, 0.082], [-0.216, 0.044]], 0.036, 0, { b: 0.005 });
  k.box(S.dark, 0.002, 0.014, 0.066, 0.0174, 0.062, -0.11).box(S.chrome, 0.0026, 0.008, 0.05, 0.0174, 0.062, -0.108);
  k.box(S.hole, 0.001, 0.006, 0.1, -0.0182, 0.064, -0.1);
  k.cyl(S.steel, 0.0036, 0.0332, 0, 0.03, -0.185, { ax: 'x', seg: 8 }).cyl(S.steel, 0.0036, 0.0332, 0, 0.03, 0.024, { ax: 'x', seg: 8 }).cyl(S.steel, 0.0052, 0.0344, 0, 0.02, -0.024, { ax: 'x', seg: 8 });
  rail(k, S.dark, 0.082, 0.038, -0.59);
  k.sect(L.furn, oct(0.021, 0.032, 0.082, 0.009), -0.216, -0.6, { b: 0.0025 });
  for (let i = 0; i < 7; i++) k.box(S.hole, 0.0426, 0.007, 0.032, 0, 0.057, -0.25 - i * 0.05);
  barrel(k, S.dark, B, -0.21, -0.738, 0.0095, 0);
  k.lathe(S.dark, [[-0.73, 0.0095], [-0.736, 0.0135], [-0.786, 0.0135], [-0.79, 0.012], [-0.79, 0.0062], [-0.76, 0.0062]], 0, B, { seg: 10 }).disc(S.hole, 0.0062, 0, B, -0.76);   // 制退器
  for (let i = 0; i < 3; i++) k.box(S.hole, 0.0274, 0.008, 0.007, 0, B, -0.748 - i * 0.013);
  k.part('bolt', -0.019, 0.064, -0.14).cyl(S.steel, 0.005, 0.02, -0.028, 0.064, -0.14, { ax: 'x', seg: 8 }).part();
  scope(k, SY, 0.052, 0.33, 0.0128, 0.019, 0.0235, 0.0875, true);
  // 固定托：貼腮板＋托底
  k.cyl(S.dark, 0.014, 0.08, 0, B, 0.08);
  k.prof(L.furn, [[0.06, 0.076], [0.112, 0.076], [0.124, 0.094], [0.25, 0.094], [0.262, 0.078], [0.3, 0.078], [0.305, 0.07], [0.305, -0.05], [0.29, -0.058], [0.264, -0.058], [0.25, -0.03], [0.17, -0.014], [0.12, 0.014], [0.06, 0.022]], 0.04, 0, { b: 0.006, holes: [[[0.14, 0.066], [0.27, 0.06], [0.27, 0], [0.19, 0.012], [0.14, 0.03]]] });
  k.box(S.rubber, 0.036, 0.126, 0.01, 0, 0.011, 0.309);
  grip(k, L.furn, 0.31);
  guard(k, S.dark, -0.05, -0.112);
  k.part('mag', -0.151, 0, 0).prof(S.dark, [[-0.122, 0.02], [-0.122, -0.08], [-0.184, -0.088], [-0.18, 0.02]], 0.026, 0, { b: 0.003 }).prof(S.poly, [[-0.119, -0.076], [-0.119, -0.088], [-0.188, -0.096], [-0.188, -0.084]], 0.029, 0, { b: 0.003 });
  if (L.glow) k.box(L.glow, 0.0266, 0.004, 0.04, 0, -0.05, -0.152);
  k.part();
  if (L.glow) k.box(L.glow, 0.0432, 0.003, 0.3, 0, 0.0735, -0.4).box(L.glow, 0.0408, 0.003, 0.1, 0, 0.086, 0.19);
  return { muzzle: V(0, B, -0.79), sightY: SY, eject: V(0.022, 0.062, -0.108), gripL: V(0, 0.032, -0.38), gripAng: 0.31, eyeZ: 0.118, scope: 'glass',
    anim: { reload: 'mag', cycle: 'auto', recip: true, magDir: V(0, -1, -0.04).normalize(), magGrab: V(-0.014, -0.06, -0.153), boltTravel: 0.075, boltGrab: V(-0.03, 0.064, -0.135), shell: [0.0034, 0.028] } };
} };

// 長釘 狙擊槍：栓動、拇指孔槍托、大瞄準鏡、長重槍管、5 發彈匣
GUNS.sniper = { kind: 'rifle', body: [0x3d4a52, 0.15, 0.7], furn: [0x23282c, 0, 0.85], build(k, L) {
  const B = 0.052, SY = 0.114;
  k.prof(L.body, [[-0.5, 0.042], [0.045, 0.042], [0.062, 0.07], [0.09, 0.082], [0.29, 0.082], [0.33, 0.07], [0.334, -0.058], [0.315, -0.068], [0.2, -0.064], [0.11, -0.1], [0.04, -0.11], [-0.012, -0.106],
    [-0.04, -0.036], [-0.05, -0.004], [-0.108, 0], [-0.17, -0.008], [-0.48, 0.004], [-0.5, 0.016]], 0.044, 0,
  { b: 0.007, holes: [[[0, 0.016], [0.07, 0.024], [0.1, -0.02], [0.09, -0.062], [0.04, -0.088], [0.016, -0.05], [0.002, -0.002]]] });                                             // 槍托（一體成形）
  k.box(L.furn, 0.036, 0.008, 0.17, 0, 0.085, 0.19).box(S.rubber, 0.04, 0.13, 0.012, 0, 0.006, 0.339);                                                                           // 貼腮墊、托底
  for (let i = 0; i < 4; i++) k.box(S.hole, 0.0446, 0.008, 0.04, 0, 0.022, -0.25 - i * 0.06);
  k.lathe(S.dark, [[0.035, 0], [0.035, 0.0165], [-0.215, 0.0165], [-0.215, 0.0135]], 0, B, { seg: 12 });                                                                          // 機匣
  k.box(S.hole, 0.014, 0.012, 0.07, 0.0085, B + 0.0095, -0.1, 0, 0, -0.6);                                                                                                       // 拋殼口
  k.lathe(S.dark, [[-0.21, 0.0135], [-0.8, 0.0105], [-0.8, 0]], 0, B, { seg: 12 });                                                                                              // 重槍管
  k.lathe(S.dark, [[-0.795, 0.0105], [-0.8, 0.0155], [-0.86, 0.0155], [-0.866, 0.013], [-0.866, 0.0068], [-0.83, 0.0068]], 0, B, { seg: 10 }).disc(S.hole, 0.0068, 0, B, -0.83);   // 制退器
  for (let i = 0; i < 3; i++) k.box(S.hole, 0.0314, 0.011, 0.009, 0, B, -0.815 - i * 0.017);
  // 槍栓：機體＋拉柄＋球（轉軸在槍膛軸線）
  k.part('bolt', 0, B, 0.012);
  k.cyl(S.chrome, 0.0092, 0.14, 0, B, -0.05, { seg: 10 }).lathe(S.dark, [[0.066, 0], [0.066, 0.0105], [0.036, 0.012], [0.03, 0.012]], 0, B, { seg: 10 });
  k.cyl(S.steel, 0.0048, 0.046, 0.034, B - 0.012, 0.012, { ax: 'x', seg: 8, rz: -0.62 }).ball(S.dark, 0.0112, 0.054, B - 0.027, 0.012, 10, 7);
  k.part();
  k.box(S.dark, 0.02, 0.006, 0.23, 0, B + 0.0185, -0.09);                                                                                                                          // 鏡橋
  scope(k, SY, 0.056, 0.36, 0.015, 0.0215, 0.031, B + 0.0215, false);
  guard(k, S.dark, -0.05, -0.108, -0.03, 0);
  k.part('mag', -0.14, 0, 0).prof(S.dark, [[-0.112, 0.02], [-0.112, -0.036], [-0.168, -0.042], [-0.168, 0.02]], 0.03, 0, { b: 0.004 }).part();
  if (L.glow) k.box(L.glow, 0.0446, 0.003, 0.3, 0, 0.034, -0.33).box(L.glow, 0.0446, 0.003, 0.14, 0, 0.062, 0.21);
  return { muzzle: V(0, B, -0.866), sightY: SY, eject: V(0.02, B + 0.012, -0.1), gripL: V(0, -0.002, -0.3), gripAng: 0.33, eyeZ: 0.126, scope: 'overlay',
    anim: { reload: 'bolt', cycle: 'bolt', magDir: V(0, -1, 0), magGrab: V(-0.016, -0.03, -0.14), boltTravel: 0.085, boltLift: 1.0, boltKnob: V(0.054, B - 0.027, 0.012), shell: [0.0042, 0.04] } };
} };

// 鐵砧 輕機槍：高機匣＋上蓋、底下掛 75 發彈鼓、重槍管、散熱護木、收起來的腳架
GUNS.lmg = { kind: 'rifle', body: [0x505356, 0.8, 0.58], furn: [0x26282c, 0, 0.82], build(k, L) {
  const B = 0.05;
  k.prof(L.body, [[0.05, 0.012], [0.006, 0.006], [-0.3, 0.006], [-0.3, 0.082], [0.05, 0.082]], 0.05, 0, { b: 0.004 });                                             // 機匣
  k.prof(L.body, [[0.036, 0.08], [0.03, 0.098], [-0.19, 0.098], [-0.204, 0.08]], 0.046, 0, { b: 0.005 });                                                         // 上蓋
  k.box(S.steel, 0.012, 0.008, 0.02, 0, 0.084, 0.044);                                                                                                           // 上蓋卡榫
  rail(k, S.dark, 0.098, 0.02, -0.19, 0.021);
  k.box(S.dark, 0.002, 0.016, 0.06, 0.0254, 0.03, -0.12).box(S.hole, 0.001, 0.007, 0.13, -0.0252, 0.05, -0.12);
  for (let i = 0; i < 4; i++) k.cyl(S.steel, 0.0032, 0.0508, 0, 0.07 - (i & 1) * 0.05, 0.03 - i * 0.1, { ax: 'x', seg: 6 });
  k.part('bolt', -0.026, 0.05, -0.16).cyl(S.steel, 0.0055, 0.022, -0.036, 0.05, -0.16, { ax: 'x', seg: 8 }).part();
  // 槍管組：重槍管＋散熱罩＋下護木＋提把＋防火帽
  k.lathe(S.dark, [[-0.295, 0.0135], [-0.52, 0.0135], [-0.53, 0.011], [-0.645, 0.011], [-0.65, 0.0135], [-0.7, 0.0125], [-0.704, 0.0105], [-0.704, 0.0065], [-0.67, 0.0065]], 0, B, { seg: 12 }).disc(S.hole, 0.0065, 0, B, -0.67);
  k.box(S.hole, 0.0275, 0.0035, 0.03, 0, B, -0.676).box(S.hole, 0.0035, 0.0275, 0.03, 0, B, -0.676);
  k.cyl(S.dark, 0.0065, 0.26, 0, 0.024, -0.43, { seg: 8 });                                                                                                       // 導氣管
  k.prof(L.furn, [[-0.3, 0.004], [-0.3, 0.04], [-0.5, 0.04], [-0.5, 0.012], [-0.486, 0.004]], 0.05, 0, { b: 0.007 });                                             // 下護木
  k.prof(S.dark, [[-0.302, 0.064], [-0.302, 0.074], [-0.496, 0.074], [-0.496, 0.064]], 0.036, 0, { b: 0.004 });                                                   // 散熱罩
  for (let i = 0; i < 5; i++) k.box(S.hole, 0.02, 0.001, 0.022, 0, 0.0742, -0.325 - i * 0.037).box(S.hole, 0.0504, 0.008, 0.022, 0, 0.024, -0.325 - i * 0.037);
  k.box(S.dark, 0.006, 0.03, 0.006, 0.012, 0.086, -0.315, 0, 0, -0.5).box(S.dark, 0.006, 0.03, 0.006, 0.012, 0.086, -0.375, 0, 0, -0.5).cyl(L.furn, 0.008, 0.074, 0.024, 0.096, -0.345, { seg: 8 });   // 提把（倒向右邊）
  k.box(S.dark, 0.024, 0.03, 0.02, 0, 0.066, -0.56).box(S.dark, 0.0024, 0.047, 0.003, 0, 0.1015, -0.56);                                                           // 導氣箍＋準星
  for (const s of [-1, 1]) k.box(S.dark, 0.003, 0.05, 0.014, s * 0.0095, 0.105, -0.56, 0, 0, -s * 0.08);
  for (const s of [-1, 1]) k.cyl(S.steel, 0.0048, 0.21, s * 0.031, 0.02, -0.44, { seg: 6 }).box(S.steel, 0.012, 0.006, 0.02, s * 0.031, 0.02, -0.33);               // 腳架（往後收）
  k.box(S.steel, 0.07, 0.014, 0.016, 0, 0.022, -0.548);
  // 後覘孔（裝在上蓋後端）
  k.box(S.dark, 0.022, 0.008, 0.03, 0, 0.108, 0.006);
  for (const s of [-1, 1]) k.box(S.dark, 0.004, 0.014, 0.005, s * 0.0092, 0.115, 0.004);
  k.ring(S.dark, 0.0074, 0.002, 0, 0.125, 0.004, { rs: 4, ts: 14 });
  // 固定托
  k.prof(L.furn, [[0.05, 0.078], [0.29, 0.078], [0.298, 0.07], [0.298, -0.046], [0.284, -0.052], [0.24, -0.03], [0.15, 0.008], [0.05, 0.016]], 0.036, 0, { b: 0.006, holes: [[[0.11, 0.062], [0.264, 0.062], [0.264, -0.012], [0.16, 0.03], [0.11, 0.036]]] });
  k.box(S.rubber, 0.034, 0.12, 0.008, 0, 0.014, 0.301).prof(S.steel, [[0.292, 0.078], [0.3, 0.078], [0.31, 0.1], [0.302, 0.1]], 0.03, 0, { b: 0.002 });
  grip(k, L.furn, 0.3);
  guard(k, S.dark, -0.05, -0.108);
  // 彈鼓（軸線順著槍管）＋供彈口
  k.part('mag', 0, 0.006, -0.172);
  k.lathe(S.steel, [[-0.133, 0], [-0.133, 0.058], [-0.141, 0.068], [-0.203, 0.068], [-0.211, 0.058], [-0.211, 0]], 0, -0.058, { seg: 16 });
  k.ring(S.dark, 0.04, 0.003, 0, -0.058, -0.1325, { rs: 3, ts: 16 }).cyl(S.dark, 0.014, 0.008, 0, -0.058, -0.13, { seg: 8 }).box(S.dark, 0.034, 0.006, 0.004, 0, -0.058, -0.127);
  k.box(S.steel, 0.036, 0.03, 0.062, 0, 0.004, -0.172);
  if (L.glow) k.ring(L.glow, 0.054, 0.0022, 0, -0.058, -0.1325, { rs: 3, ts: 16 });
  k.part();
  if (L.glow) k.box(L.glow, 0.0506, 0.003, 0.24, 0, 0.066, -0.14);
  return { muzzle: V(0, B, -0.704), sightY: 0.125, eject: V(0.028, 0.03, -0.12), gripL: V(0, 0.003, -0.4), gripAng: 0.3, eyeZ: 0.17,
    anim: { reload: 'mag', cycle: 'auto', recip: true, magDir: V(0, -1, 0), magGrab: V(0, -0.126, -0.172), magHold: 'under', boltTravel: 0.085, boltGrab: V(-0.04, 0.05, -0.155), shell: [0.0029, 0.022] } };
} };

// 拆遷令 火箭筒：RPG 式的肩射筒，後端喇叭口、中段木質隔熱套，彈頭露在筒口外
GUNS.rocket = { kind: 'launcher', body: [0x5b6b3c, 0.45, 0.6], furn: [0x8a5a34, 'wood'], build(k, L) {
  const T = 0.088;
  k.lathe(L.body, [[0.5, 0.046], [0.56, 0.054], [0.56, 0.058], [0.44, 0.036], [0.4, 0.03], [0.33, 0.043], [0.23, 0.043], [0.2, 0.036], [-0.36, 0.036], [-0.362, 0.0395], [-0.38, 0.0395], [-0.38, 0.0315], [-0.34, 0.0315]], 0, T, { seg: 16 });
  k.disc(S.hole, 0.0315, 0, T, -0.34, -1, 16).disc(S.hole, 0.046, 0, T, 0.5, 1, 16);
  k.lathe(L.furn, [[0.19, 0.036], [0.186, 0.0425], [0.03, 0.0425], [0.026, 0.036]], 0, T, { seg: 16 });                                                // 木質隔熱套
  for (const z of [0.188, 0.108, 0.028]) k.lathe(S.steel, [[z + 0.005, 0.0432], [z - 0.005, 0.0432]], 0, T, { seg: 16 });
  for (const z of [-0.03, -0.3]) k.lathe(S.dark, [[z + 0.008, 0.0368], [z - 0.008, 0.0368]], 0, T, { seg: 16 });
  // 擊發機座＋握把＋後握把
  k.prof(S.dark, [[0.016, 0.006], [0.02, 0.056], [-0.1, 0.056], [-0.104, 0.01], [-0.05, 0.004]], 0.028, 0, { b: 0.004 });
  k.prof(S.steel, [[0.02, 0.03], [0.034, 0.044], [0.03, 0.05], [0.014, 0.04]], 0.008, 0, { b: 0.0015 });                                                 // 擊錘
  grip(k, L.furn, 0.26);
  guard(k, S.dark, -0.05, -0.1);
  k.prof(L.furn, [[0.17, 0.052], [0.128, 0.052], [0.132, -0.04], [0.176, -0.046]], 0.03, 0, { b: 0.008 });
  // 瞄具：前準星（帶護圈）＋後照門板
  k.box(S.dark, 0.014, 0.012, 0.03, 0, T + 0.041, -0.3).box(S.dark, 0.0024, 0.03, 0.003, 0, T + 0.061, -0.3).ring(S.dark, 0.011, 0.0016, 0, T + 0.067, -0.3, { rs: 3, ts: 12 });
  k.box(S.dark, 0.014, 0.012, 0.03, 0, T + 0.041, -0.05);
  for (const s of [-1, 1]) k.box(S.dark, 0.007, 0.03, 0.003, s * 0.0058, T + 0.061, -0.05);
  k.box(S.dark, 0.0186, 0.018, 0.003, 0, T + 0.055, -0.05);
  for (const z of [-0.33, 0.3]) k.ring(S.steel, 0.008, 0.0016, -0.04, T - 0.004, z, { ax: 'x', rs: 3, ts: 8 });                                          // 背帶環
  // 彈頭（裝好的樣子）：推進藥管插在筒裡，錐形彈頭露在外面
  k.part('rocket', 0, T, -0.38);
  k.lathe(S.olive, [[-0.3, 0], [-0.3, 0.018], [-0.4, 0.018], [-0.43, 0.0425], [-0.52, 0.0425], [-0.6, 0.03], [-0.648, 0.014]], 0, T, { seg: 14 });
  k.lathe(S.steel, [[-0.648, 0.014], [-0.66, 0.0095], [-0.706, 0.008], [-0.716, 0]], 0, T, { seg: 10 });
  k.lathe(S.mark, [[-0.44, 0.0432], [-0.452, 0.0432]], 0, T, { seg: 14 });
  if (L.glow) k.lathe(L.glow, [[-0.5, 0.0434], [-0.508, 0.0434]], 0, T, { seg: 14 });
  k.part();
  if (L.glow) for (const z of [-0.12, -0.2, 0.26]) k.lathe(L.glow, [[z + 0.004, 0.0372 + (z > 0 ? 0.0068 : 0)], [z - 0.004, 0.0372 + (z > 0 ? 0.0068 : 0)]], 0, T, { seg: 16 });
  return { muzzle: V(0, T, -0.38), sightY: T + 0.076, eject: null, gripL: V(0, T - 0.04, -0.17), gripAng: 0.26, eyeZ: 0.11,
    anim: { reload: 'rocket', cycle: 'rocket', insert: 0.42 } };
} };

// 彈跳 榴彈槍：六發轉輪式 40mm，粗短槍管、頂樑導軌、伸縮托
GUNS.gl = { kind: 'rifle', body: [0x6a5a3a, 0.4, 0.62], furn: [0x26282c, 0, 0.82], build(k, L) {
  const B = 0.058, C = 0.022, R = 0.058;
  k.prof(L.body, [[0.045, 0.012], [0.006, 0.006], [-0.108, 0.004], [-0.108, 0.086], [0.03, 0.086], [0.045, 0.07]], 0.04, 0, { b: 0.005 });                         // 後機座
  k.prof(L.body, [[-0.1, 0.086], [-0.1, 0.1], [-0.262, 0.1], [-0.262, 0.086]], 0.03, 0, { b: 0.004 });                                                              // 頂樑
  rail(k, S.dark, 0.1, -0.104, -0.258);
  k.prof(L.body, [[-0.242, 0.1], [-0.264, 0.1], [-0.264, -0.044], [-0.242, -0.044]], 0.036, 0, { b: 0.004 });                                                       // 前框
  k.prof(L.body, [[-0.09, -0.034], [-0.09, -0.046], [-0.275, -0.046], [-0.275, -0.034]], 0.024, 0, { b: 0.004 });                                                  // 下樑
  k.cyl(L.body, 0.057, 0.007, 0, C, -0.1065, { seg: 14 });                                                                                                          // 後膛板
  k.cyl(S.steel, 0.006, 0.17, 0, C, -0.176, { seg: 8 });                                                                                                           // 轉輪軸
  // 轉輪：cyl = 往左甩開的搖臂轉軸，drum = 自轉
  k.part('cyl', -0.03, -0.03, -0.176).part('drum', 0, C, -0.176, 'cyl');
  const st = []; for (let i = 0; i < 6; i++) for (const [da, r] of [[-0.36, R], [0, R], [0.36, R], [0.52, R - 0.007]]) { const a = HP + (i / 6) * TAU + da; st.push([Math.cos(a) * r, C + Math.sin(a) * r]); }
  k.sect(S.dark, st, -0.112, -0.24, { b: 0.003 });
  for (let i = 0; i < 6; i++) { const a = HP + (i / 6) * TAU, x = Math.cos(a) * 0.036, y = C + Math.sin(a) * 0.036; k.disc(S.brass, 0.0185, x, y, -0.1116, 1, 10).disc(S.hole, 0.019, x, y, -0.2404, -1, 10); }
  k.part();
  k.lathe(S.dark, [[-0.262, 0.029], [-0.43, 0.029], [-0.432, 0.0315], [-0.448, 0.0315], [-0.448, 0.0215], [-0.4, 0.0215]], 0, B, { seg: 14 }).disc(S.hole, 0.0215, 0, B, -0.4, -1, 14);   // 槍管
  k.prof(L.furn, [[-0.268, 0.03], [-0.268, -0.02], [-0.39, -0.012], [-0.396, 0.03]], 0.046, 0, { b: 0.008 });                                                      // 護木
  for (let i = 0; i < 4; i++) k.box(S.hole, 0.0464, 0.02, 0.006, 0, 0.004, -0.29 - i * 0.026);
  m4stock(k, L, 0.06, 0.04);
  grip(k, L.furn, 0.3);
  guard(k, S.dark, -0.05, -0.106);
  irons(k, S.dark, 0.106, 0.136, -0.115, -0.25);
  if (L.glow) k.box(L.glow, 0.0404, 0.003, 0.1, 0, 0.06, -0.04).box(L.glow, 0.0464, 0.003, 0.11, 0, 0.024, -0.33);
  return { muzzle: V(0, B, -0.448), sightY: 0.136, eject: null, gripL: V(0, -0.018, -0.33), gripAng: 0.3, eyeZ: 0.1,
    anim: { reload: 'break', cycle: 'drum', cylOpen: 1.75, cylFace: V(0, C, -0.11), round: [0.019, 0.07] } };
} };

// P9 手槍：聚合物底把＋鋼滑套
GUNS.pistol = { kind: 'pistol', body: [0x33363c, 0.85, 0.48], furn: [0x1f2023, 0, 0.82], build(k, L) {
  const B = 0.031;
  k.prof(L.furn, [[0.024, 0.014], [0.027, 0.006], [0.003, -0.003], [0.01, -0.04], [0.032, -0.104], [-0.018, -0.11], [-0.04, -0.04], [-0.046, -0.034], [-0.1, -0.034], [-0.11, -0.024], [-0.112, -0.006], [-0.15, -0.006], [-0.154, 0.014]],
    0.028, 0, { b: 0.005, holes: [[[-0.055, -0.004], [-0.052, -0.028], [-0.098, -0.028], [-0.104, -0.008]]] });                                    // 底把（連護弓）
  k.prof(S.rubber, [[0.006, -0.012], [0.012, -0.042], [0.028, -0.094], [-0.016, -0.1], [-0.034, -0.042], [-0.038, -0.016]], 0.0296, 0, { b: 0.003 });   // 握把防滑片
  k.box(L.furn, 0.016, 0.005, 0.034, 0, -0.008, -0.13).box(S.hole, 0.0164, 0.0016, 0.004, 0, -0.009, -0.126);
  k.prof(S.steel, [[-0.07, -0.002], [-0.077, -0.002], [-0.081, -0.014], [-0.078, -0.024], [-0.074, -0.023], [-0.075, -0.012]], 0.006, 0, { b: 0.0012 });   // 扳機
  k.box(S.dark, 0.002, 0.005, 0.03, -0.0146, 0.008, -0.03).box(S.dark, 0.002, 0.005, 0.012, -0.0146, 0.004, -0.085).cyl(S.dark, 0.0035, 0.03, 0, -0.012, -0.048, { ax: 'x', seg: 6 });
  barrel(k, S.steel, B, -0.1, -0.163, 0.0068);
  k.disc(S.hole, 0.004, 0, 0.0195, -0.1604);
  // 滑套（整個會往後退）：上面帶照門、準星、拋殼口
  k.part('bolt', 0, 0.03, 0);
  k.prof(L.body, [[0.03, 0.0135], [0.03, 0.04], [0.026, 0.044], [-0.156, 0.044], [-0.16, 0.04], [-0.16, 0.0135]], 0.026, 0, { b: 0.0035 });
  for (let i = 0; i < 5; i++) k.box(S.hole, 0.0263, 0.02, 0.0018, 0, 0.028, 0.022 - i * 0.0056, -0.2);
  k.box(S.chrome, 0.0145, 0.0022, 0.03, 0.006, 0.0432, -0.046).box(S.chrome, 0.0022, 0.009, 0.03, 0.0122, 0.0385, -0.046);
  notch(k, S.dark, 0.0495, 0.02, -0.148, 0.0438);
  if (L.glow) k.box(L.glow, 0.0264, 0.002, 0.1, 0, 0.02, -0.09);
  k.part();
  // 彈匣（藏在握把裡，底板露出來）
  k.part('mag', 0, -0.05, -0.006).box(S.dark, 0.021, 0.116, 0.034, 0, -0.05, -0.007, -0.264).box(S.poly, 0.0285, 0.009, 0.05, 0, -0.1105, 0.0075, -0.12).part();
  return { muzzle: V(0, B, -0.163), sightY: 0.0495, eject: V(0.012, 0.046, -0.046), gripL: V(-0.014, -0.05, -0.02), gripAng: 0.3, eyeZ: 0.33, hold: 'support',
    anim: { reload: 'mag', cycle: 'slide', magDir: V(0, -0.966, 0.258), boltTravel: 0.042, shell: [0.0026, 0.014] } };
} };

// 審判者 左輪：不鏽鋼大左輪，六發轉輪、全長底肋槍管、胡桃木握把
GUNS.revolver = { kind: 'pistol', body: [0xa9a59c, 1, 0.3], furn: [0x5b3620, 'wood'], build(k, L) {
  const B = 0.046, C = 0.032, R = 0.0205;
  k.prof(L.body, [[-0.084, 0.064], [-0.008, 0.064], [-0.004, 0.05], [0.01, 0.024], [0.012, 0.012], [0.002, -0.002], [0.004, -0.01], [-0.04, -0.012], [-0.046, -0.036], [-0.092, -0.036], [-0.098, -0.014], [-0.098, 0.004], [-0.084, 0.008]],
    0.017, 0, { b: 0.003, holes: [[[-0.027, 0.0105], [-0.027, 0.0565], [-0.0765, 0.0565], [-0.0765, 0.0105]], [[-0.052, -0.014], [-0.05, -0.03], [-0.088, -0.03], [-0.092, -0.014]]] });   // 槍框
  k.prof(S.steel, [[-0.066, -0.01], [-0.073, -0.01], [-0.078, -0.02], [-0.075, -0.029], [-0.071, -0.028], [-0.072, -0.018]], 0.006, 0, { b: 0.0012 });                                // 扳機
  k.box(L.body, 0.006, 0.04, 0.004, 0, 0.034, -0.0255);                                                                                                                                  // 後護板
  // 槍管：圓管＋底肋＋頂肋＋準星
  k.cyl(L.body, 0.0098, 0.154, 0, B, -0.161, { seg: 12 }).disc(S.hole, 0.0056, 0, B, -0.2384);
  k.prof(L.body, [[-0.084, 0.04], [-0.084, 0.02], [-0.226, 0.02], [-0.238, 0.03], [-0.238, 0.04]], 0.014, 0, { b: 0.004 });
  k.prof(L.body, [[-0.084, 0.054], [-0.084, 0.0625], [-0.238, 0.0605], [-0.238, 0.054]], 0.009, 0, { b: 0.002 });
  k.prof(S.dark, [[-0.2, 0.06], [-0.234, 0.06], [-0.232, 0.07], [-0.224, 0.07]], 0.0034, 0, { b: 0.0006 });
  for (const s of [-1, 1]) k.box(S.dark, 0.0045, 0.007, 0.008, s * 0.0052, 0.0665, -0.012);
  k.box(S.dark, 0.015, 0.003, 0.008, 0, 0.0645, -0.012);
  // 轉輪：cyl = 往左甩開的搖臂（轉軸在槍框左下），drum = 自轉
  k.part('cyl', -0.006, 0.006, -0.05).part('drum', 0, C, -0.05, 'cyl');
  const st = []; for (let i = 0; i < 6; i++) for (const [da, r] of [[-0.34, R], [0, R], [0.34, R], [0.52, R - 0.0026]]) { const a = HP + (i / 6) * TAU + da; st.push([Math.cos(a) * r, C + Math.sin(a) * r]); }
  k.sect(L.body, st, -0.028, -0.0755, { b: 0.0015 });
  for (let i = 0; i < 6; i++) { const a = HP + (i / 6) * TAU, x = Math.cos(a) * 0.0133, y = C + Math.sin(a) * 0.0133; k.disc(S.brass, 0.0052, x, y, -0.0277, 1, 8).disc(S.hole, 0.0048, x, y, -0.0758, -1, 8); }
  k.part('cyl').cyl(S.steel, 0.0032, 0.062, 0, C - 0.0005, -0.106, { seg: 6 }).box(L.body, 0.006, 0.022, 0.008, -0.003, 0.017, -0.08).part();   // 退殼桿＋搖臂
  k.part('hammer', 0, 0.03, 0.002).prof(S.steel, [[-0.006, 0.028], [-0.007, 0.056], [0.002, 0.06], [0.016, 0.066], [0.017, 0.06], [0.007, 0.05], [0.008, 0.03]], 0.007, 0, { b: 0.0012 }).part();
  k.prof(L.furn, [[0.012, 0.014], [0.002, -0.001], [0.008, -0.04], [0.03, -0.09], [0.034, -0.108], [-0.004, -0.116], [-0.022, -0.09], [-0.036, -0.05], [-0.04, -0.016], [-0.03, -0.008], [-0.006, 0.012]], 0.03, 0, { b: 0.008 });   // 握把
  k.cyl(S.brass, 0.0045, 0.0306, 0, -0.034, -0.012, { ax: 'x', seg: 8 });
  if (L.glow) k.box(L.glow, 0.0144, 0.002, 0.13, 0, 0.03, -0.15);
  return { muzzle: V(0, B, -0.239), sightY: 0.07, eject: null, gripL: V(-0.014, -0.05, -0.02), gripAng: 0.36, eyeZ: 0.3, hold: 'support',
    anim: { reload: 'revolver', cycle: 'revolver', cylOpen: 1.6, cylFace: V(0, C, -0.027), shell: [0.0052, 0.03] } };
} };

// 黃蜂 衝鋒手槍：方盒機匣、握把裡插一根加長彈匣、短槍管帶散熱套
GUNS.mp = { kind: 'pistol', body: [0x5a4a3a, 0.65, 0.5], furn: [0x1f2023, 0, 0.82], build(k, L) {
  const B = 0.036;
  k.prof(L.body, [[0.042, 0.012], [0.042, 0.052], [0.036, 0.058], [-0.16, 0.058], [-0.166, 0.052], [-0.166, 0.012]], 0.034, 0, { b: 0.004 });                   // 上機匣
  k.prof(L.furn, [[0.03, 0.014], [0.027, 0.006], [0.003, -0.003], [0.01, -0.04], [0.03, -0.1], [-0.02, -0.106], [-0.04, -0.04], [-0.046, -0.034], [-0.096, -0.034], [-0.106, -0.024], [-0.108, -0.004], [-0.15, -0.006], [-0.156, 0.014]],
    0.03, 0, { b: 0.005, holes: [[[-0.055, -0.002], [-0.052, -0.028], [-0.094, -0.028], [-0.1, -0.006]]] });                                                    // 下機匣＋握把
  k.prof(S.steel, [[-0.068, 0], [-0.075, 0], [-0.079, -0.012], [-0.076, -0.022], [-0.072, -0.021], [-0.073, -0.01]], 0.006, 0, { b: 0.0012 });
  k.box(S.dark, 0.002, 0.014, 0.04, 0.0164, 0.04, -0.07).box(S.chrome, 0.0026, 0.008, 0.03, 0.0164, 0.04, -0.07);
  k.box(S.hole, 0.012, 0.001, 0.07, 0, 0.0582, -0.05);                                                                                                         // 頂上的拉柄滑槽
  for (let i = 0; i < 4; i++) k.box(S.hole, 0.0344, 0.01, 0.005, 0, 0.036, -0.118 - i * 0.011);                                                                // 散熱孔
  k.lathe(S.dark, [[-0.164, 0.0115], [-0.2, 0.0115], [-0.204, 0.0095], [-0.216, 0.0095], [-0.216, 0.005], [-0.2, 0.005]], 0, B, { seg: 10 }).disc(S.hole, 0.005, 0, B, -0.2);
  k.box(L.furn, 0.016, 0.006, 0.04, 0, -0.008, -0.128);
  k.part('bolt', 0, 0.06, -0.075).cyl(S.steel, 0.0065, 0.008, 0, 0.063, -0.075, { ax: 'y', seg: 8 }).cyl(S.steel, 0.003, 0.006, 0, 0.058, -0.075, { ax: 'y', seg: 6 }).part();
  notch(k, S.dark, 0.0715, 0.03, -0.152, 0.058);
  k.part('mag', 0, -0.05, -0.006).box(S.dark, 0.021, 0.21, 0.034, 0, -0.092, 0.003, -0.264).box(S.poly, 0.027, 0.008, 0.042, 0, -0.196, 0.031, -0.264);
  if (L.glow) k.box(L.glow, 0.0214, 0.05, 0.003, 0, -0.16, 0.005, -0.264);
  k.part();
  if (L.glow) k.box(L.glow, 0.0346, 0.0025, 0.12, 0, 0.022, -0.04);
  return { muzzle: V(0, B, -0.216), sightY: 0.0715, eject: V(0.02, 0.04, -0.07), gripL: V(-0.014, -0.05, -0.02), gripAng: 0.3, eyeZ: 0.31, hold: 'support',
    anim: { reload: 'mag', cycle: 'slide', magDir: V(0, -0.966, 0.258), boltTravel: 0.03, shell: [0.0026, 0.014] } };
} };

// 戰鬥刀：刀尖朝 -Z、刀刃朝下，原點在握柄中段
GUNS.knife = { kind: 'knife', body: [0x2a2c30, 0.1, 0.8], furn: [0x2a2c30, 0.1, 0.8], build(k, L) {
  k.prof(S.chrome, [[-0.058, 0.0145], [-0.168, 0.0145], [-0.204, 0.0085], [-0.24, -0.002], [-0.214, -0.012], [-0.18, -0.0165], [-0.074, -0.0165], [-0.066, -0.011], [-0.058, -0.012]], 0.0046, 0, { b: 0.0021 });   // 刀身
  k.box(L.glow || S.dark, 0.0049, 0.0042, 0.088, 0, 0.0055, -0.118);                                                                                                                                         // 血槽
  k.prof(S.dark, [[-0.05, 0.026], [-0.059, 0.028], [-0.06, -0.026], [-0.05, -0.022]], 0.013, 0, { b: 0.003 });                                                                                              // 護手
  const hp = [[0.062, 0.0118], [0.058, 0.0128]]; for (let i = 0; i < 6; i++) { const z = 0.05 - i * 0.017; hp.push([z, 0.0134], [z - 0.011, 0.0134], [z - 0.013, 0.0118]); } hp.push([-0.05, 0.0126]);
  k.lathe(L.body, hp, 0, 0, { seg: 10, sx: 0.84, sy: 1.14 });                                                                                                                                                // 握柄（一圈一圈的防滑環）
  k.lathe(S.dark, [[0.078, 0], [0.078, 0.01], [0.074, 0.0138], [0.062, 0.0138], [0.062, 0.011]], 0, 0, { seg: 10, sx: 0.84, sy: 1.14 });                                                                      // 柄尾
  return { muzzle: V(0, -0.002, -0.24), sightY: 0, eject: null, gripL: null, gripAng: 0, eyeZ: 0, hold: 'none', anim: { reload: null, cycle: null } };
} };

export const GUN_IDS = Object.keys(GUNS);

export function buildGun(id, wskin = 'stock') {
  const def = GUNS[id] || GUNS.pistol, k = new Kit();
  const u = def.build(k, look(def, wskin)), g = k.bake(), parts = g.userData.parts, rest = {};
  for (const n in parts) rest[n] = { pos: parts[n].position.clone(), rot: parts[n].rotation.clone() };
  if (parts.aim) parts.aim.visible = false;   // 看得穿的鏡片只有第一人稱瞄準時才打開
  const bb = new THREE.Box3().setFromObject(g);
  g.name = 'gun:' + id;
  Object.assign(g.userData, { id: GUNS[id] ? id : 'pistol', wskin, kind: def.kind, hold: 'hold', rest, len: bb.max.z - bb.min.z }, u);
  return g;
}

// ───────── 投擲物（拿在手上、飛在空中都用這個；原點在中心、直立）─────────
function fuze(k, y, r) {   // 引信座＋保險握片＋拉環
  k.cyl(S.steel, 0.0095, 0.02, 0, y + 0.01, 0, { ax: 'y', seg: 8 });
  k.box(S.dark, 0.012, 0.004, 0.022, 0, y + 0.021, 0.004).box(S.dark, 0.011, 0.05, 0.003, 0, y - 0.004, r * 0.72 + 0.006, 0.36);
  k.ring(S.steel, 0.0105, 0.0013, -0.014, y + 0.012, 0, { rs: 3, ts: 8 });
}
const PROPS = {
  he(k) {   // 破片手榴彈：圓球彈體＋黃色識別帶
    k.put(S.olive, new THREE.SphereGeometry(0.031, 10, 7));
    k.put(S.mark, new THREE.SphereGeometry(0.0315, 10, 1, 0, TAU, HP - 0.36, 0.2));
    fuze(k, 0.028, 0.031);
  },
  flash(k) {   // 閃光彈：八角鋼筒，側面開孔，兩端六角蓋
    k.cyl(S.steel, 0.021, 0.084, 0, -0.006, 0, { ax: 'y', seg: 8 });
    for (const y of [0.038, -0.05]) k.cyl(S.dark, 0.0265, 0.008, 0, y, 0, { ax: 'y', seg: 6 });
    for (let i = 0; i < 4; i++) for (const y of [0.014, -0.026]) { const a = Math.PI / 8 + i * HP; k.put(S.hole, G(new THREE.PlaneGeometry(0.01, 0.015), Math.sin(a) * 0.0197, y, Math.cos(a) * 0.0197, 0, a, 0)); }
    fuze(k, 0.042, 0.02);
  },
  smoke(k) {   // 煙霧彈：粗圓筒＋淺色識別帶
    k.cyl(S.tan, 0.03, 0.108, 0, -0.008, 0, { ax: 'y', seg: 10 });
    k.cyl(S.white, 0.0304, 0.016, 0, 0.026, 0, { ax: 'y', seg: 10, open: true });
    for (const y of [0.046, -0.062]) k.cyl(S.dark, 0.0312, 0.005, 0, y, 0, { ax: 'y', seg: 10, open: true });
    fuze(k, 0.046, 0.03);
  },
  molotov(k) {   // 汽油彈：玻璃瓶＋塞在瓶口的布條（點著了）
    k.put(S.amber, latheZ([[0.085, 0], [0.085, 0.012], [0.079, 0.0135], [0.073, 0.011], [0.035, 0.011], [0.008, 0.026], [-0.012, 0.031], [-0.1, 0.031], [-0.112, 0.026], [-0.112, 0]], 10, true).rotateX(-HP));
    k.put(S.rag, latheZ([[-0.03, 0.0316], [-0.072, 0.0316]], 10).rotateX(-HP));
    k.box(S.rag, 0.014, 0.036, 0.012, 0.002, 0.098, 0, 0, 0.4, 0.2).box(S.rag, 0.012, 0.03, 0.006, 0.012, 0.118, 0.003, 0.3, 0.2, -0.7);
    k.put(S.flame, new THREE.ConeGeometry(0.009, 0.03, 6).translate(0.02, 0.142, 0.004));
  },
};
export const PROP_IDS = Object.keys(PROPS);

export function buildProp(id) {
  const k = new Kit(); (PROPS[id] || PROPS.he)(k);
  const g = k.bake(); g.name = 'prop:' + id; g.userData.id = id; g.userData.kind = 'prop';
  return g;
}
