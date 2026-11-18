import * as THREE from 'three';

// 方塊材質：全部在開機時用著色器「畫」出來，不需要任何圖檔。
// 每種材質算兩張圖，放進陣列貼圖的同一層：
//   albedo = 顏色（rgb）＋ 高度（a）
//   normal = 法線 xy（rg）＋ 粗糙度（b）＋ 金屬度（a）
// 貼圖用世界座標鋪，一張圖蓋 2 × 2 公尺（= 4 × 4 個方塊），所以看不出一格一格的方塊感。
export const TEX = {
  BEDROCK: 0, ASPHALT: 1, DIRT: 2, CONCRETE: 3, BRICK: 4, WOOD: 5, METAL: 6, WALL: 7, CONT: 8, CONTTOP: 9,
  SANDSTONE: 10, SAND: 11, PLASTER: 12, ROCK: 13, GRASS: 14, TILE: 15, SHEET: 16, SANDBAG: 17, CRACK: 18, COUNT: 19,
};

const FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform int uId; uniform int uMode; uniform float uPx;

// c 顏色、h 高度 0..1、r 粗糙度、m 金屬度、b 凹凸的實際深度（公尺）
struct M { vec3 c; float h; float r; float m; float b; };

float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vn(vec2 p, vec2 per) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(mod(i, per)), h21(mod(i + vec2(1., 0.), per)), f.x), mix(h21(mod(i + vec2(0., 1.), per)), h21(mod(i + vec2(1., 1.), per)), f.x), f.y);
}
// 可以無縫接起來的碎形雜訊。uv 0..1；per = 第一層在一張圖裡有幾格（x、y 可以不同 → 拉長的紋路）
float fbm(vec2 uv, vec2 per) {
  float s = 0., a = .5;
  for (int i = 0; i < 5; i++) { s += a * vn(uv * per, per); per *= 2.; a *= .5; }
  return s / .96875;
}
// 可以無縫接起來的細胞雜訊：回傳（到最近點的距離、第二近 − 最近、這一格的亂數）
vec3 wor(vec2 uv, float per) {
  vec2 p = uv * per, i = floor(p), f = fract(p); float d1 = 9., d2 = 9., id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), c = mod(i + g, per); float d = length(g + h22(c) - f);
    if (d < d1) { d2 = d1; d1 = d; id = h21(c + 7.3); } else if (d < d2) d2 = d;
  }
  return vec3(d1, d2 - d1, id);
}
// 每個整數格的邊界是 1、中間是 0（w = 線寬的一半）
float seam(float x, float w) { float f = abs(fract(x) - .5); return smoothstep(.5 - w, .5 - w * .4, f); }

M concrete(vec2 uv) {
  float n = fbm(uv, vec2(4.)), g = fbm(uv + .37, vec2(40.)), st = fbm(uv + .11, vec2(24., 3.));
  vec2 pn = uv * 2.;                                        // 一塊模板 1 公尺
  float sm = max(seam(pn.x, .012), seam(pn.y, .012));
  float hole = 1. - smoothstep(.018, .028, length(abs(fract(pn) - .5) - vec2(.38)));   // 模板四角的螺栓孔
  vec3 c = vec3(.50, .50, .48) * (.72 + .36 * n) * (.9 + .2 * g);
  c *= 1. - .22 * smoothstep(.5, .8, st);                    // 雨水流痕
  c = mix(c, c * .55, sm * .8); c = mix(c, c * .4, hole);
  return M(c, .6 + .25 * g + .15 * n - .5 * sm - .6 * hole, .86 + .1 * g, 0., .004);
}

M brick(vec2 uv) {
  vec2 p = uv * vec2(8., 24.);                              // 一塊磚 25 × 8.3 公分
  p.x += mod(floor(p.y), 2.) * .5;
  vec2 id = mod(floor(p), vec2(8., 24.)), f = fract(p), e = min(f, 1. - f) * vec2(.25, .083);
  float m = 1. - smoothstep(.004, .009, min(e.x, e.y));     // 1 = 灰縫
  float r = h21(id), r2 = h21(id + 19.), n = fbm(uv, vec2(64.)), big = fbm(uv + .5, vec2(6.));
  vec3 bc = mix(vec3(.42, .13, .08), vec3(.58, .24, .14), r);
  bc = mix(bc, vec3(.30, .11, .09), step(.86, r2) * .8);    // 少數燒過頭的深色磚
  bc *= (.8 + .4 * n) * (.8 + .35 * big);
  vec3 c = mix(bc, vec3(.52, .50, .46) * (.8 + .3 * n), m);
  return M(c, mix(.75 + .2 * n + .08 * r, .25 + .1 * n, m), mix(.82, .95, m), 0., .012);
}

