import { MATCH, PLAYER, ECON, ROGUE, HORDE } from './config.js';
import { rollBuffChoices } from './buffs.js';
import { CARDS, CARD_IDS, SK, rollCards, maxHpOf } from './cards.js';

// 守據點每一波打完可以選的強化卡：只有對機器人也有效的被動（跟對手互動的、跟錢有關的、主動技能都不放）
const HZ_NO_CARDS = CARD_IDS.filter((id) => CARDS[id].k === 'a' || ['plate', 'arsenal', 'radar', 'ghost', 'investor', 'thorns', 'cryo', 'incendiary', 'bullet', 'hunter'].includes(id));
const HZ_BEHS = ['hold', 'strafe', 'hunt', 'mix'], HZ_LVS = ['easy', 'normal', 'hard'];
import { WEAPONS, validLoadout, fitLoadout, loadoutCost } from './weapons.js';
import { MAPS, MAP_IDS } from './maps.js';
import { validLook } from './skins.js';

// 裁判（只在房主那邊跑）：血量、回合、分數、buff、補給品都以這裡為準。
// 玩家 0 = 房主、玩家 1 = 訪客。
// out(idx, type, data)：把訊息送給某位玩家（房主自己走本機、訪客走網路）
export class Authority {
  constructor(out) {
    this.out = out;
    // map：'random' 整場隨機一張、'rotate' 每局輪流、或指定某張地圖的代號
    // mode：'classic' 一般對戰／'rogue' Roguelike（每局選一張異能卡，整場累積；輸家補償改成「多一張可以選」）
    //       'dm' 機器人死鬥／'defense' 守據點（這兩個是跟機器人打，見 horde.js）
    // hz：機器人模式的設定。n 幾隻、beh 行為、atk 會不會開槍、lv 難度、time 死鬥幾秒（0 = 不限）
    this.settings = { target: MATCH.TARGET, roundTime: MATCH.ROUND_TIME, buffMode: MATCH.BUFF_MODE, map: 'random', mode: 'classic', hz: { n: 8, beh: 'hunt', atk: true, lv: 'normal', time: 300 } };
    this.hz = null; this.onMobHit = null;   // onMobHit(誰, 資料)：玩家打中機器人（main.js 接到 horde.js）
    this.map = MAP_IDS[0]; this.mapStart = 0; this.lastLoser = -1;
    this.phase = 'lobby'; this.round = 0; this.tEnd = 0; this.result = null; this.matchWinner = -1;
    this.players = [this._mk('玩家 1'), this._mk('玩家 2')];
    this.present = [true, false];
    this.pickups = MAPS[this.map].pickups.map(() => ({ on: true, at: 0 }));
    this.dirty = true; this.lastSnap = 0;
    this.timer = setInterval(() => this.tick(), 50);
  }
  destroy() { clearInterval(this.timer); }

  _mk(name) {
    return { name, score: 0, hp: PLAYER.MAX_HP, maxHp: PLAYER.MAX_HP, armor: 0, alive: false, buffs: [], streak: 0, money: ECON.START, spent: 0, loadout: validLoadout(null), look: { s: 'recruit', w: 'stock' }, ready: false, choices: null, dmg: 0, heads: 0, lastHurt: 0, rHits: 0, rDmg: 0, rHead: 0, respawnAt: 0,
      // Roguelike：skills 兩格主動技能、rr 這一局重抽了幾次、lucky 這一局是不是輸家加碼；
      // phx 不死鳥這一局用掉了沒、inv 無敵到何時、slowT 被冰凍彈緩速到何時、burnT/burnBy/burnNext 著火、stimAt 上次打腎上腺素
      skills: [null, null], rr: 0, lucky: false, phx: false, inv: 0, slowT: 0, burnT: 0, burnBy: 0, burnNext: 0, stimAt: 0 };
  }

