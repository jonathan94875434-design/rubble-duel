import * as THREE from 'three';
import { PLAYER } from './config.js';
import { Player } from './player.js';
import { Nav } from './nav.js';
import { WEAPONS } from './weapons.js';
import { SK } from './cards.js';
import { skyLitTree } from './skylit.js';
import { clamp, lerp, lerpAngle, r3, rayAABB } from './util.js';

// 召喚物（Roguelike 的召喚技能）：梁允猴（追人亂抓的小猴子）、gay tay（拿機槍的金色巨人）。
// 跟子彈一樣是「施放的人說了算」：自己這邊模擬（尋路、追對手、攻擊），每秒 12 次把位置用 'sk' 的 pets 訊息傳給對手畫出來；
// 對手打得到它們：打中時送 pethit 給主人扣血，打倒了主人再送 petdie，兩邊一起消失。召喚物打人走裁判的 'hit'（算施放者打的）。
// 每局開始清空；練習機器人不會召喚，但會被玩家的召喚物打。

const KIND = ['monkey', 'gaytay'];
const NAME = { monkey: '梁允猴', gaytay: 'gay tay' };
const SCALE = { monkey: 0.55, gaytay: 2.6 };
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

// 受擊判定盒（跟 horde.js 的一樣，多了體型 s）
function rayBody(ox, oy, oz, dx, dy, dz, px, py, pz, s) {
  const n = 1.42 * s, hw = 0.2 * s, bw = 0.33 * s;
  const th = rayAABB(ox, oy, oz, dx, dy, dz, px - hw, py + n, pz - hw, px + hw, py + n + 0.4 * s, pz + hw);
  const tb = rayAABB(ox, oy, oz, dx, dy, dz, px - bw, py, pz - bw, px + bw, py + n, pz + bw);
  if (th < 0 && tb < 0) return null;
  if (th >= 0 && (tb < 0 || th <= tb + 0.05)) return { t: th, head: true };
  return { t: tb, head: false };
}

// 小猴子的模型：全部用簡單形狀拼（身體、肚子、頭、臉、耳朵、眼睛、手腳、捲尾巴）
function buildMonkey() {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd7a777, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 0.4 });
  const sph = new THREE.SphereGeometry(1, 16, 12);
  const mesh = (geo, mat, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; g.add(m); return m; };
  const body = new THREE.Group(); g.add(body); g.userData.body = body;
  const add = (geo, mat, x, y, z, sx, sy, sz) => { const m = mesh(geo, mat, x, y, z, sx, sy, sz); g.remove(m); body.add(m); return m; };
  add(sph, fur, 0, 0.78, 0, 0.36, 0.42, 0.3);                 // 身體
  add(sph, skin, 0, 0.74, -0.2, 0.24, 0.3, 0.14);             // 肚子
  const head = new THREE.Group(); head.position.set(0, 1.32, -0.04); body.add(head); g.userData.head = head;
  const hm = (geo, mat, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; head.add(m); return m; };
  hm(sph, fur, 0, 0, 0, 0.3, 0.28, 0.28);                     // 頭
  hm(sph, skin, 0, -0.04, -0.16, 0.22, 0.18, 0.16);           // 臉
  hm(sph, skin, 0, -0.12, -0.25, 0.12, 0.08, 0.08);           // 嘴
  hm(sph, fur, -0.3, 0.04, 0, 0.1, 0.12, 0.05); hm(sph, fur, 0.3, 0.04, 0, 0.1, 0.12, 0.05);         // 耳朵
  hm(sph, skin, -0.31, 0.04, -0.02, 0.06, 0.07, 0.03); hm(sph, skin, 0.31, 0.04, -0.02, 0.06, 0.07, 0.03);
  hm(sph, dark, -0.08, 0.04, -0.29, 0.04, 0.05, 0.03); hm(sph, dark, 0.08, 0.04, -0.29, 0.04, 0.05, 0.03);   // 眼睛
  const limb = new THREE.CylinderGeometry(0.06, 0.05, 0.5, 8).translate(0, -0.25, 0);
  const mkLimb = (x, y, z) => { const p = new THREE.Group(); p.position.set(x, y, z); const m = new THREE.Mesh(limb, fur); m.castShadow = true; p.add(m); const h = new THREE.Mesh(sph, skin); h.scale.setScalar(0.075); h.position.y = -0.5; p.add(h); body.add(p); return p; };
  g.userData.limbs = [mkLimb(-0.34, 1.0, 0), mkLimb(0.34, 1.0, 0), mkLimb(-0.16, 0.48, 0), mkLimb(0.16, 0.48, 0)];
  // 捲起來的尾巴
  const curve = new THREE.CatmullRomCurve3([V(0, 0.55, 0.25), V(0, 0.45, 0.55), V(0, 0.7, 0.8), V(0, 1.0, 0.75), V(0, 1.08, 0.55), V(0, 0.95, 0.45)]);
  const tail = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.045, 6, false), fur); tail.castShadow = true; body.add(tail);
  return g;
}
function V(x, y, z) { return new THREE.Vector3(x, y, z); }

