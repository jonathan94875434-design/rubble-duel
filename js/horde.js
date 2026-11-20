import * as THREE from 'three';
import { BS, PLAYER, HORDE } from './config.js';
import { Player } from './player.js';
import { Nav } from './nav.js';
import { WEAPONS, falloff } from './weapons.js';
import { BLOCK } from './world.js';
import { MAPS } from './maps.js';
import { clamp, lerp, lerpAngle, r3, rayAABB } from './util.js';

// 一大群機器人：「死鬥練習」和「守據點」共用。
//
// 房主那邊模擬全部機器人（尋路、看人、開槍、被打死），然後用 'mobs' 訊息每秒 15 次把位置傳給訪客；
// 兩邊都用同一套角色模型畫出來。玩家打機器人跟打對手一樣是「開槍的人說了算」：
// 自己這邊判定打中，送 'mobhit' 給裁判，房主扣它的血。機器人打玩家則由房主判定、走裁判的 damage()。

// 機器人的種類。hp 血量；w 會拿哪些槍（隨機一把）；speed 跑速倍率；range 多遠開始對人開槍；
// keep 狙擊手會停在離目標多遠；scale 體型；armor 受到的傷害倍率；dmg 造成的傷害倍率；skin 外觀
export const MOBS = {
  grunt:  { name: '步兵',   hp: 100, w: ['ar', 'ar', 'smg', 'pistol'], speed: 0.9, range: 24, skin: 'recruit' },
  rusher: { name: '突擊兵', hp: 80, w: ['shotgun', 'smg'], speed: 1.12, range: 11, skin: 'shadow' },
  sniper: { name: '狙擊手', hp: 90, w: ['sniper', 'dmr'], speed: 0.85, range: 60, keep: 24, acc: 0.6, skin: 'desert' },
  heavy:  { name: '重裝兵', hp: 340, w: ['lmg'], speed: 0.66, range: 26, scale: 1.18, armor: 0.85, skin: 'arctic' },
  bomber: { name: '自爆兵', hp: 55, w: ['knife'], speed: 1.24, range: 0, boom: true, skin: 'lava' },
  boss:   { name: '巨人',   hp: 2600, w: ['lmg'], speed: 0.62, range: 42, scale: 1.65, armor: 0.9, dmg: 1.3, skin: 'gold', boss: true },
};
export const MOB_IDS = Object.keys(MOBS);
const WIDS = Object.keys(WEAPONS).concat('knife');
const MOB_COLOR = 0xc8322f;

// 難度：aimErr 瞄準誤差（度）、react 看到人之後多久開槍（毫秒）、dmg 打人的傷害倍率（一次被好幾個打，不能用滿傷害）
export const HZ_LEVELS = {
  easy:   { name: '簡單', aimErr: 8, react: 750, dmg: 0.35 },
  normal: { name: '普通', aimErr: 5, react: 480, dmg: 0.55 },
  hard:   { name: '困難', aimErr: 2.8, react: 280, dmg: 0.8 },
};
// 死鬥練習的機器人行為
export const HZ_BEH = { hold: '定點不動', strafe: '定點左右閃', hunt: '主動來找你', mix: '混合' };

// 守據點：第 n 波有哪些敵人（巨人每 5 波來一隻，排在最後）。two = 兩個人一起守，人數多一半
export function waveList(n, two) {
  const out = [], add = (k, c) => { for (let i = 0; i < c; i++) out.push(k); };
  const s = two ? 1.5 : 1;
  add('grunt', Math.round((3 + n) * s));
  if (n >= 2) add('rusher', Math.round(Math.floor(n * 0.8) * s));
  if (n >= 3) add('bomber', Math.round(Math.floor((n - 1) / 2) * s));
  if (n >= 4) add('sniper', Math.round(Math.floor((n - 2) / 2) * s));
  if (n >= 5) add('heavy', Math.round(Math.floor((n - 3) / 2) * s));
  for (let i = out.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [out[i], out[j]] = [out[j], out[i]]; }
  if (n % 5 === 0) out.push('boss');
  return out;
}
// 守據點：主武器要撐到第幾波才開放（副武器一開始就全部能用）
export const HZ_TIER = { smg: 1, shotgun: 2, ar: 3, dmr: 3, lmg: 5, sniper: 5, gl: 6, rocket: 7 };

