import { BS } from './config.js';

// 方塊代號（跟 world.js 的 B 一致，這裡重寫一份避免循環引用）
const AIR = 0, BEDROCK = 1, GROUND = 2, CONCRETE = 3, BRICK = 4, WOOD = 5, METAL = 6, WALL = 7,
  CONT_R = 8, CONT_B = 9, CONT_Y = 10, SAND = 11, SANDGROUND = 12, PLASTER = 13;

export const G = 3; // 地面上第一格可站立的高度（方塊）
const m = (c) => (c + 0.5) * BS;

// 地基 + 外圍牆。x0..x1 / z0..z1 是可活動範圍外那圈牆的位置
function base(w, ground, x0 = 0, z0 = 0, x1 = w.X - 1, z1 = w.Z - 1) {
  w.box(0, 0, 0, w.X - 1, 0, w.Z - 1, BEDROCK);          // 最底層打不壞
  w.box(0, 1, 0, w.X - 1, G - 1, w.Z - 1, ground);       // 上面兩層可以炸出彈坑
  const WH = 22;
  w.box(x0, 1, z0, x0 + 1, WH, z1, WALL); w.box(x1 - 1, 1, z0, x1, WH, z1, WALL);
  w.box(x0, 1, z0, x1, WH, z0 + 1, WALL); w.box(x0, 1, z1 - 1, x1, WH, z1, WALL);
}

// ═════════ 1. 廢墟廣場：開闊、中央兩層塔、角落高台（繞中心旋轉 180° 對稱）═════════
function buildPlaza(w) {
  const S = (...a) => w.boxSym(...a);
  base(w, GROUND);

  // 中央塔（40..55）
  const c0 = 40, c1 = 55;
  S(c0, G, c0, c1, G + 5, c0, BRICK); S(c0, G, c0, c0, G + 5, c1, BRICK);
  S(49, G, c0, 52, G + 4, c0, AIR); S(c0, G, 49, c0, G + 4, 52, AIR);        // 四個門（偏一邊，避開樓梯）
  S(c0, G + 2, 44, c0, G + 4, 45, AIR);                                      // 窗（蹲跳鑽得過）
  w.box(c0, G + 6, c0, c1, G + 6, c1, WOOD);                                 // 二樓木地板
  S(41, G + 6, 41, 47, G + 6, 42, AIR);                                      // 樓梯口
  for (let i = 0; i < 7; i++) S(47 - i, G, 41, 47 - i, G + i, 42, WOOD);     // 樓梯
  S(c0, G + 7, c0, c1, G + 9, c0, CONCRETE); S(c0, G + 7, c0, c0, G + 9, c1, CONCRETE); // 女兒牆 1.5m：站著能打、蹲下躲得住
  S(45, G + 9, c0, 46, G + 9, c0, AIR); S(49, G + 9, c0, 50, G + 9, c0, AIR);
  S(c0, G + 9, 45, c0, G + 9, 46, AIR); S(c0, G + 9, 49, c0, G + 9, 50, AIR);
  S(c1 - 1, G + 7, c0, c1, G + 11, c0 + 1, CONCRETE);

  // 出生點的 L 型磚牆
  S(24, G, 10, 25, G + 5, 25, BRICK);
  S(10, G, 24, 25, G + 5, 25, BRICK);
  S(24, G + 2, 16, 25, G + 4, 17, AIR);
  S(16, G + 2, 24, 17, G + 4, 25, AIR);

  // 對角線上的掩體
  S(31, G, 31, 36, G + 3, 32, CONCRETE);
  S(31, G, 33, 32, G + 3, 36, CONCRETE);
  S(34, G, 35, 35, G + 1, 36, WOOD);

  // 邊路
  S(34, G, 5, 35, G + 2, 14, CONCRETE);
  S(43, G, 11, 45, G + 2, 13, WOOD);
  S(46, G, 12, 47, G + 1, 13, WOOD);
  S(44, G + 3, 12, 45, G + 4, 13, WOOD);
  S(44, G, 24, 51, G + 4, 25, BRICK);
  S(47, G + 2, 24, 48, G + 3, 25, AIR);
  S(56, G, 17, 57, G + 9, 18, CONCRETE);
  S(36, G, 20, 37, G + 9, 21, CONCRETE);
  S(60, G, 29, 65, G + 1, 30, CONCRETE);
  S(58, G, 33, 59, G + 4, 37, BRICK);
  S(17, G, 43, 18, G + 4, 52, BRICK);
  S(17, G + 2, 47, 18, G + 3, 48, AIR);
  S(27, G, 46, 29, G + 2, 48, WOOD);
  S(28, G, 56, 29, G + 1, 61, CONCRETE);
  S(8, G, 60, 10, G + 2, 62, WOOD);
  S(11, G, 61, 12, G + 1, 62, WOOD);

  // 角落高台
  S(72, G + 7, 5, 90, G + 7, 22, METAL);
  S(72, G, 5, 73, G + 6, 6, CONCRETE); S(89, G, 5, 90, G + 6, 6, CONCRETE);
  S(72, G, 21, 73, G + 6, 22, CONCRETE); S(89, G, 21, 90, G + 6, 22, CONCRETE);
  S(72, G + 8, 5, 72, G + 9, 22, CONCRETE);
  S(72, G + 8, 22, 90, G + 9, 22, CONCRETE);
  S(72, G + 8, 9, 72, G + 9, 11, AIR);
  S(78, G + 9, 22, 79, G + 9, 22, AIR); S(84, G + 9, 22, 85, G + 9, 22, AIR);
  S(72, G + 9, 15, 72, G + 9, 16, AIR);
  for (let i = 0; i < 8; i++) S(64 + i, G, 9, 64 + i, G + i, 11, WOOD);
  S(78, G, 12, 80, G + 2, 14, WOOD);
  S(84, G, 17, 85, G + 3, 18, CONCRETE);
}