// 頭上的名牌：名字 + 血條（血量變了才重畫）
function nameTag(name, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 72;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.renderOrder = 40; sp.scale.set(1.6, 0.45, 1);
  const draw = (f) => {
    const x = c.getContext('2d'); x.clearRect(0, 0, 256, 72);
    x.font = '900 34px "Noto Sans TC", system-ui, sans-serif'; x.textAlign = 'center'; x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,0.85)'; x.fillStyle = '#fff';
    x.strokeText(name, 128, 36); x.fillText(name, 128, 36);
    x.fillStyle = 'rgba(0,0,0,0.7)'; x.fillRect(38, 48, 180, 14); x.fillStyle = color; x.fillRect(40, 50, 176 * clamp(f, 0, 1), 10);
    tex.needsUpdate = true;
  };
  draw(1); sp.userData.draw = draw; sp.userData.f = 1;
  return sp;
}

export class Pets {
  constructor(g) {
    this.g = g; this.mine = []; this.theirs = new Map(); this.nid = 1; this.sendAcc = 0; this.nav = null; this.shots = [];
  }

  clear() {
    for (const p of this.mine) this._dispose(p);
    for (const p of this.theirs.values()) this._dispose(p);
    this.mine = []; this.theirs.clear(); this.shots = [];
  }

  // ───────── 模型 ─────────
  _mkView(kind, mine) {
    const g = this.g, team = mine ? g.me : 1 - g.me, col = team === 0 ? '#ff7a3c' : '#3cc8ff';
    let v, grp;
    if (kind === 'gaytay') {
      v = g._mkDoll(0xffc24a); v.applySkin('gold', 0xffc24a); v.group.scale.setScalar(SCALE.gaytay); v.setWeapon('lmg', 'gold'); v._lit();
      v.clearBuffer(); if (v.revive) v.revive(); v.alive = true; v.group.visible = true; grp = v.group;
    } else {
      grp = buildMonkey(); grp.scale.setScalar(SCALE.monkey); g.scene.add(grp); skyLitTree(grp, g.world);
    }
    const tag = nameTag(NAME[kind], col); g.scene.add(tag);
    return { v, grp, tag, kind };
  }
  _dispose(p) {
    const g = this.g;
    if (p.view.v) { p.view.v.group.visible = false; p.view.v.alive = false; g.scene.remove(p.view.v.group); }
    else g.scene.remove(p.view.grp);
    g.scene.remove(p.view.tag); p.view.tag.material.map.dispose(); p.view.tag.material.dispose();
  }

  // ───────── 召喚（自己放的）─────────
  spawn(kind) {
    const g = this.g, P = g.player, S = SK[kind];
    if (!g.remote.alive) return false;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    const body = new Player(g.world);
    body.spawn({ x: P.pos.x + fx * 1.6, y: P.pos.y + 0.2, z: P.pos.z + fz * 1.6, yaw: P.yaw });
    if (body.collides(body.pos.x, body.pos.y, body.pos.z)) body.spawn({ x: P.pos.x, y: P.pos.y + 0.2, z: P.pos.z, yaw: P.yaw });
    const n = this.nid++;
    const p = { n, kind, body, hp: S.hp, max: S.hp, end: performance.now() + S.time * 1000, atkAt: 0, stompAt: 0, path: null, pi: 0, planAt: 0, view: this._mkView(kind, true), anim: 0, lunge: 0 };
    this.mine.push(p);
    this._poof(body.pos.x, body.pos.y, body.pos.z, kind === 'gaytay' ? 3 : 1.2);
    g.sfx.skill(kind === 'gaytay' ? 'dome' : 'blink');
    this.sendAcc = 1;                                                // 下一幀馬上同步一次
    return true;
  }

