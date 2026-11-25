import { BS, WORLD } from './config.js';
import { store } from './util.js';

// 方塊代號（跟 world.js 的 B 一致，這裡重寫一份避免循環引用）
const AIR = 0, BEDROCK = 1, GROUND = 2, CONCRETE = 3, BRICK = 4, WOOD = 5, METAL = 6, WALL = 7,
  CONT_R = 8, CONT_B = 9, CONT_Y = 10, SAND = 11, SANDGROUND = 12, PLASTER = 13, ROCK = 14,
  GRASS = 15, TILE = 16, SHEET = 17, SANDBAG = 18, DIRT = 19;

// 每張地圖的「地面高度」（站立的那一格，單位：方塊）。地面越高，底下能挖的空間越多
const GP = 3, GL = 9, GY = 3, QLO = 7, QHI = 13;
const m = (c) => (c + 0.5) * BS;

// 地基 + 外圍牆。g = 地面高度；x0..z1 是外圍牆的位置（預設貼著世界邊緣）
export function base(w, ground, g, x0 = 0, z0 = 0, x1 = w.X - 1, z1 = w.Z - 1) {
  w.box(0, 0, 0, w.X - 1, 0, w.Z - 1, BEDROCK);          // 最底層打不壞
  w.box(0, 1, 0, w.X - 1, g - 2, w.Z - 1, ground === GROUND || ground === GRASS ? DIRT : ground);   // 底下的土可以炸開
  w.box(0, g - 1, 0, w.X - 1, g - 1, w.Z - 1, ground);   // 最上面一層才是路面
  const WH = Math.min(w.Y - 3, g + 19);
  w.box(x0, 1, z0, x0 + 1, WH, z1, WALL); w.box(x1 - 1, 1, z0, x1, WH, z1, WALL);
  w.box(x0, 1, z0, x1, WH, z0 + 1, WALL); w.box(x0, 1, z1 - 1, x1, WH, z1, WALL);
}

// 坡道：沿 z 方向（dz=±1）一階一階往下。寬度 x0..x1，從 zStart 開始；
// run = 每一階走幾格才降一格（1 = 樓梯 45°、2 ≈ 27°、3 ≈ 18° 緩坡）；從 hTop 格高降到 0
function rampZ(put, x0, x1, zStart, dz, run, yLo, hTop, type) {
  for (let s = 0; s < hTop; s++) for (let r = 0; r < run; r++) {
    const z = zStart + dz * (s * run + r);
    put(x0, yLo, z, x1, yLo + hTop - 1 - s, z, type);
  }
}
function rampX(put, z0, z1, xStart, dx, run, yLo, hTop, type) {
  for (let s = 0; s < hTop; s++) for (let r = 0; r < run; r++) {
    const x = xStart + dx * (s * run + r);
    put(x, yLo, z0, x, yLo + hTop - 1 - s, z1, type);
  }
}

