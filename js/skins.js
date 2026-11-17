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

export function validLook(l) {
  return { s: l && SKINS[l.s] ? l.s : 'recruit', w: l && WSKINS[l.w] ? l.w : 'stock' };
}
