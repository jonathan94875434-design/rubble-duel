import * as THREE from 'three';
import { BS, WORLD, CHUNK } from './config.js';
import { MAPS } from './maps.js';
import { TEX } from './textures.js';
import { SkyLight } from './light.js';

export const B = {
  AIR: 0, BEDROCK: 1, GROUND: 2, CONCRETE: 3, BRICK: 4, WOOD: 5, METAL: 6, WALL: 7, CONT_R: 8, CONT_B: 9, CONT_Y: 10, SAND: 11, SANDGROUND: 12, PLASTER: 13, ROCK: 14,
  GRASS: 15, TILE: 16, SHEET: 17, SANDBAG: 18, DIRT: 19,
};

// hp    要打多少傷害才會碎；Infinity = 打不壞
// color 碎屑、小地圖用的代表色
// tex   [側面, 頂面] 用哪一層材質（只寫一個 = 六面都一樣）
// tint  整塊再乘上的顏色（貨櫃的紅藍黃）
// surf  踩上去、子彈打到的聲音種類
// pen   子彈穿過一格要消耗多少「穿透力」（越硬越厚的材料越大；Infinity = 完全打不穿）
// burn  會被燃燒瓶燒掉
export const BLOCK = [
  null,
  { name: '基岩', hp: Infinity, color: [0.12, 0.11, 0.10], tex: [TEX.BEDROCK], surf: 'rock', pen: Infinity },
  { name: '柏油地面', hp: 160, color: [0.16, 0.16, 0.16], tex: [TEX.DIRT, TEX.ASPHALT], surf: 'concrete', pen: 45 },
  { name: '水泥', hp: 200, color: [0.47, 0.47, 0.45], tex: [TEX.CONCRETE], surf: 'concrete', pen: 40 },
  { name: '磚牆', hp: 110, color: [0.45, 0.20, 0.13], tex: [TEX.BRICK], surf: 'concrete', pen: 26 },
  { name: '木板', hp: 55, color: [0.44, 0.29, 0.15], tex: [TEX.WOOD], surf: 'wood', pen: 10, burn: true },
  { name: '鋼板', hp: 380, color: [0.33, 0.34, 0.36], tex: [TEX.METAL], surf: 'metal', pen: 75 },
  { name: '圍牆', hp: Infinity, color: [0.18, 0.19, 0.21], tex: [TEX.WALL, TEX.CONCRETE], surf: 'concrete', pen: Infinity },
  { name: '紅貨櫃', hp: 300, color: [0.62, 0.12, 0.09], tex: [TEX.CONT, TEX.CONTTOP], tint: [0.78, 0.13, 0.10], surf: 'metal', pen: 24 },
  { name: '藍貨櫃', hp: 300, color: [0.10, 0.26, 0.56], tex: [TEX.CONT, TEX.CONTTOP], tint: [0.11, 0.30, 0.66], surf: 'metal', pen: 24 },
  { name: '黃貨櫃', hp: 300, color: [0.72, 0.52, 0.08], tex: [TEX.CONT, TEX.CONTTOP], tint: [0.86, 0.60, 0.08], surf: 'metal', pen: 24 },
  { name: '砂岩牆', hp: 130, color: [0.60, 0.49, 0.33], tex: [TEX.SANDSTONE], surf: 'rock', pen: 30 },
  { name: '沙地', hp: 160, color: [0.64, 0.53, 0.36], tex: [TEX.SAND], surf: 'sand', pen: 45 },
  { name: '灰泥牆', hp: 100, color: [0.68, 0.64, 0.57], tex: [TEX.PLASTER], surf: 'concrete', pen: 22 },
  { name: '岩石', hp: 220, color: [0.33, 0.30, 0.27], tex: [TEX.ROCK], surf: 'rock', pen: 55 },
  { name: '草地', hp: 160, color: [0.20, 0.30, 0.09], tex: [TEX.DIRT, TEX.GRASS], surf: 'dirt', pen: 45 },
  { name: '地磚', hp: 180, color: [0.44, 0.44, 0.42], tex: [TEX.TILE], surf: 'concrete', pen: 34 },
  { name: '鐵皮浪板', hp: 70, color: [0.42, 0.32, 0.24], tex: [TEX.SHEET], surf: 'metal', pen: 6 },
  { name: '沙包', hp: 260, color: [0.46, 0.41, 0.29], tex: [TEX.SANDBAG], surf: 'sand', pen: 60 },
  { name: '泥土', hp: 150, color: [0.30, 0.21, 0.13], tex: [TEX.DIRT], surf: 'dirt', pen: 45 },
];
export const BLOCK_IDS = BLOCK.map((b, i) => i).filter((i) => i > 0);

