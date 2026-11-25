import * as THREE from 'three';
import { NET, PLAYER } from './config.js';
import { clamp, lerp, lerpAngle, rayPlayer } from './util.js';
import { buildGun } from './gunmodel.js';
import { SKINS, gunSkin } from './skins.js';

// 對手的身體模型（第三人稱）+ 位置插值 + 受擊判定。造型預覽的假人也用這個。
// 模型是「一節一節的剛體」掛在關節上：骨盆 → 脊椎 → 胸 → 頭；肩 → 上臂 → 前臂 → 手；髖 → 大腿 → 小腿 → 腳。
// 手腳都用兩節骨頭的解析 IK：先決定手要放哪（握把、護木）、腳要踩哪，再反推手肘與膝蓋，所以關節不會脫開。
// 預覽與截圖：dev/character.html、tests/shot-character.mjs

// 表情動作（name 給選單用，dur = 秒數）
export const EMOTES = {
  wave: { name: '揮手', dur: 2.4 },
  dance: { name: '跳舞', dur: 3.0 },
  salute: { name: '敬禮', dur: 2.2 },
  taunt: { name: '嘲諷', dur: 2.6 },
};

// ── 骨架尺寸（公尺，腳底 = 原點）。受擊判定盒是固定的（util.js rayPlayer）：身體到脖子 1.42、頭頂 1.82，模型要對上 ──
const HIP_Y = 0.935, HIP_X = 0.09, THIGH = 0.43, SHIN = 0.43, SOLE = 0.086;
const SPINE_Y = 0.08, CHEST_Y = 0.17, NECK_Y = 0.25, SH_X = 0.2, SH_Y = 0.235, HEAD_Y = 0.327;
const UARM = 0.3, FARM = 0.27, NECK_H = HIP_Y + SPINE_Y + CHEST_Y + NECK_Y;   // 脖子根部 1.435
const PI = Math.PI, TAU = PI * 2;
const RECEIVE_SHADOW = true;   // 角色會不會被別的東西（還有自己）的影子蓋到
const PISTOLS = new Set(['pistol', 'revolver', 'mp']);

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const frac = (x) => x - Math.floor(x);

// ───────── 幾何小工具 ─────────
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, n = 10, open = false, ts = 0, tl = TAU) => new THREE.CylinderGeometry(rt, rb, h, n, 1, open, ts, tl);
const sph = (r = 1, n = 12, m = 8, ps = 0, pl = PI) => new THREE.SphereGeometry(r, n, m, 0, TAU, ps, pl);
const cap = (r, len, n = 10) => new THREE.CapsuleGeometry(r, len, 4, n);
// 車削：[半徑, 高度] 由下往上的輪廓 → 一整條圓滑的肢體（關節處收成圓頭）
const lathe = (pts, n = 10) => new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), n);
const UARM_P = [[0, -0.352], [0.03, -0.345], [0.047, -0.326], [0.052, -0.3], [0.05, -0.262], [0.054, -0.2], [0.06, -0.13], [0.065, -0.07], [0.072, -0.02], [0.07, 0.022], [0.057, 0.052], [0.034, 0.07], [0, 0.076]];
const FARM_P = [[0, -0.274], [0.035, -0.27], [0.038, -0.2], [0.045, -0.12], [0.051, -0.06], [0.051, -0.02], [0.044, 0.02], [0.028, 0.042], [0, 0.05]];
const THIGH_P = [[0, -0.498], [0.036, -0.49], [0.059, -0.466], [0.067, -0.43], [0.067, -0.38], [0.075, -0.3], [0.086, -0.2], [0.092, -0.1], [0.092, -0.03], [0.084, 0.035], [0.066, 0.075], [0.04, 0.094], [0, 0.1]];
const SHIN_P = [[0.05, -0.29], [0.054, -0.26], [0.059, -0.2], [0.068, -0.12], [0.065, -0.05], [0.063, 0], [0.05, 0.042], [0.03, 0.06], [0, 0.066]];
// 2D 輪廓擠出成厚片（厚度方向置中，邊緣帶一點倒角）
function prism(pts, depth, bevel = 0.006) {
  const s = new THREE.Shape();
  pts.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1]))); s.closePath();
  const d = Math.max(0.001, depth - bevel * 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, steps: 1, curveSegments: 1, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1 });
  g.translate(0, 0, -d / 2); return g;
}
// 上緣切角的插板
const plate = (w, h, d, cut) => prism([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2 - cut], [w / 2 - cut, h / 2], [-w / 2 + cut, h / 2], [-w / 2, h / 2 - cut]], d, 0.007);
// 把面翻過來（兜帽內側這種從裡面也看得到的地方）
function flip(g) {
  if (g.index) { const o = g; g = g.toNonIndexed(); o.dispose(); }
  const p = g.attributes.position.array, n = g.attributes.normal.array, u = g.attributes.uv.array;
  for (let i = 0, j = 0; i < p.length; i += 9, j += 6) {
    for (let k = 0; k < 3; k++) { let a = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = a; a = n[i + 3 + k]; n[i + 3 + k] = n[i + 6 + k]; n[i + 6 + k] = a; }
    for (let k = 0; k < 2; k++) { const a = u[j + 2 + k]; u[j + 2 + k] = u[j + 4 + k]; u[j + 4 + k] = a; }
  }
  for (let i = 0; i < n.length; i++) n[i] = -n[i];
  return g;
}
// 貼圖座標縮放（迷彩斑塊在大小不同的零件上才會差不多大）
function uvs(g, su, sv) { const u = g.attributes.uv.array; for (let i = 0; i < u.length; i += 2) { u[i] *= su; u[i + 1] *= sv; } return g; }

// 收集各骨頭的零件，最後「同一根骨頭 + 同一種材質」合併成一個 Mesh（一個角色只要幾十個 draw call）
const _pm = new THREE.Matrix4(), _pq = new THREE.Quaternion(), _pe = new THREE.Euler(), _pp = V3(), _ps = V3();
class Kit {
  constructor(bones) { this.bones = bones; this.m = new Map(); }
  add(bone, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    let g = geo;
    if (g.index) { g = geo.toNonIndexed(); geo.dispose(); }
    g.applyMatrix4(_pm.compose(_pp.set(x, y, z), _pq.setFromEuler(_pe.set(rx, ry, rz)), _ps.set(sx, sy, sz)));
    let per = this.m.get(bone); if (!per) this.m.set(bone, per = new Map());
    let list = per.get(mat); if (!list) per.set(mat, list = []);
    list.push(g); return this;
  }
  flush() {
    const out = [];
    for (const [bone, per] of this.m) for (const [mat, list] of per) {
      let n = 0; for (const g of list) n += g.attributes.position.count;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2); let o = 0;
      for (const g of list) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; g.dispose(); }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); bg.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); bg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const me = new THREE.Mesh(bg, mat); me.castShadow = true; me.receiveShadow = RECEIVE_SHADOW;
      this.bones[bone].add(me); out.push(me);
    }
    this.m.clear(); return out;
  }
}

