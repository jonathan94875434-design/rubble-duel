import * as THREE from 'three';
import { buildGun, buildProp } from './gunmodel.js';
import { SKINS, gunSkin } from './skins.js';

// 第一人稱手上的槍＋雙手：獨立場景、獨立鏡頭，畫在世界上面（深度清掉），所以不會插進牆裡。
// 槍是真實比例（js/gunmodel.js），右手握在槍的原點，左手扶在 userData.gripL；
// 前臂從手腕指向畫面外的手肘。所有動畫都是算出來的（沒有骨架、沒有動畫檔）：
//   換彈只看 s.reload 的進度；開槍後的滑套／泵動／拉栓、揮刀、丟投擲物各有自己的計時器。
// 預覽與截圖：dev/viewmodel.html、tests/shot-guns.mjs

const HP = Math.PI / 2, TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const ramp = (t, a, b) => sm((t - a) / (b - a));                         // t 在 a→b 之間從 0 平滑升到 1
const hat = (t, a, b, c, d) => ramp(t, a, b) * (1 - ramp(t, c, d));      // a→b 升起、c→d 落下
const quat = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
const basisQ = (x, y, z) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
const _v = V(), _w = V(), _a = V(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _c = new THREE.Color();
const ID_Q = new THREE.Quaternion();

// ───────── 手的模型 ─────────
// 手指 = 一節一節的膠囊（關節座標直接寫死成握姿），手掌 = 幾個橢圓截面放樣。座標是「手的座標」，再整個擺到槍上
function capsule(a, b, r, seg = 6) {
  const d = V().subVectors(b, a), len = d.length(), g = new THREE.CapsuleGeometry(r, len, 2, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
function loft(rings, seg = 10) {
  const pos = [], idx = [], n = rings.length;
  for (const [c, u, v] of rings) for (let j = 0; j < seg; j++) { const a = (j / seg) * TAU, ca = Math.cos(a), sa = Math.sin(a); pos.push(c[0] + u[0] * ca + v[0] * sa, c[1] + u[1] * ca + v[1] * sa, c[2] + u[2] * ca + v[2] * sa); }
  pos.push(...rings[0][0], ...rings[n - 1][0]);
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) { const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = a + seg, d = b + seg; idx.push(a, b, d, a, d, c); }
  for (let j = 0; j < seg; j++) { const k = (j + 1) % seg; idx.push(n * seg, k, j, n * seg + 1, (n - 1) * seg + j, (n - 1) * seg + k); }
  // 截面的繞向不一定，檢查第一個三角形有沒有朝外，沒有就整個翻面
  const P = (i) => V(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), p0 = P(0);
  if (V().subVectors(P(1), p0).cross(V().subVectors(P(seg + 1), p0)).dot(p0.clone().sub(V(...rings[0][0]))) < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function mergeGeo(list) {
  const gs = list.map((g) => (g.index ? g.toNonIndexed() : g)); let n = 0;
  for (const g of gs) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3); let o = 0;
  for (const g of gs) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  return g;
}
// 握姿資料：fingers 食指→小指各 [指根, 第一關節, 第二關節, 指尖, 粗細]；thumb 同樣四點；
// palm 是手腕→指根的截面 [中心, 長軸, 短軸]；back = 手背朝哪（護指節片貼在那一面）；wristUp = 手腕寬的方向
const POSE = {
  // 右手握手槍式握把（握把直立時的座標，虎口在原點；實際會跟著握把後傾）。食指搭在扳機上
  grip: {
    fingers: [
      [[0.031, -0.01, -0.012], [0.026, -0.012, -0.056], [0.01, -0.014, -0.078], [-0.008, -0.015, -0.076], 0.0092],
      [[0.033, -0.031, -0.01], [0.027, -0.04, -0.054], [-0.014, -0.043, -0.059], [-0.027, -0.042, -0.038], 0.0098],
      [[0.033, -0.051, -0.008], [0.027, -0.06, -0.052], [-0.014, -0.063, -0.057], [-0.027, -0.062, -0.036], 0.0094],
      [[0.031, -0.069, -0.004], [0.026, -0.079, -0.046], [-0.012, -0.082, -0.052], [-0.025, -0.081, -0.034], 0.0085],
    ],
    thumb: [[0.012, -0.04, 0.02], [-0.012, -0.012, 0.012], [-0.028, -0.006, -0.016], [-0.029, -0.004, -0.044], 0.0108],
    palm: [[[0.014, -0.052, 0.075], [0.004, 0.031, 0], [0.022, -0.003, 0]], [[0.02, -0.046, 0.045], [0.003, 0.038, 0], [0.02, 0, 0.004]], [[0.028, -0.04, 0.016], [0, 0.042, 0], [0.014, 0, 0.004]], [[0.033, -0.039, -0.01], [0, 0.04, 0], [0.01, 0, 0.002]]],
    back: [1, 0, 0.15], wristUp: [0, 1, 0],
  },
  // 右手握刀（握柄比握把細，四指全部捲起來、拇指壓在食指上）
  fist: {
    fingers: [
      [[0.026, -0.01, -0.004], [0.022, -0.014, -0.04], [-0.01, -0.016, -0.044], [-0.022, -0.014, -0.022], 0.0095],
      [[0.028, -0.03, -0.004], [0.023, -0.035, -0.041], [-0.01, -0.037, -0.045], [-0.022, -0.035, -0.022], 0.0098],
      [[0.028, -0.05, -0.002], [0.023, -0.055, -0.039], [-0.01, -0.057, -0.043], [-0.022, -0.055, -0.021], 0.0094],
      [[0.026, -0.068, 0.002], [0.022, -0.073, -0.034], [-0.009, -0.075, -0.038], [-0.02, -0.073, -0.019], 0.0085],
    ],
    thumb: [[0.01, -0.036, 0.022], [-0.01, -0.01, 0.012], [-0.026, -0.012, -0.012], [-0.024, -0.022, -0.034], 0.0108],
    palm: [[[0.012, -0.05, 0.072], [0.004, 0.031, 0], [0.022, -0.003, 0]], [[0.018, -0.044, 0.044], [0.003, 0.038, 0], [0.019, 0, 0.004]], [[0.025, -0.04, 0.018], [0, 0.042, 0], [0.013, 0, 0.004]], [[0.029, -0.039, -0.004], [0, 0.04, 0], [0.01, 0, 0.002]]],
    back: [1, 0, 0.15], wristUp: [0, 1, 0],
  },
  // 左手從下面托住護木（原點 = 掌心貼著護木底的那一點，被托的東西沿 Z）。四指從右邊包上來、拇指在左邊朝前
  hold: {
    fingers: [
      [[0.016, -0.008, -0.03], [0.034, 0.01, -0.036], [0.033, 0.033, -0.04], [0.025, 0.049, -0.042], 0.0092],
      [[0.018, -0.009, -0.009], [0.035, 0.01, -0.014], [0.034, 0.035, -0.018], [0.025, 0.052, -0.02], 0.0098],
      [[0.018, -0.009, 0.012], [0.035, 0.009, 0.008], [0.034, 0.033, 0.004], [0.025, 0.049, 0.002], 0.0094],
      [[0.015, -0.008, 0.032], [0.033, 0.007, 0.029], [0.032, 0.027, 0.026], [0.025, 0.041, 0.024], 0.0085],
    ],
    thumb: [[-0.02, -0.02, -0.03], [-0.031, -0.006, -0.048], [-0.034, 0.015, -0.058], [-0.029, 0.035, -0.064], 0.0108],
    palm: [[[-0.052, -0.042, 0.018], [0, 0, 0.03], [0.008, -0.019, 0]], [[-0.03, -0.027, 0.01], [0, 0, 0.038], [0.0074, -0.017, 0]], [[-0.006, -0.016, 0.004], [0, 0, 0.042], [0.006, -0.0134, 0]], [[0.016, -0.011, 0.001], [0, 0, 0.04], [0.0043, -0.0098, 0]]],
    back: [0.39, -0.89, 0], wristUp: [0, 0, 1],
  },
  // 左手包住握手槍的右手（雙手握；座標跟 grip 同一個原點）。四指繞過握把前面壓在右手指上，拇指貼著左側朝前
  support: {
    fingers: [
      [[-0.04, -0.04, -0.028], [-0.032, -0.046, -0.071], [0.018, -0.048, -0.079], [0.045, -0.047, -0.058], 0.0092],
      [[-0.041, -0.059, -0.026], [-0.032, -0.065, -0.07], [0.018, -0.067, -0.078], [0.046, -0.066, -0.056], 0.0098],
      [[-0.041, -0.078, -0.024], [-0.032, -0.084, -0.068], [0.017, -0.086, -0.076], [0.045, -0.085, -0.054], 0.0094],
      [[-0.039, -0.095, -0.02], [-0.031, -0.101, -0.062], [0.014, -0.103, -0.07], [0.04, -0.102, -0.05], 0.0085],
    ],
    thumb: [[-0.03, -0.05, 0.012], [-0.038, -0.038, -0.012], [-0.035, -0.032, -0.04], [-0.033, -0.028, -0.066], 0.0108],
    palm: [[[-0.022, -0.08, 0.056], [0, 0.03, 0.004], [-0.02, 0, 0.008]], [[-0.03, -0.074, 0.026], [0, 0.038, 0], [-0.016, 0, 0.006]], [[-0.038, -0.07, -0.004], [0, 0.04, 0], [-0.013, 0, 0]], [[-0.04, -0.068, -0.028], [0, 0.036, 0], [-0.01, 0, 0.003]]],
    back: [-1, 0, 0.15], wristUp: [0, 1, 0],
  },
};
// → [手套的幾何, 護指節片的幾何]
function handGeo(P) {
  const gs = [], T = (p) => V(p[0], p[1], p[2]);
  for (const f of P.fingers) for (let i = 0; i < 3; i++) gs.push(capsule(T(f[i]), T(f[i + 1]), f[4] * (1 - i * 0.07)));
  const t = P.thumb;
  gs.push(capsule(T(t[0]), T(t[1]), t[4] * 1.32, 7), capsule(T(t[1]), T(t[2]), t[4]), capsule(T(t[2]), T(t[3]), t[4] * 0.92));
  gs.push(capsule(T(t[1]), T(P.fingers[0][0]), 0.0098));                                     // 虎口
  gs.push(loft(P.palm, 10));
  // 護指節片：貼在四個指根外側的一條硬殼
  const b = T(P.back).normalize().multiplyScalar(0.0052), k0 = T(P.fingers[0][0]).add(b), k3 = T(P.fingers[3][0]).add(b);
  return [mergeGeo(gs), capsule(k0, k3, 0.0066, 5)];
}
// 前臂：沿 +Z 從手腕伸向手肘。前面一小段是手套口，後面是袖子（袖口有一圈收邊）
function armGeo() {
  const L = (pts, seg) => { const g = new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg); g.rotateX(HP); g.scale(0.84, 1, 1); return g; };
  return [
    L([[0, -0.03], [0.02, -0.027], [0.029, -0.014], [0.0315, 0.002], [0.033, 0.034], [0, 0.034]], 10),
    L([[0, 0.03], [0.039, 0.03], [0.041, 0.044], [0.0385, 0.05], [0.041, 0.09], [0.0455, 0.17], [0.05, 0.3], [0.053, 0.62]], 10),
    L([[0.0462, 0.176], [0.0478, 0.2]], 10),
  ];
}

// ───────── 槍口火光的貼圖 ─────────
function mkCanvasTex(w, h, draw) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let _star = null, _cone = null;
// 正面：一團亮核＋幾道不規則的尖刺
const starTex = () => _star || (_star = mkCanvasTex(128, 128, (c, w) => {
  c.fillStyle = '#000'; c.fillRect(0, 0, w, w); c.translate(w / 2, w / 2); c.globalCompositeOperation = 'lighter';
  const len = [0.95, 0.5, 0.8, 0.42, 1, 0.55, 0.72, 0.4, 0.88];
  len.forEach((l, i) => {
    const a = (i / len.length) * TAU + (i % 2) * 0.22, g = c.createLinearGradient(0, 0, w * 0.5 * l, 0);
    g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(0.4, 'rgba(255,180,80,0.7)'); g.addColorStop(1, 'rgba(255,110,20,0)');
    c.save(); c.rotate(a); c.fillStyle = g; c.beginPath(); c.moveTo(0, -w * 0.075); c.lineTo(w * 0.5 * l, 0); c.lineTo(0, w * 0.075); c.fill(); c.restore();
  });
  const g = c.createRadialGradient(0, 0, 0, 0, 0, w * 0.3);
  g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.35, 'rgba(255,210,120,0.8)'); g.addColorStop(1, 'rgba(255,120,30,0)');
  c.fillStyle = g; c.fillRect(-w / 2, -w / 2, w, w);
}));
// 側面：從槍口往前噴的一道火舌（貼圖下緣 = 槍口）
const coneTex = () => _cone || (_cone = mkCanvasTex(64, 128, (c, w, h) => {
  c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.globalCompositeOperation = 'lighter';
  c.translate(w / 2, h); c.scale(1, 3.4);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, w * 0.5);
  g.addColorStop(0, 'rgba(255,250,230,1)'); g.addColorStop(0.3, 'rgba(255,200,110,0.85)'); g.addColorStop(0.7, 'rgba(255,120,30,0.3)'); g.addColorStop(1, 'rgba(255,90,10,0)');
  c.fillStyle = g; c.fillRect(-w / 2, -h, w, h);
}));

