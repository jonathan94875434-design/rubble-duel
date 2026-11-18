import * as THREE from 'three';
import { BS } from './config.js';
import { BLOCK } from './world.js';
import { hash3 } from './util.js';
import { skyLit } from './skylit.js';

const MAXP = 700;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
const _e = new THREE.Euler(), _n = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1), _q2 = new THREE.Quaternion();

// 柔邊的點狀粒子（煙、灰塵、火、火花）。additive = 發光類（疊加、很亮，後製的光暈會抓到）
class Points {
  constructor(scene, cap, additive) {
    this.cap = cap; this.next = 0; this.live = 0;
    this.p = [];
    for (let i = 0; i < cap; i++) this.p.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 0.1, s1: 0.1, r: 1, g: 1, b: 1, a: 1, grav: 0, drag: 0 });
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 4); this.size = new Float32Array(cap);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 600 }, uLight: { value: new THREE.Vector3(1, 1, 1) } }]),
      vertexShader: `attribute vec4 aCol; attribute float aSize; uniform float uScale; varying vec4 vCol;
#include <fog_pars_vertex>
void main() { vCol = aCol; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition; gl_PointSize = aSize * uScale / max(0.05, -mvPosition.z);
#include <fog_vertex>
}`,
      fragmentShader: `uniform vec3 uLight; varying vec4 vCol;
#include <fog_pars_fragment>
void main() { float d = length(gl_PointCoord - .5) * 2.; float a = ${additive ? 'pow(smoothstep(1., 0., d), 1.7)' : 'smoothstep(1., .3, d)'} * vCol.a; if (a < .003) discard;
  gl_FragColor = vec4(vCol.rgb * ${additive ? '1.' : 'uLight'}, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${additive ? '' : '#include <fog_fragment>'}
}`,
      transparent: true, depthWrite: false, fog: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Points(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 6 : 5;
    scene.add(this.mesh);
  }
  spawn(x, y, z, vx, vy, vz, s0, s1, life, r, g, b, a = 1, grav = 0, drag = 0) {
    const p = this.p[this.next]; this.next = (this.next + 1) % this.cap;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.s0 = s0; p.s1 = s1; p.life = p.max = life; p.r = r; p.g = g; p.b = b; p.a = a; p.grav = grav; p.drag = drag;
  }
  clear() { for (const p of this.p) p.life = 0; this.size.fill(0); this.geo.attributes.aSize.needsUpdate = true; }
  update(dt) {
    let any = false;
    const pos = this.pos, col = this.col, size = this.size;
    for (let i = 0; i < this.cap; i++) {
      const p = this.p[i];
      if (p.life <= 0) { if (size[i] !== 0) { size[i] = 0; any = true; } continue; }
      any = true; p.life -= dt;
      if (p.life <= 0) { size[i] = 0; continue; }
      p.vy -= p.grav * dt;
      if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = 1 - p.life / p.max;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      col[i * 4] = p.r; col[i * 4 + 1] = p.g; col[i * 4 + 2] = p.b; col[i * 4 + 3] = p.a * Math.min(1, t * 8) * (1 - t) * (1 - t * t * 0.3);
      size[i] = p.s0 + (p.s1 - p.s0) * t;
    }
    if (any) { const a = this.geo.attributes; a.position.needsUpdate = a.aCol.needsUpdate = a.aSize.needsUpdate = true; }
  }
}

