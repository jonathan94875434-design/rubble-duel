import { WEAPONS, PRIMARIES, SECONDARIES, GEAR, GEAR_IDS, NADE_IDS, loadoutCost, weaponBars, itemName } from './weapons.js';
import { BIND_ACTIONS, BIND_LABELS, keyName } from './binds.js';
import { CARDS, RARITY, cardName } from './cards.js';
import { TEAM_CSS, ROGUE, HORDE } from './config.js';
import { MOBS, HZ_LEVELS, HZ_BEH, HZ_TIER } from './horde.js';
import { MAPS, MAP_IDS, customIds, deleteMap } from './maps.js';
import { BOT_LEVELS } from './bot.js';
import { SKINS, SKIN_IDS, WSKINS, WSKIN_IDS } from './skins.js';
import { BLOCK } from './world.js';
import { ENVS, ENV_IDS } from './env.js';
import { SPRAYS, SPRAY_IDS, sprayCanvas } from './sprays.js';
import { PALETTE, SYM } from './editor.js';
import { shootIcons } from './icons.js';
import { store } from './util.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SCREENS = ['menu', 'lobby', 'loadout', 'end', 'locker', 'stats', 'editor', 'hz'];
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const opts = (list, cur) => list.map(([v, t]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`).join('');
const svg = (d, vb = '0 0 16 16') => `<svg viewBox="${vb}" aria-hidden="true">${d}</svg>`;
// 小圖示（全部手刻的 SVG）
const ICON = {
  hp: svg('<path d="M6 1h4v5h5v4h-5v5H6v-5H1V6h5z"/>'),
  armor: svg('<path d="M8 1l6 2v5c0 3.6-2.6 6-6 7-3.4-1-6-3.4-6-7V3z"/>'),
  he: svg('<path d="M6 2h4v2h2v2h-1.2A4.5 4.5 0 1 1 5.2 6H4V4h2z"/>'),
  flash: svg('<path d="M5 1h6v2h-1v1h1v10H5V4h1V3H5zm2 5v2h2V6zm0 4v2h2v-2z" fill-rule="evenodd"/>'),
  smoke: svg('<path d="M5 6h6v9H5zM6 3h4v2H6zM2.5 3.2a1.8 1.8 0 1 1 3-1.6 1.6 1.6 0 1 1 2.6 1.2H3.2z"/>'),
  molotov: svg('<path d="M7 5h2v2l2 2v6H5V9l2-2zM8 0c1.6 1.2 1.8 2.6.6 4H7.2C6.6 2.8 6.8 1.4 8 0z"/>'),
  knife: svg('<path d="M14.5 1.5c.3 3.4-2 7-6.2 9.2L7 9.4zM6.2 10.2l1.4 1.4-1 1 .9.9-1.2 1.2-.9-.9-1.6 1.6-1.4-1.4z"/>'),
  mic: svg('<path d="M8 1a2.2 2.2 0 0 1 2.2 2.2v4.3a2.2 2.2 0 0 1-4.4 0V3.2A2.2 2.2 0 0 1 8 1zM3.6 7h1.3a3.1 3.1 0 0 0 6.2 0h1.3a4.4 4.4 0 0 1-3.7 4.3V13H11v1.5H5V13h2.3v-1.7A4.4 4.4 0 0 1 3.6 7z"/>'),
  spk: svg('<path d="M2 6h3l4-3.5v11L5 10H2zm9.2-1.2a4.5 4.5 0 0 1 0 6.4l-1-1a3 3 0 0 0 0-4.4zm1.9-1.9a7.2 7.2 0 0 1 0 10.2l-1-1a5.8 5.8 0 0 0 0-8.2z"/>'),
  head: svg('<path d="M8 1a5.6 5.6 0 0 1 5.6 5.6c0 2-1 3.5-2.3 4.4V14H4.7v-3C3.4 10.100 2.400 8.600 2.400 6.600A5.600 5.600 0 0 1 8 1zM5.800 5.600a1.400 1.400 0 1 0 0 2.800 1.400 1.400 0 0 0 0-2.800zm4.400 0a1.400 1.400 0 1 0 0 2.800 1.400 1.400 0 0 0 0-2.800z" fill-rule="evenodd"/>'),
  wall: svg('<path d="M1 2h14v3H1zm0 4h6v3H1zm7 0h7v3H8zM1 10h9v4H1zm10 0h4v4h-4z"/>'),
  back: svg('<path d="M8 1l5 5h-3v5H6V6H3zM3 13h10v2H3z"/>'),
};
const css = (c) => `rgb(${c.map((v) => Math.round(Math.pow(v, 0.45) * 255)).join(',')})`;

// 所有 DOM 介面：選單、大廳、選槍、結算、戰績、編輯器面板、對戰中的 HUD
export class Hud {
  constructor(g) {
    this.g = g; this.cache = {}; this.bannerT = 0; this.toastT = 0; this.buffKey = ''; this.hurtT = 0;
    this.capture = null; this.setMode = null; this.flashT = 0; this.icons = null; this.iconSkin = ''; this.statMode = 'duel';
    $('ico-hp').innerHTML = ICON.hp; $('ico-armor').innerHTML = ICON.armor;
    this._buildWeapons();
    this._buildLocker();
    this._buildEditor();
    this._bind();
    this.refreshMaps();
    this.applyCrosshair();
  }

  _set(id, v) { if (this.cache[id] !== v) { this.cache[id] = v; $(id).textContent = v; } }
  _cls(id, name, on) { const k = id + '.' + name; if (this.cache[k] !== on) { this.cache[k] = on; $(id).classList.toggle(name, on); } }
  key(action) { return keyName(this.g.binds[action]); }

  // 槍的側面照（第一次要用到時才拍；沒有顯示卡的環境就不拍，介面退回純文字）
  _icons() {
    const g = this.g, skin = g.settings.wskin;
    if (g.qualityId === 'min') return {};
    if (!this.icons || this.iconSkin !== skin) {
      this.icons = shootIcons([...PRIMARIES, ...SECONDARIES, 'knife'], skin, NADE_IDS); this.iconSkin = skin;
      document.querySelectorAll('.wcard').forEach((el) => { const im = el.querySelector('img'), u = this.icons[el.dataset.id]; if (im && u) { im.src = u; im.classList.remove('hidden'); } });
      this.cache.wimg = null; this.cache.slots = null;
    }
    return this.icons;
  }

  _buildWeapons() {
    const mk = (id) => {
      const d = WEAPONS[id], el = document.createElement('div');
      el.className = 'wcard'; el.dataset.id = id;
      el.innerHTML = `<img class="hidden" alt=""><div class="nm"><span>${esc(d.name)}</span><span class="price" data-p="${d.price}">${d.price ? '$' + d.price : '免費'}</span></div><div class="ds">${esc(d.tag)}｜${esc(d.desc)}</div>`
        + `<div class="bars">${weaponBars(d).map(([n, v]) => `<span>${n}</span><div class="b"><i style="width:${Math.round(v * 100)}%"></i></div>`).join('')}</div>`;
      el.addEventListener('click', () => this.g.buy(d.slot, id));
      return el;
    };
    for (const id of PRIMARIES) $('lo-p').appendChild(mk(id));
    for (const id of SECONDARIES) $('lo-s').appendChild(mk(id));
    for (const id of GEAR_IDS) {
      const d = GEAR[id], el = document.createElement('div');
      el.className = 'gcard'; el.dataset.id = id;
      el.innerHTML = `<div class="glyph">${ICON[id] || d.glyph}</div><div class="info"><div class="t"><span>${esc(d.name)}${d.max > 1 ? `（最多 ${d.max}）` : ''}</span><span class="price" data-p="${d.price}">$${d.price}</span></div><div class="d">${esc(d.desc)}</div></div><div class="cnt"></div>`;
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
      + `${key(k('primary') + ' / ' + k('secondary') + ' / ' + k('knife'))} 主槍／副槍／刀　${key(k('swap'))} 切回上一把<br>`
      + `${key(k('he'))} 手榴彈　${key(k('flash'))} 閃光　${key(k('smoke'))} 煙霧　${key(k('molotov'))} 燃燒瓶<br>`
      + `${key(k('spray'))} 噴漆　${key(k('emote'))} 表情　${key(k('talk'))} 語音　${key('Esc')} 設定<br>`
      + `${key(k('skill1') + ' / ' + k('skill2'))} 技能（Roguelike 模式）`;
    $('lk-spraykey').textContent = k('spray'); $('lk-emotekey').textContent = k('emote');
    this.cache.nades = null; this.cache.slots = null; this.cache.skIds = null; this.buffKey = null; this.cache.builds = null;
  }
  // mode: 'pause' 對戰中（點空白處繼續）／'menu' 對局外
  _settings(mode) {
    this.setMode = mode; this.capture = null;
    $('pause').classList.toggle('hidden', !mode);
    if (!mode) return;
    const g = this.g;
    $('pause-title').textContent = mode === 'pause' ? '暫停 — 點空白處或按「繼續」回到遊戲' : '設定';
    $('btn-resume').textContent = mode === 'pause' ? '繼續' : '完成';
    $('btn-quit').classList.toggle('hidden', mode !== 'pause');
    $('btn-endwarm').classList.toggle('hidden', !(mode === 'pause' && (g.phase === 'warmup' || g.phase === 'horde') && g.net.isHost));
    $('btn-endwarm').textContent = g.phase === 'horde' ? '結束這一場（看結算）' : '結束熱身';
    this.syncSettings();
    this.renderBinds();
  }
  openSettings() { this._settings('menu'); }
  setPaused(v) { if (v) this._settings('pause'); else if (this.setMode === 'pause') this._settings(null); }

  // 把設定值填回各個控制項
  syncSettings() {
    const st = this.g.settings, x = st.xh;
    for (const [id, key, out, fmt] of this._ranges) { $(id).value = st[key]; $(out).textContent = fmt(+st[key]); }
    $('chk-wheel').checked = !!st.wheel; $('chk-minimap').checked = !!st.minimap; $('chk-fps').checked = !!st.fps;
    const q = this.g.QUALITY[this.g.qualityId];      // 開機時畫質還沒決定，這裡可能是空的
    $('sel-quality').value = st.quality; $('out-quality').textContent = st.quality === 'auto' && q ? `（目前：${q.name}）` : '';
    $('sel-voice').value = st.voice;
    $('xh-style').value = x.style; $('xh-color').value = x.color; $('xh-len').value = x.len; $('xh-thick').value = x.thick; $('xh-gap').value = x.gap; $('xh-alpha').value = x.alpha;
    $('xh-dot').checked = !!x.dot; $('xh-outline').checked = !!x.outline; $('xh-dyn').checked = !!x.dyn;
    $('out-xlen').textContent = x.len; $('out-xthick').textContent = x.thick; $('out-xgap').textContent = x.gap; $('out-xalpha').textContent = Math.round(x.alpha * 100) + '%';
    this.voiceState(this.g.voice);
  }

  // 準星：把設定寫成 CSS 變數（HUD 上那個和設定裡的預覽共用同一套樣式）
  applyCrosshair() {
    const x = this.g.settings.xh;
    for (const el of [$('crosshair'), document.querySelector('#xh-preview .xh')]) {
      const s = el.style;
      s.setProperty('--xc', x.color); s.setProperty('--xl', x.len + 'px'); s.setProperty('--xt', x.thick + 'px'); s.setProperty('--xa', String(x.alpha));
      el.dataset.style = x.style; el.classList.toggle('nodot', !x.dot); el.classList.toggle('outline', !!x.outline);
    }
    document.querySelector('#xh-preview .xh').style.setProperty('--gap', 6 + x.gap + 'px');
    this.cache.gap = null;
  }

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
    for (const id of SPRAY_IDS) {
      const el = document.createElement('div'); el.className = 'spray'; el.dataset.id = id; el.title = SPRAYS[id].name;
      const c = document.createElement('canvas'); c.width = c.height = 64; c.getContext('2d').drawImage(sprayCanvas(id), 0, 0, 64, 64);
      el.appendChild(c);
      el.addEventListener('click', () => { g.setSetting('spray', id); g.sfx.ui(); this._lockerSel(); });
      $('lk-sprays').appendChild(el);
    }
    for (const id of Object.keys(g.EMOTES)) {
      const el = document.createElement('button'); el.className = 'btn small emo'; el.dataset.id = id; el.textContent = g.EMOTES[id].name;
      el.addEventListener('click', () => { g.setSetting('emote', id); g.sfx.ui(); g.previewEmote(id); this._lockerSel(); });
      $('lk-emotes').appendChild(el);
    }
    this._lockerSel();
  }
  _lockerSel() {
    const st = this.g.settings;
    document.querySelectorAll('.swatch').forEach((el) => el.classList.toggle('sel', st[el.dataset.kind] === el.dataset.id));
    document.querySelectorAll('.spray').forEach((el) => el.classList.toggle('sel', st.spray === el.dataset.id));
    document.querySelectorAll('.emo').forEach((el) => el.classList.toggle('on', st.emote === el.dataset.id));
  }

  // ───────── 地圖清單（內建 + 自製）─────────
  mapOpts() { return [...MAP_IDS.map((id) => [id, MAPS[id].name]), ...customIds().map((id) => [id, '自製：' + MAPS[id].name])]; }
  refreshMaps() {
    const g = this.g, all = this.mapOpts();
    const cur = $('set-map').value || 'random';
    $('set-map').innerHTML = opts([['random', '隨機一張（整場固定）'], ['rotate', '每局輪流換圖'], ...all], cur);
    const pm = MAPS[g.settings.pmap] ? g.settings.pmap : 'random';
    $('sel-pmap').innerHTML = opts([['random', '地圖：隨機'], ...all], pm);
    $('ed-src').innerHTML = opts([['', '空地'], ...all], '');
  }

  // ───────── 地圖編輯器的面板 ─────────
  _buildEditor() {
    $('ed-env').innerHTML = opts(ENV_IDS.map((id) => [id, ENVS[id].name]), 'golden');
    $('ed-sym').innerHTML = opts(SYM, 'rot');
    $('ed-palette').innerHTML = PALETTE.map((t, i) => `<div class="pal" data-t="${t}" title="${esc(BLOCK[t].name)}"><i style="background:${css(BLOCK[t].tint || BLOCK[t].color)}"></i><span>${i < 9 ? i + 1 + ' ' : ''}${esc(BLOCK[t].name)}</span></div>`).join('');
  }
  editorState() {
    const ed = this.g.editor;
    document.querySelectorAll('.pal').forEach((el) => el.classList.toggle('sel', +el.dataset.t === ed.type));
    if (document.activeElement !== $('ed-name')) $('ed-name').value = ed.name;
    $('ed-env').value = ed.env; $('ed-sym').value = ed.sym;
    const sp = ed.spawns.filter(Boolean).length, bad = ed.problem();
    $('ed-status').innerHTML = `筆刷 ${ed.brush}×${ed.brush}×${ed.brush}　出生點 ${sp}/2　補給品 ${ed.pickups.length}/12${ed.boxA ? '　<b>拉框中：再按一次 B 完成</b>' : ''}${bad ? `<br><span class="warn">${esc(bad)}</span>` : ''}`;
    $('ed-hot').textContent = `${ed.blockName()}　·　筆刷 ${ed.brush}　·　${SYM.find((s) => s[0] === ed.sym)[1]}`;
    $('ed-del').classList.toggle('hidden', !ed.editId);
  }
  editorLock(locked) { $('scr-editor').classList.toggle('locked', locked); }

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
    $('sel-pmap').addEventListener('change', (e) => g.setSetting('pmap', e.target.value));
    $('chk-prog').checked = !!g.settings.prog;
    $('chk-prog').addEventListener('change', (e) => g.setSetting('prog', e.target.checked));
    $('btn-reroll').addEventListener('click', () => g.reroll());
    $('btn-locker').addEventListener('click', () => { g.sfx.ui(); g.openLocker(); });
    $('btn-locker-back').addEventListener('click', () => { g.sfx.ui(); g.closeLocker(); });
    $('btn-stats').addEventListener('click', () => { g.sfx.ui(); this.show('stats'); this.renderStats(); });
    $('btn-stats-back').addEventListener('click', () => { g.sfx.ui(); this.show('menu'); });
    $('btn-stats-reset').addEventListener('click', () => { g.stats.reset(this.statMode); this.renderStats(); });
    document.querySelectorAll('.stats .tab').forEach((el) => el.addEventListener('click', () => { this.statMode = el.dataset.mode; this.renderStats(); }));
    $('btn-editor').addEventListener('click', () => g.openEditor(null, { ground: 'asphalt' }));
    $('btn-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(g.inviteLink()); this.toast('邀請連結已複製，貼給朋友吧'); }
      catch { this.toast('複製失敗，請手動告訴朋友房號'); }
    });
    for (const [id, key] of [['set-target', 'target'], ['set-time', 'roundTime'], ['set-buff', 'buffMode'], ['set-map', 'map'], ['set-mode', 'mode']]) {
      $(id).addEventListener('change', (e) => g.changeSettings({ [key]: e.target.value }));
    }
    // 機器人模式的選項（大廳和「自己玩」的設定畫面共用同一份清單）
    const HZ_OPTS = {
      n: [4, 8, 12, 16].map((v) => [String(v), v + ' 個']), beh: Object.entries(HZ_BEH), lv: Object.entries(HZ_LEVELS).map(([k, v]) => [k, v.name]),
      time: [['120', '2 分鐘'], ['300', '5 分鐘'], ['600', '10 分鐘'], ['0', '不限時間']],
    };
    this.HZ_OPTS = HZ_OPTS;
    for (const [id, key] of [['set-hzn', 'n'], ['set-hzbeh', 'beh'], ['set-hzlv', 'lv'], ['set-hzt', 'time']]) {
      $(id).innerHTML = opts(HZ_OPTS[key], '');
      $(id).addEventListener('change', (e) => g.changeSettings({ hz: { [key]: key === 'beh' || key === 'lv' ? e.target.value : +e.target.value } }));
    }
    for (const [id, key] of [['hz-n', 'n'], ['hz-beh', 'beh'], ['hz-lv', 'lv'], ['hz-time', 'time']]) $(id).innerHTML = opts(HZ_OPTS[key], '');
    const saveHz = () => {
      const lv = $('hz-lv').value;
      g.setSetting('hzdm', { n: +$('hz-n').value, beh: $('hz-beh').value, atk: $('hz-atk').value === '1', lv: this.hzKind === 'dm' ? lv : g.settings.hzdm.lv, time: +$('hz-time').value });
      if (this.hzKind === 'defense') g.setSetting('hzlv', lv);
      g.setSetting('hzmap', $('hz-map').value);
      this._hzBest();
    };
    for (const id of ['hz-n', 'hz-beh', 'hz-atk', 'hz-lv', 'hz-time', 'hz-map']) $(id).addEventListener('change', saveHz);
    $('btn-dm').addEventListener('click', () => { g.sfx.ui(); this.openHz('dm'); });
    $('btn-def').addEventListener('click', () => { g.sfx.ui(); this.openHz('defense'); });
    $('btn-hz-back').addEventListener('click', () => { g.sfx.ui(); this.show('menu'); });
    $('btn-hz-go').addEventListener('click', () => g.practiceHorde(this.hzKind));
    $('btn-start').addEventListener('click', () => g.startMatch());
    $('btn-warm').addEventListener('click', () => g.startWarmup());
    $('btn-rematch').addEventListener('click', () => g.startMatch());
    for (const id of ['btn-leave', 'btn-end-leave', 'btn-quit']) $(id).addEventListener('click', (e) => { e.stopPropagation(); g.leave(); });
    $('btn-endwarm').addEventListener('click', (e) => { e.stopPropagation(); g.endWarmup(); });
    $('btn-ready').addEventListener('click', () => g.toggleReady());
    $('btn-settings').addEventListener('click', () => { g.sfx.ui(); this.openSettings(); });
    $('btn-gear').addEventListener('click', () => { g.sfx.ui(); this.openSettings(); });
    $('btn-reset-binds').addEventListener('click', (e) => { e.stopPropagation(); this.capture = null; g.resetBinds(); });
    $('pause').addEventListener('click', (e) => {
      const kb = e.target.closest('.kb');
      if (kb) { this.capture = this.capture === kb.dataset.a ? null : kb.dataset.a; this.renderBinds(); return; }
      if (this.capture) { this.capture = null; this.renderBinds(); }
      const done = e.target.id === 'btn-resume' || e.target.id === 'pause';
      if (this.setMode === 'pause') { if (done || !e.target.closest('input, button, label, select, .xhbox')) g.requestLock(); }
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
    this._ranges = [['rng-sens', 'sens', 'out-sens', (v) => v.toFixed(2)], ['rng-fov', 'fov', 'out-fov', (v) => String(v)], ['rng-vol', 'vol', 'out-vol', (v) => Math.round(v * 100) + '%'], ['rng-vvol', 'voiceVol', 'out-vvol', (v) => Math.round(v * 100) + '%']];
    for (const [id, key, out, fmt] of this._ranges) $(id).addEventListener('input', (e) => { const v = +e.target.value; $(out).textContent = fmt(v); g.setSetting(key, v); });
    for (const [id, key] of [['chk-wheel', 'wheel'], ['chk-minimap', 'minimap'], ['chk-fps', 'fps']]) $(id).addEventListener('change', (e) => { g.setSetting(key, e.target.checked); if (key === 'minimap') this._miniVis(); });
    $('sel-quality').addEventListener('change', (e) => { g.setSetting('quality', e.target.value); this.icons = null; this.syncSettings(); });
    $('sel-voice').addEventListener('change', (e) => g.setSetting('voice', e.target.value));
    // 準星
    const xset = (k, v) => g.setSetting('xh', { ...g.settings.xh, [k]: v });
    for (const [id, k, num] of [['xh-style', 'style', 0], ['xh-color', 'color', 0], ['xh-len', 'len', 1], ['xh-thick', 'thick', 1], ['xh-gap', 'gap', 1], ['xh-alpha', 'alpha', 1]]) {
      $(id).addEventListener('input', (e) => { xset(k, num ? +e.target.value : e.target.value); this.syncSettings(); });
    }
    for (const [id, k] of [['xh-dot', 'dot'], ['xh-outline', 'outline'], ['xh-dyn', 'dyn']]) $(id).addEventListener('change', (e) => xset(k, e.target.checked));
    $('xh-reset').addEventListener('click', (e) => { e.stopPropagation(); g.setSetting('xh', { ...g.DEFAULT_XHAIR }); this.syncSettings(); });
    this.syncSettings(); this._miniVis();

    // 編輯器面板
    const ed = g.editor;
    $('ed-name').addEventListener('input', (e) => { ed.name = e.target.value.trim().slice(0, 20); });
    $('ed-env').addEventListener('change', (e) => { ed.env = e.target.value; g.applyEnvDef(ed.env, ed.G * 0.5); });
    $('ed-sym').addEventListener('change', (e) => { ed.sym = e.target.value; this.editorState(); });
    $('ed-palette').addEventListener('click', (e) => { const p = e.target.closest('.pal'); if (p) { ed.type = +p.dataset.t; this.editorState(); } });
    $('ed-save').addEventListener('click', () => g.editorSave(false));
    $('ed-test').addEventListener('click', () => g.editorSave(true));
    $('ed-copy').addEventListener('click', async () => {
      const r = await g.editorSave(false); if (!r) return;
      try { await navigator.clipboard.writeText(r.code); this.toast(`分享代碼已複製（${r.code.length} 個字），貼給朋友，對方在編輯器裡「匯入代碼」`); }
      catch { $('ed-code').value = r.code; this.toast('沒辦法自動複製，代碼放在下面的框裡了'); }
    });
    $('ed-new').addEventListener('click', () => { g.editor.open($('ed-src').value || null, { ground: $('ed-ground').value }); this.editorState(); });
    $('ed-del').addEventListener('click', () => { if (ed.editId) { deleteMap(ed.editId); ed.editId = null; this.refreshMaps(); this.editorState(); this.toast('已刪除（畫面上的還在，可以再存一次）'); } });
    $('ed-import').addEventListener('click', async () => {
      try { const id = await ed.importCode($('ed-code').value); this.refreshMaps(); ed.open(id); this.editorState(); $('ed-code').value = ''; this.toast('匯入成功：' + MAPS[id].name); }
      catch (e) { this.toast('匯入失敗：' + (e.message || '代碼不正確')); }
    });
    $('ed-exit').addEventListener('click', () => g.closeEditor());
  }
  _miniVis() { $('minimap').classList.toggle('hidden', !this.g.settings.minimap); }

  show(name) {
    for (const s of SCREENS) $('scr-' + s).classList.toggle('hidden', s !== name);
    this.screen = name;
    $('btn-gear').classList.toggle('hidden', !name || name === 'editor');   // 對局外隨時可以開設定；對戰中用 Esc
    if (!name && this.setMode === 'menu') this._settings(null);
    if (name === 'loadout') this._icons();
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
  menuBusy(b) { for (const id of ['btn-host', 'btn-join', 'btn-bot', 'btn-dm', 'btn-def', 'btn-locker', 'btn-editor', 'btn-stats']) $(id).disabled = b; }

  // ───────── 機器人模式（自己玩）的設定畫面 ─────────
  openHz(kind) {
    const g = this.g, st = g.settings, dm = kind === 'dm';
    this.hzKind = kind;
    $('hz-title').textContent = dm ? '死鬥練習' : '守據點';
    $('hz-desc').textContent = dm
      ? '一大群機器人，打倒了會再補。你無限重生，隨時按商店鍵換槍。可以讓它們站著當靶子、左右閃，或是滿地圖找你。'
      : '守住地圖中間的據點。機器人一波一波從地圖邊緣殺過來，每 5 波來一隻巨人。每一波之間可以選強化卡、換裝備、蓋沙包牆。據點被打爆就結束。';
    document.querySelectorAll('#scr-hz .dmopt').forEach((el) => el.classList.toggle('hidden', !dm));
    $('hz-n').value = String(st.hzdm.n); $('hz-beh').value = st.hzdm.beh; $('hz-atk').value = st.hzdm.atk ? '1' : '0'; $('hz-time').value = String(st.hzdm.time);
    $('hz-lv').value = dm ? st.hzdm.lv : st.hzlv;
    $('hz-map').innerHTML = opts([['random', '隨機'], ...this.mapOpts()], MAPS[st.hzmap] ? st.hzmap : 'random');
    this._hzBest();
    this.show('hz');
  }
  _hzBest() {
    const best = store.get('hzbest', null) || {}, dm = this.hzKind === 'dm';
    const v = dm ? best[`dm:${$('hz-time').value}:${$('hz-n').value}`] : best[`def:${$('hz-lv').value}`];
    $('hz-best').textContent = v ? (dm ? `這個設定的最佳紀錄：擊倒 ${v} 個` : `這個難度的最佳紀錄：撐過 ${v} 波`) : '';
  }
  // 守據點：下一波從哪幾個方向來（以據點為中心，小地圖上方 = 北）
  gateText(hz) {
    if (!hz || !hz.cp || !hz.gates || !hz.gates.length) return '';
    const names = ['東', '東南', '南', '西南', '西', '西北', '北', '東北'], out = [];
    for (const q of hz.gates) {
      const a = Math.atan2(q[1] - hz.cp[2], q[0] - hz.cp[0]), n = names[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
      if (!out.includes(n)) out.push(n);
    }
    return out.join('、');
  }
  setCode(c) { $('in-code').value = c; }

  toast(text, ms = 2600) {
    const t = $('toast'); t.textContent = text; t.classList.add('show');
    clearTimeout(this.toastT); this.toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  banner(big, sub = '', ms = 1600) {
    const b = $('banner');
    b.querySelector('.big').textContent = big; b.querySelector('.sub').textContent = sub;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');      // 每次都重播進場動畫
    clearTimeout(this.bannerT);
    if (ms > 0) this.bannerT = setTimeout(() => b.classList.remove('show'), ms);
  }
  clearBanner() { clearTimeout(this.bannerT); $('banner').classList.remove('show'); }

  hitmarker(head) {
    const h = $('hitmarker');
    h.classList.remove('show'); h.classList.toggle('head', !!head);
    void h.offsetWidth; h.classList.add('show');
  }

  // 受傷：畫面邊緣閃一下紅
  hurt() {
    const v = $('vignette'); v.style.opacity = '0.55';
    clearTimeout(this.hurtT);
    this.hurtT = setTimeout(() => { v.style.opacity = '0'; }, 280);
  }
  // 受傷方向：準星外圍一段紅色弧線指向打你的人。angle = 相對於準星的方向（弧度，0 = 正前方、順時針為正）；alpha 0 = 收起來
  hurtDir(angle, alpha) {
    const a = alpha > 0.01 ? alpha.toFixed(2) : '0';
    if (this.cache.hurtA === a && a === '0') return;
    this.cache.hurtA = a;
    const arc = $('hurt-arc'); arc.style.opacity = a;
    if (a !== '0') arc.style.transform = `rotate(${angle.toFixed(3)}rad)`;
  }

  feed(text) {
    const d = document.createElement('div'); d.textContent = text;
    $('feed').appendChild(d);
    setTimeout(() => d.remove(), 5200);
  }
  // 擊倒訊息：誰 [用什麼] 擊倒誰，附帶爆頭／穿牆／背刺的小圖示
  killfeed(k) {
    const d = document.createElement('div'); d.className = 'kf' + (k.mine ? ' mine' : ' theirs');
    const ic = this.icons && this.icons[k.w], wn = itemName(k.w) || cardName(k.w);
    d.innerHTML = (k.killer ? `<b>${esc(k.killer)}</b>` : '') + (ic ? `<img src="${ic}" alt="">` : `<span class="w">${esc(wn || '自爆')}</span>`)
      + (k.bk ? `<i title="背刺">${ICON.back}</i>` : '') + (k.wb ? `<i title="穿牆">${ICON.wall}</i>` : '') + (k.head ? `<i class="hs" title="爆頭">${ICON.head}</i>` : '') + `<b>${esc(k.victim)}</b>`;
    $('feed').appendChild(d);
    setTimeout(() => d.remove(), 6200);
  }

  // 傷害報告（一局結束時）。d = { me, opp }（主機狀態裡的兩位玩家）；null = 收起來
  report(d) {
    const el = $('report');
    el.classList.toggle('hidden', !d);
    if (!d) return;
    const row = (a, b, who, cls) => `<div class="rp ${cls}"><span>${who}</span><b>${a.rh} 發命中</b><b>${a.rdm} 傷害</b><span>${a.rhs ? '爆頭 ' + a.rhs : ''}</span></div>`;
    el.innerHTML = `<h4>傷害報告</h4>${row(d.me, d.opp, `你 → ${esc(d.opp.n)}`, 'out')}${row(d.opp, d.me, `${esc(d.opp.n)} → 你`, 'in')}`
      + `<div class="rp left">${d.opp.al ? `${esc(d.opp.n)} 還剩 <b>${d.opp.hp}</b> 血${d.opp.ar ? `、<b>${d.opp.ar}</b> 護甲` : ''}` : d.me.al ? `你還剩 <b>${d.me.hp}</b> 血` : ''}</div>`;
  }

  killcam(on, name = '') { $('killcam').classList.toggle('hidden', !on); $('hud').classList.toggle('kc', on); if (on) { $('kc-name').textContent = name + ' 的視角'; this.kcLen = 0; } }
  killcamTime(left) { this.kcLen = Math.max(this.kcLen || 0, left); $('kc-bar').style.width = Math.round((1 - left / (this.kcLen || 1)) * 100) + '%'; }

  // 語音狀態：自己有沒有在送、對方有沒有在講
  voiceState(v) {
    const g = this.g, st = g.settings.voice;
    const tx = $('v-tx'), rx = $('v-rx');
    tx.classList.toggle('hidden', !(v && v.tx)); rx.classList.toggle('hidden', !(v && v.rx));
    if (v && v.tx) tx.innerHTML = ICON.mic + '<span>說話中</span>';
    if (v && v.rx) rx.innerHTML = ICON.spk + `<span>${esc(g.gs ? g.gs.p[1 - g.me].n : '對手')}</span>`;
    $('out-voice').textContent = st === 'off' ? '' : !v || !v.available() ? '（連線對戰時才會啟用）' : v.stream ? (st === 'ptt' ? `（按住 ${this.key('talk')} 說話）` : '（麥克風開著）') : '（等待麥克風權限…）';
  }

  // ───────── 戰績頁 ─────────
  renderStats() {
    const s = this.g.stats.d[this.statMode], pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
    document.querySelectorAll('.stats .tab').forEach((el) => el.classList.toggle('on', el.dataset.mode === this.statMode));
    const tiles = [
      ['比賽', s.matches, `${s.wins} 勝 ${s.matches - s.wins} 敗`], ['比賽勝率', pct(s.wins, s.matches), ''], ['局數勝率', pct(s.rwins, s.rounds), `${s.rwins} / ${s.rounds} 局`],
      ['擊倒 / 陣亡', s.deaths ? (s.kills / s.deaths).toFixed(2) : s.kills ? s.kills.toFixed(2) : '—', `${s.kills} / ${s.deaths}`], ['爆頭率', pct(s.hs, s.kills), `${s.hs} 次爆頭擊倒`], ['命中率', pct(s.hits, s.shots), `${s.hits} / ${s.shots} 發`],
      ['每局平均傷害', s.rounds ? Math.round(s.dmg / s.rounds) : '—', ''], ['穿牆擊倒', s.wb, ''], ['刀殺', s.knife, ''],
    ];
    $('st-tiles').innerHTML = tiles.map(([t, v, sub]) => `<div class="tile"><span>${t}</span><b>${v}</b><i>${sub}</i></div>`).join('');
    const ws = Object.entries(s.w).sort((a, b) => b[1] - a[1]).slice(0, 5), top = ws.length ? ws[0][1] : 1;
    $('st-weapons').innerHTML = ws.length ? ws.map(([id, n]) => `<div class="wbar"><span>${esc(itemName(id) || cardName(id) || id)}</span><div class="b"><i style="width:${Math.round((n / top) * 100)}%"></i></div><b>${n}</b></div>`).join('') : '<div class="hint">還沒有紀錄</div>';
    $('st-recent').innerHTML = s.recent.length ? s.recent.map((m) => `<div class="rec ${m.win ? 'win' : 'lose'}"><b>${m.win ? '勝' : '敗'}</b><span>${m.my} : ${m.their}</span><span>${esc(m.opp)}</span><i>${esc(m.map || '')}　${new Date(m.t).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })}</i></div>`).join('') : '<div class="hint">還沒有打完的比賽</div>';
  }

  // ───────── 依主機狀態更新靜態畫面 ─────────
  onState(gs) {
    const g = this.g, me = g.me, opp = 1 - me, P = gs.p, warm = gs.phase === 'warmup', hz = gs.phase === 'horde' ? gs.hz : null;
    document.documentElement.style.setProperty('--me', TEAM_CSS[me]);
    document.documentElement.style.setProperty('--opp', TEAM_CSS[opp]);
    // 機器人模式：記分板顯示各打倒幾隻；只有自己一個人時，右邊顯示場上還有幾個機器人
    const solo = hz && !gs.here[opp], bots = hz ? (hz.kind === 'defense' ? Math.max(0, hz.left) : g.horde.views.size ? [...g.horde.views.values()].filter((o) => o.alive).length : 0) : 0;
    this._set('nm-me', P[me].n); this._set('nm-opp', solo ? '機器人' : P[opp].n);
    this._set('sc-me', hz ? String(hz.k[me]) : warm ? '–' : String(P[me].sc)); this._set('sc-opp', hz ? String(solo ? bots : hz.k[opp]) : warm ? '–' : String(P[opp].sc));
    this._set('roundno', hz ? `${hz.kind === 'dm' ? '死鬥' : '守據點 · ' + HZ_LEVELS[hz.cfg.lv].name} · ${MAPS[gs.map].name}` : warm ? `熱身 · ${MAPS[gs.map].name}` : `第 ${gs.round} 局 · 搶 ${gs.set.target} · ${MAPS[gs.map].name}`);
    this._cls('hzinfo', 'hidden', !hz);

    // 對戰中：對手帶了哪些異能（記分板下面一排小圖示）
    const rg = gs.set.mode === 'rogue' && !warm, ob = rg ? [...(P[opp].sk || []).filter(Boolean), ...P[opp].bf].join(',') : '';
    if (this.cache.oppBuild !== ob) {
      this.cache.oppBuild = ob;
      $('oppbuild').innerHTML = ob ? '<span>對手</span>' + ob.split(',').map((id) => (CARDS[id] ? `<div class="glyph r-${CARDS[id].r}${CARDS[id].k === 'a' ? ' act' : ''}" title="${esc(CARDS[id].name)}">${CARDS[id].glyph}</div>` : '')).join('') : '';
    }
    if (gs.phase === 'lobby') {
      this._set('lb-code', g.code || '-----');
      this._set('lb-p0', P[0].n); this._set('lb-p1', gs.here[1] ? P[1].n : '等待對手加入…');
      $('lb-p1').parentElement.classList.toggle('empty', !gs.here[1]);
      this._set('lb-hint', g.net.isHost
        ? (gs.here[1] ? '對手已連線，調好規則就可以開始。'
          : g.net.mode === 'peer' && ['localhost', '127.0.0.1'].includes(location.hostname)
            ? '注意：現在是本機網址（localhost），朋友的電腦打不開這個連結。要先把遊戲放上網路，再從那個網址建立房間。'
            : '按「複製邀請連結」傳給朋友，對方打開連結、按加入就會進來。等的時候可以先按「熱身」跟機器人打，朋友一進來會自動回到這裡。')
        : '已連線，等房主按開始。');
      for (const [id, key] of [['set-target', 'target'], ['set-time', 'roundTime'], ['set-buff', 'buffMode'], ['set-map', 'map'], ['set-mode', 'mode']]) {
        const el = $(id); el.disabled = !g.net.isHost;
        if (document.activeElement !== el) el.value = String(gs.set[key]);
      }
      for (const [id, key] of [['set-hzn', 'n'], ['set-hzbeh', 'beh'], ['set-hzlv', 'lv'], ['set-hzt', 'time']]) {
        const el = $(id); el.disabled = !g.net.isHost;
        if (document.activeElement !== el && gs.set.hz) el.value = String(gs.set.hz[key]);
      }
      const hm = gs.set.mode === 'dm' || gs.set.mode === 'defense';
      document.querySelectorAll('#scr-lobby .duelopt').forEach((el) => el.classList.toggle('hidden', hm));
      document.querySelectorAll('#scr-lobby .hzopt').forEach((el) => el.classList.toggle('hidden', !hm || (el.classList.contains('dmopt') && gs.set.mode !== 'dm')));
      $('set-buff').parentElement.classList.toggle('hidden', gs.set.mode !== 'classic');   // Roguelike 的輸家補償是「多一張卡可以選」；機器人模式沒有輸家
      $('btn-start').classList.toggle('hidden', !g.net.isHost);
      $('btn-start').disabled = !gs.here[1] && !hm;              // 機器人模式可以先自己開打
      this._set('btn-start', hm ? (gs.here[1] ? '開始' : '先自己開打（朋友晚點進來會直接加入）') : '開始對戰');
      $('btn-warm').classList.toggle('hidden', !g.net.isHost);
      this._set('btn-warm', gs.here[1] ? '一起熱身' : '熱身（跟機器人）');
      $('btn-copy').classList.toggle('hidden', !g.net.isHost);
    } else if (gs.phase === 'loadout' || ((warm || hz) && g.buyOpen)) this._loadout(gs, warm || !!hz);
    else if (gs.phase === 'matchEnd') this._end(gs);
  }

  _loadout(gs, warm) {
    const g = this.g, me = gs.p[g.me], opp = gs.p[1 - g.me];
    const r1 = !warm && gs.round <= 1, sel = g.shopSel(), money = warm ? 99999 : me.$, cost = warm ? 0 : loadoutCost(sel);
    const hz = gs.phase === 'horde' ? gs.hz : null, tier = g.hzTier();
    this._cls('scr-loadout', 'warm', !!warm);
    this._set('lo-title', hz ? (hz.kind === 'defense' ? `守據點 — 第 ${hz.wave + (hz.st === 'break' ? 1 : 0)} 波之前　全部免費（好槍撐到後面幾波才開放）` : '死鬥練習 — 全部免費，隨便拿') : warm ? '熱身 — 全部免費，隨便拿' : r1 ? '第 1 局 — 手槍局（只能買副武器和裝備）' : `第 ${gs.round} 局 — 購買裝備`);
    this._set('lo-map', `地圖：${MAPS[gs.map].name}　${MAPS[gs.map].desc}`);
    const mk = warm ? 'warm' : `${money}:${cost}`;
    if (this.cache.loMoney !== mk) { this.cache.loMoney = mk; $('lo-money').innerHTML = warm ? '' : `<b>$${money}</b><span>本局花費 $${cost}　剩下 $${money - cost}</span>`; }
    const sk = warm ? 'warm' : `${me.sc}:${opp.sc}:${gs.set.target}`;
    if (this.cache.loScore !== sk) {
      this.cache.loScore = sk;
      $('lo-score').innerHTML = warm ? '每個人都有一把刀，不用買' : `<b class="me">${esc(me.n)} ${me.sc}</b> ： <b class="opp">${opp.sc} ${esc(opp.n)}</b>　·　先拿 ${gs.set.target} 分獲勝`;
    }
    if (warm) this._set('lo-timer', '');
    document.querySelectorAll('.wcard').forEach((el) => {
      const d = WEAPONS[el.dataset.id], isP = d.slot === 'p', on = isP ? sel.p === el.dataset.id : sel.s === el.dataset.id;
      const rest = cost - (isP ? (sel.p ? WEAPONS[sel.p].price : 0) : WEAPONS[sel.s].price);   // 這一格以外已經花掉的
      const lockW = isP && (HZ_TIER[el.dataset.id] || 1) > tier;
      el.classList.toggle('sel', on); el.classList.toggle('locked', isP && (r1 || lockW)); el.classList.toggle('poor', !warm && !on && rest + d.price > money);
      const pr = el.querySelector('.price'), pt = hz ? (lockW ? `第 ${HZ_TIER[el.dataset.id]} 波開放` : '免費') : d.price ? '$' + d.price : '免費';
      if (pr.textContent !== pt) pr.textContent = pt;
    });
    document.querySelectorAll('.gcard').forEach((el) => {
      const d = GEAR[el.dataset.id], n = sel[el.dataset.id] || 0;
      el.classList.toggle('sel', n > 0); el.classList.toggle('poor', !warm && n === 0 && cost + d.price > money);
      el.querySelector('.cnt').textContent = n ? '×' + n : '';
    });

    const rogue = !warm && gs.set.mode === 'rogue', mySk = me.sk || [null, null];
    const key = (!warm || hz) && me.ch ? me.ch.join(',') + '|' + mySk.join(',') + '|' + rogue : '';
    if (key !== this.buffKey) {
      this.buffKey = key;
      const box = $('lo-buff-cards'); box.innerHTML = '';
      $('lo-buff').classList.toggle('hidden', !key);
      (key ? me.ch : []).forEach((id, i) => {
        const c = CARDS[id]; if (!c) return;
        const el = document.createElement('div'), act = c.k === 'a', full = act && !mySk.includes(null);
        el.className = `buffcard card r-${c.r}${act ? ' act' : ''}`; el.dataset.id = id; el.style.setProperty('--i', i);
        el.innerHTML = `<div class="rar">${RARITY[c.r].name}・${act ? '主動技能' : '被動'}</div><div class="glyph">${c.glyph}</div><div class="t">${esc(c.name)}</div><div class="d">${esc(c.desc)}</div>`
          + (act ? `<div class="meta">${c.uses ? `每局 ${c.uses} 次` : `冷卻 ${c.cd} 秒`}${c.lock ? `・開打 ${c.lock} 秒後才能用` : ''}</div>` : '')
          + (full ? `<div class="rep"><span>技能格滿了，要換掉哪一個？</span>${[0, 1].map((n) => `<button class="btn small" data-slot="${n}">${esc(this.key(n ? 'skill2' : 'skill1'))}　${esc(CARDS[mySk[n]].name)}</button>`).join('')}</div>` : '');
        el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-slot]');
          if (b) g.pickBuff(id, +b.dataset.slot);
          else if (full) { box.querySelectorAll('.card.ask').forEach((o) => o !== el && o.classList.remove('ask')); el.classList.toggle('ask'); }
          else g.pickBuff(id);
        });
        box.appendChild(el);
      });
    }
    if (key) {
      this._set('lo-buff-title', hz ? `第 ${hz.cleared} 波擋下來了 — 選一張強化卡` : rogue ? `第 ${gs.round} 局 — 選一張異能卡` : '上一局落敗補償 — 選一個強化');
      this._set('lo-buff-sub', hz ? '下一波開始前沒選，會自動拿第一張' : !rogue ? '' : me.lu ? '上一局落敗：多一張可以選，手氣也比較好。你選好之前看不到對手拿了什麼' : '你選好之前看不到對手這一局拿了什麼');
      const left = ROGUE.REROLLS - (me.rr || 0), rb = $('btn-reroll');
      rb.classList.toggle('hidden', !rogue);
      rb.disabled = left <= 0 || money - cost < ROGUE.REROLL;
      this._set('btn-reroll', left > 0 ? `重抽 $${ROGUE.REROLL}（剩 ${left} 次）` : '重抽用完了');
    }
    // 雙方目前的異能（Roguelike）。對手這一局新拿的那張，要等我也選好才公開
    $('lo-builds').classList.toggle('hidden', !rogue);
    if (rogue) {
      const all = (p) => [...(p.sk || []).filter(Boolean), ...p.bf];
      if (this.draftRound !== gs.round) { this.draftRound = gs.round; this.oppBase = all(opp); }
      const hidden = !!me.ch, shown = hidden ? this.oppBase : all(opp), bk2 = all(me).join(',') + '/' + shown.join(',') + '/' + hidden + '/' + !!opp.ch;
      if (this.cache.builds !== bk2) {
        this.cache.builds = bk2;
        const chip = (id, p, fresh) => {
          const c = CARDS[id]; if (!c) return '';
          const si = c.k === 'a' && p === me ? (p.sk || []).indexOf(id) : -1;
          return `<span class="chip r-${c.r}${c.k === 'a' ? ' act' : ''}${fresh ? ' new' : ''}" title="${esc(c.desc)}"><span class="glyph">${c.glyph}</span>${si >= 0 ? `<kbd>${esc(this.key(si ? 'skill2' : 'skill1'))}</kbd>` : ''}${esc(c.name)}</span>`;
        };
        $('lo-build-me').innerHTML = `<b>你的異能</b>` + (all(me).map((id) => chip(id, me)).join('') || '<i>還沒有</i>');
        $('lo-build-opp').innerHTML = `<b>${esc(opp.n)}</b>` + (shown.map((id) => chip(id, opp, !hidden && !this.oppBase.includes(id))).join('') || '<i>還沒有</i>')
          + (hidden ? `<i>${opp.ch ? '（還在選）' : '（已選好，等你選完才公開）'}</i>` : '');
      }
    }
    const bk = (warm && !hz) || rogue ? '' : me.bf.join(',');
    if (this.cache.myBuffs !== bk) {
      this.cache.myBuffs = bk;
      $('lo-mybuffs').innerHTML = bk
        ? '本局強化：' + me.bf.map((id) => `<span class="chip"><span class="glyph">${CARDS[id].glyph}</span>${esc(CARDS[id].name)}</span>`).join('')
        : '';
    }
    const os = warm ? '' : opp.ch ? `${opp.n} 正在挑${rogue ? '異能卡' : '強化'}…` : opp.rd ? `${opp.n} 已準備 ✓` : `${opp.n} 選槍中…`;
    this._set('lo-opp', os); this._cls('lo-opp', 'ok', !warm && !!opp.rd);
    const rb = $('btn-ready');
    rb.disabled = !warm && !!me.ch;
    this._set('btn-ready', warm ? (hz && me.ch ? `先不選，繼續（${this.key('buy')}）` : `拿好了，繼續（${this.key('buy')}）`) : me.ch ? (rogue ? '先選一張異能卡' : '先選一個強化') : me.rd ? '已準備 ✓（再按取消）' : '準備');
    this._cls('btn-ready', 'on', !warm && !!me.rd);
  }

  _end(gs) {
    if (gs.hz) { this._hzEnd(gs); return; }
    const g = this.g, me = gs.p[g.me], opp = gs.p[1 - g.me], win = gs.mw === g.me;
    this._set('btn-rematch', '再來一場');
    const t = $('end-title'); t.textContent = win ? '勝利' : '落敗'; t.className = win ? 'win' : 'lose';
    $('end-score').innerHTML = `<span class="me">${me.sc}</span> ： <span class="opp">${opp.sc}</span>`;
    $('end-stats').innerHTML = `<tr><th></th><th>拿下局數</th><th>總傷害</th><th>爆頭擊殺</th></tr>`
      + [me, opp].map((p) => `<tr><td>${esc(p.n)}</td><td>${p.sc}</td><td>${p.dmg}</td><td>${p.hs}</td></tr>`).join('');
    $('btn-rematch').classList.toggle('hidden', !g.net.isHost);
    $('end-wait').textContent = g.net.isHost ? '' : '等房主決定要不要再來一場…';
  }

  // 機器人模式的結算：擊倒、爆頭、陣亡、撐過幾波、最佳紀錄
  _hzEnd(gs) {
    const g = this.g, hz = gs.hz, res = hz.res || {}, dm = hz.kind === 'dm', me = g.me;
    const t = $('end-title');
    t.textContent = dm ? (res.why === 'time' ? '時間到' : '結束') : res.why === 'core' ? '據點被攻陷' : '結束'; t.className = dm || res.why !== 'core' ? 'win' : 'lose';
    const sec = Math.round((res.t || 0) / 1000), mmss = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    const acc = g.hzAcc && g.hzAcc.shots ? Math.round((g.hzAcc.hits / g.hzAcc.shots) * 100) + '%' : '—';
    $('end-score').innerHTML = dm ? `<span class="me">${hz.k[me]}</span><small>擊倒　${mmss}</small>` : `<span class="me">${res.waves || 0}</span><small>撐過的波數　${mmss}</small>`;
    const rows = [0, 1].filter((i) => i === me || gs.here[i]).map((i) => `<tr><td>${esc(gs.p[i].n)}</td><td>${hz.k[i]}</td><td>${hz.hs[i]}</td><td>${hz.d[i]}</td><td>${gs.p[i].dmg}</td></tr>`).join('');
    $('end-stats').innerHTML = `<tr><th></th><th>擊倒</th><th>爆頭</th><th>陣亡</th><th>傷害</th></tr>${rows}`
      + `<tr class="sub"><td colspan="5">你的命中率 ${acc}${g.hzNew ? '　<b class="newrec">新紀錄！</b>' : g.hzPrev ? `　最佳紀錄 ${g.hzPrev}${dm ? ' 擊倒' : ' 波'}` : ''}</td></tr>`;
    $('btn-rematch').classList.toggle('hidden', !g.net.isHost);
    this._set('btn-rematch', '再來一次');
    $('end-wait').textContent = g.net.isHost ? '' : '等房主決定要不要再來一次…';
  }

  // 機器人模式的抬頭顯示：剩幾隻、據點血量、巨人血量、休息倒數
  _hzFrame(gs, tl) {
    const hz = gs.hz, g = this.g, def = hz.kind === 'defense', s = Math.ceil(tl / 1000);
    let line = '';
    if (!def) line = `擊倒 ${hz.k[g.me]}　爆頭 ${hz.hs[g.me]}　陣亡 ${hz.d[g.me]}`;
    else if (hz.st === 'break') {
      const dirs = this.gateText(hz), me = gs.p[g.me];
      line = `第 ${hz.wave + 1} 波 ${s} 秒後${dirs ? `從${dirs}` : ''}來　${this.key('skill1')} 蓋沙包牆　${this.key('buy')} ${me.ch ? '選強化卡、' : ''}換裝備`;
    } else line = `第 ${hz.wave} 波　剩 ${Math.max(0, hz.left)} 個敵人`;
    this._set('hz-line', line);
    this._cls('hz-core', 'hidden', !def);
    if (def) {
      const f = Math.max(0, Math.min(1, hz.core / hz.coreMax)), k = Math.round(f * 200);
      if (this.cache.coreW !== k) { this.cache.coreW = k; $('hz-corebar').style.width = (f * 100).toFixed(1) + '%'; $('hz-core').classList.toggle('low', f < 0.3); }
      this._set('hz-corenum', String(hz.core));
    }
    this._cls('hz-boss', 'hidden', !(hz.boss > 0));
    if (hz.boss > 0) { const k = Math.round(hz.boss * 200); if (this.cache.bossW !== k) { this.cache.bossW = k; $('hz-bossbar').style.width = (hz.boss * 100).toFixed(1) + '%'; } }
  }

  // ───────── 每一幀更新 ─────────
  frame(d) {
    const tl = Math.max(0, d.tLeft), g = this.g;
    if (d.phase === 'loadout') { this._set('lo-timer', String(Math.ceil(tl / 1000))); return; }
    const s = Math.ceil(tl / 1000);
    const hz = d.phase === 'horde' && g.gs ? g.gs.hz : null;
    const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this._set('timer', hz ? (hz.kind === 'dm' ? (hz.cfg.time ? clock : '∞') : hz.st === 'break' ? clock : `第 ${hz.wave} 波`) : d.phase === 'playing' ? clock : d.phase === 'warmup' ? '熱身' : '--:--');
    this._cls('timer', 'low', (d.phase === 'playing' || (hz && hz.kind === 'dm' && hz.cfg.time)) && s <= 15);
    if (hz) this._hzFrame(g.gs, tl);

    const hp = d.hp, mhp = d.mhp;
    this._set('num-hp', String(hp)); this._set('num-armor', String(d.armor));
    const hw = Math.round((hp / mhp) * 100), aw = Math.round((d.armor / 50) * 100);
    if (this.cache.hw !== hw) { this.cache.hw = hw; $('bar-hp').style.width = hw + '%'; $('bar-hp').closest('.vrow').classList.toggle('low', hp <= 35); }
    if (this.cache.aw !== aw) { this.cache.aw = aw; $('bar-armor').style.width = Math.min(100, aw) + '%'; $('bar-armor').closest('.vrow').classList.toggle('none', d.armor <= 0); }
    const rogue = !!(g.gs && g.gs.set.mode === 'rogue'), bk = d.buffs.join(',') + rogue;
    if (this.cache.hudBuffs !== bk) {
      this.cache.hudBuffs = bk;
      $('buffs').innerHTML = d.buffs.map((id) => (CARDS[id] ? `<div class="glyph${rogue ? ' r-' + CARDS[id].r : ''}" title="${esc(CARDS[id].name)}">${CARDS[id].glyph}</div>` : '')).join('');
    }
    // 技能格：按鍵、冷卻倒數、剩幾次
    const sk = d.sk, ids = sk.slots.map((x) => (x ? x.id : '')).join(',') + '|' + this.key('skill1') + this.key('skill2');
    if (this.cache.skIds !== ids) {
      this.cache.skIds = ids; this.cache.sk0 = this.cache.sk1 = null;
      const nm = (id) => (id === 'wall' && g.phase === 'horde' ? '沙包牆' : CARDS[id].name);   // 守據點的牆是沙包
      $('skills').innerHTML = sk.slots.map((x, i) => (x ? `<div class="sk r-${CARDS[x.id].r}" id="sk${i}" title="${esc(nm(x.id))}"><b>${esc(this.key(i ? 'skill2' : 'skill1'))}</b><span>${CARDS[x.id].glyph}</span><u></u><i></i><em>${esc(nm(x.id))}</em></div>` : '')).join('');
    }
    sk.slots.forEach((x, i) => {
      if (!x) return;
      const out = x.uses === 0, k = `${Math.ceil(x.left * 10)}|${x.uses}|${x.on}`;
      if (this.cache['sk' + i] === k) return;
      this.cache['sk' + i] = k;
      const el = $('sk' + i);
      el.classList.toggle('cd', x.left > 0 || out); el.classList.toggle('on', x.on);
      el.querySelector('u').style.height = out ? '100%' : Math.round(Math.min(1, x.left / x.cd) * 100) + '%';
      el.querySelector('i').textContent = out ? '用完' : x.left > 0 ? (x.left >= 10 ? String(Math.ceil(x.left)) : x.left.toFixed(1)) : x.uses > 0 ? '×' + x.uses : '';
    });
    const stk = sk.status.map((x) => x[0] + x[1]).join('|');
    if (this.cache.status !== stk) { this.cache.status = stk; $('status').innerHTML = sk.status.map(([c, t]) => `<span class="${c}">${esc(t)}</span>`).join(''); }
    const tk = d.alive ? sk.tint : '';
    if (this.cache.tint !== tk) { this.cache.tint = tk; $('tintfx').className = tk; }

    if (d.w) {
      const melee = !!d.w.def.melee;
      this._set('ammo-n', melee ? '—' : String(d.w.ammo));
      this._set('ammo-r', melee ? '' : d.w.reserve === Infinity ? '∞' : String(d.w.reserve));
      this._cls('ammo', 'melee', melee);
      this._cls('ammo-n', 'low', !melee && d.w.ammo <= Math.ceil(d.w.mag * 0.25));
      this._set('wname', d.w.def.name);
      const ic = this.icons || {};
      if (this.cache.wimg !== d.w.id) { this.cache.wimg = d.w.id; const im = $('wimg'); if (ic[d.w.id]) { im.src = ic[d.w.id]; im.classList.remove('hidden'); } else im.classList.add('hidden'); }
      // 三格武器：目前拿的那一格亮起來
      const sk = d.slots.map((w, i) => (w ? `${w.id}:${w.def.melee ? '' : w.ammo}` : '-')).join('|') + '/' + d.slot;
      if (this.cache.slots !== sk) {
        this.cache.slots = sk;
        const keys = ['primary', 'secondary', 'knife'];
        $('slots').innerHTML = d.slots.map((w, i) => (w ? `<div class="slot${i === d.slot ? ' on' : ''}"><b>${esc(this.key(keys[i]))}</b><span>${esc(w.def.name)}</span><i>${w.def.melee ? '' : w.ammo + '/' + (w.reserve === Infinity ? '∞' : w.reserve)}</i></div>` : '')).join('');
      }
      const rb = $('reloadbar');
      if (d.reload > 0) { rb.style.opacity = '1'; rb.firstElementChild.style.width = Math.round(d.reload * 100) + '%'; }
      else if (this.cache.rl !== 0) rb.style.opacity = '0';
      this.cache.rl = d.reload;
    }
    const xh = g.settings.xh, gap = Math.round((xh.dyn ? Math.max(2, d.gap) : 5) + xh.gap);
    if (this.cache.gap !== gap) { this.cache.gap = gap; $('crosshair').style.setProperty('--gap', Math.max(0, gap) + 'px'); }
    this._cls('crosshair', 'off', !d.alive || d.scoped || d.third);
    const so = d.scoped ? '1' : '0';
    if (this.cache.scope !== so) { this.cache.scope = so; $('scope').style.opacity = so; }
    this._set('netinfo', d.net);
    const nk = NADE_IDS.map((k) => d.nades[k]).join(',');
    if (this.cache.nades !== nk) {
      this.cache.nades = nk;
      $('nades').innerHTML = NADE_IDS.filter((k) => d.nades[k] > 0).map((k) => `<span title="${esc(GEAR[k].name)}">${ICON[k]}<b>${esc(this.key(k))}</b>${d.nades[k] > 1 ? `<i>×${d.nades[k]}</i>` : ''}</span>`).join('');
    }
    this._set('money', d.phase === 'warmup' || d.phase === 'horde' ? '' : '$' + d.money);
    this._set('speed-n', d.spd.toFixed(1));
    this._cls('speed', 'fast', d.spd > 7.2); this._cls('speed', 'crouch', !!d.crouch);
  }
}
