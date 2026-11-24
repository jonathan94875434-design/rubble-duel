import * as THREE from 'three';
import { BS } from './config.js';
import { CARDS, SK, BERSERK, rage } from './cards.js';
import { B } from './world.js';
import { clamp, r3 } from './util.js';

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const vec3 = (a) => Array.isArray(a) && a.length === 3 && a.every((v) => Number.isFinite(v) && Math.abs(v) < 500);
const TONE = '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';

// 邊緣發光的球殼（能量護罩、黑洞外圍那一圈光）：越斜著看越亮，uGrid > 0 時再疊一層格線
const RIM_V = `varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() { vec4 wp = modelMatrix * vec4(position, 1.); vP = position; vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const RIM_F = `uniform float uT, uA, uGrid, uPow; uniform vec3 uC; varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() {
  float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), uPow);
  float g = smoothstep(.93, 1., abs(sin(vP.y * 19. + uT * 1.7))) * .4 + smoothstep(.96, 1., abs(sin(atan(vP.z, vP.x) * 14.))) * .3;
  gl_FragColor = vec4(uC * (1. + f * 2.5), (f + g * uGrid + .05 * uGrid) * uA);${TONE}}`;
// 黑洞的吸積盤：一圈往中心捲的光帶
const DISK_V = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }';
const DISK_F = `uniform float uT, uA; varying vec2 vUv;
void main() {
  vec2 p = vUv * 2. - 1.; float r = length(p), a = atan(p.y, p.x);
  float band = smoothstep(.26, .36, r) * smoothstep(1., .5, r);
  float sw = (.55 + .45 * sin(a * 3. + r * 14. - uT * 7.)) * (.7 + .3 * sin(a * 7. - r * 9. + uT * 3.));
  vec3 c = mix(vec3(1.7, .5, 2.8), vec3(.35, 1.2, 2.8), smoothstep(.35, .95, r));
  gl_FragColor = vec4(c * (1.4 + sw), band * sw * uA);${TONE}}`;

// Roguelike 模式的主動技能：按鍵施放、冷卻、對雙方的效果、所有技能特效。
// 跟子彈一樣是「施放的人說了算」：自己這邊先生效，再用 'sk' 訊息告訴對手（對手那邊負責畫出來、套用被控效果）。
// 會改地形的走既有的爆炸訊息（'expl'）；鋼牆的方塊清單直接放在 'sk' 裡。
export class Skills {
  constructor(g) {
    this.g = g; this.t = 0;
    this.slots = [null, null]; this.ready = [0, 0]; this.uses = [0, 0];
    this.wallType = B.METAL;                       // 鋼牆技能用什麼方塊（守據點蓋的是沙包，機器人打得爛）
    this._reset();
    this._build();
  }

  _reset() {
    this.grap = null; this.rgrap = null;          // 我的鉤索／對手的鉤索
    this.cloakEnd = 0; this.rCloakEnd = 0;        // 我隱身到何時／對手隱身到何時
    this.scanEnd = 0; this.scannedEnd = 0;        // 我在透視對手／我被透視
    this.slowEnd = 0; this.rSlowEnd = 0;          // 我被時間凝結／對手被凝結
    this.stopEnd = 0; this.rStopEnd = 0;          // 我被時間暫停／對手被暫停
    this.stimEnd = 0; this.inHole = false; this.radarAt = 0; this.markAt = 0; this.hid = false; this.btUsed = false;
    this.domes = []; this.holes = []; this.marks = []; this.jets = []; this.rains = [];
    this.myWall = new Set();                      // 這一局我立的鋼牆方塊（對手說「這格蓋在我身上」時，只有這些可以撤掉）
  }

  _build() {
    const sc = this.g.scene;
    const glow = (color, o = {}) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, ...o });
    const add = (m) => { m.visible = false; sc.add(m); return m; };
    const rim = (c, grid, pow) => new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uA: { value: 0 }, uGrid: { value: grid }, uPow: { value: pow }, uC: { value: new THREE.Color(c) } },
      vertexShader: RIM_V, fragmentShader: RIM_F, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const box = new THREE.BoxGeometry(1, 1, 1), sph = new THREE.SphereGeometry(1, 48, 28);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true).translate(0, 0.5, 0), ringG = new THREE.RingGeometry(0.86, 1, 56).rotateX(-Math.PI / 2);
    // 鉤索的繩子（0 = 我的、1 = 對手的）
    this.ropes = [0, 1].map(() => { const m = add(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0xcfe6ff, toneMapped: false }))); m.frustumCulled = false; return m; });
    // 透視：穿牆也看得到的紅色人形
    const sm = new THREE.MeshBasicMaterial({ color: 0xff3528, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, toneMapped: false });
    this.sil = add(new THREE.Group());
    this.silBody = new THREE.Mesh(new THREE.BoxGeometry(0.56, 1, 0.34), sm); this.silHead = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), sm);
    this.silBody.renderOrder = this.silHead.renderOrder = 30; this.sil.add(this.silBody, this.silHead);
    // 能量護罩
    this.domeM = [0, 1, 2].map(() => add(new THREE.Mesh(sph, rim(0x39c8ff, 1, 2.2))));
    // 黑洞：全黑的球 + 外圍一圈光 + 吸積盤
    this.holeM = [0, 1].map(() => {
      const grp = add(new THREE.Group());
      const core = new THREE.Mesh(sph, new THREE.MeshBasicMaterial({ color: 0x000000 }));
      const halo = new THREE.Mesh(sph, rim(0xa64bff, 0, 1.5)); halo.scale.setScalar(1.5);
      const disk = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: { uT: { value: 0 }, uA: { value: 1 } }, vertexShader: DISK_V, fragmentShader: DISK_F, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      disk.scale.setScalar(4.6); disk.renderOrder = 7;
      grp.add(core, halo, disk);
      return { grp, core, halo, disk };
    });
    // 軌道砲：瞄準用的細紅光 + 地上的圈；打下來時是一根很粗的白色光柱
    this.markM = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(() => { const o = { beam: add(new THREE.Mesh(cyl, glow(0xff3a2a))), ring: add(new THREE.Mesh(ringG, glow(0xff4a3a))), core: add(new THREE.Mesh(cyl, glow(0xffffff))) }; o.core.material.color.setRGB(7, 9, 11); return o; });
    // 貼地往外擴的光圈（衝擊波、重生、黑洞爆開）
    this.novas = [0, 1, 2, 3].map(() => ({ m: add(new THREE.Mesh(ringG, glow(0xffffff))), life: 0, max: 1, r: 1 }));
    this.nnext = 0;
    // 技能用的一盞光（黑洞的紫光、護罩的藍光、光柱）。固定放一盞，數量不變著色器就不用重編
    this.light = new THREE.PointLight(0xffffff, 0, 26, 2); sc.add(this.light);
  }

  // ───────── 每一局 ─────────
  // skills = 主機狀態裡我的兩格技能（[代號或 null, 代號或 null]）；uses = 指定每格能用幾次（不給就照卡片）
  setup(skills, uses) {
    this.clear();
    this.slots = [0, 1].map((i) => (skills && CARDS[skills[i]] && CARDS[skills[i]].k === 'a' ? skills[i] : null));
    const extra = this.g.combat.mods.extraUses || 0;   // 超頻：有次數的技能每局多一次
    this.ready = [0, 0]; this.uses = this.slots.map((id, i) => (uses && uses[i] !== undefined ? uses[i] : id && CARDS[id].uses ? CARDS[id].uses + extra : 0));
  }
  // 只補次數，不清掉場上的東西（守據點每一波休息時）
  refill(i, n) { if (this.slots[i]) { this.uses[i] = n; this.ready[i] = 0; } }
  // 開打的瞬間：殺傷力大的技能要等幾秒才能用（不然一開局就能往對手的出生點丟）
  go(now) { this.slots.forEach((id, i) => { if (id && CARDS[id].lock) this.ready[i] = Math.max(this.ready[i], now + CARDS[id].lock * 1000); }); }

  clear() {
    this._reset();
    for (const m of [...this.ropes, this.sil, ...this.domeM, ...this.holeM.map((h) => h.grp)]) m.visible = false;
    for (const m of this.markM) m.beam.visible = m.ring.visible = m.core.visible = false;
    for (const n of this.novas) { n.life = 0; n.m.visible = false; }
    this.light.intensity = 0;
    if (this.g.sfx.loop) this.g.sfx.loop('void', 'void', 0);
  }

  // ───────── 施放 ─────────
  use(i) {
    const g = this.g, id = this.slots[i], now = performance.now();
    if (!id || (g.phase !== 'playing' && g.phase !== 'horde') || !g.meAlive() || g.kc || g.emote || this.frozen()) return false;
    const c = CARDS[id];
    if (now < this.ready[i] || (c.uses && this.uses[i] <= 0)) { g.sfx.deny(); return false; }
    if (!this['_' + id](now)) { g.sfx.deny(); return false; }
    this.ready[i] = now + c.cd * 1000 * (this.g.combat.mods.cd || 1);
    if (c.uses) this.uses[i]--;
    return true;
  }
  frozen() { return performance.now() < this.stopEnd; }
  _send(d) { this.g.sendPeer('sk', { r: this.g.round, ...d }); }
  _aim() { const e = this.g.camera.matrixWorld.elements; return { ox: e[12], oy: e[13], oz: e[14], dx: -e[8], dy: -e[9], dz: -e[10], rx: e[0], ry: e[1], rz: e[2] }; }
  _snd(kind, x, z) { const g = this.g; g.sfx.skill(kind, Math.hypot(x - g.camera.position.x, z - g.camera.position.z), g.panOf(x, z)); }

  // 瞬移：沿著準星方向找最遠的落腳點；中間隔著不超過 1.6 公尺厚的牆可以直接穿過去
  _blink() {
    const g = this.g, p = g.player, a = this._aim();
    let dx = a.dx, dy = a.dy, dz = a.dz;
    const hl = Math.hypot(dx, dz);
    if (p.onGround && dy < 0 && hl > 0.25) { dx /= hl; dz /= hl; dy = 0; }      // 站在地上往下看：當成往前
    let best = null, solid = 0;
    for (let s = 0.25; s <= 9.001; s += 0.25) {
      const x = p.pos.x + dx * s, y = p.pos.y + dy * s, z = p.pos.z + dz * s;
      if (p.collides(x, y, z)) { solid += 0.25; if (solid > 1.6) break; } else { best = [x, y, z]; solid = 0; }
    }
    if (!best) return false;
    const from = [r3(p.pos.x), r3(p.pos.y + 0.9), r3(p.pos.z)], to = [r3(best[0]), r3(best[1] + 0.9), r3(best[2])];
    p.pos.set(best[0], best[1], best[2]); p.prev.copy(p.pos); p.rpos.copy(p.pos); p.onGround = false; p.stepSmooth = 0;
    this._blinkFx(from, to); g.sfx.skill('blink');
    this._send({ id: 'blink', a: from, b: to });
    return true;
  }
  _blinkFx(a, b) {
    const fx = this.g.fx;
    fx.tracer(_a.set(a[0], a[1], a[2]), _b.set(b[0], b[1], b[2]), 0x7fe0ff, 0.14, 0.28);
    for (let i = 0; i <= 14; i++) {
      const k = i / 14, x = a[0] + (b[0] - a[0]) * k, y = a[1] + (b[1] - a[1]) * k, z = a[2] + (b[2] - a[2]) * k;
      fx.glowP.spawn(x, y + (Math.random() - 0.5) * 0.8, z, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, 0.22, 0.03, 0.3 + Math.random() * 0.3, 1.2, 4.5, 6, 0.9, 0, 2);
    }
    for (const q of [a, b]) for (let i = 0; i < 10; i++) { const an = Math.random() * 6.283; fx.glowP.spawn(q[0], q[1], q[2], Math.cos(an) * 4, (Math.random() - 0.3) * 4, Math.sin(an) * 4, 0.16, 0.02, 0.35, 2, 5, 7, 1, 2, 3); }
    fx.light(b[0], b[1], b[2], 0x66d8ff, 50, 0.25, 12);
  }

  // 鉤索：打到東西才算數，然後每一幀把速度設成「朝鉤點衝」
  _grapple(now) {
    const g = this.g, a = this._aim(), h = g.world.raycast(a.ox, a.oy, a.oz, a.dx, a.dy, a.dz, SK.grapple.range);
    if (!h || h.oob || h.dist < 1.5) return false;
    const x = r3(a.ox + a.dx * h.dist), y = r3(a.oy + a.dy * h.dist), z = r3(a.oz + a.dz * h.dist);
    this.grap = { x, y, z, t0: now, end: now + SK.grapple.time * 1000, stall: 0, lx: g.player.pos.x, ly: g.player.pos.y, lz: g.player.pos.z };
    g.sfx.skill('grapple'); g.fx.impact(x, y, z, h.nx, h.ny, h.nz, h.type, 5);
    this._send({ id: 'grapple', p: [x, y, z], d: SK.grapple.time });
    return true;
  }
  _dropGrap(fling) {
    if (!this.grap) return;
    this.grap = null;
    if (!fling) this.g.player.vel.multiplyScalar(0.5);                         // 自己放開（按跳）才保留全部速度
    this._send({ id: 'grapple', off: 1 });
  }

  // 噴射背包
  _jet(now) {
    const g = this.g, p = g.player, a = this._aim(), hl = Math.hypot(a.dx, a.dz) || 1;
    const J = SK.jet;
    p.vel.y = J.up; p.vel.x += (a.dx / hl) * J.fwd; p.vel.z += (a.dz / hl) * J.fwd; p.onGround = false;
    const hs = Math.hypot(p.vel.x, p.vel.z); if (hs > J.cap) { p.vel.x *= J.cap / hs; p.vel.z *= J.cap / hs; }
    this.jets.push({ me: true, end: now + 450 });
    g.sfx.skill('jet'); g.shake = Math.min(1, g.shake + 0.3);
    this._send({ id: 'jet' });
    return true;
  }

  // 衝刺：往按著的方向（沒按就往前）水平衝出去；在空中不會掉速度，所以會滑一大段
  _dash(now) {
    const g = this.g, p = g.player, f = (g.held('fwd') ? 1 : 0) - (g.held('back') ? 1 : 0), r = (g.held('right') ? 1 : 0) - (g.held('left') ? 1 : 0);
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    let dx = -sy * (f || (r ? 0 : 1)) + cy * r, dz = -cy * (f || (r ? 0 : 1)) - sy * r;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    p.vel.x = dx * SK.dash.speed; p.vel.z = dz * SK.dash.speed; p.vel.y = Math.max(p.vel.y, SK.dash.up); p.onGround = false;
    this.jets.push({ me: true, end: now + 200, dash: true });
    g.sfx.skill('jet'); g.shake = Math.min(1, g.shake + 0.2);
    this._send({ id: 'dash' });
    return true;
  }

  // 鋼牆：面前 2.1 公尺處，沿著跟視線垂直的方向立一道 7 格寬、5 格高的鋼板；不會把任何一個人埋進去
  _wall() {
    const g = this.g, p = g.player, w = g.world, fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const alongX = Math.abs(fz) >= Math.abs(fx);
    const cx = Math.floor((p.pos.x + fx * 2.1) / BS), cz = Math.floor((p.pos.z + fz * 2.1) / BS);
    let by = Math.floor((p.pos.y + 0.05) / BS);
    for (let k = 0; k < 4 && w.get(cx, by, cz); k++) by++;                       // 前面是台階：從台階上面開始蓋
    for (let k = 0; k < 6 && !w.get(cx, by - 1, cz); k++) by--;                  // 前面是懸空：往下找到地面
    const cells = [];
    for (let i = -3; i <= 3; i++) for (let j = 0; j < 5; j++) {
      const x = alongX ? cx + i : cx, z = alongX ? cz : cz + i, y = by + j;
      if (!w.inb(x, y, z) || w.types[w.idx(x, y, z)]) continue;
      if (this._boxHits(x, y, z, p.pos, 0.36, p.h) || (g.remote.alive && this._boxHits(x, y, z, g.remote.pos, 0.45, 1.85)) || (g.horde.on && g.horde.blocks(x, y, z))) continue;
      cells.push(w.idx(x, y, z));
    }
    if (cells.length < 4) return false;
    this._placeWall(cells, true, this.wallType);
    this._send({ id: 'wall', c: cells, b: this.wallType });
    return true;
  }
  _boxHits(bx, by, bz, pos, hw, h) {
    return (bx + 1) * BS > pos.x - hw && bx * BS < pos.x + hw && (bz + 1) * BS > pos.z - hw && bz * BS < pos.z + hw && (by + 1) * BS > pos.y && by * BS < pos.y + h;
  }
  // mine = 是我放的。對手放的牆如果有幾格會蓋在我身上，我這邊不放，並且請對手把那幾格撤掉（兩邊地形才會一樣）
  _placeWall(cells, mine, type = B.METAL) {
    const g = this.g, w = g.world, p = g.player, skipped = [];
    let n = 0, sx = 0, sy = 0, sz = 0;
    for (const ci of cells) {
      if (!Number.isInteger(ci) || ci < 0 || ci >= w.types.length || w.types[ci]) continue;
      const x = ci % w.X, r = (ci - x) / w.X, z = r % w.Z, y = (r - z) / w.Z;
      if (!mine && g.meAlive() && this._boxHits(x, y, z, p.pos, 0.3, p.h)) { skipped.push(ci); continue; }
      w.edit(x, y, z, type);
      if (mine) this.myWall.add(ci);
      const wx = (x + 0.5) * BS, wy = (y + 0.5) * BS, wz = (z + 0.5) * BS;
      sx += wx; sy += wy; sz += wz; n++;
      if (n % 3 === 0) g.fx.smoke(wx, wy, wz, 1, 0.16);
      if (n % 5 === 0) g.fx.glowP.spawn(wx, wy, wz, (Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3, 0.1, 0.02, 0.3, 6, 5, 3, 1, 9);
    }
    if (n) this._snd('wall', sx / n, sz / n);
    if (skipped.length) this._send({ id: 'unwall', c: skipped });
  }
  _unwall(cells) {
    const w = this.g.world;
    for (const ci of cells) {
      if (!this.myWall.has(ci) || (w.types[ci] !== B.METAL && w.types[ci] !== B.SANDBAG)) continue;
      const x = ci % w.X, r = (ci - x) / w.X, z = r % w.Z, y = (r - z) / w.Z;
      w.edit(x, y, z, 0); this.myWall.delete(ci);
    }
  }

  // 腎上腺素：補血由裁判算，加速是本機的
  _stim(now) {
    const g = this.g, p = g.player.pos;
    g.auth('skill', { r: g.round, id: 'stim' });
    this.stimEnd = now + SK.stim.time * 1000;
    g.sfx.skill('stim'); this._sparkle(p.x, p.y + 1, p.z, 1.2, 6, 2);
    this._send({ id: 'stim' });
    return true;
  }
  _sparkle(x, y, z, r, g2, b) {
    const fx = this.g.fx;
    for (let i = 0; i < 16; i++) { const a = Math.random() * 6.283; fx.glowP.spawn(x + Math.cos(a) * 0.4, y + (Math.random() - 0.5), z + Math.sin(a) * 0.4, Math.cos(a) * 0.6, 1.5 + Math.random() * 2, Math.sin(a) * 0.6, 0.1, 0.02, 0.5 + Math.random() * 0.4, r, g2, b, 0.9, -1, 1); }
  }

  _scan(now) {
    this.scanEnd = now + SK.scan.time * 1000;
    this.g.sfx.skill('scan');
    this._send({ id: 'scan', d: SK.scan.time });
    return true;
  }

  _cloak(now) {
    const p = this.g.player.pos;
    this.cloakEnd = now + 5000;
    this.g.sfx.skill('cloak'); this._puff(p.x, p.y + 1, p.z);
    this._send({ id: 'cloak', d: 5 });
    return true;
  }
  // 開槍、出刀、丟東西：迷彩失效
  breakCloak() {
    if (performance.now() >= this.cloakEnd) return;
    this.cloakEnd = 0;
    this._send({ id: 'cloak', d: 0 });
  }
  _puff(x, y, z) { const fx = this.g.fx; for (let i = 0; i < 12; i++) fx.glowP.spawn(x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.5) * 1.4, z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0.2, 0.02, 0.4, 2.5, 3.5, 4.5, 0.6, 0, 2); }

  _dome(now) {
    const p = this.g.player.pos, d = { x: r3(p.x), y: r3(p.y + 0.3), z: r3(p.z), r: SK.dome.r, t0: now, end: now + SK.dome.time * 1000, pulse: 0 };
    this._addDome(d);
    this._send({ id: 'dome', p: [d.x, d.y, d.z], d: SK.dome.time, rr: SK.dome.r });
    return true;
  }
  _addDome(d) { if (this.domes.length >= this.domeM.length) this.domes.shift(); this.domes.push(d); this._snd('dome', d.x, d.z); }
  // 子彈會不會被護罩擋下：回傳沿著射線到「穿過任何一個護罩表面」的最近距離（從外面打進去、從裡面打出來都算），沒有就是 Infinity
  shieldDist(ox, oy, oz, dx, dy, dz) {
    let best = Infinity;
    if (!this.domes.length) return best;
    const now = performance.now();
    for (const d of this.domes) {
      if (now >= d.end) continue;
      const mx = ox - d.x, my = oy - d.y, mz = oz - d.z, b = mx * dx + my * dy + mz * dz, c = mx * mx + my * my + mz * mz - d.r * d.r, disc = b * b - c;
      if (disc < 0) continue;
      const s = Math.sqrt(disc), t = -b - s > 0.05 ? -b - s : -b + s;
      if (t > 0.05 && t < best) best = t;
    }
    return best;
  }
  shieldSpark(x, y, z) {
    const fx = this.g.fx;
    for (let i = 0; i < 5; i++) fx.glowP.spawn(x, y, z, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, 0.12, 0.02, 0.2 + Math.random() * 0.15, 1.5, 6, 9, 1, 0, 3);
    for (const d of this.domes) if (Math.abs(Math.hypot(x - d.x, y - d.y, z - d.z) - d.r) < 0.2) d.pulse = 1;
  }

  // 震地衝擊波：爆炸中心放在腰的高度，腳下的地板大致留著，身邊的掩體會碎
  _shock() {
    const g = this.g, p = g.player.pos, rp = g.remote.pos, S = SK.shock;
    const msg = { r: g.round, pid: 0, p: [r3(p.x), r3(p.y + 1.0), r3(p.z)], br: 2.6, bp: 340, rad: S.rad, k: S.k, fxk: 'shock', own: g.me };
    g.sendPeer('expl', msg); g.doExplosion(msg);
    const d = Math.hypot(rp.x - p.x, rp.y - p.y, rp.z - p.z);
    if (g.remote.alive && d < S.rad) this._hit(S.min + (S.max - S.min) * (1 - d / S.rad), 'shock');
    return true;
  }
  _hit(d, w) { const g = this.g; g.auth('hit', { r: g.round, d, h: false, w }); g.hud.hitmarker(false); g.sfx.hit(false); g.remote.hitFlash(); }

  _chrono(now) {
    const g = this.g, rp = g.remote.pos;
    this.rSlowEnd = now + SK.chrono.time * 1000;
    g.sfx.skill('chrono'); this.nova(rp.x, rp.y + 0.1, rp.z, 0x59b8ff, 3, 0.6);
    this._send({ id: 'chrono', d: SK.chrono.time });
    return true;
  }

  // 時間暫停（神話）：對手完全不能動
  _timestop(now) {
    const g = this.g, rp = g.remote.pos;
    if (!g.remote.alive) return false;
    this.rStopEnd = now + SK.timestop.time * 1000;
    g.sfx.skill('chrono'); this.nova(rp.x, rp.y + 0.1, rp.z, 0xffffff, 5, 0.8); this.nova(rp.x, rp.y + 1, rp.z, 0x59b8ff, 3, 1.2);
    this._send({ id: 'timestop', d: SK.timestop.time });
    return true;
  }

  // 換位：跟看得到的對手瞬間交換位置
  _swap() {
    const g = this.g, p = g.player, rm = g.remote;
    if (!rm.alive) return false;
    const ex = p.pos.x, ey = p.pos.y + 1.4, ez = p.pos.z;
    let dx = rm.pos.x - ex, dy = rm.pos.y + 1.2 - ey, dz = rm.pos.z - ez;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > SK.swap.range || dist < 0.5) return false;
    dx /= dist; dy /= dist; dz /= dist;
    if (g.world.raycast(ex, ey, ez, dx, dy, dz, dist - 0.3)) return false;          // 中間隔著牆：看不到就不能換
    if (p.collides(rm.pos.x, rm.pos.y, rm.pos.z)) return false;
    const a = [r3(p.pos.x), r3(p.pos.y), r3(p.pos.z)], b = [r3(rm.pos.x), r3(rm.pos.y), r3(rm.pos.z)];
    p.pos.set(b[0], b[1], b[2]); p.prev.copy(p.pos); p.rpos.copy(p.pos); p.vel.set(0, 0, 0); p.stepSmooth = 0;
    rm.clearBuffer(); rm.pos.set(a[0], a[1], a[2]); if (rm.lastPos) rm.lastPos.copy(rm.pos);
    this._swapFx(a, b); g.sfx.skill('blink');
    this._send({ id: 'swap', a, b });
    return true;
  }
  _swapFx(a, b) {
    const up = (q) => [q[0], q[1] + 0.9, q[2]];
    this._blinkFx(up(a), up(b)); this._blinkFx(up(b), up(a));
    this.nova(a[0], a[1] + 0.1, a[2], 0x7fe0ff, 2.5, 0.5); this.nova(b[0], b[1] + 0.1, b[2], 0x7fe0ff, 2.5, 0.5);
  }

  // 軌道砲：先標記，時間到由施放的人引爆
  _orbital(now) {
    const g = this.g, a = this._aim(), h = g.world.raycast(a.ox, a.oy, a.oz, a.dx, a.dy, a.dz, 90);
    if (!h || h.oob) return false;
    const p = [r3(a.ox + a.dx * h.dist + h.nx * 0.05), r3(a.oy + a.dy * h.dist + h.ny * 0.05), r3(a.oz + a.dz * h.dist + h.nz * 0.05)];
    this._addMark({ x: p[0], y: p[1], z: p[2], t0: now, at: now + SK.orbital.delay * 1000, mine: true, done: false, track: true, s: 1 });
    this._send({ id: 'orbital', p, d: SK.orbital.delay });
    return true;
  }

  // 流星雨（神話）：瞄準的地方陸續降下隕石，每一顆落點都對準當時附近的對手
  _meteor(now) {
    const g = this.g, a = this._aim(), h = g.world.raycast(a.ox, a.oy, a.oz, a.dx, a.dy, a.dz, 90);
    if (!h || h.oob) return false;
    const p = [a.ox + a.dx * h.dist, a.oy + a.dy * h.dist + 0.05, a.oz + a.dz * h.dist];
    this.rains.push({ x: p[0], y: p[1], z: p[2], next: now, n: SK.meteor.n });
    this._snd('mark', p[0], p[2]);
    return true;
  }
  _rainTick(now) {
    const g = this.g, M = SK.meteor, rm = g.remote;
    for (let i = this.rains.length - 1; i >= 0; i--) {
      const r = this.rains[i];
      while (r.n > 0 && now >= r.next) {
        r.n--; r.next += M.gap * 1000;
        let cx = r.x, cz = r.z, cy = r.y;
        if (rm.alive && Math.hypot(rm.pos.x - r.x, rm.pos.z - r.z) < M.trackR) { cx = rm.pos.x; cz = rm.pos.z; cy = rm.pos.y; }
        const an = Math.random() * 6.283, rr = Math.random() * M.spread * (r.n === M.n - 1 ? 0.3 : 1);
        const x = cx + Math.cos(an) * rr, z = cz + Math.sin(an) * rr;
        const down = g.world.raycast(x, cy + 6, z, 0, -1, 0, 16), y = down && !down.oob ? cy + 6 - down.dist + 0.05 : cy + 0.05;
        const p = [r3(x), r3(y), r3(z)];
        this._addMark({ x: p[0], y: p[1], z: p[2], t0: now, at: now + M.delay * 1000, mine: true, done: false, s: 0.55, meteor: true });
        this._send({ id: 'orbital', p, d: M.delay, k: 'm' });
      }
      if (r.n <= 0) this.rains.splice(i, 1);
    }
  }
  _addMark(m) { if (this.marks.length >= this.markM.length) this.marks.shift(); this.marks.push(m); this._snd('mark', m.x, m.z); }
  // 光柱打下來（只有施放的人會跑這裡）：往下連炸三層，把地面鑽穿；光柱範圍內的人吃滿傷害，旁邊的遞減
  _strike(m) {
    const g = this.g;
    if (m.meteor) {                                          // 流星雨的一顆：一次比較小的爆炸
      const M = SK.meteor, msg = { r: g.round, pid: 0, p: [m.x, r3(m.y + 0.3), m.z], br: 1.9, bp: 700, rad: 4, k: 10, own: g.me };
      g.sendPeer('expl', msg); g.doExplosion(msg);
      const f = (pos) => { const d = Math.hypot(pos.x - m.x, pos.y + 0.9 - (m.y + 0.6), pos.z - m.z); return d < M.full ? 1 : Math.max(0, 1 - (d - M.full) / M.fade); };
      const fr = f(g.remote.pos), fm = f(g.player.pos);
      if (g.remote.alive && fr > 0) this._hit(M.dmg * fr, 'meteor');
      if (g.meAlive() && fm > 0) g.auth('self', { r: g.round, d: M.dmg * fm * 0.4, w: 'meteor' });
      return;
    }
    const O = SK.orbital;
    for (let k = 0; k < 3; k++) {
      const msg = { r: g.round, pid: 0, p: [m.x, r3(m.y + 0.3 - k * 1.5), m.z], br: 2.7, bp: 1300, rad: k ? 0 : 6.5, k: k ? 0 : 14, own: g.me };
      if (k) msg.kind = 'dig'; else msg.fxk = 'orbital';
      g.sendPeer('expl', msg); g.doExplosion(msg);
    }
    const f = (pos) => { const cy = clamp(pos.y + 0.9, m.y - 3.5, m.y + 40), d = Math.hypot(pos.x - m.x, pos.y + 0.9 - cy, pos.z - m.z); return d < O.full ? 1 : Math.max(0, 1 - (d - O.full) / O.fade); };
    const fr = f(g.remote.pos), fm = f(g.player.pos);
    if (g.remote.alive && fr > 0) this._hit(O.dmg * fr, 'orbital');
    if (g.meAlive() && fm > 0) g.auth('self', { r: g.round, d: O.dmg * fm * 0.6, w: 'orbital' });
  }

  // 黑洞
  _blackhole(now) {
    const g = this.g, a = this._aim(), h = g.world.raycast(a.ox, a.oy, a.oz, a.dx, a.dy, a.dz, 24), t = h ? Math.max(1.5, h.dist - 1.1) : 24;
    const p = [r3(a.ox + a.dx * t), r3(a.oy + a.dy * t), r3(a.oz + a.dz * t)];
    g.fx.tracer(_a.set(a.ox + a.rx * 0.2, a.oy - 0.2, a.oz + a.rz * 0.2), _b.set(p[0], p[1], p[2]), 0xb060ff, 0.1, 0.3);
    this._addHole({ x: p[0], y: p[1], z: p[2], t0: now, end: now + SK.blackhole.time * 1000, mine: true, tick: now + 300, done: false });
    this._send({ id: 'blackhole', p, d: SK.blackhole.time });
    return true;
  }
  _addHole(h) { if (this.holes.length >= this.holeM.length) this.holes.shift(); this.holes.push(h); this._snd('hole', h.x, h.z); }

  // ───────── 對手施放的技能 ─────────
  onNet(d) {
    const g = this.g, now = performance.now();
    if (!d || d.r !== g.round || !g.inRound() || typeof d.id !== 'string') return;
    const dur = (lo, hi) => clamp(+d.d || 0, lo, hi) * 1000, rp = g.remote.pos;
    switch (d.id) {
      case 'blink':
        if (vec3(d.a) && vec3(d.b)) { this._blinkFx(d.a, d.b); g.remote.clearBuffer(); this._snd('blink', d.b[0], d.b[2]); }
        break;
      case 'grapple':
        if (d.off) this.rgrap = null;
        else if (vec3(d.p)) { this.rgrap = { x: d.p[0], y: d.p[1], z: d.p[2], end: now + dur(0.2, 2) }; this._snd('grapple', rp.x, rp.z); }
        break;
      case 'jet': this.jets.push({ me: false, end: now + 450 }); this._snd('jet', rp.x, rp.z); break;
      case 'dash': this.jets.push({ me: false, end: now + 200, dash: true }); this._snd('jet', rp.x, rp.z); break;
      case 'wall': if (Array.isArray(d.c) && d.c.length <= 40) this._placeWall(d.c, false, d.b === B.SANDBAG ? B.SANDBAG : B.METAL); break;
      case 'unwall': if (Array.isArray(d.c) && d.c.length <= 40) this._unwall(d.c); break;
      case 'stim': this._sparkle(rp.x, rp.y + 1, rp.z, 1.2, 6, 2); this._snd('stim', rp.x, rp.z); break;
      case 'scan': this.scannedEnd = now + dur(1, 6); g.sfx.skill('scan'); g.hud.feed('對手用透視脈衝掃到你了'); break;
      case 'cloak': this.rCloakEnd = d.d > 0 ? now + dur(0.5, 8) : 0; this._puff(rp.x, rp.y + 1, rp.z); this._snd('cloak', rp.x, rp.z); break;
      case 'dome': if (vec3(d.p)) this._addDome({ x: d.p[0], y: d.p[1], z: d.p[2], r: clamp(+d.rr || 3.2, 2, 4.5), t0: now, end: now + dur(1, 8), pulse: 0 }); break;
      case 'chrono': {
        const p = g.player.pos;
        this.slowEnd = now + dur(0.5, 6); g.sfx.skill('chrono'); g.hud.banner('時間凝結', '你的時間變慢了', 1300); this.nova(p.x, p.y + 0.1, p.z, 0x59b8ff, 3, 0.6);
        break;
      }
      case 'timestop': {
        const p = g.player.pos;
        this.stopEnd = now + dur(0.5, 3.5); g.sfx.skill('chrono'); g.hud.banner('時間暫停', '你完全動不了', 1300);
        this.nova(p.x, p.y + 0.1, p.z, 0xffffff, 5, 0.8); this.nova(p.x, p.y + 1, p.z, 0x59b8ff, 3, 1.2);
        if (this.grap) this._dropGrap(false);
        break;
      }
      case 'swap': {
        if (!vec3(d.a) || !vec3(d.b) || !g.meAlive()) break;
        const p = g.player;
        if (p.collides(d.a[0], d.a[1], d.a[2])) break;                          // 那個位置現在被擋住了（地形剛好被打爛之類）：不換
        p.pos.set(d.a[0], d.a[1], d.a[2]); p.prev.copy(p.pos); p.rpos.copy(p.pos); p.vel.set(0, 0, 0); p.stepSmooth = 0;
        g.remote.clearBuffer(); g.remote.pos.set(d.b[0], d.b[1], d.b[2]); if (g.remote.lastPos) g.remote.lastPos.copy(g.remote.pos);
        if (this.grap) this._dropGrap(false);
        this._swapFx(d.a, d.b); g.sfx.skill('blink'); g.hud.banner('換位', '對手跟你交換了位置', 1100);
        break;
      }
      case 'orbital': if (vec3(d.p)) this._addMark({ x: d.p[0], y: d.p[1], z: d.p[2], t0: now, at: now + dur(0.5, 3), mine: false, done: false, track: d.k !== 'm', s: d.k === 'm' ? 0.55 : 1, meteor: d.k === 'm' }); break;
      case 'blackhole': if (vec3(d.p)) this._addHole({ x: d.p[0], y: d.p[1], z: d.p[2], t0: now, end: now + dur(1, 6), mine: false, tick: 0, done: false }); break;
    }
  }

  // 不死鳥重生（裁判通知，雙方都會收到）
  phoenix(who) {
    const g = this.g, mine = who === g.me, p = mine ? g.player.pos : g.remote.pos, fx = g.fx;
    this.nova(p.x, p.y + 0.1, p.z, 0xff8a2a, 6, 0.7);
    for (let i = 0; i < 46; i++) { const a = Math.random() * 6.283, s = 1 + Math.random() * 5; fx.glowP.spawn(p.x, p.y + 0.3 + Math.random() * 1.4, p.z, Math.cos(a) * s, 2 + Math.random() * 6, Math.sin(a) * s, 0.5, 0.06, 0.5 + Math.random() * 0.6, 7, 2.6 + Math.random() * 2, 0.4, 0.9, -1, 1.5); }
    fx.light(p.x, p.y + 1, p.z, 0xff8a30, 220, 0.6, 22);
    this._snd('phoenix', p.x, p.z);
    if (mine) g.hud.banner('不死鳥', '浴火重生！短暫無敵', 1400); else g.hud.feed(`${g.gs ? g.gs.p[1 - g.me].n : '對手'} 浴火重生了`);
  }

  // 急救包（裁判通知，雙方都會收到）
  medkit(who) {
    const g = this.g, mine = who === g.me, p = mine ? g.player.pos : g.remote.pos;
    this._sparkle(p.x, p.y + 1, p.z, 1.5, 6, 2.5); this.nova(p.x, p.y + 0.1, p.z, 0x6aff9a, 2.5, 0.5);
    this._snd('stim', p.x, p.z);
    if (mine) g.hud.banner('急救包', '自動回復 50 生命', 1100);
  }

  nova(x, y, z, color, r, life) {
    const n = this.novas[this.nnext]; this.nnext = (this.nnext + 1) % this.novas.length;
    n.life = n.max = life; n.r = r; n.m.position.set(x, y, z); n.m.material.color.setHex(color).multiplyScalar(2.2); n.m.visible = true;
  }

  // ───────── 每一幀：會動到我的速度的效果（要排在物理之前）─────────
  pre(dt, now) {
    const g = this.g, p = g.player;
    this.inHole = false;
    if (!g.meAlive() || g.phase !== 'playing') { if (this.grap) this._dropGrap(false); return; }
    if (this.frozen()) { p.vel.x = 0; p.vel.z = 0; if (p.vel.y > 0) p.vel.y = 0; }      // 被時間暫停：釘在原地（還是會往下掉）
    const gp = this.grap;
    if (gp) {
      _v.set(gp.x - p.pos.x, gp.y - (p.pos.y + 1.0), gp.z - p.pos.z);
      const d = _v.length(), moved = Math.hypot(p.pos.x - gp.lx, p.pos.y - gp.ly, p.pos.z - gp.lz);
      gp.stall = moved < 4 * dt ? gp.stall + dt : 0; gp.lx = p.pos.x; gp.ly = p.pos.y; gp.lz = p.pos.z;
      if (g.held('jump') && now - gp.t0 > 180) this._dropGrap(true);
      else if (d < 1.5 || now > gp.end || gp.stall > 0.3) this._dropGrap(false);
      else { p.vel.copy(_v).multiplyScalar(SK.grapple.pull / d); p.onGround = false; }
    }
    // 對手的黑洞：把我吸過去，而且跑不快
    for (const h of this.holes) {
      if (h.mine || now >= h.end) continue;
      _v.set(h.x - p.pos.x, h.y - (p.pos.y + 0.9), h.z - p.pos.z);
      const d = _v.length();
      const H = SK.blackhole;
      if (d > H.pull || d < 0.3) continue;
      this.inHole = true;
      p.vel.addScaledVector(_v, ((H.base + H.str * (1 - d / H.pull)) * dt) / d);
    }
  }
  // 移動速度倍率：腎上腺素、時間凝結、冰凍彈、黑洞、狂戰士
  speedMul(me) {
    const now = performance.now();
    let k = 1;
    if (now < this.stopEnd) return 0;
    if (now < this.stimEnd) k *= SK.stim.speed;
    if (now < this.slowEnd) k *= SK.chrono.move;
    if (me && me.fz) k *= 0.55;
    if (this.inHole) k *= SK.blackhole.slow;
    if (me && this.g.combat.mods.berserk) k *= 1 + BERSERK.speed * rage(me.hp, me.mhp);
    return k;
  }
  lookMul() { const now = performance.now(); return now < this.stopEnd ? 0 : now < this.slowEnd ? SK.chrono.look : 1; }
  oppCloaked() { const now = performance.now(); return now < this.rCloakEnd && now >= this.scanEnd; }

  // ───────── 每一幀：特效、計時、自己施放的東西到時間引爆 ─────────
  update(dt, now) {
    const g = this.g, gs = g.gs, rm = g.remote, p = g.player, fx = g.fx, cam = g.camera, live = g.phase === 'playing';
    this.t += dt;
    if (!gs) return;
    const me = gs.p[g.me], opp = gs.p[1 - g.me], alive = !!me.al, mods = g.combat.mods;
    if (!alive) this.inHole = false;

    // 鉤索的繩子
    const rope = (m, on, ax, ay, az, bx, by, bz) => {
      m.visible = on; if (!on) return;
      _a.set(ax, ay, az); _b.set(bx, by, bz);
      const len = _a.distanceTo(_b); if (len < 0.2) { m.visible = false; return; }
      m.position.copy(_a).add(_b).multiplyScalar(0.5); m.lookAt(_b); m.scale.set(0.025, 0.025, len);
    };
    const e = cam.matrixWorld.elements;
    if (this.grap) rope(this.ropes[0], !g.kc, e[12] + e[0] * 0.22 - e[4] * 0.22 - e[8] * 0.3, e[13] + e[1] * 0.22 - e[5] * 0.22 - e[9] * 0.3, e[14] + e[2] * 0.22 - e[6] * 0.22 - e[10] * 0.3, this.grap.x, this.grap.y, this.grap.z);
    else this.ropes[0].visible = false;
    if (this.rgrap && (now > this.rgrap.end || !rm.alive)) this.rgrap = null;
    if (this.rgrap) rope(this.ropes[1], true, rm.pos.x, rm.pos.y + 1.2, rm.pos.z, this.rgrap.x, this.rgrap.y, this.rgrap.z); else this.ropes[1].visible = false;

    // 噴射背包的火
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i], q = j.me ? p.pos : rm.pos;
      if (now >= j.end) { this.jets.splice(i, 1); continue; }
      for (let k = 0; k < 3; k++) fx.glowP.spawn(q.x + (Math.random() - 0.5) * 0.3, q.y + 0.1, q.z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 2, -6 - Math.random() * 5, (Math.random() - 0.5) * 2, 0.36, 0.06, 0.25 + Math.random() * 0.2, 7, 3 + Math.random() * 2, 0.6, 0.9, 0, 1);
      if (Math.random() < 0.5) fx.smoke(q.x, q.y - 0.2, q.z, 1, 0.2);
    }

    // 對手的迷彩：整個人不畫（被我透視時照畫）；移動時腳邊偶爾有一點扭曲的光，仔細看找得到
    const hide = rm.alive && this.oppCloaked() && !g.kc;
    if (hide) {
      rm.group.visible = false; this.hid = true;
      if (rm.speed > 2 && Math.random() < dt * 9) fx.glowP.spawn(rm.pos.x + (Math.random() - 0.5) * 0.4, rm.pos.y + 0.1 + Math.random() * 1.5, rm.pos.z + (Math.random() - 0.5) * 0.4, 0, 0.3, 0, 0.14, 0.02, 0.35, 0.5, 0.7, 0.9, 0.35);
    } else if (this.hid) { this.hid = false; rm.group.visible = g.inRound() && (opp.al || !!rm.dead) && !g.kc; }

    // 透視：紅色人形（不受牆遮擋）
    const scan = now < this.scanEnd && rm.alive && !g.kc;
    this.sil.visible = scan;
    if (scan) {
      const hgt = rm.crouched ? 0.92 : 1.42;
      this.sil.position.copy(rm.pos); this.sil.rotation.y = rm.yaw;
      this.silBody.scale.y = hgt; this.silBody.position.y = hgt / 2; this.silHead.position.y = hgt + 0.2;
      this.silBody.material.opacity = 0.42 + 0.16 * Math.sin(this.t * 9);
      g.mini.spot(now, rm.pos.x, rm.pos.z);
    }
    // 雷達（被動）：每 1.2 秒在小地圖上掃一次；獵人印記：打中之後 4 秒內一直標著
    if (mods.radar && live && alive && rm.alive && now >= this.radarAt) { this.radarAt = now + 1200; g.mini.spot(now, rm.pos.x, rm.pos.z); }
    if (mods.hunter && live && rm.alive && now < g.combat.markUntil && now >= this.markAt) { this.markAt = now + 250; g.mini.spot(now, rm.pos.x, rm.pos.z); }
    // 子彈時間（被動）：這一局血第一次掉到 40 以下，對手自動被凝結 3 秒
    if (mods.bullet && live && alive && rm.alive && !this.btUsed && me.hp < 40) {
      this.btUsed = true; this.rSlowEnd = now + 3000;
      g.sfx.skill('chrono'); this.nova(rm.pos.x, rm.pos.y + 0.1, rm.pos.z, 0x59b8ff, 3, 0.6); g.hud.banner('子彈時間', '對手的時間變慢了', 1100);
      this._send({ id: 'chrono', d: 3 });
    }
    if (live) this._rainTick(now);

    let lx = 0, ly = 0, lz = 0, li = 0, lc = 0xffffff;

    // 能量護罩
    for (let i = this.domes.length - 1; i >= 0; i--) if (now >= this.domes[i].end) this.domes.splice(i, 1);
    this.domeM.forEach((m, i) => {
      const d = this.domes[i]; m.visible = !!d; if (!d) return;
      const k = Math.min(1, (now - d.t0) / 250), fade = Math.min(1, (d.end - now) / 500);
      d.pulse = Math.max(0, d.pulse - dt * 5);
      m.position.set(d.x, d.y, d.z); m.scale.setScalar(d.r * (0.2 + 0.8 * k));
      m.material.uniforms.uT.value = this.t; m.material.uniforms.uA.value = (0.5 + d.pulse * 0.9) * fade;
      if (li < 5) { lx = d.x; ly = d.y + 1; lz = d.z; li = 5 * fade; lc = 0x39c8ff; }
    });

    // 黑洞
    let rumble = 0, rpan = 0;
    for (let i = this.holes.length - 1; i >= 0; i--) {
      const h = this.holes[i];
      if (now < h.end) {
        if (h.mine && live && now >= h.tick) {                                  // 我的黑洞：每 0.3 秒啃一圈方塊、咬一口靠太近的對手
          h.tick += 300;
          const H = SK.blackhole, msg = { r: g.round, pid: 0, p: [h.x, h.y, h.z], br: r3(Math.min(2.9, 1.4 + (now - h.t0) * 0.0005)), bp: 220, rad: 0, k: 0, kind: 'dig', own: g.me };
          g.sendPeer('expl', msg); g.doExplosion(msg);
          if (rm.alive && Math.hypot(rm.pos.x - h.x, rm.pos.y + 0.9 - h.y, rm.pos.z - h.z) < H.bite) this._hit(H.biteDmg, 'blackhole');
        }
        continue;
      }
      if (h.mine && live && !h.done) {                                          // 時間到：爆開
        h.done = true;
        const H = SK.blackhole, msg = { r: g.round, pid: 0, p: [h.x, h.y, h.z], br: 3, bp: 800, rad: H.boomR, k: 16, fxk: 'void', own: g.me };
        g.sendPeer('expl', msg); g.doExplosion(msg);
        const d = Math.hypot(rm.pos.x - h.x, rm.pos.y + 0.9 - h.y, rm.pos.z - h.z);
        if (rm.alive && d < H.boomR) this._hit(H.boomDmg * (d < 2 ? 1 : 1 - (d - 2) / (H.boomR - 2)), 'blackhole');
      }
      this.nova(h.x, h.y, h.z, 0xb060ff, 6, 0.5);
      this.holes.splice(i, 1);
    }
    this.holeM.forEach((m, i) => {
      const h = this.holes[i]; m.grp.visible = !!h; if (!h) return;
      const k = Math.min(1, (now - h.t0) / 350) * Math.min(1, (h.end - now) / 250), s = 0.95 * k * (1 + 0.05 * Math.sin(this.t * 23));
      m.grp.position.set(h.x, h.y, h.z); m.core.scale.setScalar(s); m.halo.scale.setScalar(s * 1.55); m.disk.scale.setScalar(4.6 * k);
      m.halo.material.uniforms.uA.value = 1.3 * k; m.disk.material.uniforms.uT.value = this.t; m.disk.material.uniforms.uA.value = k;
      m.disk.quaternion.copy(cam.quaternion);                                  // 吸積盤永遠正對鏡頭：從哪個角度看都是一圈往裡捲的光
      for (let n = 0; n < 2; n++) {                                             // 被吸進去的光點
        const a = Math.random() * 6.283, el = (Math.random() - 0.5) * 1.3, R = 2.6 + Math.random() * 2.6, cx = Math.cos(a) * Math.cos(el), cy = Math.sin(el), cz = Math.sin(a) * Math.cos(el);
        fx.glowP.spawn(h.x + cx * R, h.y + cy * R, h.z + cz * R, -cx * 4.2 - Math.sin(a) * 3.5, -cy * 4.2, -cz * 4.2 + Math.cos(a) * 3.5, 0.17, 0.03, 0.55, 2.4, 0.8, 3.6, 0.9 * k, 0, 0);
      }
      if (Math.random() < dt * 14) { const a = Math.random() * 6.283, R = 3 + Math.random() * 2; fx.dust.spawn(h.x + Math.cos(a) * R, h.y - 0.6 + Math.random(), h.z + Math.sin(a) * R, -Math.cos(a) * 4, 0.5, -Math.sin(a) * 4, 0.3, 0.08, 0.6, 0.18, 0.12, 0.22, 0.5 * k, 0, 0); }
      const gain = Math.max(0, 1 - Math.hypot(h.x - cam.position.x, h.y - cam.position.y, h.z - cam.position.z) / 30) * k;
      if (gain > rumble) { rumble = gain; rpan = g.panOf(h.x, h.z); }
      lx = h.x; ly = h.y; lz = h.z; li = 26 * k; lc = 0x9a50ff;
    });
    g.sfx.loop('void', 'void', rumble, rpan);

    // 軌道砲
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      // 軌道砲的光柱會追人：施放的一方追對手、被打的一方追自己（兩邊各算各的，位置只差一點網路延遲）
      if (m.track && !m.done) {
        const tq = m.mine ? (rm.alive ? rm.pos : null) : (alive ? p.pos : null);
        if (tq) {
          const dx = tq.x - m.x, dz = tq.z - m.z, dd = Math.hypot(dx, dz);
          if (dd < SK.orbital.trackR && dd > 0.01) { const st = Math.min(dd, SK.orbital.track * dt); m.x += (dx / dd) * st; m.z += (dz / dd) * st; m.y += (tq.y + 0.05 - m.y) * Math.min(1, dt * 6); }
        }
      }
      if (!m.done && now >= m.at) {
        m.done = true;
        if (m.mine && live) this._strike(m);
        const dc = Math.hypot(m.x - cam.position.x, m.z - cam.position.z), sz = m.s || 1;
        this._snd(m.meteor ? 'mark' : 'beam', m.x, m.z); this.nova(m.x, m.y + 0.05, m.z, m.meteor ? 0xffa050 : 0xbfeaff, 9 * sz, 0.6);
        fx.light(m.x, m.y + 2, m.z, m.meteor ? 0xff9a40 : 0xbfe6ff, 480 * sz, 0.5, 40 * sz);
        g.shake = Math.min(1.6, g.shake + Math.max(0, 1.4 - dc / 30) * sz);
        if (dc < 28 * sz && !g.kc) g.hud.flash(0.5 * (1 - dc / (28 * sz)), 0.3);          // 離得近：整個畫面白一下
      }
      if (now >= m.at + 600) this.marks.splice(i, 1);
    }
    this.markM.forEach((o, i) => {
      const m = this.marks[i]; o.beam.visible = o.ring.visible = o.core.visible = !!m; if (!m) return;
      const k = clamp((now - m.t0) / (m.at - m.t0), 0, 1), post = clamp((now - m.at) / 600, 0, 1), fired = now >= m.at;
      const pulse = 0.6 + 0.4 * Math.sin(this.t * (10 + k * 30));
      o.beam.position.set(m.x, m.y, m.z); o.ring.position.set(m.x, m.y + 0.06, m.z); o.core.position.set(m.x, m.y - 4, m.z);
      const sz = m.s || 1, bw = (fired ? 2.9 * (1 - post * 0.6) : 0.03 + 0.1 * k) * sz;
      // 顏色故意給超過 1：後製的光暈會把它暈開。鎖定時是紅色細線，打下來變成藍白色的粗光柱（流星雨是橘色的火柱）
      if (fired) { if (m.meteor) o.beam.material.color.setRGB(6.5, 2.2, 0.5); else o.beam.material.color.setRGB(1.0, 3.0, 6.5); } else o.beam.material.color.setRGB(3.2, 0.45, 0.3);
      o.ring.material.color.copy(o.beam.material.color);
      o.beam.scale.set(bw, 70, bw); o.beam.material.opacity = fired ? 0.6 * (1 - post) : 0.55 * pulse;
      o.ring.scale.setScalar((fired ? 2.2 + post * 6 : 2.2 + (1 - k) * 3) * sz); o.ring.material.opacity = fired ? 0.7 * (1 - post) : 0.5 + 0.4 * pulse;
      o.core.visible = fired; o.core.scale.set(2.1 * sz * (1 - post * 0.75), 74, 2.1 * sz * (1 - post * 0.75)); o.core.material.opacity = (1 - post) * (1 - post);
      if (fired) for (let n = 0; n < 4; n++) fx.glowP.spawn(m.x + (Math.random() - 0.5) * 3, m.y + Math.random() * 12, m.z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6, Math.random() * 8, (Math.random() - 0.5) * 6, 0.3, 0.04, 0.4, 5, 8, 10, 1 - post, 0, 1);
    });

    // 光圈
    for (const n of this.novas) {
      if (n.life <= 0) continue;
      n.life -= dt;
      if (n.life <= 0) { n.m.visible = false; continue; }
      const k = 1 - n.life / n.max;
      n.m.scale.setScalar(n.r * (0.1 + 0.9 * Math.sqrt(k))); n.m.material.opacity = (1 - k) * 0.8;
    }

    // 身上的持續效果：著火、被凝結、被冰凍
    const flame = (q, on) => { if (on && Math.random() < dt * 40) fx.glowP.spawn(q.x + (Math.random() - 0.5) * 0.45, q.y + 0.3 + Math.random() * 1.2, q.z + (Math.random() - 0.5) * 0.45, (Math.random() - 0.5) * 0.5, 1.2 + Math.random() * 1.4, (Math.random() - 0.5) * 0.5, 0.34, 0.05, 0.35 + Math.random() * 0.3, 5, 1.8 + Math.random(), 0.25, 0.5, -1.5, 1); };
    const frost = (q, on) => { if (on && Math.random() < dt * 26) fx.glowP.spawn(q.x + (Math.random() - 0.5) * 0.7, q.y + 0.2 + Math.random() * 1.5, q.z + (Math.random() - 0.5) * 0.7, 0, -0.3, 0, 0.1, 0.02, 0.5, 1.4, 3.2, 5, 0.7); };
    flame(rm.pos, rm.alive && !!opp.bu && !hide);
    frost(rm.pos, rm.alive && (!!opp.fz || now < this.rSlowEnd || now < this.rStopEnd) && !hide);
    if (g.emote && alive) { flame(p.pos, !!me.bu); frost(p.pos, !!me.fz || now < this.slowEnd || now < this.stopEnd); }

    this.light.intensity = li; if (li > 0) { this.light.position.set(lx, ly, lz); this.light.color.setHex(lc); }
  }

  // ───────── 給 HUD 的資料 ─────────
  hudState(now) {
    const g = this.g, me = g.gs ? g.gs.p[g.me] : null, st = [];
    const left = (t) => ((t - now) / 1000).toFixed(1);
    if (now < this.cloakEnd) st.push(['cloak', '隱身中 ' + left(this.cloakEnd)]);
    if (now < this.stopEnd) st.push(['slow', '時間暫停 ' + left(this.stopEnd)]);
    if (now < this.slowEnd) st.push(['slow', '時間凝結 ' + left(this.slowEnd)]);
    if (me && me.fz) st.push(['slow', '被冰凍，跑不快']);
    if (me && me.bu) st.push(['burn', '著火了']);
    if (this.inHole) st.push(['hole', '被黑洞吸住']);
    if (now < this.scannedEnd) st.push(['scan', '被透視 ' + left(this.scannedEnd)]);
    if (now < this.stimEnd) st.push(['stim', '腎上腺素 ' + left(this.stimEnd)]);
    if (now < this.scanEnd) st.push(['good', '透視中 ' + left(this.scanEnd)]);
    if (now < this.rSlowEnd) st.push(['good', '對手被凝結 ' + left(this.rSlowEnd)]);
    if (now < this.rStopEnd) st.push(['good', '對手被暫停 ' + left(this.rStopEnd)]);
    const tint = ['slow', 'burn', 'hole', 'cloak', 'stim'].find((k) => st.some((s) => s[0] === k)) || '';
    const on = { cloak: now < this.cloakEnd, grapple: !!this.grap, scan: now < this.scanEnd, stim: now < this.stimEnd };
    return {
      status: st, tint,
      slots: this.slots.map((id, i) => (id ? { id, left: Math.max(0, (this.ready[i] - now) / 1000), cd: CARDS[id].cd, uses: CARDS[id].uses ? this.uses[i] : -1, on: !!on[id] } : null)),
    };
  }
}
