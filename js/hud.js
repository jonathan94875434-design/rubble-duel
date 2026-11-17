import { WEAPONS, PRIMARIES, SECONDARIES, GEAR, GEAR_IDS, loadoutCost, weaponBars } from './weapons.js';
import { BIND_ACTIONS, BIND_LABELS, keyName } from './binds.js';
import { BUFFS } from './buffs.js';
import { TEAM_CSS } from './config.js';
import { MAPS, MAP_IDS } from './maps.js';
import { BOT_LEVELS } from './bot.js';
import { SKINS, SKIN_IDS, WSKINS, WSKIN_IDS } from './skins.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SCREENS = ['menu', 'lobby', 'loadout', 'end', 'locker'];
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const MAP_OPTS = [['random', '隨機一張（整場固定）'], ['rotate', '每局輪流換圖'], ...MAP_IDS.map((id) => [id, MAPS[id].name])];
const opts = (list, cur) => list.map(([v, t]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`).join('');

// 所有 DOM 介面：選單、大廳、選槍、結算、對戰中的 HUD
export class Hud {
  constructor(g) {
    this.g = g; this.cache = {}; this.bannerT = 0; this.toastT = 0; this.buffKey = ''; this.hurtT = 0;
    this.capture = null; this.setMode = null; this.flashT = 0;
    this._buildWeapons();
    this._buildLocker();
    this._bind();
  }

  _set(id, v) { if (this.cache[id] !== v) { this.cache[id] = v; $(id).textContent = v; } }
  _cls(id, name, on) { const k = id + '.' + name; if (this.cache[k] !== on) { this.cache[k] = on; $(id).classList.toggle(name, on); } }

  _buildWeapons() {
    const mk = (id) => {
      const d = WEAPONS[id], el = document.createElement('div');
      el.className = 'wcard'; el.dataset.id = id;
      el.innerHTML = `<div class="nm"><span>${esc(d.name)}</span><span class="price">${d.price ? '$' + d.price : '免費'}</span></div><div class="ds">${esc(d.tag)}｜${esc(d.desc)}</div>`
        + `<div class="bars">${weaponBars(d).map(([n, v]) => `<span>${n}</span><div class="b"><i style="width:${Math.round(v * 100)}%"></i></div>`).join('')}</div>`;
      el.addEventListener('click', () => this.g.buy(d.slot, id));
      return el;
    };
    for (const id of PRIMARIES) $('lo-p').appendChild(mk(id));
    for (const id of SECONDARIES) $('lo-s').appendChild(mk(id));
    for (const id of GEAR_IDS) {
      const d = GEAR[id], el = document.createElement('div');
      el.className = 'gcard'; el.dataset.id = id;
      el.innerHTML = `<div class="glyph">${d.glyph}</div><div class="info"><div class="t"><span>${esc(d.name)}${d.max > 1 ? `（最多 ${d.max}）` : ''}</span><span class="price">$${d.price}</span></div><div class="d">${esc(d.desc)}</div></div><div class="cnt"></div>`;
      el.addEventListener('click', () => this.g.buy(id));
      $('lo-g').appendChild(el);
    }
  }

  // ───────── 設定面板與按鍵 ─────────
  renderBinds() {
    const b = this.g.binds, k = (a) => keyName(b[a]);
    $('keybinds').innerHTML = BIND_ACTIONS.map((a) => `<div class="row"><span>${BIND_LABELS[a]}</span><button class="kb${this.capture === a ? ' wait' : ''}" data-a="${a}">${this.capture === a ? '請按一個鍵…' : esc(k(a))}</button></div>`).join('');
    const key = (t) => `<b>${esc(t)}</b>`;
    $('keys-hint').innerHTML = `${key(k('fwd') + k('left') + k('back') + k('right'))} 移動　${key(k('jump'))} 跳（按住連跳）　${key(k('crouch'))} 蹲下<br>`
      + `${key('左鍵')} 開火　${key('右鍵 / ' + k('ads'))} 瞄準　${key(k('reload'))} 換彈<br>`
      + `${key(k('primary') + ' / ' + k('secondary') + ' / ' + k('swap') + ' / 滾輪')} 切槍<br>`
      + `${key(k('he'))} 手榴彈　${key(k('flash'))} 閃光彈　${key(k('smoke'))} 煙霧彈　${key('Esc')} 設定`;
    this.cache.nades = null;
  }
  // mode: 'pause' 對戰中（點空白處繼續）／'menu' 對局外
  _settings(mode) {
    this.setMode = mode; this.capture = null;
    $('pause').classList.toggle('hidden', !mode);
    if (!mode) return;
    $('pause-title').textContent = mode === 'pause' ? '暫停 — 點空白處或按「繼續」回到遊戲' : '設定';
    $('btn-resume').textContent = mode === 'pause' ? '繼續' : '完成';
    $('btn-quit').classList.toggle('hidden', mode !== 'pause');
    this.renderBinds();
  }
  openSettings() { this._settings('menu'); }
  setPaused(v) { if (v) this._settings('pause'); else if (this.setMode === 'pause') this._settings(null); }

  _buildLocker() {
    const g = this.g;
    const mk = (box, kind, id, name, c1, c2) => {
      const el = document.createElement('div');
      el.className = 'swatch'; el.dataset.kind = kind; el.dataset.id = id;
      el.innerHTML = `<i style="background:${c1};--c2:${c2}"></i><span>${esc(name)}</span>`;
      el.addEventListener('click', () => { g.setLook(kind, id); this._lockerSel(); });
      $(box).appendChild(el);
    };
    for (const id of SKIN_IDS) { const k = SKINS[id]; mk('lk-skins', 'skin', id, k.name, k.body === null ? TEAM_CSS[0] : hex(k.body), hex(k.glow || k.legs)); }
    for (const id of WSKIN_IDS) { const k = WSKINS[id]; mk('lk-wskins', 'wskin', id, k.name, k.color === null ? '#4b5a48' : hex(k.color), k.glow ? hex(k.glow) : 'transparent'); }
    this._lockerSel();
  }
  _lockerSel() {
    const st = this.g.settings;
    document.querySelectorAll('.swatch').forEach((el) => el.classList.toggle('sel', st[el.dataset.kind] === el.dataset.id));
  }

  _bind() {
    const g = this.g;
    document.addEventListener('pointerdown', () => g.sfx.init(), true);
    $('in-name').value = g.settings.name;
    $('in-name').addEventListener('input', (e) => g.setSetting('name', e.target.value.trim().slice(0, 14)));
    $('btn-host').addEventListener('click', () => g.hostGame());
    $('btn-join').addEventListener('click', () => g.joinGame($('in-code').value));
    $('in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') g.joinGame($('in-code').value); });
    $('btn-bot').addEventListener('click', () => g.practice());
    $('sel-bot').innerHTML = opts(Object.keys(BOT_LEVELS).map((k) => [k, '對手：' + BOT_LEVELS[k].name]), g.settings.bot);
    $('sel-bot').addEventListener('change', (e) => g.setSetting('bot', e.target.value));
    $('sel-pmap').innerHTML = opts(MAP_OPTS.filter(([v]) => v !== 'rotate').map(([v, t]) => [v, v === 'random' ? '地圖：隨機' : t]), g.settings.pmap);
    $('sel-pmap').addEventListener('change', (e) => g.setSetting('pmap', e.target.value));
    $('btn-locker').addEventListener('click', () => { g.sfx.ui(); g.openLocker(); });
    $('btn-locker-back').addEventListener('click', () => { g.sfx.ui(); g.closeLocker(); });
    $('set-map').innerHTML = opts(MAP_OPTS, 'random');
    $('chk-wheel').checked = !!g.settings.wheel;
    $('chk-wheel').addEventListener('change', (e) => g.setSetting('wheel', e.target.checked));
    $('btn-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(g.inviteLink()); this.toast('邀請連結已複製，貼給朋友吧'); }
      catch { this.toast('複製失敗，請手動告訴朋友房號'); }
    });
    for (const [id, key] of [['set-target', 'target'], ['set-time', 'roundTime'], ['set-buff', 'buffMode'], ['set-map', 'map']]) {
      $(id).addEventListener('change', (e) => g.changeSettings({ [key]: e.target.value }));
    }
    $('btn-start').addEventListener('click', () => g.startMatch());
    $('btn-rematch').addEventListener('click', () => g.startMatch());
    for (const id of ['btn-leave', 'btn-end-leave', 'btn-quit']) $(id).addEventListener('click', (e) => { e.stopPropagation(); g.leave(); });
    $('btn-ready').addEventListener('click', () => g.toggleReady());
    $('btn-settings').addEventListener('click', () => { g.sfx.ui(); this.openSettings(); });
    $('btn-gear').addEventListener('click', () => { g.sfx.ui(); this.openSettings(); });
    $('btn-reset-binds').addEventListener('click', (e) => { e.stopPropagation(); this.capture = null; g.resetBinds(); });
    $('pause').addEventListener('click', (e) => {
      const kb = e.target.closest('.kb');
      if (kb) { this.capture = this.capture === kb.dataset.a ? null : kb.dataset.a; this.renderBinds(); return; }
      if (this.capture) { this.capture = null; this.renderBinds(); }
      const done = e.target.id === 'btn-resume' || e.target.id === 'pause';
      if (this.setMode === 'pause') { if (done || !e.target.closest('input, button, label')) g.requestLock(); }
      else if (done) this._settings(null);
    });
    // 改按鍵：攔在最前面，這次按鍵不會傳給遊戲
    addEventListener('keydown', (e) => {
      if (!this.capture) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.code !== 'Escape') g.setBind(this.capture, e.code);
      this.capture = null; this.renderBinds();
    }, true);
    addEventListener('mousedown', (e) => {
      if (!this.capture || e.button === 0 || e.button === 2) return;
      e.preventDefault(); e.stopImmediatePropagation();
      g.setBind(this.capture, 'Mouse' + e.button); this.capture = null; this.renderBinds();
    }, true);
    this.renderBinds();
    for (const [id, key, out, fmt] of [['rng-sens', 'sens', 'out-sens', (v) => v.toFixed(2)], ['rng-fov', 'fov', 'out-fov', (v) => String(v)], ['rng-vol', 'vol', 'out-vol', (v) => Math.round(v * 100) + '%']]) {
      $(id).value = g.settings[key]; $(out).textContent = fmt(+g.settings[key]);
      $(id).addEventListener('input', (e) => { const v = +e.target.value; $(out).textContent = fmt(v); g.setSetting(key, v); });
    }
  }

  show(name) {
    for (const s of SCREENS) $('scr-' + s).classList.toggle('hidden', s !== name);
    this.screen = name;
    $('btn-gear').classList.toggle('hidden', !name);   // 對局外隨時可以開設定；對戰中用 Esc
    if (!name && this.setMode === 'menu') this._settings(null);
  }

  // 被閃光彈閃到：整個畫面變白，撐一下再慢慢退
  flash(k, dur) {
    const f = $('flashfx');
    f.style.transition = 'none'; f.style.opacity = String(k);
    clearTimeout(this.flashT);
    this.flashT = setTimeout(() => { f.style.transition = `opacity ${(dur * 0.6).toFixed(2)}s ease-in`; f.style.opacity = '0'; }, dur * 400);
  }
  clearFlash() { clearTimeout(this.flashT); const f = $('flashfx'); f.style.transition = 'none'; f.style.opacity = '0'; }
  showHud(v) { $('hud').classList.toggle('hidden', !v); }
  menuMsg(t) { $('menu-msg').textContent = t || ''; }
  menuBusy(b) { for (const id of ['btn-host', 'btn-join', 'btn-bot', 'btn-locker']) $(id).disabled = b; }
  setCode(c) { $('in-code').value = c; }

  toast(text, ms = 2600) {
    const t = $('toast'); t.textContent = text; t.classList.add('show');
    clearTimeout(this.toastT); this.toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  banner(big, sub = '', ms = 1600) {
    const b = $('banner');
    b.querySelector('.big').textContent = big; b.querySelector('.sub').textContent = sub;
    b.classList.add('show');
    clearTimeout(this.bannerT);
    if (ms > 0) this.bannerT = setTimeout(() => b.classList.remove('show'), ms);
  }
  clearBanner() { clearTimeout(this.bannerT); $('banner').classList.remove('show'); }

  hitmarker(head) {
    const h = $('hitmarker');
    h.classList.remove('show'); h.classList.toggle('head', !!head);
    void h.offsetWidth; h.classList.add('show');
  }

  // angle：攻擊來源相對於準星的方向（弧度，順時針）；null = 自己炸到自己
  hurt(angle) {
    const v = $('vignette'); v.style.opacity = '0.55';
    clearTimeout(this.hurtT);
    const arc = $('hurt-arc');
    if (angle !== null) { arc.style.transform = `rotate(${angle}rad)`; arc.style.opacity = '1'; }
    this.hurtT = setTimeout(() => { v.style.opacity = '0'; arc.style.opacity = '0'; }, 280);
  }

  feed(text) {
    const d = document.createElement('div'); d.textContent = text;
    $('feed').appendChild(d);
    setTimeout(() => d.remove(), 5200);
  }

  // ───────── 依主機狀態更新靜態畫面 ─────────
  onState(gs) {
    const g = this.g, me = g.me, opp = 1 - me, P = gs.p;
    document.documentElement.style.setProperty('--me', TEAM_CSS[me]);
    document.documentElement.style.setProperty('--opp', TEAM_CSS[opp]);
    this._set('nm-me', P[me].n); this._set('nm-opp', P[opp].n);
    this._set('sc-me', String(P[me].sc)); this._set('sc-opp', String(P[opp].sc));
    this._set('roundno', `第 ${gs.round} 局 · 搶 ${gs.set.target} · ${MAPS[gs.map].name}`);

    if (gs.phase === 'lobby') {
      this._set('lb-code', g.code || '-----');
      this._set('lb-p0', P[0].n); this._set('lb-p1', gs.here[1] ? P[1].n : '等待對手加入…');
      $('lb-p1').parentElement.classList.toggle('empty', !gs.here[1]);
      this._set('lb-hint', g.net.isHost
        ? (gs.here[1] ? '對手已連線，調好規則就可以開始。'
          : g.net.mode === 'peer' && ['localhost', '127.0.0.1'].includes(location.hostname)
            ? '注意：現在是本機網址（localhost），朋友的電腦打不開這個連結。要先把遊戲放上網路，再從那個網址建立房間。'
            : '按「複製邀請連結」傳給朋友，對方打開連結、按加入就會進來。這個分頁請保持開著。')
        : '已連線，等房主按開始。');
      for (const [id, key] of [['set-target', 'target'], ['set-time', 'roundTime'], ['set-buff', 'buffMode'], ['set-map', 'map']]) {
        const el = $(id); el.disabled = !g.net.isHost;
        if (document.activeElement !== el) el.value = String(gs.set[key]);
      }
      $('btn-start').classList.toggle('hidden', !g.net.isHost);
      $('btn-start').disabled = !gs.here[1];
      $('btn-copy').classList.toggle('hidden', !g.net.isHost);
    } else if (gs.phase === 'loadout') this._loadout(gs);
    else if (gs.phase === 'matchEnd') this._end(gs);
  }

  _loadout(gs) {
    const g = this.g, me = gs.p[g.me], opp = gs.p[1 - g.me];
    const r1 = gs.round <= 1, sel = g.sel, money = me.$, cost = loadoutCost(sel);
    this._set('lo-title', r1 ? '第 1 局 — 手槍局（只能買副武器和裝備）' : `第 ${gs.round} 局 — 購買裝備`);
    this._set('lo-map', `地圖：${MAPS[gs.map].name}　${MAPS[gs.map].desc}`);
    const mk = `${money}:${cost}`;
    if (this.cache.loMoney !== mk) { this.cache.loMoney = mk; $('lo-money').innerHTML = `<b>$${money}</b><span>本局花費 $${cost}　剩下 $${money - cost}</span>`; }
    const sk = `${me.sc}:${opp.sc}:${gs.set.target}`;
    if (this.cache.loScore !== sk) {
      this.cache.loScore = sk;
      $('lo-score').innerHTML = `<b class="me">${esc(me.n)} ${me.sc}</b> ： <b class="opp">${opp.sc} ${esc(opp.n)}</b>　·　先拿 ${gs.set.target} 分獲勝`;
    }
    document.querySelectorAll('.wcard').forEach((el) => {
      const d = WEAPONS[el.dataset.id], isP = d.slot === 'p', on = isP ? sel.p === el.dataset.id : sel.s === el.dataset.id;
      const rest = cost - (isP ? (sel.p ? WEAPONS[sel.p].price : 0) : WEAPONS[sel.s].price);   // 這一格以外已經花掉的
      el.classList.toggle('sel', on); el.classList.toggle('locked', isP && r1); el.classList.toggle('poor', !on && rest + d.price > money);
    });
    document.querySelectorAll('.gcard').forEach((el) => {
      const d = GEAR[el.dataset.id], n = sel[el.dataset.id] || 0;
      el.classList.toggle('sel', n > 0); el.classList.toggle('poor', n === 0 && cost + d.price > money);
      el.querySelector('.cnt').textContent = n ? '×' + n : '';
    });

    const key = me.ch ? me.ch.join(',') : '';
    if (key !== this.buffKey) {
      this.buffKey = key;
      const box = $('lo-buff-cards'); box.innerHTML = '';
      $('lo-buff').classList.toggle('hidden', !me.ch);
      for (const id of me.ch || []) {
        const b = BUFFS[id], el = document.createElement('div');
        el.className = 'buffcard';
        el.innerHTML = `<div class="glyph">${b.glyph}</div><div><div class="t">${esc(b.name)}</div><div class="d">${esc(b.desc)}</div></div>`;
        el.addEventListener('click', () => g.pickBuff(id));
        box.appendChild(el);
      }
    }
    const bk = me.bf.join(',');
    if (this.cache.myBuffs !== bk) {
      this.cache.myBuffs = bk;
      $('lo-mybuffs').innerHTML = me.bf.length
        ? '本局強化：' + me.bf.map((id) => `<span class="chip"><span class="glyph">${BUFFS[id].glyph}</span>${esc(BUFFS[id].name)}</span>`).join('')
        : '';
    }
    const os = opp.ch ? `${opp.n} 正在挑強化…` : opp.rd ? `${opp.n} 已準備 ✓` : `${opp.n} 選槍中…`;
    this._set('lo-opp', os); this._cls('lo-opp', 'ok', !!opp.rd);
    const rb = $('btn-ready');
    rb.disabled = !!me.ch;
    this._set('btn-ready', me.ch ? '先選一個強化' : me.rd ? '已準備 ✓（再按取消）' : '準備');
    this._cls('btn-ready', 'on', !!me.rd);
  }

  _end(gs) {
    const g = this.g, me = gs.p[g.me], opp = gs.p[1 - g.me], win = gs.mw === g.me;
    const t = $('end-title'); t.textContent = win ? '勝利' : '落敗'; t.className = win ? 'win' : 'lose';
    $('end-score').innerHTML = `<span class="me">${me.sc}</span> ： <span class="opp">${opp.sc}</span>`;
    $('end-stats').innerHTML = `<tr><th></th><th>拿下局數</th><th>總傷害</th><th>爆頭擊殺</th></tr>`
      + [me, opp].map((p) => `<tr><td>${esc(p.n)}</td><td>${p.sc}</td><td>${p.dmg}</td><td>${p.hs}</td></tr>`).join('');
    $('btn-rematch').classList.toggle('hidden', !g.net.isHost);
    $('end-wait').textContent = g.net.isHost ? '' : '等房主決定要不要再來一場…';
  }

  // ───────── 每一幀更新 ─────────
  frame(d) {
    const tl = Math.max(0, d.tLeft);
    if (d.phase === 'loadout') { this._set('lo-timer', String(Math.ceil(tl / 1000))); return; }
    const s = Math.ceil(tl / 1000);
    this._set('timer', d.phase === 'playing' ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '--:--');
    this._cls('timer', 'low', d.phase === 'playing' && s <= 15);

    const hp = d.hp, mhp = d.mhp;
    this._set('num-hp', String(hp)); this._set('num-armor', String(d.armor));
    const hw = Math.round((hp / mhp) * 100), aw = Math.round((d.armor / 50) * 100);
    if (this.cache.hw !== hw) { this.cache.hw = hw; $('bar-hp').style.width = hw + '%'; $('bar-hp').parentElement.classList.toggle('low', hp <= 35); }
    if (this.cache.aw !== aw) { this.cache.aw = aw; $('bar-armor').style.width = Math.min(100, aw) + '%'; }
    const bk = d.buffs.join(',');
    if (this.cache.hudBuffs !== bk) {
      this.cache.hudBuffs = bk;
      $('buffs').innerHTML = d.buffs.map((id) => `<div class="glyph" title="${esc(BUFFS[id].name)}">${BUFFS[id].glyph}</div>`).join('');
    }

    if (d.w) {
      this._set('ammo-n', String(d.w.ammo));
      this._set('ammo-r', d.w.reserve === Infinity ? '∞' : String(d.w.reserve));
      this._cls('ammo-n', 'low', d.w.ammo <= Math.ceil(d.w.mag * 0.25));
      this._set('wname', `${d.slot + 1} · ${d.w.def.name}`);
      this._set('wother', d.other ? `${2 - d.slot} · ${d.other.def.name}　${d.other.ammo}/${d.other.reserve === Infinity ? '∞' : d.other.reserve}` : '');
      const rb = $('reloadbar');
      if (d.reload > 0) { rb.style.opacity = '1'; rb.firstElementChild.style.width = Math.round(d.reload * 100) + '%'; }
      else if (this.cache.rl !== 0) rb.style.opacity = '0';
      this.cache.rl = d.reload;
    }
    const gap = Math.round(Math.max(3, d.gap));
    if (this.cache.gap !== gap) { this.cache.gap = gap; $('crosshair').style.setProperty('--gap', gap + 'px'); }
    this._cls('crosshair', 'off', !d.alive || d.scoped);
    const so = d.scoped ? '1' : '0';
    if (this.cache.scope !== so) { this.cache.scope = so; $('scope').style.opacity = so; }
    this._set('netinfo', d.net);
    const nk = `${d.nades.he},${d.nades.flash},${d.nades.smoke}`;
    if (this.cache.nades !== nk) {
      this.cache.nades = nk;
      const b = this.g.binds;
      $('nades').innerHTML = [['he', '手榴彈'], ['flash', '閃光'], ['smoke', '煙霧']].filter(([k]) => d.nades[k] > 0).map(([k, t]) => `<span><b>${esc(keyName(b[k]))}</b>${t} ×${d.nades[k]}</span>`).join('');
    }
    this._set('money', '$' + d.money);
    this._set('speed-n', d.spd.toFixed(1));
    this._cls('speed', 'fast', d.spd > 7.2); this._cls('speed', 'crouch', !!d.crouch);
  }
}
