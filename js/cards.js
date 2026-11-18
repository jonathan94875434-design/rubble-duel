import { BUFFS } from './buffs.js';

// Roguelike 模式的「異能卡」。每局開打前三選一（上一局輸的人四選一、而且比較容易抽到好卡），整場累積。
//   k    'p' 被動（拿了就一直有效，不限數量）／'a' 主動技能（要按鍵施放，最多帶兩個）
//   r    稀有度：c 普通／r 稀有／l 傳說
//   cd   主動技能的冷卻秒數；uses = 每局能用幾次（有寫的話主要看次數，cd 只是兩次之間的間隔）
//   lock 開打後要等幾秒才能用（殺傷力大的技能，免得一開局就往對手的出生點丟）
//   bot  false = 練習機器人不會用（它選卡時會避開）
// 效果寫在哪裡：裁判端（血量、金錢）在 authority.js；開槍相關在 combat.js；技能本體與特效在 skills.js
export const RARITY = {
  c: { name: '普通', w: 100 },
  r: { name: '稀有', w: 46 },
  l: { name: '傳說', w: 13 },
};

const P = (r, glyph, name, desc, x) => ({ k: 'p', r, glyph, name, desc, ...x });
const A = (r, glyph, name, desc, cd, x) => ({ k: 'a', r, glyph, name, desc, cd, ...x });

export const CARDS = {
  // ── 被動：原本的輸家補償強化，全部算普通卡 ──
  ...Object.fromEntries(Object.entries(BUFFS).map(([id, b]) => [id, P('c', b.glyph, b.name, b.desc, id === 'plate' ? { desc: '每局自帶 50 護甲' } : null)])),
  // ── 被動：普通 ──
  deadeye:    P('c', '眼', '鷹眼', '爆頭傷害 +40%'),
  ap:         P('c', '穿', '穿甲彈', '穿透力 ×2：更厚的牆也打得穿，隔牆打人更痛', { bot: false }),
  radar:      P('c', '達', '雷達', '每 2 秒在小地圖上掃出對手的位置，隱身也躲不掉', { bot: false }),
  ghost:      P('c', '靜', '無聲步', '你的腳步沒有聲音，開槍也不會出現在對手的小地圖上', { bot: false }),
  moon:       P('c', '月', '月球靴', '重力減半：跳得又高又遠，還能在空中慢慢飄'),
  investor:   P('c', '財', '投資客', '之後每一局開始都多拿 $1000'),
  arsenal:    P('c', '庫', '軍火庫', '每局免費多送防彈衣、手榴彈、閃光彈各一', { bot: false }),
  // ── 被動：稀有 ──
  frenzy:     P('r', '狂', '扳機狂熱', '射速 +25%'),
  glass:      P('r', '玻', '玻璃大砲', '傷害 +50%，但最大生命 −35'),
  jugg:       P('r', '巨', '重裝巨人', '最大生命 +60，移動速度 −10%'),
  berserk:    P('r', '怒', '狂戰士', '血越少越強：最多傷害 +40%、速度 +20%'),
  thorns:     P('r', '棘', '荊棘', '你受到的傷害有 30% 反彈給打你的人（不會把人彈死）'),
  cryo:       P('r', '冰', '冰凍彈', '被你打中的人緩速 35%，持續 1.2 秒'),
  incendiary: P('r', '焰', '燃燒彈', '被你打中的人著火 3 秒，每秒燒掉 8 血'),
  explosive:  P('r', '炸', '爆裂彈', '子彈打到東西會小爆炸：拆牆飛快，1.8 公尺內的敵人吃濺射傷害', { bot: false }),
  ricochet:   P('r', '彈', '跳彈', '子彈撞上打不穿的牆會反彈一次（傷害剩 70%），可以打轉角後面的人', { bot: false }),
  // ── 被動：傳說 ──
  twin:       P('l', '雙', '雙重射擊', '每次開槍都多射一發（每發傷害 65%）→ 火力 +30%、拆牆也更快', { bot: false }),
  phoenix:    P('l', '鳳', '不死鳥', '每局一次：受到致命傷時原地浴火重生，回到 40 血並無敵 1.2 秒'),

  // ── 主動技能：普通 ──
  blink:      A('c', '瞬', '瞬移', '往準星方向瞬間移動 9 公尺，薄牆直接穿過去，速度不會掉', 7, { bot: false }),
  grapple:    A('c', '鉤', '鉤索', '射出鉤索把自己拉向瞄準的地方（28 公尺內）；途中按跳可以提早放開、把速度甩出去', 6, { bot: false }),
  jet:        A('c', '噴', '噴射背包', '往上噴射約 5 公尺高，順便往前衝', 7, { bot: false }),
  wall:       A('c', '牆', '鋼牆', '在面前升起一道 3.5 公尺寬、2.5 公尺高的鋼板牆', 3, { uses: 2, bot: false }),
  stim:       A('c', '針', '腎上腺素', '立刻回復 40 生命，並加速 25% 持續 3 秒', 18),
  scan:       A('c', '視', '透視脈衝', '4 秒內隔著牆也看得到對手，隱身的也會現形', 16, { bot: false }),
  // ── 主動技能：稀有 ──
  cloak:      A('r', '隱', '光學迷彩', '隱身 5 秒，開槍、出刀或丟東西就會現形', 18),
  dome:       A('r', '罩', '能量護罩', '原地放出半徑 3 公尺的護罩 5.5 秒：子彈打不進也打不出，人可以走進去', 20),
  shock:      A('r', '震', '震地衝擊波', '震碎身邊的掩體，把 6.5 公尺內的對手震飛，最多造成 45 傷害', 12),
  // ── 主動技能：傳說 ──
  chrono:     A('l', '時', '時間凝結', '對手的時間變慢 3 秒：移動和轉頭都只剩三分之一', 22, { lock: 4 }),
  orbital:    A('l', '軌', '軌道砲', '標記你瞄準的地方，1.7 秒後天上打下一道光柱，把地面轟出大洞（光柱裡 150 傷害）', 4, { uses: 1, lock: 5 }),
  blackhole:  A('l', '洞', '黑洞', '在瞄準的地方打開黑洞 4 秒：把對手吸過去、吞掉方塊，最後爆炸', 4, { uses: 1, lock: 5, bot: false }),
};
export const CARD_IDS = Object.keys(CARDS);
// 傷害來源的名字（擊倒訊息用）：技能、灼燒、反彈都不是武器
const SRC = { incendiary: '燃燒彈', thorns: '荊棘反彈' };
export const cardName = (id) => SRC[id] || (CARDS[id] ? CARDS[id].name : '');

