import { PLAYER } from './config.js';
import { Player } from './player.js';
import { WEAPONS, falloff, loadoutCost, validLoadout } from './weapons.js';
import { CARDS, SK, BERSERK, cardMods, rage } from './cards.js';
import { MAPS } from './maps.js';
import { BLOCK } from './world.js';
import { Nav } from './nav.js';
import { SKIN_IDS, WSKIN_IDS } from './skins.js';
import { rayPlayer, lerp, lerpAngle, r3 } from './util.js';

// 練習難度。aimErr：瞄準誤差（度）；react：看到人之後多久開槍（毫秒）
export const BOT_LEVELS = {
  dummy: { name: '木樁（不動、不開槍）', still: true },
  easy: { name: '簡單', aimErr: 9, react: 650, speed: 0.8 },
  normal: { name: '普通', aimErr: 5.5, react: 380, speed: 0.92 },
  hard: { name: '困難', aimErr: 2.8, react: 200, speed: 1 },
};

// 練習用對手。它假裝成「訪客」，走跟真人一樣的訊息格式，
// 所以練習模式也順便測到整套回合流程。移動靠 nav.js 尋路。
export class Bot {
  constructor(world, level = 'normal') {
    this.world = world; this.body = new Player(world); this.link = null;
    this.nav = new Nav(world);
    this.level = BOT_LEVELS[level] ? level : 'normal';
    this.gs = null; this.round = 0; this.sentLook = false;
    this.tx = 0; this.ty = 0; this.tz = 0; this.tcr = false;   // 玩家位置、是否蹲著
    this.gx = 0; this.gy = 0; this.gz = 0;                      // 玩家最後一次站在地上的位置（尋路目標）
    this.weapon = 'ar'; this.mods = cardMods([]);
    this.nextShot = 0; this.reactAt = 0; this.burst = 0; this.ammo = 30;
    this.strafe = 1; this.strafeT = 0; this.wantJump = false; this.sendAcc = 0;
    this.noLos = 0; this.holdT = 0;
    this.path = null; this.pi = 0; this.planAt = 0; this.px = 0; this.pz = 0;
    this.chkAt = 0; this.cx = 0; this.cz = 0; this.stuckN = 0; this.breachT = 0;
    this.blindUntil = 0; this.blocked = null;   // blocked(ax..bz)：視線有沒有被煙擋住（main.js 會接上）
    this.shield = null;                          // shield(ox..dz)：子彈飛多遠會被能量護罩擋下（main.js 會接上）
    // Roguelike：自己的技能與冷卻、玩家對它放的控場效果、排定要打下來的軌道砲
    this.sk = [null, null]; this.skAt = {}; this.skUses = {}; this.liveAt = 0; this.cloakEnd = 0;
    this.slowUntil = 0; this.stopUntil = 0; this.noSeeUntil = 0; this.hole = null; this.strikes = []; this.me = null;
  }
  get L() { return BOT_LEVELS[this.level]; }
  send(type, data) { if (this.link) this.link([type, data]); }

  recv(msg) {
    const [type, d] = msg;
    if (type === 'gs') this.onGs(d);
    else if (type === 'ev') { if (d.t === 'respawn') this._respawn(); }
    else if (type === 'sk') {
      // 玩家放的技能裡，會影響機器人的：時間凝結（變慢）、時間暫停（不能動）、迷彩（看不到人）、黑洞（被吸過去）、換位
      if (!d || d.r !== this.round) return;
      const now = performance.now(), dur = (lo, hi) => Math.max(lo, Math.min(hi, +d.d || 0)) * 1000;
      if (d.id === 'chrono') { this.slowUntil = now + dur(0.5, 6); this.reactAt = now + 700; }
      else if (d.id === 'timestop') { this.stopUntil = now + dur(0.5, 3.5); this.reactAt = this.stopUntil + 400; }
      else if (d.id === 'cloak') this.noSeeUntil = d.d > 0 ? now + d.d * 1000 : 0;
      else if (d.id === 'blackhole' && Array.isArray(d.p)) this.hole = { x: d.p[0], y: d.p[1], z: d.p[2], end: now + dur(1, 6) };
      else if (d.id === 'swap' && Array.isArray(d.a) && d.a.length === 3 && d.a.every(Number.isFinite)) {
        const b = this.body; b.pos.set(d.a[0], d.a[1], d.a[2]); b.prev.copy(b.pos); b.rpos.copy(b.pos); b.vel.set(0, 0, 0);
        b.yaw += Math.PI; this.slowUntil = Math.max(this.slowUntil, now + SK.swap.daze * 1000); this.reactAt = now + SK.swap.noFire * 1000 + 300;   // 被轉過去、暈一下
        this.path = null; this.planAt = 0;
      }
    }
    else if (type === 'st') {
      this.tx = d[0]; this.ty = d[1]; this.tz = d[2]; this.tcr = !!(d[6] & 1);
      if (d[6] & 2) { this.gx = d[0]; this.gy = d[1]; this.gz = d[2]; }
    } else if (type === 'expl' && d.r === this.round) {
      const b = this.body, dx = b.pos.x - d.p[0], dy = b.pos.y + 0.9 - d.p[1], dz = b.pos.z - d.p[2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist < d.rad && dist > 0.01) { const k = (1 - dist / d.rad) * d.k / dist; b.vel.x += dx * k; b.vel.y += dy * k + 2; b.vel.z += dz * k; b.onGround = false; }
    }
  }