// ═════════ 1. 廢墟廣場：開闊、中央兩層塔、角落高台（繞中心旋轉 180° 對稱）═════════
function buildPlaza(w) {
  const S = (...a) => w.boxSym(...a), G = GP;
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
  const M = (...a) => w.boxMir(...a), G = GL;
  // 地下道：從中路南段走樓梯下去，穿過中央水泥塊底下，再從北段上來（頂板只有一格厚，炸得開）
  for (let i = 0; i < 5; i++) M(46, G - 1 - i, 30 + i * 2, 49, G - 1, 39, AIR);
  M(46, G - 5, 40, 49, G - 2, 47, AIR);

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
  const S = (...a) => w.boxSym(...a), G = GY;
  // 碼頭邊的高起平台（比地面高 1m），兩端用緩坡接地
  S(14, G, 60, 26, G + 1, 81, CONCRETE);
  rampX(S, 66, 75, 27, 1, 3, G, 2, CONCRETE);
  rampZ(S, 14, 21, 59, -1, 3, G, 2, CONCRETE);

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

// ═════════ 4. 礦場：南北兩塊高地、中間是谷底，有緩坡、陡階、木橋、穿山隧道、山裡的地道（以 z 中線鏡像）═════════
function buildQuarry(w) {
  const M = (...a) => w.boxMir(...a), LO = QLO, HI = QHI, UP = HI - LO; // 高地比谷底高 6 格 = 3m
  // 南北高地（出生點在上面）
  M(2, LO, 2, 93, HI - 1, 25, ROCK);
  // 三條下谷的路：西邊緩坡、中間陡階、東邊中等坡
  rampZ(M, 6, 15, 26, 1, 3, LO, UP - 1, ROCK);
  rampZ(M, 46, 51, 26, 1, 1, LO, UP - 1, ROCK);
  rampZ(M, 80, 89, 26, 1, 2, LO, UP - 1, ROCK);

  // 山裡的地道：從高地上走樓梯下去，在山壁開口通到谷底（有頂、對面看不到你下山）
  for (let i = 0; i < 6; i++) M(66, HI - 1 - i, 12 + i * 2, 69, Math.min(HI - 1, HI + 2 - i), 13 + i * 2, AIR);
  M(66, LO, 24, 69, LO + 3, 25, AIR);

  // 中央台地（跟高地一樣高），裡面挖了十字形的礦坑隧道
  w.box(34, LO, 36, 61, HI - 1, 59, ROCK);
  w.box(34, LO, 46, 61, LO + 3, 49, AIR);
  w.box(46, LO, 36, 49, LO + 3, 59, AIR);
  w.box(55, LO + 4, 46, 58, HI - 1, 49, AIR);            // 台地頂上的豎井，可以直接跳進隧道
  w.box(44, HI, 44, 51, HI + 5, 51, ROCK);               // 山頂岩柱，擋住南北互看
  M(36, HI, 40, 39, HI + 2, 41, ROCK);
  M(52, HI, 38, 54, HI + 1, 40, WOOD);
  // 木橋：高地 ↔ 中央台地（底下是谷底，橋可以被打斷）
  M(40, HI - 1, 26, 43, HI - 1, 35, WOOD);

  // 高地上的掩體
  M(22, HI, 20, 31, HI + 2, 21, CONCRETE); M(58, HI, 20, 63, HI + 2, 21, CONCRETE);
  M(44, HI, 15, 46, HI + 2, 17, WOOD); M(47, HI, 16, 48, HI + 1, 17, WOOD);
  M(72, HI, 8, 74, HI + 1, 10, WOOD); M(18, HI, 8, 20, HI + 2, 10, WOOD);
  M(70, HI, 14, 71, HI + 3, 23, ROCK);                   // 地道入口旁的岩壁

  // 谷底：東邊有一塊半高的平台（比谷底高 1.5m），兩側用坡接上
  w.box(72, LO, 40, 93, LO + 2, 55, ROCK);
  rampX(w.box.bind(w), 44, 51, 71, -1, 2, LO, 3, ROCK);
  M(84, LO + 3, 44, 86, LO + 4, 46, WOOD);
  // 谷底西邊的石塊與木箱
  M(8, LO, 44, 11, LO + 2, 46, ROCK); M(20, LO, 40, 22, LO + 1, 42, WOOD);
  M(26, LO, 44, 27, LO + 4, 47, ROCK);
  M(64, LO, 38, 66, LO + 1, 40, WOOD);
}

// ═════════ 四張小地圖的新版（2026-11-25）：原本 48×48 公尺的內容整個放在正中間，四周往外擴 8 公尺 ═════════
// 新地圖 64×64 公尺。外面那一圈各自加了可以爬的高建築、新的路線、掩體和裝飾。
// 地圖編輯器還是可以拿舊的 48×48 版本當底圖（MAPS 裡的 ed）。
const SMALL = { X: 128, Y: 32, Z: 128 }, OFF = 16;
// 給舊內容用的世界：座標全部 +OFF，對稱、鏡像都以整張新地圖的中心為準（剛好跟舊的一樣）
function shifted(w) {
  const o = { X: 96, Y: w.Y, Z: 96, box: (x0, y0, z0, x1, y1, z1, t) => w.box(x0 + OFF, y0, z0 + OFF, x1 + OFF, y1, z1 + OFF, t) };
  o.boxSym = (x0, y0, z0, x1, y1, z1, t) => { o.box(x0, y0, z0, x1, y1, z1, t); o.box(95 - x1, y0, 95 - z1, 95 - x0, y1, 95 - z0, t); };
  o.boxMir = (x0, y0, z0, x1, y1, z1, t) => { o.box(x0, y0, z0, x1, y1, z1, t); o.box(x0, y0, 95 - z1, x1, y1, 95 - z0, t); };
  return o;
}
const sh = (o) => ({ ...o, x: o.x + OFF * BS, z: o.z + OFF * BS });   // 舊的出生點、補給品搬到新地圖
// 路燈：一根鐵柱、頂上橫出去一截燈罩
function lamp(put, x, G, z, h = 8) { put(x, G, z, x, G + h, z, METAL); put(x, G + h, z, x + 1, G + h, z, SHEET); }
// 車：車身、車頂（燒過的就是黑的鐵皮）
function car(put, x, G, z, alongX) {
  if (alongX) { put(x, G, z, x + 7, G + 1, z + 3, METAL); put(x + 2, G + 2, z, x + 5, G + 2, z + 3, SHEET); }
  else { put(x, G, z, x + 3, G + 1, z + 7, METAL); put(x, G + 2, z + 2, x + 3, G + 2, z + 5, SHEET); }
}

// ── 廢墟廣場：兩個角落各一座三層的鐘樓廢墟（爬得到頂），外圈幾棟兩層的破房子、燒掉的車、瓦礫、路燈 ──
function plazaRing(w) {
  const S = (...a) => w.boxSym(...a), G = GP;
  bigTower(S, G, 2, 2, 13, 3, BRICK, ['xmax', 'zmax']);                      // 西南角（東北角對稱）
  S(14, G + 8, 5, 14, G + 10, 9, AIR); S(5, G + 14, 14, 9, G + 16, 14, AIR);  // 被炸開的大洞（往場內看）
  // 南邊一排房子：兩層、一層各一棟，牆上有破洞
  bigTower(S, G, 20, 2, 13, 2, PLASTER, ['zmax', 'xmin']);
  S(24, G + 8, 14, 28, G + 10, 14, AIR); S(32, G + 7, 6, 32, G + 10, 9, AIR);
  bigTower(S, G, 36, 2, 12, 1, BRICK, ['zmax', 'xmax']);
  S(40, G + 2, 13, 43, G + 4, 13, AIR);
  // 西邊：兩層的倉庫廢墟、一層的小屋
  bigTower(S, G, 2, 20, 13, 2, BRICK, ['xmax', 'zmax']);
  S(14, G + 8, 24, 14, G + 10, 28, AIR);
  bigTower(S, G, 2, 37, 12, 1, PLASTER, ['xmax', 'zmin']);
  // 南邊東半：燒掉的車、瓦礫堆、半倒的矮牆
  car(S, 64, G, 5, true); car(S, 80, G, 9, false);
  S(90, G, 4, 94, G, 8, BRICK); S(91, G + 1, 5, 93, G + 1, 7, BRICK); S(92, G + 2, 6, 92, G + 2, 6, CONCRETE);
  S(98, G, 11, 108, G + 2, 12, CONCRETE); S(102, G, 11, 103, G + 2, 12, AIR);
  S(56, G, 10, 58, G + 1, 12, WOOD);
  // 西邊北半：一台燒掉的公車（走得進去）、沙包堆
  S(4, G, 66, 9, G + 5, 86, METAL); S(5, G + 1, 66, 8, G + 4, 86, AIR); S(9, G + 1, 74, 9, G + 4, 77, AIR);   // 車裡淨高 2 公尺
  S(5, G + 1, 66, 8, G + 4, 66, SHEET); S(5, G + 1, 86, 8, G + 4, 86, SHEET);   // 兩頭是車頭車尾（打得穿），從側門進去
  S(10, G, 82, 11, G + 1, 85, WOOD); S(10, G + 2, 84, 11, G + 3, 85, WOOD);   // 木箱階梯：爬上公車頂
  S(6, G, 54, 13, G + 2, 55, SANDBAG); S(12, G, 98, 14, G + 2, 104, SANDBAG);
  S(4, G, 106, 7, G, 109, CONCRETE); S(5, G + 1, 107, 6, G + 1, 108, BRICK);
  for (const [x, z] of [[17, 16], [60, 14], [86, 14], [16, 60], [16, 92]]) lamp(S, x, G, z);
}

// ── 三線街區：最外面多一條後巷、兩棟三層公寓；出生區後面是停車場；東邊鐵軌上有貨車廂 ──
function lanesRing(w) {
  const M = (...a) => w.boxMir(...a), G = GL;
  bigTower(M, G, 2, 20, 14, 3, BRICK, ['xmax', 'zmax']);                    // 西邊後巷的公寓（北邊對稱）
  M(15, G + 8, 25, 15, G + 10, 28, AIR); M(15, G + 14, 25, 15, G + 16, 28, AIR);   // 每層朝巷子的大窗
  M(6, G, 40, 8, G + 2, 42, WOOD); M(10, G, 48, 12, G + 1, 50, WOOD); M(4, G, 56, 6, G + 3, 58, CONT_Y);   // 後巷的雜物
  // 停車場：矮圍牆（中間留出入口）、幾台車
  M(30, G, 13, 54, G + 1, 14, CONCRETE); M(74, G, 13, 98, G + 1, 14, CONCRETE);
  car(M, 34, G, 3, false); car(M, 44, G, 4, false); car(M, 80, G, 3, false); car(M, 90, G, 5, false);
  M(60, G, 4, 67, G + 2, 5, WOOD);
  for (const [x, z] of [[28, 8], [100, 8], [16, 36], [16, 52]]) lamp(M, x, G, z);
  // 東邊：鐵軌（埋在地上）、兩節貨車廂當掩體，車廂之間留路
  M(114, G - 1, 2, 114, G - 1, 63, METAL); M(119, G - 1, 2, 119, G - 1, 63, METAL);
  M(112, G, 22, 121, G + 4, 38, CONT_R); M(112, G, 46, 121, G + 4, 58, CONT_B);
  M(116, G + 5, 30, 118, G + 6, 32, WOOD);
  M(110, G, 36, 111, G + 5, 63, BRICK); M(110, G, 40, 111, G + 4, 42, AIR); M(110, G, 56, 111, G + 4, 58, AIR);   // 隧道東邊的牆（原本是外圍牆），開兩個門到鐵道
  M(122, G, 40, 123, G + 1, 42, WOOD); M(122, G, 43, 123, G + 3, 44, WOOD);   // 箱子：跳上車廂頂
}

// ── 貨櫃碼頭：拆掉原本那圈圍牆；外面有貨櫃（單層的有木箱可以爬上去、兩層的當高牆）、角落有起重機塔（吊臂可以走出去）、西邊有倉庫 ──
function yardRing(w) {
  const S = (...a) => w.boxSym(...a), G = GY;
  // 起重機塔（西南、東北）：兩層的鐵塔，頂上一支吊臂往場內伸出去 10 公尺，可以走到吊臂上
  bigTower(S, G, 3, 34, 12, 2, METAL, ['xmax', 'zmin']);
  S(14, G + 12, 39, 14, G + 13, 40, AIR); S(15, G + 11, 39, 34, G + 11, 40, METAL);
  S(34, G + 12, 39, 34, G + 12, 40, METAL);                                  // 吊臂尾端擋一下
  // 南邊：一排貨櫃（兩層的爬不上去、單層的旁邊有木箱階梯）
  container(w, 6, G, 3, true, CONT_B, false); container(w, 6, G + 5, 3, true, CONT_R, true);
  container(w, 22, G, 3, true, CONT_Y, true);
  container(w, 40, G, 3, true, CONT_R, false); container(w, 40, G + 5, 3, true, CONT_Y, false);
  S(34, G, 4, 35, G + 1, 7, WOOD); S(34, G + 2, 4, 35, G + 3, 5, WOOD);      // 木箱階梯：爬上黃色貨櫃頂（3 公尺）
  container(w, 60, G, 10, false, CONT_B, true);
  container(w, 74, G, 4, true, CONT_R, false);
  container(w, 92, G, 4, true, CONT_Y, true);
  // 西邊：倉庫（一層、可以上屋頂）、貨櫃
  bigTower(S, G, 3, 60, 12, 1, PLASTER, ['xmax', 'zmin', 'zmax']);
  container(w, 4, G, 78, false, CONT_R, true); container(w, 10, G, 90, false, CONT_B, false);
  // 裝飾：堆高機、油桶、照明燈塔
  S(20, G, 18, 23, G + 1, 21, METAL); S(23, G + 2, 18, 23, G + 4, 21, METAL);
  for (const [x, z] of [[30, 6], [31, 6], [30, 7], [100, 16], [8, 104], [9, 104]]) S(x, G, z, x, G + 1, z, SHEET);
  for (const [x, z] of [[18, 28], [58, 18], [18, 100]]) lamp(S, x, G, z, 12);
}

// ── 礦場：南北高地往外延伸，各有一座兩層的木造礦井架（爬得到頂）；谷底西邊有礦工小屋、東邊平台延伸出去，有礦車軌道 ──
function quarryRing(w) {
  const M = (...a) => w.boxMir(...a), B = (...a) => w.box(...a), LO = QLO, HI = QHI;
  M(2, LO, 2, 125, HI - 1, 17, ROCK);                                        // 高地往外延伸
  M(2, LO, 18, 17, HI - 1, 41, ROCK); M(110, LO, 18, 125, HI - 1, 41, ROCK);
  bigTower(M, HI, 8, 3, 12, 2, WOOD, ['xmax', 'zmax']);                      // 礦井架
  M(19, HI + 8, 6, 19, HI + 10, 10, AIR);
  M(30, HI, 6, 33, HI + 1, 9, WOOD); M(90, HI, 8, 99, HI + 2, 9, ROCK); M(104, HI, 4, 106, HI + 3, 6, ROCK);
  for (const [x, z] of [[24, 14], [100, 14]]) lamp(M, x, HI, z, 6);
  // 谷底西邊：礦工小屋（正中間，自己就是對稱的）、岩棚
  bigTower(B, LO, 3, 58, 12, 1, WOOD, ['xmax']);
  M(2, LO, 42, 8, LO + 3, 52, ROCK); rampX(M, 44, 52, 9, 1, 2, LO, 3, ROCK);   // 岩棚（貼著高地，跳一下就上高地），東邊一道緩坡下谷底
  M(12, LO, 46, 14, LO + 1, 48, WOOD);
  // 谷底東邊：平台延伸出去、礦車軌道、兩台礦車
  B(110, LO, 56, 125, LO + 2, 71, ROCK);
  M(114, LO + 2, 50, 114, LO + 2, 63, METAL); M(118, LO + 2, 50, 118, LO + 2, 63, METAL);
  B(114, LO, 50, 118, LO + 2, 55, ROCK); B(114, LO, 72, 118, LO + 2, 77, ROCK);
  M(113, LO + 3, 58, 119, LO + 4, 61, SHEET);
  M(120, LO, 46, 123, LO + 2, 48, WOOD);
}

function buildPlazaV2(w) { base(w, GROUND, GP); buildPlaza(shifted(w)); plazaRing(w); }
function buildLanesV2(w) { base(w, SANDGROUND, GL); buildLanes(shifted(w)); lanesRing(w); }
function buildYardV2(w) { base(w, GROUND, GY); buildYard(shifted(w)); yardRing(w); }
function buildQuarryV2(w) { base(w, ROCK, QLO); buildQuarry(shifted(w)); quarryRing(w); }

// 舊版（48×48）：地圖編輯器拿來當底圖用
const PLAZA0 = {
  build: (w) => { base(w, GROUND, GP); buildPlaza(w); },
  spawns: [
    { x: m(13), y: GP * BS, z: m(13), yaw: -Math.PI * 0.75 },
    { x: m(82), y: GP * BS, z: m(82), yaw: Math.PI * 0.25 },
  ],
  pickups: [
    { type: 'hp', amount: 40, x: m(47.5), y: GP * BS, z: m(17.5) },
    { type: 'hp', amount: 40, x: m(47.5), y: GP * BS, z: m(77.5) },
    { type: 'armor', amount: 50, x: m(47.5), y: (GP + 7) * BS, z: m(47.5), respawn: 30 },
    { type: 'hp', amount: 25, x: m(81), y: (GP + 8) * BS, z: m(13.5) },
    { type: 'hp', amount: 25, x: m(14), y: (GP + 8) * BS, z: m(81.5) },
  ],
};
const LANES0 = {
  build: (w) => { base(w, SANDGROUND, GL); buildLanes(w); },
  spawns: [
    { x: m(47.5), y: GL * BS, z: m(7), yaw: Math.PI },
    { x: m(47.5), y: GL * BS, z: m(88), yaw: 0 },
  ],
  pickups: [
    { type: 'hp', amount: 40, x: m(15), y: GL * BS, z: m(47.5) },
    { type: 'hp', amount: 40, x: m(84.5), y: GL * BS, z: m(47.5) },
    { type: 'armor', amount: 50, x: m(69.5), y: (GL + 7) * BS, z: m(47.5), respawn: 30 },
    { type: 'hp', amount: 25, x: m(30), y: GL * BS, z: m(30) },
    { type: 'hp', amount: 25, x: m(30), y: GL * BS, z: m(65) },
    { type: 'hp', amount: 25, x: m(47.5), y: (GL - 5) * BS, z: m(47.5) },   // 地下道正中間
  ],
};
const YARD0 = {
  build: (w) => { base(w, GROUND, GY, 12, 12, 83, 83); buildYard(w); },
  spawns: [
    { x: m(17.5), y: GY * BS, z: m(17.5), yaw: -Math.PI * 0.75 },
    { x: m(77.5), y: GY * BS, z: m(77.5), yaw: Math.PI * 0.25 },
  ],
  pickups: [
    { type: 'hp', amount: 40, x: m(47.5), y: GY * BS, z: m(22) },
    { type: 'hp', amount: 40, x: m(47.5), y: GY * BS, z: m(73) },
    { type: 'armor', amount: 50, x: m(47.5), y: (GY + 11) * BS, z: m(47.5), respawn: 30 },
    { type: 'hp', amount: 25, x: m(29.5), y: (GY + 1) * BS, z: m(24) },
    { type: 'hp', amount: 25, x: m(65.5), y: (GY + 1) * BS, z: m(71) },
  ],
};
const QUARRY0 = {
  build: (w) => { base(w, ROCK, QLO); buildQuarry(w); },
  spawns: [
    { x: m(47.5), y: QHI * BS, z: m(7), yaw: Math.PI },
    { x: m(47.5), y: QHI * BS, z: m(88), yaw: 0 },
  ],
  pickups: [
    { type: 'hp', amount: 40, x: m(15), y: QLO * BS, z: m(47.5) },
    { type: 'hp', amount: 40, x: m(82), y: (QLO + 3) * BS, z: m(47.5) },
    { type: 'armor', amount: 50, x: m(47.5), y: QLO * BS, z: m(47.5), respawn: 30 },   // 礦坑隧道的十字路口
    { type: 'hp', amount: 25, x: m(41.5), y: QHI * BS, z: m(38.5) },
    { type: 'hp', amount: 25, x: m(41.5), y: QHI * BS, z: m(56.5) },
  ],
};

// 每張地圖：名稱、建造函式、兩個出生點（yaw 面向對手方向）、補給品
// ═════════ 5. 城堡要塞：大地圖（72 × 72 公尺），中央城堡、四座哨塔、兩側民房（繞中心旋轉 180° 對稱）═════════
// 出生點在東西兩側，中間被城堡擋住。城堡兩層樓可以爬上屋頂；四個角落各一座四層高的哨塔，塔裡有樓梯一路走到頂。
// 可以爬上去的塔（城堡哨塔、民房、河谷的側塔和主塔共用）。put = boxSym 或 box；n×n 外牆、levels 層樓；
// 每層 6 格高（3 公尺）；樓梯 3 格寬、6 階，沿著南牆往東、北牆往西來回爬，兩頭都有平台，樓梯口旁邊有欄杆；
// 頂樓是平台，一圈女兒牆加城垛。doors：開門的牆（'xmin'／'xmax'／'zmin'／'zmax'）。n 至少 12
function bigTower(put, G, x0, z0, n, levels, mat, doors) {
  const x1 = x0 + n - 1, z1 = z0 + n - 1, ix0 = x0 + 1, ix1 = x1 - 1, iz0 = z0 + 1, iz1 = z1 - 1, top = G - 1 + 6 * levels, mid = Math.floor((n - 1) / 2);
  put(x0, G, z0, x1, top, z0, mat); put(x0, G, z1, x1, top, z1, mat); put(x0, G, z0, x0, top, z1, mat); put(x1, G, z0, x1, top, z1, mat);
  for (let k = 1; k <= levels; k++) put(ix0, G - 1 + 6 * k, iz0, ix1, G - 1 + 6 * k, iz1, k === levels ? mat : WOOD);   // 樓板、頂樓
  for (const d of doors) {                                                    // 門：1.5 公尺寬、2.5 公尺高
    if (d === 'xmin') put(x0, G, z0 + mid - 1, x0, G + 4, z0 + mid + 1, AIR);
    if (d === 'xmax') put(x1, G, z0 + mid - 1, x1, G + 4, z0 + mid + 1, AIR);
    if (d === 'zmin') put(ix1 - 1, G, z0, ix1, G + 4, z0, AIR);              // 南牆中間是一樓的樓梯：門開在東邊的平台旁
    if (d === 'zmax') put(x0 + mid - 1, G, z1, x0 + mid + 1, G + 4, z1, AIR);
  }
  for (let k = 0; k < levels; k++) {                                          // 每層四面都有窗
    const y = G + 2 + 6 * k;
    put(x0, y, z0 + mid, x0, y + 1, z0 + mid, AIR); put(x1, y, z0 + mid, x1, y + 1, z0 + mid, AIR);
    put(x0 + mid, y, z0, x0 + mid, y + 1, z0, AIR); put(x0 + mid, y, z1, x0 + mid, y + 1, z1, AIR);
  }
  for (let k = 1; k <= levels; k++) {
    const fb = G - 1 + 6 * (k - 1), ft = fb + 6, odd = k % 2 === 1;
    const za = odd ? iz0 : iz1 - 2, zb = odd ? iz0 + 2 : iz1, rail = odd ? iz0 + 3 : iz1 - 3;
    const sx = (j) => (odd ? ix0 + 2 + j : ix1 - 2 - j);
    put(Math.min(sx(-1), sx(5)), ft, za, Math.max(sx(-1), sx(5)), ft, zb, AIR);           // 樓梯上方的樓板挖開（不會撞頭）
    put(Math.min(sx(-1), sx(5)), ft + 1, rail, Math.max(sx(-1), sx(5)), ft + 1, rail, WOOD);   // 欄杆：上一層的人不會掉進樓梯口
    for (let j = 0; j < 6; j++) put(sx(j), fb + 1, za, sx(j), fb + 1 + j, zb, WOOD);
  }
  put(x0, top + 1, z0, x1, top + 2, z0, mat); put(x0, top + 1, z1, x1, top + 2, z1, mat);   // 女兒牆 1 公尺
  put(x0, top + 1, z0, x0, top + 2, z1, mat); put(x1, top + 1, z0, x1, top + 2, z1, mat);
  for (let k = 0; k < n; k += 2) { put(x0 + k, top + 3, z0, x0 + k, top + 3, z0, mat); put(x0 + k, top + 3, z1, x0 + k, top + 3, z1, mat); put(x0, top + 3, z0 + k, x0, top + 3, z0 + k, mat); put(x1, top + 3, z0 + k, x1, top + 3, z0 + k, mat); }
}

const GC = 3, CASTLE = { X: 144, Y: 32, Z: 144 };
function buildCastle(w) {
  const S = (...a) => w.boxSym(...a), G = GC;
  base(w, GRASS, G);

  // ── 中央城堡（50..93）：水泥外牆 13 格高、二樓木地板、屋頂可以站，四周有城垛 ──
  const k0 = 50, k1 = 93;
  S(k0, G, k0, k1, G + 13, k0 + 1, CONCRETE); S(k0, G, k0, k0 + 1, G + 13, k1, CONCRETE);
  S(k0, G, 68, k0 + 1, G + 5, 75, AIR);                                      // 東西兩側的大門（4 公尺寬）
  S(58, G, k0, 61, G + 4, k0 + 1, AIR);                                      // 南北的小門（偏一邊）
  S(k0, G + 2, 57, k0 + 1, G + 3, 58, AIR); S(k0, G + 2, 85, k0 + 1, G + 3, 86, AIR);   // 一樓的小窗（蹲跳鑽得過）
  S(66, G + 2, k0, 67, G + 3, k0 + 1, AIR); S(76, G + 2, k0, 77, G + 3, k0 + 1, AIR);
  w.box(k0 + 2, G + 6, k0 + 2, k1 - 2, G + 6, k1 - 2, WOOD);                // 二樓地板
  S(k0, G + 8, 60, k0 + 1, G + 10, 62, AIR); S(k0, G + 8, 81, k0 + 1, G + 10, 83, AIR);  // 二樓的窗
  S(70, G + 8, k0, 73, G + 10, k0 + 1, AIR);
  w.box(k0 + 2, G + 13, k0 + 2, k1 - 2, G + 13, k1 - 2, CONCRETE);          // 屋頂
  // 一樓大廳：四根柱子、兩側隔出小房間
  S(63, G, 63, 64, G + 5, 64, CONCRETE); S(63, G, 79, 64, G + 5, 80, CONCRETE);
  S(52, G, 62, 62, G + 5, 62, PLASTER); S(56, G, 62, 58, G + 4, 62, AIR);
  S(62, G, 52, 62, G + 5, 56, PLASTER);
  S(68, G, 66, 70, G + 1, 68, WOOD); S(74, G, 75, 75, G + 2, 77, WOOD);
  // 樓梯：一樓 → 二樓（西北角往東爬），二樓 → 屋頂（再往西爬）
  S(54, G + 6, 53, 60, G + 6, 55, AIR);
  for (let i = 0; i < 7; i++) S(60 - i, G, 53, 60 - i, G + i, 55, WOOD);
  S(53, G + 13, 57, 59, G + 13, 59, AIR);
  for (let i = 0; i < 7; i++) S(53 + i, G + 7, 57, 53 + i, G + 7 + i, 59, WOOD);
  // 二樓的掩體
  S(66, G + 7, 70, 67, G + 9, 73, BRICK); S(56, G + 7, 76, 60, G + 8, 77, WOOD);
  // 屋頂：1 公尺高的女兒牆 + 一格一格的城垛；四個角落有小塔樓可以躲
  S(k0, G + 14, k0, k1, G + 15, k0, CONCRETE); S(k0, G + 14, k0, k0, G + 15, k1, CONCRETE);
  for (let x = k0; x <= k1; x += 4) S(x, G + 16, k0, x + 1, G + 16, k0, CONCRETE);
  for (let z = k0 + 4; z <= k1 - 4; z += 4) S(k0, G + 16, z, k0, G + 16, z + 1, CONCRETE);
  S(k0, G + 14, k0, k0 + 3, G + 18, k0 + 3, CONCRETE); S(k0, G + 14, k1 - 3, k0 + 3, G + 18, k1, CONCRETE);
  S(69, G + 14, 69, 70, G + 15, 74, CONCRETE);                              // 屋頂中間的矮牆

  // ── 四座哨塔（13×13、岩石砌的）：三層樓，寬樓梯沿著牆來回爬，頂樓有城垛 ──
  bigTower(S, G, 10, 10, 13, 3, ROCK, ['xmax']); bigTower(S, G, 10, 121, 13, 3, ROCK, ['xmax']);

  // ── 兩側民房（兩層，灰泥牆、木頭樓板）──
  const h0 = 28, h1 = 41, hz0 = 62, hz1 = 81;
  S(h0, G, hz0, h1, G + 11, hz0, PLASTER); S(h0, G, hz1, h1, G + 11, hz1, PLASTER);
  S(h0, G, hz0, h0, G + 11, hz1, PLASTER); S(h1, G, hz0, h1, G + 11, hz1, PLASTER);
  S(h0 + 1, G + 6, hz0 + 1, h1 - 1, G + 6, hz1 - 1, WOOD); S(h0, G + 12, hz0, h1, G + 12, hz1, WOOD);
  S(h1, G, 70, h1, G + 4, 73, AIR); S(33, G, hz0, 35, G + 4, hz0, AIR); S(h0, G, 76, h0, G + 4, 78, AIR);   // 三個門
  S(h1, G + 8, 65, h1, G + 9, 67, AIR); S(h1, G + 8, 76, h1, G + 9, 78, AIR); S(h0, G + 8, 69, h0, G + 9, 72, AIR);   // 二樓的窗
  S(h0 + 1, G + 6, hz0 + 1, h0 + 2, G + 6, hz0 + 7, AIR);
  for (let i = 0; i < 7; i++) S(h0 + 1, G, hz0 + 7 - i, h0 + 2, G + i, hz0 + 7 - i, WOOD);
  S(35, G, 72, 37, G + 1, 74, WOOD); S(31, G + 7, 76, 33, G + 8, 77, WOOD);

  // ── 庭院裡的掩體：廢墟矮牆、市集棚子、木箱、沙包 ──
  S(28, G, 9, 44, G + 6, 10, BRICK); S(34, G, 9, 37, G + 4, 10, AIR);       // 南北邊的拱門牆
  S(24, G, 30, 40, G + 2, 31, ROCK); S(30, G, 38, 31, G + 3, 48, BRICK); S(30, G + 2, 42, 31, G + 3, 43, AIR);
  S(45, G, 30, 47, G + 2, 32, WOOD); S(48, G, 31, 49, G + 1, 32, WOOD);
  S(60, G, 24, 72, G + 3, 24, WOOD); S(60, G + 4, 24, 72, G + 4, 30, WOOD); // 市集棚子
  S(60, G, 30, 60, G + 3, 30, WOOD); S(72, G, 30, 72, G + 3, 30, WOOD); S(64, G, 26, 66, G + 1, 27, WOOD);
  S(80, G, 18, 81, G + 4, 32, BRICK); S(80, G + 2, 24, 81, G + 3, 26, AIR);
  S(44, G, 60, 45, G + 1, 66, SANDBAG); S(44, G, 77, 45, G + 1, 83, SANDBAG);
  S(22, G, 95, 24, G + 1, 97, WOOD); S(25, G, 96, 26, G + 3, 97, WOOD);
  S(36, G, 104, 48, G + 2, 105, ROCK); S(52, G, 108, 53, G + 5, 120, BRICK);
  // ── 城外的小房子：南北兩邊各一排平房（屋頂可以踩木箱爬上去），西邊一棟兩層民房 ──
  const hut = (x0, z0, x1, z1, cx) => {
    S(x0, G, z0, x1, G + 5, z0, BRICK); S(x0, G, z1, x1, G + 5, z1, BRICK); S(x0, G, z0, x0, G + 5, z1, BRICK); S(x1, G, z0, x1, G + 5, z1, BRICK);
    S(x0, G + 6, z0, x1, G + 6, z1, WOOD);                                    // 平屋頂
    S(x0 + 4, G, z1, x0 + 6, G + 4, z1, AIR);                                  // 門（朝城堡那一邊）
    S(x0, G + 2, z0 + 4, x0, G + 3, z0 + 6, AIR); S(x1, G + 2, z0 + 4, x1, G + 3, z0 + 6, AIR);   // 兩側的窗
    S(x0 + 2, G, z0 + 2, x0 + 3, G + 1, z0 + 3, WOOD);                         // 屋裡的木箱
    S(cx, G, z0 + 2, cx + 1, G + 1, z0 + 3, WOOD); S(cx, G, z0 + 4, cx + 1, G + 3, z0 + 5, WOOD); S(cx, G, z0 + 6, cx + 1, G + 5, z0 + 7, WOOD);   // 疊木箱爬上屋頂
  };
  hut(84, 8, 95, 19, 96); hut(100, 8, 111, 19, 112);
  bigTower(S, G, 4, 38, 12, 2, PLASTER, ['xmax', 'zmin']);                  // 兩層民房（屋頂可以站）

  // 出生點前面的掩體牆（擋住一出門就被看到）
  S(11, G, 63, 12, G + 4, 69, BRICK); S(11, G, 74, 12, G + 4, 80, BRICK); S(15, G, 70, 16, G + 2, 73, WOOD);
}

// ═════════ 6. 雙塔河谷：中間一條乾河道，只有兩座橋能過；每邊兩座側塔、後方一座主塔（繞中心旋轉 180° 對稱）═════════
// 河道 2 公尺深跳不上來，只有兩座橋、或河道兩端的石階能過河；河中央一塊大岩石擋住兩邊主塔互看。
const GR = 6, VALLEY = { X: 128, Y: 32, Z: 128 };
function buildValley(w) {
  const S = (...a) => w.boxSym(...a), G = GR, X = VALLEY.X;
  base(w, GRASS, G);
  // 河道（z 58..69）：沙地河床，兩岸各有一處石階可以爬上來
  w.box(2, G - 5, 58, X - 3, G - 5, 69, SANDGROUND);
  w.box(2, G - 4, 58, X - 3, G - 1, 69, AIR);
  for (let j = 0; j < 4; j++) S(3, G - 4, 61 - j, 7, G - 4 + j, 61 - j, ROCK);
  w.box(56, G - 5, 58, 71, G + 8, 69, ROCK);                                 // 河中央的大岩石
  w.box(60, G + 9, 61, 67, G + 10, 66, ROCK);
  // 兩座木橋（1 公尺高的欄杆；可以被打斷）
  S(26, G - 1, 57, 33, G - 1, 70, WOOD);
  S(25, G, 58, 25, G, 69, WOOD); S(34, G, 58, 34, G, 69, WOOD);
  S(26, G - 4, 63, 26, G - 2, 64, WOOD); S(33, G - 4, 63, 33, G - 2, 64, WOOD);   // 橋墩
  // 側塔（兩層，頂上可以站）與主塔（三層，在出生點前面）
  bigTower(S, G, 23, 34, 13, 2, BRICK, ['zmax', 'zmin']);
  bigTower(S, G, 92, 34, 13, 2, BRICK, ['zmax', 'zmin']);
  bigTower(S, G, 56, 10, 16, 3, CONCRETE, ['zmin', 'zmax']);
  // 兩條路中間的矮牆、路上的掩體
  S(44, G, 34, 45, G + 3, 54, BRICK); S(44, G, 43, 45, G + 2, 46, AIR);
  S(82, G, 34, 83, G + 3, 54, BRICK); S(82, G, 41, 83, G + 2, 44, AIR);
  S(20, G, 50, 24, G + 1, 52, SANDBAG); S(35, G, 52, 38, G + 1, 53, SANDBAG);
  S(38, G, 46, 40, G + 2, 48, WOOD); S(88, G, 48, 90, G + 2, 50, WOOD); S(103, G, 51, 107, G + 1, 52, SANDBAG);
  S(10, G, 44, 14, G + 3, 48, ROCK); S(112, G, 40, 117, G + 2, 44, ROCK); S(50, G, 28, 52, G + 1, 30, WOOD);
  S(8, G, 20, 12, G + 4, 22, ROCK); S(114, G, 22, 118, G + 2, 26, ROCK);
}

// ═════════ 7. 沙城兩路：沙漠小鎮。南邊、北邊各一個出生區，中間一圈房子圍著露天中庭 ═════════
// 西邊「A 長街」：又長又直、中段有一道門；東邊「B 地道」：有屋頂、來回轉彎、有天窗；
// 中間的中庭：噴泉、市集攤子、兩邊有二樓迴廊，四個門分別通南北出生區、A 長街、B 地道。
// A、B 兩個點位在北邊，地上鋪著大字母，中間是北邊出生區的廣場。出生點每局交換，所以兩邊公平。
const GD = 3, DESERT = { X: 128, Y: 32, Z: 128 };
const LETTER = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
};
function buildDust(w) {
  const P = (...a) => w.box(...a), G = GD;
  base(w, SANDGROUND, G);
  const letter = (ch, x0, z0) => LETTER[ch].forEach((row, r) => [...row].forEach((c, k) => { if (c === '1') P(x0 + k * 2, G - 1, z0 + r * 2, x0 + k * 2 + 1, G - 1, z0 + r * 2 + 1, TILE); }));

  // ── 中間：一圈房子圍著露天中庭（房子 x 36..91、z 26..92；中庭 x 44..83、z 36..82） ──
  // 中庭繞自己的中心（x 63.5、z 59）轉 180° 對稱：南門↔北門、西門（通 A 長街）↔東門（通 B 地道）、西迴廊↔東迴廊
  const C = (x0, y0, z0, x1, y1, z1, t) => { P(x0, y0, z0, x1, y1, z1, t); P(127 - x1, y0, 118 - z1, 127 - x0, y1, 118 - z0, t); };
  P(36, G, 26, 91, G + 10, 92, SAND);
  P(44, G, 36, 83, G + 10, 82, AIR);                                         // 挖空：中庭
  P(36, G + 11, 26, 56, G + 13, 35, SAND); P(84, G + 11, 36, 91, G + 12, 56, PLASTER); P(70, G + 11, 83, 91, G + 14, 92, SAND);   // 屋頂上高高低低的加蓋
  P(36, G + 11, 62, 43, G + 12, 88, PLASTER); P(58, G + 11, 83, 66, G + 15, 92, SAND);
  for (let z = 32; z <= 86; z += 9) { P(36, G + 3, z, 36, G + 5, z + 2, WOOD); P(91, G + 3, z + 4, 91, G + 5, z + 6, WOOD); }   // 外牆的木窗板（裝飾，也能打穿）
  for (const x of [54, 64, 74]) C(x, G + 3, 35, x + 2, G + 5, 35, WOOD);   // 中庭裡面的木窗板
  // 二樓迴廊：沿著西牆（東牆對稱）一條 2.5 公尺寬、3 公尺高的走廊，底下是有柱子的騎樓；南端一道樓梯上去
  C(44, G + 5, 50, 48, G + 5, 80, WOOD);                                     // 迴廊地板
  C(48, G + 6, 50, 48, G + 6, 80, WOOD); C(48, G + 6, 62, 48, G + 6, 65, AIR);   // 欄杆（中間留一段缺口好跳下去）
  for (const z of [52, 60, 68, 76]) C(48, G, z, 48, G + 4, z, WOOD);         // 騎樓的柱子
  rampZ(C, 44, 47, 49, -1, 2, G, 6, SAND);                                   // 樓梯：從中庭往北爬上迴廊
  // 中間的噴泉：0.5 公尺高的池子（跳得上去）、正中間一座石像擋住南北兩門之間的視線
  P(57, G, 53, 70, G + 1, 65, CONCRETE); P(58, G + 1, 54, 69, G + 1, 64, AIR);
  P(62, G + 1, 57, 65, G + 6, 61, ROCK); P(61, G + 7, 56, 66, G + 7, 62, ROCK);
  // 市集攤子（木頭柱子、布篷、櫃台）、木箱、沙包
  C(52, G, 40, 52, G + 4, 40, WOOD); C(57, G, 40, 57, G + 4, 40, WOOD); C(52, G, 44, 52, G + 4, 44, WOOD); C(57, G, 44, 57, G + 4, 44, WOOD);
  C(51, G + 5, 39, 58, G + 5, 45, PLASTER); C(53, G, 42, 56, G + 1, 43, WOOD);
  C(72, G, 42, 74, G + 2, 44, WOOD); C(75, G, 43, 76, G + 1, 44, WOOD);
  C(52, G, 66, 56, G + 1, 67, SANDBAG); C(78, G, 52, 80, G + 3, 54, CONT_R);
  // 門：3 公尺寬。南門、北門通兩邊的出生區（錯開，不會從出生點直接看穿中庭）；西門通 A 長街（大門南邊）、東門通 B 地道中段
  C(46, G, 26, 51, G + 5, 35, AIR); C(36, G, 51, 43, G + 4, 56, AIR);       // 西門、東門 2.5 公尺高（進去就是迴廊底下的騎樓）
  C(46, G + 6, 25, 51, G + 6, 25, WOOD); C(35, G + 5, 50, 35, G + 5, 57, WOOD);   // 門上的木門楣

  // ── 南邊：進攻方出生區（兩條路的起點）──
  P(50, G, 14, 77, G + 2, 15, SAND); P(60, G, 14, 67, G + 2, 15, AIR);      // 出生點前面的矮牆，中間留開口
  P(30, G, 6, 32, G + 2, 8, WOOD); P(95, G, 6, 97, G + 2, 8, WOOD); P(20, G, 16, 23, G + 1, 18, WOOD); P(104, G, 16, 107, G + 1, 18, WOOD);

  // ── 西邊 A 長街（x 2..35）──
  P(2, G, 58, 35, G + 8, 59, SAND); P(16, G, 58, 21, G + 5, 59, AIR);       // A 長街的大門
  P(16, G + 6, 57, 21, G + 6, 60, WOOD);                                     // 門上的木門楣
  P(6, G, 36, 8, G + 2, 38, WOOD); P(28, G, 44, 31, G + 1, 46, WOOD); P(9, G, 46, 10, G + 3, 47, WOOD);
  P(4, G, 74, 8, G + 4, 86, CONT_Y); P(22, G, 80, 33, G + 2, 81, SAND); P(26, G, 66, 28, G + 2, 68, WOOD);
  P(2, G + 6, 30, 6, G + 6, 50, WOOD); P(2, G, 30, 2, G + 5, 50, SAND); P(6, G, 30, 6, G + 5, 31, WOOD); P(6, G, 49, 6, G + 5, 50, WOOD);   // 路邊的遮雨棚

  // ── A 點（x 2..35、z 93..125）：一座高台、木箱 ──
  P(4, G, 104, 14, G + 2, 114, CONCRETE); P(15, G, 106, 15, G + 1, 112, CONCRETE); P(16, G, 106, 16, G, 112, CONCRETE);   // 高台和台階
  P(20, G, 100, 22, G + 2, 102, WOOD); P(24, G, 110, 25, G + 3, 112, WOOD); P(28, G, 118, 31, G + 1, 120, WOOD); P(6, G + 3, 108, 7, G + 4, 110, WOOD);
  letter('A', 21, 96);

  // ── 東邊 B 地道（x 92..125、z 26..83）：有屋頂，裡面的牆來回轉彎 ──
  P(92, G + 6, 26, 125, G + 6, 83, CONCRETE);                                // 屋頂
  P(92, G, 26, 125, G + 5, 27, SAND); P(104, G, 26, 111, G + 4, 27, AIR);    // 南邊入口
  P(92, G, 40, 115, G + 5, 41, SAND); P(102, G, 54, 125, G + 5, 55, SAND); P(92, G, 68, 115, G + 5, 69, SAND);
  P(92, G, 82, 125, G + 5, 83, SAND); P(98, G, 82, 103, G + 4, 83, AIR);     // 北邊出口
  P(100, G + 6, 33, 103, G + 6, 35, AIR); P(110, G + 6, 61, 113, G + 6, 63, AIR); P(98, G + 6, 75, 101, G + 6, 77, AIR);   // 天窗
  P(120, G, 46, 122, G + 2, 48, WOOD); P(95, G, 60, 97, G + 1, 62, WOOD); P(118, G, 74, 120, G + 2, 76, WOOD); P(106, G, 32, 107, G + 3, 33, WOOD);

  // ── B 點（x 92..125、z 84..125）：一棟兩層樓、木箱 ──
  bigTower(P, G, 108, 104, 14, 2, PLASTER, ['xmin', 'zmin']);
  P(96, G, 98, 98, G + 2, 100, WOOD); P(100, G, 114, 103, G + 1, 116, WOOD); P(94, G, 88, 99, G + 1, 89, SANDBAG);
  letter('B', 95, 102);

  // ── 北邊：防守方出生區，連著兩個點位 ──
  P(36, G, 93, 37, G + 6, 105, SAND); P(36, G, 114, 37, G + 6, 125, SAND);   // 點位和廣場之間的牆（中間是通道）
  P(90, G, 93, 91, G + 6, 105, SAND); P(90, G, 114, 91, G + 6, 125, SAND);
  P(60, G, 104, 67, G + 1, 111, CONCRETE); P(62, G + 2, 106, 65, G + 4, 109, ROCK);   // 廣場中間的噴泉台
  P(46, G, 98, 48, G + 2, 100, WOOD); P(79, G, 114, 81, G + 2, 116, WOOD);
}


