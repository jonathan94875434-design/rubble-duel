import * as THREE from 'three';
import { BS, PLAYER as P } from './config.js';

// 玩家物理：方盒 vs 方塊世界。真人和練習用 bot 共用這一份。
export class Player {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3();   // 腳底中心
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.stepSmooth = 0;              // 上下階梯時讓鏡頭平滑
    this.maxAirJumps = 0; this.airJumps = 0;
    this.jumpWasHeld = false;
    this.walkPhase = 0;
    this.justJumped = false; this.justLanded = false;
  }

  spawn(s) {
    this.pos.set(s.x, s.y, s.z); this.vel.set(0, 0, 0);
    this.yaw = s.yaw; this.pitch = 0; this.onGround = false; this.stepSmooth = 0; this.airJumps = 0;
    this.unstick();
  }

  collides(x, y, z) { return this.world.boxSolid(x - P.HW, y, z - P.HW, x + P.HW, y + P.H, z + P.HW); }

  unstick() {
    for (let i = 0; i < 40 && this.collides(this.pos.x, this.pos.y, this.pos.z); i++) this.pos.y += BS;
  }

  eyeY() { return this.pos.y + P.EYE - this.stepSmooth; }

  // inp: { f, r: -1..1, jump: bool, speed: 倍率 }
  update(dt, inp) {
    const v = this.vel;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * inp.f + cos * inp.r, wz = -cos * inp.f - sin * inp.r;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-5) { wx /= wl; wz /= wl; }
    const maxS = P.SPEED * inp.speed;
    if (this.onGround || wl > 0) {
      const tx = wx * maxS, tz = wz * maxS;
      const dx = tx - v.x, dz = tz - v.z, d = Math.hypot(dx, dz);
      const a = (this.onGround ? P.ACCEL : P.AIR_ACCEL) * dt;
      if (d <= a) { v.x = tx; v.z = tz; } else { v.x += (dx / d) * a; v.z += (dz / d) * a; }
    }

    this.justJumped = false; this.justLanded = false;
    if (inp.jump) {
      if (this.onGround) { v.y = P.JUMP; this.onGround = false; this.justJumped = true; }
      else if (!this.jumpWasHeld && this.airJumps > 0) { v.y = P.JUMP * 0.95; this.airJumps--; this.justJumped = true; }
    }
    this.jumpWasHeld = !!inp.jump;

    v.y -= P.GRAVITY * dt;
    if (v.y < -40) v.y = -40;

    this.unstick();
    const disp = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) * dt;
    const n = Math.max(1, Math.ceil(disp / 0.2));
    const wasAir = !this.onGround;
    for (let i = 0; i < n; i++) this._step(dt / n);
    if (wasAir && this.onGround) this.justLanded = true;

    this.stepSmooth *= Math.exp(-16 * dt);
    if (Math.abs(this.stepSmooth) < 0.001) this.stepSmooth = 0;
    const hs = Math.hypot(v.x, v.z);
    if (this.onGround && hs > 0.5) this.walkPhase += hs * dt * 1.9;
  }

  _step(dt) {
    const v = this.vel;
    let { x, y, z } = this.pos;
    const wasGround = this.onGround;

    // X
    let nx = x + v.x * dt;
    if (this.collides(nx, y, z)) {
      const sy = Math.round(y / BS) * BS + BS;
      if (wasGround && !this.collides(nx, sy, z)) { this.stepSmooth += sy - y; y = sy; x = nx; }
      else {
        nx = v.x > 0 ? Math.floor((nx + P.HW) / BS) * BS - P.HW - 0.001 : (Math.floor((nx - P.HW) / BS) + 1) * BS + P.HW + 0.001;
        if (!this.collides(nx, y, z)) x = nx;
        v.x = 0;
      }
    } else x = nx;

    // Z
    let nz = z + v.z * dt;
    if (this.collides(x, y, nz)) {
      const sy = Math.round(y / BS) * BS + BS;
      if (wasGround && !this.collides(x, sy, nz)) { this.stepSmooth += sy - y; y = sy; z = nz; }
      else {
        nz = v.z > 0 ? Math.floor((nz + P.HW) / BS) * BS - P.HW - 0.001 : (Math.floor((nz - P.HW) / BS) + 1) * BS + P.HW + 0.001;
        if (!this.collides(x, y, nz)) z = nz;
        v.z = 0;
      }
    } else z = nz;

    // Y
    let ny = y + v.y * dt;
    if (this.collides(x, ny, z)) {
      if (v.y < 0) {
        ny = (Math.floor(ny / BS) + 1) * BS;
        this.onGround = true; this.airJumps = this.maxAirJumps;
      } else ny = Math.floor((ny + P.H) / BS) * BS - P.H - 0.001;
      if (this.collides(x, ny, z)) ny = y;
      v.y = 0;
    } else {
      this.onGround = false;
      // 下樓梯：貼著地面走下去，不要每階都騰空
      if (wasGround && v.y <= 0) {
        const probe = ny - BS - 0.01;
        if (this.collides(x, probe, z)) {
          const ty = (Math.floor(probe / BS) + 1) * BS;
          if (ty < ny && !this.collides(x, ty, z)) { this.stepSmooth -= ny - ty; ny = ty; this.onGround = true; v.y = 0; }
        }
      }
    }
    this.pos.set(x, ny, z);
  }
}
