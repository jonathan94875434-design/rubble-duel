import * as THREE from 'three';
import { BS, PLAYER } from './config.js';
import { WEAPONS, THROWABLES, NADE_IDS, projDef, falloff } from './weapons.js';
import { BLOCK } from './world.js';
import { buffMods } from './buffs.js';
import * as GM from './gunmodel.js';
import { lerp, r3 } from './util.js';

const DEG = Math.PI / 180;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
const PROJ_GEO = new THREE.CylinderGeometry(0.05, 0.05, 0.34, 10).rotateX(Math.PI / 2), NADE_GEO = new THREE.SphereGeometry(0.07, 10, 8);
const PROJ_MAT = {
  rocket: new THREE.MeshStandardMaterial({ color: 0x4a5236, roughness: 0.5, metalness: 0.4, emissive: 0xff7a20, emissiveIntensity: 0.6 }),
  gl: new THREE.MeshStandardMaterial({ color: 0x7a8a3a, roughness: 0.5, metalness: 0.5 }),
  nade: new THREE.MeshStandardMaterial({ color: 0x3f5a2c, roughness: 0.6, metalness: 0.3 }),
};
// 刀的判定：正中間 + 上下左右各偏一點，揮刀不用瞄得像開槍那麼準
const MELEE_RAYS = [[0, 0], [0.13, 0], [-0.13, 0], [0, 0.11], [0, -0.11]];

// 本機玩家的開槍、換彈、切槍、揮刀，以及所有拋射物與火焰（自己的 + 對手的畫面）
export class Combat {
  constructor(g) {
    this.g = g;
    this.slots = []; this.cur = 0; this.last = 1; this.mods = buffMods([]);
    this.bloom = 0; this.recP = 0; this.recY = 0; this.ads = 0;
    this.switchEnd = 0; this.switchDur = 350; this.fireQueued = 0; this.lastShotT = 0; this.prevShotT = 0;
    this.projectiles = []; this.pid = 1; this.blkOut = []; this.fires = [];
    this.shots = 0; this.hits = 0; this.shotIdx = 0;
    this.nades = { he: 0, flash: 0, smoke: 0, molotov: 0 }; this.throwAt = 0;
  }

  get w() { return this.slots[this.cur]; }

  // lo = { p 主武器（可能沒買 = null）, s 副武器, he/flash/smoke/molotov 數量 }。第三格固定是刀。
  // 場上飛到一半的拋射物和還在燒的火不會被清掉（熱身中重生、換裝備時它們要繼續存在）；開新的一局由 main.js 另外清
  setLoadout(lo, buffs) {
    this.mods = buffMods(buffs);
    const mk = (id) => {
      if (!id) return null;
      const def = WEAPONS[id], mag = def.melee ? 1 : Math.round(def.mag * this.mods.mag);
      return { id, def, mag, ammo: mag, reserve: def.reserve === undefined ? Infinity : def.reserve, nextFire: 0, reloadEnd: 0, reloadStart: 0 };
    };
    this.slots = [mk(lo.p), mk(lo.s), mk('knife')];
    this.cur = this.slots[0] ? 0 : 1; this.last = this.slots[0] ? 1 : 2;
    for (const k of NADE_IDS) this.nades[k] = lo[k] | 0;
    this.throwAt = 0;
    this.bloom = 0; this.recP = this.recY = 0; this.ads = 0; this.switchEnd = 0; this.fireQueued = 0;
    this.g.view.setWeapon(this.w.id, this.g.settings.wskin);
  }

  // 丟投擲物：朝準星方向丟出去，帶一點往上的弧度和自己的移動速度
  throwNade(kind) {
    const g = this.g, now = performance.now(), def = THROWABLES[kind];
    if (!def || this.nades[kind] <= 0 || now < this.throwAt) return false;
    this.nades[kind]--; this.throwAt = now + 700;
    if (this.w) this.w.reloadEnd = 0;
    this.switchDur = 380; this.switchEnd = now + 380; this.ads = 0;   // 丟的時候槍會放下一下
    const e = g.camera.matrixWorld.elements, fx = -e[8], fy = -e[9], fz = -e[10], pv = g.player.vel, sp = def.proj.speed;
    const pid = (g.me + 1) * 100000 + this.pid++;
    const o = [r3(e[12] + fx * 0.45 + e[0] * 0.12), r3(e[13] + fy * 0.45 - 0.1), r3(e[14] + fz * 0.45 + e[2] * 0.12)];
    const v = [r3(fx * sp + pv.x * 0.5), r3(fy * sp + 3 + Math.max(0, pv.y) * 0.3), r3(fz * sp + pv.z * 0.5)];
    this.spawnProjectile(kind, pid, o, v, true);
    g.sendPeer('fire', { w: kind, pid, o, v });
    if (g.view.throw) g.view.throw(kind);
    g.sfx.throw();
    return true;
  }