// ═════════ 2. 三線街區：長巷 / 中路 / 隧道（以 z 中線鏡像）═════════
// 南北各一個出生區，中間三條路：
//   西邊「長巷」露天、視線長，適合狙擊
//   中路兩側是倉庫（一層＋屋頂）和公寓（兩層），公寓二樓有木橋跨過中央橫街
//   東邊「隧道」有屋頂、轉角多，適合近戰；屋頂上也能走
function buildLanes(w) {
  const M = (...a) => w.boxMir(...a);
  base(w, SANDGROUND);

  // 出生區掩體
  M(40, G, 16, 55, G + 2, 17, CONCRETE);
  M(30, G, 8, 32, G + 2, 10, WOOD); M(62, G, 8, 64, G + 2, 10, WOOD);

  // 分隔牆（中間 z 44..51 留空，就是中央橫街的出入口）
  M(20, G, 18, 21, G + 7, 43, SAND); M(74, G, 18, 75, G + 7, 43, SAND);
  M(20, G, 30, 21, G + 4, 33, AIR);    // 長巷 ↔ 倉庫
  M(74, G, 24, 75, G + 4, 27, AIR);    // 隧道 ↔ 公寓

  // 倉庫（中路西側，一層樓 + 木屋頂）
  M(22, G, 20, 39, G + 5, 20, PLASTER); M(22, G, 41, 39, G + 5, 41, PLASTER); M(39, G, 20, 39, G + 5, 41, PLASTER);
  M(22, G + 6, 20, 39, G + 6, 41, WOOD);
  M(29, G, 20, 32, G + 4, 20, AIR); M(26, G, 41, 29, G + 4, 41, AIR); M(39, G, 23, 39, G + 4, 26, AIR);
  M(39, G + 2, 30, 39, G + 4, 32, AIR);                      // 朝中路的窗，蹲跳鑽得過
  M(24, G, 35, 26, G + 1, 37, WOOD); M(34, G, 22, 36, G + 2, 23, WOOD);
  M(40, G, 40, 41, G + 1, 41, WOOD); M(40, G, 38, 41, G + 3, 39, WOOD); M(40, G, 36, 41, G + 5, 37, WOOD); // 木箱階梯上屋頂

  // 公寓（中路東側，兩層）
  M(56, G, 20, 73, G + 5, 20, BRICK); M(56, G, 41, 73, G + 5, 41, BRICK); M(56, G, 20, 56, G + 5, 41, BRICK);
  M(56, G + 6, 20, 73, G + 6, 41, WOOD);
  M(60, G + 6, 38, 66, G + 6, 40, AIR);
  for (let i = 0; i < 7; i++) M(60 + i, G, 38, 60 + i, G + i, 40, WOOD);
  M(56, G, 34, 56, G + 4, 37, AIR); M(62, G, 20, 65, G + 4, 20, AIR);
  M(56, G + 7, 20, 73, G + 9, 20, CONCRETE); M(56, G + 7, 20, 56, G + 9, 41, CONCRETE); M(56, G + 7, 41, 73, G + 9, 41, CONCRETE);
  M(56, G + 9, 26, 56, G + 9, 27, AIR); M(56, G + 9, 33, 56, G + 9, 34, AIR);
  M(68, G + 7, 41, 71, G + 9, 41, AIR);                      // 上橋的缺口
  w.box(68, G + 6, 42, 71, G + 6, 53, WOOD);                 // 木橋（可以被打斷）
  M(58, G, 22, 60, G + 1, 24, WOOD);

  // 中路
  w.box(45, G, 45, 50, G + 3, 50, CONCRETE);                 // 中央水泥塊，擋住出生點互看
  w.box(46, G + 4, 46, 47, G + 5, 47, WOOD);
  M(41, G, 28, 43, G + 2, 30, WOOD); M(52, G, 24, 54, G + 1, 26, WOOD);

  // 長巷
  M(8, G, 26, 10, G + 2, 28, WOOD); M(2, G, 36, 9, G + 1, 37, CONCRETE);
  w.box(6, G, 43, 10, G + 4, 52, CONT_B);
  M(11, G, 45, 12, G + 1, 46, WOOD);                         // 踩箱子蹲跳上貨櫃
  M(16, G, 21, 18, G + 1, 22, WOOD);

  // 隧道
  M(76, G + 5, 20, 93, G + 5, 47, CONCRETE);
  M(82, G + 5, 45, 87, G + 5, 47, AIR);                      // 天窗
  M(76, G, 28, 87, G + 4, 29, BRICK); M(82, G, 38, 93, G + 4, 39, BRICK);
  M(90, G, 33, 92, G + 1, 35, WOOD); M(77, G, 44, 78, G + 2, 46, WOOD);
  M(86, G, 17, 87, G + 1, 19, WOOD); M(88, G, 17, 89, G + 3, 19, WOOD); // 木箱階梯上隧道屋頂
}

