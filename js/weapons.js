// 槍枝數值表。要加新槍：在這裡加一筆就會自動出現在選槍畫面。
//
// price   價格（P9 手槍免費，每局都有）
// slot    'p' 主武器 / 's' 副武器
// rpm     射速（每分鐘發數）；auto=false 時是連點上限
// dmg     每發（每顆彈丸）身體傷害；head 是爆頭倍率
// spread  [腰射, 瞄準] 散布角度（度）；bloom 每發增加的散布
// mv      移動中額外散布（度）；越大越需要「急停」再開槍
// recoil  [上抬, 左右晃] 角度（度）
// range   [開始衰減距離, 衰減結束距離, 最低倍率]
// block   對方塊的傷害倍率
// zoom    右鍵瞄準放大倍率
// move    移動速度倍率
// reserve 備彈（不寫 = 無限）
// proj    拋射物（火箭、榴彈）
// pen     穿透力：子彈每穿過一格方塊要扣掉那種材料的 pen（world.js 的 BLOCK），扣完就停；剩越少傷害越低
// melee   近戰武器（刀）
export const WEAPONS = {
  ar: {
    name: 'VK-30 突擊步槍', price: 2500, tag: '步槍', slot: 'p', auto: true, rpm: 600, dmg: 22, head: 1.6, pellets: 1,
    spread: [1.0, 0.22], mv: 1.8, bloom: 0.32, recoil: [0.85, 0.3], mag: 30, reload: 2.1,
    range: [25, 55, 0.7], block: 1.0, pen: 34, zoom: 1.35, move: 1.0,
    desc: '全能型，中距離穩定輸出',
    model: { len: 0.42, h: 0.085, barrel: 0.2, stock: 0.2, mag: 0.13, color: 0x4b5a48 },
    snd: { kind: 'rifle', f: 1400, dur: 0.16, thump: 150, gain: 0.8 },
  },
  smg: {
    name: '蜂鳥 衝鋒槍', price: 1400, tag: '衝鋒槍', slot: 'p', auto: true, rpm: 900, dmg: 15, head: 1.5, pellets: 1,
    spread: [1.3, 0.5], mv: 0.7, bloom: 0.22, recoil: [0.55, 0.3], mag: 32, reload: 1.7,
    range: [10, 28, 0.5], block: 0.8, pen: 16, zoom: 1.2, move: 1.08,
    desc: '射速極快、跑得快，貼臉最強',
    model: { len: 0.3, h: 0.08, barrel: 0.1, stock: 0.12, mag: 0.16, color: 0x54586a },
    snd: { kind: 'smg', f: 2200, dur: 0.1, thump: 210, gain: 0.6 },
  },
  shotgun: {
    name: '破門者 霰彈槍', price: 1600, tag: '霰彈槍', slot: 'p', auto: false, rpm: 75, dmg: 12, head: 1.25, pellets: 8,
    spread: [4.6, 3.6], mv: 0.4, bloom: 0, recoil: [3.6, 0.8], mag: 6, reload: 2.7,
    range: [6, 20, 0.2], block: 1.7, pen: 11, zoom: 1.15, move: 0.97,
    desc: '近距離一槍半殘，開牆也很快',
    model: { len: 0.4, h: 0.085, barrel: 0.3, stock: 0.2, mag: 0, color: 0x6b4a33, bw: 0.045 },
    snd: { kind: 'shotgun', f: 800, dur: 0.3, thump: 90, gain: 1.0 },
  },
  dmr: {
    name: 'M-12 射手步槍', price: 2700, tag: '射手步槍', slot: 'p', auto: false, rpm: 300, dmg: 40, head: 1.75, pellets: 1,
    spread: [1.8, 0.08], mv: 2.4, bloom: 0.5, recoil: [1.8, 0.4], mag: 12, reload: 2.3,
    range: [45, 90, 0.8], block: 1.4, pen: 46, zoom: 2.2, move: 0.96,
    desc: '半自動，三槍帶走，爆頭更痛',
    model: { len: 0.46, h: 0.08, barrel: 0.28, stock: 0.22, mag: 0.1, color: 0x5c5247, scope: true },
    snd: { kind: 'rifle', f: 1100, dur: 0.22, thump: 120, gain: 0.9 },
  },
  sniper: {
    name: '長釘 狙擊槍', price: 4200, tag: '狙擊槍', slot: 'p', auto: false, rpm: 46, dmg: 85, head: 2.5, pellets: 1,
    spread: [5.5, 0.0], mv: 4.0, bloom: 0, recoil: [4.5, 0.6], mag: 5, reload: 3.0,
    range: [200, 200, 1], block: 3.0, pen: 90, zoom: 4.5, move: 0.9, scope: true,
    desc: '爆頭必殺，一槍打穿水泥牆',
    model: { len: 0.5, h: 0.085, barrel: 0.42, stock: 0.26, mag: 0.07, color: 0x3d4a52, scope: true, bw: 0.035 },
    snd: { kind: 'sniper', f: 700, dur: 0.42, thump: 70, gain: 1.1 },
  },
  lmg: {
    name: '鐵砧 輕機槍', price: 3600, tag: '機槍', slot: 'p', auto: true, rpm: 540, dmg: 23, head: 1.5, pellets: 1,
    spread: [1.6, 0.45], mv: 2.6, bloom: 0.2, recoil: [0.9, 0.42], mag: 75, reload: 4.2,
    range: [30, 60, 0.7], block: 1.7, pen: 42, zoom: 1.3, move: 0.85,
    desc: '75 發大彈鼓，壓制兼拆房，跑得慢',
    model: { len: 0.5, h: 0.1, barrel: 0.3, stock: 0.2, mag: 0.14, color: 0x505050, drum: true, bw: 0.04 },
    snd: { kind: 'lmg', f: 1000, dur: 0.18, thump: 110, gain: 0.9 },
  },
  rocket: {
    name: '拆遷令 火箭筒', price: 4000, tag: '爆裂物', slot: 'p', auto: false, rpm: 40, dmg: 110, head: 1, pellets: 1,
    spread: [0.3, 0.1], mv: 0.3, bloom: 0, recoil: [3, 0.5], mag: 1, reserve: 4, reload: 2.4,
    range: [999, 999, 1], block: 1, pen: 0, zoom: 1.2, move: 0.9,
    proj: { speed: 42, gravity: 0, radius: 4.5, blockR: 2.4, blockPow: 520, self: 0.5, kick: 11 },
    desc: '一發炸出大洞，共 5 發，可以火箭跳',
    model: { len: 0.7, h: 0.13, barrel: 0.1, stock: 0.0, mag: 0, color: 0x5b6b3c, bw: 0.11, tube: true },
    snd: { kind: 'launcher', f: 500, dur: 0.5, thump: 60, gain: 1.0 },
  },
  gl: {
    name: '彈跳 榴彈槍', price: 3200, tag: '爆裂物', slot: 'p', auto: false, rpm: 75, dmg: 85, head: 1, pellets: 1,
    spread: [0.5, 0.2], mv: 0.3, bloom: 0, recoil: [2.4, 0.4], mag: 4, reserve: 4, reload: 2.9,
    range: [999, 999, 1], block: 1, pen: 0, zoom: 1.2, move: 0.94,
    proj: { speed: 27, gravity: 17, radius: 3.8, blockR: 1.9, blockPow: 420, self: 0.5, kick: 9, bounce: 0.45, fuse: 1.5 },
    desc: '會彈牆的榴彈，躲掩體後面也炸得到，共 8 發',
    model: { len: 0.38, h: 0.11, barrel: 0.16, stock: 0.18, mag: 0, color: 0x6a5a3a, bw: 0.07 },
    snd: { kind: 'launcher', f: 420, dur: 0.22, thump: 95, gain: 0.8 },
  },

  pistol: {
    name: 'P9 手槍', price: 0, tag: '手槍', slot: 's', auto: false, rpm: 420, dmg: 24, head: 1.7, pellets: 1,
    spread: [0.9, 0.3], mv: 0.9, bloom: 0.45, recoil: [1.3, 0.35], mag: 12, reload: 1.4,
    range: [18, 40, 0.6], block: 0.8, pen: 14, zoom: 1.2, move: 1.05,
    desc: '可靠的備用槍，換彈很快',
    model: { len: 0.2, h: 0.07, barrel: 0.03, stock: 0, mag: 0, color: 0x3a3d44 },
    snd: { kind: 'pistol', f: 1800, dur: 0.12, thump: 180, gain: 0.6 },
  },
  revolver: {
    name: '審判者 左輪', price: 600, tag: '手槍', slot: 's', auto: false, rpm: 140, dmg: 52, head: 2.0, pellets: 1,
    spread: [1.2, 0.15], mv: 1.6, bloom: 0.8, recoil: [4.2, 0.7], mag: 6, reload: 2.4,
    range: [30, 60, 0.75], block: 1.6, pen: 30, zoom: 1.4, move: 1.03,
    desc: '爆頭一槍帶走，但射速慢、後座大',
    model: { len: 0.24, h: 0.085, barrel: 0.1, stock: 0, mag: 0, color: 0x7a7468 },
    snd: { kind: 'pistol', f: 900, dur: 0.3, thump: 100, gain: 1.0 },
  },
  mp: {
    name: '黃蜂 衝鋒手槍', price: 400, tag: '手槍', slot: 's', auto: true, rpm: 1000, dmg: 12, head: 1.4, pellets: 1,
    spread: [1.9, 0.9], mv: 0.6, bloom: 0.25, recoil: [0.6, 0.45], mag: 22, reload: 1.6,
    range: [8, 22, 0.45], block: 0.7, pen: 10, zoom: 1.15, move: 1.06,
    desc: '全自動潑灑，近身補槍用',
    model: { len: 0.22, h: 0.075, barrel: 0.04, stock: 0, mag: 0.14, color: 0x4a4038 },
    snd: { kind: 'smg', f: 2500, dur: 0.08, thump: 230, gain: 0.5 },
  },
};