  // ───────── 每一幀 ─────────
  update(dt, now) {
    const g = this.g, live = g.phase === 'playing';
    if (!this.nav && this.mine.length) this.nav = new Nav(g.world);
    for (let i = this.mine.length - 1; i >= 0; i--) {
      const p = this.mine[i];
      if (!live || now >= p.end || p.hp <= 0) { this._kill(p, true); this.mine.splice(i, 1); continue; }
      this._think(p, dt, now);
      const b = p.body;
      this._pose(p.view, b.rpos.x, b.rpos.y, b.rpos.z, b.yaw, dt, b.speed2d ? b.speed2d() : 0, p.hp / p.max, p.lunge, now);
      p.lunge = Math.max(0, p.lunge - dt * 4);
    }
    // 同步給對手
    this.sendAcc += dt;
    if (this.mine.length && this.sendAcc >= 1 / 12) {
      this.sendAcc = 0;
      const l = [];
      for (const p of this.mine) l.push(p.n, KIND.indexOf(p.kind), r3(p.body.pos.x), r3(p.body.pos.y), r3(p.body.pos.z), r3(p.body.yaw), Math.ceil(p.hp), p.max, p.lunge > 0.3 ? 1 : 0);
      g.sendPeer('sk', { r: g.round, id: 'pets', l, sh: this.shots.splice(0, 24) });
    } else if (!this.mine.length) this.shots.length = 0;
    // 對手的召喚物：內插到收到的位置；太久沒收到就收掉
    for (const [n, p] of this.theirs) {
      if (now - p.seen > 1500 || !live) { this._kill(p, false); this.theirs.delete(n); continue; }
      const k = Math.min(1, dt * 12);
      p.x = lerp(p.x, p.tx, k); p.y = lerp(p.y, p.ty, k); p.z = lerp(p.z, p.tz, k); p.yaw = lerpAngle(p.yaw, p.tyaw, k);
      const spd = Math.hypot(p.tx - p.x, p.tz - p.z) * 12;
      this._pose(p.view, p.x, p.y, p.z, p.yaw, dt, spd, p.hp / p.max, p.lunge, now);
      p.lunge = Math.max(0, p.lunge - dt * 4);
    }
  }