// 用畫布畫一張圓形漸層的小貼圖（彈孔、焦痕）
function radialTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const holeTex = () => radialTex(64, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(5,5,6,1)'); gr.addColorStop(0.22, 'rgba(10,9,8,0.95)'); gr.addColorStop(0.3, 'rgba(60,56,50,0.75)'); gr.addColorStop(0.55, 'rgba(30,28,25,0.3)'); gr.addColorStop(1, 'rgba(20,18,16,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(8,8,8,0.55)'; g.lineWidth = 1;                         // 幾條放射狀的小裂痕
  for (let i = 0; i < 7; i++) { const a = i * 0.9 + (i % 3) * 0.4, r0 = s * 0.14, r1 = s * (0.26 + (i % 4) * 0.05); g.beginPath(); g.moveTo(s / 2 + Math.cos(a) * r0, s / 2 + Math.sin(a) * r0); g.lineTo(s / 2 + Math.cos(a + 0.15) * r1, s / 2 + Math.sin(a + 0.15) * r1); g.stroke(); }
});
const scorchTex = () => radialTex(128, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(6,5,4,0.92)'); gr.addColorStop(0.35, 'rgba(10,8,6,0.75)'); gr.addColorStop(0.7, 'rgba(14,11,8,0.3)'); gr.addColorStop(1, 'rgba(14,11,8,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 26; i++) {                                              // 往外噴的焦黑條紋
    const a = i * 0.71, r1 = s * (0.3 + hash3(i, 2, 5) * 0.2);
    g.strokeStyle = `rgba(8,6,5,${0.25 + hash3(i, 3, 1) * 0.3})`; g.lineWidth = 1 + hash3(i, 9, 4) * 3;
    g.beginPath(); g.moveTo(s / 2, s / 2); g.lineTo(s / 2 + Math.cos(a) * r1, s / 2 + Math.sin(a) * r1); g.stroke();
  }
});

// 一批貼在牆面上的小貼片（彈孔、焦痕）
class Decals {
  constructor(scene, cap, tex) {
    this.cap = cap; this.next = 0; this.cell = new Int32Array(cap).fill(-1);
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), cap);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, _m);
    scene.add(this.mesh);
  }
  add(x, y, z, nx, ny, nz, size, cell) {
    const i = this.next; this.next = (this.next + 1) % this.cap;
    _n.set(nx, ny, nz).normalize(); _q.setFromUnitVectors(_z, _n); _q2.setFromAxisAngle(_z, Math.random() * 6.283); _q.multiply(_q2);
    this.mesh.setMatrixAt(i, _m.compose(_p.set(x + _n.x * 0.012, y + _n.y * 0.012, z + _n.z * 0.012), _q, _s.set(size, size, size)));
    this.cell[i] = cell; this.mesh.instanceMatrix.needsUpdate = true;
  }
  // 貼著的那一格方塊被打掉了 → 貼片跟著消失
  prune(world) {
    let ch = false;
    for (let i = 0; i < this.cap; i++) if (this.cell[i] >= 0 && !world.types[this.cell[i]]) { this.cell[i] = -1; _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); ch = true; }
    if (ch) this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { _m.makeScale(0, 0, 0); for (let i = 0; i < this.cap; i++) { this.mesh.setMatrixAt(i, _m); this.cell[i] = -1; } this.mesh.instanceMatrix.needsUpdate = true; }
}