const AO = [0.45, 0.62, 0.8, 1.0];
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
    this.light = new SkyLight(this);
    // 著色器要用的共用參數：材質貼圖（之後由 setTextures 塞進來）、天光、室內最低亮度
    this.U = { tAlb: { value: null }, tNrm: { value: null }, tSky: { value: this.light.tex }, uSkyMin: { value: 0.22 }, uWorld: { value: this.light.size } };
    this.material = this._mkMaterial();
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

  // 直接載入整張圖的方塊（自製地圖用）
  loadRaw(types) {
    this.types.set(types);
    for (let i = 0; i < this.types.length; i++) { const t = this.types[i]; this.hp[i] = t && BLOCK[t] && BLOCK[t].hp !== Infinity ? BLOCK[t].hp : 0; }
  }
  // 編輯器改一格：馬上重建那一塊的網格
  edit(x, y, z, t) {
    if (!this.inb(x, y, z) || this.types[this.idx(x, y, z)] === t) return false;
    this.set(x, y, z, t); this.rev++; this._mark(x, y, z, true);
    return true;
  }
  rebuildAll() { this.rev++; for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i); this.light.recompute(); this.update(); }

  reset(mapId) {
    if (mapId && MAPS[mapId]) this.mapId = mapId;
    this.types.fill(0); this.hp.fill(0); this.rev++;
    MAPS[this.mapId].build(this);
    for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i);
    this.light.recompute();
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

  // ───────── 材質 ─────────
  setTextures(tex) { this.U.tAlb.value = tex.albedo; this.U.tNrm.value = tex.normal; }

  // 標準的 PBR 材質，再把幾段著色器換掉：
  //   貼圖 → 用世界座標去查陣列貼圖（每個面依法線方向選兩個軸當 UV）
  //   法線 → 貼圖裡的凹凸轉到世界座標
  //   環境光 → 乘上天光（室內比較暗）和轉角的遮蔽
  _mkMaterial() {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aux;\nvarying vec3 vAux;\nvarying vec3 vWp;\nvarying vec3 vWn;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAux = aux; vWp = position; vWn = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2DArray tAlb; uniform sampler2DArray tNrm; uniform highp sampler3D tSky; uniform float uSkyMin; uniform vec3 uWorld;
varying vec3 vAux; varying vec3 vWp; varying vec3 vWn;
vec4 gTexN; float gSky;
float wh31(vec3 p) { p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float wvn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(wh31(i), wh31(i + vec3(1., 0., 0.)), f.x), mix(wh31(i + vec3(0., 1., 0.)), wh31(i + vec3(1., 1., 0.)), f.x), f.y),
             mix(mix(wh31(i + vec3(0., 0., 1.)), wh31(i + vec3(1., 0., 1.)), f.x), mix(wh31(i + vec3(0., 1., 1.)), wh31(i + vec3(1., 1., 1.)), f.x), f.y), f.z); }`)
        .replace('#include <map_fragment>', `
vec3 wan = abs(vWn);
vec2 tuv = (wan.y > .5 ? vWp.xz : (wan.x > .5 ? vWp.zy : vWp.xy)) * .5;
float lay = floor(vAux.x + .5);
vec3 alb = texture(tAlb, vec3(tuv, lay)).rgb;
gTexN = texture(tNrm, vec3(tuv, lay));
alb *= .86 + .28 * wvn(vWp * .23) ;                                   // 大範圍的深淺變化，蓋掉貼圖每 2 公尺重複一次的感覺
if (vAux.y > .25) {                                                    // 被打傷：疊裂痕、整塊變暗
  vec2 ck = texture(tAlb, vec3(tuv * 2., ${TEX.CRACK}.)).rg;
  alb *= (1. - .75 * (vAux.y > .75 ? ck.g : ck.r)) * (vAux.y > .75 ? .78 : .9);
}
diffuseColor.rgb *= alb;
gSky = texture(tSky, (vWp + vWn * .3).xzy / uWorld).r * 17.;`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * gTexN.b;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = gTexN.a;')
        .replace('#include <normal_fragment_maps>', `
vec3 tT = wan.y > .5 ? vec3(1., 0., 0.) : (wan.x > .5 ? vec3(0., 0., 1.) : vec3(1., 0., 0.));
vec3 tB = wan.y > .5 ? vec3(0., 0., 1.) : vec3(0., 1., 0.);
vec2 nxy = gTexN.rg * 2. - 1.;
normal = normalize((viewMatrix * vec4(normalize(tT * nxy.x + tB * nxy.y + vWn * sqrt(max(0., 1. - dot(nxy, nxy)))), 0.)).xyz);`)
        .replace('#include <aomap_fragment>', `