  onGs(gs) {
    const prev = this.gs; this.gs = gs;
    if (!this.sentLook) {
      this.sentLook = true;
      this.send('auth', { t: 'look', s: SKIN_IDS[1 + ((Math.random() * (SKIN_IDS.length - 1)) | 0)], w: WSKIN_IDS[(Math.random() * WSKIN_IDS.length) | 0] });
    }
    if (prev && prev.phase === gs.phase && prev.round === gs.round) return;
    const me = gs.p[1];
    if (gs.phase === 'loadout') {
      if (me.ch) {
        // 選卡：優先挑它真的會用的（被動，或有空格可以放的主動技能）
        const sk = me.sk || [null, null], ok = me.ch.filter((id) => CARDS[id] && CARDS[id].bot !== false && (CARDS[id].k === 'p' || sk.includes(null)));
        const pool = ok.length ? ok : me.ch;
        this.send('auth', { t: 'buff', id: pool[(Math.random() * pool.length) | 0], slot: 0 });
      }
      // 買裝備：手槍局只能買副武器；之後從買得起的主武器裡隨機挑，有剩再買防彈衣
      const money = me.$, pick = (list) => list[(Math.random() * list.length) | 0];
      const lo = { p: null, s: 'pistol', armor: 0, he: 0, flash: 0, smoke: 0 };
      if (gs.round > 1) {
        const can = ['ar', 'ar', 'smg', 'shotgun', 'dmr', 'lmg'].filter((id) => WEAPONS[id].price <= money);
        if (can.length) lo.p = pick(can);
      }
      if (!lo.p) lo.s = pick(['pistol', 'mp', 'revolver'].filter((id) => WEAPONS[id].price <= money));
      if (money - loadoutCost(validLoadout(lo)) >= 600) lo.armor = 1;
      this.weapon = lo.p || lo.s;
      this.send('auth', { t: 'loadout', ...lo });
      setTimeout(() => this.send('auth', { t: 'ready', v: true }), 700);
    } else if (gs.phase === 'warmup') { this.round = gs.round; this._respawn(); }
    else if (gs.phase === 'countdown') {
      this.round = gs.round;
      const sp = MAPS[gs.map].spawns;
      this.body.spawn(sp[(1 + gs.round) % 2]);
      const o = sp[gs.round % 2]; this.gx = this.tx = o.x; this.gy = this.ty = o.y; this.gz = this.tz = o.z;
      this.mods = cardMods(me.bf);
      this.body.maxAirJumps = this.mods.airJumps;
      this.ammo = Math.round(WEAPONS[this.weapon].mag * this.mods.mag);
      this.sk = me.sk || [null, null]; this.skAt = {}; this.skUses = {}; this.liveAt = 0; this.cloakEnd = 0;
      this.slowUntil = 0; this.stopUntil = 0; this.noSeeUntil = 0; this.hole = null; this.strikes = [];
      this.nextShot = 0; this.blindUntil = 0; this.noLos = 0; this.holdT = 0; this.path = null; this.planAt = 0; this.stuckN = 0; this.breachT = 0; this.chkAt = 0;
    }
  }

