import * as THREE from 'three';
import { BS } from './config.js';

// 天光：每一格空氣「看得到多少天空」（0..15）。
// 頭上沒東西的格子 = 15，往旁邊、往屋簷底下每走一格少 1 → 室內、隧道、地下道自然就比較暗。
// 算好的結果放進一張 3D 貼圖給著色器查，所以牆被打破時不用重建網格，光就會跟著漏進去。
export class SkyLight {
  constructor(world) {
    this.w = world;
    const { X, Y, Z } = world, n = X * Y * Z;
    this.L = new Uint8Array(n); this.q = new Int32Array(n);
    // 方塊索引是 x + X*(z + Z*y) → 貼圖的三個軸依序是 x、z、y
    const t = this.tex = new THREE.Data3DTexture(this.L, X, Z, Y);
    t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1;
    this.rev = -1; this.at = 0;
    this.size = new THREE.Vector3(X * BS, Z * BS, Y * BS);
  }

  // 地形有變才重算，而且至少隔 120 毫秒（連續掃射打掉一排方塊時不會每幀都算）
  update(now) {
    if (this.rev === this.w.rev || now - this.at < 120) return;
    this.recompute(); this.at = now;
  }

  recompute() {
    const w = this.w, { X, Y, Z, types } = w, L = this.L, q = this.q, XZ = X * Z;
    let head = 0, tail = 0;
    L.fill(0);
    for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
      for (let y = Y - 1, i = x + X * (z + Z * y); y >= 0; y--, i -= XZ) { if (types[i]) break; L[i] = 15; q[tail++] = i; }
    }
    while (head < tail) {
      const i = q[head++], l = L[i] - 1;
      if (l <= 0) continue;
      const x = i % X, r = (i - x) / X, z = r % Z, y = (r - z) / Z;
      let j;
      if (x > 0 && !types[j = i - 1] && L[j] < l) { L[j] = l; q[tail++] = j; }
      if (x < X - 1 && !types[j = i + 1] && L[j] < l) { L[j] = l; q[tail++] = j; }
      if (z > 0 && !types[j = i - X] && L[j] < l) { L[j] = l; q[tail++] = j; }
      if (z < Z - 1 && !types[j = i + X] && L[j] < l) { L[j] = l; q[tail++] = j; }
      if (y > 0 && !types[j = i - XZ] && L[j] < l) { L[j] = l; q[tail++] = j; }
      if (y < Y - 1 && !types[j = i + XZ] && L[j] < l) { L[j] = l; q[tail++] = j; }
    }
    this.rev = w.rev; this.tex.needsUpdate = true;
  }

  // 某個位置（公尺）的天光 0..1，給槍、角色這些不是方塊的東西用
  at3(x, y, z) {
    const w = this.w, bx = Math.floor(x / BS), by = Math.floor(y / BS), bz = Math.floor(z / BS);
    if (by >= w.Y) return 1;
    if (bx < 0 || bz < 0 || by < 0 || bx >= w.X || bz >= w.Z) return 0;
    return this.L[bx + w.X * (bz + w.Z * by)] / 15;
  }
}
