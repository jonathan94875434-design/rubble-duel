import * as THREE from 'three';
import { PLAYER, TEAM } from './config.js';
import { WEAPONS, falloff } from './weapons.js';
import { buffMods } from './buffs.js';
import { lerp, r3 } from './util.js';

const DEG = Math.PI / 180;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
const PROJ_GEO = new THREE.BoxGeometry(0.14, 0.14, 0.34);
const PROJ_MAT = { rocket: new THREE.MeshBasicMaterial({ color: 0xffc070 }), gl: new THREE.MeshBasicMaterial({ color: 0x9fe060 }) };

// 本機玩家的開槍、換彈、切槍，以及所有拋射物（自己的 + 對手的畫面）
export class Combat {
  constructor(g) {
    this.g = g;
    this.slots = []; this.cur = 0; this.mods = buffMods([]);
    this.bloom = 0; this.recP = 0; this.recY = 0; this.ads = 0;
    this.switchEnd = 0; this.switchDur = 350; this.fireQueued = 0; this.lastShotT = 0;
    this.projectiles = []; this.pid = 1; this.blkOut = [];
    this.shots = 0; this.hits = 0;
  }

  get w() { return this.slots[this.cur]; }

  setLoadout(lo, buffs) {
    this.mods = buffMods(buffs);
    this.slots = [lo.p, lo.s].map((id) => {
      const def = WEAPONS[id], mag = Math.round(def.mag * this.mods.mag);
      return { id, def, mag, ammo: mag, reserve: def.reserve === undefined ? Infinity : def.reserve, nextFire: 0, reloadEnd: 0, reloadStart: 0 };
    });
    this.cur = 0; this.bloom = 0; this.recP = this.recY = 0; this.ads = 0; this.switchEnd = 0; this.fireQueued = 0;
    this.g.view.setWeapon(lo.p);
    this.clearProjectiles();
  }

  clearProjectiles() {
    for (const p of this.projectiles) this.g.scene.remove(p.mesh);
    this.projectiles.length = 0;
  }

  switchTo(i) {
    if (i === this.cur || !this.slots[i]) return;
    this.w.reloadEnd = 0;
    this.cur = i; this.ads = 0;
    this.switchDur = 350 * this.mods.handling;
    this.switchEnd = performance.now() + this.switchDur;
    this.g.view.setWeapon(this.w.id);
    this.g.sfx.swap();
  }

  reload() {
    const w = this.w, now = performance.now();
    if (!w || w.reloadEnd || w.ammo >= w.mag || w.reserve <= 0 || now < this.switchEnd) return;
    w.reloadStart = now; w.reloadEnd = now + w.def.reload * 1000 * this.mods.handling;
    this.g.sfx.reload(0);
  }

  reloadProgress() { const w = this.w; if (!w || !w.reloadEnd) return 0; return Math.min(1, (performance.now() - w.reloadStart) / (w.reloadEnd - w.reloadStart)); }
  drawProgress() { const left = this.switchEnd - performance.now(); return left <= 0 ? 1 : 1 - left / this.switchDur; }

  spread() {
    const w = this.w; if (!w) return 1;
    const def = w.def, p = this.g.player;
    const sp = Math.min(1.3, Math.hypot(p.vel.x, p.vel.z) / PLAYER.SPEED);
    const s = lerp(def.spread[0], def.spread[1], this.ads)
      + this.bloom * (1 - this.ads * 0.5)
      + sp * 1.2 * (1 - this.ads * 0.4) * (def.pellets > 1 ? 0.3 : 1)
      + (p.onGround ? 0 : 2.2);
    return s * this.mods.spread;
  }

