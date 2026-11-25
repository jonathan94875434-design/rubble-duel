import { store } from './util.js';
import { WEAPONS } from './weapons.js';
import { ITEMS, ITEM_IDS, TIERS, TIER_IDS, KNIVES, FINISHES } from './skins.js';

// 補給箱（局外抽獎）：抽獎券、收藏、保底，全部存在這台電腦的瀏覽器裡（localStorage），純外觀、不影響數值。
// 拿券：打完一場（main.js 的 _reward）。開一次箱花 1 張券。
export const PITY = 20;          // 連續這麼多抽都沒出刀，這一抽一定出刀
export const SHARDS = 3;         // 抽到已經有的東西 → 1 片碎片，湊滿這麼多片自動換 1 張券
export const START_TICKETS = 3;  // 第一次玩送的券
export const REWARD = { duel: 2, practice: 1, horde: 1, win: 1 };   // 打完一場給幾張（贏了再多給 win 張）

const BY_TIER = {}; for (const id of ITEM_IDS) (BY_TIER[ITEMS[id].t] ||= []).push(id);
const TOTAL_W = TIER_IDS.reduce((s, t) => s + TIERS[t].w, 0);

// 物品顯示用的名字：main 大字（花紋或刀型）、sub 小字（哪一把武器）
export function itemLabel(id) {
  const it = ITEMS[id];
  if (!it) return { main: '?', sub: '' };
  if (it.knife) return { main: KNIVES[it.knife].name, sub: '刀型' };
  return { main: FINISHES[it.f].name, sub: it.w === 'knife' ? '刀（任何刀型）' : (WEAPONS[it.w] ? WEAPONS[it.w].name : it.w) };
}
// 拍圖示用：哪一把武器、什麼塗裝字串（gunmodel.buildGun 的格式）
export function itemGun(id) {
  const it = ITEMS[id];
  if (!it) return { id: 'pistol', skin: 'stock' };
  if (it.knife) return { id: 'knife', skin: 'stock/' + it.knife };
  return { id: it.w, skin: '*' + it.f };
}

export class Crate {
  constructor() {
    this.tickets = Math.max(0, store.get('tickets', START_TICKETS) | 0);
    this.shards = Math.max(0, store.get('shards', 0) | 0);
    this.pity = Math.max(0, store.get('pity', 0) | 0);       // 距離上一次出刀抽了幾次
    this.opened = Math.max(0, store.get('opened', 0) | 0);   // 總共開過幾次
    this.inv = new Set((store.get('inv', null) || []).filter((id) => ITEMS[id]));
  }
  save() {
    store.set('tickets', this.tickets); store.set('shards', this.shards); store.set('pity', this.pity); store.set('opened', this.opened); store.set('inv', [...this.inv]);
  }
  has(id) { return this.inv.has(id); }
  earn(n) { if (n > 0) { this.tickets += n; this.save(); } }

  // 抽一級稀有度（保底到了直接給刀）
  _tier(rand, pity = true) {
    if (pity && this.pity >= PITY - 1) return 'g';
    let x = rand() * TOTAL_W;
    for (const t of TIER_IDS) { x -= TIERS[t].w; if (x < 0) return t; }
    return TIER_IDS[0];
  }
  // 轉盤上用來填空的東西（照一樣的機率，不算保底）
  filler(rand = Math.random) { const l = BY_TIER[this._tier(rand, false)]; return l[(rand() * l.length) | 0]; }

  // 開一次箱：回傳 { id, dup（重複）, bonus（碎片湊滿換到券） }；沒券 = null
  open(rand = Math.random) {
    if (this.tickets < 1) return null;
    const t = this._tier(rand), l = BY_TIER[t], id = l[(rand() * l.length) | 0], dup = this.inv.has(id);
    this.tickets--; this.opened++; this.pity = t === 'g' ? 0 : this.pity + 1;
    let bonus = false;
    if (dup) { this.shards++; if (this.shards >= SHARDS) { this.shards -= SHARDS; this.tickets++; bonus = true; } }
    else this.inv.add(id);
    this.save();
    return { id, dup, bonus };
  }
}
