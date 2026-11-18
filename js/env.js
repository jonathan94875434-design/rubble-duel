import * as THREE from 'three';

// 天空、太陽、霧、環境反射。每張地圖選一種「天氣」，整個畫面的氣氛就不一樣。
// sun = [方位角, 仰角]（度）。顏色都是線性色彩空間的 0..1（可以超過 1）。
// amb = 完全照不到天光的地方（隧道深處）還剩多少環境光，太低會黑到看不見人
export const ENVS = {
  golden: {
    name: '黃昏', sun: [135, 19], sunCol: [1.0, 0.62, 0.36], sunI: 3.6,
    zen: [0.16, 0.26, 0.50], hor: [0.90, 0.56, 0.34], gnd: [0.20, 0.16, 0.13], hill: [0.12, 0.10, 0.12],
    hemiSky: [0.50, 0.58, 0.85], hemiGnd: [0.42, 0.30, 0.22], hemiI: 1.1,
    fog: [0.72, 0.52, 0.38], fogD: 0.009, cloud: 0.5, cloudCol: [1.0, 0.72, 0.55], stars: 0,
    envI: 0.7, amb: 0.24, expo: 0.9, sat: 1.06, tint: [1.03, 1.0, 0.96], ambient: 'wind', reverb: 0.25,
  },
  noon: {
    name: '正午', sun: [100, 58], sunCol: [1.0, 0.95, 0.84], sunI: 3.8,
    zen: [0.14, 0.34, 0.74], hor: [0.72, 0.74, 0.70], gnd: [0.40, 0.34, 0.24], hill: [0.42, 0.36, 0.28],
    hemiSky: [0.60, 0.72, 0.95], hemiGnd: [0.55, 0.46, 0.32], hemiI: 1.4,
    fog: [0.78, 0.74, 0.62], fogD: 0.007, cloud: 0.34, cloudCol: [1, 1, 1], stars: 0,
    envI: 0.8, amb: 0.2, expo: 0.72, sat: 1.0, tint: [1.02, 1.0, 0.97], ambient: 'desert', reverb: 0.3,
  },
  overcast: {
    name: '陰天', sun: [135, 42], sunCol: [0.90, 0.92, 1.0], sunI: 1.3,
    zen: [0.36, 0.41, 0.47], hor: [0.58, 0.62, 0.66], gnd: [0.18, 0.19, 0.20], hill: [0.22, 0.25, 0.28],
    hemiSky: [0.66, 0.72, 0.80], hemiGnd: [0.30, 0.30, 0.30], hemiI: 1.6,
    fog: [0.55, 0.59, 0.63], fogD: 0.016, cloud: 0.95, cloudCol: [0.70, 0.72, 0.76], stars: 0,
    envI: 1.0, amb: 0.3, expo: 0.8, sat: 0.9, tint: [0.97, 1.0, 1.04], ambient: 'harbor', reverb: 0.35,
  },
  morning: {
    name: '清晨', sun: [80, 32], sunCol: [1.0, 0.88, 0.70], sunI: 3.5,
    zen: [0.12, 0.30, 0.68], hor: [0.62, 0.74, 0.90], gnd: [0.25, 0.23, 0.20], hill: [0.20, 0.24, 0.30],
    hemiSky: [0.52, 0.66, 0.95], hemiGnd: [0.36, 0.32, 0.28], hemiI: 1.3,
    fog: [0.64, 0.74, 0.86], fogD: 0.006, cloud: 0.3, cloudCol: [1, 0.97, 0.92], stars: 0,
    envI: 0.8, amb: 0.2, expo: 0.75, sat: 1.04, tint: [1, 1, 1], ambient: 'cave', reverb: 0.45,
  },
  sunset: {
    name: '夕陽', sun: [135, 8], sunCol: [1.0, 0.42, 0.18], sunI: 3.0,
    zen: [0.10, 0.12, 0.32], hor: [0.95, 0.38, 0.16], gnd: [0.14, 0.09, 0.08], hill: [0.08, 0.05, 0.08],
    hemiSky: [0.40, 0.38, 0.62], hemiGnd: [0.40, 0.22, 0.16], hemiI: 1.0,
    fog: [0.60, 0.33, 0.24], fogD: 0.010, cloud: 0.55, cloudCol: [1.0, 0.5, 0.35], stars: 0.15,
    envI: 0.7, amb: 0.26, expo: 0.95, sat: 1.1, tint: [1.04, 0.99, 0.95], ambient: 'wind', reverb: 0.25,
  },
  night: {
    name: '月夜', sun: [60, 50], sunCol: [0.55, 0.68, 1.0], sunI: 0.9,
    zen: [0.010, 0.015, 0.04], hor: [0.04, 0.06, 0.11], gnd: [0.02, 0.025, 0.035], hill: [0.012, 0.016, 0.03],
    hemiSky: [0.20, 0.27, 0.45], hemiGnd: [0.06, 0.07, 0.09], hemiI: 0.9,
    fog: [0.03, 0.045, 0.08], fogD: 0.012, cloud: 0.3, cloudCol: [0.10, 0.12, 0.18], stars: 1,
    envI: 0.6, amb: 0.38, expo: 1.3, sat: 0.92, tint: [0.95, 1.0, 1.08], ambient: 'wind', reverb: 0.3,
  },
};
export const ENV_IDS = Object.keys(ENVS);

