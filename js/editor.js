import * as THREE from 'three';
import { BS, WORLD } from './config.js';
import { B, BLOCK } from './world.js';
import { MAPS, base, encodeMap, decodeMap, registerCustom, saveMapCode } from './maps.js';
import { clamp } from './util.js';

// 編輯器裡可以放的方塊（基岩和外圍牆不給放）
export const PALETTE = [B.CONCRETE, B.BRICK, B.WOOD, B.METAL, B.PLASTER, B.SAND, B.ROCK, B.CONT_R, B.CONT_B, B.CONT_Y, B.SHEET, B.SANDBAG, B.TILE, B.GROUND, B.GRASS, B.SANDGROUND, B.DIRT];
export const SYM = [['none', '不對稱'], ['rot', '旋轉對稱（兩邊公平）'], ['mir', '鏡像對稱']];
const GROUNDS = { asphalt: B.GROUND, grass: B.GRASS, sand: B.SANDGROUND, rock: B.ROCK };
const m = (c) => (c + 0.5) * BS;
const UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3();

// 地圖編輯器：飛行鏡頭，對著方塊放／拆。所有修改都直接改在遊戲的 world 上，所見即所得。
export class Editor {
  constructor(g) {
    this.g = g; this.on = false;
    this.pos = new THREE.Vector3(24, 10, 40); this.yaw = 0; this.pitch = -0.45;
    this.type = B.CONCRETE; this.brush = 1; this.sym = 'rot'; this.env = 'golden'; this.G = 4; this.name = '我的地圖'; this.editId = null;
    this.spawns = [null, null]; this.pickups = []; this.undo = []; this.boxA = null; this.tgt = null; this.repeatAt = 0; this.nextSpawn = 0;
    const wire = (c) => new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true }));
    this.hi = wire(0xffffff); this.hi.renderOrder = 20; this.box = wire(0xffb238); this.box.renderOrder = 20;
    this.marks = new THREE.Group();
    for (const o of [this.hi, this.box, this.marks]) { o.visible = false; g.scene.add(o); }
  }

  // ───────── 開始／結束 ─────────
  // src：null = 全新的空地；地圖代號 = 拿那張圖當底
  open(src = null, opts = {}) {
    const g = this.g, w = g.world;
    this.on = true; this.undo = []; this.boxA = null;
    w.resize(WORLD); g.syncBounds();                         // 自製地圖固定是標準大小（大地圖不能拿來改）
    if (src && MAPS[src] && !MAPS[src].size) {
      const M = MAPS[src];
      w.types.fill(0); w.hp.fill(0); M.build(w);
      this.env = M.env; this.G = Math.round((M.ground || 2) / BS); this.name = M.custom ? M.name : M.name + '（改）'; this.editId = M.custom ? src : null;
      this.spawns = M.spawns.map((s) => ({ ...s })); this.pickups = M.pickups.map((p) => ({ ...p }));
    } else {
      this.G = clamp(opts.g | 0 || 4, 2, 14); this.env = opts.env || 'golden'; this.name = '我的地圖'; this.editId = null;
      w.types.fill(0); w.hp.fill(0); base(w, GROUNDS[opts.ground] || B.GROUND, this.G);
      const y = this.G * BS;
      this.spawns = [{ x: m(13), y, z: m(13), yaw: -Math.PI * 0.75 }, { x: m(82), y, z: m(82), yaw: Math.PI * 0.25 }];
      this.pickups = [];
    }
    w.mapId = 'editor'; w.rebuildAll();
    g.applyEnvDef(this.env, this.G * BS);
    this.pos.set(24, this.G * BS + 9, 44); this.yaw = 0; this.pitch = -0.5;
    this._marks();
    for (const o of [this.hi, this.marks]) o.visible = true;
  }
  close() { this.on = false; for (const o of [this.hi, this.box, this.marks]) o.visible = false; }

  // ───────── 標記（出生點、補給品）─────────
  _marks() {
    const G = this.marks;
    for (const c of [...G.children]) { c.geometry.dispose(); c.material.dispose(); G.remove(c); }
    const add = (geo, color, x, y, z) => { const me = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })); me.position.set(x, y, z); G.add(me); return me; };
    this.spawns.forEach((s, i) => {
      if (!s) return;
      add(new THREE.CylinderGeometry(0.3, 0.3, 1.8, 14), i ? 0x3cc8ff : 0xff7a3c, s.x, s.y + 0.9, s.z);
      const arrow = add(new THREE.ConeGeometry(0.16, 0.5, 10), 0xffffff, s.x - Math.sin(s.yaw) * 0.6, s.y + 1.5, s.z - Math.cos(s.yaw) * 0.6);
      arrow.quaternion.setFromUnitVectors(UP, FWD.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw)));   // 箭頭指向出生時面對的方向
    });
    for (const p of this.pickups) add(new THREE.BoxGeometry(0.4, 0.4, 0.4), p.type === 'hp' ? 0x54e07a : 0x4aa8ff, p.x, p.y + 0.7, p.z).scale.setScalar(p.amount >= 40 ? 1 : 0.7);
  }

  // 對稱：一個格子 → 它在另一邊的對應格子
  _mirror(x, y, z) {
    const w = this.g.world;
    if (this.sym === 'rot') return [w.X - 1 - x, y, w.Z - 1 - z];
    if (this.sym === 'mir') return [x, y, w.Z - 1 - z];
    return null;
  }
  _mirrorPos(p) {
    const W = this.g.world.X * BS, D = this.g.world.Z * BS;
    if (this.sym === 'rot') return { ...p, x: W - p.x, z: D - p.z, yaw: p.yaw === undefined ? undefined : p.yaw + Math.PI };
    if (this.sym === 'mir') return { ...p, z: D - p.z, yaw: p.yaw === undefined ? undefined : Math.PI - p.yaw };
    return null;
  }

  // ───────── 改方塊 ─────────
  _set(op, x, y, z, t) {
    const w = this.g.world;
    if (!w.inb(x, y, z) || y < 1) return;                          // 最底層的基岩不給動
    const i = w.idx(x, y, z), old = w.types[i];
    if (old === t) return;
    op.push(i, old, t); w.edit(x, y, z, t);
  }
  _cells(op, x0, y0, z0, x1, y1, z1, t) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      this._set(op, x, y, z, t);
      const mm = this._mirror(x, y, z); if (mm) this._set(op, mm[0], mm[1], mm[2], t);
    }
  }
  _commit(op) { if (op.length) { this.undo.push(op); if (this.undo.length > 120) this.undo.shift(); } }
  undoLast() {
    const op = this.undo.pop(); if (!op) return;
    const w = this.g.world;
    for (let k = op.length - 3; k >= 0; k -= 3) { const i = op[k], x = i % w.X, r = (i - x) / w.X, z = r % w.Z, y = (r - z) / w.Z; w.edit(x, y, z, op[k + 1]); }
  }

  // place = true 放、false 拆。筆刷是邊長 brush 的方塊，中心在瞄準的那一格
  paint(place) {
    const t = this.tgt; if (!t) return;
    const op = [], b = this.brush, lo = -Math.floor((b - 1) / 2), hi = lo + b - 1;
    const cx = place ? t.x + t.nx : t.x, cy = place ? t.y + t.ny : t.y, cz = place ? t.z + t.nz : t.z;
    this._cells(op, cx + lo, cy + (place && t.ny > 0 ? 0 : lo), cz + lo, cx + hi, cy + (place && t.ny > 0 ? b - 1 : hi), cz + hi, place ? this.type : 0);
    this._commit(op);
  }
  pick() { const t = this.tgt; if (t && PALETTE.includes(t.type)) { this.type = t.type; this.g.hud.editorState(); } }
  // 拉框填滿：按第一次記起點，第二次把起點到瞄準點之間整個填滿（erase = 挖空）
  boxTool(erase) {
    const t = this.tgt; if (!t) return;
    const c = erase ? [t.x, t.y, t.z] : [t.x + t.nx, t.y + t.ny, t.z + t.nz];
    if (!this.boxA) { this.boxA = c; return; }
    const op = []; this._cells(op, this.boxA[0], this.boxA[1], this.boxA[2], c[0], c[1], c[2], erase ? 0 : this.type);
    this._commit(op); this.boxA = null;
  }

  // 出生點／補給品放在瞄準的那一格上面
  _standPos() { const t = this.tgt; if (!t) return null; return { x: m(t.x + t.nx), y: (t.y + t.ny) * BS, z: m(t.z + t.nz) }; }
  setSpawn() {
    const p = this._standPos(); if (!p) return;
    const i = this.nextSpawn, W = this.g.world.X * BS / 2;
    const s = { ...p, yaw: Math.atan2(-(W - p.x), -(W - p.z)) };       // 面向地圖中心
    this.spawns[i] = s;
    const o = this._mirrorPos(s);
    if (o) this.spawns[1 - i] = o; else this.nextSpawn = 1 - i;
    this._marks();
  }
  addPickup(type, amount) {
    const p = this._standPos(); if (!p || this.pickups.length >= 12) return;
    const mk = (q) => ({ type, amount, x: q.x, y: q.y, z: q.z, ...(type === 'armor' ? { respawn: 30 } : {}) });
    this.pickups.push(mk(p));
    const o = this._mirrorPos(p);
    if (o && Math.hypot(o.x - p.x, o.z - p.z) > 1 && this.pickups.length < 12) this.pickups.push(mk(o));
    this._marks();
  }
  removePickup() {
    const p = this._standPos(); if (!p) return;
    const before = this.pickups.length;
    this.pickups = this.pickups.filter((q) => Math.hypot(q.x - p.x, q.z - p.z) > 1.2 || Math.abs(q.y - p.y) > 1.5);
    if (before !== this.pickups.length) this._marks();
  }

  // ───────── 存檔 ─────────
  // 兩個出生點都要有，而且站得下一個人
  problem() {
    const w = this.g.world;
    for (let i = 0; i < 2; i++) {
      const s = this.spawns[i];
      if (!s) return `還沒放${i ? '藍' : '橘'}色出生點`;
      if (w.boxSolid(s.x - 0.3, s.y + 0.01, s.z - 0.3, s.x + 0.3, s.y + 1.8, s.z + 0.3)) return `${i ? '藍' : '橘'}色出生點被方塊擋住了`;
      if (!w.boxSolid(s.x - 0.3, s.y - 0.4, s.z - 0.3, s.x + 0.3, s.y - 0.01, s.z + 0.3)) return `${i ? '藍' : '橘'}色出生點底下沒有地板`;
    }
    return '';
  }
  def() { return { name: this.name || '我的地圖', env: this.env, g: this.G, spawns: this.spawns.map((s) => ({ x: s.x, y: s.y, z: s.z, yaw: s.yaw })), pickups: this.pickups, types: this.g.world.types.slice() }; }
  // 存到這台電腦，回傳 { id, code }
  async save() {
    const def = this.def(), code = await encodeMap(def);
    saveMapCode(code, this.editId);
    const id = registerCustom(def, code);
    this.editId = id;
    return { id, code };
  }
  async importCode(code) {
    const def = await decodeMap(code), id = registerCustom(def, code.trim());
    saveMapCode(code.trim());
    return id;
  }

  // ───────── 每一幀 ─────────
  // inp: { f, r, up（-1..1）, fast, place, remove（按住）}
  update(dt, inp, cam, now) {
    const sp = (inp.fast ? 22 : 9) * dt, s = Math.sin(this.yaw), c = Math.cos(this.yaw), W = this.g.world;
    this.pos.x += (-s * inp.f + c * inp.r) * sp; this.pos.z += (-c * inp.f - s * inp.r) * sp; this.pos.y += inp.up * sp;
    this.pos.x = clamp(this.pos.x, -6, W.X * BS + 6); this.pos.z = clamp(this.pos.z, -6, W.Z * BS + 6); this.pos.y = clamp(this.pos.y, 0.6, W.Y * BS + 14);
    cam.position.copy(this.pos); cam.rotation.set(this.pitch, this.yaw, 0);
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements, h = W.raycast(this.pos.x, this.pos.y, this.pos.z, -e[8], -e[9], -e[10], 40);
    this.tgt = h && !h.oob && h.dist > 0 ? h : null;
    this.hi.visible = !!this.tgt;
    if (this.tgt) { const t = this.tgt, b = this.brush; this.hi.position.set(m(t.x), m(t.y), m(t.z)); this.hi.scale.setScalar(BS * (b > 1 ? b : 1) + 0.01); }
    this.box.visible = !!(this.boxA && this.tgt);
    if (this.box.visible) {
      const a = this.boxA, t = this.tgt, bx = t.x + t.nx, by = t.y + t.ny, bz = t.z + t.nz;
      this.box.position.set((Math.min(a[0], bx) + Math.max(a[0], bx) + 1) * BS / 2, (Math.min(a[1], by) + Math.max(a[1], by) + 1) * BS / 2, (Math.min(a[2], bz) + Math.max(a[2], bz) + 1) * BS / 2);
      this.box.scale.set((Math.abs(a[0] - bx) + 1) * BS + 0.02, (Math.abs(a[1] - by) + 1) * BS + 0.02, (Math.abs(a[2] - bz) + 1) * BS + 0.02);
    }
    // 按住滑鼠可以連續放／拆
    if ((inp.place || inp.remove) && now >= this.repeatAt) { this.paint(!!inp.place); this.repeatAt = now + 130; }
    if (!inp.place && !inp.remove) this.repeatAt = 0;
  }
  blockName() { return BLOCK[this.type].name; }
}