  clearProjectiles() {
    for (const p of this.projectiles) this.g.scene.remove(p.mesh);
    this.projectiles.length = 0;
    this.fires.length = 0;
  }

  switchTo(i) {
    if (i === this.cur || !this.slots[i]) return;
    this.w.reloadEnd = 0;
    this.last = this.cur; this.cur = i; this.ads = 0;
    this.switchDur = (this.w.def.melee ? 220 : 350) * this.mods.handling;
    this.switchEnd = performance.now() + this.switchDur;
    this.g.view.setWeapon(this.w.id, this.g.settings.wskin);
    this.g.sfx.swap();
  }
  switchLast() { this.switchTo(this.slots[this.last] ? this.last : this.cur === 1 ? 2 : 1); }
  // 滾輪：往下一把有的武器
  cycle(dir = 1) { for (let k = 1; k <= 3; k++) { const i = (this.cur + dir * k + 6) % 3; if (this.slots[i]) { this.switchTo(i); return; } } }

  reload() {
    const w = this.w, now = performance.now();
    if (!w || w.def.melee || w.reloadEnd || w.ammo >= w.mag || w.reserve <= 0 || now < this.switchEnd) return;
    w.reloadStart = now; w.reloadEnd = now + w.def.reload * 1000 * this.mods.handling;
    this.g.sfx.reload(0, w.def.snd.kind);
  }

  reloadProgress() { const w = this.w; if (!w || !w.reloadEnd) return 0; return Math.min(1, (performance.now() - w.reloadStart) / (w.reloadEnd - w.reloadStart)); }
  drawProgress() { const left = this.switchEnd - performance.now(); return left <= 0 ? 1 : 1 - left / this.switchDur; }

  // 目前的散布（度）。CS 式：站定最準、蹲下更準，跑動和跳躍會散；速度降到三成以下就算停住（急停）
  spread() {
    const w = this.w; if (!w || w.def.melee) return 1;
    const def = w.def, p = this.g.player, mv = def.mv === undefined ? 1.6 : def.mv;
    const sp = Math.min(1.4, p.speed2d() / PLAYER.SPEED);
    let s = lerp(def.spread[0], def.spread[1], this.ads)
      + this.bloom * (1 - this.ads * 0.5)
      + (Math.max(0, sp - 0.3) / 0.7) * mv * (1 - this.ads * 0.3)
      + (p.onGround ? 0 : 1.5 + mv * 1.3);
    if (p.crouched && p.onGround) s *= 0.75;
    return s * this.mods.spread;
  }

  // inp: { fire, firePressed, ads, adsPressed, reload }
  update(dt, inp, canFire) {
    const now = performance.now(), w = this.w, g = this.g;
    if (!w) return;
    if (w.reloadEnd && now >= w.reloadEnd) {
      const take = Math.min(w.mag - w.ammo, w.reserve);
      w.ammo += take; w.reserve -= take; w.reloadEnd = 0; g.sfx.reload(1, w.def.snd.kind);
    }
    const busy = now < this.switchEnd || w.reloadEnd > 0;
    const wantAds = inp.ads && !busy && canFire && !w.def.melee ? 1 : 0;
    this.ads += Math.sign(wantAds - this.ads) * Math.min(Math.abs(wantAds - this.ads), dt * 8);

    this.bloom = Math.max(0, this.bloom - dt * (2.2 + this.bloom * 3));
    if (now - this.lastShotT > 90) { const k = Math.min(1, dt * 7); this.recP -= this.recP * k; this.recY -= this.recY * k; }

    if (w.def.melee) {
      // 刀：左鍵快砍，瞄準鍵（右鍵／Shift）重刺
      if (canFire && !busy && now >= w.nextFire && (inp.fire || inp.ads)) this.melee(w, now, !inp.fire);
    } else {
      if (inp.firePressed) this.fireQueued = now + 160;
      const trig = w.def.auto ? inp.fire : this.fireQueued > now;
      if (canFire && trig && !busy && now >= w.nextFire) {
        if (w.ammo > 0) { this.fireQueued = 0; this.fire(w, now); }
        else { this.fireQueued = 0; if (w.reserve <= 0 && inp.firePressed) g.sfx.dry(); }
      }
      if (w.ammo === 0 && w.reserve > 0 && !w.reloadEnd && now >= w.nextFire && now >= this.switchEnd) this.reload();
      if (inp.reload) this.reload();
    }
    this.updateFires(now);
    if (this.blkOut.length) { g.sendPeer('blk', { r: g.round, h: this.blkOut }); this.blkOut = []; }
  }

