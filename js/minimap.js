import { BS } from './config.js';
import { BLOCK } from './world.js';

const SEE_MS = 2500, HEAR_MS = 1600;

// 小地圖：整張圖的俯視。自己是箭頭；對手只有「你看得到他」或「他開槍」時才會出現，過幾秒就淡掉。
export class Minimap {
  constructor(canvas, world) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.w = world;
    this.base = document.createElement('canvas'); this.base.width = world.X; this.base.height = world.Z;
    this.bctx = this.base.getContext('2d'); this.img = this.bctx.createImageData(world.X, world.Z);
    this.rev = -1; this.at = 0;
    this.seen = { t: -1e9, x: 0, z: 0 }; this.heard = { t: -1e9, x: 0, z: 0 };
    this.marks = new Map();   // 混戰：每個對手各自的「看到／聽到」（座位號 → { st, sx, sz, ht, hx, hz }）
  }

  reset() { this.seen.t = this.heard.t = -1e9; this.rev = -1; this.marks.clear(); }
  _m(slot) { let m = this.marks.get(slot); if (!m) this.marks.set(slot, (m = { st: -1e9, sx: 0, sz: 0, ht: -1e9, hx: 0, hz: 0 })); return m; }
  // slot 不給 = 1 對 1 的那個對手；混戰帶座位號，顏色看 draw 的 colors
  spot(now, x, z, slot) { if (slot === undefined) { this.seen.t = now; this.seen.x = x; this.seen.z = z; } else { const m = this._m(slot); m.st = now; m.sx = x; m.sz = z; } }
  ping(now, x, z, slot) { if (slot === undefined) { this.heard.t = now; this.heard.x = x; this.heard.z = z; } else { const m = this._m(slot); m.ht = now; m.hx = x; m.hz = z; } }

  // 每一格取「最上面那塊」的顏色，越高越亮
  _rebuild() {
    if (this.base.width !== this.w.X || this.base.height !== this.w.Z) {          // 換到不同大小的地圖
      this.base.width = this.w.X; this.base.height = this.w.Z; this.img = this.bctx.createImageData(this.w.X, this.w.Z);
    }
    const w = this.w, { X, Y, Z, types } = w, d = this.img.data;
    for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
      let y = Y - 1, t = 0;
      for (; y >= 0; y--) { t = types[x + X * (z + Z * y)]; if (t) break; }
      const o = (x + X * z) * 4;
      if (!t) { d[o] = d[o + 1] = d[o + 2] = 0; d[o + 3] = 255; continue; }
      const c = BLOCK[t].color, k = BLOCK[t].hp === Infinity && y > 4 ? 0.5 : 0.62 + 0.5 * (y / Y);
      d[o] = Math.min(255, Math.pow(c[0], 0.45) * 255 * k); d[o + 1] = Math.min(255, Math.pow(c[1], 0.45) * 255 * k); d[o + 2] = Math.min(255, Math.pow(c[2], 0.45) * 255 * k); d[o + 3] = 255;
    }
    this.bctx.putImageData(this.img, 0, 0);
    this.rev = w.rev;
  }

  // s: { px, pz, yaw, alive, pickups: [{x,z,type,on}], smokes: [{x,z,r}], fires: [{x,z,r}], oppColor, meColor,
  //      colors（混戰：座位號 → 顏色）, storm（混戰：毒圈 { x, z, r }） }
  draw(now, s) {
    const w = this.w, c = this.c, g = this.ctx, S = c.width, k = S / (w.X * BS);
    if (this.rev !== w.rev && now - this.at > 400) { this._rebuild(); this.at = now; }
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, S, S);
    g.globalAlpha = 0.92; g.drawImage(this.base, 0, 0, S, S); g.globalAlpha = 1;
    for (const f of s.fires) { g.fillStyle = 'rgba(255,120,30,0.55)'; g.beginPath(); g.arc(f.x * k, f.z * k, f.r * k, 0, 6.283); g.fill(); }
    for (const m of s.smokes) { g.fillStyle = 'rgba(210,215,222,0.6)'; g.beginPath(); g.arc(m.x * k, m.z * k, m.r * k, 0, 6.283); g.fill(); }
    for (const p of s.pickups) {
      if (!p.on) continue;
      g.fillStyle = p.type === 'hp' ? '#54e07a' : '#4aa8ff';
      const x = p.x * k, z = p.z * k;
      if (p.type === 'hp') { g.fillRect(x - 1, z - 3.5, 2, 7); g.fillRect(x - 3.5, z - 1, 7, 2); } else { g.beginPath(); g.moveTo(x, z - 4); g.lineTo(x + 3.5, z - 2); g.lineTo(x + 3.5, z + 1); g.lineTo(x, z + 4); g.lineTo(x - 3.5, z + 1); g.lineTo(x - 3.5, z - 2); g.fill(); }
    }
    // 混戰的毒圈：圈外塗紫色、圈的邊界一條亮線
    if (s.storm && s.storm.r < 1e5) {
      g.fillStyle = 'rgba(120,40,220,0.32)'; g.beginPath(); g.rect(0, 0, S, S); g.arc(s.storm.x * k, s.storm.z * k, s.storm.r * k, 0, 6.283, true); g.fill();
      g.strokeStyle = '#c58cff'; g.lineWidth = 2; g.beginPath(); g.arc(s.storm.x * k, s.storm.z * k, s.storm.r * k, 0, 6.283); g.stroke();
    }
    // 對手：聽到槍聲 = 一圈往外擴的波紋；看到 = 實心點
    for (const [slot, m] of this.marks) {
      const col = (s.colors && s.colors[slot]) || s.oppColor, h = now - m.ht, v = now - m.st;
      if (h < HEAR_MS) { const a = 1 - h / HEAR_MS; g.strokeStyle = col; g.lineWidth = 2; g.globalAlpha = a; g.beginPath(); g.arc(m.hx * k, m.hz * k, 4 + (1 - a) * 9, 0, 6.283); g.stroke(); g.globalAlpha = 1; }
      if (v < SEE_MS) { g.globalAlpha = Math.min(1, 1.3 - v / SEE_MS); g.fillStyle = col; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath(); g.arc(m.sx * k, m.sz * k, 4.2, 0, 6.283); g.fill(); g.stroke(); g.globalAlpha = 1; }
    }
    const ha = now - this.heard.t;
    if (ha < HEAR_MS) {
      const a = 1 - ha / HEAR_MS;
      g.strokeStyle = s.oppColor; g.lineWidth = 2; g.globalAlpha = a;
      g.beginPath(); g.arc(this.heard.x * k, this.heard.z * k, 4 + (1 - a) * 9, 0, 6.283); g.stroke(); g.globalAlpha = 1;
    }
    const sa = now - this.seen.t;
    if (sa < SEE_MS) {
      g.globalAlpha = Math.min(1, 1.3 - sa / SEE_MS);
      g.fillStyle = s.oppColor; g.strokeStyle = '#000'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(this.seen.x * k, this.seen.z * k, 4.2, 0, 6.283); g.fill(); g.stroke(); g.globalAlpha = 1;
    }
    // 機器人模式：據點（金色菱形）、下一波會從哪裡來（紅色箭頭）、每一隻機器人（紅點）、隊友
    if (s.core) {
      const x = s.core[0] * k, z = s.core[2] * k;
      g.fillStyle = '#ffc640'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, z - 6); g.lineTo(x + 6, z); g.lineTo(x, z + 6); g.lineTo(x - 6, z); g.closePath(); g.fill(); g.stroke();
    }
    if (s.gates && s.core) {
      const a = 0.55 + 0.45 * Math.sin(now * 0.008);
      for (const q of s.gates) {
        const x = q[0] * k, z = q[1] * k, ang = Math.atan2(s.core[2] * k - z, s.core[0] * k - x);
        g.save(); g.translate(x, z); g.rotate(ang); g.globalAlpha = a; g.fillStyle = '#ff3a2a'; g.strokeStyle = '#000'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(9, 0); g.lineTo(-5, -6); g.lineTo(-2, 0); g.lineTo(-5, 6); g.closePath(); g.fill(); g.stroke(); g.restore();
      }
      g.globalAlpha = 1;
    }
    if (s.mobs) {
      g.fillStyle = '#ff3a2a'; g.strokeStyle = '#000'; g.lineWidth = 1;
      for (const m of s.mobs) { g.beginPath(); g.arc(m.x * k, m.z * k, m.big ? 5 : 2.8, 0, 6.283); g.fill(); g.stroke(); }
    }
    if (s.ally) { g.fillStyle = s.oppColor; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath(); g.arc(s.ally.x * k, s.ally.z * k, 4, 0, 6.283); g.fill(); g.stroke(); }
    if (s.alive) {
      g.save(); g.translate(s.px * k, s.pz * k); g.rotate(-s.yaw);
      g.fillStyle = 'rgba(255,255,255,0.13)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 34, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62); g.fill();   // 視野扇形
      g.fillStyle = s.meColor; g.strokeStyle = '#000'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5.5); g.lineTo(0, 2.5); g.lineTo(-5, 5.5); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
  }
}
