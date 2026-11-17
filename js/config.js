// 全域調整參數：之後要改手感、規則，大多改這裡就好。
export const BS = 0.5;                         // 一個方塊的邊長（公尺）
export const WORLD = { X: 96, Y: 32, Z: 96 };  // 地圖大小（方塊數）→ 48 × 16 × 48 公尺
export const CHUNK = 16;

export const PLAYER = {
  HW: 0.3,           // 半寬
  H: 1.8,            // 站立身高
  EYE: 1.62,         // 站立眼睛高度
  CROUCH_H: 1.3,     // 蹲下身高（可以鑽過 1.5 公尺高的洞）
  CROUCH_EYE: 1.12,
  CROUCH_SPEED: 0.45,// 蹲走速度倍率

  // 移動手感（Source 引擎式：摩擦 + 加速，空中只能靠轉向加速）
  SPEED: 6.4,        // 地面最高速度 m/s
  FRICTION: 5.6,     // 地面摩擦；越大停得越快
  STOP_SPEED: 2.0,   // 低於這個速度時摩擦照這個速度算（才停得下來）
  ACCEL: 6.5,        // 地面加速
  AIR_ACCEL: 12,     // 空中加速（決定空中轉向的靈敏度）
  AIR_CAP: 0.8,      // 空中每次能往按鍵方向補的速度上限 → 這就是「旋轉跳」能加速的原因
  JUMP: 7.6,         // 起跳速度（跳高約 1.3 公尺）
  GRAVITY: 22,
  AUTO_BHOP: true,   // 按住空白鍵落地自動再跳
  BHOP_CAP: 11.5,    // 連跳的水平速度上限
  COYOTE: 0.09,      // 走出平台邊緣後還能起跳的寬限秒數
  STEP_SOUND_SPEED: 4.2, // 超過這個速度才有腳步聲（瞄準走、蹲走是安靜的）

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