  // ───────── 刀 ─────────
  melee(w, now, heavy) {
    const def = w.def, g = this.g, e = g.camera.matrixWorld.elements;
    const rx = e[0], ry = e[1], rz = e[2], ux = e[4], uy = e[5], uz = e[6], fx = -e[8], fy = -e[9], fz = -e[10];
    const ox = e[12], oy = e[13], oz = e[14];
    w.nextFire = now + 60000 / (heavy ? def.heavyRpm : def.rpm); this.lastShotT = now;
    if (g.view.melee) g.view.melee(heavy);
    g.sfx.knifeSwing();
    g.sendPeer('fire', { w: 'knife', hv: heavy ? 1 : 0 });
    let best = null;
    for (const [sx, sy] of MELEE_RAYS) {
      let dx = fx + rx * sx + ux * sy, dy = fy + ry * sx + uy * sy, dz = fz + rz * sx + uz * sy;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const ph = g.remote.rayHit(ox, oy, oz, dx, dy, dz);
      if (!ph || ph.t > def.reach || (best && ph.t >= best.t)) continue;
      if (g.world.raycast(ox, oy, oz, dx, dy, dz, ph.t)) continue;     // 中間隔著牆
      best = { t: ph.t, dx, dy, dz };
    }
    if (best) {
      // 背刺：對手的面向跟我差不多同方向 = 我在他背後
      const ry2 = g.remote.yaw, fl = Math.hypot(fx, fz) || 1, back = (-Math.sin(ry2) * fx - Math.cos(ry2) * fz) / fl > 0.45;
      const dmg = (heavy ? (back ? def.back : def.heavy) : def.dmg * (back ? 2 : 1)) * this.mods.dmg;
      g.fx.hitSpark(ox + best.dx * best.t, oy + best.dy * best.t, oz + best.dz * best.t, 0, 9);
      g.auth('hit', { r: g.round, d: dmg, h: false, w: 'knife', bk: back ? 1 : 0 });
      g.hud.hitmarker(back); g.sfx.knifeHit(true); g.remote.hitFlash();
      g.shake = Math.min(1, g.shake + 0.25);
      return;
    }
    const bh = g.world.raycast(ox, oy, oz, fx, fy, fz, def.reach);
    if (!bh) return;
    _b.set(ox + fx * bh.dist, oy + fy * bh.dist, oz + fz * bh.dist);
    g.sfx.knifeHit(false);
    if (bh.oob) return;
    const dmg = Math.round((heavy ? def.heavy : def.dmg) * def.block * this.mods.block);
    const res = g.world.damage(bh.x, bh.y, bh.z, dmg);
    this.blkOut.push(g.world.idx(bh.x, bh.y, bh.z), dmg);
    if (res && res.destroyed) { g.fx.debris(bh.x, bh.y, bh.z, res.type); g.sfx.blockBreak(bh.dist); }
    else g.fx.impact(_b.x, _b.y, _b.z, bh.nx, bh.ny, bh.nz, bh.type, 3);
  }