const SKY_VERT = 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const SKY_FRAG = /* glsl */`
uniform vec3 uZen, uHor, uGnd, uSunCol, uSunDir, uCloudCol, uHill; uniform float uCloud, uTime, uDisc, uStars;
varying vec3 vDir;
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h21(i), h21(i + vec2(1., 0.)), f.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), f.x), f.y); }
float fbm(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= .5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float sd = max(dot(d, uSunDir), 0.), h = max(d.y, 0.);
  vec3 col = mix(uHor, uZen, pow(h, .5));
  col += uSunCol * (pow(sd, 6.) * .18 + pow(sd, 48.) * .5);                     // 太陽周圍的光暈
  col += uSunCol * smoothstep(.99955, .9998, sd) * 40. * uDisc;                 // 太陽本體：很亮，後製的光暈會抓到
  if (uStars > 0. && d.y > 0.) {                                                // 星星：每一小格裡最多一顆，畫成很小的圓點
    vec2 sp = d.xz / (d.y + .3) * 160., cell = floor(sp), g = fract(sp) - .5 - (vec2(h21(cell + 5.), h21(cell + 9.)) - .5) * .6;
    col += vec3(.9, .95, 1.) * step(.972, h21(cell)) * smoothstep(.16, .02, length(g)) * uStars * smoothstep(0., .25, d.y) * (.5 + 2.5 * h21(cell + 3.));
  }
  if (d.y > 0.) {                                                               // 雲：把視線投到一個平面上取雜訊
    vec2 p = d.xz / (d.y + .1) * 1.1 + uTime * vec2(.004, .0015);
    float k = smoothstep(1. - uCloud * .95, 1. - uCloud * .95 + .3, fbm(p * 1.3) * 1.05);
    float shade = fbm(p * 1.3 + uSunDir.xz * .08);
    vec3 cc = uCloudCol * (.55 + .6 * smoothstep(.3, .9, 1. - shade + sd * .4)) + uSunCol * pow(sd, 6.) * .5;
    col = mix(col, cc, k * smoothstep(0., .12, d.y) * .9);
  }
  vec2 az = normalize(d.xz + 1e-5);                                             // 遠山剪影（兩層，遠的比較淡）
  float r1 = .03 + .055 * vn(az * 2.6 + 3.) + .02 * vn(az * 9. + 7.);
  float r2 = .012 + .04 * vn(az * 4.5 + 11.);
  col = mix(col, mix(uHill, uHor, .6), smoothstep(r1 + .004, r1, d.y));
  col = mix(col, mix(uHill, uHor, .3), smoothstep(r2 + .003, r2, d.y));
  col = mix(col, uGnd, smoothstep(0., -.03, d.y));
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export class Environment {
  // center：地圖中心（太陽陰影的範圍以它為準）；half：地圖半寬（公尺）
  constructor(scene, renderer, center, half) {
    this.scene = scene; this.renderer = renderer; this.center = center.clone(); this.half = half;
    this.id = null; this.def = ENVS.golden; this.sunDir = new THREE.Vector3(0, 1, 0); this.time = 0;
    scene.fog = new THREE.FogExp2(0xffffff, 0.01);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1); scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera, r = half * 1.5;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 1; sc.far = 220;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
    scene.add(sun, sun.target);

    this.u = {
      uZen: { value: new THREE.Vector3() }, uHor: { value: new THREE.Vector3() }, uGnd: { value: new THREE.Vector3() }, uHill: { value: new THREE.Vector3() },
      uSunCol: { value: new THREE.Vector3() }, uSunDir: { value: this.sunDir }, uCloudCol: { value: new THREE.Vector3() },
      uCloud: { value: 0.4 }, uTime: { value: 0 }, uDisc: { value: 1 }, uStars: { value: 0 },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(320, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.u, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG }));
    this.sky.frustumCulled = false; this.sky.renderOrder = -10; scene.add(this.sky);

    // 地圖外面的地：四大片平面圍住地圖（中間留空，不然挖開地面會看到一片漂浮的地板）
    this.skirtMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 1, metalness: 0 });
    this.skirt = new THREE.Group(); scene.add(this.skirt);
    const S = 400, h = half, cx = center.x, cz = center.z;
    for (const [x, z, w, d] of [[cx, cz - h - S / 2, S * 2 + h * 2, S], [cx, cz + h + S / 2, S * 2 + h * 2, S], [cx - h - S / 2, cz, S, h * 2], [cx + h + S / 2, cz, S, h * 2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.skirtMat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0, z); m.receiveShadow = true; this.skirt.add(m);
    }
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene(); this.envRT = null;
  }

  // size = 0 → 關掉陰影
  setShadows(size) {
    const s = this.sun;
    s.castShadow = size > 0;
    if (size > 0 && s.shadow.mapSize.x !== size) { s.shadow.mapSize.set(size, size); if (s.shadow.map) { s.shadow.map.dispose(); s.shadow.map = null; } }
  }

  // 換天氣。groundY = 這張地圖的地面高度（公尺），外面那片地要對齊
  apply(id, groundY = 0) {
    const d = ENVS[id] || ENVS.golden; this.skirt.position.y = groundY - 0.02;
    if (this.id === id) return d;
    this.id = id; this.def = d;
    const az = (d.sun[0] * Math.PI) / 180, el = (d.sun[1] * Math.PI) / 180;
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    this.sun.color.setRGB(d.sunCol[0], d.sunCol[1], d.sunCol[2]); this.sun.intensity = d.sunI;
    this.sun.target.position.copy(this.center); this.sun.position.copy(this.center).addScaledVector(this.sunDir, 110);
    this.hemi.color.setRGB(d.hemiSky[0], d.hemiSky[1], d.hemiSky[2]); this.hemi.groundColor.setRGB(d.hemiGnd[0], d.hemiGnd[1], d.hemiGnd[2]); this.hemi.intensity = d.hemiI;
    this.scene.fog.color.setRGB(d.fog[0], d.fog[1], d.fog[2]); this.scene.fog.density = d.fogD;
    const u = this.u;
    u.uZen.value = V(d.zen); u.uHor.value = V(d.hor); u.uGnd.value = V(d.gnd); u.uHill.value = V(d.hill);
    u.uSunCol.value = V(d.sunCol).multiplyScalar(Math.min(1, d.sunI / 3)); u.uCloudCol.value = V(d.cloudCol);
    u.uCloud.value = d.cloud; u.uStars.value = d.stars;
    this.skirtMat.color.setRGB(d.gnd[0] * 1.3, d.gnd[1] * 1.3, d.gnd[2] * 1.3);
    this.scene.environmentIntensity = d.envI;
    this._bakeEnv();
    return d;
  }

  // 把天空烤成環境貼圖 → 金屬、玻璃之類的反射會帶到天空的顏色
  _bakeEnv() {
    const sky = this.sky, parent = sky.parent;
    this.u.uDisc.value = 0;                 // 太陽本體交給方向光去打亮，不然會有兩個亮點
    sky.position.set(0, 0, 0); this.envScene.add(sky);
    const rt = this.pmrem.fromScene(this.envScene, 0, 1, 1000);
    if (parent) parent.add(sky);
    this.u.uDisc.value = 1;
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt; this.scene.environment = rt.texture;
  }

  update(dt, camPos) {
    this.time += dt; this.u.uTime.value = this.time;
    this.sky.position.copy(camPos);
  }
}
