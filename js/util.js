export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const r3 = (v) => Math.round(v * 1000) / 1000;

export function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// 0..1 的決定性雜湊（地圖上色用，兩邊算出來要一樣）
export function hash3(x, y, z) {
  let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// 射線 vs 軸對齊方盒；回傳進入距離 t（>=0），沒打到回 -1
export function rayAABB(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let t0 = 0, t1 = Infinity, a, b;
  if (Math.abs(dx) < 1e-9) { if (ox < x0 || ox > x1) return -1; }
  else { a = (x0 - ox) / dx; b = (x1 - ox) / dx; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return -1; }
  if (Math.abs(dy) < 1e-9) { if (oy < y0 || oy > y1) return -1; }
  else { a = (y0 - oy) / dy; b = (y1 - oy) / dy; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return -1; }
  if (Math.abs(dz) < 1e-9) { if (oz < z0 || oz > z1) return -1; }
  else { a = (z0 - oz) / dz; b = (z1 - oz) / dz; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return -1; }
  return t0;
}

// 玩家受擊判定盒（腳底中心座標）。回傳 {t, head} 或 null
export function rayPlayer(ox, oy, oz, dx, dy, dz, px, py, pz) {
  const th = rayAABB(ox, oy, oz, dx, dy, dz, px - 0.2, py + 1.42, pz - 0.2, px + 0.2, py + 1.82, pz + 0.2);
  const tb = rayAABB(ox, oy, oz, dx, dy, dz, px - 0.33, py, pz - 0.33, px + 0.33, py + 1.42, pz + 0.33);
  if (th < 0 && tb < 0) return null;
  if (th >= 0 && (tb < 0 || th <= tb + 0.05)) return { t: th, head: true };
  return { t: tb, head: false };
}

export function roomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[(Math.random() * A.length) | 0];
  return s;
}

export const store = {
  get(k, d) { try { const v = localStorage.getItem('rubble.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rubble.' + k, JSON.stringify(v)); } catch { /* 無痕模式 */ } },
};
