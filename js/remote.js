import * as THREE from 'three';
import { NET } from './config.js';
import { lerp, lerpAngle, rayPlayer } from './util.js';
import { buildGun } from './gunmodel.js';
import { SKINS } from './skins.js';

// 對手的身體模型 + 位置插值 + 受擊判定。造型預覽的假人也用這個。
export class RemotePlayer {
  constructor(scene, color) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    const M = (c) => new THREE.MeshLambertMaterial({ color: c });
    this.mat = { body: M(color), head: M(color), trim: M(0x23262d), legs: M(0x23262d), visor: new THREE.MeshBasicMaterial({ color: 0xfff2c4 }), glow: new THREE.MeshBasicMaterial({ color: 0xffffff }) };
    const mk = (w, h, d, mat, x, y, z, parent) => {
      const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      me.position.set(x, y, z); me.castShadow = true; parent.add(me); return me;
    };
    this._mk = mk;
    this.upper = new THREE.Group(); this.group.add(this.upper);          // 蹲下時整個上半身往下
    mk(0.52, 0.62, 0.28, this.mat.body, 0, 1.08, 0, this.upper);         // 軀幹
    mk(0.44, 0.14, 0.26, this.mat.trim, 0, 0.72, 0, this.upper);         // 腰帶
    this.head = new THREE.Group(); this.head.position.set(0, 1.44, 0); this.upper.add(this.head);
    mk(0.32, 0.32, 0.32, this.mat.head, 0, 0.17, 0, this.head);
    mk(0.26, 0.09, 0.02, this.mat.visor, 0, 0.2, -0.165, this.head);     // 面罩（看得出面向）
    this.legL = new THREE.Group(); this.legL.position.set(-0.13, 0.72, 0); this.group.add(this.legL);
    this.legR = new THREE.Group(); this.legR.position.set(0.13, 0.72, 0); this.group.add(this.legR);
    mk(0.2, 0.72, 0.22, this.mat.legs, 0, -0.36, 0, this.legL);
    mk(0.2, 0.72, 0.22, this.mat.legs, 0, -0.36, 0, this.legR);
    this.arms = new THREE.Group(); this.arms.position.set(0, 1.3, 0); this.upper.add(this.arms);
    mk(0.13, 0.13, 0.5, this.mat.body, 0.24, -0.04, -0.2, this.arms);
    mk(0.13, 0.13, 0.5, this.mat.body, -0.2, -0.06, -0.22, this.arms).rotation.y = -0.5;
    this.gunHolder = new THREE.Group(); this.gunHolder.position.set(0.2, 0.02, -0.38); this.arms.add(this.gunHolder);
    this.gunKey = null; this.guns = {};
    this.accBody = new THREE.Group(); this.upper.add(this.accBody);
    this.accHead = new THREE.Group(); this.head.add(this.accHead);