// ───────── 每把槍在畫面上的位置 ─────────
// 腰射時握把（槍的原點）在鏡頭座標的 [x, y, z, 俯仰, 偏航, 側傾]
const HIP = {
  rifle: [0.14, -0.2, -0.33, 0.03, 0.11, -0.06], pistol: [0.115, -0.105, -0.42, 0.04, 0.13, -0.08], launcher: [0.15, -0.215, -0.24, 0.04, 0.08, -0.02], knife: [0.2, -0.17, -0.4, 0, 0, 0],
  smg: [0.135, -0.19, -0.37, 0.03, 0.11, -0.06], shotgun: [0.14, -0.172, -0.33, 0.03, 0.11, -0.06], gl: [0.14, -0.21, -0.35, 0.03, 0.11, -0.06],
};
// 後座：[往後退, 槍口上抬, 往上跳]（乘上 fire() 給的力道）
const KICK = { rifle: [0.03, 0.035, 0.004], pistol: [0.022, 0.16, 0.012], launcher: [0.07, 0.07, 0.01], knife: [0, 0, 0] };
const ELBOW_R = V(0.36, -0.56, 0.16), ELBOW_L = V(-0.34, -0.6, 0.02), AWAY_L = V(-0.3, -0.52, -0.2);
const REF_R = V(0.16, -0.26, -0.26), REF_L = V(0.06, -0.2, -0.62);   // 手腕平常大概在這裡（手肘的位置是照這個擺的）
// 左手的幾個固定朝向（槍的座標）
const Q_HOLD = quat(0, 0.1, -0.3);                                   // 托護木：掌心朝上、稍微朝右
const Q_SIDE = basisQ(V(0, 0, -1), V(1, 0, 0), V(0, -1, 0));          // 從左邊抓直立的東西（彈匣、拉柄）：掌心貼左面、四指繞到前面
// 刀的基本握法（鏡頭座標）：刀身朝左上、刀面對著鏡頭、刀刃朝前上，手腕在握柄的後下方
const Q_KNIFE = quat(0, 0, -0.5).multiply(basisQ(V(0, 0.643, 0.766), V(0, -0.766, 0.643), V(1, 0, 0)));
const GRAV = 6.5;

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    // 光：跟著世界走（setEnv），預設是晴天
    this.hemi = new THREE.HemisphereLight(0xd6e8ff, 0x7a6f60, 1.1);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    this.scene.add(this.hemi, this.sun);
    // 補光：從鏡頭左後上方打過來的一盞柔光。站在陰影或室內時太陽照不到，沒有它整把槍會黑成剪影
    this.fill = new THREE.DirectionalLight(0xffffff, 0.9); this.fill.position.set(-0.7, 0.9, 1.3); this.scene.add(this.fill);
    this.env = { sunDir: V(0.5, 0.78, 0.38).normalize(), sunColor: new THREE.Color(0xfff1dc), sunIntensity: 2.4, sky: new THREE.Color(0xd6e8ff), ground: new THREE.Color(0x7a6f60), ambient: 1.1, envMap: null };
    this.envTex = mkCanvasTex(64, 32, () => {}); if (this.envTex) { this.envTex.mapping = THREE.EquirectangularReflectionMapping; this._paintEnv(); }
    this.scene.environment = this.envTex;

    this.rig = new THREE.Group(); this.scene.add(this.rig);
    this.holder = new THREE.Group(); this.rig.add(this.holder);
    this.guns = {}; this.gun = null; this.u = null; this.id = null; this.key = null;

    // 手與前臂
    this.mGlove = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.8, metalness: 0 });
    this.mPad = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.55, metalness: 0.1 });
    this.mSleeve = new THREE.MeshStandardMaterial({ color: 0x4d5a48, roughness: 0.94, metalness: 0 });
    this.mBand = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x00ffe0, emissiveIntensity: 2.4, roughness: 0.6 });
    const hand = (poses) => {
      const g = new THREE.Group(); g.userData.pose = {};
      for (const n of poses) { const [a, b] = handGeo(POSE[n]), h = new THREE.Group(); h.add(new THREE.Mesh(a, this.mGlove), new THREE.Mesh(b, this.mPad)); h.visible = false; g.userData.pose[n] = h; g.add(h); }
      this.holder.add(g); return g;
    };
    this.handR = hand(['grip', 'fist']); this.handL = hand(['hold', 'support']);
    const ag = armGeo(), arm = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(ag[0], this.mGlove), new THREE.Mesh(ag[1], this.mSleeve), new THREE.Mesh(ag[2], this.mBand)); g.children[2].visible = false; this.rig.add(g); return g; };
    this.armR = arm(); this.armL = arm();
    this.poseR = 'grip'; this.poseL = 'hold';
    this.held = new THREE.Group(); this.handL.add(this.held); this.props = {};   // 左手拿著的東西（子彈、榴彈、投擲物）

    // 槍口火光
    const fm = (map) => new THREE.MeshBasicMaterial({ map, color: new THREE.Color(2.8, 1.9, 0.85), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false });
    this.flash = new THREE.Group(); this.flash.visible = false; this.holder.add(this.flash);
    this.flashStar = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), fm(starTex())); this.flashStar.position.z = -0.02;
    const cg = new THREE.PlaneGeometry(0.085, 0.26).rotateX(-HP).translate(0, 0, -0.125), cm = fm(coneTex());
    this.flashCone = new THREE.Group(); this.flashCone.add(new THREE.Mesh(cg, cm), new THREE.Mesh(cg, cm)); this.flashCone.children[1].rotation.z = HP;
    this.flash.add(this.flashStar, this.flashCone);
    this.flashLight = new THREE.PointLight(0xffb468, 0, 2.6, 2); this.holder.add(this.flashLight);
    this.flashT = 0; this.flashDur = 0.05;

    // 彈殼（池）
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a04a, metalness: 1, roughness: 0.3 }), hull = new THREE.MeshStandardMaterial({ color: 0xb3261e, metalness: 0, roughness: 0.5 });
    const sg = new THREE.CylinderGeometry(1, 1, 1, 7).rotateX(HP);
    this.shellMat = { brass, hull }; this.shells = [];
    for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(sg, brass); m.visible = false; m.userData = { life: 0, v: V(), w: V() }; this.rig.add(m); this.shells.push(m); }
    this.shellI = 0;

    // 狀態
    this.time = 0; this.kick = 0; this.kickSide = 0; this.sway = new THREE.Vector2(); this.cr = 0;
    this.cyc = -1; this.cycFlag = 0;        // 開槍後的機件動作（秒；-1 = 沒有）
    this.mel = -1; this.melHeavy = false;   // 揮刀
    this.thr = -1; this.thrKind = 'he';     // 丟投擲物
    this.drumAng = 0; this.drumTo = 0; this.loaded = true; this.lastReload = 0; this.rlFlags = 0;
    this.P = { gp: V(), gr: V(), lp: V(), lq: new THREE.Quaternion(), la: 0, rp: V(), rr: V(), mag: 0, magVis: true, bolt: 0, boltRot: 0, pump: 0, cyl: 0, hammer: 0, rk: V(), rkRot: 0, rkVis: true, prop: null, propAt: V(), kr: V() };   // kr：刀在手裡自己轉（蝴蝶刀翻刀、爪刀反手）
    this.setLook('recruit', 0x4d5a48);
  }

  setAspect(a) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  // ───────── 外觀 ─────────
  // look：塗裝字串，或整個造型物件 { w, k, p }（刀型、特殊塗裝要看是哪一把武器，skins.js 的 gunSkin）
  setWeapon(id, look = 'stock') {
    const wskin = gunSkin(look, id), key = id + '|' + wskin;
    if (key === this.key) return;
    if (this.gun) this.gun.visible = false;
    if (!this.guns[key]) { this.guns[key] = buildGun(id, wskin); this.holder.add(this.guns[key]); }
    const g = this.gun = this.guns[key], u = this.u = g.userData;
    g.visible = true; this.key = key; this.id = u.id;
    this.model = u.model || u.id;
    // 刀的握法：爪刀是反手握（刀身從小指那一側出來、往前彎，指環在食指上）→ 把刀在手裡翻過來
    this.kBase = this.model === 'karambit' ? [Math.PI, 0, 0] : [0, 0, 0];
    this.hip = HIP[u.id] || HIP[u.kind] || HIP.rifle; this.kk = KICK[u.kind] || KICK.rifle;
    this.flash.position.copy(u.muzzle); this.flashLight.position.copy(u.muzzle).add(_v.set(0, 0.03, -0.06));
    // 手的握法
    this.poseR = u.kind === 'knife' ? 'fist' : 'grip'; this.poseL = u.hold === 'support' ? 'support' : u.hold === 'none' ? null : 'hold';
    for (const n in this.handR.userData.pose) this.handR.userData.pose[n].visible = n === this.poseR;
    for (const n in this.handL.userData.pose) this.handL.userData.pose[n].visible = n === (this.poseL || 'hold');
    this.baseRq = u.kind === 'knife' ? quat(-HP, 0, 0) : quat(-(u.gripAng || 0), 0, 0);
    this.baseRp = u.kind === 'knife' ? V(0, 0.015, -0.042) : V();
    this.baseLq = this.poseL === 'support' ? quat(-(u.gripAng || 0), 0, 0) : Q_HOLD.clone();
    this.baseLp = this.poseL === 'support' || !u.gripL ? V() : u.gripL.clone();
    // 換槍：所有動作歸零，零件回原位
    this.cyc = this.mel = this.thr = -1; this.kick = 0; this.flashT = 0; this.loaded = true; this.lastReload = 0; this.rlFlags = 0;
    for (const n in u.parts) { u.parts[n].position.copy(u.rest[n].pos); u.parts[n].rotation.copy(u.rest[n].rot); }
    if (u.parts.mag) u.parts.mag.visible = true;
    if (u.parts.drum) this.drumAng = this.drumTo = 0;
  }

  // 袖子 = 造型的身體色（null = 隊伍色）、手套 = 邊條色；有發光色的造型在袖子上多一圈光帶
  setLook(skinId, teamColor = 0x4d5a48) {
    const sk = SKINS[skinId] || SKINS.recruit || {};
    this.mSleeve.color.set(sk.body === null || sk.body === undefined ? teamColor : sk.body);
    this.mGlove.color.set(sk.trim === undefined ? 0x23262d : sk.trim);
    { const c = this.mGlove.color, m = Math.max(c.r, c.g, c.b); if (m < 0.06) c.addScalar(0.06 - m); }   // 太黑的手套提亮一點，不然只剩輪廓
    this.mPad.color.copy(this.mGlove.color).multiplyScalar(0.6);
    for (const a of [this.armR, this.armL]) a.children[2].visible = !!sk.glow;
    if (sk.glow) this.mBand.emissive.set(sk.glow);
  }

  // 世界的光照：sunDir 是「世界座標、指向太陽」；顏色可以是數字或 THREE.Color；envMap 可以是 null（就用天空／地面色自己做一張）
  setEnv(e = {}) {
    const E = this.env, col = (dst, c) => { if (c !== undefined && c !== null) { if (c.isColor) dst.copy(c); else dst.set(c); } };
    if (e.sunDir) E.sunDir.copy(e.sunDir).normalize();
    col(E.sunColor, e.sunColor); col(E.sky, e.skyColor); col(E.ground, e.groundColor);
    if (typeof e.sunIntensity === 'number') E.sunIntensity = e.sunIntensity;
    if (typeof e.ambient === 'number') E.ambient = e.ambient;
    if (e.envMap !== undefined) E.envMap = e.envMap || null;
    this.sun.color.copy(E.sunColor); this.hemi.color.copy(E.sky); this.hemi.groundColor.copy(E.ground); this.hemi.intensity = E.ambient;
    if (E.envMap) this.scene.environment = E.envMap; else { this._paintEnv(); this.scene.environment = this.envTex; }
  }

  // 沒有給環境貼圖時的替代品：天空色 → 地平線 → 地面色的漸層
  _paintEnv() {
    const t = this.envTex; if (!t) return;
    const c = t.image.getContext('2d'), E = this.env, g = c.createLinearGradient(0, 0, 0, 32), css = (col, k) => '#' + _c.copy(col).multiplyScalar(k).getHexString();
    g.addColorStop(0, css(E.sky, 0.8)); g.addColorStop(0.46, css(E.sky, 1)); g.addColorStop(0.5, css(_c.copy(E.sky).lerp(E.ground, 0.5), 1)); g.addColorStop(0.56, css(E.ground, 0.8)); g.addColorStop(1, css(E.ground, 0.35));
    c.fillStyle = g; c.fillRect(0, 0, 64, 32); t.needsUpdate = true;
  }

  // ───────── 觸發 ─────────
  // 開槍：後座、火光、拋殼，之後自動接滑套／泵動／拉栓的動作。big = 霰彈、大口徑
  fire(big) {
    const u = this.u; if (!u) return;
    if (u.kind === 'knife') return this.melee(!!big);
    const A = u.anim || {};
    this.kick = big ? 1.6 : 1; this.kickSide = Math.random() - 0.5;
    this.flashT = this.flashDur = big ? 0.065 : 0.048;
    const s = (big ? 1.5 : 0.85 + Math.random() * 0.4) * (u.kind === 'pistol' ? 0.8 : 1) * (A.cycle === 'rocket' ? 1.8 : 1);
    this.flashStar.rotation.z = Math.random() * TAU; this.flashStar.scale.setScalar(s * (0.85 + Math.random() * 0.3));
    this.flashCone.rotation.z = Math.random() * TAU; this.flashCone.scale.set(s, s, s * (0.8 + Math.random() * 0.5));
    this.cyc = 0; this.cycFlag = 0;
    if (A.cycle === 'auto' || A.cycle === 'slide') this._eject();
    if (A.cycle === 'revolver' || A.cycle === 'drum') this.drumTo += TAU / 6;
    if (A.cycle === 'rocket') this.loaded = false;
  }

  // 揮刀：heavy = false 快砍（約 0.35 秒）、true 突刺（約 0.6 秒）
  melee(heavy) { this.mel = 0; this.melHeavy = !!heavy; }

  // 丟投擲物（約 0.4 秒）：槍放低、左手把東西丟出去、槍舉回來
  throw(kind) { this.thr = 0; this.thrKind = kind || 'he'; }

  _eject(count = 1, fall = false) {
    const u = this.u, A = u.anim || {}, sh = A.shell; if (!sh) return;
    for (let i = 0; i < count; i++) {
      const m = this.shells[this.shellI = (this.shellI + 1) % this.shells.length], d = m.userData;
      this.holder.updateMatrixWorld();
      if (fall) {   // 左輪退殼：六顆從轉輪後面掉出來
        const a = (i / count) * TAU; m.position.copy(this._cylWorld(_v.set(Math.cos(a) * 0.013, Math.sin(a) * 0.013, 0.012)));
        d.v.set((Math.random() - 0.5) * 0.3, -0.1 - Math.random() * 0.3, 0.5 + Math.random() * 0.3).applyQuaternion(this.holder.quaternion);
      } else {
        this.gun.localToWorld(m.position.copy(u.eject));
        d.v.set(1.5 + Math.random() * 0.8, 1.0 + Math.random() * 0.7, 0.25 + Math.random() * 0.45).applyQuaternion(this.holder.quaternion);
      }
      d.w.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
      d.life = fall ? 0.7 : 0.6; m.material = sh[2] === 'hull' ? this.shellMat.hull : this.shellMat.brass;
      m.scale.set(sh[0], sh[0], sh[1]); m.quaternion.copy(this.holder.quaternion); m.visible = true;
    }
  }
  // 轉輪後端面上的一點（轉輪自己的座標，原點在端面中心）→ 鏡頭座標
  _cylWorld(p) { const u = this.u, c = u.parts.cyl; return c.localToWorld(p.add(u.anim.cylFace).sub(c.position)); }

  // 左手要拿的小道具（子彈、榴彈、裝彈器、投擲物），用到才建
  _prop(name) {
    if (this.props[name]) return this.props[name];
    let g;
    const cyl = (r, l, mat, z = 0) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 8).rotateX(HP).translate(0, 0, z), mat);
    if (name === 'shell') { g = new THREE.Group(); g.add(cyl(0.0098, 0.044, this.shellMat.hull, -0.006), cyl(0.0102, 0.012, this.shellMat.brass, 0.022)); }
    else if (name === 'round') { g = new THREE.Group(); g.add(cyl(0.0192, 0.05, this.shellMat.brass, 0.012), new THREE.Mesh(new THREE.SphereGeometry(0.0192, 8, 5).scale(1, 1, 1.5).translate(0, 0, -0.013), new THREE.MeshStandardMaterial({ color: 0x4c5a34, roughness: 0.6, metalness: 0.2 }))); }
    else if (name === 'loader') { g = new THREE.Group(); g.add(cyl(0.017, 0.006, this.mPad, 0.02), cyl(0.005, 0.014, this.mPad, 0.03)); for (let i = 0; i < 6; i++) { const a = HP + (i / 6) * TAU, m = cyl(0.0048, 0.03, this.shellMat.brass, 0.002); m.position.set(Math.cos(a) * 0.0133, Math.sin(a) * 0.0133, 0); g.add(m); } }
    else g = buildProp(name);
    g.visible = false; this.held.add(g); return (this.props[name] = g);
  }

  // ───────── 每幀 ─────────
  // s: { ads, walkPhase, moving, reload, draw, dx, dy, scoped, dip, vy, crouch, lit, camQuat, loaded }（都可以不給）
  update(dt, s = {}) {
    const u = this.u; if (!u) return;
    const A = u.anim || {}, P = this.P, knife = u.kind === 'knife';
    const ads = knife ? 0 : sm(clamp(s.ads || 0)), draw = s.draw === undefined ? 1 : clamp(s.draw), rl = clamp(s.reload || 0), moving = clamp(s.moving || 0), wp = s.walkPhase || 0, lit = s.lit === undefined ? 1 : clamp(s.lit);
    this.time += dt;
    this.kick *= Math.exp(-dt * 13);
    this.cr = lerp(this.cr, s.crouch ? 1 : 0, Math.min(1, dt * 10));
    this.sway.x = lerp(this.sway.x, clamp((s.dx || 0) * 0.02, -1, 1), Math.min(1, dt * 10));
    this.sway.y = lerp(this.sway.y, clamp((s.dy || 0) * 0.02, -1, 1), Math.min(1, dt * 10));
    if (this.cyc >= 0) this.cyc += dt;
    if (this.mel >= 0) { this.mel += dt; if (this.mel > (this.melHeavy ? 0.6 : 0.36)) this.mel = -1; }
    if (this.thr >= 0) { this.thr += dt; if (this.thr > 0.42) this.thr = -1; }
    if (rl > 0 && this.cyc >= 0 && (A.cycle === 'pump' || A.cycle === 'bolt')) this.cyc = -1;   // 開始換彈就不拉栓了
    if (rl < this.lastReload - 0.5 || (rl > 0 && this.lastReload === 0)) this.rlFlags = 0;
    if (this.lastReload > 0.9 && rl === 0) this.loaded = true;
    this.lastReload = rl;
    this.drumAng = lerp(this.drumAng, this.drumTo, Math.min(1, dt * 22));

    // ── 這一幀的動作：先歸零，再讓各個動畫往裡面加 ──
    P.gp.set(0, 0, 0); P.gr.set(0, 0, 0); P.lp.copy(this.baseLp); P.lq.copy(this.baseLq); P.la = this.poseL ? 0 : 1; P.rp.set(0, 0, 0); P.rr.set(0, 0, 0);
    P.mag = 0; P.magVis = true; P.bolt = 0; P.boltRot = 0; P.pump = 0; P.cyl = 0; P.hammer = 0; P.rk.set(0, 0, 0); P.rkRot = 0; P.prop = null;
    P.rkVis = s.loaded === undefined ? this.loaded : !!s.loaded;
    P.kr.set(0, 0, 0);
    if (knife && this.model === 'butterfly' && draw < 1) P.kr.x -= (1 - sm(draw)) * TAU * 1.5;   // 蝴蝶刀拿出來的時候翻開（轉一圈半）
    if (rl > 0) this._reload(rl, u, A, P);
    else if (this.cyc >= 0) this._cycle(this.cyc, u, A, P);
    if (this.mel >= 0) this._melee(this.mel, P);
    if (this.thr >= 0) this._throw(this.thr, P);

    // ── 槍身的位置：腰射 ↔ 瞄準，加上晃動、後座、舉槍、動畫 ──
    const h = this.holder, hip = this.hip, K = this.kk, k = this.kick, hipW = 1 - ads;
    const bob = moving * (1 - ads * 0.88), bx = Math.sin(wp) * 0.011 * bob, by = -Math.abs(Math.cos(wp)) * 0.011 * bob;
    const dr = 1 - sm(draw), air = ((s.dip || 0) * 0.25 + clamp((s.vy || 0) * 0.004, -0.03, 0.03)) * hipW, cr = this.cr * hipW;
    const breath = Math.sin(this.time * 1.7) * 0.0012 * (1 - ads * 0.7), aw = 1 - ads * 0.5;
    h.position.set(
      lerp(hip[0], 0, ads) + bx - this.sway.x * 0.012 * aw + P.gp.x * aw - cr * 0.012 + k * this.kickSide * 0.004,
      lerp(hip[1], -u.sightY, ads) + by + this.sway.y * 0.012 * aw - dr * 0.3 - air + P.gp.y * aw + breath + cr * 0.006 + k * K[2] * hipW,
      lerp(hip[2], -u.eyeZ, ads) + P.gp.z * aw + k * K[0] * (1 - ads * 0.35) + cr * 0.015,
    );
    h.rotation.set(
      hip[3] * hipW + k * K[1] * (1 - ads * 0.6) - dr * 0.95 + P.gr.x * aw + this.sway.y * 0.03 * aw + by * 0.8,
      hip[4] * hipW - this.sway.x * 0.06 * aw + P.gr.y * aw + k * this.kickSide * 0.02 + dr * 0.25,
      hip[5] * hipW - this.sway.x * 0.05 * aw + P.gr.z * aw + bx * 1.6 - cr * 0.1 - dr * 0.35,
    );
    if (knife) h.quaternion.multiply(Q_KNIFE);
    if (knife && this.gun) { const b = this.kBase || [0, 0, 0]; this.gun.rotation.set(b[0] + P.kr.x, b[1] + P.kr.y, b[2] + P.kr.z); }
    h.updateMatrixWorld(true);

    // ── 會動的零件 ──
    const p = u.parts, r = u.rest;
    if (p.mag) { p.mag.position.copy(r.mag.pos); if (A.magDir) p.mag.position.addScaledVector(A.magDir, P.mag); p.mag.visible = P.magVis; }
    if (p.bolt) { p.bolt.position.copy(r.bolt.pos); p.bolt.position.z += P.bolt * (A.boltTravel || 0.04); p.bolt.rotation.z = P.boltRot * (A.boltLift || 0); }
    if (p.pump) p.pump.position.z = r.pump.pos.z + P.pump * (A.pumpTravel || 0.08);
    if (p.cyl) p.cyl.rotation.z = P.cyl * (A.cylOpen || 1.5);
    if (p.drum) p.drum.rotation.z = this.drumAng;
    if (p.hammer) p.hammer.rotation.x = P.hammer * 0.75;
    if (p.rocket) { p.rocket.position.copy(r.rocket.pos).add(P.rk); p.rocket.rotation.x = P.rkRot; p.rocket.visible = P.rkVis; }
    if (p.aim) { const on = u.scope === 'glass' && ads > 0.72; p.aim.visible = on; p.lens.visible = !on; }

    // ── 手 ──
    const R = this.handR, L = this.handL;
    R.position.copy(this.baseRp).add(P.rp); R.quaternion.copy(this.baseRq); if (P.rr.lengthSq() > 0) R.quaternion.premultiply(_q.setFromEuler(_e.set(P.rr.x, P.rr.y, P.rr.z)));
    L.position.copy(P.lp); L.quaternion.copy(P.lq);
    if (P.la > 0) { h.worldToLocal(_v.copy(AWAY_L)); L.position.lerp(_v, sm(P.la)); }
    L.visible = P.la < 0.98;
    if (P.prop) this._prop(P.prop).position.copy(P.propAt);
    for (const n in this.props) this.props[n].visible = n === P.prop && L.visible;
    h.updateMatrixWorld(true);
    this._arm(this.armR, R, POSE[this.poseR], ELBOW_R, REF_R, true);
    this._arm(this.armL, L, POSE[this.poseL || 'hold'], ELBOW_L, REF_L, L.visible);

    // ── 火光、彈殼 ──
    this.flashT -= dt; const f = clamp(this.flashT / this.flashDur);
    this.flash.visible = this.flashT > 0; this.flashLight.intensity = this.flashT > 0 ? 1.6 * (0.4 + 0.6 * f) : 0;
    for (const m of this.shells) {
      const d = m.userData; if (d.life <= 0) continue;
      d.life -= dt; if (d.life <= 0) { m.visible = false; continue; }
      d.v.y -= GRAV * dt; m.position.addScaledVector(d.v, dt);
      m.rotateX(d.w.x * dt); m.rotateY(d.w.y * dt); m.rotateZ(d.w.z * dt);
    }

    // ── 光：太陽方向轉進鏡頭座標，強度看玩家有沒有被太陽照到 ──
    const E = this.env; _q.identity(); if (s.camQuat) _q.copy(s.camQuat);
    _e.setFromQuaternion(_q, 'XYZ'); this.scene.environmentRotation.set(-_e.x, -_e.y, -_e.z, 'XYZ');   // 環境反射跟著世界轉
    _q.invert();
    this.sun.position.copy(E.sunDir).applyQuaternion(_q).multiplyScalar(5); this.sun.intensity = E.sunIntensity * lit;
    this.hemi.position.set(0, 1, 0).applyQuaternion(_q);
    this.scene.environmentIntensity = lerp(0.6, 1, lit);
    const skyV = s.sky === undefined ? 1 : clamp(s.sky);              // 頭上看得到多少天空（室內 → 0）
    this.hemi.intensity = E.ambient * (0.9 + 0.7 * skyV);
    this.fill.color.copy(E.sky).lerp(_c.set(0xffffff), 0.45); this.fill.intensity = E.ambient * (1.0 + 0.9 * skyV);

    this.rig.visible = !(s.scoped && (s.ads || 0) > 0.8);
  }

  // 前臂：從手腕（手的座標 → 鏡頭座標）指向畫面外的手肘
  _arm(arm, hand, pose, elbow, ref, show) {
    arm.visible = show; if (!show) return;
    const w = pose.palm[0];
    hand.localToWorld(arm.position.set(w[0][0], w[0][1], w[0][2]));
    _q2.copy(this.holder.quaternion).multiply(hand.quaternion);
    arm.up.set(pose.wristUp[0], pose.wristUp[1], pose.wristUp[2]).applyQuaternion(_q2);
    // 手往前伸、往旁邊移的時候手肘跟著過去一些，前臂才不會被拉得太長
    _a.copy(arm.position).sub(ref); _a.x *= 0.55; _a.y *= 0.55; _a.z *= 0.75;
    arm.lookAt(_a.add(elbow));
  }

  // ───────── 換彈（p = 0..1 的進度）─────────
  _reload(p, u, A, P) {
    const type = A.reload;
    if (type === 'mag' && u.hold === 'support') this._rlPistol(p, u, A, P);
    else if (type === 'mag') this._rlMag(p, u, A, P, 1);
    else if (type === 'bolt') { this._rlMag(Math.min(1, p / 0.7), u, A, P, 0); this._bolt((p - 0.68) / 0.3, u, A, P); P.gr.z -= 0.1 * hat(p, 0.66, 0.72, 0.94, 1); }
    else if (type === 'shell') this._rlShell(p, u, A, P);
    else if (type === 'revolver') this._rlRevolver(p, u, A, P);
    else if (type === 'rocket') this._rlRocket(p, u, A, P);
    else if (type === 'break') this._rlBreak(p, u, A, P);
  }

  // 彈匣槍：左手抓彈匣往下抽 → 離開畫面換一個 → 插回去 → 拉拉柄
  _rlMag(p, u, A, P, rack) {
    const tilt = hat(p, 0, 0.1, rack ? 0.9 : 0.86, 1), under = A.magHold === 'under';
    const at = hat(p, 0.02, 0.13, 0.74, 0.81), out = hat(p, 0.15, 0.3, 0.56, 0.72), away = hat(p, 0.27, 0.38, 0.47, 0.58), seat = hat(p, 0.7, 0.725, 0.725, 0.78);
    P.gp.set(-0.05 * tilt, 0.1 * tilt + seat * 0.008, 0.0 * tilt); P.gr.set(0.32 * tilt + seat * 0.02, 0.25 * tilt, -0.6 * tilt);
    const D = (under ? 0.2 : 0.24) * out;
    P.mag = D; P.magVis = away < 0.6; P.la = away;
    _v.copy(A.magGrab).addScaledVector(A.magDir, D);
    P.lp.lerp(_v, at); P.lq.slerp(under ? Q_HOLD : Q_SIDE, at);
    if (rack) {
      const ab = hat(p, 0.75, 0.83, 0.925, 0.99), pull = hat(p, 0.84, 0.895, 0.905, 0.925);
      P.bolt = pull; _v.copy(A.boltGrab); _v.z += pull * (A.boltTravel || 0.05);
      P.lp.lerp(_v, ab); P.lq.slerp(Q_SIDE, ab);
      P.gp.z += pull * 0.012; P.gr.x += pull * 0.03;
    }
  }

  // 手槍：左手順著握把把彈匣抽出來 → 換一個推回去 → 拉滑套
  _rlPistol(p, u, A, P) {
    const tilt = hat(p, 0, 0.1, 0.9, 1), out = hat(p, 0.08, 0.26, 0.5, 0.66), away = hat(p, 0.24, 0.36, 0.42, 0.54), seat = hat(p, 0.64, 0.665, 0.665, 0.72);
    const top = hat(p, 0.7, 0.79, 0.9, 0.98), pull = hat(p, 0.8, 0.86, 0.87, 0.895);
    P.gp.set(-0.04 * tilt, 0.085 * tilt + seat * 0.01, 0.03 * tilt); P.gr.set(0.38 * tilt, 0.12 * tilt, -0.55 * tilt);
    const D = 0.15 * out; P.mag = D; P.magVis = away < 0.6; P.la = away;
    P.lp.addScaledVector(A.magDir, D + 0.012 * hat(p, 0.02, 0.1, 0.66, 0.72));
    // 左手上去捏住滑套後端往後拉
    P.lp.add(_v.set(0.012, 0.078, 0.05 + pull * (A.boltTravel || 0.04)).multiplyScalar(top)); P.lq.premultiply(_q.setFromEuler(_e.set(0.25 * top, 0, -0.5 * top)));
    P.bolt = pull; P.gr.x += pull * 0.05;
  }

  // 霰彈槍：槍翻過來，左手一發一發塞進去，最後泵一下
  _rlShell(p, u, A, P) {
    const tilt = hat(p, 0, 0.1, 0.84, 0.94), n = 4;
    P.gp.set(-0.05 * tilt, 0.06 * tilt, 0.03 * tilt); P.gr.set(0.3 * tilt, 0.1 * tilt, -0.95 * tilt);
    if (p < 0.82) {
      const c = clamp((p - 0.1) / 0.72) * n, cf = p < 0.1 ? 0 : c - Math.min(n - 1, Math.floor(c));
      const near = p < 0.1 ? 0 : hat(cf, 0, 0.36, 0.7, 1), push = ramp(cf, 0.36, 0.66), leave = ramp(p, 0.02, 0.1);
      _v.copy(A.port); _v.z += 0.05 - push * 0.055;                 // 手托著彈，從裝彈口後面往前推
      P.lp.lerp(_v, leave); P.la = leave * (1 - near) * 0.8; P.gp.y += 0.006 * hat(cf, 0.62, 0.7, 0.7, 0.8);
      if (near > 0 && cf < 0.68) { P.prop = 'shell'; P.propAt.set(0.002, 0.016, -0.03); }
    } else P.la = 1 - ramp(p, 0.82, 0.88);                          // 塞完了：手回到護木
    const pump = hat(p, 0.89, 0.93, 0.94, 0.98); P.pump = pump; P.lp.z += pump * (A.pumpTravel || 0.08); P.gp.z += pump * 0.015;
  }

  // 左輪：甩開轉輪 → 槍口朝上倒殼 → 槍放平，左手拿裝彈器從後面一次推六發進去 → 甩回去
  _rlRevolver(p, u, A, P) {
    const open = hat(p, 0.05, 0.14, 0.78, 0.86), up = hat(p, 0.12, 0.2, 0.28, 0.4), load = hat(p, 0.3, 0.42, 0.84, 0.96), near = hat(p, 0.44, 0.58, 0.7, 0.78), push = ramp(p, 0.6, 0.67);
    P.cyl = open;
    P.gp.set(-0.05 * load - 0.02 * up, 0.06 * load + 0.06 * up, 0.05 * up + 0.02 * load); P.gr.set(0.95 * up + 0.1 * load, -0.34 * load, 0.2 * up - 0.12 * load);
    if (p > 0.24 && !(this.rlFlags & 1)) { this.rlFlags |= 1; this._eject(6, true); }
    P.lp.add(_v.set(-0.008, 0.05, -0.045).multiplyScalar(hat(p, 0.02, 0.08, 0.2, 0.28)));       // 左手拇指把轉輪頂出去
    P.la = hat(p, 0.24, 0.34, 0.42, 0.52);                                                       // 離開畫面拿裝彈器
    if (near > 0) {
      // 裝彈器握在左手座標的 (0,-0.07,-0.03)，要對到（甩開後的）轉輪後端面，先停在後面一點再往前推
      u.parts.cyl.rotation.z = open * (A.cylOpen || 1.5); u.parts.cyl.updateMatrix();
      _v.set(0, 0, 0.07 - push * 0.062).add(A.cylFace).sub(u.parts.cyl.position).applyMatrix4(u.parts.cyl.matrix);
      _v.sub(_w.set(0, -0.07, -0.03).applyQuaternion(P.lq));
      P.lp.lerp(_v, near);
      if (p < 0.69) { P.prop = 'loader'; P.propAt.set(0, -0.07, -0.03); }
    }
    P.lp.add(_v.set(-0.03, 0.05, -0.03).multiplyScalar(hat(p, 0.72, 0.79, 0.85, 0.93)));          // 把轉輪推回去
  }

  // 火箭筒：筒口抬起來朝左，左手托著新的彈頭從畫面外拿上來、對準筒口塞進去
  _rlRocket(p, u, A, P) {
    const tilt = hat(p, 0, 0.14, 0.82, 0.98), come = ramp(p, 0.2, 0.52), ins = ramp(p, 0.6, 0.74), seat = hat(p, 0.72, 0.745, 0.745, 0.8);
    P.gp.set(-0.06 * tilt, 0.03 * tilt, 0.1 * tilt + seat * 0.012); P.gr.set(0.34 * tilt, 0.42 * tilt, -0.25 * tilt);
    P.rkVis = this.loaded = p >= 0.2;
    const d = A.insert || 0.42, o = 1 - come;
    P.rk.set(-0.2 * o, -0.62 * o, -(d - 0.3) * (1 - ins) - 0.05 * o); P.rkRot = -0.6 * o;
    // 左手：先離開畫面，之後一路托在彈頭最粗的地方，推到底再回去扶筒身
    P.la = hat(p, 0.03, 0.12, 0.15, 0.21);
    _v.copy(u.rest.rocket.pos).add(P.rk).add(_w.set(0, -0.044, -0.1));
    P.lp.lerp(_v, ramp(p, 0.1, 0.16) * (1 - ramp(p, 0.78, 0.9)));
  }

  // 榴彈槍：轉輪甩開，左手一發一發塞進去，甩回去
  _rlBreak(p, u, A, P) {
    const tilt = hat(p, 0, 0.1, 0.86, 0.98), open = hat(p, 0.05, 0.16, 0.78, 0.87), n = 3;
    P.cyl = open; P.gp.set(-0.03 * tilt, 0.1 * tilt, 0.02 * tilt); P.gr.set(0.12 * tilt, -0.16 * tilt, 0.12 * tilt);
    P.lp.add(_v.set(-0.02, 0.02, 0.06).multiplyScalar(hat(p, 0.02, 0.07, 0.12, 0.16)));       // 先把轉輪推開
    if (p < 0.78) {
      const c = clamp((p - 0.18) / 0.58) * n, ci = Math.min(n - 1, Math.floor(c)), cf = p < 0.18 ? 0 : c - ci;
      const near = p < 0.18 ? 0 : hat(cf, 0, 0.45, 0.75, 1), push = ramp(cf, 0.45, 0.72), leave = ramp(p, 0.12, 0.18), a = HP + (ci / 6) * TAU + (A.cylOpen || 1.5);
      // 甩開之後的轉輪後端面上，這一發要進去的那個膛室
      u.parts.cyl.rotation.z = open * (A.cylOpen || 1.5); u.parts.cyl.updateMatrix();
      _v.set(0, 0, 0.1 - push * 0.07).add(A.cylFace).sub(u.parts.cyl.position).applyMatrix4(u.parts.cyl.matrix);
      _v.y -= 0.02;
      P.lp.lerp(_v, leave); P.la = leave * (1 - near); P.gp.y += 0.006 * hat(cf, 0.64, 0.72, 0.72, 0.82);
      if (near > 0 && cf < 0.7) { P.prop = 'round'; P.propAt.set(0, 0.02, -0.005); }
      if (p >= 0.18) this.drumTo = this.drumAng = (ci + ramp(cf, 0.8, 1)) * (TAU / 6);
    } else { P.la = 1 - ramp(p, 0.78, 0.86); P.lp.add(_v.set(-0.03, 0.02, 0.05).multiplyScalar(hat(p, 0.8, 0.84, 0.87, 0.93))); }
  }

  // 拉栓（x = 0..1）：右手離開握把 → 抬起拉柄 → 往後拉（拋殼）→ 推回去 → 壓下 → 回握把
  _bolt(x, u, A, P) {
    if (x <= 0 || x >= 1) return;
    const on = hat(x, 0, 0.2, 0.84, 1), lift = hat(x, 0.2, 0.32, 0.7, 0.82), back = hat(x, 0.32, 0.47, 0.52, 0.68);
    P.boltRot = lift; P.bolt = back;
    if (back > 0.9 && !(this.cycFlag & 1)) { this.cycFlag |= 1; this._eject(); }
    // 拉柄球現在的位置（槍的座標）
    const piv = u.rest.bolt.pos, a = lift * (A.boltLift || 1), kx = A.boltKnob.x - piv.x, ky = A.boltKnob.y - piv.y;
    _v.set(piv.x + kx * Math.cos(a) - ky * Math.sin(a), piv.y + kx * Math.sin(a) + ky * Math.cos(a), A.boltKnob.z + back * (A.boltTravel || 0.08));
    // 右手掌心（手的座標）要對到球上
    _w.set(0.004, -0.03, -0.034).applyQuaternion(_q.setFromEuler(_e.set(0.1 * on, 0, 0.75 * on)).multiply(this.baseRq));
    P.rp.copy(_v).sub(_w).multiplyScalar(on); P.rr.set(0.1 * on, 0, 0.75 * on);
    P.gr.z -= 0.06 * on; P.gr.x += 0.03 * on + back * 0.02; P.gp.z += back * 0.012;
  }

  // ───────── 開槍後的機件動作（t = 開槍後幾秒）─────────
  _cycle(t, u, A, P) {
    const c = A.cycle;
    if (c === 'slide') { P.bolt = hat(t, 0, 0.03, 0.035, 0.09); if (t > 0.1) this.cyc = -1; }
    else if (c === 'auto') { if (A.recip) P.bolt = hat(t, 0, 0.025, 0.03, 0.075); if (t > 0.09) this.cyc = -1; }
    else if (c === 'pump') {
      const back = hat(t, 0.17, 0.3, 0.33, 0.46); P.pump = back; P.lp.z += back * (A.pumpTravel || 0.08);
      P.gp.z += back * 0.018; P.gr.x += back * 0.04; P.gr.z -= back * 0.05;
      if (t > 0.29 && !(this.cycFlag & 1)) { this.cycFlag |= 1; this._eject(); }
      if (t > 0.5) this.cyc = -1;
    } else if (c === 'bolt') { this._bolt((t - 0.22) / 0.72, u, A, P); if (t > 0.96) this.cyc = -1; }
    else if (c === 'revolver') { P.hammer = hat(t, 0.12, 0.3, 9, 10); if (t > 0.34) { P.hammer = 1; } if (t > 5) this.cyc = -1; }
    else if (t > 0.3) this.cyc = -1;
  }

  // ───────── 揮刀 ─────────
  _melee(t, P) {
    const m = this.model;
    if (m === 'karambit') {
      if (!this.melHeavy) {   // 爪刀快砍：手先往右下收，再由右下往左上「勾」過去，手腕翻著讓彎刀畫一道弧
        const wind = hat(t, 0, 0.05, 0.06, 0.1), hook = hat(t, 0.06, 0.15, 0.2, 0.36);
        P.gp.set(0.07 * wind - 0.25 * hook, -0.06 * wind + 0.12 * hook, 0.02 * wind - 0.1 * hook);
        P.gr.set(0.25 * wind - 0.35 * hook, -0.3 * wind + 0.55 * hook, -0.55 * wind + 1.35 * hook);
        P.kr.z += 0.5 * hook;
      } else {                // 爪刀重擊：反手舉高，往前下方用力扎下去
        const lift = hat(t, 0, 0.12, 0.14, 0.22), stab = hat(t, 0.14, 0.24, 0.34, 0.6);
        P.gp.set(-0.02 * lift - 0.07 * stab, 0.11 * lift - 0.08 * stab, 0.06 * lift - 0.24 * stab);
        P.gr.set(0.45 * lift - 0.7 * stab, 0.05 * stab, 0.15 * lift + 0.1 * stab);
      }
      return;
    }
    if (m === 'butterfly') {
      if (!this.melHeavy) {   // 蝴蝶刀快砍：往前一戳，刀在手裡沿著刀身轉一圈
        const jab = hat(t, 0.02, 0.1, 0.16, 0.36);
        P.gp.set(-0.06 * jab, 0.03 * jab, -0.22 * jab); P.gr.set(-0.45 * jab, 0.12 * jab, 0.15 * jab);
        P.kr.z += sm(clamp((t - 0.02) / 0.26)) * TAU;
      } else {                // 蝴蝶刀重擊：先在手上前後翻兩圈，再刺出去
        const spin = sm(clamp(t / 0.3)), stab = hat(t, 0.28, 0.38, 0.46, 0.6);
        P.kr.x -= spin * TAU * 2;
        P.gp.set(-0.02 * (1 - spin) * spin * 4 - 0.1 * stab, 0.04 * spin * (1 - spin) * 4 + 0.06 * stab, -0.3 * stab); P.gr.set(-0.9 * stab, 0.05 * stab, -0.2 * stab);
      }
      return;
    }
    if (m === 'bowie' && !this.melHeavy) {   // 獵刀快砍：從右上方往左下劈（比較大力、比較慢收）
      const wind = hat(t, 0, 0.08, 0.09, 0.14), chop = hat(t, 0.09, 0.19, 0.24, 0.36);
      P.gp.set(0.06 * wind - 0.22 * chop, 0.12 * wind - 0.12 * chop, 0.03 * wind - 0.12 * chop); P.gr.set(0.5 * wind - 1.1 * chop, -0.2 * wind + 0.5 * chop, -0.3 * wind + 0.6 * chop);
      return;
    }
    if (!this.melHeavy) {   // 快砍：先往右上帶一下，再橫掃到左下
      const wind = hat(t, 0, 0.06, 0.07, 0.12), cut = hat(t, 0.07, 0.17, 0.22, 0.36);
      P.gp.set(0.05 * wind - 0.27 * cut, 0.04 * wind - 0.03 * cut, 0.02 * wind - 0.13 * cut); P.gr.set(-0.1 * wind - 0.55 * cut, -0.35 * wind + 0.75 * cut, -0.35 * wind + 0.9 * cut);
    } else {                // 突刺：往後收，直直往前捅出去，停一下再收回來
      const pull = hat(t, 0, 0.13, 0.14, 0.22), stab = hat(t, 0.14, 0.24, 0.36, 0.6);
      P.gp.set(0.02 * pull - 0.11 * stab, -0.02 * pull + 0.07 * stab, 0.1 * pull - 0.3 * stab); P.gr.set(0.15 * pull - 0.95 * stab, 0.05 * stab, -0.1 * pull - 0.25 * stab);
    }
  }

  // ───────── 丟投擲物 ─────────
  _throw(t, P) {
    const low = hat(t, 0, 0.1, 0.26, 0.42), wind = hat(t, 0.02, 0.13, 0.15, 0.2), fling = hat(t, 0.15, 0.24, 0.27, 0.4), h = this.holder;
    P.gp.x += 0.04 * low; P.gp.y -= 0.1 * low; P.gr.x -= 0.3 * low; P.gr.z -= 0.25 * low; P.gr.y -= 0.12 * low;
    // 左手在鏡頭座標：先舉到左肩旁邊，再往前上方甩出去。算出來之後轉回槍的座標
    h.position.x += 0; h.updateMatrixWorld(true);
    const on = hat(t, 0, 0.1, 0.3, 0.42);
    _v.set(-0.17 - 0.03 * wind + 0.13 * fling, -0.13 + 0.03 * wind + 0.17 * fling, -0.4 + 0.08 * wind - 0.24 * fling);
    _q.setFromEuler(_e.set(0.35 - 0.2 * wind - 0.9 * fling, 0.3, -0.4));
    // 槍這一幀還沒擺好，所以用上一幀的矩陣換算（差一幀看不出來）
    h.worldToLocal(_w.copy(_v)); _q2.copy(h.quaternion).invert().multiply(_q);
    P.lp.lerp(_w, on); P.lq.slerp(_q2, on); P.la = Math.max(0, P.la - on);
    if (t < 0.2) { P.prop = this.thrKind; P.propAt.set(0.004, 0.036, -0.004); }
  }

  render(renderer) {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