  setName(i, n) { this.players[i].name = String(n || '').slice(0, 14) || '玩家 ' + (i + 1); this.dirty = true; }
  setPresent(i, v) { this.present[i] = v; this.dirty = true; }
  setSettings(s) {
    if (this.phase !== 'lobby' && this.phase !== 'matchEnd') return;
    if ([1, 3, 5, 7, 10, 15].includes(+s.target)) this.settings.target = +s.target;
    if ([60, 90, 120, 180, 900].includes(+s.roundTime)) this.settings.roundTime = +s.roundTime;
    if (s.map === 'random' || s.map === 'rotate' || MAPS[s.map]) this.settings.map = s.map;   // 也可以是自製地圖
    if (['streak', 'permanent', 'single', 'off'].includes(s.buffMode)) this.settings.buffMode = s.buffMode;
    if (['classic', 'rogue', 'dm', 'defense'].includes(s.mode)) this.settings.mode = s.mode;
    if (s.hz && typeof s.hz === 'object') {
      const h = this.settings.hz, n = s.hz;
      if ([4, 8, 12, 16].includes(+n.n)) h.n = +n.n;
      if (HZ_BEHS.includes(n.beh)) h.beh = n.beh;
      if (typeof n.atk === 'boolean') h.atk = n.atk;
      if (HZ_LVS.includes(n.lv)) h.lv = n.lv;
      if ([0, 120, 300, 600].includes(+n.time)) h.time = +n.time;
    }
    this.dirty = true;
  }

  toLobby() { this.phase = 'lobby'; this.round = 0; this.result = null; this.hz = null; this.dirty = true; }

  startMatch() {
    if (this.settings.mode === 'dm' || this.settings.mode === 'defense') { this._startHorde(); return; }
    this.hz = null;
    for (const p of this.players) { p.score = 0; p.buffs = []; p.skills = [null, null]; p.streak = 0; p.choices = null; p.dmg = 0; p.heads = 0; p.money = ECON.START; p.spent = 0; }
    this.round = 0; this.matchWinner = -1; this.result = null; this.lastLoser = -1;
    const m = this.settings.map;
    this.map = MAPS[m] ? m : m === 'rotate' ? MAP_IDS[0] : MAP_IDS[(Math.random() * MAP_IDS.length) | 0];
    this.mapStart = Math.max(0, MAP_IDS.indexOf(this.map));
    this._enterLoadout();
  }

  // 熱身：沒有回合、不計分，死了 2 秒後重生。等朋友的時候打發時間，或兩個人先試槍
  startWarmup() {
    if (this.phase !== 'lobby' && this.phase !== 'matchEnd') return;
    for (const p of this.players) { p.maxHp = PLAYER.MAX_HP; p.hp = p.maxHp; p.armor = PLAYER.MAX_ARMOR; p.alive = true; p.buffs = []; p.skills = [null, null]; p.choices = null; p.respawnAt = 0; p.rHits = p.rDmg = p.rHead = 0; p.lastHurt = 0; p.inv = p.slowT = p.burnT = 0; }
    const m = this.settings.map;
    this.map = MAPS[m] ? m : MAP_IDS[(Math.random() * MAP_IDS.length) | 0];
    this.wn = (this.wn || 0) + 1; this.round = 1000 + this.wn;                // 熱身的局數從 1001 起跳，跟正式的局分開
    this.pickups = MAPS[this.map].pickups.map(() => ({ on: true, at: 0 }));
    this.result = null; this.matchWinner = -1; this.phase = 'warmup'; this.tEnd = 0; this.hz = null; this.dirty = true;
  }

