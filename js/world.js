import * as THREE from 'three';
import { BS, WORLD, CHUNK } from './config.js';
import { hash3 } from './util.js';
import { MAPS } from './maps.js';

export const B = { AIR: 0, BEDROCK: 1, GROUND: 2, CONCRETE: 3, BRICK: 4, WOOD: 5, METAL: 6, WALL: 7, CONT_R: 8, CONT_B: 9, CONT_Y: 10, SAND: 11, SANDGROUND: 12, PLASTER: 13, ROCK: 14 };

// hp = 要打多少傷害才會碎；Infinity = 打不壞
export const BLOCK = [
  null,
  { name: '基岩', hp: Infinity, color: [0.11, 0.12, 0.15] },
  { name: '地面', hp: 160, color: [0.21, 0.22, 0.21] },
  { name: '水泥', hp: 200, color: [0.50, 0.52, 0.55] },
  { name: '磚牆', hp: 110, color: [0.52, 0.17, 0.11] },
  { name: '木板', hp: 55, color: [0.60, 0.40, 0.19] },
  { name: '鋼板', hp: 380, color: [0.17, 0.26, 0.36] },
  { name: '圍牆', hp: Infinity, color: [0.13, 0.15, 0.20] },
  { name: '紅貨櫃', hp: 300, color: [0.50, 0.10, 0.07] },
  { name: '藍貨櫃', hp: 300, color: [0.07, 0.20, 0.44] },
  { name: '黃貨櫃', hp: 300, color: [0.58, 0.40, 0.05] },
  { name: '砂岩牆', hp: 130, color: [0.60, 0.47, 0.30] },
  { name: '沙地', hp: 160, color: [0.47, 0.40, 0.27] },
  { name: '灰泥牆', hp: 100, color: [0.70, 0.67, 0.60] },
  { name: '岩石', hp: 220, color: [0.33, 0.30, 0.27] },
];

const AO = [0.5, 0.66, 0.83, 1.0];
// 每個面：法線 n、兩個切線 u,v（u × v = n，確保頂點逆時針）
const FACES = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];