  // inp: { fire, firePressed, ads, reload }
  update(dt, inp, canFire) {
    const now = performance.now(), w = this.w, g = this.g;
    if (!w) return;
    if (w.reloadEnd && now >= w.reloadEnd) {
      const take = Math.min(w.mag - w.ammo, w.reserve);
      w.ammo += take; w.reserve -= take; w.reloadEnd = 0; g.sfx.reload(1);
    }
    const busy = now < this.switchEnd || w.reloadEnd > 0;
    const wantAds = inp.ads && !busy && canFire ? 1 : 0;
    this.ads += Math.sign(wantAds - this.ads) * Math.min(Math.abs(wantAds - this.ads), dt * 8);

    this.bloom = Math.max(0, this.bloom - dt * (2.2 + this.bloom * 3));
    if (now - this.lastShotT > 90) { const k = Math.min(1, dt * 7); this.recP -= this.recP * k; this.recY -= this.recY * k; }

    if (inp.firePressed) this.fireQueued = now + 160;
    const trig = w.def.auto ? inp.fire : this.fireQueued > now;
    if (canFire && trig && !busy && now >= w.nextFire) {
      if (w.ammo > 0) { this.fireQueued = 0; this.fire(w, now); }
      else { this.fireQueued = 0; if (w.reserve <= 0 && inp.firePressed) g.sfx.dry(); }
    }
    if (w.ammo === 0 && w.reserve > 0 && !w.reloadEnd && now >= w.nextFire && now >= this.switchEnd) this.reload();
    if (inp.reload) this.reload();

    if (this.blkOut.length) { g.sendPeer('blk', { r: g.round, h: this.blkOut }); this.blkOut = []; }
  }

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
      const ends = [];
      let total = 0, head = false, hitAny = false;
      for (let i = 0; i < def.pellets; i++) {
        const ang = Math.tan(spr * Math.sqrt(Math.random())), th = Math.random() * Math.PI * 2;
        const sx = ang * Math.cos(th), sy = ang * Math.sin(th);
        let dx = fx + rx * sx + ux * sy, dy = fy + ry * sx + uy * sy, dz = fz + rz * sx + uz * sy;
        const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
        const bh = g.world.raycast(ox, oy, oz, dx, dy, dz, 200);
        const ph = g.remote.rayHit(ox, oy, oz, dx, dy, dz);
        const tb = bh ? bh.dist : 200;
        if (ph && ph.t < tb) {
          total += def.dmg * falloff(def, ph.t) * (ph.head ? def.head : 1) * this.mods.dmg;
          head = head || ph.head; hitAny = true;
          _b.set(ox + dx * ph.t, oy + dy * ph.t, oz + dz * ph.t);
          g.fx.hitSpark(_b.x, _b.y, _b.z, TEAM[1 - g.me], def.pellets > 1 ? 3 : 7);
        } else {
          _b.set(ox + dx * tb, oy + dy * tb, oz + dz * tb);
          if (bh && !bh.oob) {
            const dmg = Math.round(def.dmg * def.block * this.mods.block);
            const res = g.world.damage(bh.x, bh.y, bh.z, dmg);
            this.blkOut.push(g.world.idx(bh.x, bh.y, bh.z), dmg);
            if (res && res.destroyed) { g.fx.debris(bh.x, bh.y, bh.z, res.type); g.sfx.blockBreak(tb); }
            else g.fx.impact(_b.x, _b.y, _b.z, bh.nx, bh.ny, bh.nz, bh.type, def.pellets > 1 ? 2 : 4);
          }
        }
        ends.push(r3(_b.x), r3(_b.y), r3(_b.z));
        g.fx.tracer(_a, _b);
      }
      g.sendPeer('fire', { w: w.id, e: ends });
      if (hitAny) {
        this.hits++;
        g.auth('hit', { r: g.round, d: total, h: head, w: w.id });
        g.hud.hitmarker(head); g.sfx.hit(head); g.remote.hitFlash();
      }
    }

    const ak = this.ads > 0.5 ? 0.75 : 1;
    this.recP = Math.min(14 * DEG, this.recP + def.recoil[0] * DEG * this.mods.recoil * ak);
    this.recY += (Math.random() - 0.5) * 2 * def.recoil[1] * DEG * this.mods.recoil * ak;
    this.bloom = Math.min(3.5, this.bloom + def.bloom);
    g.view.fire(def.pellets > 1 || def.dmg >= 50);
    g.sfx.shot(def.snd);
    g.shake = Math.min(1, g.shake + def.recoil[0] * 0.05);
  }

  // ───────── 拋射物 ─────────
  spawnProjectile(id, pid, o, v, local) {
    const def = WEAPONS[id];
    const mesh = new THREE.Mesh(PROJ_GEO, PROJ_MAT[id] || PROJ_MAT.rocket);
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
        const ph = p.local ? g.remote.rayHit(p.pos.x, p.pos.y, p.pos.z, _d.x, _d.y, _d.z) : null;
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
      if (sp > 0.5) p.mesh.lookAt(_a.copy(p.pos).add(p.vel));
      p.smoke += dt;
      if (p.smoke > 0.025) { p.smoke = 0; g.fx.smoke(p.pos.x, p.pos.y, p.pos.z, 1, pr.gravity ? 0.07 : 0.13); }
    }
  }

  // 自己的彈爆炸：改地形、通知對手、算傷害（開槍方說了算）
  explode(p, direct) {
    const g = this.g, pr = p.def.proj, pos = p.pos;
    const pow = pr.blockPow * this.mods.block;
    const msg = { r: g.round, pid: p.pid, p: [r3(pos.x), r3(pos.y), r3(pos.z)], br: pr.blockR, bp: pow, rad: pr.radius, k: pr.kick };
    this.removeProjectile(p.pid);
    g.sendPeer('expl', msg);
    g.doExplosion(msg);
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
}