  // ───────── 機器人模式：死鬥、守據點 ─────────
  // 跟熱身一樣是無限重生、免費拿裝備；不同的是對手換成一大群機器人（房主的 horde.js 在跑），
  // 這裡只記分數、重生、據點血量和波次
  _startHorde() {
    const s = this.settings, now = Date.now(), kind = s.mode, m = s.map;
    this.map = MAPS[m] ? m : MAP_IDS[(Math.random() * MAP_IDS.length) | 0];
    this.hn = (this.hn || 0) + 1; this.round = 2000 + this.hn;                // 局數從 2001 起跳，跟熱身、正式局分開
    this.players.forEach((p, i) => {
      Object.assign(p, { score: 0, buffs: [], skills: kind === 'defense' ? ['wall', null] : [null, null], choices: null, dmg: 0, heads: 0, maxHp: PLAYER.MAX_HP, hp: PLAYER.MAX_HP, armor: PLAYER.MAX_ARMOR,
        alive: this.present[i], respawnAt: 0, rHits: 0, rDmg: 0, rHead: 0, lastHurt: 0, inv: 0, slowT: 0, burnT: 0, phx: false, ready: false });
    });
    const c = s.hz;
    this.hz = {
      // 守據點的機器人一定會開槍（「不開槍」只給死鬥練習用）
      kind, cfg: kind === 'defense' ? { ...c, atk: true } : { ...c }, t0: now, end: kind === 'dm' && c.time ? now + c.time * 1000 : 0,
      st: kind === 'defense' ? 'break' : 'fight', wave: 0, cleared: 0, next: kind === 'defense' ? now + HORDE.FIRST_BREAK * 1000 : 0,
      core: HORDE.CORE_HP, coreMax: HORDE.CORE_HP, cp: null, gates: [], k: [0, 0], hs: [0, 0], d: [0, 0], left: -1, ack: 0, boss: 0, res: null, coreEvAt: 0,
    };
    this.pickups = MAPS[this.map].pickups.map(() => ({ on: true, at: 0 }));
    this.result = null; this.matchWinner = -1; this.phase = 'horde'; this.tEnd = this.hz.end || this.hz.next; this.dirty = true;
  }
  // 卡片影響的血量上限（守據點每一波選的卡）
  _hzApply(p) {
    const old = p.maxHp;
    p.maxHp = maxHpOf(p.buffs);
    if (p.alive) p.hp = Math.max(1, Math.min(p.maxHp, p.hp + (p.maxHp - old)));
    this.dirty = true;
  }
  // 每次 tick（每秒 20 次）的回血：再生（3 秒沒受傷後每秒 10）、天神下凡（一直每秒 4）
  _regen(p, now) {
    if (!p.alive || p.hp >= p.maxHp) return;
    let r = 0;
    if (p.buffs.includes('regen') && now - p.lastHurt > 3000) r += 10;
    if (p.buffs.includes('avatar')) r += 4;
    if (r) p.hp = Math.min(p.maxHp, p.hp + r * 0.05);
  }
  _hordeTick(now) {
    const hz = this.hz;
    this.players.forEach((p, i) => {
      if (!this.present[i]) { if (p.alive) { p.alive = false; this.dirty = true; } return; }
      if (!p.alive && now >= p.respawnAt) {
        p.hp = p.maxHp; p.armor = PLAYER.MAX_ARMOR; p.alive = true; p.inv = now + 1500; p.burnT = p.slowT = 0;   // 剛重生有 1.5 秒無敵
        this.out(i, 'ev', { t: 'respawn' }); this.dirty = true;
      }
      this._regen(p, now);
    });
    this.pickups.forEach((pk) => { if (!pk.on && now >= pk.at) { pk.on = true; this.dirty = true; } });
    if (hz.kind === 'dm') { if (hz.end && now >= hz.end) this._hordeEnd('time'); return; }
    if (hz.st === 'break' && now >= hz.next) {
      hz.st = 'wave'; hz.wave++; hz.left = -1; this.tEnd = 0;
      for (const p of this.players) if (p.choices) { this._take(p, p.choices[0], 0); this._hzApply(p); }   // 休息時沒選：自動拿第一張
      this.out(0, 'ev', { t: 'wave', st: 'wave', n: hz.wave }); this.out(1, 'ev', { t: 'wave', st: 'wave', n: hz.wave });
      this.dirty = true;
    } else if (hz.st === 'wave' && hz.ack === hz.wave && hz.left === 0) {
      // 這一波清光了：休息、倒下的人直接復活、每個人選一張強化卡
      hz.st = 'break'; hz.cleared = hz.wave; hz.next = now + HORDE.BREAK * 1000; this.tEnd = hz.next;
      hz.core = Math.min(hz.coreMax, hz.core + hz.coreMax * HORDE.CORE_REGEN);
      this.players.forEach((p, i) => {
        if (!this.present[i]) return;
        p.respawnAt = 0; p.phx = false; p.aid = false;
        const c = rollCards({ owned: p.buffs, n: 3, exclude: HZ_NO_CARDS });
        p.choices = c.length ? c : null;
      });
      this.out(0, 'ev', { t: 'wave', st: 'break', n: hz.wave }); this.out(1, 'ev', { t: 'wave', st: 'break', n: hz.wave });
      this.dirty = true;
    }
  }
  _hordeEnd(why) {
    const hz = this.hz;
    if (!hz || this.phase !== 'horde') return;
    hz.res = { why, t: Date.now() - hz.t0, waves: hz.cleared };
    this.phase = 'matchEnd'; this.matchWinner = -1; this.tEnd = 0; this.dirty = true; this.flush();
  }
  endHorde() { this._hordeEnd('quit'); }
  // 以下由房主的 horde.js 呼叫
  hzSetCore(c) { if (this.hz && Array.isArray(c)) { this.hz.cp = c.map((v) => Math.round(v * 1000) / 1000); this.dirty = true; } }
  hzGates(g) { if (this.hz) { this.hz.gates = g; this.dirty = true; } }
  hzCount(n, wave, boss) {
    const hz = this.hz; if (!hz) return;
    const b = Math.round(boss * 100) / 100;
    if (hz.left !== n || hz.ack !== wave || hz.boss !== b) { hz.left = n; hz.ack = wave; hz.boss = b; this.dirty = true; }
  }
  hzKill(by, kind, head, w) {
    const hz = this.hz; if (!hz || this.phase !== 'horde' || !this.players[by]) return;
    hz.k[by]++; if (head) { hz.hs[by]++; this.players[by].heads++; }
    this.players[by].score = hz.k[by];
    const e = { t: 'mkill', by, kind, head: !!head, w };
    this.out(0, 'ev', e); this.out(1, 'ev', e); this.dirty = true;
  }
  hzHit(by, dealt) {
    const A = this.players[by]; if (!A || this.phase !== 'horde') return;
    A.dmg += dealt; A.rDmg += dealt; A.rHits++;
    if (A.buffs.includes('leech') && A.alive) A.hp = Math.min(A.maxHp, A.hp + dealt * 0.5);
  }
  hzCore(d) {
    const hz = this.hz, now = Date.now();
    if (!hz || this.phase !== 'horde' || hz.kind !== 'defense' || !(d > 0)) return;
    hz.core = Math.max(0, hz.core - d); this.dirty = true;
    if (now - hz.coreEvAt > 220) { hz.coreEvAt = now; this.out(0, 'ev', { t: 'core' }); this.out(1, 'ev', { t: 'core' }); }
    if (hz.core <= 0) this._hordeEnd('core');
  }