export class World {
  constructor(scene) {
    this.X = WORLD.X; this.Y = WORLD.Y; this.Z = WORLD.Z;
    const n = this.X * this.Y * this.Z;
    this.types = new Uint8Array(n);
    this.hp = new Float32Array(n);
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.group = new THREE.Group();
    scene.add(this.group);
    this.ncx = Math.ceil(this.X / CHUNK); this.ncy = Math.ceil(this.Y / CHUNK); this.ncz = Math.ceil(this.Z / CHUNK);
    this.chunks = [];
    for (let cy = 0; cy < this.ncy; cy++) for (let cz = 0; cz < this.ncz; cz++) for (let cx = 0; cx < this.ncx; cx++) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.visible = false;
      this.group.add(mesh);
      this.chunks.push({ cx, cy, cz, mesh });
    }
    this.dirty = new Set();
    this.rev = 0;        // 地形每變一次就 +1（尋路用來判斷要不要重算）
    this.mapId = 'plaza';
    this.reset();
  }

  // ───────── 基本存取 ─────────
  idx(x, y, z) { return x + this.X * (z + this.Z * y); }
  inb(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.X && y < this.Y && z < this.Z; }
  get(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (x < 0 || z < 0 || x >= this.X || z >= this.Z) return B.WALL; // 地圖外視為看不見的牆（多高都出不去）
    if (y >= this.Y) return B.AIR;
    return this.types[x + this.X * (z + this.Z * y)];
  }
  set(x, y, z, t) {
    if (!this.inb(x, y, z)) return;
    const i = this.idx(x, y, z);
    this.types[i] = t;
    this.hp[i] = t && BLOCK[t].hp !== Infinity ? BLOCK[t].hp : 0;
  }
  box(x0, y0, z0, x1, y1, z1, t) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, t);
  }
  // 放一塊，同時放它繞地圖中心轉 180° 的鏡像，確保兩邊公平
  boxSym(x0, y0, z0, x1, y1, z1, t) {
    this.box(x0, y0, z0, x1, y1, z1, t);
    this.box(this.X - 1 - x1, y0, this.Z - 1 - z1, this.X - 1 - x0, y1, this.Z - 1 - z0, t);
  }

  // 鏡像版：以 z 中線對折（三線地圖用）
  boxMir(x0, y0, z0, x1, y1, z1, t) {
    this.box(x0, y0, z0, x1, y1, z1, t);
    this.box(x0, y0, this.Z - 1 - z1, x1, y1, this.Z - 1 - z0, t);
  }

  reset(mapId) {
    if (mapId && MAPS[mapId]) this.mapId = mapId;
    this.types.fill(0); this.hp.fill(0); this.rev++;
    MAPS[this.mapId].build(this);
    for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i);
    this.update();
  }

  // ───────── 破壞 ─────────
  _stage(i, t) { const f = this.hp[i] / BLOCK[t].hp; return f > 0.67 ? 0 : f > 0.34 ? 1 : 2; }

  // 回傳 null（沒東西）或 { destroyed, type }
  damage(x, y, z, dmg) {
    if (!this.inb(x, y, z)) return null;
    const i = this.idx(x, y, z);
    const t = this.types[i];
    if (!t) return null;
    if (BLOCK[t].hp === Infinity) return { destroyed: false, type: t };
    const before = this._stage(i, t);
    this.hp[i] -= dmg;
    if (this.hp[i] <= 0) {
      this.types[i] = 0; this.hp[i] = 0; this.rev++;
      this._mark(x, y, z, true);
      return { destroyed: true, type: t };
    }
    if (this._stage(i, t) !== before) this._mark(x, y, z, false);
    return { destroyed: false, type: t };
  }
  damageIdx(i, dmg) {
    const x = i % this.X; const r = (i - x) / this.X; const z = r % this.Z; const y = (r - z) / this.Z;
    const res = this.damage(x, y, z, dmg);
    if (res) { res.x = x; res.y = y; res.z = z; }
    return res;
  }

  // 球形爆炸：越靠近中心傷害越高。回傳被炸掉的方塊（給特效用）
  explode(cx, cy, cz, radius, power) {
    const out = [];
    const r = Math.ceil(radius / BS);
    const bx = Math.floor(cx / BS), by = Math.floor(cy / BS), bz = Math.floor(cz / BS);
    for (let y = by - r; y <= by + r; y++) for (let z = bz - r; z <= bz + r; z++) for (let x = bx - r; x <= bx + r; x++) {
      if (!this.inb(x, y, z)) continue;
      const dx = (x + 0.5) * BS - cx, dy = (y + 0.5) * BS - cy, dz = (z + 0.5) * BS - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d >= radius) continue;
      const res = this.damage(x, y, z, power * (1 - d / radius));
      if (res && res.destroyed) out.push({ x, y, z, type: res.type });
    }
    return out;
  }

  _mark(x, y, z, neighbors) {
    if (!neighbors) { this._markCell(x, y, z); return; }
    // 環境光遮蔽會看斜對角，所以邊界上的方塊要連鄰近區塊一起重建
    for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this._markCell(x + dx, y + dy, z + dz);
  }
  _markCell(x, y, z) {
    if (!this.inb(x, y, z)) return;
    this.dirty.add(((x / CHUNK) | 0) + this.ncx * (((z / CHUNK) | 0) + this.ncz * ((y / CHUNK) | 0)));
  }

  update() {
    if (!this.dirty.size) return;
    for (const ci of this.dirty) this._buildChunk(this.chunks[ci]);
    this.dirty.clear();
  }

  // ───────── 網格 ─────────
  _buildChunk(c) {
    const pos = [], nor = [], col = [], ind = [];
    const x0 = c.cx * CHUNK, y0 = c.cy * CHUNK, z0 = c.cz * CHUNK;
    const x1 = Math.min(x0 + CHUNK, this.X), y1 = Math.min(y0 + CHUNK, this.Y), z1 = Math.min(z0 + CHUNK, this.Z);
    const aos = [0, 0, 0, 0];
    for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const i = this.idx(x, y, z);
      const t = this.types[i];
      if (!t) continue;
      const def = BLOCK[t];
      let k = 0.88 + 0.24 * hash3(x, y, z);
      if (t === B.BRICK) k *= (y & 1) ? 0.84 : 1;
      else if (t === B.WOOD) k *= ((x + z) & 1) ? 0.9 : 1;
      else if (t === B.GROUND) k *= 0.9 + 0.2 * hash3(x >> 2, 7, z >> 2);
      else if (t === B.WALL) k *= (y % 4 === 0) ? 0.8 : 1;
      else if (t === B.METAL) k *= ((x >> 1) + (z >> 1)) & 1 ? 0.92 : 1;
      else if (t >= B.CONT_R && t <= B.CONT_Y) k = (0.94 + 0.12 * hash3(x, y, z)) * (((x + z) & 1) ? 0.86 : 1); // 貨櫃的波浪板
      else if (t === B.SAND) k *= (y % 3 === 0) ? 0.88 : 1;
      else if (t === B.SANDGROUND) k *= 0.9 + 0.2 * hash3(x >> 2, 7, z >> 2);
      else if (t === B.ROCK) k *= (0.86 + 0.28 * hash3(x >> 1, y >> 1, z >> 1)) * (1 - 0.012 * (12 - Math.min(12, y))); // 岩層：大塊色斑、越深越暗
      if (def.hp !== Infinity) { const st = this._stage(i, t); if (st) k *= st === 1 ? 0.78 : 0.58; }
      const cr = def.color[0] * k, cg = def.color[1] * k, cb = def.color[2] * k;

      for (let f = 0; f < 6; f++) {
        const F = FACES[f], n = F.n, u = F.u, v = F.v;
        const nx = x + n[0], ny = y + n[1], nz = z + n[2];
        if (this.get(nx, ny, nz)) continue;
        const base = pos.length / 3;
        const bx = x + (n[0] > 0 ? 1 : 0), by = y + (n[1] > 0 ? 1 : 0), bz = z + (n[2] > 0 ? 1 : 0);
        for (let vi = 0; vi < 4; vi++) {
          const a = vi === 1 || vi === 2 ? 1 : 0, b = vi >= 2 ? 1 : 0;
          const sa = a ? 1 : -1, sb = b ? 1 : -1;
          const s1 = this.get(nx + sa * u[0], ny + sa * u[1], nz + sa * u[2]) ? 1 : 0;
          const s2 = this.get(nx + sb * v[0], ny + sb * v[1], nz + sb * v[2]) ? 1 : 0;
          const cn = this.get(nx + sa * u[0] + sb * v[0], ny + sa * u[1] + sb * v[1], nz + sa * u[2] + sb * v[2]) ? 1 : 0;
          const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + cn);
          aos[vi] = ao;
          const m = AO[ao];
          pos.push((bx + a * u[0] + b * v[0]) * BS, (by + a * u[1] + b * v[1]) * BS, (bz + a * u[2] + b * v[2]) * BS);
          nor.push(n[0], n[1], n[2]);
          col.push(cr * m, cg * m, cb * m);
        }
        if (aos[0] + aos[2] >= aos[1] + aos[3]) ind.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else ind.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
      }
    }
    c.mesh.geometry.dispose();
    if (!ind.length) { c.mesh.geometry = new THREE.BufferGeometry(); c.mesh.visible = false; return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(ind);
    g.computeBoundingSphere();
    c.mesh.geometry = g;
    c.mesh.visible = true;
  }

  // ───────── 碰撞與射線 ─────────
  boxSolid(x0, y0, z0, x1, y1, z1) {
    const ax = Math.floor(x0 / BS), ay = Math.floor(y0 / BS), az = Math.floor(z0 / BS);
    const bx = Math.floor((x1 - 1e-6) / BS), by = Math.floor((y1 - 1e-6) / BS), bz = Math.floor((z1 - 1e-6) / BS);
    for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) if (this.get(x, y, z)) return true;
    return false;
  }

  // 體素 DDA。回傳 null 或 { x,y,z, nx,ny,nz, dist, type, oob }
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    if (!(dx || dy || dz)) return null;
    let x = Math.floor(ox / BS), y = Math.floor(oy / BS), z = Math.floor(oz / BS);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(BS / dx) : Infinity, tdy = dy !== 0 ? Math.abs(BS / dy) : Infinity, tdz = dz !== 0 ? Math.abs(BS / dz) : Infinity;
    let tx = dx !== 0 ? (dx > 0 ? (x + 1) * BS - ox : ox - x * BS) / Math.abs(dx) : Infinity;
    let ty = dy !== 0 ? (dy > 0 ? (y + 1) * BS - oy : oy - y * BS) / Math.abs(dy) : Infinity;
    let tz = dz !== 0 ? (dz > 0 ? (z + 1) * BS - oz : oz - z * BS) / Math.abs(dz) : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    let b = this.get(x, y, z);
    if (b) return { x, y, z, nx: -dx, ny: -dy, nz: -dz, dist: 0, type: b, oob: !this.inb(x, y, z) };
    for (let guard = 0; guard < 2000; guard++) {
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (ty < tz) { y += sy; t = ty; ty += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tz; tz += tdz; nx = 0; ny = 0; nz = -sz; }
      if (t > maxDist) return null;
      if (y >= this.Y && dy >= 0) return null;
      b = this.get(x, y, z);
      if (b) return { x, y, z, nx, ny, nz, dist: t, type: b, oob: !this.inb(x, y, z) };
    }
    return null;
  }
}
