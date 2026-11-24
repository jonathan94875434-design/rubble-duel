import { BUFFS } from './buffs.js';

// Roguelike 模式的「異能卡」。每局開打前三選一（上一局輸的人四選一、而且比較容易抽到好卡），整場累積。
//   k    'p' 被動（拿了就一直有效，不限數量）／'a' 主動技能（要按鍵施放，最多帶兩個）
//   r    稀有度：c 普通／r 稀有／l 傳說／m 神話（最稀有，效果最誇張）
//   cd   主動技能的冷卻秒數；uses = 每局能用幾次（有寫的話主要看次數，cd 只是兩次之間的間隔）
//   lock 開打後要等幾秒才能用（殺傷力大的技能，免得一開局就往對手的出生點丟）
//   bot  false = 練習機器人不會用（它選卡時會避開）
// 效果寫在哪裡：裁判端（血量、金錢）在 authority.js；開槍相關在 combat.js；技能本體與特效在 skills.js
// 主動技能的數值統一放在下面的 SK（玩家自己放的 skills.js、練習機器人放的 bot.js 都讀這裡）
export const RARITY = {
  c: { name: '普通', w: 100 },
  r: { name: '稀有', w: 46 },
  l: { name: '傳說', w: 13 },
  m: { name: '神話', w: 6 },
};
export const RARITY_IDS = Object.keys(RARITY);

// 主動技能的數值
export const SK = {
  grapple:   { range: 40, pull: 30, time: 1.5 },
  jet:       { up: 17, fwd: 8, cap: 15 },
  dash:      { speed: 21, up: 2.5 },
  stim:      { heal: 60, speed: 1.35, time: 4 },
  scan:      { time: 6, dmg: 1.2 },                 // dmg：透視中打對手的傷害倍率
  dome:      { r: 3.8, time: 7 },
  shock:     { rad: 16, min: 50, max: 120, k: 30, br: 4.5, bp: 650 },   // 傷害 = min + (max - min) × 靠近程度；br／bp 震碎方塊的範圍和力道
  wall:      { half: 10, h: 10 },                     // 鋼牆：寬 2×half+1 格、高 h 格（一格 0.5 公尺）；守據點的沙包牆維持 7×5
  chrono:    { time: 4.5, move: 0.3, look: 0.3 },
  timestop:  { time: 2.5 },
  orbital:   { delay: 1.0, track: 7.5, trackR: 14, full: 3, fade: 4.5, dmg: 200 },   // track：光柱追人的速度（公尺/秒），trackR 多遠內會追
  meteor:    { n: 7, gap: 0.32, delay: 0.75, spread: 3.5, trackR: 14, full: 1.6, fade: 2.6, dmg: 60 },
  blackhole: { time: 4.5, pull: 14, base: 10, str: 58, slow: 0.4, bite: 3, biteDmg: 8, boomR: 7, boomDmg: 75 },
  swap:      { range: 45 },
};

const P = (r, glyph, name, desc, x) => ({ k: 'p', r, glyph, name, desc, ...x });
const A = (r, glyph, name, desc, cd, x) => ({ k: 'a', r, glyph, name, desc, cd, ...x });

