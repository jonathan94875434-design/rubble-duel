import { BS } from './config.js';

// 尋路：讓電腦對手知道怎麼繞過牆、上樓梯、跳箱子，而不是直直撞牆。
//
// 節點放在方塊的「格線交點」上：站在交點時身體（寬 0.6m）剛好佔 2×2 個方塊，判斷最單純。
// 每個交點記一個 32 位元的遮罩，第 y 個位元 = 這 2×2 範圍在高度 y 有沒有方塊。
// 「可站立」= 腳下有東西、往上 4 格（2m）是空的。
// 相鄰節點之間能走的方式：平走、上一階（自動踏步）、跳上兩階（1m）、往下跳。
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class Nav {
  constructor(world) {
    this.w = world; this.X = world.X; this.Z = world.Z;
    this.NX = this.X + 1; this.NZ = this.Z + 1;
    this.col = new Uint32Array(this.X * this.Z);
    this.mask = new Uint32Array(this.NX * this.NZ);
    const n = this.NX * this.NZ * 32;
    this.g = new Float32Array(n); this.f = new Float32Array(n);
    this.from = new Int32Array(n); this.stamp = new Uint32Array(n); this.done = new Uint32Array(n);
    this.gen = 0; this.rev = -1; this.heap = [];
  }

  // 地形有變才重算遮罩（整張圖約 1ms）
  refresh() {
    if (this.rev === this.w.rev) return;
    this.rev = this.w.rev;
    const { X, Z } = this, Y = this.w.Y, t = this.w.types, col = this.col, mask = this.mask;
    col.fill(0);
    for (let y = 0; y < Y; y++) {
      const bit = (1 << y) >>> 0, base = X * Z * y;
      for (let i = 0, n = X * Z; i < n; i++) if (t[base + i]) col[i] |= bit;
    }
    mask.fill(0xFFFFFFFF);
    for (let k = 1; k < Z; k++) for (let i = 1; i < X; i++) {
      mask[i + this.NX * k] = (col[i - 1 + X * (k - 1)] | col[i + X * (k - 1)] | col[i - 1 + X * k] | col[i + X * k]) >>> 0;
    }
  }

  _stand(m, y) { return y >= 1 && y <= 27 && ((m >>> (y - 1)) & 1) === 1 && ((m >>> y) & 15) === 0; }
  _id(i, k, y) { return (i + this.NX * k) * 32 + y; }

  // 離某個位置最近的可站立節點；找不到回 -1
  nearest(x, y, z) {
    const i0 = Math.round(x / BS), k0 = Math.round(z / BS), y0 = Math.round(y / BS);
    let best = -1, bd = 1e9;
    for (let dk = -2; dk <= 2; dk++) for (let di = -2; di <= 2; di++) {
      const i = i0 + di, k = k0 + dk;
      if (i < 1 || k < 1 || i >= this.X || k >= this.Z) continue;
      const m = this.mask[i + this.NX * k];
      for (let dy = 1; dy >= -8; dy--) {
        const yy = y0 + dy;
        if (!this._stand(m, yy)) continue;
        const d = di * di + dk * dk + Math.abs(dy) * (dy > 0 ? 3 : 0.4);
        if (d < bd) { bd = d; best = this._id(i, k, yy); }
        break;
      }
    }
    return best;
  }

  // A*。回傳路徑點陣列 [{x,y,z}]（公尺，含起點與終點），走不到回 null
  find(start, goal, maxExpand = 40000) {
    if (start < 0 || goal < 0) return null;
    const { NX, mask, g, f, from, stamp, done } = this;
    const gen = ++this.gen, heap = this.heap;
    heap.length = 0;
    const gi = ((goal / 32) | 0) % NX, gk = (((goal / 32) | 0) / NX) | 0, gy = goal % 32;
    const h = (i, k, y) => { const a = Math.abs(i - gi), b = Math.abs(k - gk); return Math.max(a, b) + 0.414 * Math.min(a, b) + 0.5 * Math.abs(y - gy); };
    const push = (id, cost, parent, i, k, y) => {
      if (stamp[id] === gen && g[id] <= cost) return;
      stamp[id] = gen; g[id] = cost; from[id] = parent; f[id] = cost + h(i, k, y);
      let c = heap.length; heap.push(id);
      while (c > 0) { const p = (c - 1) >> 1; if (f[heap[p]] <= f[heap[c]]) break; const t = heap[p]; heap[p] = heap[c]; heap[c] = t; c = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last; let c = 0;
        for (;;) {
          const l = c * 2 + 1, r = l + 1; let s = c;
          if (l < heap.length && f[heap[l]] < f[heap[s]]) s = l;
          if (r < heap.length && f[heap[r]] < f[heap[s]]) s = r;
          if (s === c) break;
          const t = heap[s]; heap[s] = heap[c]; heap[c] = t; c = s;
        }
      }
      return top;
    };
    const si = ((start / 32) | 0) % NX, sk = (((start / 32) | 0) / NX) | 0;
    push(start, 0, -1, si, sk, start % 32);

    let found = false;
    for (let n = 0; n < maxExpand && heap.length; n++) {
      const id = pop();
      if (done[id] === gen) continue;
      done[id] = gen;
      if (id === goal) { found = true; break; }
      const c = (id / 32) | 0, y = id % 32, i = c % NX, k = (c / NX) | 0, m = mask[c], cost = g[id];
      for (let d = 0; d < 8; d++) {
        const di = DIRS[d][0], dk = DIRS[d][1], ni = i + di, nk = k + dk;
        if (ni < 1 || nk < 1 || ni >= this.X || nk >= this.Z) continue;
        const nm = mask[ni + NX * nk], diag = d >= 4, step = diag ? 1.414 : 1;
        if (diag) { // 斜走不能切牆角：兩個直角方向都要能走
          const a = mask[ni + NX * k], b = mask[i + NX * nk];
          if (!(this._stand(a, y) || this._stand(a, y - 1)) || !(this._stand(b, y) || this._stand(b, y - 1))) continue;
        }
        if (this._stand(nm, y)) { push(this._id(ni, nk, y), cost + step, id, ni, nk, y); continue; }
        if (this._stand(nm, y - 1)) { push(this._id(ni, nk, y - 1), cost + step, id, ni, nk, y - 1); continue; }
        if (this._stand(nm, y + 1) && ((m >>> (y + 4)) & 1) === 0) { push(this._id(ni, nk, y + 1), cost + step + 0.2, id, ni, nk, y + 1); continue; }
        if (diag) continue;
        if (this._stand(nm, y + 2) && ((m >>> y) & 63) === 0) { push(this._id(ni, nk, y + 2), cost + step + 1.5, id, ni, nk, y + 2); continue; } // 跳 1m
        for (let yy = y - 2; yy >= 1; yy--) { // 往下跳：對面那格從落點到現在的頭頂都要是空的
          if (!this._stand(nm, yy)) continue;
          const span = y + 4 - yy, bits = span >= 32 ? 0xFFFFFFFF : ((1 << span) - 1) >>> 0;
          if (((nm >>> yy) & bits) === 0) push(this._id(ni, nk, yy), cost + step + 0.4 + 0.05 * (y - yy), id, ni, nk, yy);
          break;
        }
      }
    }
    if (!found) return null;
    const out = [];
    for (let id = goal; id >= 0; id = from[id]) {
      const c = (id / 32) | 0;
      out.push({ x: (c % NX) * BS, y: (id % 32) * BS, z: ((c / NX) | 0) * BS });
    }
    return out.reverse();
  }

  // 方便呼叫：從座標到座標
  path(ax, ay, az, bx, by, bz) {
    this.refresh();
    return this.find(this.nearest(ax, ay, az), this.nearest(bx, by, bz));
  }
}