// 抽卡。owned = 已經有的被動、skills = 已經帶的主動技能、exclude = 這次不要再出現的（重抽時用）
// luck > 1：稀有、傳說比較容易出現。needActive：技能格還有空位時，保證至少出現一張主動技能
// 一次最多出現兩張主動技能（至少留一張被動可以選）
export function rollCards({ owned = [], skills = [], n = 3, luck = 1, exclude = [], needActive = false, rnd = Math.random } = {}) {
  const pool = CARD_IDS.filter((id) => !owned.includes(id) && !skills.includes(id) && !exclude.includes(id));
  const out = [];
  let act = 0;
  while (out.length < n && pool.length) {
    let cand = pool.filter((id) => CARDS[id].k !== 'a' || act < 2);
    if (needActive && !act && out.length === 0) { const a = cand.filter((id) => CARDS[id].k === 'a'); if (a.length) cand = a; }
    if (!cand.length) break;
    const ws = cand.map((id) => { const r = CARDS[id].r; return RARITY[r].w * (r === 'c' ? 1 : r === 'r' ? luck : luck * luck); });
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
    dmg: (has('power') ? 1.15 : 1) * (has('glass') ? 1.5 : 1),
    head: has('deadeye') ? 1.4 : 1,
    speed: (has('swift') ? 1.15 : 1) * (has('jugg') ? 0.9 : 1),
    airJumps: has('hop') ? 1 : 0,
    handling: has('hands') ? 0.65 : 1,
    mag: has('mag') ? 1.5 : 1,
    block: has('demo') ? 2.5 : 1,
    spread: has('steady') ? 0.6 : 1,
    recoil: has('steady') ? 0.7 : 1,
    rpm: has('frenzy') ? 1.25 : 1,
    pen: has('ap') ? 2 : 1,
    grav: has('moon') ? 0.5 : 1,
    twin: has('twin'), explosive: has('explosive'), ricochet: has('ricochet'), berserk: has('berserk'),
    arsenal: has('arsenal'), radar: has('radar'), ghost: has('ghost'),
  };
}
// 狂戰士：血越少越強。回傳 0..1（滿血 0、剩三成以下 1）
export const rage = (hp, maxHp) => Math.max(0, Math.min(1, (1 - hp / Math.max(1, maxHp)) / 0.7));