// 所有特效：碎塊、灰塵、火花、彈道線、彈孔、爆炸、煙霧彈、火焰、噴漆、臨時的光源
export class FX {
  constructor(scene, world) {
    this.scene = scene; this.world = world; this.rev = -1;
    // 會彈跳的實體小碎塊
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), skyLit(new THREE.MeshLambertMaterial(), world), MAXP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.castShadow = false;
    scene.add(this.mesh);
    this.p = [];
    for (let i = 0; i < MAXP; i++) {
      this.p.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0.1, g: 1, rot: 0, spin: 0 });
      this.mesh.setColorAt(i, _c.setRGB(1, 1, 1));
    }
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < MAXP; i++) this.mesh.setMatrixAt(i, _m);
    this.next = 0;

    this.dust = new Points(scene, 700, false);
    this.glowP = new Points(scene, 1100, true);
    this.holes = new Decals(scene, 220, holeTex());
    this.scorch = new Decals(scene, 14, scorchTex());
    this.sprays = [];

    this.tracers = [];
    const tg = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 48; i++) {
      const me = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      me.visible = false; me.frustumCulled = false; scene.add(me);
      this.tracers.push({ mesh: me, life: 0, max: 0.08 });
    }
    this.tnext = 0;

    // 爆炸的衝擊波：貼地往外擴的環 + 一顆很快變大變淡的球
    this.booms = [];
    const sg = new THREE.SphereGeometry(1, 20, 12), rg = new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const me = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      me.visible = ring.visible = false; scene.add(me, ring);
      this.booms.push({ mesh: me, ring, life: 0, r: 1 });
    }
    this.bnext = 0;

    // 臨時光源：槍口火光、爆炸、閃光彈（固定幾顆輪流用，數量不變著色器就不用重編）
    this.lights = [];
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffa040, 0, 14, 2); scene.add(l); this.lights.push({ l, life: 0, max: 0.1, peak: 0 }); }
    this.lnext = 0;

    // 煙霧彈的煙團：一堆不透明的灰色多面體，雙面都畫（人在煙裡面也看不出去）
    this.clouds = [];
    this.puffGeo = new THREE.IcosahedronGeometry(1, 2);
    this.puffMat = skyLit(new THREE.MeshLambertMaterial({ color: 0xd2d6da, emissive: 0x2c2f33, side: THREE.DoubleSide }), world);

    // 燃燒瓶的火
    this.fires = [];
    this.fireLights = [];
    for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0xff7a22, 0, 11, 2); scene.add(l); this.fireLights.push(l); }
    this.time = 0;
  }

  // 把方塊的代表色乘上那個位置的天光亮度，煙塵在室內才不會亮得突兀
  _lit(x, y, z) { const s = this.world.light.at3(x, y, z); return 0.3 + 0.7 * s * s; }

  // ───────── 煙霧彈 ─────────
  smokeCloud(x, y, z, radius, durMs, seed = 1) {
    const group = new THREE.Group(); group.position.set(x, y + radius * 0.45, z);
    const puffs = [];
    for (let i = 0; i < 18; i++) {
      const me = new THREE.Mesh(this.puffGeo, this.puffMat);
      // 用雜湊決定位置，兩邊畫出來的煙才會一模一樣
      const a = hash3(i, seed, 1) * Math.PI * 2, e = (hash3(i, seed, 2) - 0.35) * 1.6, d = i === 0 ? 0 : radius * (0.35 + 0.3 * hash3(i, seed, 3));
      me.position.set(Math.cos(a) * Math.cos(e) * d, Math.sin(e) * d * 0.7, Math.sin(a) * Math.cos(e) * d);
      me.rotation.set(a, e, a * 2);
      puffs.push({ me, s: i === 0 ? radius * 0.8 : radius * (0.45 + 0.22 * hash3(i, seed, 4)) });
      group.add(me);
    }
    this.scene.add(group);
    this.clouds.push({ group, puffs, x, y: y + radius * 0.45, z, r: radius, t0: performance.now(), dur: durMs, wisp: 0 });
  }

  // 視線有沒有被煙擋住（線段 vs 球）
  smokeBlocked(ax, ay, az, bx, by, bz) {
    const now = performance.now();
    for (const c of this.clouds) {
      const age = now - c.t0;
      if (age < 500 || age > c.dur - 1200) continue;
      const dx = bx - ax, dy = by - ay, dz = bz - az, l2 = dx * dx + dy * dy + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.y - ay) * dy + (c.z - az) * dz) / l2));
      const px = ax + dx * t - c.x, py = ay + dy * t - c.y, pz = az + dz * t - c.z;
      if (px * px + py * py + pz * pz < c.r * c.r * 0.8) return true;
    }
    return false;
  }

  clearClouds() { for (const c of this.clouds) this.scene.remove(c.group); this.clouds.length = 0; }

  // ───────── 火（燃燒瓶）─────────
  // 在 (x,y,z) 附近半徑 r 的地面上找一些點當火苗；位置用 seed 雜湊，兩邊看到的火一樣
  fire(x, y, z, r, durMs, seed) {
    const w = this.world, pts = [];
    for (let i = 0; i < 22; i++) {
      const a = hash3(i, seed, 11) * Math.PI * 2, d = i === 0 ? 0 : r * Math.sqrt(hash3(i, seed, 12));
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d, bx = Math.floor(px / BS), bz = Math.floor(pz / BS);
      let by = Math.floor((y + 1.0) / BS), ok = false;
      if (w.get(bx, by, bz)) continue;                                        // 這一點在牆裡面
      for (let k = 0; k < 9; k++, by--) if (w.get(bx, by - 1, bz)) { ok = true; break; }
      if (ok) pts.push({ x: px, y: by * BS, z: pz, ph: hash3(i, seed, 13) * 6.28 });
    }
    this.fires.push({ pid: seed, x, y, z, r, pts, t0: performance.now(), dur: durMs, acc: 0 });
    for (let i = 0; i < 26; i++) { const a = Math.random() * 6.283, sp = 2 + Math.random() * 5; this.glowP.spawn(x, y + 0.2, z, Math.cos(a) * sp, 1 + Math.random() * 3, Math.sin(a) * sp, 0.5, 0.15, 0.35 + Math.random() * 0.3, 6, 2.4, 0.5, 0.9, 6, 2); }
    this.light(x, y + 0.6, z, 0xff8a30, 40, 0.3, 12);
  }
  stopFire(pid) {
    const i = this.fires.findIndex((f) => f.pid === pid);
    if (i < 0) return;
    const f = this.fires[i];
    for (const p of f.pts) if (Math.random() < 0.6) this.dust.spawn(p.x, p.y + 0.2, p.z, (Math.random() - 0.5) * 0.6, 0.8 + Math.random(), (Math.random() - 0.5) * 0.6, 0.4, 1.3, 1.2 + Math.random(), 0.8, 0.8, 0.8, 0.5, -0.2, 0.6);
    this.fires.splice(i, 1);
  }

  // ───────── 光 ─────────
  light(x, y, z, color, peak, life, dist = 14) {
    const o = this.lights[this.lnext]; this.lnext = (this.lnext + 1) % this.lights.length;
    o.l.position.set(x, y, z); o.l.color.setHex(color); o.l.distance = dist; o.peak = peak; o.life = o.max = life; o.l.intensity = peak;
  }
  // 自己開槍時槍口照亮四周（暗的地方特別明顯）
  flashLight(x, y, z) { this.light(x, y, z, 0xffb060, 14, 0.06, 10); }
  // 對手的槍口火光
  muzzle(x, y, z) {
    this.glowP.spawn(x, y, z, 0, 0, 0, 0.55, 0.2, 0.06, 7, 4.2, 1.6, 1);
    this.glowP.spawn(x, y, z, 0, 0, 0, 0.22, 0.1, 0.05, 9, 7, 4, 1);
    this.light(x, y, z, 0xffb060, 16, 0.06, 11);
  }

  // 閃光彈爆開的白光
  flashBurst(x, y, z) {
    this.glowP.spawn(x, y, z, 0, 0, 0, 3.5, 0.6, 0.3, 30, 30, 30, 1);
    for (let i = 0; i < 16; i++) this.glowP.spawn(x, y, z, (Math.random() - 0.5) * 12, Math.random() * 8, (Math.random() - 0.5) * 12, 0.12, 0.03, 0.25 + Math.random() * 0.25, 12, 12, 12, 1, 9);
    this.light(x, y, z, 0xffffff, 300, 0.25, 30);
    for (let i = 0; i < 4; i++) this.dust.spawn(x, y, z, (Math.random() - 0.5) * 1.5, 0.6 + Math.random(), (Math.random() - 0.5) * 1.5, 0.3, 1.2, 1 + Math.random(), 0.85, 0.85, 0.85, 0.4, -0.1, 1);
  }

  clear() {
    for (const p of this.p) p.life = 0;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < MAXP; i++) this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.dust.clear(); this.glowP.clear(); this.holes.clear(); this.scorch.clear();
    for (const t of this.tracers) { t.life = 0; t.mesh.visible = false; }
    for (const b of this.booms) { b.life = 0; b.mesh.visible = b.ring.visible = false; }
    for (const o of this.lights) { o.life = 0; o.l.intensity = 0; }
    for (const l of this.fireLights) l.intensity = 0;
    for (const s of this.sprays) { this.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); }
    this.sprays.length = 0; this.fires.length = 0;
    this.clearClouds();
  }

  spawn(x, y, z, vx, vy, vz, size, life, r, g, b, grav = 1) {
    const i = this.next; this.next = (this.next + 1) % MAXP;
    const p = this.p[i];
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.size = size; p.life = p.max = life; p.g = grav;
    p.rot = Math.random() * 6; p.spin = (Math.random() - 0.5) * 12;
    this.mesh.setColorAt(i, _c.setRGB(r, g, b));
    this.mesh.instanceColor.needsUpdate = true;
  }

  // 子彈打在方塊上：小碎屑 + 一團灰；打到金屬會噴火花
  impact(x, y, z, nx, ny, nz, type, n = 4) {
    const def = BLOCK[type], c = def ? def.color : [0.5, 0.5, 0.5], k = this._lit(x + nx * 0.2, y + ny * 0.2, z + nz * 0.2);
    for (let i = 0; i < n; i++) {
      this.spawn(x, y, z, nx * 2.2 + (Math.random() - 0.5) * 3, ny * 2.2 + Math.random() * 2.5, nz * 2.2 + (Math.random() - 0.5) * 3,
        0.02 + Math.random() * 0.04, 0.35 + Math.random() * 0.3, c[0] * 1.2, c[1] * 1.2, c[2] * 1.2);
    }
    const dc = 0.55 + Math.random() * 0.2;
    this.dust.spawn(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, nx * 1.1 + (Math.random() - 0.5) * 0.4, ny * 1.1 + 0.25, nz * 1.1 + (Math.random() - 0.5) * 0.4,
      0.1, 0.5 + Math.random() * 0.25, 0.45 + Math.random() * 0.3, (c[0] * 0.6 + 0.3) * dc * k, (c[1] * 0.6 + 0.3) * dc * k, (c[2] * 0.6 + 0.3) * dc * k, 0.55, -0.15, 2.2);
    if (def && def.surf === 'metal') {
      for (let i = 0; i < 4; i++) this.glowP.spawn(x, y, z, nx * 4 + (Math.random() - 0.5) * 7, ny * 4 + Math.random() * 4, nz * 4 + (Math.random() - 0.5) * 7, 0.05, 0.015, 0.15 + Math.random() * 0.2, 9, 6, 2, 1, 14);
    }
  }

  // 彈孔
  hole(x, y, z, nx, ny, nz, cell) { this.holes.add(x, y, z, nx, ny, nz, 0.11 + Math.random() * 0.05, cell); }

  // 方塊碎掉：一堆碎塊 + 灰塵
  debris(bx, by, bz, type, n = 7, power = 1) {
    const c = BLOCK[type] ? BLOCK[type].color : [0.5, 0.5, 0.5];
    const x = (bx + 0.5) * BS, y = (by + 0.5) * BS, z = (bz + 0.5) * BS, lk = this._lit(x, y + 0.3, z);
    for (let i = 0; i < n; i++) {
      const k = 0.8 + Math.random() * 0.5;
      this.spawn(x + (Math.random() - 0.5) * BS, y + (Math.random() - 0.5) * BS, z + (Math.random() - 0.5) * BS,
        (Math.random() - 0.5) * 5 * power, (1 + Math.random() * 4) * power, (Math.random() - 0.5) * 5 * power,
        0.06 + Math.random() * 0.11, 0.7 + Math.random() * 0.8, c[0] * k, c[1] * k, c[2] * k);
    }
    for (let i = 0; i < 2; i++) {
      const dc = (0.5 + Math.random() * 0.25) * lk;
      this.dust.spawn(x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.3, z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 1.6 * power, 0.3 + Math.random() * 0.8, (Math.random() - 0.5) * 1.6 * power,
        0.35, 1.0 + Math.random() * 0.5, 0.9 + Math.random() * 0.6, (c[0] * 0.6 + 0.3) * dc, (c[1] * 0.6 + 0.3) * dc, (c[2] * 0.6 + 0.3) * dc, 0.5, -0.1, 1.6);
    }
  }

  // 打到人：一小團暗紅色的霧 + 幾滴
  hitSpark(x, y, z, color = 0, n = 8) {
    const k = this._lit(x, y, z);
    this.dust.spawn(x, y, z, (Math.random() - 0.5) * 0.8, 0.3, (Math.random() - 0.5) * 0.8, 0.12, 0.5, 0.35, 0.5 * k, 0.03 * k, 0.03 * k, 0.7, 1, 2);
    for (let i = 0; i < n; i++) this.spawn(x, y, z, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, 0.02 + Math.random() * 0.025, 0.3 + Math.random() * 0.3, 0.42, 0.02, 0.02);
    if (color) { _c.setHex(color); for (let i = 0; i < 6; i++) this.glowP.spawn(x, y, z, (Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5, 0.06, 0.02, 0.3, _c.r * 5, _c.g * 5, _c.b * 5, 1, 10); }
  }

  // 一小口煙（火箭尾巴、槍口）
  smoke(x, y, z, n = 1, size = 0.12) {
    for (let i = 0; i < n; i++) {
      const s = (0.3 + Math.random() * 0.2) * this._lit(x, y, z);
      this.dust.spawn(x, y, z, (Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6, size * 1.6, size * 6, 0.7 + Math.random() * 0.6, s, s, s, 0.45, -0.1, 1.2);
    }
  }
  // 一顆發光的點（火箭的噴焰、火苗）
  glow(x, y, z, size, life, r, g, b) { this.glowP.spawn(x, y, z, 0, 0, 0, size, size * 0.3, life, r, g, b, 1); }

  explosion(x, y, z, radius) {
    const b = this.booms[this.bnext]; this.bnext = (this.bnext + 1) % this.booms.length;
    b.life = 0.32; b.r = radius; b.mesh.position.set(x, y, z); b.mesh.visible = true;
    // 衝擊波貼在爆炸點正下方的地面
    const w = this.world, bx = Math.floor(x / BS), bz = Math.floor(z / BS);
    let by = Math.floor(y / BS), gy = null;
    for (let k = 0; k < 7; k++, by--) if (w.get(bx, by - 1, bz) && !w.get(bx, by, bz)) { gy = by * BS; break; }
    b.ring.visible = gy !== null;
    if (gy !== null) { b.ring.position.set(x, gy + 0.04, z); this.scorch.add(x, gy, z, 0, 1, 0, radius * 1.15, w.inb(bx, by - 1, bz) ? w.idx(bx, by - 1, bz) : -1); }
    this.light(x, y + 0.5, z, 0xffa040, 260, 0.35, 26);
    for (let i = 0; i < 12; i++) {                                              // 火球
      const a = Math.random() * 6.283, e = Math.random() * 1.4, sp = 1 + Math.random() * 3.5;
      this.glowP.spawn(x, y, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 1, Math.sin(a) * Math.cos(e) * sp, radius * 0.5, radius * 0.9, 0.3 + Math.random() * 0.3, 7, 2.8 + Math.random() * 1.5, 0.5, 0.9, -1, 2.5);
    }
    for (let i = 0; i < 34; i++) {                                              // 火花
      const a = Math.random() * 6.283, e = Math.random() * Math.PI - Math.PI / 2, sp = 5 + Math.random() * 13;
      this.glowP.spawn(x, y, z, Math.cos(a) * Math.cos(e) * sp, Math.abs(Math.sin(e)) * sp + 2, Math.sin(a) * Math.cos(e) * sp, 0.09, 0.02, 0.4 + Math.random() * 0.7, 10, 5 + Math.random() * 3, 1.2, 1, 16, 0.6);
    }
    const lk = this._lit(x, y + 1, z);
    for (let i = 0; i < 16; i++) {                                              // 黑煙往上竄
      const a = Math.random() * 6.283, d = Math.random() * radius * 0.45, s = (0.1 + Math.random() * 0.12) * lk;
      this.dust.spawn(x + Math.cos(a) * d, y + Math.random() * radius * 0.3, z + Math.sin(a) * d, Math.cos(a) * 1.4, 1.2 + Math.random() * 2.2, Math.sin(a) * 1.4, radius * 0.35, radius * 0.95, 1.4 + Math.random() * 1.4, s, s, s, 0.8, -0.25, 1.1);
    }
    for (let i = 0; i < 10; i++) {                                              // 貼地往外滾的灰
      const a = (i / 10) * 6.283 + Math.random() * 0.4, s = (0.5 + Math.random() * 0.15) * lk;
      this.dust.spawn(x, (gy === null ? y : gy) + 0.25, z, Math.cos(a) * 6, 0.4, Math.sin(a) * 6, 0.4, 1.6, 0.9 + Math.random() * 0.5, s, s * 0.95, s * 0.88, 0.45, 0, 2.6);
    }
  }

  tracer(a, b, color = 0xffe9a8, width = 0.022, life = 0.07) {
    const t = this.tracers[this.tnext]; this.tnext = (this.tnext + 1) % this.tracers.length;
    const len = a.distanceTo(b);
    if (len < 0.3) return;
    t.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    t.mesh.lookAt(b);
    t.mesh.scale.set(width, width, len);
    t.mesh.material.color.setHex(color).multiplyScalar(2.2);
    t.mesh.material.opacity = 0.8; t.mesh.visible = true; t.life = t.max = life;
  }

  // 噴漆：tex = 圖案；貼在 (x,y,z) 的牆面上，up = 圖案的「上」朝哪（貼在地上時用玩家面向）
  spray(tex, x, y, z, nx, ny, nz, yaw, cell) {
    if (!(nx || ny || nz) || ![x, y, z, nx, ny, nz, yaw].every((v) => Number.isFinite(v))) return;
    const g = new THREE.PlaneGeometry(0.95, 0.95);
    const me = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    // 貼片的三個軸：N 朝外、U 是圖案的上方（牆上 = 世界的上；地上／天花板 = 玩家面向的方向）、R = U × N
    _n.set(nx, ny, nz).normalize();
    const U = Math.abs(ny) > 0.5 ? _s.set(-Math.sin(yaw), 0, -Math.cos(yaw)) : _s.set(0, 1, 0);
    _p.crossVectors(U, _n).normalize();
    me.quaternion.setFromRotationMatrix(_m.makeBasis(_p, U, _n));
    me.position.set(x + nx * 0.015, y + ny * 0.015, z + nz * 0.015); me.renderOrder = 3;
    this.scene.add(me);
    this.sprays.push({ mesh: me, cell });
    if (this.sprays.length > 8) { const o = this.sprays.shift(); this.scene.remove(o.mesh); o.mesh.geometry.dispose(); o.mesh.material.dispose(); }
    for (let i = 0; i < 5; i++) this.dust.spawn(x + nx * 0.1, y + ny * 0.1, z + nz * 0.1, nx * 0.5 + (Math.random() - 0.5) * 0.6, ny * 0.5 + (Math.random() - 0.5) * 0.6, nz * 0.5 + (Math.random() - 0.5) * 0.6, 0.2, 0.6, 0.5, 0.9, 0.9, 0.9, 0.25, 0, 2);
  }

  // cam、viewH：算點狀粒子在螢幕上該畫多大要用；light = 目前的環境光顏色（THREE.Color）
  update(dt, cam, viewH, light) {
    const w = this.world;
    this.time += dt;
    if (cam) {
      const sc = (viewH * 0.5) / Math.tan((cam.fov * Math.PI) / 360);
      this.dust.mat.uniforms.uScale.value = sc; this.glowP.mat.uniforms.uScale.value = sc;
      if (light) this.dust.mat.uniforms.uLight.value.set(light.r, light.g, light.b);
    }
    if (this.rev !== w.rev) {
      this.rev = w.rev; this.holes.prune(w); this.scorch.prune(w);
      for (let i = this.sprays.length - 1; i >= 0; i--) { const s = this.sprays[i]; if (s.cell >= 0 && !w.types[s.cell]) { this.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); this.sprays.splice(i, 1); } }
    }
    let any = false;
    for (let i = 0; i < MAXP; i++) {
      const p = this.p[i];
      if (p.life <= 0) continue;
      any = true;
      p.life -= dt;
      if (p.life <= 0) { _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); continue; }
      p.vy -= 18 * p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.g > 0 && w.get(Math.floor(p.x / BS), Math.floor(p.y / BS), Math.floor(p.z / BS))) {
        p.y -= p.vy * dt; p.x -= p.vx * dt; p.z -= p.vz * dt;
        p.vy = -p.vy * 0.3; p.vx *= 0.5; p.vz *= 0.5; p.spin *= 0.5;
      }
      p.rot += p.spin * dt;
      _s.setScalar(p.size * Math.min(1, (p.life / p.max) * 2.5)); _p.set(p.x, p.y, p.z); _q.setFromEuler(_e.set(p.rot, p.rot * 0.7, 0));
      this.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
    this.dust.update(dt); this.glowP.update(dt);

    const now = performance.now();
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i], age = now - c.t0;
      if (age >= c.dur) { this.scene.remove(c.group); this.clouds.splice(i, 1); continue; }
      const grow = 1 - Math.pow(1 - Math.min(1, age / 800), 3), k = grow * Math.min(1, (c.dur - age) / 1500);
      for (let j = 0; j < c.puffs.length; j++) { const p = c.puffs[j]; p.me.scale.setScalar(Math.max(0.001, p.s * k * (1 + 0.05 * Math.sin(age * 0.0012 + j)))); }
      c.group.rotation.y = age * 0.00006;
      c.wisp += dt;                                                             // 外面包一層半透明的軟煙，輪廓才不會像一顆石頭
      while (c.wisp > 0.045 && k > 0.25) {
        c.wisp -= 0.045;
        const a = Math.random() * 6.283, e = Math.random() * 1.5 - 0.35, s = (0.6 + Math.random() * 0.12) * this._lit(c.x, c.y + c.r, c.z), rr = c.r * k * (0.62 + Math.random() * 0.2);
        this.dust.spawn(c.x + Math.cos(a) * Math.cos(e) * rr, c.y + Math.sin(e) * rr * 0.75, c.z + Math.sin(a) * Math.cos(e) * rr, Math.cos(a) * 0.2, 0.12, Math.sin(a) * 0.2, c.r * 0.75, c.r * 1.15, 2.0 + Math.random() * 0.8, s, s * 1.02, s * 1.05, 0.5, -0.02, 0.3);
      }
      if (c.wisp > 0.2) c.wisp = 0;
    }

    // 火焰：每個火苗一直冒發光的點，偶爾冒煙和火星
    const fl = this.fireLights;
    for (const l of fl) l.intensity = 0;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i], age = now - f.t0;
      if (age >= f.dur) { this.fires.splice(i, 1); continue; }
      const k = Math.min(1, age / 300) * Math.min(1, (f.dur - age) / 900);
      f.acc += dt * 300 * k;
      while (f.acc >= 1 && f.pts.length) {
        f.acc--;
        const p = f.pts[(Math.random() * f.pts.length) | 0], ox = (Math.random() - 0.5) * 0.55, oz = (Math.random() - 0.5) * 0.55, r = Math.random();
        if (r < 0.62) this.glowP.spawn(p.x + ox, p.y + 0.1, p.z + oz, (Math.random() - 0.5) * 0.5, 0.9 + Math.random() * 1.2, (Math.random() - 0.5) * 0.5, 0.42 + Math.random() * 0.3, 0.07, 0.4 + Math.random() * 0.4, 4.6, 1.5 + Math.random() * 0.9, 0.22, 0.34 * k, -2.2, 0.9);   // 火舌
        else if (r < 0.86) this.glowP.spawn(p.x + ox * 0.6, p.y + 0.06, p.z + oz * 0.6, 0, 0.5 + Math.random() * 0.6, 0, 0.26, 0.05, 0.22 + Math.random() * 0.18, 7, 5, 1.8, 0.4 * k, -1.2, 1);              // 貼地那一層比較白熱
        else if (r < 0.95) { const s = 0.1 * this._lit(p.x, p.y + 1.5, p.z); this.dust.spawn(p.x + ox, p.y + 1.0, p.z + oz, (Math.random() - 0.5) * 0.4, 1.4 + Math.random(), (Math.random() - 0.5) * 0.4, 0.4, 1.5, 1.3 + Math.random(), s, s, s, 0.38 * k, -0.2, 0.5); }
        else this.glowP.spawn(p.x + ox, p.y + 0.3, p.z + oz, (Math.random() - 0.5) * 1.6, 2 + Math.random() * 2.5, (Math.random() - 0.5) * 1.6, 0.05, 0.015, 0.6 + Math.random() * 0.6, 9, 4.5, 1, 1, 3, 0.5);   // 火星
      }
      if (i < fl.length) { fl[i].position.set(f.x, f.y + 0.7, f.z); fl[i].intensity = k * (15 + 5 * Math.sin(this.time * 17 + i) + 4 * Math.sin(this.time * 31)); }
    }

    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) { t.mesh.visible = false; continue; }
      t.mesh.material.opacity = 0.8 * (t.life / t.max);
    }
    for (const b of this.booms) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) { b.mesh.visible = b.ring.visible = false; continue; }
      const k = 1 - b.life / 0.32;
      b.mesh.scale.setScalar(b.r * (0.15 + k * 0.75)); b.mesh.material.opacity = (1 - k) * (1 - k) * 0.7;
      b.ring.scale.setScalar(b.r * (0.3 + k * 1.9)); b.ring.material.opacity = (1 - k) * 0.55;
    }
    for (const o of this.lights) {
      if (o.life <= 0) continue;
      o.life -= dt;
      o.l.intensity = o.life <= 0 ? 0 : o.peak * Math.pow(o.life / o.max, 1.5);
    }
  }
}
