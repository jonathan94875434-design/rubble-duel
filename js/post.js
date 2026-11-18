import * as THREE from 'three';

// 畫質選項。pr = 解析度倍率上限、shadow = 陰影貼圖大小（0 = 關）、msaa = 反鋸齒取樣數、tex = 方塊材質解析度
export const QUALITY = {
  low: { name: '低', pr: 1, shadow: 1024, post: false, msaa: 0, tex: 256 },
  medium: { name: '中', pr: 1.5, shadow: 2048, post: true, msaa: 2, tex: 512 },
  high: { name: '高', pr: 2, shadow: 4096, post: true, msaa: 4, tex: 512 },
  // 沒有顯示卡（軟體算圖）時用的，也是自動測試跑的設定
  min: { name: '最低', pr: 1, shadow: 0, post: false, msaa: 0, tex: 128 },
};

const VERT = 'varying vec2 vUv; void main() { vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }';
const mkMat = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra });

// 光暈第一步：只留下比門檻亮的部分，順便縮成一半
const F_BRIGHT = `uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThresh; varying vec2 vUv;
void main() {
  vec3 c = (texture2D(tSrc, vUv + uTexel * vec2(-1., -1.)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1., -1.)).rgb + texture2D(tSrc, vUv + uTexel * vec2(-1., 1.)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1., 1.)).rgb) * .25;
  c = min(c, vec3(48.));
  float l = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c * (max(l - uThresh, 0.) / max(l, 1e-4)), 1.);
}`;
const F_DOWN = `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  gl_FragColor = vec4((texture2D(tSrc, vUv + uTexel * vec2(-1., -1.)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1., -1.)).rgb + texture2D(tSrc, vUv + uTexel * vec2(-1., 1.)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1., 1.)).rgb) * .25, 1.);
}`;
const F_UP = `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 4.;
  c += (texture2D(tSrc, vUv + uTexel * vec2(-1., 0.)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1., 0.)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0., -1.)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0., 1.)).rgb) * 2.;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1., -1.)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1., -1.)).rgb + texture2D(tSrc, vUv + uTexel * vec2(-1., 1.)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1., 1.)).rgb;
  gl_FragColor = vec4(c / 16., 1.);
}`;
// 最後一步：疊上光暈 → 調色、暗角、受傷時褪色 → 色調對應 → 輸出
const F_FINAL = `uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uBloom, uSat, uVig, uTime, uGrain; uniform vec3 uTint; varying vec2 vUv;
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 col = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * uBloom;
  col *= uTint;
  col = mix(vec3(dot(col, vec3(.2126, .7152, .0722))), col, uSat);
  col *= 1. - uVig * smoothstep(.3, .9, length(vUv - .5) * 1.2);
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += (h21(vUv * 1000. + fract(uTime) * 100.) - .5) * uGrain;   // 一點點顆粒，順便消掉天空漸層的色帶
}`;

const LEVELS = 5;

// 後製流程：場景 →（高動態範圍的畫布）→ 光暈 → 調色 → 螢幕。畫質「低」時整個跳過，直接畫到螢幕。
export class Post {
  constructor(renderer) {
    this.r = renderer; this.on = false; this.samples = 0; this.w = 0; this.h = 0;
    this.rt = null; this.mips = [];
    this.tri = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)), null);
    this.tri.frustumCulled = false;
    this.qscene = new THREE.Scene(); this.qscene.add(this.tri); this.qcam = new THREE.Camera();
    this.mBright = mkMat(F_BRIGHT, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThresh: { value: 1.0 } });
    this.mDown = mkMat(F_DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.mUp = mkMat(F_UP, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, { blending: THREE.AdditiveBlending, transparent: true });
    this.mFinal = mkMat(F_FINAL, {
      tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0.16 }, uSat: { value: 1 }, uVig: { value: 0.32 }, uTime: { value: 0 }, uGrain: { value: 0.012 },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
    }, { toneMapped: true });
    this.sat = 1; this.hurt = 0;
  }

  // on = 要不要後製；w、h 是實際像素
  configure(on, samples, w, h) {
    if (on === this.on && samples === this.samples && w === this.w && h === this.h) return;
    this.on = on; this.samples = samples; this.w = w; this.h = h;
    if (this.rt) { this.rt.dispose(); this.rt = null; }
    for (const m of this.mips) m.dispose();
    this.mips = [];
    if (!on || !w || !h) return;
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthBuffer: true });
    let mw = w, mh = h;
    for (let i = 0; i < LEVELS; i++) {
      mw = Math.max(2, Math.round(mw / 2)); mh = Math.max(2, Math.round(mh / 2));
      this.mips.push(new THREE.WebGLRenderTarget(mw, mh, { type: THREE.HalfFloatType, depthBuffer: false }));
    }
  }

  setGrade(sat, tint) { this.sat = sat; this.mFinal.uniforms.uTint.value.set(tint[0], tint[1], tint[2]); }

  _quad(mat, target) { this.tri.material = mat; this.r.setRenderTarget(target); this.r.render(this.qscene, this.qcam); }

  // view = 第一人稱的槍（另一個場景，蓋在最上層）；沒有就傳 null。hurt 0..1 = 殘血時畫面褪色的程度
  render(scene, camera, view, dt, hurt = 0) {
    const r = this.r;
    if (!this.on) {
      r.setRenderTarget(null); r.autoClear = true; r.render(scene, camera);
      if (view) { r.autoClear = false; r.clearDepth(); r.render(view.scene, view.camera); r.autoClear = true; }
      return;
    }
    r.setRenderTarget(this.rt); r.autoClear = true; r.render(scene, camera);
    if (view) { r.autoClear = false; r.clearDepth(); r.render(view.scene, view.camera); r.autoClear = true; }
    const m = this.mips;
    this.mBright.uniforms.tSrc.value = this.rt.texture; this.mBright.uniforms.uTexel.value.set(0.5 / this.w, 0.5 / this.h);
    this._quad(this.mBright, m[0]);
    for (let i = 1; i < LEVELS; i++) {
      this.mDown.uniforms.tSrc.value = m[i - 1].texture; this.mDown.uniforms.uTexel.value.set(0.5 / m[i - 1].width, 0.5 / m[i - 1].height);
      this._quad(this.mDown, m[i]);
    }
    r.autoClear = false;                     // 往回放大時是「加」上去，不能清掉原本的
    for (let i = LEVELS - 2; i >= 0; i--) {
      this.mUp.uniforms.tSrc.value = m[i + 1].texture; this.mUp.uniforms.uTexel.value.set(1 / m[i + 1].width, 1 / m[i + 1].height);
      this._quad(this.mUp, m[i]);
    }
    r.autoClear = true;
    const u = this.mFinal.uniforms;
    this.hurt += (hurt - this.hurt) * Math.min(1, dt * 6);
    u.tScene.value = this.rt.texture; u.tBloom.value = m[0].texture; u.uTime.value += dt;
    u.uSat.value = this.sat * (1 - 0.55 * this.hurt); u.uVig.value = 0.32 + 0.3 * this.hurt;
    this._quad(this.mFinal, null);
  }
}