M wood(vec2 uv) {
  float py = uv.y * 10., row = floor(py), rr = h21(vec2(row, 3.));   // 木板寬 20 公分，每條長 2 公尺、各自錯開
  float x = uv.x + rr;
  float gr = fbm(vec2(x, uv.y), vec2(4., 96.)), fine = fbm(vec2(x, uv.y) + .3, vec2(16., 256.));
  vec3 c = mix(vec3(.27, .17, .09), vec3(.50, .34, .19), rr * .6 + gr * .5) * (.7 + .45 * fine);
  float gap = seam(py, .035), jt = seam(x, .003);
  float xm = fract(x) * 2., ym = fract(py) * .2;             // 板子上的位置（公尺）
  float nail = 1. - smoothstep(.005, .008, length(vec2(min(xm, 2. - xm) - .04, abs(ym - .1) - .05)));
  c = mix(c, c * .35, max(gap, jt)); c = mix(c, vec3(.12, .11, .10), nail);
  return M(c, .7 + .2 * gr + .1 * fine - .6 * max(gap, jt) - .15 * nail, .72 + .2 * fine, 0., .006);
}

M metal(vec2 uv) {
  vec2 pn = uv * 2., f = fract(pn), e = min(f, 1. - f);     // 一片鋼板 1 公尺
  float sm = max(seam(pn.x, .008), seam(pn.y, .008));
  vec2 ci = floor(f * 8.);                                  // 沿邊每 12.5 公分一顆鉚釘
  float isE = float(ci.x < .5 || ci.x > 6.5 || ci.y < .5 || ci.y > 6.5);
  float rv = (1. - smoothstep(.08, .11, length(fract(pn * 8.) - .5))) * isE;
  float br = fbm(uv, vec2(2., 160.)), n = fbm(uv + .2, vec2(6.)), sc = fbm(uv + .6, vec2(200., 8.));
  float rust = smoothstep(.55, .75, n * .7 + (1. - smoothstep(0., .12, min(e.x, e.y))) * .45 + fbm(uv + .9, vec2(24.)) * .25);
  vec3 c = vec3(.34, .37, .41) * (.8 + .3 * br) + vec3(.06) * smoothstep(.72, .8, sc);
  c = mix(c, vec3(.33, .16, .08) * (.7 + .6 * n), rust * .85);
  c = mix(c, c * .5, sm * .7); c = mix(c, c * 1.25, rv * .5);
  return M(c, .5 + .05 * br - .4 * sm + .45 * rv + .08 * rust, mix(.38 + .2 * br, .9, rust), mix(.9, .15, rust), .004);
}

M asphalt(vec2 uv) {
  vec3 w = wor(uv, 96.);
  float n = fbm(uv, vec2(5.)), g = fbm(uv + .7, vec2(80.));
  float rd = abs(fbm(uv + .13, vec2(4.)) - .5) * 2.;         // 稜線雜訊：接近 0 的地方連起來就是蜿蜒的裂縫
  float crack = (1. - smoothstep(0., .022, rd)) * smoothstep(.52, .64, fbm(uv + .61, vec2(3.))) * smoothstep(.3, .55, fbm(uv + .27, vec2(11.)));   // 只有一部分地方裂開、而且斷斷續續
  float stone = (1. - smoothstep(.1, .35, w.x)) * smoothstep(.6, .9, w.z);
  vec3 c = vec3(.165, .16, .155) * (.75 + .5 * n) + vec3(.10, .10, .09) * stone;
  c = mix(c, vec3(.22, .21, .19), smoothstep(.62, .8, fbm(uv + .4, vec2(9.))) * .5);                // 塵土
  c = mix(c, c * .45, crack);
  return M(c, .5 + .25 * g + .2 * stone - .6 * crack, .9, 0., .006);
}

M dirt(vec2 uv) {
  float n = fbm(uv, vec2(6.)), g = fbm(uv + .2, vec2(64.)), st = fbm(uv + .5, vec2(3., 20.));
  vec3 w = wor(uv, 14.);
  float peb = (1. - smoothstep(.12, .2, w.x)) * step(.55, w.z);
  vec3 c = mix(vec3(.24, .16, .10), vec3(.38, .28, .18), n * .6 + st * .4) * (.75 + .5 * g);
  c = mix(c, vec3(.42, .40, .37) * (.7 + .5 * w.z), peb);
  return M(c, .45 + .3 * g + .15 * st + .35 * peb, .95, 0., .012);
}

