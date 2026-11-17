import * as THREE from 'three';
import { BS } from './config.js';
import { BLOCK } from './world.js';
import { hash3 } from './util.js';

const MAXP = 900;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
const _e = new THREE.Euler();

// 粒子（碎塊、火花、煙）、彈道線、爆炸閃光
export class FX {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), MAXP);
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

    this.tracers = [];
    const tg = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 48; i++) {
      const me = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      me.visible = false; me.frustumCulled = false; scene.add(me);
      this.tracers.push({ mesh: me, life: 0, max: 0.08 });
    }
    this.tnext = 0;

    this.booms = [];
    const sg = new THREE.SphereGeometry(1, 16, 10);
    for (let i = 0; i < 6; i++) {
      const me = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      me.visible = false; scene.add(me);
      const light = new THREE.PointLight(0xffa040, 0, 18, 1.6); scene.add(light);
      this.booms.push({ mesh: me, light, life: 0, r: 1 });
    }
    this.bnext = 0;

    // 煙霧彈的煙團：一堆不透明的灰色多面體，雙面都畫（人在煙裡面也看不出去）
    this.clouds = [];
    this.puffGeo = new THREE.IcosahedronGeometry(1, 1);
    this.puffMat = new THREE.MeshLambertMaterial({ color: 0xc4cad1, side: THREE.DoubleSide, flatShading: true });
  }

  smokeCloud(x, y, z, radius, durMs, seed = 1) {
    const group = new THREE.Group(); group.position.set(x, y + radius * 0.45, z);
    const puffs = [];
    for (let i = 0; i < 15; i++) {
      const me = new THREE.Mesh(this.puffGeo, this.puffMat);
      // 用雜湊決定位置，兩邊畫出來的煙才會一模一樣
      const a = hash3(i, seed, 1) * Math.PI * 2, e = (hash3(i, seed, 2) - 0.35) * 1.6, d = i === 0 ? 0 : radius * (0.35 + 0.3 * hash3(i, seed, 3));
      me.position.set(Math.cos(a) * Math.cos(e) * d, Math.sin(e) * d * 0.7, Math.sin(a) * Math.cos(e) * d);
      me.rotation.set(a, e, a * 2);
      puffs.push({ me, s: i === 0 ? radius * 0.8 : radius * (0.45 + 0.22 * hash3(i, seed, 4)) });
      group.add(me);
    }
    this.scene.add(group);
    this.clouds.push({ group, puffs, x, y: y + radius * 0.45, z, r: radius, t0: performance.now(), dur: durMs });
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

  // 閃光彈爆開的白光
  flashBurst(x, y, z) {
    const b = this.booms[this.bnext]; this.bnext = (this.bnext + 1) % this.booms.length;
    b.life = 0.28; b.r = 1.6; b.mesh.position.set(x, y, z); b.mesh.visible = true; b.light.position.set(x, y, z);
    for (let i = 0; i < 14; i++) this.spawn(x, y, z, (Math.random() - 0.5) * 9, Math.random() * 7, (Math.random() - 0.5) * 9, 0.04, 0.25 + Math.random() * 0.2, 3, 3, 3);
  }

  clear() {
    for (const p of this.p) p.life = 0;
    for (const t of this.tracers) { t.life = 0; t.mesh.visible = false; }
    for (const b of this.booms) { b.life = 0; b.mesh.visible = false; b.light.intensity = 0; }
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

  // 子彈打在方塊上的小碎屑
  impact(x, y, z, nx, ny, nz, type, n = 4) {
    const c = BLOCK[type] ? BLOCK[type].color : [0.5, 0.5, 0.5];
    for (let i = 0; i < n; i++) {
      this.spawn(x, y, z, nx * 2.2 + (Math.random() - 0.5) * 3, ny * 2.2 + Math.random() * 2.5, nz * 2.2 + (Math.random() - 0.5) * 3,
        0.03 + Math.random() * 0.05, 0.35 + Math.random() * 0.3, c[0] * 1.3, c[1] * 1.3, c[2] * 1.3);
    }
  }

  // 方塊碎掉
  debris(bx, by, bz, type, n = 7, power = 1) {
    const c = BLOCK[type] ? BLOCK[type].color : [0.5, 0.5, 0.5];
    const x = (bx + 0.5) * BS, y = (by + 0.5) * BS, z = (bz + 0.5) * BS;
    for (let i = 0; i < n; i++) {
      const k = 0.8 + Math.random() * 0.5;
      this.spawn(x + (Math.random() - 0.5) * BS, y + (Math.random() - 0.5) * BS, z + (Math.random() - 0.5) * BS,
        (Math.random() - 0.5) * 5 * power, (1 + Math.random() * 4) * power, (Math.random() - 0.5) * 5 * power,
        0.07 + Math.random() * 0.12, 0.7 + Math.random() * 0.8, c[0] * k, c[1] * k, c[2] * k);
    }
  }

  // 打到人：隊伍色的火花
  hitSpark(x, y, z, color, n = 8) {
    _c.setHex(color);
    for (let i = 0; i < n; i++) {
      this.spawn(x, y, z, (Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5, 0.04 + Math.random() * 0.04, 0.3 + Math.random() * 0.25, _c.r * 2, _c.g * 2, _c.b * 2);
    }
  }

  smoke(x, y, z, n = 1, size = 0.12) {
    for (let i = 0; i < n; i++) {
      const s = 0.25 + Math.random() * 0.2;
      this.spawn(x, y, z, (Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8, size * (0.7 + Math.random() * 0.6), 0.5 + Math.random() * 0.5, s, s, s, -0.02);
    }
  }

  explosion(x, y, z, radius) {
    const b = this.booms[this.bnext]; this.bnext = (this.bnext + 1) % this.booms.length;
    b.life = 0.28; b.r = radius * 0.75; b.mesh.position.set(x, y, z); b.mesh.visible = true; b.light.position.set(x, y + 0.5, z);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2, sp = 4 + Math.random() * 9;
      this.spawn(x, y, z, Math.cos(a) * Math.cos(e) * sp, Math.abs(Math.sin(e)) * sp + 1, Math.sin(a) * Math.cos(e) * sp,
        0.06 + Math.random() * 0.1, 0.4 + Math.random() * 0.5, 2.4, 1.1 + Math.random() * 0.8, 0.2);
    }
    for (let i = 0; i < 16; i++) this.smoke(x + (Math.random() - 0.5) * radius * 0.6, y + Math.random() * radius * 0.4, z + (Math.random() - 0.5) * radius * 0.6, 1, 0.35);
  }

  tracer(a, b, color = 0xffe9a8, width = 0.025, life = 0.08) {
    const t = this.tracers[this.tnext]; this.tnext = (this.tnext + 1) % this.tracers.length;
    const len = a.distanceTo(b);
    if (len < 0.3) return;
    t.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    t.mesh.lookAt(b);
    t.mesh.scale.set(width, width, len);
    t.mesh.material.color.setHex(color);
    t.mesh.material.opacity = 0.85; t.mesh.visible = true; t.life = t.max = life;
  }

  update(dt) {
    const w = this.world;
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
      const k = p.g < 0 ? (0.6 + (1 - p.life / p.max) * 1.4) * Math.min(1, p.life / p.max * 3) : Math.min(1, p.life / p.max * 2.5);
      _s.setScalar(p.size * k); _p.set(p.x, p.y, p.z); _q.setFromEuler(_e.set(p.rot, p.rot * 0.7, 0));
      this.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;

    if (this.clouds.length) {
      const now = performance.now();
      for (let i = this.clouds.length - 1; i >= 0; i--) {
        const c = this.clouds[i], age = now - c.t0;
        if (age >= c.dur) { this.scene.remove(c.group); this.clouds.splice(i, 1); continue; }
        const grow = 1 - Math.pow(1 - Math.min(1, age / 800), 3), k = grow * Math.min(1, (c.dur - age) / 1500);
        for (const p of c.puffs) p.me.scale.setScalar(Math.max(0.001, p.s * k));
        c.group.rotation.y = age * 0.00006;
      }
    }

    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) { t.mesh.visible = false; continue; }
      t.mesh.material.opacity = 0.85 * (t.life / t.max);
    }
    for (const b of this.booms) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) { b.mesh.visible = false; b.light.intensity = 0; continue; }
      const k = 1 - b.life / 0.28;
      b.mesh.scale.setScalar(b.r * (0.3 + k * 0.9));
      b.mesh.material.opacity = (1 - k) * 0.9;
      b.light.intensity = (1 - k) * 60;
    }
  }
}