  // 熱身模式的重生：挑離玩家比較遠的出生點，隨機換一把槍
  _respawn() {
    const gs = this.gs; if (!gs || !MAPS[gs.map]) return;
    const sp = MAPS[gs.map].spawns, d = (s) => Math.hypot(s.x - this.tx, s.z - this.tz);
    this.body.spawn(d(sp[0]) > d(sp[1]) ? sp[0] : sp[1]);
    const list = ['ar', 'smg', 'shotgun', 'dmr', 'pistol'];
    this.weapon = list[(Math.random() * list.length) | 0];
    this.mods = cardMods([]); this.body.maxAirJumps = 0;
    this.ammo = WEAPONS[this.weapon].mag;
    this.nextShot = performance.now() + 900; this.blindUntil = 0; this.noLos = 0; this.holdT = 0; this.path = null; this.planAt = 0; this.stuckN = 0; this.breachT = 0; this.chkAt = 0;
  }

  // 被閃光彈閃到：看得到它、而且面向它才算，期間不會開槍
  onFlash(x, y, z) {
    const b = this.body, ex = b.pos.x, ey = b.pos.y + PLAYER.EYE, ez = b.pos.z;
    let dx = x - ex, dy = y - ey, dz = z - ez;
    const dist = Math.hypot(dx, dy, dz) || 0.01;
    if (dist > 34 || !this.gs || !this.gs.p[1].al) return;
    dx /= dist; dy /= dist; dz /= dist;
    if ((dist > 0.8 && this.world.raycast(ex, ey, ez, dx, dy, dz, dist - 0.5)) || (this.blocked && this.blocked(ex, ey, ez, x, y, z))) return;
    const dot = -Math.sin(b.yaw) * dx - Math.cos(b.yaw) * dz;
    const k = (dot > 0.3 ? 1 : dot > -0.35 ? 0.55 : 0.2) * Math.max(0.2, Math.min(1, 1.2 - dist / 24));
    const dur = 0.4 + 3 * k;
    this.blindUntil = performance.now() + dur * 1000;
    this.send('blind', { d: +dur.toFixed(1) });
  }

  // ───────── 尋路 ─────────
  _plan(now) {
    const b = this.body;
    this.path = this.nav.path(b.pos.x, b.pos.y, b.pos.z, this.gx, this.gy, this.gz);
    this.pi = this.path && this.path.length > 1 ? 1 : 0;
    this.planAt = now + (this.path ? 600 : 2000); this.px = this.gx; this.pz = this.gz;   // 找不到路就別一直重算（整張圖搜一遍比較花時間）
  }

  // 回傳下一步要往哪走 { wx, wz, jump }；沒有路可走回 null
  _follow(now) {
    const b = this.body;
    if (!this.path || now >= this.planAt || Math.hypot(this.gx - this.px, this.gz - this.pz) > 1.5) this._plan(now);
    const p = this.path;
    if (!p) return null;
    while (this.pi < p.length) {
      const w = p[this.pi];
      if (Math.hypot(w.x - b.pos.x, w.z - b.pos.z) < 0.32 && Math.abs(w.y - b.pos.y) < 0.6) this.pi++; else break;
    }
    if (this.pi >= p.length) return null;
    const w = p[this.pi], dx = w.x - b.pos.x, dz = w.z - b.pos.z, d = Math.hypot(dx, dz) || 1;
    return { wx: dx / d, wz: dz / d, jump: b.onGround && w.y - b.pos.y > 0.6 };
  }