  _enterLoadout() {
    this.phase = 'loadout'; this.round++;
    if (this.settings.map === 'rotate') this.map = MAP_IDS[(this.mapStart + this.round - 1) % MAP_IDS.length];
    const rogue = this.settings.mode === 'rogue';
    this.tEnd = Date.now() + (rogue ? ROGUE.TIME : MATCH.LOADOUT_TIME) * 1000;
    this.players.forEach((p, i) => {
      p.ready = false; p.loadout = validLoadout(null);   // 商店重置：沒買就是只有免費手槍
      if (!rogue) return;
      // Roguelike：每個人每局都抽卡；上一局輸的人多一張、手氣也比較好
      if (this.round > 1 && p.buffs.includes('investor')) p.money = Math.min(ECON.MAX, p.money + 1500);
      p.rr = 0; p.lucky = this.lastLoser === i;
      p.choices = this._roll(p);
    });
    this.dirty = true;
  }

  _roll(p, exclude = []) {
    const c = rollCards({ owned: p.buffs, skills: p.skills.filter(Boolean), n: p.lucky ? ROGUE.LOSER_N : ROGUE.N, luck: p.lucky ? ROGUE.LOSER_LUCK : 1, exclude, needActive: p.skills.includes(null) });
    return c.length ? c : null;
  }
  // 拿一張卡。主動技能放進空的技能格；兩格都滿了就換掉 slot 指定的那一格
  _take(p, id, slot) {
    const c = CARDS[id];
    p.choices = null; this.dirty = true;
    if (!c) return;
    if (c.k === 'a') { let s = p.skills.indexOf(null); if (s < 0) s = slot === 1 ? 1 : 0; p.skills[s] = id; }
    else if (!p.buffs.includes(id)) { p.buffs.push(id); if (id === 'investor' && this.phase === 'loadout') p.money = Math.min(ECON.MAX, p.money + 1500); }
  }
  _reroll(p) {
    if (this.settings.mode !== 'rogue' || this.phase !== 'loadout' || !p.choices || p.rr >= ROGUE.REROLLS) return;
    if (p.money - loadoutCost(p.loadout) < ROGUE.REROLL) return;      // 已經放進購物車的裝備也要算進去
    const next = this._roll(p, p.choices);
    if (!next) return;
    p.money -= ROGUE.REROLL; p.rr++; p.choices = next; this.dirty = true;
  }
  // 需要裁判動手的技能（目前只有腎上腺素要補血）
  _skill(i, id) {
    const p = this.players[i], now = Date.now();
    if (this.phase !== 'playing' || !p.alive || !p.skills.includes(id)) return;
    if (id === 'stim') {
      if (now - p.stimAt < CARDS.stim.cd * 1000 - 500) return;
      p.stimAt = now; p.hp = Math.min(p.maxHp, p.hp + SK.stim.heal); this.dirty = true; this.flush();
    }
  }

