import { BS } from './config.js';

// 方塊代號（跟 world.js 的 B 一致，這裡重寫一份避免循環引用）
const AIR = 0, BEDROCK = 1, GROUND = 2, CONCRETE = 3, BRICK = 4, WOOD = 5, METAL = 6, WALL = 7;

export const G = 3; // 地面上第一格可站立的高度（方塊）
const m = (c) => (c + 0.5) * BS;

// 出生點（公尺）。yaw 都面向地圖中心。每局會互換。
export const SPAWNS = [
  { x: m(13), y: G * BS, z: m(13), yaw: -Math.PI * 0.75 },
  { x: m(82), y: G * BS, z: m(82), yaw: Math.PI * 0.25 },
];

// 補給品。type: 'hp' 回血 / 'armor' 護甲
export const PICKUPS = [
  { type: 'hp', amount: 40, x: m(47.5), y: G * BS, z: m(17.5) },
  { type: 'hp', amount: 40, x: m(47.5), y: G * BS, z: m(77.5) },
  { type: 'armor', amount: 50, x: m(47.5), y: (G + 7) * BS, z: m(47.5), respawn: 30 },
  { type: 'hp', amount: 25, x: m(81), y: (G + 8) * BS, z: m(13.5) },
  { type: 'hp', amount: 25, x: m(14), y: (G + 8) * BS, z: m(81.5) },
];

// 「廢墟廣場」：中央兩層樓塔、兩個角落高台、出生點有 L 型磚牆保護。
// 所有東西都用 boxSym 放，所以地圖對兩位玩家完全對稱。
export function buildMap(w) {
  const X = w.X, Z = w.Z;
  const S = (...a) => w.boxSym(...a);

  // 地基：最底層打不壞，上面兩層可以炸出彈坑
  w.box(0, 0, 0, X - 1, 0, Z - 1, BEDROCK);
  w.box(0, 1, 0, X - 1, G - 1, Z - 1, GROUND);

  // 外圍高牆（打不壞）
  const WH = 22;
  w.box(0, 1, 0, 1, WH, Z - 1, WALL); w.box(X - 2, 1, 0, X - 1, WH, Z - 1, WALL);
  w.box(0, 1, 0, X - 1, WH, 1, WALL); w.box(0, 1, Z - 2, X - 1, WH, Z - 1, WALL);

  // ── 中央塔（40..55）──
  const c0 = 40, c1 = 55;
  S(c0, G, c0, c1, G + 5, c0, BRICK); S(c0, G, c0, c0, G + 5, c1, BRICK);
  // 四個門（偏一邊，避開樓梯）
  S(49, G, c0, 52, G + 4, c0, AIR); S(c0, G, 49, c0, G + 4, 52, AIR);
  // 一樓窗戶
  S(c0, G + 2, 44, c0, G + 3, 45, AIR);
  // 二樓木地板（可以從下面打穿）
  w.box(c0, G + 6, c0, c1, G + 6, c1, WOOD);
  // 樓梯口 + 樓梯
  S(41, G + 6, 41, 47, G + 6, 42, AIR);
  for (let i = 0; i < 7; i++) S(47 - i, G, 41, 47 - i, G + i, 42, WOOD);
  // 二樓女兒牆與角柱
  S(c0, G + 7, c0, c1, G + 8, c0, CONCRETE); S(c0, G + 7, c0, c0, G + 8, c1, CONCRETE);
  S(45, G + 8, c0, 46, G + 8, c0, AIR); S(49, G + 8, c0, 50, G + 8, c0, AIR);
  S(c0, G + 8, 45, c0, G + 8, 46, AIR); S(c0, G + 8, 49, c0, G + 8, 50, AIR);
  S(c1 - 1, G + 7, c0, c1, G + 11, c0 + 1, CONCRETE);

  // ── 出生點的 L 型磚牆 ──
  S(24, G, 10, 25, G + 5, 25, BRICK);
  S(10, G, 24, 25, G + 5, 25, BRICK);
  S(24, G + 2, 16, 25, G + 3, 17, AIR);
  S(16, G + 2, 24, 17, G + 3, 25, AIR);

  // ── 對角線上的掩體 ──
  S(31, G, 31, 36, G + 3, 32, CONCRETE);
  S(31, G, 33, 32, G + 3, 36, CONCRETE);
  S(34, G, 35, 35, G + 1, 36, WOOD);

  // ── 邊路 ──
  S(34, G, 5, 35, G + 2, 14, CONCRETE);          // 矮牆
  S(43, G, 11, 45, G + 2, 13, WOOD);             // 木箱堆
  S(46, G, 12, 47, G + 1, 13, WOOD);
  S(44, G + 3, 12, 45, G + 4, 13, WOOD);
  S(44, G, 24, 51, G + 4, 25, BRICK);            // 中路磚牆
  S(47, G + 2, 24, 48, G + 3, 25, AIR);
  S(56, G, 17, 57, G + 9, 18, CONCRETE);         // 柱子
  S(36, G, 20, 37, G + 9, 21, CONCRETE);
  S(60, G, 29, 65, G + 1, 30, CONCRETE);         // 沙包高度
  S(58, G, 33, 59, G + 4, 37, BRICK);
  S(17, G, 43, 18, G + 4, 52, BRICK);            // 側邊磚牆
  S(17, G + 2, 47, 18, G + 3, 48, AIR);
  S(27, G, 46, 29, G + 2, 48, WOOD);
  S(28, G, 56, 29, G + 1, 61, CONCRETE);
  S(8, G, 60, 10, G + 2, 62, WOOD);
  S(11, G, 61, 12, G + 1, 62, WOOD);

  // ── 角落高台（另外兩個角落）──
  S(72, G + 7, 5, 90, G + 7, 22, METAL);
  S(72, G, 5, 73, G + 6, 6, CONCRETE); S(89, G, 5, 90, G + 6, 6, CONCRETE);
  S(72, G, 21, 73, G + 6, 22, CONCRETE); S(89, G, 21, 90, G + 6, 22, CONCRETE);
  S(72, G + 8, 5, 72, G + 9, 22, CONCRETE);      // 護牆
  S(72, G + 8, 22, 90, G + 9, 22, CONCRETE);
  S(72, G + 8, 9, 72, G + 9, 11, AIR);           // 樓梯口
  S(78, G + 9, 22, 79, G + 9, 22, AIR); S(84, G + 9, 22, 85, G + 9, 22, AIR);
  S(72, G + 9, 15, 72, G + 9, 16, AIR);
  for (let i = 0; i < 8; i++) S(64 + i, G, 9, 64 + i, G + i, 11, WOOD); // 樓梯
  S(78, G, 12, 80, G + 2, 14, WOOD);             // 高台下的箱子
  S(84, G, 17, 85, G + 3, 18, CONCRETE);
}
