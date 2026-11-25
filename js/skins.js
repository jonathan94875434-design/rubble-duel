// 造型。全部一開始就能用，純外觀、不影響數值。
//
// 角色：body/head 寫 null 代表用隊伍色（房主橘、訪客藍）
//       acc 是配件：hood 兜帽、helmet 頭盔、pack 背包、pads 護肩、antenna 天線、
//                   crest 頭冠、horns 角、stripes 發光條紋、camo 迷彩塊
export const SKINS = {
  recruit: { name: '新兵', body: null, head: null, trim: 0x23262d, legs: 0x23262d, visor: 0xfff2c4, acc: [] },
  shadow: { name: '暗影', body: 0x16181d, head: 0x16181d, trim: 0x3a1010, legs: 0x0d0e11, visor: 0xff3030, acc: ['hood'] },
  desert: { name: '沙漠遊騎兵', body: 0xb89868, head: 0xb89868, trim: 0x6b5433, legs: 0x7a6240, visor: 0x1a1a1a, acc: ['helmet', 'pack'] },
  arctic: { name: '雪地', body: 0xdfe6ee, head: 0xdfe6ee, trim: 0x8fa3b8, legs: 0xaab6c4, visor: 0x39c6ff, acc: ['helmet', 'pads'] },
  jungle: { name: '叢林', body: 0x3d5a2a, head: 0x4a6b33, trim: 0x22331a, legs: 0x2c3b1e, visor: 0xc8ff7a, acc: ['pack', 'camo'] },
  gold: { name: '黃金', body: 0xd4a017, head: 0xd4a017, trim: 0x7a1414, legs: 0x1c1c1c, visor: 0xffffff, acc: ['crest', 'pads'] },
  neon: { name: '霓虹', body: 0x1b1630, head: 0x1b1630, trim: 0xff2bd6, legs: 0x120f22, visor: 0x00ffe0, glow: 0x00ffe0, acc: ['stripes', 'antenna'] },
  lava: { name: '熔岩', body: 0x241410, head: 0x241410, trim: 0x3a1a10, legs: 0x160c0a, visor: 0xffa020, glow: 0xff5a1a, acc: ['horns', 'stripes'] },
};
export const SKIN_IDS = Object.keys(SKINS);

// 武器塗裝：color 是槍身顏色（null = 每把槍原本的顏色），glow 是發光的上護木
export const WSKINS = {
  stock: { name: '原廠', color: null },
  sand: { name: '沙漠', color: 0xb89868 },
  snow: { name: '極地', color: 0xdde5ee },
  carbon: { name: '碳黑', color: 0x15171b },
  crimson: { name: '緋紅', color: 0xa3121e },
  gold: { name: '黃金', color: 0xd4a017 },
  neon: { name: '霓虹', color: 0x1b1630, glow: 0x00ffe0 },
  toxic: { name: '毒液', color: 0x2b3a18, glow: 0x9dff2e },
};
export const WSKIN_IDS = Object.keys(WSKINS);

// 造型：s 角色、w 武器塗裝、k 刀型、p 特殊塗裝 { 武器: 花紋 }（只留下真的存在的組合）
export function validLook(l) {
  const out = { s: l && SKINS[l.s] ? l.s : 'recruit', w: l && WSKINS[l.w] ? l.w : 'stock', k: l && KNIVES[l.k] ? l.k : 'knife', p: {} };
  if (l && l.p && typeof l.p === 'object') for (const w in l.p) if (ITEMS[w + ':' + l.p[w]]) out.p[w] = l.p[w];
  return out;
}

// ───────── 補給箱（抽獎）拿到的東西 ─────────
// 刀型：戰鬥刀是預設，其他要抽到
export const KNIVES = {
  knife: { name: '戰鬥刀' },
  butterfly: { name: '蝴蝶刀' },
  karambit: { name: '爪刀' },
  bowie: { name: '獵刀' },
  katana: { name: '武士刀' },
  dagger: { name: '匕首' },
  kris: { name: '蛇形刀' },
  axe: { name: '戰斧' },
};
export const KNIFE_IDS = Object.keys(KNIVES);