  _enterCountdown() {
    for (const p of this.players) {
      // 沒選就自動拿一張（優先拿不會擠掉現有技能的）
      if (p.choices) this._take(p, p.choices.find((id) => CARDS[id] && (CARDS[id].k === 'p' || p.skills.includes(null))) || p.choices[0], 0);
      // 結帳：依規則與餘額修正裝備，然後扣錢（買了就花掉，不退）
      p.loadout = fitLoadout(p.loadout, p.money, this.round);
      p.spent = loadoutCost(p.loadout); p.money -= p.spent;
      const has = (b) => p.buffs.includes(b);
      p.maxHp = maxHpOf(p.buffs);
      p.hp = p.maxHp; p.armor = (p.loadout.armor ? 50 : 0) + (has('plate') ? 100 : 0) + (has('arsenal') ? 50 : 0);   // 護甲片、軍火庫可以跟買的防彈衣疊加 p.alive = true; p.lastHurt = 0;
      p.rHits = p.rDmg = p.rHead = 0;   // 這一局的傷害報告歸零
      p.phx = false; p.aid = false; p.bt = false; p.inv = 0; p.slowT = 0; p.burnT = 0; p.stimAt = 0;
    }
    this.pickups = MAPS[this.map].pickups.map(() => ({ on: true, at: 0 }));
    this.result = null;
    this.phase = 'countdown'; this.tEnd = Date.now() + MATCH.COUNTDOWN * 1000; this.dirty = true;
  }

  _endRound(winner, info) {
    if (this.phase !== 'playing') return;
    this.phase = 'roundEnd'; this.tEnd = Date.now() + MATCH.ROUND_END * 1000;
    this.result = { winner, ...info };
    this.lastLoser = winner >= 0 ? 1 - winner : -1;
    const before = this.players.map((p) => p.money);
    if (winner >= 0) {
      const W = this.players[winner], L = this.players[1 - winner];
      W.score++; W.streak = 0; L.streak++;
      // 發錢：輸的人拿比較多，連敗再加碼
      W.money = Math.min(ECON.MAX, W.money + ECON.WIN);
      L.money = Math.min(ECON.MAX, L.money + Math.min(ECON.LOSE_MAX, ECON.LOSE + ECON.LOSE_STREAK * (L.streak - 1)));
      const mode = this.settings.buffMode;
      if (this.settings.mode === 'rogue') { /* Roguelike：卡片整場保留，下一局開始時大家再各抽一次 */ }
      else {
        if (mode !== 'permanent') W.buffs = [];   // 贏家的補償用掉了
        if (mode === 'single') L.buffs = [];      // 只留下一個新的
        if (mode === 'off') L.buffs = [];
        else if (W.score < this.settings.target) L.choices = rollBuffChoices(L.buffs);
      }
      if (W.score >= this.settings.target) this.matchWinner = winner;
    } else for (const p of this.players) p.money = Math.min(ECON.MAX, p.money + ECON.DRAW);
    this.result.inc = this.players.map((p, i) => p.money - before[i]);   // 這一局各拿到多少錢
    this.dirty = true;
  }