// 迷彩貼圖：幾個橢圓疊成不規則斑塊，邊界重複畫所以可以無縫重複
function camoTex(base, cols, seed) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), css = (h) => '#' + h.toString(16).padStart(6, '0');
  let s = seed; const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
  g.fillStyle = css(base); g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 34; i++) {
    g.fillStyle = css(cols[i % cols.length]);
    const x = R() * 128, y = R() * 128;
    for (let j = 0; j < 4; j++) {
      const ox = x + (R() - 0.5) * 22, oy = y + (R() - 0.5) * 22, rx = 5 + R() * 10, ry = 4 + R() * 7, a = R() * PI;
      for (const dx of [-128, 0, 128]) for (const dy of [-128, 0, 128]) { g.beginPath(); g.ellipse(ox + dx, oy + dy, rx, ry, a, 0, TAU); g.fill(); }
    }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// 布料的細紋（所有造型共用一張）：淡淡的雜點 + 織紋，顏色還是由材質決定
let _fabric = null;
function fabricTex() {
  if (_fabric) return _fabric;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), d = g.createImageData(64, 64); let s = 99;
  const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = 214 + R() * 30 + ((x + y) % 4 === 0 ? -16 : 0) + ((x - y + 64) % 8 === 0 ? 8 : 0), i = (y * 64 + x) * 4;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  const t = _fabric = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(7, 7); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ───────── 姿勢用的暫存 ─────────
const _a = V3(), _b = V3(), _n = V3(), _m = V3(), _x = V3(), _y = V3(), _z = V3(), _t = V3(), _t2 = V3(), _t3 = V3();
const _mat = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _qS = new THREE.Quaternion(), _qC = new THREE.Quaternion(), _qCi = new THREE.Quaternion(), _qG = new THREE.Quaternion(), _qH = new THREE.Quaternion();
const _hip = V3(), _sR = V3(), _sL = V3(), _wR = V3(), _wL = V3(), _gp = V3(), _sole = [V3(), V3(), V3(), V3()];
const _Y = V3(0, 1, 0), _hsl = { h: 0, s: 0, l: 0 }, _white = new THREE.Color(0xffffff), _black = new THREE.Color(0x000000), _ink = new THREE.Color(0x0e1014);

// 兩節骨頭的解析 IK：root → target，中間關節（膝蓋、手肘）往 bend 的方向凸。
// up、lo 是同一個父節點底下的兩根骨頭（骨頭沿自己的 -Y 延伸）。zs：-1 = 腿（膝蓋朝骨頭的 -Z）、+1 = 手（手肘朝骨頭的 +Z）
function ik2(up, lo, root, target, bend, L1, L2, zs) {
  _a.subVectors(target, root); let d = _a.length();
  if (d < 1e-5) { _a.set(0, -1, 0); d = 1e-5; } else _a.multiplyScalar(1 / d);
  d = clamp(d, Math.abs(L1 - L2) + 0.03, (L1 + L2) * 0.999);
  _b.copy(bend).addScaledVector(_a, -bend.dot(_a));
  if (_b.lengthSq() < 1e-6) _b.set(_a.y, -_a.x, 0.3);
  _b.normalize();
  const p = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - p * p));
  _m.copy(root).addScaledVector(_a, p).addScaledVector(_b, h);            // 中間關節
  _n.crossVectors(_a, _b).multiplyScalar(-zs);                           // 鉸鏈軸 = 骨頭的 X
  _y.subVectors(root, _m).normalize(); _z.crossVectors(_n, _y);
  up.position.copy(root); up.quaternion.setFromRotationMatrix(_mat.makeBasis(_n, _y, _z));
  _t.copy(root).addScaledVector(_a, d);                                  // 實際的末端（目標太遠時會短一點）
  _y.subVectors(_m, _t).normalize(); _z.crossVectors(_n, _y);
  lo.position.copy(_m); lo.quaternion.setFromRotationMatrix(_mat.makeBasis(_n, _y, _z));
}
// 手沒握東西時的朝向：順著前臂，掌心朝 palm
function freeHand(out, loQ, palm) {
  _y.set(0, 1, 0).applyQuaternion(loQ);
  _z.copy(palm).multiplyScalar(-1).addScaledVector(_y, palm.dot(_y));
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).applyQuaternion(loQ);
  _z.normalize(); _x.crossVectors(_y, _z);
  return out.setFromRotationMatrix(_mat.makeBasis(_x, _y, _z));
}
// 由「Z 軸、大概的 X 軸」組出朝向（擺槍用：Z = 槍口的反方向）
function basisQ(zx, zy, zz, xx, xy, xz) {
  const z = V3(zx, zy, zz).normalize(), x = V3(xx, xy, xz), y = V3().crossVectors(z, x).normalize();
  x.crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
// 握槍時手的朝向（槍的座標系）：Y = 手腕在哪一邊（指尖的反方向）、Z = 手背朝哪
function gripQ(yx, yy, yz, zx, zy, zz) {
  const y = V3(yx, yy, yz).normalize(), z = V3(zx, zy, zz), x = V3().crossVectors(y, z).normalize();
  z.crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
const GRIP_R = gripQ(0, -0.32, 1, 1, 0, 0);            // 右手握握把：手指往前繞，掌心朝左
const GRIP_L = gripQ(-0.75, -0.3, 0.6, 0, -1, 0);      // 左手托護木：掌心朝上
const GRIP_LP = gripQ(0.2, -0.32, 1, -1, 0, 0);        // 手槍的輔助手：從左邊包住右手
const PALM = V3(0, -0.062, -0.032);                    // 掌心（手的座標系）
const PIVOT = V3(0, SH_Y, 0);                          // 舉槍的轉軸：兩肩連線的中點（胸的座標系）

// 各類武器的持槍姿勢。g = 握把相對轉軸的位置（槍口朝 -Z）、blade = 上身側轉（負的 = 左肩在前）、
// head = 頭的 [低頭, 轉, 歪]、pr/pl = 右/左手肘往哪凸、pk = 俯仰跟多少、kick = 後座力的上揚
const HOLD = {
  rifle: { g: V3(0.122, 0.005, -0.29), blade: -0.5, head: [-0.12, -0.1, -0.2], pr: V3(0.5, -0.85, 0.25), pl: V3(-0.3, -0.9, 0.2), pk: 1, kick: 0.045, shL: 0.035 },
  pistol: { g: V3(0.02, 0.06, -0.49), blade: -0.12, head: [-0.02, 0, 0], pr: V3(0.6, -0.8, 0.1), pl: V3(-0.6, -0.8, 0.1), pk: 1, kick: 0.13, shL: 0 },
  launcher: { g: V3(0.19, 0.03, -0.2), blade: -0.3, head: [-0.02, -0.05, 0.1], pr: V3(0.7, -0.7, 0.2), pl: V3(-0.3, -0.9, 0.2), pk: 1, kick: 0.03, shL: 0.03 },
  knife: { g: V3(0.2, -0.3, -0.3), blade: 0.22, head: [-0.04, 0, 0], pr: V3(0.7, -0.3, 0.7), pl: V3(-0.6, -0.7, 0.4), pk: 0.45, kick: 0.02, shL: 0 },
};
// 收槍（做表情時）：長槍斜背在胸前、槍口朝左下；手槍和刀收在右腰
const STOW_LONG = { p: V3(0.07, 0.05, -0.215), q: basisQ(0.5, 0.86, 0.05, 0, 0, -1) };
const STOW_SIDE = { p: V3(0.215, -0.34, -0.02), q: basisQ(0, 1, 0.12, 1, 0, 0) };
// 倒地後槍躺在右手邊（sign：+1 仰躺、-1 趴著）
const DEADGUN = {
  1: { p: V3(SH_X + 0.36, SH_Y - 0.2, 0.085), q: basisQ(-0.55, 0.83, 0, 0, 0, -1) },
  [-1]: { p: V3(SH_X + 0.3, SH_Y + 0.22, -0.12), q: basisQ(-0.5, -0.86, 0, 0, 0, 1) },
};
const RELAX_R = V3(0.045, -0.52, -0.05), RELAX_L = V3(-0.045, -0.52, -0.05);

export class RemotePlayer {
  constructor(scene, color) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    const S = (c, r, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    // body 外套（袖子、肩）、body2 軀幹的深色布料、head 頭盔或兜帽、face 頭套、trim 背心/腰帶/手套/靴子、trim2 小包、legs 褲子、visor 護目鏡、glow 發光條
    const m = this.mat = {
      body: S(color, 0.86), body2: S(color, 0.9), head: S(color, 0.7), face: S(0x1a1c20, 0.92), trim: S(0x23262d, 0.6), trim2: S(0x2c3038, 0.7), legs: S(0x23262d, 0.9),
      dark: S(0x121417, 0.68), metal: S(0x3c4046, 0.4, 0.75),
      visor: new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.14, metalness: 0.35, emissive: 0xfff2c4, emissiveIntensity: 1.3 }),
      glow: new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 2.6 }),
    };
    this._flashMats = [m.body, m.body2, m.head, m.face, m.trim, m.trim2, m.legs];
    for (const mt of [m.body, m.body2, m.legs, m.face]) { mt.bumpMap = fabricTex(); mt.bumpScale = 0.55; }

    // 關節。fall/rig 平常不動，倒地動畫才用（fall 轉向 + 墊高，rig 往後或往前倒）
    const J = (p, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); p.add(g); return g; };
    this.fall = J(this.group); this.rig = J(this.fall);
    this.pelvis = J(this.rig, 0, HIP_Y, 0); this.spine = J(this.pelvis, 0, SPINE_Y, 0); this.chest = J(this.spine, 0, CHEST_Y, 0);
    this.waist = J(this.spine); this.torso = J(this.chest);              // 只轉外觀（側身），不影響骨架
    this.head = J(this.chest, 0, HEAD_Y, -0.005);
    const limb = (parent, len) => { const up = J(parent), lo = J(parent); return { up, lo, end: J(lo, 0, -len, 0) }; };
    this.armR = limb(this.chest, FARM); this.armL = limb(this.chest, FARM);
    this.legR = limb(this.rig, SHIN); this.legL = limb(this.rig, SHIN);
    this.gunHolder = J(this.chest);
    this.bone = {
      pelvis: this.pelvis, spine: this.waist, torso: this.torso, head: this.head,
      uaR: this.armR.up, faR: this.armR.lo, haR: this.armR.end, uaL: this.armL.up, faL: this.armL.lo, haL: this.armL.end,
      thR: this.legR.up, shR: this.legR.lo, ftR: this.legR.end, thL: this.legL.up, shL: this.legL.lo, ftL: this.legL.end,
    };
    for (const n in this.bone) this.bone[n].name = n;
    this._buildBody();
    this.accMeshes = []; this.tex = [];
    this.gunKey = null; this.guns = {}; this.gun = null; this.kind = 'rifle'; this.gripL = V3(0, -0.02, -0.3); this.gripR = V3(0, -0.046, -0.016); this.eyeZ = 0.2; this.muzY = 0.05; this.gripLP = V3(-0.016, -0.05, -0.012);

    this.buf = [];
    this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0;
    this.alive = false; this.weapon = 'ar'; this.wskin = 'stock'; this.skin = null; this.teamColor = color;
    this.walk = 0; this.lastPos = new THREE.Vector3(); this.flash = 0;
    this.crouched = false; this.grounded = true; this.cr = 0; this.speed = 0;
    this.justLanded = false; this.airT = 0;
    // 動畫狀態
    this.time = 0; this.move = 0; this.air = 0; this.land = 0; this.kick = 0; this.mdx = 0; this.mdz = -1; this.wasGround = true;
    this.emoteId = null; this.emoteT = 0; this.emW = 0; this.throwT = -1; this.meleeT = -1;
    this.dead = false; this.deadT = 0; this.deadW = 0; this.fallYaw = 0; this.fallSign = 1; this.fallX = 0; this.fallZ = 1; this.groundY = 0; this.vy = 0;
    this.backDepth = 0.175;
    // 每一幀要解的目標（胸 / rig 座標系）
    this.P = {
      fL: V3(), fR: V3(), kL: V3(), kR: V3(), rT: V3(), lT: V3(), rP: V3(), lP: V3(), rPalm: V3(), lPalm: V3(),
      gunP: V3(), gunQ: new THREE.Quaternion(),
    };
    this.applySkin('recruit', color);
    this.setWeapon('ar', 'stock');
    this._pose(0);
  }

  // ───────── 身體（所有造型共用的部分）─────────
  _buildBody() {
    const m = this.mat, k = new Kit(this.bone);
    // 骨盆：臀、腰帶、帶扣、腰包
    k.add('pelvis', uvs(sph(), 2, 1), m.legs, 0, -0.012, 0.006, 0, 0, 0, 0.166, 0.124, 0.132);
    k.add('pelvis', cyl(1, 1, 0.052, 14), m.trim, 0, 0.076, 0.002, 0, 0, 0, 0.176, 1, 0.136);
    k.add('pelvis', box(0.052, 0.042, 0.02), m.metal, 0, 0.076, -0.135);
    k.add('pelvis', box(0.056, 0.095, 0.08), m.trim2, -0.18, 0.03, 0.005);
    k.add('pelvis', box(0.14, 0.085, 0.045), m.trim2, 0.02, 0.03, 0.146);
    k.add('pelvis', box(0.06, 0.07, 0.04), m.trim2, -0.1, 0.036, -0.13, 0, 0.3, 0);
    // 腹部、胸腔（作戰服的軀幹是比較深的布料）
    k.add('spine', uvs(cyl(0.16, 0.166, 0.215, 12), 2, 0.5), m.body2, 0, 0.075, 0, 0, 0, 0, 1, 1, 0.74);
    k.add('torso', uvs(cap(0.125, 0.12, 12), 2, 1), m.body2, 0, 0.115, 0, 0, 0, 0, 1.46, 1, 0.95);
    // 肩線、領子（跟袖子同色）
    k.add('torso', uvs(cap(0.064, 0.26, 8), 1, 1), m.body, 0, 0.23, 0.004, 0, 0, PI / 2, 1, 1, 1.25);
    k.add('torso', cyl(0.068, 0.092, 0.05, 12), m.body, 0, 0.288, 0.004, 0, 0, 0, 1, 1, 0.95);
    // 戰術背心：前後插板、肩帶、側片、彈匣袋、雜物袋、無線電
    k.add('torso', plate(0.27, 0.3, 0.04, 0.06), m.trim, 0, 0.115, -0.14, 0.04, 0, 0);
    k.add('torso', plate(0.28, 0.31, 0.04, 0.06), m.trim, 0, 0.115, 0.136, -0.03, 0, 0);
    for (const s of [-1, 1]) {
      k.add('torso', box(0.056, 0.022, 0.165), m.trim, s * 0.098, 0.288, -0.07, -0.36, 0, 0);
      k.add('torso', box(0.056, 0.022, 0.165), m.trim, s * 0.098, 0.288, 0.072, 0.36, 0, 0);
      k.add('torso', box(0.03, 0.13, 0.2), m.trim, s * 0.172, 0.02, 0.0);
      k.add('torso', box(0.034, 0.014, 0.21), m.dark, s * 0.174, 0.055, 0.0);
      k.add('torso', box(0.034, 0.014, 0.21), m.dark, s * 0.174, -0.015, 0.0);
    }
    for (const x of [-0.078, 0, 0.078]) {
      k.add('torso', box(0.064, 0.118, 0.04), m.trim2, x, 0.02, -0.176);
      k.add('torso', box(0.066, 0.034, 0.044), m.trim, x, 0.071, -0.176);
      k.add('torso', box(0.05, 0.02, 0.026), m.dark, x, 0.093, -0.172);
    }
    k.add('torso', box(0.135, 0.07, 0.022), m.trim2, 0, 0.2, -0.168);
    k.add('torso', box(0.06, 0.012, 0.024), m.dark, 0, 0.242, -0.166);
    k.add('torso', box(0.05, 0.115, 0.03), m.dark, -0.1, 0.2, 0.166);                              // 無線電
    k.add('torso', cyl(0.005, 0.007, 0.13, 6), m.dark, -0.112, 0.31, 0.166);
    k.add('torso', box(0.12, 0.09, 0.022), m.trim2, 0.045, 0.06, 0.164);
    // 脖子（頭套一路包下來）
    k.add('torso', cyl(0.05, 0.06, 0.13, 10), m.face, 0, 0.31, -0.004);
    // 頭：頭套 + 口鼻 + 護目鏡（看得出面向）+ 耳機
    k.add('head', sph(1, 14, 10), m.face, 0, 0.14, 0, 0, 0, 0, 0.094, 0.12, 0.108);
    k.add('head', sph(1, 10, 8), m.face, 0, 0.068, -0.03, 0, 0, 0, 0.075, 0.07, 0.082);
    k.add('head', sph(1, 8, 6), m.face, 0, 0.09, -0.1, 0, 0, 0, 0.017, 0.028, 0.016);
    k.add('head', cyl(1, 1, 0.07, 12, true, PI - 1.08, 2.16), m.dark, 0, 0.132, 0, 0, 0, 0, 0.1, 1, 0.115);
    k.add('head', cyl(1, 1, 0.012, 12, false, PI - 1.08, 2.16), m.dark, 0, 0.168, 0, 0, 0, 0, 0.1, 1, 0.115);
    k.add('head', cyl(1, 1, 0.012, 12, false, PI - 1.08, 2.16), m.dark, 0, 0.096, 0, 0, 0, 0, 0.1, 1, 0.115);
    k.add('head', cyl(1, 1, 0.048, 12, true, PI - 0.95, 1.9), m.visor, 0, 0.132, 0, 0, 0, 0, 0.1035, 1, 0.1185);
    k.add('head', cyl(1, 1, 0.03, 14, true, -(PI - 1.08), 2 * (PI - 1.08)), m.dark, 0, 0.134, 0, 0, 0, 0, 0.0975, 1, 0.1115);
    for (const s of [-1, 1]) k.add('head', cyl(0.038, 0.038, 0.034, 10), m.dark, s * 0.097, 0.11, 0.012, 0, 0, PI / 2);
    k.add('head', box(0.012, 0.012, 0.075), m.dark, -0.108, 0.085, -0.04, 0.35, 0.25, 0);   // 麥克風桿
    // 手臂（兩邊對稱；手套是 trim）
    for (const [sd, s] of [['R', 1], ['L', -1]]) {
      k.add('ua' + sd, uvs(lathe(UARM_P), 1, 1.4), m.body, 0, 0, 0, 0, 0, 0, 1, 1, 1.06);
      k.add('ua' + sd, box(0.02, 0.095, 0.075), m.body2, s * 0.054, -0.15, 0);                     // 臂袋
      k.add('ua' + sd, box(0.008, 0.045, 0.05), m.trim2, s * 0.066, -0.135, 0);                    // 臂章
      k.add('fa' + sd, uvs(lathe(FARM_P), 1, 1), m.body, 0, 0, 0);
      k.add('fa' + sd, sph(1, 8, 6), m.trim2, 0, -0.015, 0.03, 0, 0, 0, 0.046, 0.062, 0.034);      // 護肘
      k.add('fa' + sd, cyl(0.045, 0.043, 0.03, 10), m.body2, 0, -0.19, 0);                         // 袖口
      k.add('fa' + sd, cyl(0.043, 0.038, 0.075, 10), m.trim, 0, -0.235, 0);                        // 手套腕套
      k.add('ha' + sd, box(0.08, 0.09, 0.036), m.trim, 0, -0.048, 0);                              // 手掌
      k.add('ha' + sd, box(0.076, 0.058, 0.032), m.trim, 0, -0.104, -0.022, -0.8, 0, 0);           // 手指（微彎）
      k.add('ha' + sd, box(0.028, 0.062, 0.03), m.trim, s * 0.047, -0.05, -0.022, -0.3, 0, s * 0.35); // 拇指
      k.add('ha' + sd, box(0.066, 0.05, 0.012), m.trim2, 0, -0.045, 0.022);                        // 手背護片
      // 腿
      k.add('th' + sd, uvs(lathe(THIGH_P), 1.5, 2), m.legs, 0, 0, 0, 0, 0, 0, 1, 1, 1.06);
      k.add('sh' + sd, uvs(lathe(SHIN_P), 1, 1.4), m.legs, 0, 0, 0.006);
      k.add('sh' + sd, cyl(0.06, 0.057, 0.04, 10), m.legs, 0, -0.262, 0.004);                      // 褲管塞進靴子的那一圈
      k.add('sh' + sd, cyl(0.054, 0.051, 0.16, 10), m.trim, 0, -0.355, 0);                         // 靴筒
      k.add('sh' + sd, sph(1, 10, 6), m.trim, 0, -0.012, -0.05, 0, 0, 0, 0.055, 0.07, 0.032);      // 護膝
      k.add('sh' + sd, box(0.085, 0.03, 0.03), m.trim2, 0, -0.012, -0.068);
      k.add('sh' + sd, cyl(0.069, 0.069, 0.02, 10), m.dark, 0, -0.062, 0.003);                     // 護膝綁帶
      // 靴子：側面輪廓擠出來（腳跟 +Z、腳尖 -Z），下面一片鞋底
      const boot = prism([[-0.072, -0.066], [0.165, -0.066], [0.188, -0.048], [0.18, -0.02], [0.13, 0.002], [0.055, 0.03], [0.045, 0.06], [-0.06, 0.06], [-0.076, -0.01]], 0.096, 0.012);
      boot.rotateY(PI / 2);
      k.add('ft' + sd, boot, m.trim, 0, 0, 0);
      k.add('ft' + sd, box(0.102, 0.022, 0.268), m.dark, 0, -0.075, -0.056);
      k.add('ft' + sd, box(0.1, 0.014, 0.075), m.dark, 0, -0.06, 0.036);
      k.add('ft' + sd, box(0.06, 0.012, 0.09), m.dark, 0, 0.012, -0.075, 0.42, 0, 0);              // 鞋帶
    }
    k.add('thL', box(0.03, 0.14, 0.105), m.legs, -0.086, -0.23, 0.005);                            // 左腿側口袋
    k.add('thL', box(0.034, 0.03, 0.109), m.legs, -0.086, -0.165, 0.005);
    // 右腿槍套
    k.add('thR', box(0.04, 0.17, 0.1), m.dark, 0.102, -0.21, -0.005);
    k.add('thR', box(0.03, 0.07, 0.045), m.metal, 0.104, -0.105, 0.02, 0.25, 0, 0);
    k.add('thR', cyl(0.095, 0.088, 0.022, 10), m.dark, 0, -0.17, 0);
    k.add('thR', cyl(0.087, 0.081, 0.022, 10), m.dark, 0, -0.265, 0);
    k.flush();
  }

  // 頭盔：上半顆橢球稍微往後仰（前緣高、後緣低），底下補一片蓋住內側
  _helmet(k, mat, full) {
    const m = this.mat, sx = full ? 0.136 : 0.13, sy = full ? 0.164 : 0.158, sz = full ? 0.156 : 0.149, cut = 0.6, y = 0.16;
    k.add('head', uvs(sph(1, 14, 7, 0, PI * cut), 2, 1), mat, 0, y, 0.004, 0.3, 0, 0, sx, sy, sz);
    const rim = new THREE.CircleGeometry(Math.sin(PI * cut), 14); rim.rotateX(PI / 2); rim.translate(0, Math.cos(PI * cut), 0);
    k.add('head', rim, m.dark, 0, y, 0.004, 0.3, 0, 0, sx, sy, sz);
    const band = cyl(1, 1, 0.07, 14, true); band.translate(0, Math.cos(PI * cut) + 0.03, 0);       // 盔緣一圈
    k.add('head', band, m.dark, 0, y, 0.004, 0.3, 0, 0, sx * 1.012, sy, sz * 1.012);
    k.add('head', box(0.07, 0.022, 0.045), m.dark, 0, 0.004, -0.07, -0.3, 0, 0);                     // 下巴帶
    for (const s of [-1, 1]) k.add('head', box(0.01, 0.13, 0.022), m.dark, s * 0.082, 0.062, -0.034, -0.45, 0, s * 0.12);
    k.add('head', box(0.05, 0.04, 0.016), m.dark, 0, 0.232, -0.119 - (full ? 0.006 : 0), 0.72, 0, 0); // 夜視鏡座的底板
    if (!full) return;
    k.add('head', box(0.034, 0.034, 0.026), m.metal, 0, 0.23, -0.135, 0.72, 0, 0);
    for (const s of [-1, 1]) k.add('head', box(0.012, 0.03, 0.105), m.dark, s * 0.133, 0.165, 0.012, 0.22, 0, 0); // 側軌
    k.add('head', box(0.09, 0.05, 0.026), m.trim2, 0, 0.125, 0.152, 0.5, 0, 0);                       // 後腦配重包
    k.add('head', cyl(1, 1, 0.016, 14, true), m.dark, 0, y + 0.03, 0.004, 0.3, 0, 0, sx * 0.99, 1, sz * 0.99); // 盔帶
  }

  // ───────── 造型：換顏色 + 重建配件 ─────────
  applySkin(id, teamColor = this.teamColor) {
    const key = SKINS[id] ? id : 'recruit', s = SKINS[key], m = this.mat;
    if (this.skin === id && this.teamColor === teamColor && this._skinKey === key) return;
    this.skin = id; this.teamColor = teamColor; this._skinKey = key;
    const A = new Set(s.acc), body = s.body === null ? teamColor : s.body, head = s.head === null ? teamColor : s.head;
    for (const t of this.tex) t.dispose(); this.tex.length = 0;
    const setMap = (mt, map) => { if (mt.map !== map) { mt.map = map; mt.needsUpdate = true; } };
    if (A.has('camo')) {   // 迷彩：顏色直接畫在貼圖上
      const bt = camoTex(body, [s.trim, s.legs, head, 0x5d5335], 7), lt = camoTex(s.legs, [s.trim, body, 0x4a4228], 23);
      bt.repeat.set(1.6, 1.6); lt.repeat.set(1.6, 1.6); this.tex.push(bt, lt);
      setMap(m.body, bt); setMap(m.body2, bt); setMap(m.legs, lt); setMap(m.head, bt);
      m.body.color.setHex(0xffffff); m.body2.color.setHex(0x9a9a9a); m.legs.color.setHex(0xffffff); m.head.color.setHex(0xffffff);
    } else {
      const f = fabricTex();
      setMap(m.body, f); setMap(m.body2, f); setMap(m.legs, f); setMap(m.head, null);
      m.body.color.setHex(body); m.body2.color.setHex(body).lerp(_ink, 0.66); m.head.color.setHex(head); m.legs.color.setHex(s.legs);
    }
    m.face.color.setHex(head).lerp(_ink, 0.8);
    m.trim.color.setHex(s.trim);
    const l = m.trim.color.getHSL(_hsl).l;
    m.trim2.color.setHex(s.trim).lerp(l < 0.22 ? _white : _black, l < 0.22 ? 0.045 : 0.3);
    m.visor.emissive.setHex(s.visor); m.visor.color.setHex(s.visor).multiplyScalar(0.25);
    m.glow.emissive.setHex(s.glow || s.visor);

    for (const me of this.accMeshes) { me.geometry.dispose(); me.parent.remove(me); }
    const k = new Kit(this.bone);
    // 頭部裝備：兜帽，不然就是頭盔（helmet = 全罩式 + 夜視鏡座，其他造型是輕型盔）
    if (A.has('hood')) {
      const hood = () => uvs(sph(1, 12, 8, PI * 0.31, PI * 0.69), 2, 1);
      k.add('head', hood(), m.trim, 0, 0.15, 0.022, -PI / 2 - 0.3, 0, 0, 0.127, 0.165, 0.158);
      k.add('head', flip(hood()), m.dark, 0, 0.15, 0.022, -PI / 2 - 0.3, 0, 0, 0.122, 0.16, 0.153);
      k.add('head', cyl(0.05, 0.016, 0.1, 6), m.trim, 0, 0.268, 0.135, -2.0, 0, 0);                  // 帽尖垂在後腦
      k.add('torso', cyl(0.105, 0.22, 0.13, 12, true), m.trim, 0, 0.292, 0.012, 0, 0, 0, 1, 1, 0.8); // 披肩
      k.add('torso', cyl(0.1, 0.115, 0.05, 12), m.trim, 0, 0.352, 0.012, 0, 0, 0, 1, 1, 0.9);
    } else this._helmet(k, A.has('helmet') ? m.trim : m.head, A.has('helmet'));
    if (A.has('crest')) {   // 頭冠：從額頭到後腦的一片鰭
      const pts = [], N = 9, a0 = 0.5, a1 = PI - 0.12;
      for (let i = 0; i <= N; i++) { const a = lerp(a0, a1, i / N), h = 1 + 0.16 * Math.sin((i / N) * PI); pts.push([Math.cos(a) * 0.158 * h, Math.sin(a) * 0.188 * h]); }
      for (let i = N; i >= 0; i--) { const a = lerp(a0, a1, i / N); pts.push([Math.cos(a) * 0.118, Math.sin(a) * 0.14]); }
      const fin = prism(pts, 0.03, 0.006); fin.rotateY(PI / 2);
      k.add('head', fin, m.trim, 0, 0.142, 0.008, 0.3, 0, 0);
    }
    if (A.has('horns')) for (const sd of [-1, 1]) {
      k.add('head', cyl(0.017, 0.03, 0.09, 8), m.glow, sd * 0.098, 0.262, -0.04, -0.25, 0, -sd * 0.75);
      k.add('head', cyl(0.004, 0.017, 0.09, 8), m.glow, sd * 0.138, 0.335, -0.058, -0.25, 0, -sd * 0.05);
    }
    if (A.has('pack')) {
      this._pack(k);
    } else if (A.has('antenna')) {
      k.add('torso', box(0.09, 0.15, 0.05), m.trim2, 0.07, 0.15, 0.178);
    }
    if (A.has('antenna')) {
      k.add('torso', cyl(0.004, 0.007, 0.6, 6), m.dark, 0.09, 0.5, 0.2, 0.1, 0, 0);
      k.add('torso', sph(0.017, 8, 6), m.glow, 0.09, 0.8, 0.23);
    }
    if (A.has('pads')) for (const [sd, s2] of [['R', 1], ['L', -1]]) {   // 護肩：肩膀上的弧形甲片 + 上臂外側一片
      k.add('ua' + sd, sph(1, 10, 5, 0, PI * 0.56), m.trim, s2 * 0.012, 0.008, 0, 0, 0, -s2 * 0.5, 0.092, 0.084, 0.098);
      k.add('ua' + sd, cyl(1, 1, 0.012, 10), m.trim2, s2 * 0.03, -0.022, 0, 0, 0, -s2 * 0.5, 0.094, 1, 0.1);
      k.add('ua' + sd, cyl(0.072, 0.064, 0.1, 10, true, PI / 2 * s2 - 1.25, 2.5), m.trim, 0, -0.1, 0);
      k.add('ua' + sd, cyl(0.066, 0.062, 0.1, 10, true, PI / 2 * s2 - 1.25, 2.5), m.dark, 0, -0.1, 0);
    }
    if (A.has('stripes')) {   // 發光條：胸前兩道、背後一道、四肢各一圈、頭盔一圈
      for (const s2 of [-1, 1]) k.add('torso', box(0.014, 0.21, 0.012), m.glow, s2 * 0.118, 0.11, -0.158);
      k.add('torso', box(0.2, 0.014, 0.012), m.glow, 0, 0.225, 0.156);
      k.add('torso', box(0.014, 0.16, 0.012), m.glow, 0, 0.1, 0.158);
      const ring = (b, r, y) => k.add(b, cyl(r, r, 0.016, 10, true), m.glow, 0, y, 0);
      for (const sd of ['R', 'L']) { ring('ua' + sd, 0.057, -0.13); ring('fa' + sd, 0.046, -0.15); ring('th' + sd, 0.079, -0.25); ring('sh' + sd, 0.059, -0.2); }
      if (!A.has('hood')) k.add('head', cyl(1, 1, 0.014, 14, true), m.glow, 0, 0.19, 0.004, 0.3, 0, 0, 0.119, 1, 0.136);
    }
    if (A.has('camo')) {   // 偽裝：頭盔和肩上綁幾條碎布
      const strip = [[0.06, 0.262, -0.05, 0.4], [-0.07, 0.25, 0.03, -0.5], [0.02, 0.285, 0.06, 1.2], [-0.03, 0.27, -0.08, 0.1], [0.1, 0.21, 0.04, 0.9], [-0.105, 0.2, -0.03, -0.3], [0.0, 0.23, 0.125, 0.6]];
      strip.forEach(([x, y, z, r], i) => k.add('head', box(0.07, 0.012, 0.026), i % 2 ? m.trim : m.trim2, x, y, z, 0.3 + z * 2, r, -x * 4));
      for (const s2 of [-1, 1]) { k.add('torso', box(0.09, 0.014, 0.03), m.trim2, s2 * 0.15, 0.304, 0.01, 0, 0.5 * s2, -s2 * 0.3); k.add('torso', box(0.07, 0.014, 0.03), m.trim, s2 * 0.12, 0.31, -0.03, 0, -0.7 * s2, -s2 * 0.2); }
    }
    this.backDepth = A.has('pack') ? 0.345 : 0.175;   // 仰躺時背後墊多高
    this.accMeshes = k.flush();
  }

  _pack(k) {
    const m = this.mat, r = 0.03, w = 0.15, h = 0.19, pts = [];
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, cx = Math.cos(a) >= 0 ? w - r : -(w - r), cy = Math.sin(a) >= 0 ? h - r : -(h - r); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    k.add('torso', prism(pts, 0.15, 0.02), m.trim, 0, 0.085, 0.232);
    k.add('torso', box(0.3, 0.07, 0.165), m.trim2, 0, 0.262, 0.23, 0.12, 0, 0);                       // 上蓋
    k.add('torso', plate(0.2, 0.17, 0.05, 0.03), m.trim2, 0, 0.02, 0.325);                           // 前袋
    k.add('torso', cyl(0.052, 0.052, 0.31, 10), m.legs, 0, 0.345, 0.215, 0, 0, PI / 2);              // 睡墊
    for (const s of [-1, 1]) {
      k.add('torso', box(0.02, 0.36, 0.008), m.dark, s * 0.07, 0.09, 0.31);
      k.add('torso', box(0.018, 0.012, 0.13), m.dark, s * 0.1, 0.345, 0.215);
      k.add('torso', cyl(0.036, 0.036, 0.15, 8), m.trim2, s * 0.172, 0.0, 0.225);                    // 側袋
    }
  }

  setColor(c) { this.applySkin(this.skin || 'recruit', c); }
  setThird() { /* 保留給之後用 */ }

  // look：塗裝字串或整個造型物件（記下來，之後換槍時用同一套造型算這把槍的塗裝）
  setWeapon(id, look = this.wskin) {
    const wskin = gunSkin(look, id), key = id + '|' + wskin;
    this.wskin = look;
    if (key === this.gunKey) return;
    if (this.gun) this.gun.visible = false;
    if (!(key in this.guns)) {
      let g = null;
      try { g = buildGun(id, wskin); g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = RECEIVE_SHADOW; } }); this.gunHolder.add(g); }
      catch { g = null; }   // 還沒有這把的模型（例如小刀）→ 空手
      this.guns[key] = g;
    }
    const g = this.gun = this.guns[key], ud = (g && g.userData) || {};
    if (g && ud.model === 'karambit') g.rotation.x = Math.PI;   // 爪刀反手握（刀從小指那一側出來）
    if (g) g.visible = true;
    this.gunKey = key; this.weapon = id;
    // 槍的握法：新模型會在 userData 給 kind / gripL；沒有就照武器代號猜
    this.kind = HOLD[ud.kind] ? ud.kind : id === 'knife' ? 'knife' : id === 'rocket' ? 'launcher' : PISTOLS.has(id) ? 'pistol' : 'rifle';
    if (ud.gripL && ud.gripL.isVector3) this.gripL.copy(ud.gripL);
    else if (this.kind === 'launcher') this.gripL.set(0, -0.06, -0.24);
    else this.gripL.set(0, -0.02, -0.3);
    this.gripLP.set(-0.016, -0.05, -0.012);   // 手槍的輔助手：包在右手外面
    this.gripR.set(0, -0.046, -0.016);   // 槍的原點在虎口，掌心在它的前下方
    this.eyeZ = Number.isFinite(ud.eyeZ) ? ud.eyeZ : 0.2;
    this.muzY = ud.muzzle ? ud.muzzle.y : 0.05;
  }

  // 收到對手位置封包：[x, y, z, yaw, pitch, 武器, 旗標(1=蹲 2=著地)]
  push(s) {
    this.buf.push({ t: performance.now(), x: s[0], y: s[1], z: s[2], yaw: s[3], pitch: s[4], f: s[6] === undefined ? 2 : s[6] });
    if (this.buf.length > 30) this.buf.shift();
  }
  clearBuffer() { this.buf.length = 0; this.crouched = false; this.grounded = true; this.cr = 0; this.speed = 0; this.airT = 0; }

  // ───────── 動作觸發 ─────────
  // 倒地：往水平方向 (dx, dz) 倒（世界座標；不給 = 往後倒）。groundY = 腳下地面的高度，空中被打死時屍體會掉到那裡
  die(dx, dz, groundY = this.pos.y) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    let lx = 0, lz = 1;
    if (Number.isFinite(dx) && Number.isFinite(dz) && Math.hypot(dx, dz) > 1e-4) { const l = Math.hypot(dx, dz); lx = (dx * c - dz * s) / l; lz = (dx * s + dz * c) / l; }
    this.fallX = lx; this.fallZ = lz;
    // 方向偏向背後或側面 → 轉過去仰躺；偏向正面 → 往前趴
    if (lz >= -0.25) { this.fallSign = 1; this.fallYaw = Math.atan2(lx, lz); } else { this.fallSign = -1; this.fallYaw = Math.atan2(-lx, -lz); }
    this.dead = true; this.deadT = 0; this.vy = 0; this.groundY = Math.min(groundY, this.pos.y);
    this.emoteId = null; this.emoteT = 0; this.throwT = -1; this.meleeT = -1;
  }
  revive() {
    this.dead = false; this.deadT = 0; this.deadW = 0; this.emoteId = null; this.emoteT = 0; this.emW = 0; this.throwT = -1; this.meleeT = -1;
    this.kick = 0; this.land = 0; this.air = 0; this.flash = 0;
    for (const m of this._flashMats) m.emissive.setScalar(0);
    this.fall.position.set(0, 0, 0); this.fall.rotation.set(0, 0, 0); this.rig.rotation.set(0, 0, 0);
    this._pose(0);
  }
  fireKick() { this.kick = 1; }
  throwAnim() { if (!this.dead) this.throwT = 0; }
  meleeAnim() { if (!this.dead) this.meleeT = 0; }
  emote(id) {
    if (!EMOTES[id] || this.dead) return false;
    this.emoteId = id; this.emoteT = EMOTES[id].dur; return true;
  }
  hitFlash() { this.flash = 0.12; }

  update(dt) {
    const rt = performance.now() - NET.INTERP_MS;
    const b = this.buf;
    this.justLanded = false;
    if (b.length && !this.dead) {
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
    if (this.dead && this.pos.y > this.groundY) {   // 空中被打死：屍體掉到地上（位置不再跟封包走）
      this.vy -= PLAYER.GRAVITY * dt; this.pos.y = Math.max(this.groundY, this.pos.y + this.vy * dt);
    }
    this.cr += ((this.crouched ? 1 : 0) - this.cr) * Math.min(1, dt * 14);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    const mx = this.pos.x - this.lastPos.x, mz = this.pos.z - this.lastPos.z;
    const sp = Math.hypot(mx, mz) / Math.max(dt, 1e-3);
    this.speed = lerp(this.speed, Math.min(sp, 14), Math.min(1, dt * 10));
    this.lastPos.copy(this.pos);

    // ── 動畫的時間與混合 ──
    const k10 = Math.min(1, dt * 10);
    this.time += dt;
    if (sp > 0.4 && sp < 30 && !this.dead) {   // 移動方向（相對面向），腿往那邊跨
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw), l = Math.hypot(mx, mz);
      this.mdx = lerp(this.mdx, (mx * c - mz * s) / l, k10); this.mdz = lerp(this.mdz, (mx * s + mz * c) / l, k10);
      this.walk += TAU * (0.55 + 0.21 * Math.min(this.speed, 9)) * dt;
    }
    this.move += (smooth((this.speed - 0.25) / 0.9) - this.move) * Math.min(1, dt * 12);
    this.air += ((this.grounded ? 0 : 1) - this.air) * Math.min(1, dt * (this.grounded ? 16 : 9));
    if (this.grounded && !this.wasGround && this.air > 0.5) this.land = 1;   // 落地時膝蓋緩衝一下
    this.wasGround = this.grounded;
    this.land *= Math.exp(-dt * 9); this.kick *= Math.exp(-dt * 15);
    if (this.emoteT > 0) { this.emoteT = Math.max(0, this.emoteT - dt); if (this.emoteT === 0) this.emoteId = null; }
    this.emW += ((this.emoteT > 0.22 ? 1 : 0) - this.emW) * Math.min(1, dt * 9);
    if (this.emW < 0.002 && !this.emoteId) this.emW = 0;
    if (this.throwT >= 0) { this.throwT += dt; if (this.throwT > 0.46) this.throwT = -1; }
    if (this.meleeT >= 0) { this.meleeT += dt; if (this.meleeT > 0.44) this.meleeT = -1; }
    if (this.dead) { this.deadT += dt; this.deadW = smooth(this.deadT / 0.22); }
    this._pose(dt);

    if (this.flash > 0 || this._flashOn) {
      this.flash -= dt; const e = Math.max(0, this.flash) * 4; this._flashOn = e > 0;
      for (const m of this._flashMats) m.emissive.setScalar(e);
    }
  }

  // ───────── 每一幀擺姿勢 ─────────
  _pose() {
    const P = this.P, T = this.time, kind = this.kind, H = HOLD[kind];
    const cr = this.dead ? this.cr * (1 - smooth(this.deadT / 0.45)) : this.cr;   // 蹲著被打死：倒下的過程中身體攤開
    const dw = this.deadW, em = smooth(this.emW) * (1 - dw), aw = (1 - em) * (1 - dw);
    const sp = this.speed * (1 - dw), run = Math.min(1.25, sp / PLAYER.SPEED), mv = this.move * (1 - dw);
    const air = this.air * (1 - dw), ph = this.walk, fwd = -this.mdz, sd = this.mdx;
    const pitch = clamp(this.pitch, -1.45, 1.45) * aw, kick = this.kick * (1 - dw);
    const still = 1 - mv, fs = this.fallSign;

    // ── 軀幹：角度 ──
    let pelX = -0.05 * run * fwd - 0.15 * cr, pelY = -0.1 * run * Math.cos(ph) * fwd * mv, pelZ = Math.sin(T * 0.55) * 0.02 * still * aw;
    let spX = -0.13 * run * fwd - 0.2 * cr + pitch * 0.14, spZ = -0.07 * run * sd - pelZ;
    let chX = -0.05 * cr + pitch * 0.2 + 0.02 * kick + Math.sin(T * 1.7) * 0.008, chZ = 0;
    let blade = H.blade * aw;
    // 脖子根部的位置（受擊判定盒跟著它：蹲下低 0.5）
    const bob = -0.024 * run * Math.cos(2 * (ph - 1.19)) * mv;
    let nx = 0, ny = NECK_H - 0.5 * cr - 0.03 * run * (1 - cr) + bob + Math.sin(T * 1.7) * 0.003 - this.land * 0.08 * (1 - cr * 0.5), nz = -0.012 - 0.02 * cr - 0.02 * run * fwd;
    let hdX = pitch * 0.85 + H.head[0] * aw, hdY = H.head[1] * aw, hdZ = H.head[2] * aw;

    // ── 腳：站姿 → 蹲姿（右膝跪低、右腳墊腳尖），再疊上跑步循環 ──
    const kneel = cr * still;
    P.fL.set(-0.11, 0, lerp(-0.07, -0.12, cr)); P.fR.set(0.12, 0, lerp(0.09, 0.1 + 0.16 * still, cr));
    let fpL = 0, fpR = -0.95 * kneel, fyL = 0.07, fyR = -0.26 * (1 - kneel), frL = 0, frR = 0, liftL = 0, liftR = 0;
    P.kL.set(-0.12, 0, -1); P.kR.set(0.16 + 0.3 * kneel, -0.5 * kneel, -1);
    if (mv > 0.001) {
      const A = clamp(0.05 + sp * 0.052, 0, 0.38) * (1 - 0.35 * cr) * mv, LH = clamp(0.03 + sp * 0.05, 0, 0.34) * (1 - 0.45 * cr) * mv, ST = 0.38;
      for (let i = 0; i < 2; i++) {
        const u = frac(ph / TAU + i * 0.5); let c, lift = 0, toe;
        if (u < ST) { const k = u / ST; c = lerp(0.8, -1, k); toe = k < 0.15 ? 0.22 * (1 - k / 0.15) : k > 0.6 ? -0.55 * (k - 0.6) / 0.4 : 0; }   // 著地：腳往後蹬，最後腳跟離地
        else { const k = (u - ST) / (1 - ST), e = smooth(k); c = lerp(-1, 0.8, e); lift = Math.sin(PI * Math.pow(k, 0.8)); toe = lerp(-0.55 - 0.45 * run, 0.22, e); } // 騰空：後踢 → 往前跨
        const f = i ? P.fR : P.fL;
        f.x += sd * c * A * 0.45; f.z += -fwd * c * A;
        if (i) { fpR += toe * mv * (0.4 + 0.6 * Math.min(1, run * 1.5)); liftR = lift * LH; } else { fpL += toe * mv * (0.4 + 0.6 * Math.min(1, run * 1.5)); liftL = lift * LH; }
      }
      P.fL.x = Math.min(P.fL.x, -0.04); P.fR.x = Math.max(P.fR.x, 0.04);
    }

    // ── 手：沒握槍時的位置（相對肩膀）──
    P.rT.copy(RELAX_R); P.lT.copy(RELAX_L); P.rP.set(0.3, 0, 1); P.lP.set(-0.3, 0, 1); P.rPalm.set(-1, 0, 0); P.lPalm.set(1, 0, 0);
    let wR = aw, wL = aw * (kind === 'knife' ? 0 : 1), stance = 0, gunYaw = 0, gunRoll = 0, gox = 0, goy = 0, goz = 0, gunPitch = 0;
    if (kind === 'knife') { P.lT.set(0.07, -0.1, -0.3); P.lP.set(-0.6, -0.7, 0.4); P.lPalm.set(0.6, 0, -0.8); }

    // ── 表情 ──
    if (em > 0 && this.emoteId) {
      const tau = EMOTES[this.emoteId].dur - this.emoteT;
      stance = em * still;
      if (this.emoteId === 'wave') {
        const w = Math.sin(tau * 10.5);
        P.rT.set(0.17 + 0.11 * w, 0.27 + 0.02 * Math.abs(w), -0.08); P.rP.set(0.7, -0.7, 0.25); P.rPalm.set(0, 0, -1);
        spZ += 0.05 * em; hdZ += -0.1 * em; hdY += -0.12 * em; chZ += 0.04 * em * w;
      } else if (this.emoteId === 'salute') {
        P.rT.set(-0.02, 0.185, -0.045); P.rP.set(1, -0.3, 0.12); P.rPalm.set(-0.25, -0.9, -0.35);
        spX += 0.03 * em; hdX += 0.04 * em;
      } else if (this.emoteId === 'dance') {
        const bt = tau * TAU * 1.9, s = Math.sin(bt / 2), s1 = Math.sin(bt);
        nx += 0.055 * s * em; ny += (-0.05 - 0.035 * Math.cos(bt)) * em; pelY += 0.3 * s * em; pelZ += 0.07 * s * em; blade += -0.4 * s * em; spZ += -0.1 * s * em;
        P.rT.set(0.06, 0.0 + 0.2 * s1, -0.3); P.lT.set(-0.06, 0.0 - 0.2 * s1, -0.3); P.rP.set(0.8, -0.6, 0.2); P.lP.set(-0.8, -0.6, 0.2);
        hdZ += 0.12 * s * em; hdX += 0.07 * Math.cos(bt) * em; hdY += -0.2 * s * em;
        fpL += -0.45 * Math.max(0, s) * stance; fpR += -0.45 * Math.max(0, -s) * stance;
      } else {   // 嘲諷：雙手攤開往自己招
        const bk = Math.max(0, Math.sin(tau * TAU * 1.5));
        P.rT.set(0.22, -0.24 + 0.17 * bk, -0.2 + 0.07 * bk); P.lT.set(-0.22, -0.24 + 0.17 * bk, -0.2 + 0.07 * bk);
        P.rP.set(0.6, -0.5, 0.7); P.lP.set(-0.6, -0.5, 0.7); P.rPalm.set(-0.2, 1, 0.3); P.lPalm.set(0.2, 1, 0.3);
        spX += 0.1 * em; chX += 0.05 * em; hdX += (0.14 + 0.07 * bk) * em; nz += 0.02 * em;
      }
      if (stance > 0) {   // 表情的站姿：敬禮立正、其餘雙腳打開
        const sal = this.emoteId === 'salute', w = sal ? 0.075 : this.emoteId === 'dance' ? 0.18 : 0.15;
        P.fL.x = lerp(P.fL.x, -w, stance); P.fR.x = lerp(P.fR.x, w, stance);
        P.fL.z = lerp(P.fL.z, sal ? 0.01 : -0.03, stance); P.fR.z = lerp(P.fR.z, sal ? 0.01 : 0.04, stance);
        if (sal) { fyL = lerp(fyL, 0.3, stance); fyR = lerp(fyR, -0.3, stance); ny += 0.012 * stance * (1 - cr); }
      }
    }

    // ── 丟東西（左手過肩）──
    if (this.throwT >= 0 && aw > 0) {
      const t = this.throwT, k1 = smooth(t / 0.13), k2 = smooth((t - 0.13) / 0.11), k3 = smooth((t - 0.27) / 0.18);
      P.lT.set(lerp(-0.06, 0.1, k2), lerp(0.21, 0.2, k2), lerp(0.15, -0.5, k2)); P.lP.set(-0.8, lerp(-0.1, -0.7, k2), 0.3); P.lPalm.set(0, lerp(0.5, -0.6, k2), -1);
      wL *= 1 - k1 * (1 - k3);
      blade += (0.35 * k1 * (1 - k2) - 0.3 * k2) * (1 - k3); chX += (0.06 * k1 * (1 - k2) - 0.1 * k2) * (1 - k3);
      goy -= 0.05 * k1 * (1 - k3); gunRoll += 0.25 * k1 * (1 - k3);
    }
    // ── 近戰（右手揮刀；拿槍時就是用槍托砸）──
    if (this.meleeT >= 0 && aw > 0) {
      const t = this.meleeT, k1 = smooth(t / 0.1), k2 = smooth((t - 0.1) / 0.12), k3 = smooth((t - 0.26) / 0.18), o = 1 - k3;
      gox += lerp(0.14 * k1, -0.3, k2) * o; goy += lerp(0.16 * k1, 0.0, k2) * o + (kind === 'knife' ? 0.14 * k1 * o : 0); goz += lerp(0.14 * k1, -0.14, k2) * o;
      gunYaw += lerp(-0.5 * k1, 1.1, k2) * o; gunRoll += lerp(-0.4 * k1, 1.0, k2) * o;
      blade += lerp(-0.3 * k1, 0.55, k2) * o; spX += -0.1 * k2 * o;
      if (kind !== 'pistol') wL *= 1 - k1 * o;
    }

    // ── 倒地 ──
    let dk2 = 0;
    if (this.dead) {
      const t = this.deadT, k1 = smooth(t / 0.2), buckle = Math.sin(PI * Math.min(1, t / 0.5));
      dk2 = smooth((t - 0.2) / 0.38);
      ny += -0.27 * buckle - 0.045 * dk2; nz += 0.05 * fs * buckle;
      spX += (fs > 0 ? -0.22 : 0.18) * buckle + 0.04 * fs * dk2; chX += 0.03 * fs * dk2; spZ += 0.06 * dk2; pelX += -0.04 * fs * dk2;
      hdX = lerp(hdX, fs > 0 ? 0.22 : -0.12, k1); hdY = lerp(hdY, fs > 0 ? 0.6 : 1.05, dk2); hdZ = lerp(hdZ, 0.12, dk2);
      // 手：先被甩出去，再攤在地上
      if (fs > 0) { P.lT.set(lerp(-0.28, -0.2, dk2), lerp(0.12, 0.2, dk2), lerp(-0.26, 0.085, dk2)); P.lP.set(-1, -0.5, lerp(0.5, 0, dk2)); P.lPalm.set(0, 0, -1); }
      else { P.lT.set(lerp(-0.3, -0.42, dk2), lerp(0.1, 0.14, dk2), lerp(0.08, -0.07, dk2)); P.lP.set(-0.3, -1, lerp(0.6, 0, dk2)); P.lPalm.set(0, 0, -1); }
      P.lT.lerp(RELAX_L, 1 - k1);
      wR = 1; wL = (1 - k1) * aw;
      // 腳：膝蓋先軟掉，倒下後攤開
      if (fs > 0) {
        P.fL.lerp(_t.set(-0.2, 0.005, -0.03), dk2); P.fR.lerp(_t.set(0.15, 0.12, -0.04), dk2);
        P.kL.lerp(_t.set(-0.6, 0, -1), dk2); P.kR.lerp(_t.set(1, 0, -0.5), dk2);
        fyL = lerp(fyL, 0.6, dk2); fyR = lerp(fyR, -0.75, dk2); fpL = lerp(fpL, -0.35, dk2); fpR = lerp(fpR, -0.3, dk2); frR = 0.3 * dk2;
      } else {
        P.fL.lerp(_t.set(-0.18, 0.02, 0.005), dk2); P.fR.lerp(_t.set(0.14, 0.07, 0.005), dk2);
        P.kL.lerp(_t.set(-1, 0, -0.2), dk2); P.kR.lerp(_t.set(1, 0, -0.2), dk2);
        fyL = lerp(fyL, 0.35, dk2); fyR = lerp(fyR, -0.4, dk2); fpL = lerp(fpL, -1.2, dk2); fpR = lerp(fpR, -1.15, dk2);
      }
    }

    // ── 騰空：收腿 ──
    if (air > 0.001) {
      P.fL.lerp(_t.set(-0.105, 0, -0.14), air); P.fR.lerp(_t.set(0.115, 0, 0.13), air);
      liftL = lerp(liftL, 0.34 - 0.2 * cr, air); liftR = lerp(liftR, 0.2 - 0.12 * cr, air); fpL = lerp(fpL, -0.35, air); fpR = lerp(fpR, -0.75, air);
      spX += -0.06 * air; ny += -0.01 * air;
    }

    // ── 解軀幹：由脖子的位置反推骨盆 ──
    const pel = this.pelvis, spn = this.spine, ch = this.chest;
    pel.rotation.set(pelX, pelY, pelZ); spn.rotation.set(spX, -pelY * 0.6, spZ); ch.rotation.set(chX, -pelY * 0.4, chZ);
    _qS.multiplyQuaternions(pel.quaternion, spn.quaternion); _qC.multiplyQuaternions(_qS, ch.quaternion); _qCi.copy(_qC).invert();
    _t.set(0, SPINE_Y, 0).applyQuaternion(pel.quaternion); _t2.set(0, CHEST_Y, 0).applyQuaternion(_qS); _t3.set(0, NECK_Y, 0).applyQuaternion(_qC);
    pel.position.set(nx - _t.x - _t2.x - _t3.x, ny - _t.y - _t2.y - _t3.y, nz - _t.z - _t2.z - _t3.z);
    this.waist.rotation.y = blade * 0.5; this.torso.rotation.y = blade;

    // ── 解腿 ──
    for (let i = 0; i < 2; i++) {
      const L = i ? this.legR : this.legL, f = i ? P.fR : P.fL, fp = i ? fpR : fpL, fy = i ? fyR : fyL, lift = i ? liftR : liftL;
      _hip.set(i ? HIP_X : -HIP_X, 0, 0).applyQuaternion(pel.quaternion).add(pel.position);
      // 腳踝高度：腳掌轉了以後最低點剛好貼地
      const s = Math.sin(fp), c = Math.cos(fp), low = Math.min(-SOLE * c - 0.075 * s, -SOLE * c + 0.19 * s);
      _t.set(f.x, (this.dead ? lerp(-low, SOLE, dk2) + f.y : -low + f.y) + lift, f.z);
      ik2(L.up, L.lo, _hip, _t, i ? P.kR : P.kL, THIGH, SHIN, -1);
      _q.setFromEuler(_e.set(fp, fy, i ? frR : frL, 'YXZ'));
      L.end.quaternion.copy(L.lo.quaternion).invert().multiply(_q);
      if (this.dead) {   // 記下鞋底的腳尖、腳跟（rig 座標），倒下時用來避免腳插進地面
        _t2.set(0, -SHIN, 0).applyQuaternion(L.lo.quaternion).add(L.lo.position);
        _sole[i * 2].set(0, -SOLE, -0.19).applyQuaternion(_q).add(_t2); _sole[i * 2 + 1].set(0, -SOLE, 0.075).applyQuaternion(_q).add(_t2);
      }
    }

    // ── 槍：瞄準時的位置與朝向（胸的座標系）──
    _q.setFromEuler(_e.set(pitch * H.pk + kick * H.kick + gunPitch + Math.sin(T * 1.3) * 0.004 * still, gunYaw + Math.sin(ph) * 0.012 * mv, gunRoll + Math.sin(ph) * 0.02 * mv, 'YXZ'));
    _qG.multiplyQuaternions(_qCi, _q);
    _gp.copy(H.g);
    if (kind === 'rifle') _gp.z = -clamp(this.eyeZ + 0.09, 0.2, 0.3); else if (kind === 'launcher') _gp.y = 0.105 - this.muzY;
    _gp.x += gox; _gp.y += goy + Math.cos(ph * 2) * 0.008 * mv; _gp.z += goz + kick * 0.03;
    _gp.applyQuaternion(_qG).add(PIVOT);
    if (em > 0) { const S = kind === 'rifle' || kind === 'launcher' ? STOW_LONG : STOW_SIDE; _gp.lerp(S.p, em); _qG.slerp(S.q, em); }
    if (this.dead) { const D = DEADGUN[fs], k = smooth(this.deadT / 0.5); _gp.lerp(D.p, k); _qG.slerp(D.q, k); }
    P.gunP.copy(_gp); P.gunQ.copy(_qG);
    this.gunHolder.position.copy(_gp); this.gunHolder.quaternion.copy(_qG);

    // ── 解手：肩膀 → 手腕 ──
    _sR.set(SH_X, 0, 0).applyAxisAngle(_Y, blade).add(PIVOT); _sR.z += 0.012 * kick;
    _sL.set(-SH_X, 0, 0).applyAxisAngle(_Y, blade).add(PIVOT); _sL.z -= H.shL * aw; _sL.x += H.shL * 0.5 * aw;
    // 右手握把
    _qH.multiplyQuaternions(_qG, GRIP_R);
    _wR.copy(this.gripR).applyQuaternion(_qG).add(_gp).sub(_t.copy(PALM).applyQuaternion(_qH));
    _t2.copy(P.rT).add(_sR).lerp(_wR, wR); _t3.copy(P.rP).lerp(H.pr, wR);
    if (this.dead) _t3.lerp(_t.set(1, -0.6, fs > 0 ? -0.1 : 0.1), dk2);
    ik2(this.armR.up, this.armR.lo, _sR, _t2, _t3, UARM, FARM, 1);
    freeHand(_q2, this.armR.lo.quaternion, P.rPalm).slerp(_qH, wR);
    this.armR.end.quaternion.copy(this.armR.lo.quaternion).invert().multiply(_q2);
    // 左手托槍；搆不到就沿著槍身往握把滑回來
    _qH.multiplyQuaternions(_qG, kind === 'pistol' ? GRIP_LP : GRIP_L);
    const reach = (UARM + FARM) * 0.985;
    for (let i = 0, s = 1; i < 6; i++, s -= 0.1) {
      if (kind === 'pistol') _wL.copy(this.gripLP); else _wL.copy(this.gripL).multiplyScalar(s);
      _wL.applyQuaternion(_qG).add(_gp).sub(_t.copy(PALM).applyQuaternion(_qH));
      if (kind === 'pistol' || _wL.distanceTo(_sL) <= reach) break;
    }
    _t2.copy(P.lT).add(_sL).lerp(_wL, wL); _t3.copy(P.lP).lerp(H.pl, wL);
    ik2(this.armL.up, this.armL.lo, _sL, _t2, _t3, UARM, FARM, 1);
    freeHand(_q2, this.armL.lo.quaternion, P.lPalm).slerp(_qH, wL);
    this.armL.end.quaternion.copy(this.armL.lo.quaternion).invert().multiply(_q2);

    // ── 頭：瞄準時跟著視線，其餘跟著身體 ──
    _q.setFromEuler(_e.set(hdX, hdY, hdZ, 'YXZ'));
    this.head.quaternion.copy(_qCi).multiply(_q);
    const weld = kind === 'rifle' ? aw : 0;   // 貼腮：頭往槍托靠
    this.head.position.set(0.018 * weld, HEAD_Y - 0.022 * weld, -0.005 - 0.022 * weld);
    if (aw < 1) { _q2.setFromEuler(_e.set(hdX, hdY, hdZ, 'YXZ')); this.head.quaternion.slerp(_q2, 1 - aw); }

    // ── 倒下：整個人繞腳底轉倒、轉向倒下的方向、墊高到背（或胸）貼地 ──
    if (this.dead) {
      const t = this.deadT, u = t / 0.62;
      const k = u < 1 ? Math.pow(u, 2.2) : 1 - 0.035 * Math.sin(Math.min(1, (t - 0.62) / 0.18) * PI);
      const depth = fs > 0 ? this.backDepth : 0.215, delta = Math.asin(clamp((depth - 0.075) / 1.3, 0, 0.5));
      this.rig.rotation.x = fs * (PI / 2 - delta) * k;
      this.fall.rotation.y = this.fallYaw * smooth(t / 0.4);
      // 墊高：至少要讓鞋底不穿地（等於以腳尖／腳跟為支點倒下），倒平之後是設計好的高度
      const th = this.rig.rotation.x, ct = Math.cos(th), st = Math.sin(th); let low = 0;
      for (const p of _sole) low = Math.min(low, p.y * ct - p.z * st);
      const sl = 0.2 * smooth(u);
      this.fall.position.set(this.fallX * sl, Math.max(0.075 * Math.min(1, k), -low), this.fallZ * sl);
    }
  }

  rayHit(ox, oy, oz, dx, dy, dz) {
    if (!this.alive) return null;
    return rayPlayer(ox, oy, oz, dx, dy, dz, this.pos.x, this.pos.y, this.pos.z, this.crouched);
  }

  // 槍口的世界座標（畫對手彈道用）：直接從手上那把槍的位置算
  muzzle(out) {
    const g = this.gun;
    if (g && g.userData.muzzle) {
      this.group.position.copy(this.pos); this.group.rotation.y = this.yaw;
      g.updateWorldMatrix(true, false);
      return out.copy(g.userData.muzzle).applyMatrix4(g.matrixWorld);
    }
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return out.set(this.pos.x - s * cp * 0.9 + c * 0.2, this.pos.y + 1.32 - 0.5 * this.cr + sp * 0.9, this.pos.z - c * cp * 0.9 - s * 0.2);
  }
}
