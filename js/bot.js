import { PLAYER } from './config.js';
import { Player } from './player.js';
import { WEAPONS, falloff } from './weapons.js';
import { buffMods } from './buffs.js';
import { SPAWNS } from './maps.js';
import { rayPlayer, lerp, lerpAngle, r3 } from './util.js';

// 練習用對手。它假裝成「訪客」，走跟真人一樣的訊息格式，
// 所以練習模式也順便測到整套回合流程。
export class Bot {
  constructor(world) {
    this.world = world; this.body = new Player(world); this.link = null;
    this.gs = null; this.round = 0;
    this.tx = 0; this.ty = 0; this.tz = 0;
    this.weapon = 'ar'; this.mods = buffMods([]);
    this.nextShot = 0; this.reactAt = 0; this.burst = 0; this.ammo = 30;
    this.strafe = 1; this.strafeT = 0; this.stuck = 0; this.wantJump = false; this.sendAcc = 0;
    this.aimErr = 3.2; // 度；越小越準
  }
  send(type, data) { if (this.link) this.link([type, data]); }

  recv(msg) {
    const [type, d] = msg;
    if (type === 'gs') this.onGs(d);
    else if (type === 'st') { this.tx = d[0]; this.ty = d[1]; this.tz = d[2]; }
    else if (type === 'expl' && d.r === this.round) {
      const b = this.body, dx = b.pos.x - d.p[0], dy = b.pos.y + 0.9 - d.p[1], dz = b.pos.z - d.p[2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist < d.rad && dist > 0.01) { const k = (1 - dist / d.rad) * d.k / dist; b.vel.x += dx * k; b.vel.y += dy * k + 2; b.vel.z += dz * k; b.onGround = false; }
    }
  }

  onGs(gs) {
    const prev = this.gs; this.gs = gs;
    if (prev && prev.phase === gs.phase && prev.round === gs.round) return;
    const me = gs.p[1];
    if (gs.phase === 'loadout') {
      if (me.ch) this.send('auth', { t: 'buff', id: me.ch[(Math.random() * me.ch.length) | 0] });
      const picks = ['ar', 'ar', 'smg', 'shotgun', 'dmr', 'lmg'];
      this.weapon = picks[(Math.random() * picks.length) | 0];
      this.send('auth', { t: 'loadout', p: this.weapon, s: 'pistol' });
      setTimeout(() => this.send('auth', { t: 'ready', v: true }), 700);
    } else if (gs.phase === 'countdown') {
      this.round = gs.round;
      this.body.spawn(SPAWNS[(1 + gs.round) % 2]);
      this.mods = buffMods(me.bf);
      this.body.maxAirJumps = this.mods.airJumps;
      this.ammo = Math.round(WEAPONS[this.weapon].mag * this.mods.mag);
      this.nextShot = 0; this.stuck = 0;
    }
  }

  update(dt, now) {
    const gs = this.gs;
    if (!gs) return;
    const ph = gs.phase;
    if (ph !== 'countdown' && ph !== 'playing' && ph !== 'roundEnd') return;
    const me = gs.p[1], foe = gs.p[0], b = this.body, def = WEAPONS[this.weapon];
    if (ph === 'playing' && me.al) {
      const ex = b.pos.x, ey = b.pos.y + PLAYER.EYE, ez = b.pos.z;
      let dx = this.tx - ex, dy = this.ty + 1.15 - ey, dz = this.tz - ez;
      const dist = Math.hypot(dx, dy, dz) || 1;
      dx /= dist; dy /= dist; dz /= dist;
      b.yaw = lerpAngle(b.yaw, Math.atan2(-dx, -dz), Math.min(1, dt * 7));
      b.pitch = lerp(b.pitch, Math.asin(dy), Math.min(1, dt * 7));
      const los = !this.world.raycast(ex, ey, ez, dx, dy, dz, dist);

      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeT = 0.5 + Math.random() * 1.3; this.wantJump = Math.random() < 0.18; }
      let f, r;
      if (los) { r = this.strafe; f = dist > 16 ? 1 : dist < 6 ? -0.7 : 0.15; }
      else { f = 1; r = this.strafe * 0.35; }
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (f > 0.5 && sp < 1.2) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 2);
      const jump = b.onGround && ((this.stuck > 0.2 && this.stuck < 0.9) || (los && this.wantJump));
      if (jump) this.wantJump = false;
      b.update(dt, { f, r, jump, speed: def.move * this.mods.speed * 0.92 });

      if (!los) this.reactAt = now + 380;
      // 看得到就打人；被牆擋住太久就直接把牆打穿
      if (foe.al && now >= this.nextShot && ((los && now >= this.reactAt) || this.stuck > 0.9)) this.fire(def, now);
    } else b.update(dt, { f: 0, r: 0, jump: false, speed: 1 });

    this.sendAcc += dt;
    if (this.sendAcc >= 1 / 20) { this.sendAcc = 0; this.send('st', [r3(b.pos.x), r3(b.pos.y), r3(b.pos.z), r3(b.yaw), r3(b.pitch), this.weapon]); }
  }

  fire(def, now) {
    const b = this.body;
    this.nextShot = now + (60000 / def.rpm) * (def.auto ? 1 : 1.5);
    if (--this.ammo <= 0) { this.ammo = Math.round(def.mag * this.mods.mag); this.nextShot = now + def.reload * 1000; }
    else if (def.auto && ++this.burst >= 7) { this.burst = 0; this.nextShot += 350 + Math.random() * 300; }
    const ox = b.pos.x, oy = b.pos.y + PLAYER.EYE, oz = b.pos.z;
    const cp = Math.cos(b.pitch);
    const fx = -Math.sin(b.yaw) * cp, fy = Math.sin(b.pitch), fz = -Math.cos(b.yaw) * cp;
    const err = ((this.aimErr + def.spread[0] * 0.5) * Math.PI) / 180;
    const ends = [], blk = [];
    let total = 0, head = false;
    for (let i = 0; i < def.pellets; i++) {
      let dx = fx + (Math.random() - 0.5) * 2 * err, dy = fy + (Math.random() - 0.5) * 2 * err, dz = fz + (Math.random() - 0.5) * 2 * err;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const bh = this.world.raycast(ox, oy, oz, dx, dy, dz, 200);
      const ph = rayPlayer(ox, oy, oz, dx, dy, dz, this.tx, this.ty, this.tz);
      const tb = bh ? bh.dist : 200;
      if (ph && ph.t < tb) {
        total += def.dmg * falloff(def, ph.t) * (ph.head ? def.head : 1) * this.mods.dmg;
        head = head || ph.head;
        ends.push(r3(ox + dx * ph.t), r3(oy + dy * ph.t), r3(oz + dz * ph.t));
      } else {
        ends.push(r3(ox + dx * tb), r3(oy + dy * tb), r3(oz + dz * tb));
        if (bh && !bh.oob) blk.push(this.world.idx(bh.x, bh.y, bh.z), Math.round(def.dmg * def.block * this.mods.block));
      }
    }
    this.send('fire', { w: this.weapon, e: ends });
    if (blk.length) this.send('blk', { r: this.round, h: blk });
    if (total > 0) this.send('auth', { t: 'hit', r: this.round, d: total, h: head, w: this.weapon });
  }
}
