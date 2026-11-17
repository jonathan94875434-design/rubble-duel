import { MATCH, PLAYER, ECON } from './config.js';
import { rollBuffChoices } from './buffs.js';
import { validLoadout, fitLoadout, loadoutCost, DEFAULT_LOADOUT } from './weapons.js';
import { MAPS, MAP_IDS } from './maps.js';
import { validLook } from './skins.js';

// 裁判（只在房主那邊跑）：血量、回合、分數、buff、補給品都以這裡為準。
// 玩家 0 = 房主、玩家 1 = 訪客。
// out(idx, type, data)：把訊息送給某位玩家（房主自己走本機、訪客走網路）
export class Authority {
  constructor(out) {
    this.out = out;
    // map：'random' 整場隨機一張、'rotate' 每局輪流、或指定某張地圖的代號
    this.settings = { target: MATCH.TARGET, roundTime: MATCH.ROUND_TIME, buffMode: MATCH.BUFF_MODE, map: 'random' };
    this.map = MAP_IDS[0]; this.mapStart = 0;
    this.phase = 'lobby'; this.round = 0; this.tEnd = 0; this.result = null; this.matchWinner = -1;
    this.players = [this._mk('玩家 1'), this._mk('玩家 2')];
    this.present = [true, false];
    this.pickups = MAPS[this.map].pickups.map(() => ({ on: true, at: 0 }));
    this.dirty = true; this.lastSnap = 0;
    this.timer = setInterval(() => this.tick(), 50);
  }
  destroy() { clearInterval(this.timer); }

  _mk(name) {
    return { name, score: 0, hp: PLAYER.MAX_HP, maxHp: PLAYER.MAX_HP, armor: 0, alive: false, buffs: [], streak: 0, money: ECON.START, spent: 0, loadout: validLoadout(DEFAULT_LOADOUT), look: { s: 'recruit', w: 'stock' }, ready: false, choices: null, dmg: 0, heads: 0, lastHurt: 0 };
  }

  setName(i, n) { this.players[i].name = String(n || '').slice(0, 14) || '玩家 ' + (i + 1); this.dirty = true; }
  setPresent(i, v) { this.present[i] = v; this.dirty = true; }
  setSettings(s) {
    if (this.phase !== 'lobby' && this.phase !== 'matchEnd') return;
    if ([1, 3, 5, 7, 10, 15].includes(+s.target)) this.settings.target = +s.target;
    if ([60, 90, 120, 180, 900].includes(+s.roundTime)) this.settings.roundTime = +s.roundTime;
    if (s.map === 'random' || s.map === 'rotate' || MAP_IDS.includes(s.map)) this.settings.map = s.map;
    if (['streak', 'permanent', 'single', 'off'].includes(s.buffMode)) this.settings.buffMode = s.buffMode;
    this.dirty = true;
  }

  toLobby() { this.phase = 'lobby'; this.round = 0; this.result = null; this.dirty = true; }

  startMatch() {
    for (const p of this.players) { p.score = 0; p.buffs = []; p.streak = 0; p.choices = null; p.dmg = 0; p.heads = 0; p.money = ECON.START; p.spent = 0; }
    this.round = 0; this.matchWinner = -1; this.result = null;
    const m = this.settings.map;
    this.map = MAP_IDS.includes(m) ? m : m === 'rotate' ? MAP_IDS[0] : MAP_IDS[(Math.random() * MAP_IDS.length) | 0];
    this.mapStart = MAP_IDS.indexOf(this.map);
    this._enterLoadout();
  }

  _enterLoadout() {
    this.phase = 'loadout'; this.round++;
    if (this.settings.map === 'rotate') this.map = MAP_IDS[(this.mapStart + this.round - 1) % MAP_IDS.length];
    this.tEnd = Date.now() + MATCH.LOADOUT_TIME * 1000;
    for (const p of this.players) p.ready = false;
    this.dirty = true;
  }

