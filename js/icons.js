import * as THREE from 'three';
import * as GM from './gunmodel.js';

// 槍的小圖：用一個臨時的小畫布把 3D 模型拍成側面照，給商店和 HUD 用。拍完就把那個畫布釋放掉。
// 回傳 { 武器代號: 圖片網址 }；任何一步失敗就回傳空的（介面會退回純文字）
// ids 的每一項：武器代號，或 { key, id, skin }（補給箱的物品：同一把武器不同塗裝）
// wskin：塗裝字串，或 (武器代號) => 塗裝字串（每把槍各自的特殊塗裝）
export function shootIcons(ids, wskin = 'stock', props = []) {
  const out = {};
  let r = null;
  try {
    const W = 384, H = 160, c = document.createElement('canvas'); c.width = W; c.height = H;
    r = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
    r.setClearColor(0x000000, 0); r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a342c, 2.4));
    const k = new THREE.DirectionalLight(0xfff2dd, 3.2); k.position.set(2, 3, 1.5); scene.add(k);
    const f = new THREE.DirectionalLight(0x9ab8ff, 1.2); f.position.set(1, -0.5, -2); scene.add(f);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20), box = new THREE.Box3(), size = new THREE.Vector3(), mid = new THREE.Vector3();
    const snap = (id, obj) => {
      const pivot = new THREE.Group(); pivot.add(obj); pivot.rotation.set(0.12, 0.3, 0); scene.add(pivot);   // 稍微轉一點角度，比較有立體感
      pivot.updateMatrixWorld(true); box.setFromObject(pivot); box.getSize(size); box.getCenter(mid);
      const h = Math.max(size.y * 0.5, (size.z * 0.5) / (W / H)) * 1.12 + 0.01;
      cam.left = -h * (W / H); cam.right = h * (W / H); cam.top = h; cam.bottom = -h; cam.updateProjectionMatrix();
      cam.position.set(mid.x + 5, mid.y, mid.z); cam.lookAt(mid);          // 從槍的右邊看過去：槍口朝畫面右邊
      r.render(scene, cam);
      out[id] = c.toDataURL('image/png');
      scene.remove(pivot);
    };
    for (const it of ids) {
      const key = typeof it === 'string' ? it : it.key, id = typeof it === 'string' ? it : it.id;
      const ws = typeof it !== 'string' ? it.skin : typeof wskin === 'function' ? wskin(id) : wskin;
      try { snap(key, GM.buildGun(id, ws)); } catch { /* 這一把沒有模型就跳過 */ }
    }
    if (GM.buildProp) for (const id of props) { try { snap(id, GM.buildProp(id)); } catch { /* 跳過 */ } }
  } catch { /* 開不了第二個畫布：不要圖示 */ }
  if (r) { r.dispose(); if (r.forceContextLoss) r.forceContextLoss(); }
  return out;
}