// ═════════ 8. 施工大樓（混戰專用，4 個人）：還沒蓋完的大樓，三層樓加屋頂 ═════════
// 四個角落完全一樣（每樣東西都繞中心轉 90° 放四份），誰出生在哪都公平。
// 一樓：四角各一間出生房間；中間是挖空到天空的天井（有一座塔吊），四個象限各一個採光井（也是往下跳的捷徑）。
// 樓梯每一層換一個位置；二樓有十字鋼樑橫過天井通到塔吊；三樓有辦公室隔間；屋頂沒有遮蔽，有冷氣機和水塔可以躲。
// 外牆每層都有窗，牆外一圈鷹架走道（跳窗出去可以繞到別的象限）。
const GS = 3, SITE = { X: 128, Y: 32, Z: 128 };
const SL = [GS, GS + 8, GS + 16, GS + 24];   // 每一層站的高度（方塊）：一樓、二樓、三樓、屋頂。一層 4 公尺，樓板在 SL[k] - 1
function buildSite(w) {
  const N = w.X, G = GS;
  // 放一塊，同時放它繞地圖中心轉 90°、180°、270° 的三份
  const R = (x0, y0, z0, x1, y1, z1, t) => {
    let a = [x0, z0, x1, z1];
    for (let k = 0; k < 4; k++) {
      w.box(Math.min(a[0], a[2]), y0, Math.min(a[1], a[3]), Math.max(a[0], a[2]), y1, Math.max(a[1], a[3]), t);
      a = [N - 1 - a[1], a[0], N - 1 - a[3], a[2]];
    }
  };
  base(w, CONCRETE, G);
  const lo = 6, hi = N - 7;                                                   // 大樓外牆（2 格厚）在 6..7、120..121
  R(lo, G, lo, hi, SL[3] + 2, lo + 1, CONCRETE);                             // 外牆一路到屋頂的女兒牆（1.5 公尺，跳不出去）
  for (const y of [SL[1] - 1, SL[2] - 1, SL[3] - 1]) w.box(lo + 2, y, lo + 2, hi - 2, y, hi - 2, CONCRETE);   // 樓板、屋頂
  // 外牆的窗：每層、每面牆六個（3 公尺寬、2 公尺高，窗台 0.5 公尺：跳上窗台就能走出去鷹架）
  for (const sl of [SL[0], SL[1], SL[2]]) for (const x of [12, 28, 44, 78, 94, 110]) R(x, sl + 1, lo, x + 5, sl + 4, lo + 1, AIR);
  // 牆外的鷹架：二樓、三樓高度各一圈 1 公尺寬的木板走道（貼著外牆；外側留空讓天光照進窗戶），每 8 公尺一根鐵柱
  for (const y of [SL[1] - 1, SL[2] - 1]) R(2, y, 4, N - 3, y, 5, WOOD);
  for (const x of [2, 18, 34, 50, 77, 93, 109, 125]) R(x, G, 2, x, SL[2] + 2, 2, METAL);

  // ── 天井（中間 12 公尺見方，挖空到天空）與塔吊 ──
  for (const y of [SL[1] - 1, SL[2] - 1, SL[3] - 1]) w.box(52, y, 52, 75, y, 75, AIR);
  for (const sl of [SL[1], SL[2], SL[3]]) R(52, sl, 51, 75, sl, 51, METAL);           // 每層天井邊的欄杆（0.5 公尺，跳得過）
  for (const [x, z] of [[62, 62], [65, 62], [62, 65], [65, 65]]) w.box(x, G, z, x, 30, z, METAL);   // 塔吊的四根柱子
  // 塔吊的橫桿：放在每層「頭頂以上、下一層腳底以下」的高度，走進塔吊裡不會撞頭
  for (const y of [8, 16, 24, 30]) { w.box(62, y, 62, 65, y, 62, METAL); w.box(62, y, 65, 65, y, 65, METAL); w.box(62, y, 62, 62, y, 65, METAL); w.box(65, y, 62, 65, y, 65, METAL); }
  w.box(36, 31, 63, 104, 31, 64, METAL);                                      // 吊臂（在屋頂的人頭頂上方，碰不到）
  R(52, SL[1] - 1, 63, 61, SL[1] - 1, 64, METAL);                            // 二樓：十字鋼樑橫過天井
  w.box(62, SL[1] - 1, 62, 65, SL[1] - 1, 65, METAL);                        // 鋼樑交會的平台（在塔吊中間）
  // ── 每個象限：採光井（3 公尺見方，從一樓通到天空）──
  for (const y of [SL[1] - 1, SL[2] - 1, SL[3] - 1]) R(34, y, 34, 39, y, 39, AIR);
  for (const sl of [SL[1], SL[2], SL[3]]) { R(34, sl, 33, 39, sl, 33, METAL); R(34, sl, 40, 39, sl, 40, METAL); R(33, sl, 34, 33, sl, 39, METAL); R(40, sl, 34, 40, sl, 39, METAL); }
  // ── 柱子（穿過每一層）：都離樓梯的上下口遠遠的，不會擋路 ──
  for (const [x, z] of [[20, 20], [22, 36], [58, 20]]) R(x, G, z, x + 1, SL[3] - 2, z + 1, CONCRETE);
  // ── 樓梯（2.5 公尺寬、每階 0.5 公尺、走 1 公尺升半公尺）：三段都在自己出生房間這一側，背對中間往上爬，上樓時不會被看到 ──
  // 一樓→二樓：出生房間東門（x 28..29、z 14..16）一出門就是樓梯口，往 +x 爬：x 30..45、z 12..16
  rampX(R, 12, 16, 45, -1, 2, SL[0], 8, CONCRETE);
  R(30, SL[1] - 1, 12, 43, SL[1] - 1, 16, AIR);
  R(30, SL[1], 11, 43, SL[1], 11, METAL); R(30, SL[1], 17, 43, SL[1], 17, METAL); R(29, SL[1], 11, 29, SL[1], 17, METAL);
  // 二樓→三樓：二樓樓梯口旁邊，往 +z 爬：x 50..54、z 14..29
  rampZ(R, 50, 54, 29, -1, 2, SL[1], 8, CONCRETE);
  R(50, SL[2] - 1, 14, 54, SL[2] - 1, 27, AIR);
  R(49, SL[2], 13, 49, SL[2], 27, METAL); R(55, SL[2], 13, 55, SL[2], 27, METAL); R(49, SL[2], 13, 55, SL[2], 13, METAL);
  // 三樓→屋頂：三樓樓梯口走過去，往 -x 爬：x 32..47、z 42..46
  rampX(R, 42, 46, 32, 1, 2, SL[2], 8, CONCRETE);
  R(34, SL[3] - 1, 42, 47, SL[3] - 1, 46, AIR);
  R(34, SL[3], 41, 47, SL[3], 41, METAL); R(34, SL[3], 47, 47, SL[3], 47, METAL); R(48, SL[3], 41, 48, SL[3], 47, METAL);

  // ── 一樓：出生房間（磚牆、兩個門）、工地的材料 ──
  R(28, G, 8, 29, SL[1] - 2, 29, BRICK); R(8, G, 28, 29, SL[1] - 2, 29, BRICK);
  R(28, G, 14, 29, G + 4, 16, AIR); R(14, G, 28, 16, G + 4, 29, AIR);       // 門 1.5 公尺寬、2.5 公尺高
  R(10, G, 20, 12, G + 1, 22, WOOD);                                         // 房間裡一疊棧板
  R(54, G, 6 + 2, 61, G + 4, 12, CONT_Y);                                    // 工地貨櫃
  R(14, G, 38, 18, G + 1, 42, SAND); R(15, G + 2, 39, 17, G + 2, 41, SAND);  // 沙堆
  R(54, G, 40, 57, G + 2, 41, SANDBAG);                                      // 天井旁的沙包
  // ── 二樓：一疊一疊的棧板、鐵皮隔板 ──
  R(14, SL[1], 40, 16, SL[1] + 1, 42, WOOD); R(56, SL[1], 26, 58, SL[1] + 2, 28, WOOD);
  R(8, SL[1], 26, 20, SL[1] + 2, 26, SHEET);                                // 半高的鐵皮隔板
  R(26, SL[1], 54, 27, SL[1] + 2, 60, PLASTER);
  // ── 三樓：辦公室隔間（灰泥牆、兩個門、牆上有窗）──
  R(24, SL[2], 8, 25, SL[3] - 2, 25, PLASTER); R(8, SL[2], 24, 25, SL[3] - 2, 25, PLASTER);
  R(24, SL[2], 15, 25, SL[2] + 4, 17, AIR); R(15, SL[2], 24, 17, SL[2] + 4, 25, AIR);
  R(24, SL[2] + 2, 10, 25, SL[2] + 3, 12, AIR); R(10, SL[2] + 2, 24, 12, SL[2] + 3, 25, AIR);
  R(58, SL[2], 36, 61, SL[2] + 2, 37, SANDBAG);
  // ── 屋頂：冷氣機、水塔 ──
  R(14, SL[3], 40, 18, SL[3] + 2, 43, METAL);
  R(38, SL[3], 6 + 2, 42, SL[3] + 3, 11, SHEET);
  R(56, SL[3], 44, 59, SL[3] + 1, 46, METAL);
}