// 刀：每個人都有，不用買。砍到就死（dmg 設成裁判允許的單次上限，護甲和強化都擋不住）。
// 左鍵快砍；瞄準鍵（右鍵／Shift）突刺，搆得比較遠（heavyReach）但收刀慢。拿刀跑得最快。blockDmg = 砍方塊的傷害
export const KNIFE = {
  name: '戰術刀', price: 0, tag: '近戰', slot: 'k', melee: true, auto: true, rpm: 150, dmg: 400, heavy: 400, back: 400, reach: 1.8, heavyReach: 2.2, heavyRpm: 66, blockDmg: 30,
  head: 1, pellets: 1, spread: [0, 0], mv: 0, bloom: 0, recoil: [0, 0], mag: 1, reload: 0, range: [99, 99, 1], block: 0.6, pen: 0, zoom: 1, move: 1.18,
  desc: '砍到就一刀斃命；左鍵快砍、瞄準鍵突刺（搆得比較遠）；拿刀跑最快',
  snd: { kind: 'knife', f: 0, dur: 0, thump: 0, gain: 0 },
};
WEAPONS.knife = KNIFE;

export const PRIMARIES = Object.keys(WEAPONS).filter((k) => WEAPONS[k].slot === 'p');
export const SECONDARIES = Object.keys(WEAPONS).filter((k) => WEAPONS[k].slot === 's');
// 投擲物：跟火箭、榴彈共用拋射物系統。kind 決定引信到了之後發生什麼事
export const THROWABLES = {
  he: {
    name: '手榴彈', kind: 'he', dmg: 110,
    proj: { speed: 20, gravity: 18, bounce: 0.42, fuse: 1.6, radius: 7, blockR: 2.4, blockPow: 420, self: 0.7, kick: 10 },
  },
  flash: {
    name: '閃光彈', kind: 'flash', dmg: 0,
    proj: { speed: 21, gravity: 18, bounce: 0.45, fuse: 1.4, radius: 0, blockR: 0, blockPow: 0, self: 0, kick: 0 },
  },
  smoke: {
    name: '煙霧彈', kind: 'smoke', dmg: 0, dur: 16, cloud: 5.5,
    proj: { speed: 18, gravity: 18, bounce: 0.3, fuse: 1.5, radius: 0, blockR: 0, blockPow: 0, self: 0, kick: 0 },
  },
  // 燃燒瓶：碰到東西就破，地上燒一片火。dps = 站在火裡每秒扣的血；burn = 每秒對木頭的傷害；煙霧彈可以滅火
  molotov: {
    name: '燃燒瓶', kind: 'molotov', dmg: 0, dur: 9, cloud: 4.2, dps: 38, burn: 30,
    proj: { speed: 19, gravity: 18, bounce: 0, fuse: 3, radius: 0, blockR: 0, blockPow: 0, self: 0, kick: 0 },
  },
};
export const projDef = (id) => WEAPONS[id] || THROWABLES[id];
export const itemName = (id) => (projDef(id) ? projDef(id).name : '');