    this.buf = [];
    this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0;
    this.alive = false; this.weapon = 'ar'; this.wskin = 'stock'; this.skin = null; this.teamColor = color;
    this.walk = 0; this.lastPos = new THREE.Vector3(); this.flash = 0;
    this.crouched = false; this.grounded = true; this.cr = 0; this.speed = 0;
    this.justLanded = false; this.airT = 0;
    this.applySkin('recruit', color);
  }

  // 換造型：改顏色 + 重建配件
  applySkin(id, teamColor = this.teamColor) {
    const s = SKINS[id] || SKINS.recruit, m = this.mat;
    this.skin = id; this.teamColor = teamColor;
    m.body.color.setHex(s.body === null ? teamColor : s.body);
    m.head.color.setHex(s.head === null ? teamColor : s.head);
    m.trim.color.setHex(s.trim); m.legs.color.setHex(s.legs); m.visor.color.setHex(s.visor);
    m.glow.color.setHex(s.glow || s.visor);
    for (const g of [this.accBody, this.accHead]) { for (const c of [...g.children]) { c.geometry.dispose(); g.remove(c); } }
    const B = this.accBody, H = this.accHead, mk = this._mk;
    for (const a of s.acc) {
      if (a === 'hood') { mk(0.37, 0.12, 0.37, m.trim, 0, 0.36, 0.01, H); mk(0.37, 0.34, 0.07, m.trim, 0, 0.16, 0.19, H); mk(0.05, 0.3, 0.3, m.trim, 0.185, 0.17, 0.03, H); mk(0.05, 0.3, 0.3, m.trim, -0.185, 0.17, 0.03, H); }
      else if (a === 'helmet') { mk(0.38, 0.13, 0.38, m.trim, 0, 0.35, 0, H); mk(0.38, 0.04, 0.1, m.trim, 0, 0.3, -0.22, H); }
      else if (a === 'pack') { mk(0.36, 0.44, 0.17, m.trim, 0, 1.1, 0.22, B); mk(0.2, 0.12, 0.08, m.legs, 0, 1.02, 0.33, B); }
      else if (a === 'pads') { mk(0.2, 0.1, 0.32, m.trim, 0.31, 1.41, 0, B); mk(0.2, 0.1, 0.32, m.trim, -0.31, 1.41, 0, B); }
      else if (a === 'antenna') { mk(0.02, 0.4, 0.02, m.trim, 0.16, 1.62, 0.16, B); mk(0.05, 0.05, 0.05, m.glow, 0.16, 1.84, 0.16, B); }
      else if (a === 'crest') { mk(0.07, 0.16, 0.36, m.trim, 0, 0.4, 0.01, H); }
      else if (a === 'horns') { mk(0.06, 0.16, 0.06, m.glow, 0.12, 0.4, -0.04, H); mk(0.06, 0.16, 0.06, m.glow, -0.12, 0.4, -0.04, H); }
      else if (a === 'stripes') { mk(0.535, 0.045, 0.295, m.glow, 0, 1.24, 0, B); mk(0.535, 0.045, 0.295, m.glow, 0, 0.95, 0, B); mk(0.335, 0.04, 0.335, m.glow, 0, 1.5, 0, B); }
      else if (a === 'camo') { mk(0.22, 0.2, 0.295, m.trim, -0.12, 1.2, 0, B); mk(0.18, 0.16, 0.295, m.trim, 0.14, 0.95, 0, B); mk(0.34, 0.1, 0.1, m.trim, 0.02, 0.2, 0.12, H); }
    }
  }

  setColor(c) { this.applySkin(this.skin || 'recruit', c); }

  setWeapon(id, wskin = this.wskin) {
    const key = id + '|' + wskin;
    if (key === this.gunKey) return;
    if (this.gunKey && this.guns[this.gunKey]) this.guns[this.gunKey].visible = false;
    if (!this.guns[key]) {
      const g = buildGun(id, wskin); g.scale.setScalar(1.25);
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.guns[key] = g; this.gunHolder.add(g);
    }
    this.guns[key].visible = true; this.gunKey = key; this.weapon = id; this.wskin = wskin;
  }

  // 收到對手位置封包：[x, y, z, yaw, pitch, 武器, 旗標(1=蹲 2=著地)]
  push(s) {
    this.buf.push({ t: performance.now(), x: s[0], y: s[1], z: s[2], yaw: s[3], pitch: s[4], f: s[6] === undefined ? 2 : s[6] });
    if (this.buf.length > 30) this.buf.shift();
  }
  clearBuffer() { this.buf.length = 0; this.crouched = false; this.grounded = true; this.cr = 0; this.speed = 0; this.airT = 0; }

  update(dt) {
    const rt = performance.now() - NET.INTERP_MS;
    const b = this.buf;
    this.justLanded = false;
    if (b.length) {
      let i = b.length - 1;
      while (i > 0 && b[i].t > rt) i--;
      const a = b[i], c = b[Math.min(i + 1, b.length - 1)];
      const k = c.t > a.t ? Math.min(1, Math.max(0, (rt - a.t) / (c.t - a.t))) : 1;
      this.pos.set(lerp(a.x, c.x, k), lerp(a.y, c.y, k), lerp(a.z, c.z, k));
      this.yaw = lerpAngle(a.yaw, c.yaw, k); this.pitch = lerp(a.pitch, c.pitch, k);
      const f = k > 0.5 ? c.f : a.f, g = !!(f & 2);
      if (g && !this.grounded && this.airT > 0.3) this.justLanded = true;
      this.airT = g ? 0 : this.airT + dt;
      this.crouched = !!(f & 1); this.grounded = g;
    }
    this.cr += ((this.crouched ? 1 : 0) - this.cr) * Math.min(1, dt * 14);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.upper.position.y = -0.5 * this.cr;
    this.legL.position.y = this.legR.position.y = 0.72 - 0.5 * this.cr;
    this.legL.scale.y = this.legR.scale.y = 1 - 0.69 * this.cr;
    this.head.rotation.x = this.pitch * 0.7;
    this.arms.rotation.x = this.pitch;
    const sp = Math.hypot(this.pos.x - this.lastPos.x, this.pos.z - this.lastPos.z) / Math.max(dt, 1e-3);
    this.speed = lerp(this.speed, Math.min(sp, 14), Math.min(1, dt * 10));
    this.lastPos.copy(this.pos);
    if (sp > 0.5) this.walk += Math.min(sp, 9) * dt * 1.9;
    const sw = sp > 0.5 && this.grounded ? Math.sin(this.walk) * 0.7 : this.grounded ? 0 : 0.5;
    this.legL.rotation.x = lerp(this.legL.rotation.x, sw, 0.3);
    this.legR.rotation.x = lerp(this.legR.rotation.x, this.grounded ? -sw : -0.3, 0.3);
    if (this.flash > 0) { this.flash -= dt; const e = Math.max(0, this.flash) * 4; this.mat.body.emissive.setScalar(e); this.mat.head.emissive.setScalar(e); }
  }

  hitFlash() { this.flash = 0.12; }

  rayHit(ox, oy, oz, dx, dy, dz) {
    if (!this.alive) return null;
    return rayPlayer(ox, oy, oz, dx, dy, dz, this.pos.x, this.pos.y, this.pos.z, this.crouched);
  }

  // 槍口的世界座標（畫對手彈道用）
  muzzle(out) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return out.set(this.pos.x - s * cp * 0.9 + c * 0.2, this.pos.y + 1.32 - 0.5 * this.cr + sp * 0.9, this.pos.z - c * cp * 0.9 - s * 0.2);
  }
}