export const MAPS = {
  plaza: {
    name: '廢墟廣場', desc: '開闊場地，中央兩層塔與角落高台；外圍兩座三層鐘樓廢墟、破房子和燒掉的公車',
    build: buildPlazaV2, size: SMALL, ed: PLAZA0,
    env: 'golden', ground: GP * BS,
    spawns: PLAZA0.spawns.map(sh),
    pickups: PLAZA0.pickups.map(sh),
  },
  lanes: {
    name: '三線街區', desc: '長巷、中路、隧道三條路線，中路底下有地下道；外圍有三層公寓的後巷、停車場和鐵道貨車廂',
    build: buildLanesV2, size: SMALL, ed: LANES0,
    env: 'noon', ground: GL * BS,
    spawns: LANES0.spawns.map(sh),
    pickups: LANES0.pickups.map(sh),
  },
  yard: {
    name: '貨櫃碼頭', desc: '立體、考驗跳箱子的身法；外圍有起重機塔（吊臂走得出去）、倉庫和成排的貨櫃',
    build: buildYardV2, size: SMALL, ed: YARD0,
    env: 'overcast', ground: GY * BS,
    spawns: YARD0.spawns.map(sh),
    pickups: YARD0.pickups.map(sh),
  },
  quarry: {
    name: '礦場', desc: '高地、谷底、坡道、木橋與穿山隧道，高低差最大；高地上有木造礦井架，谷底有礦工小屋和礦車軌道',
    build: buildQuarryV2, size: SMALL, ed: QUARRY0,
    env: 'morning', ground: QLO * BS,
    spawns: QUARRY0.spawns.map(sh),
    pickups: QUARRY0.pickups.map(sh),
  },
  castle: {
    name: '城堡要塞', desc: '大地圖（72×72 公尺）：中央兩層城堡可以上屋頂，四角有三層高的哨塔，城外有一圈小房子',
    build: buildCastle, size: CASTLE,
    env: 'golden', ground: GC * BS,
    spawns: [
      { x: m(6), y: GC * BS, z: m(71), yaw: -Math.PI / 2 },
      { x: m(137), y: GC * BS, z: m(72), yaw: Math.PI / 2 },
    ],
    pickups: [
      { type: 'hp', amount: 40, x: m(34.5), y: GC * BS, z: m(67) },
      { type: 'hp', amount: 40, x: m(108.5), y: GC * BS, z: m(76) },
      { type: 'armor', amount: 50, x: m(71.5), y: (GC + 14) * BS, z: m(71.5), respawn: 30 },   // 城堡屋頂正中間
      { type: 'hp', amount: 25, x: m(16), y: (GC + 18) * BS, z: m(16) },                         // 哨塔頂
      { type: 'hp', amount: 25, x: m(127), y: (GC + 18) * BS, z: m(127) },
      { type: 'hp', amount: 25, x: m(71.5), y: (GC + 7) * BS, z: m(71.5) },                      // 城堡二樓
    ],
  },
  valley: {
    name: '雙塔河谷', desc: '中間一條乾河道只有兩座橋能過；每邊兩座側塔、後方一座三層主塔',
    build: buildValley, size: VALLEY,
    env: 'noon', ground: GR * BS,
    spawns: [
      { x: m(63), y: GR * BS, z: m(4), yaw: Math.PI },
      { x: m(64), y: GR * BS, z: m(123), yaw: 0 },
    ],
    pickups: [
      { type: 'hp', amount: 25, x: m(29), y: (GR + 12) * BS, z: m(40) },        // 側塔頂
      { type: 'hp', amount: 25, x: m(98), y: (GR + 12) * BS, z: m(87) },
      { type: 'hp', amount: 25, x: m(98), y: (GR + 12) * BS, z: m(40) },
      { type: 'hp', amount: 25, x: m(29), y: (GR + 12) * BS, z: m(87) },
      { type: 'armor', amount: 50, x: m(45), y: (GR - 4) * BS, z: m(63), respawn: 30 },   // 河床上（要下河才拿得到）
      { type: 'armor', amount: 50, x: m(82), y: (GR - 4) * BS, z: m(64), respawn: 30 },
    ],
  },
  dust: {
    name: '沙城兩路', desc: '西邊又長又直的 A 長街、東邊有屋頂會轉彎的 B 地道，中間是露天中庭（有噴泉和二樓迴廊），四個門通到各處',
    build: buildDust, size: DESERT,
    env: 'noon', ground: GD * BS,
    spawns: [
      { x: m(63), y: GD * BS, z: m(6), yaw: Math.PI },
      { x: m(64), y: GD * BS, z: m(121), yaw: 0 },
    ],
    pickups: [
      { type: 'hp', amount: 40, x: m(9), y: (GD + 3) * BS, z: m(109) },          // A 點高台上
      { type: 'hp', amount: 40, x: m(18), y: GD * BS, z: m(70) },                // A 長街大門後面
      { type: 'armor', amount: 50, x: m(108), y: GD * BS, z: m(61), respawn: 30 }, // B 地道中段
      { type: 'hp', amount: 25, x: m(114), y: (GD + 12) * BS, z: m(110) },       // B 點樓頂
      { type: 'hp', amount: 25, x: m(46), y: (GD + 6) * BS, z: m(72) },          // 中庭西邊的二樓迴廊
      { type: 'hp', amount: 25, x: m(81), y: (GD + 6) * BS, z: m(46) },          // 中庭東邊的二樓迴廊
    ],
  },
  site: {
    name: '施工大樓', desc: '混戰專用（64×64 公尺）：還沒蓋完的大樓，三層樓加屋頂；中間天井有塔吊，四個角落各一間出生房間，外牆有鷹架',
    build: buildSite, size: SITE,
    env: 'noon', ground: GS * BS,
    storm: { x: 32, z: 32, r: 9 },                                         // 混戰的毒圈收在中間 9 公尺以內
    // 四個角落的出生房間，都面向中間；前兩個是對角（1 對 1 也能玩這張）
    spawns: [
      { x: m(16), y: GS * BS, z: m(16), yaw: -Math.PI * 0.75 },
      { x: m(111), y: GS * BS, z: m(111), yaw: Math.PI * 0.25 },
      { x: m(111), y: GS * BS, z: m(16), yaw: Math.PI * 0.75 },
      { x: m(16), y: GS * BS, z: m(111), yaw: -Math.PI * 0.25 },
    ],
    pickups: [
      { type: 'hp', amount: 40, x: m(24), y: SL[1] * BS, z: m(24) },          // 二樓，每個象限一個
      { type: 'hp', amount: 40, x: m(103), y: SL[1] * BS, z: m(24) },
      { type: 'hp', amount: 40, x: m(103), y: SL[1] * BS, z: m(103) },
      { type: 'hp', amount: 40, x: m(24), y: SL[1] * BS, z: m(103) },
      { type: 'armor', amount: 50, x: m(53), y: SL[2] * BS, z: m(40), respawn: 30 },   // 三樓天井旁，每個象限一個
      { type: 'armor', amount: 50, x: m(87), y: SL[2] * BS, z: m(53), respawn: 30 },
      { type: 'armor', amount: 50, x: m(74), y: SL[2] * BS, z: m(87), respawn: 30 },
      { type: 'armor', amount: 50, x: m(40), y: SL[2] * BS, z: m(74), respawn: 30 },
      { type: 'hp', amount: 25, x: 32, y: SL[1] * BS, z: 32 },                 // 塔吊中間的平台
    ],
  },
};
export const MAP_IDS = Object.keys(MAPS);