  _enterCountdown() {
    for (const p of this.players) {
      if (p.choices) { p.buffs.push(p.choices[0]); p.choices = null; } // 沒選就自動拿第一個
      // 結帳：依規則與餘額修正裝備，然後扣錢（買了就花掉，不退）
      p.loadout = fitLoadout(p.loadout, p.money, this.round);
      p.spent = loadoutCost(p.loadout); p.money -= p.spent;
      p.maxHp = PLAYER.MAX_HP + (p.buffs.includes('vital') ? 35 : 0);
      p.hp = p.maxHp; p.armor = p.loadout.armor || p.buffs.includes('plate') ? 50 : 0; p.alive = true; p.lastHurt = 0;
    }
    this.pickups = MAPS[this.map].pickups.map(() => ({ on: true, at: 0 }));
    this.result = null;
    this.phase = 'countdown'; this.tEnd = Date.now() + MATCH.COUNTDOWN * 1000; this.dirty = true;
  }

  _endRound(winner, info) {
    if (this.phase !== 'playing') return;
    this.phase = 'roundEnd'; this.tEnd = Date.now() + MATCH.ROUND_END * 1000;
    this.result = { winner, ...info };
    const before = this.players.map((p) => p.money);
    if (winner >= 0) {
      const W = this.players[winner], L = this.players[1 - winner];
      W.score++; W.streak = 0; L.streak++;
      // 發錢：輸的人拿比較多，連敗再加碼
      W.money = Math.min(ECON.MAX, W.money + ECON.WIN);
      L.money = Math.min(ECON.MAX, L.money + Math.min(ECON.LOSE_MAX, ECON.LOSE + ECON.LOSE_STREAK * (L.streak - 1)));
      const mode = this.settings.buffMode;
      if (mode !== 'permanent') W.buffs = [];   // 贏家的補償用掉了
      if (mode === 'single') L.buffs = [];      // 只留下一個新的
      if (mode === 'off') L.buffs = [];
      else if (W.score < this.settings.target) L.choices = rollBuffChoices(L.buffs);
      if (W.score >= this.settings.target) this.matchWinner = winner;
    } else for (const p of this.players) p.money = Math.min(ECON.MAX, p.money + ECON.DRAW);
    this.result.inc = this.players.map((p, i) => p.money - before[i]);   // 這一局各拿到多少錢
    this.dirty = true;
  }

  // 訪客（或房主本機）送來的請求
  handle(i, t, d) {
    const p = this.players[i];
    if (!p || !d) return;
    if (t === 'loadout') { if (this.phase === 'loadout' || this.phase === 'lobby') { p.loadout = validLoadout(d); this.dirty = true; } }
    else if (t === 'buff') { if (p.choices && p.choices.includes(d.id)) { p.buffs.push(d.id); p.choices = null; this.dirty = true; } }
    else if (t === 'ready') { if (this.phase === 'loadout' && !p.choices) { p.ready = !!d.v; this.dirty = true; } }
    else if (t === 'hit') { if (d.r === this.round) this.damage(1 - i, +d.d || 0, i, d.w, !!d.h); }
    else if (t === 'self') { if (d.r === this.round) this.damage(i, +d.d || 0, i, d.w, false); }
    else if (t === 'pick') this._pickup(i, d.i | 0);
    else if (t === 'name') this.setName(i, d.name);
    else if (t === 'look') { p.look = validLook(d); this.dirty = true; }
  }