  // ───────── 開槍 ─────────
  fire(w, now) {
    const def = w.def, g = this.g, e = g.camera.matrixWorld.elements;
    const rx = e[0], ry = e[1], rz = e[2], ux = e[4], uy = e[5], uz = e[6], fx = -e[8], fy = -e[9], fz = -e[10];
    const ox = e[12], oy = e[13], oz = e[14];
    w.ammo--; w.nextFire = now + 60000 / def.rpm; this.lastShotT = now; this.shots++;
    const spr = this.spread() * DEG;
    const k = 1 - this.ads;
    _a.set(ox + rx * 0.13 * k - ux * 0.1 + fx * 0.75, oy + ry * 0.13 * k - uy * 0.1 + fy * 0.75, oz + rz * 0.13 * k - uz * 0.1 + fz * 0.75);

    if (def.proj) {
      const s = def.proj.speed, pid = (g.me + 1) * 100000 + this.pid++;
      const o = [r3(ox + fx * 0.5), r3(oy + fy * 0.5 - 0.08), r3(oz + fz * 0.5)], v = [r3(fx * s), r3(fy * s + (def.proj.gravity ? 2.2 : 0)), r3(fz * s)];
      this.spawnProjectile(w.id, pid, o, v, true);
      g.sendPeer('fire', { w: w.id, pid, o, v });
    } else {
      const ends = [], pen = def.pen || 0;
      let total = 0, head = false, hitAny = false, wb = false, snd = false;
      for (let i = 0; i < def.pellets; i++) {
        const ang = Math.tan(spr * Math.sqrt(Math.random())), th = Math.random() * Math.PI * 2;
        const sx = ang * Math.cos(th), sy = ang * Math.sin(th);
        let dx = fx + rx * sx + ux * sy, dy = fy + ry * sx + uy * sy, dz = fz + rz * sx + uz * sy;
        const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
        // 子彈一路穿過去：pr.hits 是沿途碰到的每一格方塊，pr.end 是最後停下來的距離
        const pr = g.world.pierce(ox, oy, oz, dx, dy, dz, 200, pen);
        const ph = g.remote.rayHit(ox, oy, oz, dx, dy, dz);
        let end = pr.end;
        if (ph && ph.t < pr.end) {
          let left = pen, walls = 0;
          for (const h of pr.hits) if (h.dist < ph.t && h.left >= 0) { left = h.left; walls++; }
          const mul = walls && pen > 0 ? Math.pow(Math.max(0.05, left / pen), 0.7) : 1;   // 穿牆之後傷害打折
          total += def.dmg * falloff(def, ph.t) * (ph.head ? def.head : 1) * this.mods.dmg * mul;
          head = head || ph.head; hitAny = true; wb = wb || walls > 0; end = ph.t;
          g.fx.hitSpark(ox + dx * end, oy + dy * end, oz + dz * end, 0, def.pellets > 1 ? 3 : 7);
        }
        let km = 1;
        for (const h of pr.hits) {
          if (h.dist > end + 0.01) break;
          const px = ox + dx * h.dist, py = oy + dy * h.dist, pz = oz + dz * h.dist;
          if (h.oob) { if (h.first) g.fx.impact(px, py, pz, h.nx, h.ny, h.nz, h.type, 2); break; }
          const dmg = Math.round(def.dmg * def.block * this.mods.block * km), ci = g.world.idx(h.x, h.y, h.z);
          const res = g.world.damage(h.x, h.y, h.z, dmg);
          this.blkOut.push(ci, dmg);
          if (res && res.destroyed) { g.fx.debris(h.x, h.y, h.z, res.type); g.sfx.blockBreak(h.dist); }
          else if (h.first) {
            g.fx.impact(px, py, pz, h.nx, h.ny, h.nz, h.type, def.pellets > 1 ? 2 : 4);
            g.fx.hole(px, py, pz, h.nx, h.ny, h.nz, ci);
            if (!snd) { snd = true; g.sfx.impact(BLOCK[h.type].surf, h.dist, g.panOf(px, pz)); }
          }
          // 穿出去的那一面也噴一點灰
          if (h.left >= 0 && h.exit && h.exit < end) g.fx.impact(ox + dx * h.exit, oy + dy * h.exit, oz + dz * h.exit, dx, dy, dz, h.type, 2);
          if (h.left >= 0 && pen > 0) km = Math.pow(Math.max(0.05, h.left / pen), 0.7);
        }
        _b.set(ox + dx * end, oy + dy * end, oz + dz * end);
        ends.push(r3(_b.x), r3(_b.y), r3(_b.z));
        g.fx.tracer(_a, _b);
      }
      g.sendPeer('fire', { w: w.id, e: ends });
      if (hitAny) {
        this.hits++;
        g.auth('hit', { r: g.round, d: total, h: head, w: w.id, wb: wb ? 1 : 0 });
        g.hud.hitmarker(head); g.sfx.hit(head); g.remote.hitFlash();
      }
    }

    // 後座力軌跡：前幾發往上爬，之後改成固定節奏的左右擺（可以練壓槍）；蹲下、瞄準時較小
    if (now - this.prevShotT > 320) this.shotIdx = 0;
    this.prevShotT = now;
    const n = this.shotIdx++;
    const ak = (this.ads > 0.5 ? 0.75 : 1) * (g.player.crouched && g.player.onGround ? 0.85 : 1) * this.mods.recoil;
    const vk = n === 0 ? 0.6 : n < 9 ? 1 : 0.4, hk = n < 3 ? 0.3 : 1.5;
    this.recP = Math.min(14 * DEG, this.recP + def.recoil[0] * DEG * vk * ak);
    this.recY += (Math.sin(n * 0.62 + def.dmg) * hk + (Math.random() - 0.5) * 0.5) * def.recoil[1] * DEG * ak;
    this.bloom = Math.min(3.5, this.bloom + def.bloom);
    g.view.fire(def.pellets > 1 || def.dmg >= 50);
    g.sfx.shot(def.snd);
    if (!def.proj && def.snd.kind !== 'shotgun' && w.id !== 'revolver') g.sfx.shell(0.32 + Math.random() * 0.1);
    g.fx.flashLight(_a.x, _a.y, _a.z);
    g.shake = Math.min(1, g.shake + def.recoil[0] * 0.05);
  }