// ═════════ 自製地圖（地圖編輯器做的）═════════
// 一張自製地圖 = { name, env 天氣, g 地面高度（方塊）, spawns: [{x,y,z,yaw}×2], pickups: [...], types: Uint8Array（整張圖每一格的方塊）}
// 分享代碼 = 上面這包資料壓縮後轉成文字，貼給朋友就能匯入；對戰時房主也會自動傳給對方。
const b64 = {
  enc(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec(str) { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; },
};
// 把資料餵進壓縮／解壓縮串流。cap = 輸出最多幾個位元組（解壓時用：一小段代碼解出幾百 MB 的「壓縮炸彈」會被擋下來）
async function pipe(u8, stream, cap = Infinity) {
  const rd = new Blob([u8]).stream().pipeThrough(stream).getReader(), parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    n += value.length;
    if (n > cap) { rd.cancel().catch(() => {}); throw new Error('地圖資料太大'); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
// 連續相同的方塊記成（數量, 種類），數量用可變長度整數
function rle(types) {
  const out = [];
  for (let i = 0; i < types.length;) {
    const t = types[i]; let n = 1;
    while (i + n < types.length && types[i + n] === t) n++;
    i += n;
    while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
    out.push(n, t);
  }
  return Uint8Array.from(out);
}
function unrle(bytes, len) {
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < bytes.length && o < len;) {
    let n = 0, sh = 1, b, k = 0;
    do { b = bytes[i++]; n += (b & 0x7f) * sh; sh *= 128; } while ((b & 0x80) && ++k < 4);
    if (!(n > 0)) break;                               // 壞掉的資料：到此為止，剩下的當作空氣
    const t = bytes[i++];
    out.fill(t, o, Math.min(len, o + n)); o += n;
  }
  return out;
}
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };

export async function encodeMap(def) {
  const head = new TextEncoder().encode(JSON.stringify({ v: 1, name: String(def.name || '自製地圖').slice(0, 20), env: def.env, g: def.g, spawns: def.spawns, pickups: def.pickups }));
  const body = rle(def.types), raw = new Uint8Array(4 + head.length + body.length);
  new DataView(raw.buffer).setUint32(0, head.length);
  raw.set(head, 4); raw.set(body, 4 + head.length);
  return 'RBL1.' + b64.enc(await pipe(raw, new CompressionStream('deflate-raw')));
}
export async function decodeMap(code) {
  code = String(code || '').trim();
  if (!code.startsWith('RBL1.')) throw new Error('這不是地圖代碼');
  if (code.length > 400000) throw new Error('地圖代碼太長');
  const raw = await pipe(b64.dec(code.slice(5)), new DecompressionStream('deflate-raw'), 2e6);
  if (raw.length < 8) throw new Error('地圖資料不完整');
  const hl = new DataView(raw.buffer).getUint32(0);
  if (hl > raw.length - 4 || hl > 20000) throw new Error('地圖資料不完整');
  const h = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + hl)));
  if (h.v !== 1 || !Array.isArray(h.spawns) || h.spawns.length !== 2) throw new Error('地圖資料不完整');
  const n = WORLD.X * WORLD.Y * WORLD.Z, types = unrle(raw.subarray(4 + hl), n);
  for (let i = 0; i < n; i++) if (types[i] > DIRT) types[i] = CONCRETE;     // 不認得的方塊（新版本做的圖）先當水泥
  const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
  // 位置一律夾在地圖裡面（出生點在牆外的話人會卡死）
  const W = WORLD.X * BS, H = WORLD.Y * BS, D = WORLD.Z * BS, inX = (v) => Math.max(1.3, Math.min(W - 1.3, num(v, 4))), inY = (v) => Math.max(0.5, Math.min(H - 2, num(v, 2))), inZ = (v) => Math.max(1.3, Math.min(D - 1.3, num(v, 4)));
  return {
    name: String(h.name || '自製地圖').slice(0, 20), env: String(h.env || 'golden'), g: Math.max(1, Math.min(WORLD.Y - 6, num(h.g, 4) | 0)),
    spawns: h.spawns.map((s) => ({ x: inX(s && s.x), y: inY(s && s.y), z: inZ(s && s.z), yaw: num(s && s.yaw) })),
    pickups: (Array.isArray(h.pickups) ? h.pickups : []).filter((p) => p && typeof p === 'object').slice(0, 12).map((p) => ({ type: p.type === 'armor' ? 'armor' : 'hp', amount: Math.max(10, Math.min(50, num(p.amount, 25))), x: inX(p.x), y: inY(p.y), z: inZ(p.z), ...(p.type === 'armor' ? { respawn: 30 } : {}) })),
    types,
  };
}