// 特殊塗裝的花紋（圖案在 finishes.js 用程式畫）。m 金屬度、r 粗糙度、glow 發光條、em 花紋自己發一點光（暗處也看得到）
export const FINISHES = {
  dragon: { name: '赤焰龍', m: 0.35, r: 0.34, em: 0.22, glow: 0xff6a1a },
  galaxy: { name: '星河', m: 0.4, r: 0.3, em: 0.5, glow: 0x6ad8ff },
  inferno: { name: '煉獄', m: 0.2, r: 0.42, em: 0.45, glow: 0xff8a1a },
  storm: { name: '雷霆', m: 0.45, r: 0.36, em: 0.45, glow: 0xb48cff },
  fade: { name: '霓彩漸層', m: 1, r: 0.2, em: 0.06 },
  ice: { name: '冰晶', m: 0.6, r: 0.18, em: 0.18, glow: 0x9ee8ff },
  circuit: { name: '電路板', m: 0.3, r: 0.45, em: 0.35, glow: 0x3dff8a },
  marble: { name: '大理石', m: 0.15, r: 0.22, em: 0.04 },
  hex: { name: '蜂巢', m: 0.8, r: 0.3, em: 0.08 },
  sakura: { name: '櫻吹雪', m: 0.1, r: 0.5, em: 0.08 },
  tiger: { name: '虎紋', m: 0.25, r: 0.48, em: 0.05 },
  digital: { name: '數位迷彩', m: 0.1, r: 0.66, em: 0.02 },
  // 霓虹補給箱
  synth: { name: '夕陽格線', m: 0.3, r: 0.35, em: 0.5, glow: 0xff4fd8 },
  glitch: { name: '故障', m: 0.4, r: 0.4, em: 0.35, glow: 0x40f0ff },
  holo: { name: '全像', m: 0.9, r: 0.15, em: 0.2 },
  plasma: { name: '電漿', m: 0.3, r: 0.35, em: 0.5, glow: 0x8a5cff },
  matrix: { name: '數位雨', m: 0.2, r: 0.5, em: 0.55, glow: 0x3dff6a },
  // 神話補給箱
  phoenix: { name: '鳳羽', m: 0.35, r: 0.35, em: 0.3, glow: 0xff7a1a },
  porcelain: { name: '青花瓷', m: 0.05, r: 0.15, em: 0.05 },
  lava: { name: '熔岩', m: 0.2, r: 0.6, em: 0.6, glow: 0xff5a10 },
  goldscale: { name: '金鱗', m: 1, r: 0.25, em: 0.08 },
  inkbamboo: { name: '墨竹', m: 0, r: 0.6, em: 0.03 },
  jade: { name: '翡翠', m: 0.2, r: 0.12, em: 0.06 },
};

// 獎池：每一池有自己的東西和自己的保底；抽獎券、碎片共用
export const POOLS = {
  classic: { name: '經典補給箱', c: '#ffb238', desc: '赤焰龍、星河、蝴蝶刀、爪刀、獵刀' },
  neon: { name: '霓虹補給箱', c: '#ff4fd8', desc: '夕陽格線、故障、全像、數位雨、武士刀、匕首' },
  myth: { name: '神話補給箱', c: '#ff7a1a', desc: '鳳羽、青花瓷、熔岩、金鱗、蛇形刀、戰斧' },
};
export const POOL_IDS = Object.keys(POOLS);

// 稀有度（由低到高）：w 是抽到這一級的權重
export const TIERS = {
  b: { name: '精良', w: 52, c: '#4b8bff' },
  p: { name: '稀有', w: 27, c: '#9a5cff' },
  k: { name: '隱秘', w: 12, c: '#e64bd6' },
  m: { name: '神話', w: 5, c: '#ff3b4a' },
  g: { name: '傳奇刀', w: 4, c: '#ffc23a' },
};
export const TIER_IDS = Object.keys(TIERS);

// 物品：「武器:花紋」是那把武器專用的特殊塗裝（knife = 任何刀型都能用），「刀:刀型」是刀。pool = 哪一個獎池
export const ITEMS = {};
for (const [pool, tiers] of Object.entries({
  classic: {
    m: ['sniper:dragon', 'ar:galaxy'],
    k: ['ar:inferno', 'lmg:storm', 'pistol:fade', 'sniper:ice', 'knife:fade', 'knife:galaxy'],
    p: ['smg:circuit', 'shotgun:marble', 'dmr:hex', 'revolver:inferno', 'pistol:sakura', 'knife:tiger', 'knife:marble'],
    b: ['ar:digital', 'smg:tiger', 'mp:digital', 'rocket:hex', 'shotgun:tiger', 'gl:circuit', 'dmr:digital'],
    g: ['k:butterfly', 'k:karambit', 'k:bowie'],
  },
  neon: {
    m: ['ar:synth', 'sniper:glitch'],
    k: ['smg:holo', 'pistol:plasma', 'knife:holo', 'dmr:synth'],
    p: ['shotgun:glitch', 'revolver:matrix', 'mp:plasma', 'knife:matrix'],
    b: ['ar:matrix', 'lmg:glitch', 'gl:plasma', 'rocket:synth'],
    g: ['k:katana', 'k:dagger'],
  },
  myth: {
    m: ['sniper:phoenix', 'ar:goldscale'],
    k: ['pistol:porcelain', 'revolver:goldscale', 'knife:lava', 'smg:phoenix'],
    p: ['dmr:jade', 'shotgun:inkbamboo', 'knife:jade', 'mp:porcelain'],
    b: ['lmg:lava', 'gl:jade', 'rocket:inkbamboo', 'ar:lava'],
    g: ['k:kris', 'k:axe'],
  },
})) for (const [t, list] of Object.entries(tiers)) for (const id of list) { const [a, b] = id.split(':'); ITEMS[id] = a === 'k' ? { t, pool, knife: b } : { t, pool, w: a, f: b }; }
export const ITEM_IDS = Object.keys(ITEMS);

// 一把武器實際要用的塗裝字串（給 gunmodel.buildGun）：
//   '塗裝' 一般塗裝、'*花紋' 特殊塗裝；刀再接 '/刀型'，例：'*fade/butterfly'
// lk 可以是造型物件 { w, k, p }，也可以直接是塗裝字串（舊的寫法）
export function gunSkin(lk, id) {
  if (!lk || typeof lk !== 'object') return lk || 'stock';
  const f = lk.p && lk.p[id];
  let s = f && ITEMS[id + ':' + f] ? '*' + f : WSKINS[lk.w] ? lk.w : 'stock';
  if (id === 'knife' && lk.k && lk.k !== 'knife' && KNIVES[lk.k]) s += '/' + lk.k;
  return s;
}