// ═════════ 3. 貨櫃碼頭：小而立體，到處是可以跳、蹲跳的箱子（旋轉 180° 對稱）═════════
// 貨櫃：長 6m、寬 2.5m。實心的高 2.5m；空心的高 3m、兩端開口，裡面淨寬 1.5m、淨高 2m，可以當通道
function container(w, x0, y0, z0, alongX, type, hollow) {
  const x1 = x0 + (alongX ? 11 : 4), z1 = z0 + (alongX ? 4 : 11), top = y0 + (hollow ? 5 : 4);
  w.boxSym(x0, y0, z0, x1, top, z1, type);
  if (!hollow) return;
  if (alongX) w.boxSym(x0, y0 + 1, z0 + 1, x1, top - 1, z1 - 1, AIR);
  else w.boxSym(x0 + 1, y0 + 1, z0, x1 - 1, top - 1, z1, AIR);
}

function buildYard(w) {
  const S = (...a) => w.boxSym(...a);
  base(w, GROUND, 12, 12, 83, 83);

  // 出生點旁的 L 型貨櫃
  container(w, 24, G, 22, true, CONT_R, true);
  container(w, 22, G, 30, false, CONT_B, false);

  // 中央：兩個並排 + 上面再疊一個空貨櫃（高處通道）
  S(42, G, 43, 53, G + 4, 47, CONT_Y);
  w.box(44, G + 5, 45, 51, G + 10, 50, CONT_R);                               // 上層短一點，兩端各留 1m 平台
  w.box(44, G + 6, 46, 51, G + 9, 49, AIR);
  S(38, G, 43, 39, G + 1, 45, WOOD); S(40, G, 43, 41, G + 3, 45, WOOD);      // 木箱階梯上第一層
  S(42, G + 5, 43, 43, G + 6, 44, WOOD); S(44, G + 5, 43, 45, G + 8, 44, WOOD); // 再兩個箱子上最頂層（護甲在上面）

  // 其他貨櫃
  container(w, 60, G, 20, false, CONT_B, false);
  container(w, 68, G, 34, true, CONT_Y, true);
  container(w, 30, G, 50, false, CONT_R, false);
  container(w, 66, G, 15, true, CONT_R, false);
  S(66, G + 5, 15, 77, G + 9, 19, CONT_B);

  // 木箱：1m 的直接跳、1.5m 的要蹲跳
  S(48, G, 30, 50, G + 2, 32, WOOD); S(51, G, 30, 52, G + 1, 31, WOOD);
  S(36, G, 34, 37, G + 1, 35, WOOD);
  S(16, G, 44, 18, G + 2, 46, WOOD); S(16, G + 3, 44, 17, G + 4, 45, WOOD);
  S(56, G, 24, 58, G + 1, 26, WOOD);
  S(44, G, 60, 45, G + 3, 61, CONCRETE);
  S(34, G, 16, 36, G + 1, 18, WOOD);
}

