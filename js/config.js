// 全域調整參數：之後要改手感、規則，大多改這裡就好。
export const BS = 0.5;                         // 一個方塊的邊長（公尺）
export const WORLD = { X: 96, Y: 32, Z: 96 };  // 地圖大小（方塊數）→ 48 × 16 × 48 公尺
export const CHUNK = 16;

export const PLAYER = {
  HW: 0.3,          // 半寬
  H: 1.8,           // 身高
  EYE: 1.62,        // 眼睛高度
  SPEED: 6.6,       // 地面最高速度 m/s
  ACCEL: 60,
  AIR_ACCEL: 14,
  JUMP: 7.6,
  GRAVITY: 22,
  MAX_HP: 100,
  MAX_ARMOR: 50,
  ARMOR_ABSORB: 0.5, // 護甲吸收的傷害比例
};

export const NET = {
  SEND_HZ: 30,       // 位置同步頻率
  INTERP_MS: 100,    // 對手畫面延遲插值
  PREFIX: 'rubble-duel-v1-',
  PROTO: 1,
};

export const MATCH = {
  TARGET: 5,         // 先拿到幾分獲勝（房主可在大廳改）
  ROUND_TIME: 120,   // 每局秒數
  LOADOUT_TIME: 30,  // 選槍時間
  COUNTDOWN: 3,
  ROUND_END: 4,
  // 'streak'：連敗時 buff 會累積，贏一局就清空
  // 'permanent'：整場比賽都保留
  // 'single'：只保留最近一個
  BUFF_MODE: 'streak',
  PICKUP_RESPAWN: 20,
};

export const TEAM = [0xff7a3c, 0x3cc8ff];      // 房主橘、訪客藍
export const TEAM_CSS = ['#ff7a3c', '#3cc8ff'];