  // ───────── 拋射物 ─────────
  spawnProjectile(id, pid, o, v, local) {
    const def = projDef(id);
    if (!def || !def.proj) return;
    let mesh;
    if (def.kind && GM.buildProp) { mesh = GM.buildProp(id); mesh.traverse((m) => { if (m.isMesh) m.castShadow = true; }); }
    else { mesh = new THREE.Mesh(def.kind ? NADE_GEO : PROJ_GEO, PROJ_MAT[id] || PROJ_MAT.nade); mesh.castShadow = true; }
    mesh.position.set(o[0], o[1], o[2]);
    this.g.scene.add(mesh);
    this.projectiles.push({ id, def, pid, local, pos: new THREE.Vector3(o[0], o[1], o[2]), vel: new THREE.Vector3(v[0], v[1], v[2]), born: performance.now(), mesh, frozen: 0, smoke: 0 });
  }

  removeProjectile(pid) {
    const i = this.projectiles.findIndex((p) => p.pid === pid);
    if (i >= 0) { this.g.scene.remove(this.projectiles[i].mesh); this.projectiles.splice(i, 1); }
  }

  updateProjectiles(dt) {
    const g = this.g, now = performance.now();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i], pr = p.def.proj;
      if (p.frozen) { if (now - p.frozen > 1500) this.removeProjectile(p.pid); continue; } // 對手的彈，等對方通知爆炸
      p.vel.y -= pr.gravity * dt;
      const sp = p.vel.length(), len = sp * dt;
      let done = false;
      if (sp > 0.01) {
        _d.copy(p.vel).multiplyScalar(1 / sp);
        const bh = g.world.raycast(p.pos.x, p.pos.y, p.pos.z, _d.x, _d.y, _d.z, len);
        const ph = p.local && !p.def.kind ? g.remote.rayHit(p.pos.x, p.pos.y, p.pos.z, _d.x, _d.y, _d.z) : null; // 手榴彈不會砸到人就爆
        if (ph && ph.t <= len && (!bh || ph.t < bh.dist)) {
          p.pos.addScaledVector(_d, ph.t); this.explode(p, true); done = true;
        } else if (bh) {
          p.pos.addScaledVector(_d, Math.max(0, bh.dist - 0.02));
          if (pr.bounce && bh.dist > 0) {
            _n.set(bh.nx, bh.ny, bh.nz);
            p.vel.addScaledVector(_n, -2 * p.vel.dot(_n)).multiplyScalar(pr.bounce);
            p.pos.addScaledVector(_n, 0.03);
            g.sfx.bounce(p.pos.distanceTo(g.camera.position));
          } else if (p.local) { p.pos.addScaledVector(_d, -0.08); this.explode(p, false); done = true; }
          else { p.frozen = now; p.mesh.visible = false; }
        } else p.pos.addScaledVector(_d, len);
      }
      if (done) continue;
      if (pr.fuse && now - p.born >= pr.fuse * 1000) {
        if (p.local) { this.explode(p, false); continue; }
        p.frozen = now; p.mesh.visible = false; continue;
      }
      p.mesh.position.copy(p.pos);
      if (p.def.kind) { p.mesh.rotation.x += dt * 9; p.mesh.rotation.z += dt * 6; } else if (sp > 0.5) p.mesh.lookAt(_a.copy(p.pos).add(p.vel));
      p.smoke += dt;
      if (p.smoke > 0.025) {
        p.smoke = 0;
        if (!p.def.kind) { g.fx.smoke(p.pos.x, p.pos.y, p.pos.z, 1, pr.gravity ? 0.07 : 0.13); if (!pr.gravity) g.fx.glow(p.pos.x, p.pos.y, p.pos.z, 0.25, 0.08, 6, 2.6, 0.8); }
        else if (p.def.kind === 'molotov') g.fx.glow(p.pos.x, p.pos.y + 0.08, p.pos.z, 0.1, 0.12, 5, 2.2, 0.6);   // 瓶口的火
      }
    }
  }

  // 自己的彈爆炸：改地形、通知對手、算傷害（開槍方說了算）
  explode(p, direct) {
    const g = this.g, pr = p.def.proj, pos = p.pos;
    const pow = pr.blockPow * this.mods.block;
    const msg = { r: g.round, pid: p.pid, p: [r3(pos.x), r3(pos.y), r3(pos.z)], br: pr.blockR, bp: pow, rad: pr.radius, k: pr.kick };
    if (p.def.kind && p.def.kind !== 'he') { msg.kind = p.def.kind; msg.dur = p.def.dur; msg.cloud = p.def.cloud; msg.own = g.me; } // 閃光、煙霧、火：沒有爆炸傷害
    this.removeProjectile(p.pid);
    g.sendPeer('expl', msg);
    g.doExplosion(msg);
    if (msg.kind) return;
    if (g.remote.alive) {
      const d = direct ? 0 : Math.hypot(pos.x - g.remote.pos.x, pos.y - (g.remote.pos.y + 0.9), pos.z - g.remote.pos.z);
      if (d < pr.radius) {
        const dmg = p.def.dmg * (direct ? 1 : Math.max(0.15, 1 - d / pr.radius)) * this.mods.dmg;
        g.auth('hit', { r: g.round, d: dmg, h: false, w: p.id });
        g.hud.hitmarker(false); g.sfx.hit(false); g.remote.hitFlash();
      }
    }
    const me = g.player.pos, ds = Math.hypot(pos.x - me.x, pos.y - (me.y + 0.9), pos.z - me.z);
    if (ds < pr.radius) g.auth('self', { r: g.round, d: p.def.dmg * (1 - ds / pr.radius) * pr.self, w: p.id });
  }

  // ───────── 火（燃燒瓶）─────────
  // mine = 是我丟的 → 由我負責算傷害和燒木頭（跟子彈、爆炸一樣，丟的人說了算）
  addFire(f) { this.fires.push({ ...f, end: performance.now() + f.dur * 1000, next: performance.now() + 250, burnAt: performance.now() + 500 }); }
  // 煙霧彈滅火：煙團碰到的火全部熄掉
  quench(x, y, z, r) {
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      if (Math.hypot(f.x - x, f.z - z) < r + f.r * 0.6 && Math.abs(f.y - y) < r + 1.5) { this.g.fx.stopFire(f.pid); this.fires.splice(i, 1); }
    }
  }
  inFire(f, px, py, pz) { return Math.hypot(px - f.x, pz - f.z) < f.r && py > f.y - 1.3 && py < f.y + 2.0; }
  updateFires(now) {
    const g = this.g, def = THROWABLES.molotov;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      if (now >= f.end) { this.fires.splice(i, 1); continue; }
      if (!f.mine) continue;
      if (now >= f.next) {
        f.next += 250;
        const rp = g.remote.pos, me = g.player.pos, d = def.dps * 0.25;
        if (g.remote.alive && this.inFire(f, rp.x, rp.y, rp.z)) { g.auth('hit', { r: g.round, d: d * this.mods.dmg, h: false, w: 'molotov' }); g.hud.hitmarker(false); }
        if (g.meAlive() && this.inFire(f, me.x, me.y, me.z)) g.auth('self', { r: g.round, d, w: 'molotov' });
      }
      if (now >= f.burnAt) {
        f.burnAt += 500;
        const w = g.world, R = Math.ceil(f.r / BS), cx = Math.floor(f.x / BS), cy = Math.floor(f.y / BS), cz = Math.floor(f.z / BS), dmg = def.burn * 0.5;
        for (let y = cy - 2; y <= cy + 3; y++) for (let z = cz - R; z <= cz + R; z++) for (let x = cx - R; x <= cx + R; x++) {
          if (!w.inb(x, y, z)) continue;
          const t = w.types[w.idx(x, y, z)];
          if (!t || !BLOCK[t].burn || Math.hypot((x + 0.5) * BS - f.x, (z + 0.5) * BS - f.z) > f.r) continue;
          const res = w.damage(x, y, z, dmg);
          this.blkOut.push(w.idx(x, y, z), dmg);
          if (res && res.destroyed) g.fx.debris(x, y, z, res.type, 4, 0.6);
        }
      }
    }
  }
}