M rock(vec2 uv) {
  float warp = fbm(uv, vec2(4.)), st = fbm(vec2(uv.x, uv.y + warp * .12), vec2(3., 28.)), g = fbm(uv + .4, vec2(72.));
  float big = fbm(uv + .7, vec2(7.)), rd = abs(fbm(uv + .15, vec2(5.)) - .5) * 2.;
  float crack = (1. - smoothstep(0., .03, rd)) * smoothstep(.5, .64, big) * smoothstep(.3, .6, fbm(uv + .9, vec2(9.)));
  vec3 c = mix(vec3(.22, .19, .16), vec3(.40, .34, .27), st * .6 + big * .4) * (.72 + .5 * g);
  c = mix(c, c * .55, crack);
  return M(c, .4 + .3 * st + .2 * g + .25 * big - .6 * crack, .9, 0., .02);
}

// 地圖外圍打不壞的牆：深色、有直條凹槽的預鑄水泥板（一眼就看得出跟一般水泥不一樣）
M wallm(vec2 uv) {
  float rib = smoothstep(.15, .45, abs(fract(uv.x * 16.) - .5) * 2.);
  float n = fbm(uv, vec2(5.)), g = fbm(uv + .3, vec2(56.)), st = fbm(uv + .6, vec2(32., 2.)), sm = seam(uv.y * 2., .01);
  vec3 c = vec3(.20, .21, .23) * (.7 + .4 * n) * (.85 + .3 * g) * (.75 + .25 * rib);
  c *= 1. - .3 * smoothstep(.5, .85, st);
  c = mix(c, c * .5, sm);
  return M(c, .3 + .6 * rib + .1 * g - .3 * sm, .88, 0., .02);
}

// 貨櫃側面的浪板。顏色是接近白的漆，實際的紅／藍／黃由方塊的頂點色去乘
M cont(vec2 uv) {
  float t = fract(uv.x * 8.), prof = smoothstep(.08, .22, t) - smoothstep(.58, .72, t);   // 梯形截面，25 公分一個週期
  float n = fbm(uv, vec2(5.)), g = fbm(uv + .3, vec2(64.)), st = fbm(uv + .6, vec2(40., 3.));
  float rust = smoothstep(.72, .9, n * .6 + st * .45 + g * .15), chip = smoothstep(.74, .78, fbm(uv + .8, vec2(28.)));
  vec3 c = vec3(.86) * (.88 + .12 * g) * (.8 + .2 * prof) * (.9 + .1 * n);
  c *= 1. - .12 * smoothstep(.5, .85, st);
  c = mix(c, vec3(.42, .22, .12), rust * .7); c = mix(c, vec3(.5, .5, .52), chip * .4);
  return M(c, .2 + .7 * prof + .05 * g, mix(.5, .85, rust), mix(.25, .05, rust), .03);
}
M contTop(vec2 uv) {
  float t = fract(uv.x * 4.), prof = smoothstep(.3, .38, t) - smoothstep(.62, .7, t);
  float n = fbm(uv, vec2(5.)), g = fbm(uv + .3, vec2(64.));
  float rust = smoothstep(.5, .75, n * .7 + fbm(uv + .5, vec2(14.)) * .4);
  vec3 c = vec3(.80) * (.8 + .25 * g);
  c = mix(c, vec3(.40, .22, .13) * (.7 + .5 * g), rust * .8);
  c = mix(c, vec3(.30, .28, .25), smoothstep(.6, .85, fbm(uv + .9, vec2(8.))) * .5);       // 積在頂上的灰
  return M(c, .4 + .35 * prof + .1 * g, mix(.55, .9, rust), mix(.2, .05, rust), .012);
}