// 每張地圖：名稱、建造函式、兩個出生點（yaw 面向對手方向）、補給品
export const MAPS = {
  plaza: {
    name: '廢墟廣場', desc: '開闊場地，中央兩層塔與角落高台',
    build: buildPlaza,
    spawns: [
      { x: m(13), y: G * BS, z: m(13), yaw: -Math.PI * 0.75 },
      { x: m(82), y: G * BS, z: m(82), yaw: Math.PI * 0.25 },
    ],
    pickups: [
      { type: 'hp', amount: 40, x: m(47.5), y: G * BS, z: m(17.5) },
      { type: 'hp', amount: 40, x: m(47.5), y: G * BS, z: m(77.5) },
      { type: 'armor', amount: 50, x: m(47.5), y: (G + 7) * BS, z: m(47.5), respawn: 30 },
      { type: 'hp', amount: 25, x: m(81), y: (G + 8) * BS, z: m(13.5) },
      { type: 'hp', amount: 25, x: m(14), y: (G + 8) * BS, z: m(81.5) },
    ],
  },
  lanes: {
    name: '三線街區', desc: '長巷、中路、隧道三條路線',
    build: buildLanes,
    spawns: [
      { x: m(47.5), y: G * BS, z: m(7), yaw: Math.PI },
      { x: m(47.5), y: G * BS, z: m(88), yaw: 0 },
    ],
    pickups: [
      { type: 'hp', amount: 40, x: m(15), y: G * BS, z: m(47.5) },
      { type: 'hp', amount: 40, x: m(84.5), y: G * BS, z: m(47.5) },
      { type: 'armor', amount: 50, x: m(69.5), y: (G + 7) * BS, z: m(47.5), respawn: 30 },
      { type: 'hp', amount: 25, x: m(30), y: G * BS, z: m(30) },
      { type: 'hp', amount: 25, x: m(30), y: G * BS, z: m(65) },
    ],
  },
  yard: {
    name: '貨櫃碼頭', desc: '小而立體，考驗跳箱子的身法',
    build: buildYard,
    spawns: [
      { x: m(17.5), y: G * BS, z: m(17.5), yaw: -Math.PI * 0.75 },
      { x: m(77.5), y: G * BS, z: m(77.5), yaw: Math.PI * 0.25 },
    ],
    pickups: [
      { type: 'hp', amount: 40, x: m(47.5), y: G * BS, z: m(22) },
      { type: 'hp', amount: 40, x: m(47.5), y: G * BS, z: m(73) },
      { type: 'armor', amount: 50, x: m(47.5), y: (G + 11) * BS, z: m(47.5), respawn: 30 },
      { type: 'hp', amount: 25, x: m(29.5), y: (G + 1) * BS, z: m(24) },
      { type: 'hp', amount: 25, x: m(65.5), y: (G + 1) * BS, z: m(71) },
    ],
  },
};
export const MAP_IDS = Object.keys(MAPS);