  // 召喚物的腦袋：沿著路追對手；猴子貼臉亂抓，巨人遠距離掃射、靠近了踩地
  _think(p, dt, now) {
    const g = this.g, b = p.body, rm = g.remote, S = SK[p.kind];
    const tx = rm.pos.x, ty = rm.pos.y, tz = rm.pos.z, alive = rm.alive;
    const dx = tx - b.pos.x, dz = tz - b.pos.z, dh = Math.hypot(dx, dz), dist = Math.hypot(dh, ty - b.pos.y);
    const eye = b.pos.y + (p.kind === 'gaytay' ? 3.6 : 0.8);
    let los = false;
    if (alive) { const ddx = tx - b.pos.x, ddy = ty + 1.1 - eye, ddz = tz - b.pos.z, dd = Math.hypot(ddx, ddy, ddz) || 1; los = !g.world.raycast(b.pos.x, eye, b.pos.z, ddx / dd, ddy / dd, ddz / dd, dd); }
    let wx = 0, wz = 0, jump = false;
    const stop = p.kind === 'gaytay' ? (los && dist < 14) : dh < 0.9;
    if (alive && !stop) {
      if (los && Math.abs(ty - b.pos.y) < 1.2) { wx = dx / (dh || 1); wz = dz / (dh || 1); }
      else {
        if (!p.path || now >= p.planAt) { p.path = this.nav.path(b.pos.x, b.pos.y, b.pos.z, tx, ty, tz); p.pi = p.path && p.path.length > 1 ? 1 : 0; p.planAt = now + 700; }
        const w = p.path && p.path[p.pi];
        if (w) {
          if (Math.hypot(w.x - b.pos.x, w.z - b.pos.z) < 0.35 && p.pi < p.path.length - 1) p.pi++;
          const ww = p.path[p.pi], ex = ww.x - b.pos.x, ez = ww.z - b.pos.z, ed = Math.hypot(ex, ez) || 1;
          wx = ex / ed; wz = ez / ed; jump = b.onGround && ww.y - b.pos.y > 0.4;
        } else { wx = dx / (dh || 1); wz = dz / (dh || 1); }
      }
      // 被卡住就跳一下
      if (b.onGround && b.speed2d && b.speed2d() < 0.5 && (wx || wz)) jump = true;
    }
    const face = alive ? Math.atan2(-dx, -dz) : b.yaw;
    b.yaw = (wx || wz) ? Math.atan2(-wx, -wz) : lerpAngle(b.yaw, face, Math.min(1, dt * 8));
    b.update(dt, { f: (wx || wz) ? 1 : 0, r: 0, jump, crouch: false, speed: S.speed });
    if (b.pos.y < -10) p.hp = 0;
    if (!alive) return;
    if (p.kind === 'monkey') {
      if (dist < 1.6 && now >= p.atkAt) {                            // 抓：貼臉才打得到
        p.atkAt = now + S.rate * 1000; p.lunge = 1;
        this._hit(S.dmg, 'monkey');
        g.sfx.knifeHit(true);
      }
    } else {
      if (dist < S.stompR && now >= p.stompAt) {                     // 踩地：把附近的人震飛
        p.stompAt = now + S.stompCd * 1000; p.lunge = 1;
        const msg = { r: g.round, pid: 0, p: [r3(b.pos.x), r3(b.pos.y + 1), r3(b.pos.z)], br: 2.2, bp: 300, rad: S.stompR, k: 20, fxk: 'shock', own: g.me };
        g.sendPeer('expl', msg); g.doExplosion(msg);
        this._hit(S.stomp * (1 - dist / S.stompR * 0.6), 'gaytay');
      } else if (los && dist < S.range && now >= p.atkAt) {          // 機槍：越遠越不準
        p.atkAt = now + S.rate * 1000;
        const hit = Math.random() < clamp(1.1 - dist / 32, 0.15, 0.75);
        const mx = b.pos.x - Math.sin(b.yaw) * 1.2 + Math.cos(b.yaw) * 0.6, my = b.pos.y + 3.2, mz = b.pos.z - Math.cos(b.yaw) * 1.2 - Math.sin(b.yaw) * 0.6;
        const ex = tx + (hit ? 0 : (Math.random() - 0.5) * 3), ey = ty + 1.1 + (hit ? 0 : (Math.random() - 0.5) * 2), ez = tz + (hit ? 0 : (Math.random() - 0.5) * 3);
        this._shot(mx, my, mz, ex, ey, ez);
        this.shots.push(r3(mx), r3(my), r3(mz), r3(ex), r3(ey), r3(ez));
        if (hit) this._hit(S.dmg, 'gaytay');
      }
    }
  }
  _hit(d, w) { const g = this.g; g.auth('hit', { r: g.round, d, h: false, w }); g.remote.hitFlash(); }
  _shot(ax, ay, az, bx, by, bz) {
    const g = this.g, cam = g.camera.position;
    g.fx.tracer(_a.set(ax, ay, az), _b.set(bx, by, bz), 0xffd27a, 0.06, 0.08);
    g.sfx.shot(WEAPONS.lmg.snd, Math.max(1, Math.hypot(ax - cam.x, az - cam.z)), g.panOf(ax, az));
  }

  // 畫出來：猴子跑步擺手腳、撲人；巨人用角色模型的動畫
  _pose(view, x, y, z, yaw, dt, speed, hpF, lunge, now) {
    if (view.v) {
      view.v.push([x, y, z, yaw, 0, 'lmg', 2]); view.v.update(dt);
    } else {
      const grp = view.grp, run = Math.min(1, speed / 6), t = now / 1000;
      grp.position.set(x, y + Math.abs(Math.sin(t * 14)) * 0.12 * run, z); grp.rotation.y = yaw;
      const L = grp.userData.limbs, sw = Math.sin(t * 14) * 0.9 * run;
      L[0].rotation.x = sw - lunge * 2.2; L[1].rotation.x = -sw - lunge * 2.2; L[2].rotation.x = -sw; L[3].rotation.x = sw;
      grp.userData.body.rotation.x = -0.25 * run - lunge * 0.5;
      grp.userData.head.rotation.z = Math.sin(t * 7) * 0.12;
    }
    const h = view.kind === 'gaytay' ? 5.6 : 1.15;
    view.tag.position.set(x, y + h, z);
    if (Math.abs(view.tag.userData.f - hpF) > 0.01) { view.tag.userData.f = hpF; view.tag.userData.draw(hpF); }
  }