  // 訪客（或房主本機）送來的請求
  handle(i, t, d) {
    const p = this.players[i];
    if (!p || !d) return;
    if (t === 'loadout') { if (this.phase === 'loadout' || this.phase === 'lobby' || this.phase === 'warmup' || this.phase === 'horde') { p.loadout = validLoadout(d); this.dirty = true; } }
    else if (t === 'buff') { if (p.choices && p.choices.includes(d.id)) { this._take(p, d.id, d.slot | 0); if (this.phase === 'horde') this._hzApply(p); } }
    else if (t === 'mobhit') { if (d.r === this.round && this.phase === 'horde' && p.alive && this.onMobHit) this.onMobHit(i, d); }
    else if (t === 'reroll') this._reroll(p);
    else if (t === 'skill') { if (d.r === this.round) this._skill(i, d.id); }
    else if (t === 'ready') { if (this.phase === 'loadout' && !p.choices) { p.ready = !!d.v; this.dirty = true; } }
    else if (t === 'hit') { if (d.r === this.round && this.phase !== 'horde') this.damage(1 - i, +d.d || 0, i, d.w, !!d.h, d); }   // 機器人模式是同一隊，打不到隊友
    else if (t === 'self') { if (d.r === this.round) this.damage(i, +d.d || 0, i, d.w, false); }
    else if (t === 'pick') this._pickup(i, d.i | 0);
    else if (t === 'name') this.setName(i, d.name);
    else if (t === 'look') { p.look = validLook(d); this.dirty = true; }
  }

  // x：命中的附帶資訊（wb = 穿牆、bk = 背刺；機器人打的：mob = 哪一種、src = 開槍的位置 [x, z]）
  // attacker = -1：機器人
  damage(target, dmg, attacker, weapon, head, x) {
    const warm = this.phase === 'warmup', horde = this.phase === 'horde';
    if (this.phase !== 'playing' && !warm && !horde) return;
    const T = this.players[target], A = attacker >= 0 ? this.players[attacker] : null, now = Date.now();
    if (!T || !T.alive || !(dmg > 0)) return;
    if (now < T.inv) return;                                 // 不死鳥剛重生：短暫無敵
    dmg = Math.min(dmg, 400);
    // 減傷：硬皮、重裝巨人、天神下凡；求生本能在血量低的時候再減
    if (T.buffs.includes('tough')) dmg *= 0.75;
    if (T.buffs.includes('jugg')) dmg *= 0.9;
    if (T.buffs.includes('avatar')) dmg *= 0.8;
    if (T.buffs.includes('survivor') && T.hp < T.maxHp * 0.35) dmg *= 0.6;
    let toHp = dmg;
    if (T.armor > 0) { const ab = Math.min(T.armor, dmg * PLAYER.ARMOR_ABSORB); T.armor -= ab; toHp = dmg - ab; }
    const dealt = Math.min(T.hp, toHp);
    T.hp -= toHp; T.lastHurt = now;
    if (A && attacker !== target) {
      A.dmg += dealt; A.rDmg += dealt; A.rHits++; if (head) A.rHead++;
      if (A.buffs.includes('leech') && A.alive) A.hp = Math.min(A.maxHp, A.hp + dealt * 0.5);
      // 以下只有「真的被對手的槍或刀打中」才算（灼燒、反彈這類後續傷害不會再觸發一輪）
      if (WEAPONS[weapon]) {
        if (A.buffs.includes('cryo')) T.slowT = now + 1600;
        if (A.buffs.includes('incendiary')) { if (now >= T.burnT) T.burnNext = now + 500; T.burnT = now + 4000; T.burnBy = attacker; }
        if (T.buffs.includes('thorns') && A.alive && A.hp > 1) {
          const back = Math.min(A.hp - 1, dealt * 0.3);
          if (back >= 1) { A.hp -= back; A.lastHurt = now; this.out(attacker, 'ev', { t: 'hurt', d: Math.round(back), self: true, h: false, w: 'thorns' }); }
        }
      }
    }
    const src = x && Array.isArray(x.src) && x.src.length === 2 ? x.src : undefined;
    this.out(target, 'ev', { t: 'hurt', d: Math.round(toHp), self: attacker === target, h: head, w: weapon, src });
    // 急救包：每局一次，血掉到 35 以下（但還沒死）自動補 50
    if (T.hp > 0 && T.hp < 35 && !warm && T.buffs.includes('medkit') && !T.aid) {
      T.aid = true; T.hp = Math.min(T.maxHp, T.hp + 50);
      this.out(0, 'ev', { t: 'medkit', who: target }); this.out(1, 'ev', { t: 'medkit', who: target });
    }
    if (T.hp <= 0 && !warm && T.buffs.includes('phoenix') && !T.phx) {
      // 不死鳥：這一下本來會死，改成原地重生
      T.phx = true; T.hp = Math.min(T.maxHp, 70); T.inv = now + 2000; T.burnT = 0; T.slowT = 0;
      this.out(0, 'ev', { t: 'phoenix', who: target }); this.out(1, 'ev', { t: 'phoenix', who: target });
    } else if (T.hp <= 0) {
      T.hp = 0; T.alive = false;
      const suicide = attacker === target;
      if (head && !suicide && A) A.heads++;
      const info = { reason: suicide ? 'suicide' : 'kill', victim: target, w: weapon, head: head && !suicide, wb: !!(x && x.wb) && !suicide, bk: !!(x && x.bk) && !suicide };
      if (horde) {                                                             // 機器人模式：記一次陣亡，過幾秒重生
        this.hz.d[target]++;
        T.respawnAt = now + (this.hz.kind === 'dm' ? HORDE.DM_RESPAWN : HORDE.DEF_RESPAWN) * 1000;
        const e = { t: 'hkill', ...info, mob: x && typeof x.mob === 'string' ? x.mob : '' };
        this.out(0, 'ev', e); this.out(1, 'ev', e);
      } else if (warm) {                                                              // 熱身：通知雙方（擊殺訊息用），2 秒後重生
        T.respawnAt = Date.now() + 2000;
        this.out(0, 'ev', { t: 'wkill', ...info }); this.out(1, 'ev', { t: 'wkill', ...info });
      } else this._endRound(1 - target, info);
    }
    this.dirty = true; this.flush();
  }