  update(dt, now) {
    const gs = this.gs;
    if (!gs) return;
    const ph = gs.phase;
    if (ph !== 'countdown' && ph !== 'playing' && ph !== 'roundEnd' && ph !== 'warmup') return;
    const me = gs.p[1], foe = gs.p[0], b = this.body, def = WEAPONS[this.weapon], L = this.L;
    this.me = me;
    if (ph === 'playing' && !this.liveAt) this.liveAt = now;
    this._strikes(now, ph === 'playing');
    // 被控場：時間凝結、冰凍彈、黑洞
    const stopped = now < this.stopUntil, slowed = stopped || now < this.slowUntil;
    const sm = stopped ? 0 : (slowed ? SK.chrono.move : 1) * (me.fz ? 0.55 : 1) * (this.mods.berserk ? 1 + BERSERK.speed * rage(me.hp, me.mhp) : 1);
    if (stopped) { b.vel.x = 0; b.vel.z = 0; if (b.vel.y > 0) b.vel.y = 0; }
    if (this.hole && me.al) {
      const h = this.hole, hx = h.x - b.pos.x, hy = h.y - (b.pos.y + 0.9), hz = h.z - b.pos.z, hd = Math.hypot(hx, hy, hz);
      if (now >= h.end) this.hole = null;
      else if (hd < SK.blackhole.pull && hd > 0.3) { const H = SK.blackhole, a = ((H.base + H.str * (1 - hd / H.pull)) * dt) / hd; b.vel.x += hx * a; b.vel.y += hy * a; b.vel.z += hz * a; }
    }
    if ((ph === 'playing' || ph === 'warmup') && me.al && !L.still) {
      const ex = b.pos.x, ey = b.pos.y + PLAYER.EYE, ez = b.pos.z;
      let dx = this.tx - ex, dy = this.ty + (this.tcr ? 0.65 : 1.15) - ey, dz = this.tz - ez;
      const dist = Math.hypot(dx, dy, dz) || 1;
      dx /= dist; dy /= dist; dz /= dist;
      const wall = this.world.raycast(ex, ey, ez, dx, dy, dz, dist);
      const smoked = !wall && !!this.blocked && this.blocked(ex, ey, ez, this.tx, this.ty + 1, this.tz);
      const shielded = !wall && !!this.shield && this.shield(ex, ey, ez, dx, dy, dz) < dist;   // 中間隔著能量護罩：打不到，當作看不到 → 會走過去
      const los = !wall && !smoked && !shielded && now >= this.blindUntil && now >= this.noSeeUntil;   // 被煙擋住、被閃到、玩家開了迷彩 → 當作看不到
      if (ph === 'playing' && !stopped) this._skills(now, me, foe, los, dist);
      this.noLos = los ? 0 : this.noLos + dt;
      if (this.noLos > 0.4) this.reactAt = now + L.react; // 短暫被柱子擋一下不算，不重置反應時間
      this.holdT = Math.max(0, this.holdT - dt); this.breachT = Math.max(0, this.breachT - dt);

      // 移動：看得到且夠近 → 左右橫移對槍；否則照尋路走過去
      let wx = 0, wz = 0, jump = false, shootWall = false, facing = null;
      if (this.holdT > 0 && !los) { shootWall = !!wall && !wall.oob && BLOCK[wall.type].hp !== Infinity; } // 站定把牆打穿
      else if (this.holdT > 0) { /* 剛打穿，站定從洞口射 */ }
      else if (los && dist < 24) {
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeT = 0.5 + Math.random() * 1.3; this.wantJump = Math.random() < 0.15; }
        const f = dist > 14 ? 1 : dist < 5 ? -0.7 : 0.15, r = this.strafe;
        const hl = Math.hypot(dx, dz) || 1, hx = dx / hl, hz = dz / hl;   // 以「朝向玩家」為前方
        wx = hx * f - hz * r; wz = hz * f + hx * r;
        jump = b.onGround && this.wantJump; if (jump) this.wantJump = false;
        this.stuckN = 0; this.chkAt = 0;
      } else {
        const step = this.breachT > 0 ? null : this._follow(now);
        if (step) { wx = step.wx; wz = step.wz; jump = step.jump; if (!los) facing = Math.atan2(-wx, -wz); }
        else if (wall && !wall.oob && BLOCK[wall.type].hp !== Infinity) { shootWall = true; this.holdT = 1.2; this.reactAt = 0; } // 沒路 → 把牆打穿
        else { wx = dx; wz = dz; }
        // 卡住偵測：每秒看一次有沒有前進
        if (now >= this.chkAt) {
          if (this.chkAt && step && Math.hypot(b.pos.x - this.cx, b.pos.z - this.cz) < 0.35) {
            this.stuckN++; this.planAt = 0; jump = b.onGround;
            if (this.stuckN >= 3) { this.breachT = 2.5; this.stuckN = 0; }
          } else if (step) this.stuckN = 0;
          this.chkAt = now + 1000; this.cx = b.pos.x; this.cz = b.pos.z;
        }
      }

      // 身體朝向：看得到就看著玩家，看不到就看著前進方向
      const turn = stopped ? 0 : Math.min(1, dt * (slowed ? 4 : 12));
      b.yaw = lerpAngle(b.yaw, facing !== null ? facing : Math.atan2(-dx, -dz), turn);
      b.pitch = lerp(b.pitch, facing !== null ? 0 : Math.asin(dy), turn);
      const wl = Math.hypot(wx, wz), s = Math.sin(b.yaw), c = Math.cos(b.yaw);
      const f = wl > 0 ? (-wx * s - wz * c) / wl : 0, r = wl > 0 ? (wx * c - wz * s) / wl : 0;
      b.update(dt, { f, r, jump, crouch: false, speed: def.move * this.mods.speed * L.speed * sm, grav: this.mods.grav });

      if (!stopped && foe.al && now >= this.nextShot && ((los && now >= this.reactAt) || shootWall)) this.fire(def, now, dx, dy, dz);
    } else b.update(dt, { f: 0, r: 0, jump: false, crouch: false, speed: 1 });