// 裝備（買槍畫面的第三區）。max = 一局最多帶幾個
export const GEAR = {
  armor: { name: '防彈衣', price: 600, max: 1, glyph: '甲', desc: '開局 50 護甲，受傷先扣護甲、扣光了才扣血' },
  he: { name: '手榴彈', price: 300, max: 1, glyph: '爆', desc: '1.6 秒後爆炸，會彈牆、能炸開方塊' },
  flash: { name: '閃光彈', price: 200, max: 2, glyph: '閃', desc: '看著它爆炸的人會全白好幾秒（自己也會）' },
  smoke: { name: '煙霧彈', price: 250, max: 1, glyph: '煙', desc: '放出一團擋視線的煙，維持 12 秒；可以撲滅火' },
  molotov: { name: '燃燒瓶', price: 400, max: 1, glyph: '火', desc: '地上燒 7 秒的火，站在裡面一直扣血，還會燒掉木頭' },
};
export const NADE_IDS = ['he', 'flash', 'smoke', 'molotov'];
export const GEAR_IDS = Object.keys(GEAR);

// 一套裝備：p 主武器（可以不買 = null）、s 副武器、其餘是數量。validLoadout(null) = 只有免費手槍

export function validLoadout(l) {
  const o = { p: null, s: 'pistol' };
  if (l && PRIMARIES.includes(l.p)) o.p = l.p;
  if (l && SECONDARIES.includes(l.s)) o.s = l.s;
  for (const k of GEAR_IDS) o[k] = Math.max(0, Math.min(GEAR[k].max, (l && l[k]) | 0));
  return o;
}

