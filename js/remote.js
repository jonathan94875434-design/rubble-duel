import * as THREE from 'three';
import { NET } from './config.js';
import { lerp, lerpAngle, rayPlayer } from './util.js';
import { buildGun } from './gunmodel.js';

// 對手的身體模型 + 位置插值 + 受擊判定
export class RemotePlayer {
  constructor(scene, color) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    const body = new THREE.MeshLambertMaterial({ color });
    const dark = new THREE.MeshLambertMaterial({ color: 0x23262d });
    const visor = new THREE.MeshBasicMaterial({ color: 0xfff2c4 });
    const mk = (w, h, d, mat, x, y, z, parent = this.group) => {
      const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      me.position.set(x, y, z); me.castShadow = true; parent.add(me); return me;
    };
    this.bodyMat = body;
    mk(0.52, 0.62, 0.28, body, 0, 1.08, 0);                 // 軀幹
    mk(0.44, 0.14, 0.26, dark, 0, 0.72, 0);                 // 腰帶
    this.head = new THREE.Group(); this.head.position.set(0, 1.44, 0); this.group.add(this.head);
    mk(0.32, 0.32, 0.32, body, 0, 0.17, 0, this.head);
    mk(0.26, 0.09, 0.02, visor, 0, 0.2, -0.165, this.head); // 面罩（看得出面向）
    this.legL = new THREE.Group(); this.legL.position.set(-0.13, 0.72, 0); this.group.add(this.legL);
    this.legR = new THREE.Group(); this.legR.position.set(0.13, 0.72, 0); this.group.add(this.legR);
    mk(0.2, 0.72, 0.22, dark, 0, -0.36, 0, this.legL);
    mk(0.2, 0.72, 0.22, dark, 0, -0.36, 0, this.legR);
    this.arms = new THREE.Group(); this.arms.position.set(0, 1.3, 0); this.group.add(this.arms);
    mk(0.13, 0.13, 0.5, body, 0.24, -0.04, -0.2, this.arms);
    mk(0.13, 0.13, 0.5, body, -0.2, -0.06, -0.22, this.arms).rotation.y = -0.5;
    this.gunHolder = new THREE.Group(); this.gunHolder.position.set(0.2, 0.02, -0.38); this.arms.add(this.gunHolder);
    this.gunId = null; this.guns = {};

    this.buf = [];
    this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0;
    this.alive = false; this.weapon = 'ar'; this.walk = 0; this.lastPos = new THREE.Vector3();
    this.flash = 0;
  }

  setColor(c) { this.bodyMat.color.setHex(c); }

  setWeapon(id) {
    if (id === this.gunId) return;
    if (this.gunId && this.guns[this.gunId]) this.guns[this.gunId].visible = false;
    if (!this.guns[id]) {
      const g = buildGun(id); g.scale.setScalar(1.25);
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.guns[id] = g; this.gunHolder.add(g);
    }
    this.guns[id].visible = true; this.gunId = id; this.weapon = id;
  }

  // 收到對手位置封包
  push(s) {
    this.buf.push({ t: performance.now(), x: s[0], y: s[1], z: s[2], yaw: s[3], pitch: s[4] });
    if (this.buf.length > 30) this.buf.shift();
  }
  clearBuffer() { this.buf.length = 0; }

  update(dt) {
    const rt = performance.now() - NET.INTERP_MS;
    const b = this.buf;
    if (b.length) {
      let i = b.length - 1;
      while (i > 0 && b[i].t > rt) i--;
      const a = b[i], c = b[Math.min(i + 1, b.length - 1)];
      const k = c.t > a.t ? Math.min(1, Math.max(0, (rt - a.t) / (c.t - a.t))) : 1;
      this.pos.set(lerp(a.x, c.x, k), lerp(a.y, c.y, k), lerp(a.z, c.z, k));
      this.yaw = lerpAngle(a.yaw, c.yaw, k); this.pitch = lerp(a.pitch, c.pitch, k);
    }
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.head.rotation.x = this.pitch * 0.7;
    this.arms.rotation.x = this.pitch;
    const sp = Math.hypot(this.pos.x - this.lastPos.x, this.pos.z - this.lastPos.z) / Math.max(dt, 1e-3);
    this.lastPos.copy(this.pos);
    if (sp > 0.5) this.walk += Math.min(sp, 9) * dt * 1.9;
    const sw = sp > 0.5 ? Math.sin(this.walk) * 0.7 : 0;
    this.legL.rotation.x = lerp(this.legL.rotation.x, sw, 0.3);
    this.legR.rotation.x = lerp(this.legR.rotation.x, -sw, 0.3);
    if (this.flash > 0) { this.flash -= dt; this.bodyMat.emissive.setScalar(Math.max(0, this.flash) * 4); }
  }

  hitFlash() { this.flash = 0.12; }

  rayHit(ox, oy, oz, dx, dy, dz) {
    if (!this.alive) return null;
    return rayPlayer(ox, oy, oz, dx, dy, dz, this.pos.x, this.pos.y, this.pos.z);
  }

  // 槍口的世界座標（畫對手彈道用）
  muzzle(out) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return out.set(this.pos.x - s * cp * 0.9 + c * 0.2, this.pos.y + 1.32 + sp * 0.9, this.pos.z - c * cp * 0.9 - s * 0.2);
  }
}