    this.sendAcc += dt;
    if (this.sendAcc >= 1 / 20) {
      this.sendAcc = 0;
      this.send('st', [r3(b.pos.x), r3(b.pos.y), r3(b.pos.z), r3(b.yaw), r3(b.pitch), this.weapon, b.onGround ? 2 : 0]);
    }
  }

  // ───────── Roguelike：機器人會用的幾個技能 ─────────
  _skills(now, me, foe, los, dist) {
    const b = this.body, r = this.round;
    const extra = this.mods.extraUses || 0;
    const can = (id) => this.sk.includes(id) && now >= (this.skAt[id] || 0) && now - this.liveAt >= (CARDS[id].lock || 0) * 1000 && (!CARDS[id].uses || (this.skUses[id] || 0) < CARDS[id].uses + extra);
    const used = (id) => { this.skAt[id] = now + CARDS[id].cd * 1000 * (this.mods.cd || 1); this.skUses[id] = (this.skUses[id] || 0) + 1; };
    if (can('stim') && me.hp < me.mhp - 55) { used('stim'); this.send('auth', { t: 'skill', r, id: 'stim' }); this.send('sk', { r, id: 'stim' }); }
    if (!foe.al) return;
    if (can('timestop') && los && dist < 30) { used('timestop'); this.send('sk', { r, id: 'timestop', d: SK.timestop.time }); }
    if (can('chrono') && los && dist < 28) { used('chrono'); this.send('sk', { r, id: 'chrono', d: SK.chrono.time }); }
    const S = SK.shock;
    if (can('shock') && dist < S.rad - 1.5) {
      used('shock');
      this.send('expl', { r, pid: 0, p: [r3(b.pos.x), r3(b.pos.y + 1), r3(b.pos.z)], br: S.br, bp: S.bp, rad: S.rad, k: S.k, fxk: 'shock', own: 1 });
      this.send('auth', { t: 'hit', r, d: S.min + (S.max - S.min) * (1 - dist / S.rad), h: false, w: 'shock' });
    }
    if (can('orbital') && los && dist > 7) {
      used('orbital');
      const p = [r3(this.tx), r3(this.gy + 0.05), r3(this.tz)];
      this.strikes.push({ x: p[0], y: p[1], z: p[2], at: now + SK.orbital.delay * 1000, last: now });
      this.send('sk', { r, id: 'orbital', p, d: SK.orbital.delay });
    }
    if (can('dome') && los && me.hp < 60) { used('dome'); this.send('sk', { r, id: 'dome', p: [r3(b.pos.x), r3(b.pos.y + 0.3), r3(b.pos.z)], d: SK.dome.time, rr: SK.dome.r }); }
    if (can('cloak') && !los && dist > 8) { used('cloak'); this.cloakEnd = now + 5000; this.send('sk', { r, id: 'cloak', d: 5 }); }
  }
  // 軌道砲：光柱追著玩家跑；時間到往下連炸三層，玩家在光柱附近就受傷（跟玩家自己放的算法一樣）
  _strikes(now, live) {
    const O = SK.orbital;
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const m = this.strikes[i];
      if (now < m.at) {
        const dt = Math.min(0.1, (now - (m.last || now)) / 1000), dx = this.tx - m.x, dz = this.tz - m.z, dd = Math.hypot(dx, dz);
        m.last = now;
        if (dd < O.trackR && dd > 0.01) { const st = Math.min(dd, O.track * dt); m.x += (dx / dd) * st; m.z += (dz / dd) * st; m.y += (this.gy + 0.05 - m.y) * Math.min(1, dt * 6); }
        continue;
      }
      m.x = r3(m.x); m.y = r3(m.y); m.z = r3(m.z);
      this.strikes.splice(i, 1);
      if (!live) continue;
      for (let k = 0; k < 3; k++) {
        const msg = { r: this.round, pid: 0, p: [m.x, r3(m.y + 0.3 - k * 1.5), m.z], br: 2.7, bp: 1300, rad: k ? 0 : 6.5, k: k ? 0 : 14, own: 1 };
        if (k) msg.kind = 'dig'; else msg.fxk = 'orbital';
        this.send('expl', msg);
      }
      const cy = Math.max(m.y - 3.5, Math.min(m.y + 40, this.ty + 0.9)), d = Math.hypot(this.tx - m.x, this.ty + 0.9 - cy, this.tz - m.z), f = d < O.full ? 1 : Math.max(0, 1 - (d - O.full) / O.fade);
      if (f > 0) this.send('auth', { t: 'hit', r: this.round, d: O.dmg * f, h: false, w: 'orbital' });
    }
  }

  // (fx,fy,fz)：朝目標的方向。準度只由難度的 aimErr 決定，不受自己橫移影響
  fire(def, now, fx, fy, fz) {
    const b = this.body, me = this.me;
    if (now < this.cloakEnd) { this.cloakEnd = 0; this.send('sk', { r: this.round, id: 'cloak', d: 0 }); }   // 開槍就現形
    const dm = this.mods.dmg * (this.mods.berserk && me ? 1 + BERSERK.dmg * rage(me.hp, me.mhp) : 1);
    this.nextShot = now + (60000 / (def.rpm * this.mods.rpm)) * (def.auto ? 1 : 1.5);
    if (--this.ammo <= 0) { this.ammo = Math.round(def.mag * this.mods.mag); this.nextShot = now + def.reload * 1000; }
    else if (def.auto && ++this.burst >= 7) { this.burst = 0; this.nextShot += 350 + Math.random() * 300; }
    const ox = b.pos.x, oy = b.pos.y + PLAYER.EYE, oz = b.pos.z;
    // 準度：難度的基本誤差 + 槍本身的散布 + 邊跑邊打的懲罰（跟玩家一樣，移動中比較不準）
    const mv = (def.mv === undefined ? 1.6 : def.mv) * Math.min(1, b.speed2d() / PLAYER.SPEED) * 0.7;
    const err = ((this.L.aimErr + def.spread[0] * 0.5 + mv) * Math.PI) / 180;
    const ends = [], blk = [];
    let total = 0, head = false;
    for (let i = 0; i < def.pellets; i++) {
      let dx = fx + (Math.random() - 0.5) * 2 * err, dy = fy + (Math.random() - 0.5) * 2 * err, dz = fz + (Math.random() - 0.5) * 2 * err;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const bh = this.world.raycast(ox, oy, oz, dx, dy, dz, 200);
      const ph = rayPlayer(ox, oy, oz, dx, dy, dz, this.tx, this.ty, this.tz, this.tcr);
      const sd = this.shield ? this.shield(ox, oy, oz, dx, dy, dz) : Infinity;   // 能量護罩會把子彈擋下來
      const tb = Math.min(bh ? bh.dist : 200, sd);
      if (ph && ph.t < tb) {
        total += def.dmg * falloff(def, ph.t) * (ph.head ? def.head * this.mods.head : 1) * dm;
        head = head || ph.head;
        ends.push(r3(ox + dx * ph.t), r3(oy + dy * ph.t), r3(oz + dz * ph.t));
      } else {
        ends.push(r3(ox + dx * tb), r3(oy + dy * tb), r3(oz + dz * tb));
        if (bh && !bh.oob && bh.dist <= tb) blk.push(this.world.idx(bh.x, bh.y, bh.z), Math.round(def.dmg * def.block * this.mods.block));
      }
    }
    this.send('fire', { w: this.weapon, e: ends });
    if (blk.length) this.send('blk', { r: this.round, h: blk });
    if (total > 0) this.send('auth', { t: 'hit', r: this.round, d: head && this.mods.reaper ? 400 : total, h: head, w: this.weapon, ...(head && this.mods.reaper ? { rp: 1 } : {}) });
  }
}