  damage(target, dmg, attacker, weapon, head) {
    if (this.phase !== 'playing') return;
    const T = this.players[target], A = this.players[attacker];
    if (!T.alive || !(dmg > 0)) return;
    dmg = Math.min(dmg, 400);
    if (T.buffs.includes('tough')) dmg *= 0.85;
    let toHp = dmg;
    if (T.armor > 0) { const ab = Math.min(T.armor, dmg * PLAYER.ARMOR_ABSORB); T.armor -= ab; toHp = dmg - ab; }
    const dealt = Math.min(T.hp, toHp);
    T.hp -= toHp; T.lastHurt = Date.now();
    if (attacker !== target) {
      A.dmg += dealt;
      if (A.buffs.includes('leech') && A.alive) A.hp = Math.min(A.maxHp, A.hp + dealt * 0.25);
    }
    this.out(target, 'ev', { t: 'hurt', d: Math.round(toHp), self: attacker === target, h: head });
    if (T.hp <= 0) {
      T.hp = 0; T.alive = false;
      const suicide = attacker === target;
      if (head && !suicide) A.heads++;
      const info = { reason: suicide ? 'suicide' : 'kill', victim: target, w: weapon, head: head && !suicide };
      this._endRound(1 - target, info);
    }
    this.dirty = true; this.flush();
  }

  _pickup(i, k) {
    const p = this.players[i], pk = this.pickups[k], def = MAPS[this.map].pickups[k];
    if (this.phase !== 'playing' || !p.alive || !pk || !pk.on) return;
    if (def.type === 'hp') { if (p.hp >= p.maxHp) return; p.hp = Math.min(p.maxHp, p.hp + def.amount); }
    else { if (p.armor >= PLAYER.MAX_ARMOR) return; p.armor = Math.min(PLAYER.MAX_ARMOR, p.armor + def.amount); }
    pk.on = false; pk.at = Date.now() + (def.respawn || MATCH.PICKUP_RESPAWN) * 1000;
    this.out(0, 'ev', { t: 'pick', i: k, by: i }); this.out(1, 'ev', { t: 'pick', i: k, by: i });
    this.dirty = true; this.flush();
  }

  tick() {
    const now = Date.now();
    if (this.phase === 'loadout') {
      const allReady = this.players.every((p) => p.ready && !p.choices);
      if (allReady || now >= this.tEnd) this._enterCountdown();
    } else if (this.phase === 'countdown') {
      if (now >= this.tEnd) { this.phase = 'playing'; this.tEnd = now + this.settings.roundTime * 1000; this.dirty = true; }
    } else if (this.phase === 'playing') {
      for (const p of this.players) {
        if (p.alive && p.buffs.includes('regen') && p.hp < p.maxHp && now - p.lastHurt > 4000) { p.hp = Math.min(p.maxHp, p.hp + 6 * 0.05); }
      }
      this.pickups.forEach((pk) => { if (!pk.on && now >= pk.at) { pk.on = true; this.dirty = true; } });
      if (now >= this.tEnd) {
        const a = this.players[0], b = this.players[1];
        const va = a.hp + a.armor, vb = b.hp + b.armor;
        this._endRound(va === vb ? -1 : va > vb ? 0 : 1, { reason: 'time' });
      }
    } else if (this.phase === 'roundEnd') {
      if (now >= this.tEnd) {
        if (this.matchWinner >= 0) { this.phase = 'matchEnd'; this.dirty = true; }
        else this._enterLoadout();
      }
    }
    if (this.dirty || now - this.lastSnap > 100) this.flush();
  }

  flush() {
    const now = Date.now();
    this.dirty = false; this.lastSnap = now;
    const s = {
      phase: this.phase, round: this.round, tLeft: Math.max(0, this.tEnd - now), set: this.settings, res: this.result, mw: this.matchWinner,
      here: this.present, map: this.map,
      p: this.players.map((p) => ({ n: p.name, sc: p.score, hp: Math.ceil(p.hp), mhp: p.maxHp, ar: Math.ceil(p.armor), al: p.alive, bf: p.buffs, st: p.streak, lo: p.loadout, $: p.money, sp: p.spent, lk: p.look, rd: p.ready, ch: p.choices, dmg: Math.round(p.dmg), hs: p.heads })),
      pk: this.pickups.map((k) => (k.on ? 1 : 0)),
    };
    this.out(0, 'gs', s); this.out(1, 'gs', s);
  }
}