float skyV = mix(uSkyMin, 1., gSky * gSky);
reflectedLight.indirectDiffuse *= vAux.z * skyV;
reflectedLight.indirectSpecular *= vAux.z * skyV;
reflectedLight.directDiffuse *= mix(1., vAux.z, .35);`);
    };
    return m;
  }

  // ───────── 網格 ─────────
  _buildChunk(c) {
    const pos = [], nor = [], col = [], aux = [], ind = [];
    const x0 = c.cx * CHUNK, y0 = c.cy * CHUNK, z0 = c.cz * CHUNK;
    const x1 = Math.min(x0 + CHUNK, this.X), y1 = Math.min(y0 + CHUNK, this.Y), z1 = Math.min(z0 + CHUNK, this.Z);
    const aos = [0, 0, 0, 0];
    for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const i = this.idx(x, y, z);
      const t = this.types[i];
      if (!t) continue;
      const def = BLOCK[t], tint = def.tint, cr = tint ? tint[0] : 1, cg = tint ? tint[1] : 1, cb = tint ? tint[2] : 1;
      const side = def.tex[0], top = def.tex.length > 1 ? def.tex[1] : side;
      const dmg = def.hp !== Infinity ? this._stage(i, t) * 0.5 : 0;

      for (let f = 0; f < 6; f++) {
        const F = FACES[f], n = F.n, u = F.u, v = F.v;
        const nx = x + n[0], ny = y + n[1], nz = z + n[2];
        if (this.get(nx, ny, nz)) continue;
        const base = pos.length / 3, layer = f === 2 ? top : side;
        const bx = x + (n[0] > 0 ? 1 : 0), by = y + (n[1] > 0 ? 1 : 0), bz = z + (n[2] > 0 ? 1 : 0);
        for (let vi = 0; vi < 4; vi++) {
          const a = vi === 1 || vi === 2 ? 1 : 0, b = vi >= 2 ? 1 : 0;
          const sa = a ? 1 : -1, sb = b ? 1 : -1;
          const s1 = this.get(nx + sa * u[0], ny + sa * u[1], nz + sa * u[2]) ? 1 : 0;
          const s2 = this.get(nx + sb * v[0], ny + sb * v[1], nz + sb * v[2]) ? 1 : 0;
          const cn = this.get(nx + sa * u[0] + sb * v[0], ny + sa * u[1] + sb * v[1], nz + sa * u[2] + sb * v[2]) ? 1 : 0;
          const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + cn);
          aos[vi] = ao;
          pos.push((bx + a * u[0] + b * v[0]) * BS, (by + a * u[1] + b * v[1]) * BS, (bz + a * u[2] + b * v[2]) * BS);
          nor.push(n[0], n[1], n[2]);
          col.push(cr, cg, cb);
          aux.push(layer, dmg, AO[ao]);
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
    g.setAttribute('aux', new THREE.Float32BufferAttribute(aux, 3));
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

  // 子彈一路穿過去：power = 穿透力，每進一格實心方塊扣掉那種材料的 pen，不夠扣就停在那一格。
  // 回傳 { end: 停下來的距離, hits: [{ x,y,z, nx,ny,nz, dist, type, left: 穿過之後剩下的穿透力（停住 = -1）, exit: 穿出去的距離 }] }
  pierce(ox, oy, oz, dx, dy, dz, maxDist, power) {
    const out = { end: maxDist, hits: [] };
    if (!(dx || dy || dz)) return out;
    let x = Math.floor(ox / BS), y = Math.floor(oy / BS), z = Math.floor(oz / BS);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(BS / dx) : Infinity, tdy = dy !== 0 ? Math.abs(BS / dy) : Infinity, tdz = dz !== 0 ? Math.abs(BS / dz) : Infinity;
    let tx = dx !== 0 ? (dx > 0 ? (x + 1) * BS - ox : ox - x * BS) / Math.abs(dx) : Infinity;
    let ty = dy !== 0 ? (dy > 0 ? (y + 1) * BS - oy : oy - y * BS) / Math.abs(dy) : Infinity;
    let tz = dz !== 0 ? (dz > 0 ? (z + 1) * BS - oz : oz - z * BS) / Math.abs(dz) : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0, left = power, inside = null;
    for (let guard = 0; guard < 2000; guard++) {
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (ty < tz) { y += sy; t = ty; ty += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tz; tz += tdz; nx = 0; ny = 0; nz = -sz; }
      if (t > maxDist || (y >= this.Y && dy >= 0)) return out;
      const b = this.get(x, y, z);
      if (!b) { if (inside) { inside.exit = t; inside = null; } continue; }
      const oob = !this.inb(x, y, z), cost = oob ? Infinity : BLOCK[b].pen;
      const h = { x, y, z, nx, ny, nz, dist: t, type: b, oob, left: -1, exit: 0, first: !inside };
      out.hits.push(h);
      if (cost > left || out.hits.length >= 8) { out.end = t; return out; }
      left -= cost; h.left = left; inside = h;
    }
    return out;
  }
}