M sandstone(vec2 uv) {
  vec2 p = uv * vec2(4., 8.);                               // 石塊 50 × 25 公分
  p.x += mod(floor(p.y), 2.) * .5;
  vec2 id = mod(floor(p), vec2(4., 8.)), f = fract(p), e = min(f, 1. - f) * vec2(.5, .25);
  float m = 1. - smoothstep(.004, .012, min(e.x, e.y));
  float r = h21(id + 3.), n = fbm(uv, vec2(48.)), st = fbm(uv + .2, vec2(4., 40.)), big = fbm(uv + .6, vec2(5.));
  float ero = smoothstep(.6, .8, fbm(uv + .9, vec2(20.)));  // 風化掉的凹洞
  vec3 c = mix(vec3(.56, .44, .28), vec3(.70, .58, .40), r * .5 + st * .5) * (.8 + .3 * n) * (.85 + .25 * big);
  c = mix(c, vec3(.40, .33, .24) * (.8 + .3 * n), m) * (1. - .2 * ero);
  return M(c, mix(.7 + .15 * n + .1 * r - .25 * ero, .2, m), .9, 0., .014);
}

M sand(vec2 uv) {
  float n = fbm(uv, vec2(5.)), g = fbm(uv + .3, vec2(96.));
  float rip = .5 + .5 * sin((uv.x * 28. + n * 3.) * 6.28318);   // 風吹出來的沙紋
  vec3 w = wor(uv, 18.);
  float peb = (1. - smoothstep(.07, .12, w.x)) * step(.75, w.z);
  vec3 c = mix(vec3(.58, .47, .30), vec3(.74, .63, .44), n * .7 + rip * .15) * (.85 + .3 * g);
  c = mix(c, vec3(.45, .40, .33), peb);
  return M(c, .4 + .2 * rip * smoothstep(.3, .7, n) + .2 * g + .4 * peb, .95, 0., .008);
}

M plaster(vec2 uv) {
  float n = fbm(uv, vec2(4.)), g = fbm(uv + .3, vec2(72.)), st = fbm(uv + .6, vec2(28., 2.));
  float rd = abs(fbm(uv + .21, vec2(5.)) - .5) * 2.;
  float crack = (1. - smoothstep(0., .02, rd)) * smoothstep(.5, .66, fbm(uv + .15, vec2(3.)));
  float flake = smoothstep(.72, .76, fbm(uv + .77, vec2(6.)));   // 灰泥剝落，露出底下的磚
  M b = brick(uv);
  vec3 c = vec3(.74, .70, .62) * (.82 + .25 * n) * (.9 + .15 * g);
  c *= 1. - .25 * smoothstep(.5, .85, st);
  c = mix(c, c * .45, crack); c = mix(c, b.c * .9, flake);
  return M(c, mix(.75 + .12 * g - .5 * crack, b.h * .6, flake), .9, 0., .008);
}

M grass(vec2 uv) {
  float n = fbm(uv, vec2(5.)), g = fbm(uv + .3, vec2(128.)), bl = fbm(uv + .6, vec2(160., 40.));
  float d = smoothstep(.6, .8, fbm(uv + .8, vec2(6.)));       // 禿掉露出土的地方
  vec3 c = mix(vec3(.10, .17, .05), vec3(.24, .31, .10), n * .5 + g * .5) * (.75 + .5 * bl);
  c = mix(c, vec3(.26, .21, .13) * (.8 + .4 * g), d * .35);
  return M(c, .4 + .5 * g * (1. - d * .5), .95, 0., .015);
}

M tile(vec2 uv) {
  vec2 p = uv * 8., id = mod(floor(p), 8.), f = fract(p), e = min(f, 1. - f);   // 25 公分的地磚
  float gr = 1. - smoothstep(.015, .035, min(e.x, e.y));
  float r = h21(id + 5.), n = fbm(uv, vec2(6.)), g = fbm(uv + .4, vec2(90.)), dirtk = smoothstep(.55, .8, n) * .4;
  vec3 c = mix(vec3(.62, .60, .55), vec3(.30, .32, .34), mod(id.x + id.y, 2.)) * (.9 + .15 * r) * (.85 + .2 * n);
  c = mix(c, vec3(.25, .24, .22), gr); c = mix(c, vec3(.25, .22, .18), dirtk * .5);
  return M(c, mix(.8 + .03 * g, .3, gr), mix(.28 + .3 * dirtk, .9, gr), 0., .004);
}

M sheet(vec2 uv) {
  float prof = .5 + .5 * sin(uv.x * 24. * 6.28318);          // 生鏽的浪板，8 公分一浪
  float n = fbm(uv, vec2(5.)), g = fbm(uv + .3, vec2(64.)), st = fbm(uv + .6, vec2(48., 3.));
  float rust = smoothstep(.35, .7, n * .6 + st * .5);
  vec3 c = mix(vec3(.50, .53, .55), vec3(.40, .20, .10) * (.7 + .6 * g), rust) * (.75 + .25 * prof);
  return M(c, .2 + .7 * prof + .08 * g, mix(.45, .9, rust), mix(.8, .1, rust), .012);
}