export const CARDS = {
  // ── 被動：原本的輸家補償強化，全部算普通卡 ──
  ...Object.fromEntries(Object.entries(BUFFS).map(([id, b]) => [id, P('c', b.glyph, b.name, b.desc)])),
  // ── 被動：普通 ──
  deadeye:    P('c', '眼', '鷹眼', '爆頭傷害 +60%'),
  ap:         P('c', '穿', '穿甲彈', '穿透力 ×2.5：更厚的牆也打得穿，隔牆打人幾乎不掉傷害', { bot: false }),
  radar:      P('c', '達', '雷達', '每 1.2 秒在小地圖上掃出對手的位置，隱身也躲不掉', { bot: false }),
  ghost:      P('c', '靜', '無聲步', '你的腳步沒有聲音、跑速 +8%，開槍也不會出現在對手的小地圖上', { bot: false }),
  moon:       P('c', '月', '月球靴', '重力減半、跑速 +10%：跳得又高又遠，還能在空中慢慢飄'),
  investor:   P('c', '財', '投資客', '馬上拿 $1500，之後每一局開始都多拿 $1500'),
  arsenal:    P('c', '庫', '軍火庫', '每局免費多送 50 護甲（可以跟買的防彈衣疊加）、兩顆手榴彈、閃光彈、煙霧彈', { bot: false }),
  survivor:   P('c', '存', '求生本能', '血量低於 35% 時，受到的傷害 −40%'),
  medkit:     P('c', '醫', '急救包', '每局一次：血量掉到 35 以下時自動回復 50 生命'),
  // ── 被動：稀有 ──
  frenzy:     P('r', '狂', '扳機狂熱', '射速 +35%、換彈快 25%'),
  glass:      P('r', '玻', '玻璃大砲', '傷害 +65%，但最大生命 −30'),
  jugg:       P('r', '巨', '重裝巨人', '最大生命 +100、受到的傷害 −10%，但移動速度 −30%'),
  berserk:    P('r', '怒', '狂戰士', '血越少越強：最多傷害 +60%、速度 +25%'),
  thorns:     P('r', '棘', '荊棘', '你受到的傷害有 30% 反彈給打你的人（不會把人彈死）'),
  cryo:       P('r', '冰', '冰凍彈', '被你打中的人緩速 45%，持續 1.6 秒'),
  incendiary: P('r', '焰', '燃燒彈', '被你打中的人著火 4 秒，每秒燒掉 12 血'),
  explosive:  P('r', '炸', '爆裂彈', '子彈打到東西會小爆炸：拆牆飛快，2.4 公尺內的敵人吃濺射傷害', { bot: false }),
  ricochet:   P('r', '彈', '跳彈', '子彈撞上打不穿的牆會反彈一次（傷害剩 90%），可以打轉角後面的人', { bot: false }),
  overclock:  P('r', '頻', '超頻', '主動技能冷卻 −50%'),
  hunter:     P('r', '獵', '獵人印記', '打中的對手會被標在小地圖上 4 秒，期間你對他的傷害 +20%', { bot: false }),
  // ── 被動：傳說 ──
  twin:       P('l', '雙', '雙重射擊', '每次開槍都多射一發（每發傷害 80%）→ 火力 +60%、拆牆也更快', { bot: false }),
  phoenix:    P('l', '鳳', '不死鳥', '每局一次：受到致命傷時原地浴火重生，回到 70 血並無敵 2 秒'),
  bullet:     P('l', '慢', '子彈時間', '每局一次：血量第一次掉到 40 以下時，對手的時間自動變慢 3 秒', { bot: false }),
  // ── 被動：神話 ──
  reaper:     P('m', '死', '死神', '任何武器爆頭都直接擊倒（護甲擋不住）'),
  avatar:     P('m', '神', '天神下凡', '最大生命 +100、傷害 +30%、受到的傷害 −20%，每秒回復 4 生命'),

  // ── 主動技能：普通 ──
  blink:      A('c', '瞬', '瞬移', '往準星方向瞬間移動 9 公尺，薄牆直接穿過去，速度不會掉', 7, { bot: false }),
  grapple:    A('c', '鉤', '鉤索', '射出鉤索把自己拉向瞄準的地方（40 公尺內，拉得很快）；途中按跳可以提早放開、把速度甩出去', 4, { bot: false }),
  jet:        A('c', '噴', '噴射背包', '往上噴射約 6.5 公尺高，順便往前衝', 5, { bot: false }),
  dash:       A('c', '衝', '衝刺', '往移動的方向（沒按方向就往前）瞬間衝出一大段，衝完速度不會掉', 3.5, { bot: false }),
  wall:       A('c', '牆', '鋼牆', '在面前升起一大片鋼板牆（10 公尺寬、5 公尺高），沒有次數限制', 2, { bot: false }),
  stim:       A('c', '針', '腎上腺素', '立刻回復 60 生命，並加速 35% 持續 4 秒', 14),
  scan:       A('c', '視', '透視脈衝', '6 秒內隔著牆也看得到對手（隱身的也會現形），而且你對他的傷害 +20%', 12, { bot: false }),
  // ── 主動技能：稀有 ──
  cloak:      A('r', '隱', '光學迷彩', '隱身 5 秒，開槍、出刀或丟東西就會現形', 18),
  dome:       A('r', '罩', '能量護罩', '原地放出半徑 3.8 公尺的護罩 7 秒：子彈打不進也打不出，人可以走進去', 16),
  shock:      A('r', '震', '震地衝擊波', '超大範圍：震碎身邊一大片地形，把 16 公尺內的對手震飛，造成 50～120 傷害', 9),
  // ── 主動技能：傳說 ──
  chrono:     A('l', '時', '時間凝結', '對手的時間變慢 4.5 秒：移動和轉頭都只剩三成', 18, { lock: 3 }),
  orbital:    A('l', '軌', '軌道砲', '標記你瞄準的地方，1 秒後打下一道光柱（200 傷害）；附近的對手會被光柱追著跑，幾乎躲不掉', 8, { lock: 4 }),
  blackhole:  A('l', '洞', '黑洞', '打開黑洞 4.5 秒：14 公尺內的對手被強力吸過去、跑不動，靠太近一直扣血，最後大爆炸', 8, { lock: 4, bot: false }),
  swap:       A('l', '換', '換位', '跟看得到的對手（45 公尺內）瞬間交換位置', 10, { bot: false }),
  // ── 主動技能：神話 ──
  timestop:   A('m', '停', '時間暫停', '對手完全靜止 2.5 秒：不能動、不能轉頭、不能開槍', 20, { lock: 3 }),
  meteor:     A('m', '隕', '流星雨', '在瞄準的地方降下 7 顆隕石，會追著附近的對手砸，每顆 60 傷害、把地形砸得稀爛', 14, { lock: 4, bot: false }),
};
export const CARD_IDS = Object.keys(CARDS);
// 傷害來源的名字（擊倒訊息用）：技能、灼燒、反彈都不是武器
const SRC = { incendiary: '燃燒彈', thorns: '荊棘反彈' };
export const cardName = (id) => SRC[id] || (CARDS[id] ? CARDS[id].name : '');