export function loadoutCost(l) {
  let c = (l.p ? WEAPONS[l.p].price : 0) + WEAPONS[l.s].price;
  for (const k of GEAR_IDS) c += GEAR[k].price * (l[k] || 0);
  return c;
}

// 裁判結帳用的保險：把送來的裝備修成「這一局買得起、規則也允許」的一套（正常情況下商店已經擋掉買不起的）：
// 第 1 局是手槍局（不能買主武器）；其餘照 主武器 → 副武器 → 防彈衣 → 投擲物 的順序，買得起就買
export function fitLoadout(l, money, round) {
  const w = validLoadout(l), o = { p: null, s: 'pistol' };
  let left = money;
  const take = (price) => (price <= left ? ((left -= price), true) : false);
  if (round > 1 && w.p && take(WEAPONS[w.p].price)) o.p = w.p;
  if (w.s !== 'pistol' && take(WEAPONS[w.s].price)) o.s = w.s;
  for (const k of GEAR_IDS) { o[k] = 0; for (let i = 0; i < w[k]; i++) if (take(GEAR[k].price)) o[k]++; }
  return o;
}

export function falloff(def, dist) {
  const [a, b, m] = def.range;
  if (dist <= a) return 1;
  if (dist >= b) return m;
  return 1 - (1 - m) * ((dist - a) / (b - a));
}

// 選槍畫面用的 0..1 能力條
export function weaponBars(def) {
  const burst = def.dmg * def.pellets;
  const dps = (burst * def.rpm) / 60;
  const reach = def.proj ? 0.6 : Math.min(1, (def.range[0] + def.range[1]) / 2 / 80);
  const wall = def.proj ? 1 : Math.min(1, (burst * def.block * def.rpm) / 60 / 500);
  return [
    ['傷害', Math.min(1, burst / 100)],
    ['火力', Math.min(1, dps / 240)],
    ['射程', reach],
    ['機動', Math.min(1, Math.max(0, (def.move - 0.8) / 0.3))],
    ['拆牆', wall],
  ];
}