  _pickup(i, k) {
    const p = this.players[i], pk = this.pickups[k], def = MAPS[this.map].pickups[k];
    if ((this.phase !== 'playing' && this.phase !== 'warmup' && this.phase !== 'horde') || !p.alive || !pk || !pk.on) return;
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
      for (let i = 0; i < 2; i++) {
        const p = this.players[i];
        this._regen(p, now);
        // 著火（對手的燃燒彈）：每半秒燒 4 血
        if (p.alive && now < p.burnT && now >= p.burnNext && this.phase === 'playing') { p.burnNext = now + 500; this.damage(i, 6, p.burnBy, 'incendiary', false); }
      }
      this.pickups.forEach((pk) => { if (!pk.on && now >= pk.at) { pk.on = true; this.dirty = true; } });
      if (this.phase === 'playing' && now >= this.tEnd) {
        const a = this.players[0], b = this.players[1];
        const va = a.hp + a.armor, vb = b.hp + b.armor;
        this._endRound(va === vb ? -1 : va > vb ? 0 : 1, { reason: 'time' });
      }
    } else if (this.phase === 'warmup') {
      this.players.forEach((p, i) => {
        if (!p.alive && now >= p.respawnAt) { p.hp = p.maxHp; p.armor = PLAYER.MAX_ARMOR; p.alive = true; p.rHits = p.rDmg = p.rHead = 0; this.out(i, 'ev', { t: 'respawn' }); this.dirty = true; }
      });
      this.pickups.forEach((pk) => { if (!pk.on && now >= pk.at) { pk.on = true; this.dirty = true; } });
    } else if (this.phase === 'horde') this._hordeTick(now);
    else if (this.phase === 'roundEnd') {
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
      p: this.players.map((p) => ({ n: p.name, sc: p.score, hp: Math.ceil(p.hp), mhp: p.maxHp, ar: Math.ceil(p.armor), al: p.alive, bf: p.buffs, st: p.streak, lo: p.loadout, $: p.money, sp: p.spent, lk: p.look, rd: p.ready, ch: p.choices, dmg: Math.round(p.dmg), hs: p.heads, rh: p.rHits, rdm: Math.round(p.rDmg), rhs: p.rHead,
        sk: p.skills, rr: p.rr, lu: p.lucky ? 1 : 0, fz: now < p.slowT ? 1 : 0, bu: now < p.burnT ? 1 : 0 })),
      pk: this.pickups.map((k) => (k.on ? 1 : 0)),
    };
    const hz = this.hz;
    if (hz) s.hz = { kind: hz.kind, cfg: hz.cfg, st: hz.st, wave: hz.wave, cleared: hz.cleared, core: Math.ceil(hz.core), coreMax: hz.coreMax, cp: hz.cp, gates: hz.gates, k: hz.k, hs: hz.hs, d: hz.d, left: hz.left, boss: hz.boss, res: hz.res, t: now - hz.t0 };
    this.out(0, 'gs', s); this.out(1, 'gs', s);
  }
}
