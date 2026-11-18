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

  // 移動手感：地面有摩擦與加速（放開會滑一小段、按反方向可以急停）；
  // 空中可以自由轉向而且速度不會掉，按住跳躍鍵落地自動再跳 → 一路保持動力
  SPEED: 6.4,        // 地面最高速度 m/s
  FRICTION: 5.6,     // 地面摩擦；越大停得越快
  STOP_SPEED: 2.0,   // 低於這個速度時摩擦照這個速度算（才停得下來）
  ACCEL: 6.5,        // 地面加速
  AIR_TURN: 5.5,     // 空中轉向的速度（弧度/秒）：5.5 ≈ 半秒多可以掉頭；越大越靈活
  AIR_ACCEL: 18,     // 空中加速 m/s²：原地起跳後也能加速到跑速（超過跑速的動力不會被吃掉）
  JUMP: 7.6,         // 起跳速度（跳高約 1.3 公尺）
  GRAVITY: 22,
  AUTO_BHOP: true,   // 按住空白鍵落地自動再跳
  BHOP_CAP: 11.5,    // 起跳時的水平速度上限（被爆炸炸飛才會超過跑速）
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
  ROUND_END: 5.5,    // 回合結束後停多久（要夠放完擊殺回放）
  // 'streak'：連敗時 buff 會累積，贏一局就清空
  // 'permanent'：整場比賽都保留
  // 'single'：只保留最近一個
  BUFF_MODE: 'streak',
  PICKUP_RESPAWN: 20,
};

// 經濟系統：每局開打前用錢買裝備（買了就扣，不會留到下一局）。輸的人拿比較多，連敗再加碼
export const ECON = {
  START: 800,        // 開場金額 → 第 1 局只買得起手槍和小東西（而且規則上也只開放手槍）
  MAX: 12000,
  WIN: 2000,         // 贏一局
  LOSE: 3000,        // 輸一局
  LOSE_STREAK: 500,  // 每多連敗一局再加
  LOSE_MAX: 4500,
  DRAW: 2500,
};

// Roguelike 模式：每局開打前選一張異能卡（cards.js）。輸的人多一張可以選、也比較容易抽到稀有卡
export const ROGUE = {
  N: 3,              // 一次給幾張選
  LOSER_N: 4,        // 上一局輸的人給幾張
  LOSER_LUCK: 1.6,   // 上一局輸的人抽到稀有／傳說的機率倍率
  REROLL: 400,       // 重抽一次要多少錢
  REROLLS: 2,        // 每局最多重抽幾次
  TIME: 45,          // 選卡＋買裝備的時間（比一般模式長，因為要看卡）
};

export const TEAM = [0xff7a3c, 0x3cc8ff];      // 房主橘、訪客藍
export const TEAM_CSS = ['#ff7a3c', '#3cc8ff'];