// 抽卡。owned = 已經有的被動、skills = 已經帶的主動技能、exclude = 這次不要再出現的（重抽時用）
// luck > 1：稀有、傳說、神話比較容易出現（越稀有加成越多）。needActive：技能格還有空位時，保證至少出現一張主動技能
// 一次最多出現兩張主動技能（至少留一張被動可以選）
export function rollCards({ owned = [], skills = [], n = 3, luck = 1, exclude = [], needActive = false, rnd = Math.random } = {}) {
  const pool = CARD_IDS.filter((id) => !owned.includes(id) && !skills.includes(id) && !exclude.includes(id));
  const out = [];
  let act = 0;
  while (out.length < n && pool.length) {
    let cand = pool.filter((id) => CARDS[id].k !== 'a' || act < 2);
    if (needActive && !act && out.length === 0) { const a = cand.filter((id) => CARDS[id].k === 'a'); if (a.length) cand = a; }
    if (!cand.length) break;
    const ws = cand.map((id) => { const r = CARDS[id].r; return RARITY[r].w * (r === 'c' ? 1 : r === 'r' ? luck : r === 'l' ? luck * luck : luck * luck * luck); });
    let x = rnd() * ws.reduce((a, b) => a + b, 0), i = 0;
    while (i < cand.length - 1 && (x -= ws[i]) > 0) i++;
    const id = cand[i];
    out.push(id); pool.splice(pool.indexOf(id), 1);
    if (CARDS[id].k === 'a') act++;
  }
  // 保證出現的那張主動技能不要永遠排第一張
  for (let i = out.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

// 把卡片清單換算成本機用的倍率與開關（開槍、移動）。裁判端的效果（血量、反彈、灼燒…）不在這裡
export function cardMods(ids = []) {
  const has = (b) => ids.includes(b);
  return {
    dmg: (has('power') ? 1.25 : 1) * (has('glass') ? 1.65 : 1) * (has('avatar') ? 1.3 : 1),
    head: has('deadeye') ? 1.6 : 1,
    speed: (has('swift') ? 1.2 : 1) * (has('jugg') ? 0.7 : 1) * (has('moon') ? 1.1 : 1) * (has('ghost') ? 1.08 : 1),
    airJumps: has('hop') ? 2 : 0,
    handling: (has('hands') ? 0.5 : 1) * (has('frenzy') ? 0.75 : 1),
    mag: has('mag') ? 1.75 : 1,
    block: has('demo') ? 3.5 : 1,
    spread: has('steady') ? 0.45 : 1,
    recoil: has('steady') ? 0.55 : 1,
    rpm: has('frenzy') ? 1.35 : 1,
    pen: has('ap') ? 2.5 : 1,
    grav: has('moon') ? 0.5 : 1,
    cd: has('overclock') ? 0.5 : 1, extraUses: has('overclock') ? 1 : 0,   // extraUses：守據點的沙包牆多一道
    twin: has('twin'), explosive: has('explosive'), ricochet: has('ricochet'), berserk: has('berserk'),
    arsenal: has('arsenal'), radar: has('radar'), ghost: has('ghost'), hunter: has('hunter'), bullet: has('bullet'), reaper: has('reaper'),
  };
}
// 被動卡影響的最大生命（裁判端用）
export function maxHpOf(buffs = []) {
  const has = (b) => buffs.includes(b);
  return Math.max(40, 100 + (has('vital') ? 100 : 0) + (has('jugg') ? 100 : 0) + (has('avatar') ? 100 : 0) - (has('glass') ? 30 : 0));
}
// 狂戰士：血越少越強。回傳 0..1（滿血 0、剩三成以下 1）
export const rage = (hp, maxHp) => Math.max(0, Math.min(1, (1 - hp / Math.max(1, maxHp)) / 0.7));
export const BERSERK = { dmg: 0.6, speed: 0.25 };