// 受擊判定盒（跟 util.rayPlayer 一樣，多了體型 s）
function rayBody(ox, oy, oz, dx, dy, dz, px, py, pz, crouched, s) {
  const n = (crouched ? 0.92 : 1.42) * s, hw = 0.2 * s, bw = 0.33 * s;
  const th = rayAABB(ox, oy, oz, dx, dy, dz, px - hw, py + n, pz - hw, px + hw, py + n + 0.4 * s, pz + hw);
  const tb = rayAABB(ox, oy, oz, dx, dy, dz, px - bw, py, pz - bw, px + bw, py + n, pz + bw);
  if (th < 0 && tb < 0) return null;
  if (th >= 0 && (tb < 0 || th <= tb + 0.05)) return { t: th, head: true };
  return { t: tb, head: false };
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const IDLE = { f: 0, r: 0, jump: false, crouch: false, speed: 1 };

export class Horde {
  constructor(g) {
    this.g = g; this.on = false; this.kind = null; this.host = false; this.round = 0;
    this.mobs = []; this.byId = new Map();   // 房主：模擬中的機器人
    this.views = new Map();                  // 兩邊：id → { v 角色模型, kind, alive, seen, deadAt, hp }
    this.pool = {};                          // 用過的角色模型，依種類留著重複用（建一個角色要好幾毫秒）
    this.nav = null; this.spots = null; this.nSpots = 0;
    this.core = null; this.coreG = null; this.coreHitT = 0;
    this.warns = []; this.warnM = [];
    this._buildCoreMesh(); this._buildWarn();
  }

  // ───────── 開始／結束 ─────────
  // 進入機器人模式（房主和訪客都會呼叫）：算出生點、據點，房主開始生機器人
  begin(gs) {
    this.stop();
    const g = this.g, hz = gs.hz;
    this.on = true; this.kind = hz.kind; this.cfg = hz.cfg || {}; this.round = gs.round;
    this.host = !!(g.net.isHost && g.authority);
    this.lv = HZ_LEVELS[this.cfg.lv] || HZ_LEVELS.normal;
    if (!this.nav) this.nav = new Nav(g.world);
    this._findSpots(gs.map);
    this.nextId = 1; this.sendAcc = 0; this.waveN = 0; this.gateWave = 0; this.list = []; this.spawnAt = 0; this.countAt = 0;
    this.gates = []; this.gateSpots = []; this.respawnQ = []; this.sndAt = 0; this.sndN = 0; this.flashAt = 0;
    if (this.kind === 'defense') this.setCore(hz.cp || this._coreSpot());
    if (this.host) {
      if (this.kind === 'defense') g.authority.hzSetCore(this.core);
      else for (let i = 0; i < (this.cfg.n | 0); i++) this.respawnQ.push(performance.now() + 300 + i * 90);   // 錯開一點生，免得同一幀卡一下
    }
    // 先把會用到的角色模型建好，打到一半才建會頓一下
    const want = this.kind === 'defense' ? { grunt: 6, rusher: 3, bomber: 2, sniper: 2, heavy: 1 } : { grunt: Math.min(16, this.cfg.n | 0), rusher: 2, sniper: 2 };
    for (const k in want) { const p = this.pool[k] || (this.pool[k] = []); while (p.length < want[k]) p.push(this._mkView(k)); }
  }

  stop() {
    this.on = false;
    for (const id of [...this.views.keys()]) this._free(id);
    this.mobs.length = 0; this.byId.clear();
    this.core = null; this.coreG.visible = false; this.warns.length = 0;
    for (const w of this.warnM) w.visible = false;
  }

  // ───────── 地形：出生點、據點 ─────────
  // 從玩家出生點走得到的所有站立點（機器人只會生在玩家走得到的地方，不會卡在封死的房間裡）
  _findSpots(mapId) {
    const sp = MAPS[mapId].spawns[0], list = this.nav.reachable(sp.x, sp.y, sp.z);
    this.spots = new Float32Array(list.length * 3); this.nSpots = list.length;
    list.forEach((p, i) => { this.spots[i * 3] = p.x; this.spots[i * 3 + 1] = p.y; this.spots[i * 3 + 2] = p.z; });
  }
  _sp(i) { const s = this.spots; return { x: s[i * 3], y: s[i * 3 + 1], z: s[i * 3 + 2] }; }
  // 隨機挑一個站立點，ok(p) 決定能不能用；試很多次都不行就退而求其次
  _pick(ok, tries = 60) {
    if (!this.nSpots) return null;
    for (let i = 0; i < tries; i++) { const p = this._sp((Math.random() * this.nSpots) | 0); if (ok(p)) return p; }
    return null;
  }
  // 據點放在地圖中間附近、頭上是天空的地面（不要在高台、屋頂上：機器人要從地面看得到它）。
  // 兩邊各自算，結果一樣；房主算的會再同步一次
  _coreSpot() {
    const w = this.g.world, cx = (w.X * BS) / 2, cz = (w.Z * BS) / 2, open = [];
    let minY = Infinity;
    for (let i = 0; i < this.nSpots; i++) {
      const x = this.spots[i * 3], y = this.spots[i * 3 + 1], z = this.spots[i * 3 + 2];
      if (w.raycast(x, y + 2.8, z, 0, 1, 0, 40)) continue;                        // 頭上有東西（室內、地下道）不要
      if (w.boxSolid(x - 1.2, y, z - 1.2, x + 1.2, y + 2.8, z + 1.2)) continue;   // 旁邊要留一點空間
      open.push(i); minY = Math.min(minY, y);
    }
    let best = null, bd = Infinity;
    for (const i of open) {
      const x = this.spots[i * 3], y = this.spots[i * 3 + 1], z = this.spots[i * 3 + 2];
      const d = Math.hypot(x - cx, z - cz) + (y - minY) * 4;                      // 每高一公尺當作離中間遠四公尺
      if (d < bd) { bd = d; best = [x, y, z]; }
    }
    return best || [cx, MAPS[w.mapId] ? MAPS[w.mapId].spawns[0].y : 1, cz];
  }
  setCore(p) {
    if (!p || !p.every(Number.isFinite)) return;
    if (this.core && this.core[0] === p[0] && this.core[1] === p[1] && this.core[2] === p[2]) return;
    this.core = [p[0], p[1], p[2]];
    this.coreG.position.set(p[0], p[1], p[2]); this.coreG.visible = true;
    this.g.skills.nova(p[0], p[1] + 0.05, p[2], 0xffc640, 3, 0.8);
  }
  // 玩家（重）生的位置。守據點：據點旁邊；死鬥：離機器人最遠的地方之一
  playerSpawn() {
    const g = this.g, c = this.core;
    if (this.kind === 'defense' && c) {
      const p = this._pick((s) => { const d = Math.hypot(s.x - c[0], s.z - c[2]); return d > 2.2 && d < 6 && Math.abs(s.y - c[1]) < 1.6; }, 120);
      return p ? { ...p, yaw: Math.atan2(-(p.x - c[0]), -(p.z - c[2])) + Math.PI } : { x: c[0] + 2.5, y: c[1], z: c[2], yaw: 0 };
    }
    const sp = MAPS[g.world.mapId].spawns, cand = [...sp];
    for (let i = 0; i < 24; i++) { const p = this._pick(() => true, 1); if (p) cand.push(p); }
    let best = sp[0], bd = -1;
    for (const s of cand) {
      let d = Infinity;
      for (const o of this.views.values()) if (o.alive) d = Math.min(d, Math.hypot(o.v.pos.x - s.x, o.v.pos.z - s.z));
      if (d > bd) { bd = d; best = s; }
    }
    return { x: best.x, y: best.y, z: best.z, yaw: best.yaw !== undefined ? best.yaw : Math.random() * 6.283 };
  }

  // ───────── 角色模型 ─────────
  _mkView(kind) {
    const v = this.g._mkDoll(MOB_COLOR), d = MOBS[kind];
    v.applySkin(d.skin, MOB_COLOR); v.group.scale.setScalar(d.scale || 1); v._lit();
    v.group.visible = false; v.alive = false;
    return v;
  }
  _view(id, kind, wid) {
    let o = this.views.get(id);
    if (o) return o;
    const p = this.pool[kind] || (this.pool[kind] = []), v = p.pop() || this._mkView(kind);
    v.setWeapon(wid, 'stock'); v._lit(); v.clearBuffer(); if (v.revive) v.revive();
    v.alive = true; v.group.visible = true;
    o = { v, id, kind, alive: true, seen: performance.now(), deadAt: 0, hp: 1, w: wid };
    this.views.set(id, o);
    return o;
  }
  _free(id) {
    const o = this.views.get(id); if (!o) return;
    o.v.group.visible = false; o.v.alive = false;
    (this.pool[o.kind] || (this.pool[o.kind] = [])).push(o.v);
    this.views.delete(id);
  }
  _died(o, dx, dz) {
    if (!o.alive) return;
    o.alive = false; o.deadAt = performance.now(); o.v.alive = false;
    if (o.v.die) o.v.die(dx, dz);
  }
  flash(id) { const o = this.views.get(id); if (o) o.v.hitFlash(); }

  // 子彈打得到哪一個機器人：回傳最近的 { t, head, id }
  rayHit(ox, oy, oz, dx, dy, dz) {
    let best = null;
    for (const o of this.views.values()) {
      if (!o.alive) continue;
      const p = o.v.pos, h = rayBody(ox, oy, oz, dx, dy, dz, p.x, p.y, p.z, o.v.crouched, MOBS[o.kind].scale || 1);
      if (h && (!best || h.t < best.t)) best = { t: h.t, head: h.head, id: o.id };
    }
    return best;
  }
  // 爆炸、火這類範圍傷害用：每個活著的機器人的身體中心
  each(fn) { for (const o of this.views.values()) if (o.alive) fn(o.id, o.v.pos, MOBS[o.kind].scale || 1); }
  yawOf(id) { const o = this.views.get(id); return o ? o.v.yaw : 0; }
  // 這一格方塊有沒有蓋到機器人（立牆的時候避開）
  blocks(bx, by, bz) {
    for (const o of this.views.values()) {
      if (!o.alive) continue;
      const p = o.v.pos, s = MOBS[o.kind].scale || 1;
      if ((bx + 1) * BS > p.x - 0.4 * s && bx * BS < p.x + 0.4 * s && (bz + 1) * BS > p.z - 0.4 * s && bz * BS < p.z + 0.4 * s && (by + 1) * BS > p.y && by * BS < p.y + 1.9 * s) return true;
    }
    return false;
  }

  // ───────── 房主：模擬 ─────────
  _spawn(kind, beh, at) {
    const g = this.g, d = MOBS[kind], p = at;
    if (!p) return null;
    const body = new Player(g.world);
    body.spawn({ x: p.x, y: p.y, z: p.z, yaw: Math.random() * 6.283 });
    const wid = d.w[(Math.random() * d.w.length) | 0], wd = WEAPONS[wid] || null;
    const wave = this.kind === 'defense' ? Math.max(1, this.waveN) : 1;
    const hp = Math.round(d.hp * (this.kind === 'defense' ? 1 + 0.07 * (wave - 1) : 1));
    const m = {
      id: this.nextId++, kind, def: d, body, w: wid, wd, hp, maxHp: hp, alive: true, deadAt: 0, beh, s: d.scale || 1,
      post: { x: p.x, y: p.y, z: p.z }, path: null, pi: 0, planAt: 0, gx: 0, gy: 0, gz: 0, pgx: 1e9, pgz: 1e9,
      tgt: -1, seeAt: 0, vis: [false, false], coreVis: false, reactAt: 0, nextShot: 0, ammo: wd ? wd.mag : 0, burst: 0, burstN: 5,
      strafe: Math.random() < 0.5 ? -1 : 1, strafeT: 0, chkAt: 0, cx: p.x, cz: p.z, stuck: 0, breachT: 0, blindUntil: 0,
      aggro: -1, aggroT: 0, artAt: performance.now() + 5000, beepAt: 0,
    };
    this.mobs.push(m); this.byId.set(m.id, m);
    const o = this._view(m.id, kind, wid); o.v.pos.set(p.x, p.y, p.z); o.v.lastPos.copy(o.v.pos); o.v.yaw = body.yaw;
    g.skills.nova(p.x, p.y + 0.05, p.z, 0xff4030, 1.5 * m.s, 0.5); g.fx.light(p.x, p.y + 1, p.z, 0xff5040, 30, 0.35, 8);
    return m;
  }
  // 死鬥：生一個新的機器人（離玩家至少 14 公尺，找不到再放寬）
  _dmSpawn() {
    const c = this.cfg, tg = this._targets();
    const far = (min) => (s) => tg.every((t) => !t.al || Math.hypot(t.x - s.x, t.z - s.z) > min);
    let beh = c.beh;
    if (beh === 'mix') { const r = Math.random(); beh = r < 0.25 ? 'hold' : r < 0.6 ? 'strafe' : 'hunt'; }
    if (!HZ_BEH[beh]) beh = 'hunt';
    const r = Math.random(), kind = beh === 'hunt' ? (r < 0.75 ? 'grunt' : 'rusher') : (r < 0.8 ? 'grunt' : 'sniper');
    // 定點的機器人彼此散開一點：多挑幾個位置，選離其他機器人最遠的
    let p = null, bd = -1;
    for (let k = 0; k < (beh === 'hunt' ? 1 : 8); k++) {
      const q = this._pick(far(14)) || this._pick(far(8)) || this._pick(() => true);
      if (!q) break;
      let d = 50;
      for (const m of this.mobs) if (m.alive) d = Math.min(d, Math.hypot(m.post.x - q.x, m.post.z - q.z));
      if (d > bd) { bd = d; p = q; }
    }
    return this._spawn(kind, beh, p);
  }
  // 守據點：下一波從哪幾個方向來（離據點最遠的那一圈裡挑，彼此隔開）
  _pickGates(n) {
    const c = this.core; if (!c) return [];
    let maxD = 0;
    for (let i = 0; i < this.nSpots; i++) maxD = Math.max(maxD, Math.hypot(this.spots[i * 3] - c[0], this.spots[i * 3 + 2] - c[2]));
    const cnt = Math.min(4, 1 + Math.floor((n + 1) / 3)), gates = [];
    for (let k = 0; k < 200 && gates.length < cnt; k++) {
      const p = this._pick((s) => Math.hypot(s.x - c[0], s.z - c[2]) > maxD * 0.72, 4);
      if (p && gates.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 14)) gates.push(p);
    }
    if (!gates.length) { const p = this._pick(() => true); if (p) gates.push(p); }
    this.gates = gates;
    this.gateSpots = gates.map((gp) => { const l = []; for (let i = 0; i < this.nSpots && l.length < 60; i++) if (Math.hypot(this.spots[i * 3] - gp.x, this.spots[i * 3 + 2] - gp.z) < 4.5 && Math.abs(this.spots[i * 3 + 1] - gp.y) < 2) l.push(i); return l; });
    return gates.map((p) => [r3(p.x), r3(p.z)]);
  }

  // 兩位玩家目前的位置（房主自己用本機物理，訪客用最新收到的位置封包）
  _targets() {
    const g = this.g, A = g.authority, p = g.player, rb = g.remote.buf, last = rb.length ? rb[rb.length - 1] : null;
    const t0 = { i: 0, x: p.pos.x, y: p.pos.y, z: p.pos.z, cr: p.crouched, al: !!(A && A.players[0].alive) };
    const t1 = last ? { i: 1, x: last.x, y: last.y, z: last.z, cr: !!(last.f & 1), al: !!(A && A.present[1] && A.players[1].alive) } : { i: 1, x: 0, y: -99, z: 0, cr: false, al: false };
    return (this.tg = [t0, t1]);
  }

  // 房主每一幀：生怪、每個機器人的腦袋與身體、同步給訪客
  simulate(dt, now) {
    const g = this.g, A = g.authority, hz = A && A.hz;
    if (!hz || A.phase !== 'horde') return;
    const tg = this._targets();
    this.pathBudget = 2;                                      // 每一幀最多算兩次尋路（十幾個一起算會頓）
    if (this.kind === 'dm') {
      while (this.respawnQ.length && now >= this.respawnQ[0] && this.mobs.filter((m) => m.alive).length < Math.min(HORDE.MAX_ALIVE, this.cfg.n | 0)) { this.respawnQ.shift(); this._dmSpawn(); }
    } else this._waves(hz, now);
    const alive = [];
    for (const m of this.mobs) if (m.alive) alive.push(m);
    for (const m of alive) this._mob(m, dt, now, tg, hz);
    // 機器人彼此推開，不會疊成一團
    for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i].body, b = alive[j].body, dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz), min = 0.7 * Math.max(alive[i].s, alive[j].s);
      if (d < min && d > 1e-4 && Math.abs(a.pos.y - b.pos.y) < 1.5) { const k = ((min - d) / d) * 3; a.vel.x -= dx * k; a.vel.z -= dz * k; b.vel.x += dx * k; b.vel.z += dz * k; }
    }
    this._artillery(now, tg);
    // 屍體留 4 秒；死鬥倒下的補一個新的
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      if (!m.alive && now - m.deadAt > 4000) { this.mobs.splice(i, 1); this.byId.delete(m.id); this._free(m.id); }
    }
    // 給畫面：模型直接跟著物理位置走（房主不用延遲內插）
    for (const m of this.mobs) {
      const o = this.views.get(m.id); if (!o || !o.alive) continue;
      o.v.pos.copy(m.body.rpos); o.v.yaw = m.body.yaw; o.v.pitch = m.body.pitch; o.v.crouched = false; o.v.grounded = m.body.onGround; o.hp = m.hp / m.maxHp;
    }
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / HORDE.SNAP_HZ && g.net.connected) {
      this.sendAcc = 0;
      const a = [];
      for (const m of this.mobs) {
        const b = m.body;
        a.push(m.id, MOB_IDS.indexOf(m.kind), r3(b.rpos.x), r3(b.rpos.y), r3(b.rpos.z), r3(b.yaw), r3(b.pitch), (b.onGround ? 2 : 0) | (m.alive ? 4 : 0), WIDS.indexOf(m.w), Math.round((Math.max(0, m.hp) / m.maxHp) * 100));
      }
      g.sendPeer('mobs', { r: this.round, a });
    }
    if (now >= this.countAt) { this.countAt = now + 250; A.hzCount(this.mobs.filter((m) => m.alive).length + this.list.length, this.waveN, this._bossFrac()); }
  }
  _bossFrac() { let f = 0; for (const m of this.mobs) if (m.alive && m.def.boss) f = Math.max(f, m.hp / m.maxHp); return f; }

  // 守據點的波次：休息時先決定下一波從哪裡來；開打後照名單一隻一隻生
  _waves(hz, now) {
    const A = this.g.authority;
    if (hz.st === 'break' && this.gateWave !== hz.wave + 1) { this.gateWave = hz.wave + 1; A.hzGates(this._pickGates(hz.wave + 1)); }
    if (hz.st === 'wave' && this.waveN !== hz.wave) {
      this.waveN = hz.wave; this.list = waveList(hz.wave, !!(A.present[1]));
      if (!this.gates.length) this._pickGates(hz.wave);
      this.spawnAt = now; this.gi = 0;
    }
    if (hz.st === 'wave' && this.list.length && now >= this.spawnAt && this.mobs.filter((m) => m.alive).length < HORDE.MAX_ALIVE) {
      this.spawnAt = now + 650;
      const gi = this.gi++ % Math.max(1, this.gates.length), l = this.gateSpots[gi] || [];
      const p = l.length ? this._sp(l[(Math.random() * l.length) | 0]) : this.gates[gi];
      if (p) this._spawn(this.list.shift(), 'core', p);
    }
  }

  _mob(m, dt, now, tg, hz) {
    const g = this.g, b = m.body, d = m.def, L = this.lv, s = m.s;
    if (b.collides(b.pos.x, b.pos.y, b.pos.z)) b.unstick();          // 被別人立的牆蓋到
    if (b.pos.y < -10) { m.hp = 0; this._kill(m, -1); return; }       // 掉出地圖
    const ex = b.pos.x, ey = b.pos.y + PLAYER.EYE * s, ez = b.pos.z;
    // 看得到誰（每 0.12 秒看一次，不用每一幀算）
    if (now >= m.seeAt) {
      m.seeAt = now + 100 + Math.random() * 50;
      const blind = now < m.blindUntil;
      for (const t of tg) {
        if (!t.al || blind) { m.vis[t.i] = false; continue; }
        const dx = t.x - ex, dy = t.y + 1.1 - ey, dz = t.z - ez, dist = Math.hypot(dx, dy, dz) || 1;
        m.vis[t.i] = dist < 75 && !g.world.raycast(ex, ey, ez, dx / dist, dy / dist, dz / dist, dist) && !g.fx.smokeBlocked(ex, ey, ez, t.x, t.y + 1.1, t.z);
      }
      if (this.core) {
        const c = this.core, dx = c[0] - ex, dy = c[1] + 1.3 - ey, dz = c[2] - ez, dist = Math.hypot(dx, dy, dz) || 1;
        m.coreVis = !blind && !g.world.raycast(ex, ey, ez, dx / dist, dy / dist, dz / dist, dist - 0.8);
      }
    }
    // 目標：被誰打就先找誰；不然找看得到的人裡最近的
    let tgt = -1, td = Infinity;
    for (const t of tg) {
      if (!t.al) continue;
      const dd = Math.hypot(t.x - ex, t.z - ez) - (m.aggro === t.i && now < m.aggroT ? 12 : 0);
      if (m.vis[t.i] && dd < td) { td = dd; tgt = t.i; }
    }
    if (tgt !== m.tgt) { m.tgt = tgt; if (tgt >= 0) m.reactAt = Math.max(m.reactAt, now + L.react * (d.acc ? 1.6 : 1)); }
    const T = tgt >= 0 ? tg[tgt] : null, tdist = T ? Math.hypot(T.x - ex, T.y + 1.1 - ey, T.z - ez) : Infinity;
    const atk = this.cfg.atk !== false;

    // ── 要往哪裡走 ──
    let wx = 0, wz = 0, jump = false, face = null, shootCore = false, follow = false;
    const strafeHere = (k) => {
      m.strafeT -= dt;
      if (m.strafeT <= 0) { m.strafe = Math.random() < 0.5 ? -1 : 1; m.strafeT = 0.45 + Math.random() * 1.1; }
      const fx = T.x - ex, fz = T.z - ez, hl = Math.hypot(fx, fz) || 1, hx = fx / hl, hz2 = fz / hl;
      wx = hx * k - hz2 * m.strafe; wz = hz2 * k + hx * m.strafe;
    };
    if (m.beh === 'hold' || m.beh === 'strafe') {
      if (T && m.beh === 'strafe') {
        strafeHere(0);
        const ox = b.pos.x - m.post.x, oz = b.pos.z - m.post.z;
        if (Math.hypot(ox, oz) > 1.8 && (ox * wx + oz * wz) > 0) { m.strafe = -m.strafe; wx = -wx; wz = -wz; }   // 只在原地兩公尺內閃
      } else if (!T && Math.hypot(b.pos.x - m.post.x, b.pos.z - m.post.z) > 0.6) { wx = m.post.x - b.pos.x; wz = m.post.z - b.pos.z; }   // 被炸開了：走回原位
    } else if (m.beh === 'hunt') {
      if (T && tdist < (d.range || 20) * 0.75) strafeHere(tdist > 12 ? 1 : tdist < 5 ? -0.6 : 0.15);
      else {
        let best = null, bd = Infinity;
        for (const t of tg) if (t.al) { const dd = Math.hypot(t.x - ex, t.z - ez); if (dd < bd) { bd = dd; best = t; } }
        if (best) { m.gx = best.x; m.gy = best.y; m.gz = best.z; follow = true; }
      }
    } else if (m.beh === 'core') {
      const c = this.core;
      if (d.boom) {                                              // 自爆兵：衝向最近的人（8 公尺內看得到）或據點，貼上去就炸
        const go = T && tdist < 8 ? T : null, gx = go ? go.x : c[0], gy = go ? go.y : c[1], gz = go ? go.z : c[2];
        const dd = Math.hypot(gx - ex, gy + 1 - (b.pos.y + 1), gz - ez);
        if (dd < 2.3) { this._boom(m); return; }
        if (dd < 9 && now >= m.beepAt) { m.beepAt = now + Math.max(120, dd * 70); const o = this.views.get(m.id); if (o) o.v.hitFlash(); }
        if (dd < 3.5) { wx = gx - ex; wz = gz - ez; } else { m.gx = gx; m.gy = gy; m.gz = gz; follow = true; }
      } else if (T && tdist < d.range && (m.def !== MOBS.rusher || tdist < 16)) {
        strafeHere(d.keep ? (tdist > d.keep ? 0.6 : 0) : tdist > 14 ? 0.8 : tdist < 5 ? -0.5 : 0.1);
      } else {
        const cd = Math.hypot(c[0] - ex, c[2] - ez), reach = d.keep ? 30 : 14;
        if (m.coreVis && cd < reach) shootCore = true;            // 到了：站定打據點
        else if (m.def === MOBS.rusher) {                         // 突擊兵：附近有人就去找人
          let best = null, bd = 20;
          for (const t of tg) if (t.al) { const dd = Math.hypot(t.x - ex, t.z - ez); if (dd < bd) { bd = dd; best = t; } }
          if (best) { m.gx = best.x; m.gy = best.y; m.gz = best.z; } else { m.gx = c[0]; m.gy = c[1]; m.gz = c[2]; }
          follow = true;
        } else { m.gx = c[0]; m.gy = c[1]; m.gz = c[2]; follow = true; }
      }
    }
    let breach = false;
    if (follow) {
      const st = m.breachT > 0 ? null : this._follow(m, now);
      if (st) { wx = st.wx; wz = st.wz; jump = st.jump; face = Math.atan2(-wx, -wz); }
      else { wx = m.gx - ex; wz = m.gz - ez; face = Math.atan2(-wx, -wz); breach = true; }   // 沒路：直直走過去，前面有牆就打穿
      if (now >= m.chkAt) {                                       // 卡住偵測：每秒看一次有沒有前進
        if (m.chkAt && Math.hypot(b.pos.x - m.cx, b.pos.z - m.cz) < 0.35) {
          m.stuck++; m.planAt = 0; jump = b.onGround;
          if (m.stuck >= 3) { m.breachT = 2.2; m.stuck = 0; }
        } else m.stuck = 0;
        m.chkAt = now + 1000; m.cx = b.pos.x; m.cz = b.pos.z;
      }
    }
    m.breachT = Math.max(0, m.breachT - dt);
    if (m.breachT > 0) breach = true;

    // ── 身體朝向 ──
    let ax = 0, ay = 0, az = 0;
    if (T) { ax = T.x; ay = T.y + (T.cr ? 0.75 : 1.2); az = T.z; }
    else if (shootCore) { ax = this.core[0]; ay = this.core[1] + 1.3; az = this.core[2]; }
    const look = T || shootCore;
    const ldx = ax - ex, ldy = ay - ey, ldz = az - ez, ll = Math.hypot(ldx, ldy, ldz) || 1;
    const turn = Math.min(1, dt * 10);
    if (look) { b.yaw = lerpAngle(b.yaw, Math.atan2(-ldx, -ldz), turn); b.pitch = lerp(b.pitch, Math.asin(clamp(ldy / ll, -1, 1)), turn); }
    else if (face !== null) { b.yaw = lerpAngle(b.yaw, face, turn); b.pitch = lerp(b.pitch, 0, turn); }
    const wl = Math.hypot(wx, wz), sn = Math.sin(b.yaw), cs = Math.cos(b.yaw);
    const f = wl > 1e-4 ? (-wx * sn - wz * cs) / wl : 0, r = wl > 1e-4 ? (wx * cs - wz * sn) / wl : 0;
    const wmove = m.wd ? m.wd.move : 1.15, slow = this.kind === 'dm' && m.beh !== 'hunt' ? 0.55 : 1;
    b.update(dt, { f, r, jump, crouch: false, speed: d.speed * wmove * slow });

    // ── 開槍 ──
    if (!atk || !m.wd || now < m.nextShot) return;
    if (T && tdist < (d.range || 30) * 1.4 && now >= m.reactAt) this._fire(m, now, ax, ay, az, tg);
    else if (shootCore) this._fire(m, now, ax, ay, az, tg);
    else if (breach && b.onGround) {                              // 打穿擋路的牆
      const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw), h = g.world.raycast(ex, ey - 0.6, ez, fx, 0, fz, 2.2);
      if (h && !h.oob && BLOCK[h.type].hp !== Infinity) this._fire(m, now, ex + fx * h.dist, ey - 0.6, ez + fz * h.dist, tg);
    }
  }

  // 尋路：照著路徑點走。回傳 { wx, wz, jump } 或 null（沒路）
  _follow(m, now) {
    const b = m.body;
    const moved = Math.hypot(m.gx - m.pgx, m.gz - m.pgz) > 1.5;
    if ((!m.path || now >= m.planAt || moved) && this.pathBudget > 0) {
      this.pathBudget--;
      m.path = this.nav.path(b.pos.x, b.pos.y, b.pos.z, m.gx, m.gy, m.gz);
      m.pi = m.path && m.path.length > 1 ? 1 : 0;
      m.planAt = now + (m.path ? 1100 + Math.random() * 400 : 2500); m.pgx = m.gx; m.pgz = m.gz;
    }
    const p = m.path;
    if (!p) return null;
    while (m.pi < p.length) {
      const w = p[m.pi];
      if (Math.hypot(w.x - b.pos.x, w.z - b.pos.z) < 0.35 && Math.abs(w.y - b.pos.y) < 0.6) m.pi++; else break;
    }
    if (m.pi >= p.length) return { wx: m.gx - b.pos.x, wz: m.gz - b.pos.z, jump: false };
    const w = p[m.pi], dx = w.x - b.pos.x, dz = w.z - b.pos.z, d = Math.hypot(dx, dz) || 1;
    return { wx: dx / d, wz: dz / d, jump: b.onGround && w.y - b.pos.y > 0.6 };
  }

  // 機器人開槍（瞄 (ax,ay,az)）：子彈先碰到誰就算誰——玩家、據點、或方塊
  _fire(m, now, ax, ay, az, tg) {
    const g = this.g, A = g.authority, b = m.body, def = m.wd, d = m.def, L = this.lv;
    m.nextShot = now + (60000 / def.rpm) * (def.auto ? 1.2 : 1.7) * (d.acc ? 2 : 1);
    if (--m.ammo <= 0) { m.ammo = def.mag; m.nextShot = now + def.reload * 1000; }
    else if (def.auto && ++m.burst >= m.burstN) { m.burst = 0; m.burstN = 4 + ((Math.random() * 5) | 0); m.nextShot += 380 + Math.random() * 420; }
    const s = m.s, ox = b.pos.x, oy = b.pos.y + PLAYER.EYE * s, oz = b.pos.z;
    let fx = ax - ox, fy = ay - oy, fz = az - oz; const l0 = Math.hypot(fx, fy, fz) || 1; fx /= l0; fy /= l0; fz /= l0;
    const mv = (def.mv === undefined ? 1.6 : def.mv) * Math.min(1, b.speed2d() / PLAYER.SPEED) * 0.7;
    const err = ((L.aimErr * (d.acc || 1) + def.spread[0] * 0.5 + mv) * Math.PI) / 180;
    const c = this.core, dmul = L.dmg * (d.dmg || 1) * (this.kind === 'defense' ? 1 + 0.03 * (Math.max(1, this.waveN) - 1) : 1);
    const pd = [0, 0], ph = [false, false], ends = [];
    let coreD = 0;
    for (let i = 0; i < def.pellets; i++) {
      let dx = fx + (Math.random() - 0.5) * 2 * err, dy = fy + (Math.random() - 0.5) * 2 * err, dz = fz + (Math.random() - 0.5) * 2 * err;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const bh = g.world.raycast(ox, oy, oz, dx, dy, dz, 150);
      let t = bh ? bh.dist : 150, who = -2, head = false;
      for (const T of tg) {
        if (!T.al) continue;
        const h = rayBody(ox, oy, oz, dx, dy, dz, T.x, T.y, T.z, T.cr, 1);
        if (h && h.t < t) { t = h.t; who = T.i; head = h.head; }
      }
      if (c) { const ct = rayAABB(ox, oy, oz, dx, dy, dz, c[0] - 0.7, c[1], c[2] - 0.7, c[0] + 0.7, c[1] + 2.6, c[2] + 0.7); if (ct >= 0 && ct < t) { t = ct; who = -1; } }
      if (who >= 0) { pd[who] += def.dmg * falloff(def, t) * (head ? def.head : 1); ph[who] = ph[who] || head; }
      else if (who === -1) coreD += def.dmg * falloff(def, t);
      else if (bh && !bh.oob && BLOCK[bh.type].hp !== Infinity) {   // 打到方塊：機器人也會把掩體打爛（比玩家弱一點）
        const dmg = Math.round(def.dmg * def.block * 0.6), res = g.world.damage(bh.x, bh.y, bh.z, dmg);
        g.combat.blkOut.push(g.world.idx(bh.x, bh.y, bh.z), dmg);
        if (res && res.destroyed) g.fx.debris(bh.x, bh.y, bh.z, res.type, 3, 0.8);
      }
      ends.push(r3(ox + dx * t), r3(oy + dy * t), r3(oz + dz * t));
    }
    this._shotFx(m.id, m.w, ends);
    g.sendPeer('mfire', { r: this.round, id: m.id, w: m.w, e: ends });
    for (let i = 0; i < 2; i++) if (pd[i] > 0) A.damage(i, pd[i] * dmul, -1, m.w, ph[i], { mob: m.kind, src: [r3(ox), r3(oz)] });
    if (coreD > 0) A.hzCore(coreD * HORDE.CORE_MUL * (d.dmg || 1) * (L.dmg / 0.55));   // 難度越高，據點也掉得越快
  }

  // 槍口火光、彈道、槍聲（太多隻同時開槍時，聲音限量）
  _shotFx(id, wid, ends) {
    const g = this.g, o = this.views.get(id), def = WEAPONS[wid];
    if (!o || !def) return;
    if (o.v.fireKick) o.v.fireKick();
    const mz = o.v.muzzle(_v), cam = g.camera.position, dist = mz.distanceTo(cam);
    if (dist < 60) g.fx.muzzle(mz.x, mz.y, mz.z);
    for (let i = 0; i + 2 < ends.length; i += 3) g.fx.tracer(mz, _w.set(ends[i], ends[i + 1], ends[i + 2]), 0xffb08a);
    const now = performance.now();
    if (now - this.sndAt > 60) { this.sndAt = now; this.sndN = 0; }
    if (this.sndN++ < 3) g.sfx.shot(def.snd, Math.max(1, dist), g.panOf(mz.x, mz.z));
  }

  // 自爆兵：在原地炸開（炸地形、炸人、炸據點），自己也沒了
  _boom(m) {
    const g = this.g, A = g.authority, b = m.body, x = b.pos.x, y = b.pos.y + 0.9, z = b.pos.z;
    const msg = { r: this.round, pid: 0, p: [r3(x), r3(y), r3(z)], br: 2.6, bp: 650, rad: 5.5, k: 16, own: -1 };
    this._kill(m, -1);
    g.sendPeer('expl', msg); g.doExplosion(msg);
    this._blast(x, y, z, 5.5, 90 * this.lv.dmg / 0.55, 200, 'bomber');
  }
  // 範圍傷害：玩家（依距離衰減）、據點
  _blast(x, y, z, rad, dmg, coreDmg, kind) {
    const A = this.g.authority;
    for (const T of this.tg || this._targets()) {
      if (!T.al) continue;
      const d = Math.hypot(T.x - x, T.y + 0.9 - y, T.z - z);
      if (d < rad) A.damage(T.i, dmg * Math.max(0.2, 1 - d / rad), -1, 'he', false, { mob: kind, src: [r3(x), r3(z)] });
    }
    const c = this.core;
    if (c) { const d = Math.hypot(c[0] - x, c[1] + 1.3 - y, c[2] - z); if (d < rad + 1) A.hzCore(coreDmg * Math.max(0.3, 1 - d / (rad + 1))); }
  }
  // 巨人的砲擊：先在地上畫紅圈，1.4 秒後炸下來
  _artillery(now, tg) {
    for (const m of this.mobs) {
      if (!m.alive || !m.def.boss || now < m.artAt) continue;
      m.artAt = now + 7000 + Math.random() * 2000;
      const vis = tg.filter((t) => t.al && m.vis[t.i]);
      const t = vis.length ? vis[(Math.random() * vis.length) | 0] : null, c = this.core;
      const p = t ? [r3(t.x), r3(t.y + 0.05), r3(t.z)] : c ? [c[0], c[1] + 0.05, c[2]] : null;
      if (!p) continue;
      this.warn(p, 1.4);
      this.g.sendPeer('mwarn', { r: this.round, p, d: 1.4 });
      this.warns.push({ p, at: now + 1400, host: true });
    }
    for (let i = this.warns.length - 1; i >= 0; i--) {
      const w = this.warns[i];
      if (!w.host || now < w.at) continue;
      this.warns.splice(i, 1);
      const g = this.g, msg = { r: this.round, pid: 0, p: [w.p[0], r3(w.p[1] + 0.4), w.p[2]], br: 2.2, bp: 900, rad: 4.8, k: 15, own: -1 };
      g.sendPeer('expl', msg); g.doExplosion(msg);
      this._blast(w.p[0], w.p[1] + 0.4, w.p[2], 4.8, 75 * this.lv.dmg / 0.55, 140, 'boss');
    }
  }

  _kill(m, by, head, w) {
    if (!m.alive) return;
    m.alive = false; m.deadAt = performance.now(); m.hp = 0;
    const o = this.views.get(m.id), tg = this.tg || this._targets(), k = tg[by];
    if (o) this._died(o, k ? m.body.pos.x - k.x : 0, k ? m.body.pos.z - k.z : 0);
    if (by === 0 || by === 1) this.g.authority.hzKill(by, m.kind, !!head, w);
    if (this.kind === 'dm' && this.on) this.respawnQ.push(performance.now() + HORDE.BOT_RESPAWN * 1000);
  }

  // 玩家打中機器人（房主收到 'mobhit'，自己打的也走這裡）
  hit(by, d) {
    const m = this.byId.get(d.id | 0), dmg0 = +d.d;
    if (!m || !m.alive || !(dmg0 > 0)) return;
    const dmg = Math.min(dmg0, 600) * (m.def.armor || 1), dealt = Math.min(m.hp, dmg);
    m.hp -= dmg;
    this.g.authority.hzHit(by, dealt);
    if (by !== this.g.me) this.flash(m.id);
    m.aggro = by; m.aggroT = performance.now() + 4000;
    if (m.hp <= 0) this._kill(m, by, !!d.h, d.w);
  }
  // 爆炸把機器人炸飛（房主）
  kick(x, y, z, rad, k) {
    if (!this.host || !(rad > 0)) return;
    for (const m of this.mobs) {
      if (!m.alive) continue;
      const b = m.body, dx = b.pos.x - x, dy = b.pos.y + 0.9 - y, dz = b.pos.z - z, d = Math.hypot(dx, dy, dz);
      if (d < rad && d > 0.01) { const f = (1 - d / rad) * k / d / m.s; b.vel.x += dx * f; b.vel.y += dy * f + 2; b.vel.z += dz * f; b.onGround = false; }
    }
  }
  // 閃光彈：看得到、面向它的機器人會瞎一陣子不開槍
  onFlash(x, y, z) {
    if (!this.host) return;
    const w = this.g.world, now = performance.now();
    for (const m of this.mobs) {
      if (!m.alive) continue;
      const b = m.body, ex = b.pos.x, ey = b.pos.y + PLAYER.EYE * m.s, ez = b.pos.z;
      let dx = x - ex, dy = y - ey, dz = z - ez; const dist = Math.hypot(dx, dy, dz) || 0.01;
      if (dist > 30) continue;
      dx /= dist; dy /= dist; dz /= dist;
      if (dist > 0.8 && w.raycast(ex, ey, ez, dx, dy, dz, dist - 0.5)) continue;
      const dot = -Math.sin(b.yaw) * dx - Math.cos(b.yaw) * dz;
      m.blindUntil = now + (0.4 + 3 * (dot > 0.3 ? 1 : dot > -0.35 ? 0.55 : 0.2) * clamp(1.2 - dist / 24, 0.2, 1)) * 1000;
      m.vis[0] = m.vis[1] = false; m.reactAt = m.blindUntil;
    }
  }

  // ───────── 訪客：收到房主的同步 ─────────
  onSnap(d) {
    if (!this.on || !d || d.r !== this.round || !Array.isArray(d.a) || d.a.length > 10 * 64) return;
    const now = performance.now(), a = d.a;
    for (let i = 0; i + 9 < a.length; i += 10) {
      const id = a[i] | 0, kind = MOB_IDS[a[i + 1]], wid = WIDS[a[i + 8]] || 'ar';
      if (!kind || id <= 0 || ![a[i + 2], a[i + 3], a[i + 4], a[i + 5], a[i + 6]].every((v) => Number.isFinite(v) && Math.abs(v) < 500)) continue;
      const fresh = !this.views.has(id), o = this._view(id, kind, wid), f = a[i + 7] | 0;
      o.seen = now; o.hp = clamp(+a[i + 9] || 0, 0, 100) / 100;
      if (fresh) { o.v.pos.set(a[i + 2], a[i + 3], a[i + 4]); o.v.lastPos.copy(o.v.pos); this.g.skills.nova(a[i + 2], a[i + 3] + 0.05, a[i + 4], 0xff4030, 1.5 * (MOBS[kind].scale || 1), 0.5); }
      if (f & 4) { if (!o.alive) continue; o.v.push([a[i + 2], a[i + 3], a[i + 4], a[i + 5], a[i + 6], wid, f & 3]); if (o.w !== wid) { o.w = wid; o.v.setWeapon(wid, 'stock'); o.v._lit(); } }
      else if (o.alive) { const p = this.g.player.pos; this._died(o, o.v.pos.x - p.x, o.v.pos.z - p.z); }
    }
  }
  onFire(d) {
    if (!this.on || !d || d.r !== this.round || !Array.isArray(d.e) || d.e.length > 60 || !d.e.every(Number.isFinite)) return;
    this._shotFx(d.id | 0, d.w, d.e);
  }
  onWarn(d) { if (this.on && d && d.r === this.round && Array.isArray(d.p) && d.p.length === 3 && d.p.every(Number.isFinite)) this.warn(d.p, clamp(+d.d || 1.4, 0.3, 3)); }

  // ───────── 每一幀（兩邊）─────────
  update(dt, now) {
    if (!this.on) return;
    const g = this.g;
    if (this.host) this.simulate(dt, now);
    else {
      for (const [id, o] of this.views) if (now - o.seen > 1500) this._free(id);           // 房主那邊已經移除的
    }
    for (const o of this.views.values()) {
      if (!o.alive && o.deadAt && now - o.deadAt > 4000) { o.v.group.visible = false; continue; }
      o.v.update(dt);
    }
    // 據點：慢慢轉、被打到閃一下、血越少越紅
    if (this.core) {
      const hz = g.gs && g.gs.hz, f = hz && hz.coreMax ? clamp(hz.core / hz.coreMax, 0, 1) : 1, t = now * 0.001;
      const c = this.coreParts;
      c.gem.rotation.y = t * 0.9; c.ring1.rotation.z = t * 1.3; c.ring2.rotation.x = t * 1.1;
      c.gem.position.y = 1.55 + Math.sin(t * 2) * 0.08;
      this.coreHitT = Math.max(0, this.coreHitT - dt * 3);
      const col = _c.setRGB(lerp(1.6, 0.35, f), lerp(0.25, 1.15, f), lerp(0.2, 1.7, f));
      c.gemM.emissive.copy(col).multiplyScalar(1 + this.coreHitT * 3); c.ringM.color.copy(col).multiplyScalar(1.6);
      c.beamM.opacity = 0.18 + 0.1 * Math.sin(t * 3) + this.coreHitT * 0.3; c.beamM.color.copy(col);
      c.light.color.copy(col); c.light.intensity = 9 + this.coreHitT * 30;
    }
    // 砲擊的紅圈
    for (let i = 0; i < this.warnM.length; i++) {
      const m = this.warnM[i], w = m.userData;
      if (!m.visible) continue;
      const k = (now - w.t0) / (w.d * 1000);
      if (k >= 1) { m.visible = false; continue; }
      m.scale.setScalar(4.8 * (0.35 + 0.65 * k)); m.material.opacity = 0.35 + 0.5 * Math.abs(Math.sin(now * 0.02));
    }
  }
  coreHit() { this.coreHitT = 1; }

  warn(p, d) {
    const m = this.warnM.find((x) => !x.visible) || this.warnM[0];
    m.position.set(p[0], p[1] + 0.06, p[2]); m.userData = { t0: performance.now(), d }; m.visible = true;
    const g = this.g; g.sfx.skill('mark', Math.hypot(p[0] - g.camera.position.x, p[2] - g.camera.position.z), g.panOf(p[0], p[2]));
  }

  // 小地圖用：機器人的位置、據點、下一波從哪裡來
  mini() {
    const mobs = [];
    for (const o of this.views.values()) if (o.alive) mobs.push({ x: o.v.pos.x, z: o.v.pos.z, big: !!MOBS[o.kind].boss });
    return mobs;
  }

  // ───────── 模型 ─────────
  _buildCoreMesh() {
    const sc = this.g.scene, grp = this.coreG = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.45, metalness: 0.8 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.05, 0.5, 8), metal); base.position.y = 0.25;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 1.2, 8), metal); col.position.y = 0.95;
    const gemM = new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.15, metalness: 0.2, emissive: 0x58c8ff, emissiveIntensity: 1 });
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), gemM); gem.scale.set(1, 1.5, 1); gem.position.y = 1.55;
    const ringM = new THREE.MeshBasicMaterial({ color: 0x8fdcff, toneMapped: false });
    const ringG = new THREE.TorusGeometry(0.85, 0.03, 6, 48);
    const ring1 = new THREE.Mesh(ringG, ringM), ring2 = new THREE.Mesh(ringG, ringM); ring1.position.y = ring2.position.y = 1.55; ring2.scale.setScalar(0.8);
    const beamM = new THREE.MeshBasicMaterial({ color: 0x8fdcff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 60, 12, 1, true), beamM); beam.position.y = 31.5;   // 遠遠就看得到據點在哪
    const light = new THREE.PointLight(0x8fdcff, 9, 14, 2); light.position.y = 1.8;
    for (const m of [base, col, gem]) { m.castShadow = true; m.receiveShadow = true; }
    grp.add(base, col, gem, ring1, ring2, beam, light);
    grp.visible = false; sc.add(grp);
    this.coreParts = { gem, gemM, ring1, ring2, ringM, beamM, light };
  }
  _buildWarn() {
    const geo = new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
      m.material.color.multiplyScalar(2); m.visible = false; this.g.scene.add(m); this.warnM.push(m);
    }
  }
}
const _c = new THREE.Color();
