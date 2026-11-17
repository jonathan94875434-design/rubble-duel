import * as THREE from 'three';
import { buildGun } from './gunmodel.js';
import { lerp } from './util.js';

// 第一人稱手上的槍：獨立場景，畫在最上層，所以不會插進牆裡
export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x555566, 2.2));
    const d = new THREE.DirectionalLight(0xfff4e0, 2.0); d.position.set(1, 2, 1.5); this.scene.add(d);
    this.holder = new THREE.Group(); this.holder.scale.setScalar(0.78); this.scene.add(this.holder);
    this.guns = {}; this.cur = null; this.sightY = 0.06; this.kick = 0; this.flashT = 0; this.sway = new THREE.Vector2();
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.flash2 = this.flash.clone(); this.flash2.rotation.y = Math.PI / 2;
    this.flashG = new THREE.Group(); this.flashG.add(this.flash, this.flash2); this.flashG.visible = false; this.holder.add(this.flashG);
  }

  setAspect(a) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  setWeapon(id) {
    if (this.cur && this.guns[this.cur]) this.guns[this.cur].visible = false;
    if (!this.guns[id]) { this.guns[id] = buildGun(id); this.holder.add(this.guns[id]); }
    this.guns[id].visible = true; this.cur = id;
    this.flashG.position.copy(this.guns[id].userData.muzzle); this.flashG.position.z -= 0.05;
    this.sightY = this.guns[id].userData.sightY;
  }

  fire(big) { this.kick = big ? 1.6 : 1; this.flashT = 0.045; this.flashG.rotation.z = Math.random() * Math.PI; this.flashG.scale.setScalar(big ? 1.7 : 0.8 + Math.random() * 0.5); }

  // s: { ads 0..1, walkPhase, moving 0..1, reload 0..1(0=沒在換彈), draw 0..1(1=已舉好), dx, dy 滑鼠位移, scoped }
  update(dt, s) {
    this.kick = Math.max(0, this.kick - dt * 9);
    this.flashT -= dt; this.flashG.visible = this.flashT > 0;
    this.sway.x = lerp(this.sway.x, Math.max(-1, Math.min(1, s.dx * 0.02)), Math.min(1, dt * 10));
    this.sway.y = lerp(this.sway.y, Math.max(-1, Math.min(1, s.dy * 0.02)), Math.min(1, dt * 10));
    const a = s.ads, h = this.holder;
    const bob = s.moving * (1 - a * 0.85);
    const bx = Math.sin(s.walkPhase) * 0.012 * bob, by = -Math.abs(Math.cos(s.walkPhase)) * 0.012 * bob;
    const rl = s.reload > 0 ? Math.sin(s.reload * Math.PI) : 0;
    const dr = 1 - s.draw;
    h.position.set(
      lerp(0.19, 0, a) + bx - this.sway.x * 0.012,
      lerp(-0.19, (-this.sightY - 0.01) * 0.78, a) + by + this.sway.y * 0.012 - rl * 0.13 - dr * 0.3,
      lerp(-0.5, -0.36, a) + this.kick * 0.045,
    );
    h.rotation.set(this.kick * 0.07 - rl * 0.75 - dr * 0.9, -this.sway.x * 0.05 + rl * 0.35, rl * 0.3 - this.sway.x * 0.04);
    h.visible = !(s.scoped && a > 0.8);
  }

  render(renderer) {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
