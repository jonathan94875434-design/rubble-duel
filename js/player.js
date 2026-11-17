import * as THREE from 'three';
import { BS, PLAYER as P } from './config.js';

// 物理固定每秒跑 120 次，跟螢幕更新率無關 → 60Hz 和 144Hz 的人跳起來一模一樣
const TICK = 1 / 120;

// 玩家物理：方盒 vs 方塊世界。真人和練習用 bot 共用這一份。
//
// 移動模型是 Source 引擎那一套：
//   地面 = 摩擦 + 往按鍵方向加速（放開方向鍵會滑一小段，按反方向可以「急停」）
//   空中 = 沒有摩擦，只能往按鍵方向補一點點速度 → 邊轉視角邊按 A/D 就能越跳越快（旋轉跳、連跳）
//   蹲下 = 身高變矮；在空中蹲會把腳收起來，所以「蹲跳」能上更高的箱子
export class Player {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3();   // 腳底中心（物理位置）
    this.prev = new THREE.Vector3();  // 上一個物理步的位置
    this.rpos = new THREE.Vector3();  // 畫面用的位置（在兩個物理步之間內插，鏡頭才會順）
    this.acc = 0;
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.h = P.H; this.crouched = false; this.eyeH = P.EYE;
    this.stepSmooth = 0;              // 上下階梯、空中收腿時讓鏡頭平滑
    this.maxAirJumps = 0; this.airJumps = 0;
    this.jumpWasHeld = false; this.coyote = 0;
    this.walkPhase = 0;
    this.justJumped = false; this.justLanded = false; this.landSpeed = 0;
  }

  spawn(s) {
    this.pos.set(s.x, s.y, s.z); this.vel.set(0, 0, 0);
    this.yaw = s.yaw; this.pitch = 0; this.onGround = false; this.stepSmooth = 0; this.airJumps = 0; this.coyote = 0;
    this.h = P.H; this.crouched = false; this.eyeH = P.EYE;
    this.unstick();
    this.prev.copy(this.pos); this.rpos.copy(this.pos); this.acc = 0;
  }

  _box(x, y, z, h) { return this.world.boxSolid(x - P.HW, y, z - P.HW, x + P.HW, y + h, z + P.HW); }
  collides(x, y, z) { return this._box(x, y, z, this.h); }

  unstick() {
    for (let i = 0; i < 40 && this.collides(this.pos.x, this.pos.y, this.pos.z); i++) this.pos.y += BS;
  }

  eyeY() { return this.rpos.y + this.eyeH - this.stepSmooth; }
  speed2d() { return Math.hypot(this.vel.x, this.vel.z); }

  setCrouch(want) {
    if (want === this.crouched) return;
    const d = P.H - P.CROUCH_H, { x, y, z } = this.pos;
    if (want) {
      this.crouched = true; this.h = P.CROUCH_H;
      if (!this.onGround) { this.pos.y += d; this.stepSmooth += d; }   // 空中蹲 = 收腿，腳底抬高
    } else if (this.onGround) {
      if (!this._box(x, y, z, P.H)) { this.crouched = false; this.h = P.H; }           // 頭上有空間才站得起來
    } else if (!this._box(x, y - d, z, P.H)) { this.pos.y -= d; this.stepSmooth -= d; this.crouched = false; this.h = P.H; } // 空中放腿
    else if (!this._box(x, y, z, P.H)) { this.crouched = false; this.h = P.H; }
  }

  // inp: { f, r: -1..1, jump, crouch: bool, speed: 倍率 }
  update(dt, inp) {
    this.justJumped = false; this.justLanded = false;
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= TICK - 1e-9 && n < 12) { this.prev.copy(this.pos); this._tick(TICK, inp); this.acc -= TICK; n++; }
    if (n === 12) this.acc = 0;
    this.rpos.lerpVectors(this.prev, this.pos, Math.max(0, Math.min(1, this.acc / TICK)));
  }

  _tick(dt, inp) {
    const v = this.vel;
    this.setCrouch(!!inp.crouch);
    this.eyeH += ((this.crouched ? P.CROUCH_EYE : P.EYE) - this.eyeH) * Math.min(1, dt * 14);

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * inp.f + cos * inp.r, wz = -cos * inp.f - sin * inp.r;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-5) { wx /= wl; wz /= wl; }
    const maxS = P.SPEED * inp.speed * (this.crouched && this.onGround ? P.CROUCH_SPEED : 1);

    // 跳：放在摩擦之前，落地瞬間起跳就不會被摩擦吃掉速度（連跳的關鍵）
    if (this.onGround) this.coyote = P.COYOTE; else this.coyote = Math.max(0, this.coyote - dt);
    if (inp.jump) {
      const fresh = !this.jumpWasHeld;
      if ((this.onGround || (this.coyote > 0 && v.y <= 0)) && (fresh || P.AUTO_BHOP)) {
        v.y = P.JUMP; this.onGround = false; this.coyote = 0; this.justJumped = true;
        const hs = Math.hypot(v.x, v.z);
        if (hs > P.BHOP_CAP) { v.x *= P.BHOP_CAP / hs; v.z *= P.BHOP_CAP / hs; }
      } else if (fresh && !this.onGround && this.airJumps > 0) { v.y = P.JUMP * 0.95; this.airJumps--; this.justJumped = true; }
    }
    this.jumpWasHeld = !!inp.jump;

    if (this.onGround) {
      const sp = Math.hypot(v.x, v.z);
      if (sp > 1e-4) {
        const drop = Math.max(sp, P.STOP_SPEED) * P.FRICTION * dt;
        const k = Math.max(0, sp - drop) / sp;
        v.x *= k; v.z *= k;
      }
      if (wl > 0) {
        const add = maxS - (v.x * wx + v.z * wz);
        if (add > 0) { const a = Math.min(P.ACCEL * dt * maxS, add); v.x += a * wx; v.z += a * wz; }
      }
    } else if (wl > 0) {
      const add = Math.min(maxS, P.AIR_CAP) - (v.x * wx + v.z * wz);
      if (add > 0) { const a = Math.min(P.AIR_ACCEL * maxS * dt, add); v.x += a * wx; v.z += a * wz; }
    }

    v.y -= P.GRAVITY * dt;
    if (v.y < -40) v.y = -40;

    this.unstick();
    const disp = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) * dt;
    const n = Math.max(1, Math.ceil(disp / 0.2));
    const wasAir = !this.onGround, vy = v.y;
    for (let i = 0; i < n; i++) this._step(dt / n);
    if (wasAir && this.onGround) { this.justLanded = true; this.landSpeed = -vy; }

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
      } else ny = Math.floor((ny + this.h) / BS) * BS - this.h - 0.001;
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