// 登記成一張可以選的地圖；回傳它的代號（同一份代碼兩邊算出來的代號一樣）
export function registerCustom(def, code) {
  const id = 'c_' + hashStr(code);
  MAPS[id] = {
    name: def.name, desc: '自製地圖', custom: true, code, env: def.env, ground: def.g * BS,
    build: (w) => w.loadRaw(def.types), spawns: def.spawns, pickups: def.pickups, def,
  };
  return id;
}
export const customIds = () => Object.keys(MAPS).filter((k) => MAPS[k].custom);

// 這台電腦存過的自製地圖（localStorage）。開機時全部登記起來
export async function loadSavedMaps() {
  for (const code of store.get('maps', [])) { try { registerCustom(await decodeMap(code), code); } catch { /* 壞掉的就跳過 */ } }
}
export function saveMapCode(code, replaceId) {
  let list = store.get('maps', []);
  if (replaceId && MAPS[replaceId] && MAPS[replaceId].custom) { list = list.filter((c) => c !== MAPS[replaceId].code); delete MAPS[replaceId]; }
  if (!list.includes(code)) list.push(code);
  store.set('maps', list.slice(-24));
}
export function deleteMap(id) {
  const m = MAPS[id]; if (!m || !m.custom) return;
  store.set('maps', store.get('maps', []).filter((c) => c !== m.code));
  delete MAPS[id];
}