M sandbag(vec2 uv) {
  vec2 p = uv * vec2(4., 8.);                               // 一袋 50 × 25 公分
  p.x += mod(floor(p.y), 2.) * .5;
  vec2 id = mod(floor(p), vec2(4., 8.)), f = fract(p) - .5;
  float d = pow(abs(f.x * 2.), 3.) + pow(abs(f.y * 2.), 2.5); // 枕頭形
  float bag = 1. - smoothstep(.75, 1.05, d);
  float weave = .5 + .25 * sin(uv.x * 256. * 6.28318) + .25 * sin(uv.y * 256. * 6.28318);
  float r = h21(id + 2.), n = fbm(uv, vec2(40.));
  vec3 c = mix(vec3(.42, .37, .26), vec3(.56, .50, .36), r) * (.8 + .25 * n) * (.9 + .1 * weave);
  return M(mix(vec3(.12, .10, .08), c, bag), bag * (1. - d * .55) + .03 * weave, .95, 0., .035);
}

// 裂痕遮罩（方塊被打傷時疊上去）：r = 輕傷的裂痕、g = 重傷（更多更密）
M cracks(vec2 uv) {
  vec3 a = wor(uv + fbm(uv, vec2(6.)) * .05, 8.), b = wor(uv + .37, 20.);
  float m1 = 1. - smoothstep(0., .04, a.y), m2 = (1. - smoothstep(0., .06, b.y)) * smoothstep(.3, .6, a.x);
  return M(vec3(m1, max(m1, m2), 0.), 1. - max(m1, m2), 1., 0., .01);
}

M mat(int id, vec2 uv) {
  if (id == 0) { M m = rock(uv); m.c *= .35; return m; }
  if (id == 1) return asphalt(uv);
  if (id == 2) return dirt(uv);
  if (id == 3) return concrete(uv);
  if (id == 4) return brick(uv);
  if (id == 5) return wood(uv);
  if (id == 6) return metal(uv);
  if (id == 7) return wallm(uv);
  if (id == 8) return cont(uv);
  if (id == 9) return contTop(uv);
  if (id == 10) return sandstone(uv);
  if (id == 11) return sand(uv);
  if (id == 12) return plaster(uv);
  if (id == 13) return rock(uv);
  if (id == 14) return grass(uv);
  if (id == 15) return tile(uv);
  if (id == 16) return sheet(uv);
  if (id == 17) return sandbag(uv);
  return cracks(uv);
}

void main() {
  M m = mat(uId, vUv);
  if (uMode == 0) { gl_FragColor = vec4(m.c, m.h); return; }
  float hx = mat(uId, vUv + vec2(uPx, 0.)).h, hy = mat(uId, vUv + vec2(0., uPx)).h;
  float k = m.b / (uPx * 2.);                               // 凹凸深度 ÷ 一個像素的實際寬度（一張圖 2 公尺）
  vec3 n = normalize(vec3((m.h - hx) * k, (m.h - hy) * k, 1.));
  gl_FragColor = vec4(n.xy * .5 + .5, m.r, m.m);
}`;

// 回傳 { albedo, normal }：兩張陣列貼圖（THREE.DataArrayTexture），層數 = TEX.COUNT
export function buildBlockTextures(renderer, size = 512) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const mk = (srgb) => {
    const rt = new THREE.WebGLArrayRenderTarget(size, size, TEX.COUNT, { depthBuffer: false });
    const t = rt.texture;
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = aniso;
    return rt;
  };
  const A = mk(true), N = mk(false);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uId: { value: 0 }, uMode: { value: 0 }, uPx: { value: 1 / size } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: FRAG, depthTest: false, depthWrite: false,
  });
  const scene = new THREE.Scene(), cam = new THREE.Camera();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false; scene.add(quad);
  const prev = renderer.getRenderTarget();
  for (let id = 0; id < TEX.COUNT; id++) {
    mat.uniforms.uId.value = id;
    mat.uniforms.uMode.value = 0; renderer.setRenderTarget(A, id); renderer.render(scene, cam);
    mat.uniforms.uMode.value = 1; renderer.setRenderTarget(N, id); renderer.render(scene, cam);
  }
  renderer.setRenderTarget(prev);
  quad.geometry.dispose(); mat.dispose();
  return { albedo: A.texture, normal: N.texture, size, dispose() { A.dispose(); N.dispose(); } };
}
