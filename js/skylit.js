// 讓「不是方塊」的東西（碎屑、角色、掉在地上的槍）也吃到天光：站在室內、隧道裡，環境光會跟著變暗。
// 用法：skyLit(material, world)。做法是在材質的著色器裡多查一次 world 的天光 3D 貼圖。
export function skyLit(mat, world) {
  if (mat.userData.skyLit) return mat;
  mat.userData.skyLit = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.tSky = world.U.tSky; sh.uniforms.uSkyMin = world.U.uSkyMin; sh.uniforms.uWorld = world.U.uWorld;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSkyP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 skp = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nskp = instanceMatrix * skp;\n#endif\nvSkyP = (modelMatrix * skp).xyz; }');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler3D tSky; uniform float uSkyMin; uniform vec3 uWorld; varying vec3 vSkyP;')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n{ float sk = texture(tSky, vSkyP.xzy / uWorld).r * 17.; sk = mix(uSkyMin, 1., sk * sk); reflectedLight.indirectDiffuse *= sk; reflectedLight.indirectSpecular *= sk; }');
  };
  const key = 'skylit|' + (prev ? prev.toString() : '');
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
  return mat;
}

// 整個物件底下的材質全部套用
export function skyLitTree(obj, world) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) if (m && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) skyLit(m, world);
  });
}