  _poof(x, y, z, s) {
    const fx = this.g.fx;
    fx.smoke(x, y + 0.4 * s, z, 3, 0.25 * s);
    for (let i = 0; i < 18; i++) { const a = Math.random() * 6.283; fx.glowP.spawn(x, y + 0.6 * s, z, Math.cos(a) * 3 * s, Math.random() * 3, Math.sin(a) * 3 * s, 0.2 * s, 0.03, 0.4, 6, 4.5, 1.5, 0.9, 0, 2); }
  }
  // 消失（時間到或被打倒）：mine = 是我的，要通知對手
  _kill(p, mine) {
    const pos = mine ? p.body.pos : { x: p.x, y: p.y, z: p.z };
    this._poof(pos.x, pos.y, pos.z, p.kind === 'gaytay' ? 2.5 : 1);
    this._dispose(p);
    if (mine) this.g.sendPeer('sk', { r: this.g.round, id: 'petdie', n: p.n });
  }

  // ───────── 被打（對手的召喚物才打得到）─────────
  rayHit(ox, oy, oz, dx, dy, dz) {
    let best = null;
    for (const [n, p] of this.theirs) {
      const h = rayBody(ox, oy, oz, dx, dy, dz, p.x, p.y, p.z, SCALE[p.kind] * (p.kind === 'monkey' ? 1.4 : 1));
      if (h && (!best || h.t < best.t)) best = { t: h.t, head: h.head, id: 'pet' + n };
    }
    return best;
  }
  each(fn) { for (const [n, p] of this.theirs) fn('pet' + n, { x: p.x, y: p.y, z: p.z }, SCALE[p.kind]); }
  yawOf(id) { const p = this.theirs.get(+String(id).slice(3)); return p ? p.yaw : 0; }
  hit(id, d, head) {
    const n = +String(id).slice(3), p = this.theirs.get(n); if (!p) return;
    const dmg = d * (head ? 1.5 : 1);
    p.hp = Math.max(0, p.hp - dmg);                                  // 先在自己這邊扣（血條馬上動），真正的血量以主人那邊為準
    if (p.view.v) p.view.v.hitFlash();
    this.g.sendPeer('sk', { r: this.g.round, id: 'pethit', n, d: r3(dmg) });
  }

  // ───────── 網路 ─────────
  onNet(d) {
    const g = this.g, now = performance.now();
    if (d.id === 'pets' && Array.isArray(d.l)) {
      const l = d.l;
      for (let i = 0; i + 8 < l.length; i += 9) {
        const n = l[i] | 0, kind = KIND[l[i + 1] | 0], vals = l.slice(i + 2, i + 9);
        if (!kind || !vals.every(Number.isFinite)) continue;
        let p = this.theirs.get(n);
        if (!p) { p = { n, kind, view: this._mkView(kind, false), x: vals[0], y: vals[1], z: vals[2], yaw: vals[3], lunge: 0 }; this.theirs.set(n, p); this._poof(p.x, p.y, p.z, kind === 'gaytay' ? 3 : 1.2); }
        p.tx = vals[0]; p.ty = vals[1]; p.tz = vals[2]; p.tyaw = vals[3]; p.hp = clamp(vals[4], 0, 5000); p.max = clamp(vals[5], 1, 5000); if (vals[6]) p.lunge = 1; p.seen = now;
      }
      const sh = Array.isArray(d.sh) ? d.sh : [];
      for (let i = 0; i + 5 < sh.length && i < 144; i += 6) if (sh.slice(i, i + 6).every(Number.isFinite)) this._shot(sh[i], sh[i + 1], sh[i + 2], sh[i + 3], sh[i + 4], sh[i + 5]);
    } else if (d.id === 'petdie') {
      const p = this.theirs.get(d.n | 0); if (p) { this._kill(p, false); this.theirs.delete(d.n | 0); }
    } else if (d.id === 'pethit') {
      const p = this.mine.find((q) => q.n === (d.n | 0)); if (!p) return;
      p.hp -= clamp(+d.d || 0, 0, 400);
      if (p.view.v) p.view.v.hitFlash();
    }
  }
}

export const PET_NAME = NAME;
