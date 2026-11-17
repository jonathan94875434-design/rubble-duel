import * as THREE from 'three';
import { WEAPONS } from './weapons.js';

const DARK = new THREE.MeshLambertMaterial({ color: 0x1b1d22 });
const MID = new THREE.MeshLambertMaterial({ color: 0x33363d });
const matCache = new Map();
function accent(c) {
  if (!matCache.has(c)) matCache.set(c, new THREE.MeshLambertMaterial({ color: c }));
  return matCache.get(c);
}

// 用方塊拼出一把槍。槍口朝 -Z，原點在握把上方。
export function buildGun(id) {
  const m = WEAPONS[id].model;
  const g = new THREE.Group();
  const acc = accent(m.color);
  const box = (w, h, d, mat, x, y, z) => {
    const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    me.position.set(x, y, z); g.add(me); return me;
  };
  const bw = m.bw || 0.028;
  if (m.tube) {
    box(m.bw, m.bw, m.len, acc, 0, 0.02, -m.len / 2 + 0.06);
    box(m.bw + 0.03, m.bw + 0.03, 0.08, DARK, 0, 0.02, -m.len + 0.08);
    box(m.bw + 0.02, m.bw + 0.02, 0.05, DARK, 0, 0.02, 0.05);
    box(0.045, 0.11, 0.05, DARK, 0, -0.09, -0.05);
    box(0.045, 0.09, 0.05, DARK, 0, -0.08, -0.25);
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -m.len + 0.04);
    g.userData.sightY = 0.02 + m.bw / 2 + 0.03;
    return g;
  }
  box(0.058, m.h, m.len, acc, 0, 0, -m.len / 2);                         // 機匣
  box(0.05, m.h * 0.35, m.len * 0.7, MID, 0, m.h * 0.62, -m.len * 0.5);  // 上護木
  box(bw, bw, m.barrel, DARK, 0, m.h * 0.12, -m.len - m.barrel / 2);     // 槍管
  box(0.045, 0.11, 0.05, DARK, 0, -m.h / 2 - 0.05, -0.03).rotation.x = -0.25; // 握把
  if (m.mag) {
    if (m.drum) box(0.1, m.mag, 0.12, DARK, 0, -m.h / 2 - m.mag / 2, -m.len * 0.45);
    else box(0.04, m.mag, 0.065, DARK, 0, -m.h / 2 - m.mag / 2, -m.len * 0.42).rotation.x = 0.12;
  }
  if (m.stock) { box(0.045, m.h * 0.7, m.stock, DARK, 0, -0.012, m.stock / 2); box(0.05, m.h * 1.3, 0.03, MID, 0, -0.03, m.stock); }
  if (m.scope) {
    box(0.04, 0.04, 0.17, DARK, 0, m.h / 2 + 0.055, -m.len * 0.45);
    box(0.02, 0.03, 0.02, MID, 0, m.h / 2 + 0.02, -m.len * 0.38);
    box(0.02, 0.03, 0.02, MID, 0, m.h / 2 + 0.02, -m.len * 0.52);
  } else box(0.012, 0.025, 0.012, DARK, 0, m.h * 0.12 + bw / 2 + 0.012, -m.len - m.barrel + 0.02); // 準星
  g.userData.muzzle = new THREE.Vector3(0, m.h * 0.12, -m.len - m.barrel);
  g.userData.sightY = m.scope ? m.h / 2 + 0.055 : m.h * 0.62 + m.h * 0.175 + 0.02; // 瞄準時把準星對到畫面中心
  return g;
}
