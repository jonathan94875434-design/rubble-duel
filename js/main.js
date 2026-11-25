import * as THREE from 'three';
import { BS, NET, TEAM, TEAM_CSS, PLAYER, ROGUE, HORDE, FFA } from './config.js';
import { World, BLOCK, B } from './world.js';
import { Player } from './player.js';
import * as RP from './remote.js';
import { Combat } from './combat.js';
import { FX } from './fx.js';
import { Sfx } from './audio.js';
import { ViewModel } from './viewmodel.js';
import { Net } from './net.js';
import { Authority } from './authority.js';
import { Bot } from './bot.js';
import { validLook, ITEMS, KNIVES } from './skins.js';
import { Crate, REWARD } from './crate.js';
import { Hud } from './hud.js';
import { WEAPONS, GEAR, NADE_IDS, FREE_NADES, validLoadout, loadoutCost, itemName } from './weapons.js';
import { DEFAULT_BINDS, loadBinds } from './binds.js';
import { MAPS, decodeMap, registerCustom, loadSavedMaps } from './maps.js';
import { clamp, lerp, r3, roomCode, store } from './util.js';
import { Environment } from './env.js';
import { Post, QUALITY } from './post.js';
import { buildBlockTextures } from './textures.js';
import { skyLitTree } from './skylit.js';
import { Replay } from './replay.js';
import { Minimap } from './minimap.js';
import { Stats } from './stats.js';
import { SPRAYS, sprayTex } from './sprays.js';
import { Voice } from './voice.js';
import { Editor, PALETTE, SYM } from './editor.js';
import { Skills } from './skills.js';
import { Pets } from './pets.js';
import { CARDS, cardName } from './cards.js';
import { Horde, MOBS, HZ_TIER, HZ_LEVELS } from './horde.js';

const RemotePlayer = RP.RemotePlayer;
// 表情動作的清單（角色模型那邊有定義就用它的）
const EMOTES = RP.EMOTES || { wave: { name: '揮手', dur: 2.4 }, dance: { name: '跳舞', dur: 3 }, salute: { name: '敬禮', dur: 2.2 }, taunt: { name: '嘲諷', dur: 2.6 } };
const DEFAULT_XHAIR = { color: '#ffffff', len: 9, thick: 2, gap: 0, dot: true, outline: true, dyn: true, style: 'cross', alpha: 1 };

const qs = new URLSearchParams(location.search);
const LOCAL = qs.get('local') === '1';    // 同一台電腦兩個分頁測試
const NOLOCK = qs.get('nolock') === '1';  // 自動化測試用：不需要鎖定滑鼠
const DEG = Math.PI / 180;
// 滑鼠靈敏度跟 Apex（還有 CS）同一套數字：滑鼠每動一個單位，轉 0.022° × 靈敏度
const YAW_PER_COUNT = 0.022 * DEG;
// 舊版的靈敏度（每像素 0.0022 弧度 × 值）換成 Apex 的數字，手感不變
const OLD_SENS = 0.0022 / YAW_PER_COUNT;
// FOV 也跟 Apex 同一套數字：設定裡的值是「4:3 畫面的水平視角」（Apex 90 = 16:9 螢幕水平 106°），鏡頭要的是垂直視角
const vfovOf = (afov) => 2 * Math.atan(Math.tan((afov * DEG) / 2) * 0.75) / DEG;
const afovOf = (vfov) => 2 * Math.atan(Math.tan((vfov * DEG) / 2) / 0.75) / DEG;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v2s = new THREE.Vector2(), _c1 = new THREE.Color();
const ROUND_PHASES = ['countdown', 'playing', 'roundEnd', 'warmup', 'horde'];
const WARM_LOADOUT = { p: 'ar', s: 'pistol', armor: 1, he: 1, flash: 1, smoke: 1, molotov: 1 };
// 音效模組還沒有的新聲音先當作沒事（舊版 audio.js 也能跑）
const SFX_OPTIONAL = ['setEnv', 'ambient', 'stopLoops', 'loop', 'impact', 'whiz', 'knifeSwing', 'knifeHit', 'molotov', 'shell', 'spray', 'emote', 'respawn', 'roundStart', 'voiceBlip', 'duck', 'skill', 'card', 'tick'];

class Game {
  constructor() {
    this.EMOTES = EMOTES; this.DEFAULT_XHAIR = DEFAULT_XHAIR; this.QUALITY = QUALITY;
    this.crate = new Crate();   // 補給箱（抽獎）：要比造型先讀，刀和特殊塗裝只能裝已經抽到的
    const look = validLook({ s: store.get('skin'), w: store.get('wskin'), k: store.get('knife'), p: store.get('wsp', null) });
    this.settings = {
      name: store.get('name', ''), vol: store.get('vol', 0.6),
      afov: store.get('afov', null) ?? (store.get('fov', null) === null ? 90 : Math.round(afovOf(store.get('fov')))),   // 視野（Apex 的數字，預設 90 跟 Apex 一樣；舊版存的垂直視角會換算）
      // 靈敏度（Apex 的數字，預設 5 跟 Apex 一樣）、開鏡倍率（1 = 照放大倍數等比縮小，跟 Apex 的 1.0 一樣）、原始輸入（不吃系統的滑鼠加速）
      asens: store.get('asens', null) ?? Math.round(store.get('sens', 5 / OLD_SENS) * OLD_SENS * 100) / 100,
      adsMul: store.get('adsMul', 1), raw: store.get('raw', true),
      wheel: store.get('wheel', true),          // 滾輪切槍（Magic Mouse 容易誤觸，可以關）
      bot: store.get('bot', 'normal'), pmap: store.get('pmap', 'random'),  // 練習模式的難度與地圖
      prog: store.get('prog', false),           // 練習時也用 Roguelike 模式
      // 機器人模式（自己玩）的設定：死鬥的數量／行為／會不會開槍／難度／時間／地圖，守據點的難度／地圖
      hzdm: { n: 8, beh: 'hunt', atk: true, lv: 'normal', time: 300, map: store.get('hzmap', 'random'), ...(store.get('hzdm', null) || {}) },
      hzdef: { lv: store.get('hzlv', 'normal'), map: store.get('hzmap', 'random'), ...(store.get('hzdef', null) || {}) },
      skin: look.s, wskin: look.w,
      knife: this.crate.has('k:' + look.k) ? look.k : 'knife',                                                    // 刀型（補給箱抽到的）
      wsp: Object.fromEntries(Object.entries(look.p).filter(([w, f]) => this.crate.has(w + ':' + f))),   // 特殊塗裝 { 武器: 花紋 }
      quality: store.get('quality', 'auto'),    // 畫質：auto / low / medium / high
      xh: { ...DEFAULT_XHAIR, ...(store.get('xh', null) || {}) },   // 準星
      minimap: store.get('minimap', true), fps: store.get('fps', false),
      voice: store.get('voice', 'off'), voiceVol: store.get('voiceVol', 1),   // 語音：off / ptt（按住說話）/ open（一直開）
      spray: SPRAYS[store.get('spray')] ? store.get('spray') : 'skull', emote: EMOTES[store.get('emote')] ? store.get('emote') : 'wave',
    };
    this.sel = validLoadout(null);   // 這一局在商店選的裝備；每局都從「只有免費手槍」開始，不沿用上一局
    this.wsel = validLoadout(store.get('wsel', WARM_LOADOUT));   // 熱身用的裝備（免費，會記住）
    this.hsel = { ...this.wsel };                                 // 機器人模式的裝備（守據點有些槍要撐到後面幾波才開放）
    this.binds = loadBinds(store.get('binds'));
    this.phase = 'menu'; this.gs = null; this.me = 0; this.round = 0; this.code = '';
    this.authority = null; this.bot = null; this.warmBot = false; this.locked = false; this.phaseEnd = 0;
    this.keys = {}; this.mouse = { l: false, r: false, lp: false, dx: 0, dy: 0 }; this.reloadPressed = false;
    this.shake = 0; this.deathT = 0; this.sendAcc = 0; this.orbit = 0; this.lastCount = -1; this.stepPhase = 0;
    this.pickAt = []; this.pickDefs = []; this.pickMeshes = []; this.pickMap = null;
    this.lastWheel = 0; this.wheelAcc = 0; this.wheelT = 0;
    this.landDip = 0; this.roll = 0; this.rStep = 0; this.lockerOpen = false; this.oppLook = '';
    this.foes = new Map(); this.storm = null; this.stormAt = 0; this.spec = -1;   // 混戰：其他人的角色模型（座位號 → 模型）、毒圈、死後在看誰
    this.buyOpen = false; this.kc = false; this.kcAt = 0; this.kcDeath = 0; this.emote = null; this.sprayAt = 0;
    this.spotAt = 0; this.lit = 1; this.pendingGs = null; this.rs0 = 0; this.rh0 = 0; this.fpsAcc = 0; this.fpsN = 0; this.fpsV = 0; this.miniAt = 0;
    this.fxLight = new THREE.Color(1, 1, 1); this.envDef = null; this.hurtSrc = null; this.miniSndAt = 0;

    this._initRender();
    this.world = new World(this.scene);
    this.fx = new FX(this.scene, this.world);
    this.sfx = new Sfx(); this.sfx.vol = this.settings.vol;
    for (const k of SFX_OPTIONAL) if (typeof this.sfx[k] !== 'function') this.sfx[k] = () => {};
    this.view = new ViewModel();
    this.player = new Player(this.world);
    this.remote = this._mkDoll(TEAM[1]);
    this.ghost = this._mkDoll(TEAM[0]);   // 自己的分身：擊殺回放、表情動作（第三人稱）時才看得到
    this.doll = this._mkDoll(TEAM[0]);    // 造型預覽用的假人，站在地圖上空的小平台
    this.doll.pos.set(24, 15, 24);
    this.pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.14, 28), new THREE.MeshStandardMaterial({ color: 0x23272f, roughness: 0.6, metalness: 0.3 }));
    this.pedestal.position.set(24, 14.93, 24); this.pedestal.visible = false; this.pedestal.receiveShadow = true; this.scene.add(this.pedestal);
    this.combat = new Combat(this);
    this.skills = new Skills(this);
    this.pets = new Pets(this);
    this.horde = new Horde(this);
    this.net = new Net();
    this.replay = new Replay();
    this.stats = new Stats();
    this.editor = new Editor(this);
    this.hud = new Hud(this);
    this.mini = new Minimap(document.getElementById('minimap'), this.world);
    this.voice = new Voice(this.net, () => this.hud.voiceState(this.voice));
    this.voice.setVolume(this.settings.voiceVol);
    this._setPickups(this.world.mapId);
    this._bindInput();
    this._bindNet();
    this.applyQuality(); this._applyEnv();
    addEventListener('resize', () => this._resize());
    addEventListener('pagehide', () => this.net.close()); // 關分頁時通知對手
    loadSavedMaps().then(() => this.hud.refreshMaps());

    const room = (qs.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (room) { this.hud.setCode(room); this.hud.menuMsg('已帶入朋友的房號，輸入名字後按「加入房間」'); }
    this.hud.show('menu');

    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // 角色模型：建好之後讓它的材質也吃到天光（在室內會變暗）。換造型、換槍會產生新材質，所以之後還要再呼叫 _lit()
  _mkDoll(color) { const d = new RemotePlayer(this.scene, color); d._lit = () => skyLitTree(d.group, this.world); d._lit(); return d; }

  // ───────── 畫面 ─────────
  _initRender() {
    const canvas = this.canvas = document.getElementById('game');
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(vfovOf(this.settings.afov), 1, 0.05, 700);
    this.camera.rotation.order = 'YXZ';
    this.env = new Environment(this.scene, r, new THREE.Vector3(24, 0, 24), 24);
    this.post = new Post(r);
    // 依顯示卡猜一個預設畫質（設定裡可以改）
    const gl = r.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = this.gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    this.autoQ = /swiftshader|llvmpipe|software/i.test(gpu) ? 'min' : /rtx|radeon rx|radeon pro|arc\b/i.test(gpu) ? 'high' : /intel/i.test(gpu) ? 'low' : 'medium';
    this.tex = null; this.Q = QUALITY.medium;
  }

  // 套用畫質：解析度、陰影、後製、材質解析度
  applyQuality() {
    const id = QUALITY[this.settings.quality] ? this.settings.quality : this.autoQ, Q = this.Q = QUALITY[id];
    this.qualityId = id;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Q.pr));
    this.env.setShadows(Q.shadow);
    if (!this.tex || this.tex.size !== Q.tex) {
      const old = this.tex;
      this.tex = buildBlockTextures(this.renderer, Q.tex); this.world.setTextures(this.tex);
      if (old) old.dispose();
    }
    this._resize();
  }

  // 換地圖：重建地形，天氣跟著換
  setMap(id) {
    this.world.reset(id);
    this.syncBounds();
    this._applyEnv();
  }
  // 換到不同大小的地圖：陰影範圍、外圍的地跟著換
  syncBounds() {
    if (this.envSize === this.world.sizeRev) return;
    this.envSize = this.world.sizeRev; const w = this.world;
    this.env.setBounds(new THREE.Vector3((w.X * BS) / 2, 0, (w.Z * BS) / 2), (w.X * BS) / 2);
  }
  _applyEnv() { const m = MAPS[this.world.mapId]; if (m) this.applyEnvDef(m.env, m.ground || 0); }
  applyEnvDef(envId, groundY) {
    const d = this.envDef = this.env.apply(envId, groundY);
    this.renderer.toneMappingExposure = d.expo;
    this.post.setGrade(d.sat, d.tint);
    this.world.U.uSkyMin.value = d.amb;
    // 煙塵粒子用的大概光色：天空光 + 一點太陽
    this.fxLight.copy(this.env.hemi.color).multiplyScalar(d.hemiI * 0.3).add(_c1.copy(this.env.sun.color).multiplyScalar(d.sunI * 0.1));
    if (this.view.setEnv) this.view.setEnv({ sunDir: this.env.sunDir, sunColor: this.env.sun.color, sunIntensity: d.sunI, skyColor: this.env.hemi.color, groundColor: this.env.hemi.groundColor, ambient: d.hemiI, envMap: this.scene.environment });
    this.sfx.setEnv({ reverb: d.reverb, size: 1.2 + d.reverb * 2 });
  }

  _resize() {
    const w = innerWidth, h = innerHeight, r = this.renderer;
    r.setSize(w, h, false);
    const s = r.getDrawingBufferSize(_v2s);
    this.post.configure(this.Q.post, this.Q.msaa, s.x, s.y);
    this.viewH = s.y;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.view.setAspect(w / h);
  }

  // 補給品的模型跟著地圖換
  _setPickups(mapId) {
    if (this.pickMap === mapId) return;
    this.pickMap = mapId;
    for (const g of this.pickMeshes) { this.scene.remove(g); g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    this.pickDefs = MAPS[mapId].pickups;
    this.pickAt = this.pickDefs.map(() => 0);
    this.pickMeshes = this.pickDefs.map((p) => {
      const g = new THREE.Group();
      const c = p.type === 'hp' ? 0x54e07a : 0x4aa8ff;
      const mat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.6, roughness: 0.4 });
      const s = p.amount >= 40 ? 1 : 0.75;
      if (p.type === 'hp') { g.add(new THREE.Mesh(new THREE.BoxGeometry(0.44 * s, 0.14 * s, 0.14 * s), mat), new THREE.Mesh(new THREE.BoxGeometry(0.14 * s, 0.44 * s, 0.14 * s), mat)); }
      else g.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.46, 0.12), mat));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 24), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.7, side: THREE.DoubleSide, toneMapped: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = -0.62; g.add(ring);
      g.position.set(p.x, p.y + 0.7, p.z); g.visible = false;
      this.scene.add(g);
      return g;
    });
  }

  // ───────── 輸入 ─────────
  _bindInput() {
    const c = this.canvas;
    addEventListener('keydown', (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return;
      this.keys[e.code] = true;
      if (this.phase === 'editor') { if (this.locked || NOLOCK) { if (!e.repeat) this._editorKey(e.code, e.shiftKey); e.preventDefault(); } return; }
      if (this.buyOpen) { if (!e.repeat && (e.code === this.binds.buy || e.code === 'Escape')) { this.closeBuy(); e.preventDefault(); } return; }
      if (!this.active()) return;
      if (!e.repeat) this._edge(e.code);
      if (e.code === 'Tab' || e.code === 'Space' || Object.values(this.binds).includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; this.mouse.l = this.mouse.r = false; });
    c.addEventListener('mousedown', (e) => {
      if (this.phase === 'editor') {
        if (!this.locked && !NOLOCK) { this.requestLock(); return; }
        if (e.button === 0) this.mouse.l = true; else if (e.button === 2) this.mouse.r = true; else if (e.button === 1) { this.editor.pick(); e.preventDefault(); }
        return;
      }
      if (!this.active()) { if (this.inRound() && !this.buyOpen) this.requestLock(); return; }
      if (this.kc) { this.replay.stop(); return; }   // 擊殺回放中點一下 = 跳過
      if (e.button === 0) { this.mouse.l = true; this.mouse.lp = true; }
      else if (e.button === 2) this.mouse.r = true;
      else { this.keys['Mouse' + e.button] = true; this._edge('Mouse' + e.button); e.preventDefault(); } // 中鍵、側鍵也能綁
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.l = false; else if (e.button === 2) this.mouse.r = false; else this.keys['Mouse' + e.button] = false; });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const mx = clamp(e.movementX || 0, -400, 400), my = clamp(e.movementY || 0, -400, 400);
      if (this.phase === 'editor') { const k = YAW_PER_COUNT * this.settings.asens; this.editor.yaw -= mx * k; this.editor.pitch = clamp(this.editor.pitch - my * k, -1.54, 1.54); return; }
      // 開鏡：照放大倍數等比縮小（畫面上移動的距離跟腰射一樣），再乘開鏡倍率；被時間凝結時轉頭也變慢
      const ads = this.combat.w ? this.combat.ads : 0, k = (YAW_PER_COUNT * this.settings.asens * lerp(1, this.settings.adsMul, ads) * this.skills.lookMul()) / this.zoom();
      this.player.yaw -= mx * k;
      this.player.pitch = clamp(this.player.pitch - my * k, -1.54, 1.54);
      this.mouse.dx += mx; this.mouse.dy += my;
    });
    addEventListener('wheel', (e) => {
      if (!e.deltaY) return;
      const now = performance.now();
      if (this.phase === 'editor') {
        if ((this.locked || NOLOCK) && now - this.lastWheel > 90) { this.lastWheel = now; this._editorCycle(e.deltaY > 0 ? 1 : -1); }
        return;
      }
      // 要累積到一定的滾動量才切槍：真的滾輪一格就夠，Magic Mouse／觸控板的輕微滑動不會誤觸
      if (!this.active() || !this.settings.wheel) return;
      if (now - this.wheelT > 250) this.wheelAcc = 0;
      this.wheelT = now; this.wheelAcc += Math.abs(e.deltaY);
      if (this.wheelAcc >= 40 && now - this.lastWheel > 350) { this.lastWheel = now; this.wheelAcc = 0; this.combat.cycle(e.deltaY > 0 ? 1 : -1); }
    }, { passive: true });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      if (!this.locked) { this.mouse.l = this.mouse.r = false; this.keys = {}; }
      if (this.phase === 'editor') { this.hud.editorLock(this.locked); return; }
      this.hud.setPaused(this.inRound() && !this.locked && !NOLOCK && !this.buyOpen);
    });
  }

  held(action) { return !!this.keys[this.binds[action]]; }
  // 按下瞬間觸發的動作（切槍、換彈、丟投擲物、噴漆…）
  _edge(code) {
    const b = this.binds, cb = this.combat;
    if (this.kc) { if (code === b.jump) this.replay.stop(); return; }
    if (code === b.primary) cb.switchTo(0);
    else if (code === b.secondary) cb.switchTo(1);
    else if (code === b.knife) cb.switchTo(2);
    else if (code === b.swap) cb.switchLast();
    else if (code === b.reload) this.reloadPressed = true;
    else if (code === b.buy) { if (this.phase === 'warmup' || this.phase === 'horde') this.openBuy(); }
    else if ((this.phase === 'playing' || this.phase === 'warmup' || this.phase === 'horde') && this.meAlive()) {
      if (this.skills.frozen()) return;                 // 被時間暫停：什麼都不能做
      const nade = NADE_IDS.find((k) => b[k] === code);
      if (code === b.skill1) this.skills.use(0);
      else if (code === b.skill2) this.skills.use(1);
      else if (nade) cb.throwNade(nade);
      else if (code === b.spray) this.doSpray();
      else if (code === b.emote) this.doEmote();
    } else if (this.phase === 'roundEnd' && this.meAlive() && code === b.emote) this.doEmote();
  }
  setBind(action, code) {
    for (const a in this.binds) if (a !== action && this.binds[a] === code) this.binds[a] = this.binds[action]; // 撞鍵就互換
    this.binds[action] = code; store.set('binds', this.binds); this.hud.renderBinds();
  }
  resetBinds() { this.binds = { ...DEFAULT_BINDS }; store.set('binds', this.binds); this.hud.renderBinds(); }

  active() { return this.inRound() && (this.locked || NOLOCK) && !this.buyOpen; }
  inRound() { return ROUND_PHASES.includes(this.phase); }
  meAlive() { return !!(this.gs && this.gs.p[this.me].al); }
  zoom() { const w = this.combat.w; return w ? lerp(1, w.def.zoom, this.combat.ads) : 1; }
  // 1 對 1 的對手座位（混戰的座位 2、3 沒有「唯一的對手」，給 0 號當顯示用的備案，不會變成 -1）
  oppI() { return this.me <= 1 ? 1 - this.me : 0; }
  oppHas(id) { const o = this.gs && this.gs.p[this.oppI()]; return !!(o && o.bf && o.bf.includes(id)); }
  ffa() { return !!(this.gs && this.gs.set && this.gs.set.mode === 'ffa'); }
  // 某個座位的角色模型：1 對 1 就是 this.remote；混戰每個座位一個（第一次用到才做）
  foe(slot) {
    if (!this.ffa()) return this.remote;
    if (slot === this.me || !(slot >= 0 && slot < FFA.SLOTS)) return null;
    let r = this.foes.get(slot);
    if (!r) { r = this._mkDoll(TEAM[slot]); r.alive = false; r.group.visible = false; r._step = 0; this.foes.set(slot, r); }
    return r;
  }
  // 現在場上的對手 [[座位, 模型], …]
  others() {
    if (!this.ffa()) return [[1 - this.me, this.remote]];
    const o = [], here = (this.gs && this.gs.here) || [];
    for (let i = 0; i < here.length; i++) if (i !== this.me && here[i]) o.push([i, this.foe(i)]);
    return o;
  }
  _clearFoes() { for (const r of this.foes.values()) { r.alive = false; r.group.visible = false; this.scene.remove(r.group); } this.foes.clear(); }
  // 毒圈現在的半徑（沒有毒圈 = 無限大）
  stormR(now = performance.now()) {
    const st = this.storm; if (!st) return Infinity;
    const k = clamp((now - st.a) / Math.max(1, st.b - st.a), 0, 1);
    return st.r0 + (st.r1 - st.r0) * k;
  }
  coop() { return this.phase === 'horde' || !!(this.gs && this.gs.hz); }   // 機器人模式：另一位玩家是隊友

  // 子彈打得到的目標：對戰時是對手；機器人模式是場上的機器人（打不到隊友）。回傳 { t, head, id }，id -1 = 對手
  rayTarget(ox, oy, oz, dx, dy, dz) {
    if (this.horde.on) return this.horde.rayHit(ox, oy, oz, dx, dy, dz);
    if (this.ffa()) {                                                   // 混戰：每個活著的對手都打得到，id 是 'p座位號'
      let best = null;
      for (const [sl, r] of this.others()) { if (!r.alive) continue; const h = r.rayHit(ox, oy, oz, dx, dy, dz); if (h && (!best || h.t < best.t)) best = { t: h.t, head: h.head, id: 'p' + sl }; }
      return best;
    }
    const h = this.remote.rayHit(ox, oy, oz, dx, dy, dz), a = h ? { t: h.t, head: h.head, id: -1 } : null;
    const p = this.pets.rayHit(ox, oy, oz, dx, dy, dz);                // 對手的召喚物也打得到（id 是 'pet數字'）
    return p && (!a || p.t < a.t) ? p : a;
  }
  // 爆炸、火這類範圍傷害：每個能打的目標 fn(id, 腳底位置, 體型)
  eachTarget(fn) {
    if (this.horde.on) this.horde.each(fn);
    else if (this.ffa()) { for (const [sl, r] of this.others()) if (r.alive) fn('p' + sl, r.pos, 1); }
    else { if (this.remote.alive) fn(-1, this.remote.pos, 1); this.pets.each(fn); }
  }
  targetYaw(id) { if (/^p\d$/.test(id)) { const r = this.foe(+id[1]); return r ? r.yaw : 0; } return id === -1 ? this.remote.yaw : String(id).startsWith('pet') ? this.pets.yawOf(id) : this.horde.yawOf(id); }
  // 打中了：對手走裁判的 'hit'；機器人走 'mobhit'（房主那邊扣它的血）
  hitTarget(id, d, head, w, x) {
    if (String(id).startsWith('pet')) { this.pets.hit(id, d, head); return; }   // 打中對手的召喚物：通知主人扣血
    // 混戰：打中某個座位的人。tg = 打的是哪個座位（t 已經被拿來放訊息類型，不能用）
    if (/^p\d$/.test(id)) { const sl = +id[1], r = this.foe(sl); this.auth('hit', { r: this.round, d, h: head, w, ...(x || {}), tg: sl }); if (r) r.hitFlash(); return; }
    if (id !== -1) { this.auth('mobhit', { r: this.round, id, d, h: head, w }); this.horde.flash(id); return; }
    this.auth('hit', { r: this.round, d, h: head, w, ...(x || {}) }); this.remote.hitFlash();
  }
  // 戰績記在哪一邊：跟機器人打算練習
  mode() { return this.net.mode === 'bot' || this.warmBot ? 'practice' : 'duel'; }

  requestLock() {
    if (NOLOCK || this.locked) return;
    const fail = () => { if (this.phase !== 'editor') this.hud.setPaused(this.inRound() && !this.buyOpen); };
    // 原始輸入（unadjustedMovement）：Windows 上不吃「增強指標準確度」這種加速，跟 Apex 一樣；Mac 不支援就退回一般鎖定
    const lock = (o) => { const p = this.canvas.requestPointerLock(o); return p && p.then ? p : Promise.resolve(); };
    const raw = this.settings.raw ? { unadjustedMovement: true } : undefined;
    try { lock(raw).catch((e) => { if (raw && e && e.name === 'NotSupportedError') return lock(); throw e; }).catch(fail); } catch { fail(); }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); this.hud.setPaused(false); }

  setSetting(k, v) {
    this.settings[k] = v; store.set(k, v);
    if (k === 'vol') this.sfx.setVolume(v);
    if (k === 'quality') this.applyQuality();
    if (k === 'xh') this.hud.applyCrosshair();
    if (k === 'voiceVol') this.voice.setVolume(v);
    if (k === 'voice') this.setVoice(v);
    if (k === 'name' && this.net.connected) this.auth('name', { name: this.myName() });
  }
  async setVoice(mode) {
    if (mode !== 'off' && !this.voice.available()) { this.hud.voiceState(this.voice); return; }   // 還沒連線：先記著，連上再開
    const ok = await this.voice.setMode(mode);
    if (!ok && this.voice.err) { this.hud.toast(this.voice.err); this.settings.voice = 'off'; store.set('voice', 'off'); this.hud.syncSettings(); }
  }
  vfov() { return vfovOf(this.settings.afov); }   // 現在的垂直視角（介面上算水平視角用）
  look() { return { s: this.settings.skin, w: this.settings.wskin, k: this.settings.knife, p: { ...this.settings.wsp } }; }
  // 補給箱的東西：裝上／卸下（再點一次 = 卸下）。刀型換回戰鬥刀，特殊塗裝換回一般塗裝
  equipped(id) { const it = ITEMS[id]; return !!it && (it.knife ? this.settings.knife === it.knife : this.settings.wsp[it.w] === it.f); }
  equipItem(id) {
    const it = ITEMS[id], st = this.settings;
    if (!it || !this.crate.has(id)) return;
    if (it.knife) { st.knife = st.knife === it.knife ? 'knife' : it.knife; store.set('knife', st.knife); }
    else { const p = { ...st.wsp }; if (p[it.w] === it.f) delete p[it.w]; else p[it.w] = it.f; st.wsp = p; store.set('wsp', p); }
    this.lockerGun = it.knife ? 'knife' : it.w; this.sfx.ui(); this._lookChanged();
  }
  _lookChanged() {
    if (this.lockerOpen) this._dressDoll();
    if (this.combat.w && this.phase !== 'menu') this.view.setWeapon(this.combat.w.id, this.look());
    if (this.authority || this.net.connected) this.auth('look', this.look());
  }
  // 打完一場給抽獎券（跟戰績一樣，在進入 matchEnd 那一刻呼叫一次）
  _reward(kind, win) {
    const n = (REWARD[kind] || 0) + (win ? REWARD.win : 0);
    this.crate.earn(n); this.hud.ticketGain(n);
  }
  setLook(kind, id) {
    this.settings[kind] = id; store.set(kind, id); this.sfx.ui();
    this._dressDoll();
    if (this.authority || this.net.connected) this.auth('look', this.look());
  }
  _dressDoll() { this.doll.applySkin(this.settings.skin, TEAM[0]); this.doll.setWeapon(this.lockerGun || 'ar', this.look()); this.doll._lit(); }
  openLocker() { this.lockerOpen = true; this._dressDoll(); this.doll.group.visible = this.pedestal.visible = true; this.hud.show('locker'); }
  closeLocker() { this.lockerOpen = false; this.doll.group.visible = this.pedestal.visible = false; this.hud.show('menu'); }
  previewEmote(id) { if (this.doll.emote) this.doll.emote(id); }
  myName() { return this.settings.name || (this.net.isHost ? '房主' : '挑戰者'); }
  inviteLink() { return `${location.origin}${location.pathname}?room=${this.code}${LOCAL ? '&local=1' : ''}`; }

  // ───────── 連線 ─────────
  _bindNet() {
    const n = this.net;
    // 玩家之間的訊息：混戰時房主收到會轉給其他人（1 對 1 沒有其他人，等於沒差）
    n.relay = new Set(['st', 'fire', 'blk', 'expl', 'blind', 'spray', 'emote', 'sk']);
    n.on('_open', (slot) => {
      if (n.isHost) {
        if (this.warmBot) { this._dropWarmBot(); if (this.authority) this.authority.toLobby(); }   // 朋友來了：陪練的機器人下場
        if (this.authority) this.authority.setPresent(slot, true);
        if (n.mode !== 'bot') { this.hud.toast(n.capacity > 1 ? `有人加入了房間（現在 ${n.count() + 1} 人）` : '對手加入了房間'); this._sendMap(this.authority && this.authority.settings.map); }
      } else { this.me = slot; this.auth('name', { name: this.myName() }); this.auth('look', this.look()); }
      if (n.capacity === 1 || !n.isHost) { this.voice.attach(); if (slot === 1 || !n.isHost) this.voice.call(); }   // 語音只有 1 對 1（混戰只有房主跟第一個人）
    });
    n.on('_close', (slot) => {
      if (n.isHost) {
        if (slot === 1) this.voice.hangup();
        if (this.authority) {
          this.authority.setPresent(slot, false);
          const ffa = this.authority.ffa(), left = this.authority.here().length;
          this.hud.toast(ffa ? `${this.gs && this.gs.p[slot] ? this.gs.p[slot].n : '有人'} 離開了（剩 ${left} 人）` : '對手離線了，房間還開著，可以重新邀請');
          // 1 對 1：回大廳；混戰：剩下的人不到 2 個才回大廳；機器人模式：隊友走了，自己繼續打
          if (this.authority.phase !== 'horde' && (!ffa || left < 2)) this.authority.toLobby();
        }
        const r = this.foes.get(slot); if (r) { r.alive = false; r.group.visible = false; }
      } else { this.voice.hangup(); this.leave(); this.hud.menuMsg('與房主的連線中斷了'); }
    });
    n.on('_error', (t) => { if (t !== 'peer-unavailable') this.hud.toast('網路狀況不穩（' + t + '）'); });
    n.on('auth', (d, from) => { if (n.isHost && this.authority && d) this.authority.handle(from, d.t, d); });
    n.on('gs', (d) => { if (!n.isHost) this.onGs(d); });
    n.on('ev', (d) => { if (!n.isHost) this.onEv(d); });
    n.on('st', (d, from) => { const r = this.foe(from); if (!r) return; r.push(d); if (WEAPONS[d[5]] && d[5] !== r.weapon) { r.setWeapon(d[5], r.wskin); r._lit(); } });
    n.on('fire', (d, from) => this.onRemoteFire(d, from));
    n.on('blk', (d) => this.onRemoteBlk(d));
    n.on('expl', (d) => { const m = this._cleanExpl(d); if (!m || m.r !== this.round) return; this.combat.removeProjectile(m.pid); this.doExplosion(m); });
    n.on('blind', (d, from) => { if (this.gs && d && d.d > 0.6 && this.gs.p[from] && from !== this.me) this.hud.feed(`閃到 ${this.gs.p[from].n}　${d.d} 秒`); });
    n.on('spray', (d) => { if (d && d.r === this.round && SPRAYS[d.id] && Array.isArray(d.p) && Array.isArray(d.n)) this.fx.spray(sprayTex(d.id), +d.p[0], +d.p[1], +d.p[2], +d.n[0], +d.n[1], +d.n[2], +d.y || 0, d.c | 0); });
    n.on('emote', (d, from) => { const r = this.foe(from); if (d && EMOTES[d.id] && r && r.emote) r.emote(d.id); });
    n.on('sk', (d) => this.skills.onNet(d));   // 對手施放了技能
    // 機器人模式：房主傳來機器人的位置、開槍、巨人的砲擊預告
    n.on('mobs', (d) => { if (!n.isHost) this.horde.onSnap(d); });
    n.on('mfire', (d) => { if (!n.isHost) this.horde.onFire(d); });
    n.on('mwarn', (d) => { if (!n.isHost) this.horde.onWarn(d); });
    // 房主選了自製地圖：把地圖資料傳過來，登記好之後才處理用到它的狀態
    n.on('map', async (d) => {
      if (n.isHost || !d || typeof d.code !== 'string' || d.code.length > 400000) return;
      try { registerCustom(await decodeMap(d.code), d.code); this.hud.refreshMaps(); } catch { return; }
      if (this.pendingGs) { const g = this.pendingGs; this.pendingGs = null; this.onGs(g); }
    });
  }
  // 對手送來的爆炸／煙／火：座標要是正常的數字，範圍和威力夾在遊戲裡真的會出現的大小以內（不然一個封包就能把整張圖炸平或卡死畫面）
  _cleanExpl(d) {
    if (!d || !Array.isArray(d.p) || d.p.length !== 3 || !d.p.every((v) => Number.isFinite(v))) return null;
    const num = (v, hi) => (Number.isFinite(+v) ? clamp(+v, 0, hi) : 0);
    // kind 'dig' = 只挖地形、沒有爆炸特效；fxk = 技能的爆炸要用哪一種特效
    const kind = ['flash', 'smoke', 'molotov', 'dig'].includes(d.kind) ? d.kind : undefined;
    const fxk = ['mini', 'shock', 'orbital', 'void'].includes(d.fxk) ? d.fxk : undefined;
    return { r: d.r, pid: d.pid | 0, p: [d.p[0], d.p[1], d.p[2]], kind, fxk, br: num(d.br, 6), bp: num(d.bp, 1500), rad: num(d.rad, 18), k: num(d.k, 32), cloud: num(d.cloud, 8.5) || undefined, dur: num(d.dur, 25) || undefined, fk: num(d.fk, 2) || undefined, ns: d.ns ? 1 : 0, own: Number.isInteger(d.own) && d.own >= 0 && d.own < FFA.SLOTS ? d.own : -1 };
  }
  _sendMap(id) { const m = MAPS[id]; if (m && m.custom && this.net.isHost && this.net.connected) this.net.send('map', { id, code: m.code }); }

  _mkAuthority() {
    if (this.authority) this.authority.destroy();
    this.authority = new Authority((i, type, data) => {
      if (i === 0) queueMicrotask(() => { if (type === 'gs') this.onGs(data); else if (type === 'ev') this.onEv(data); });
      else this.net.sendTo(i, type, data);
    });
    this.authority.setName(0, this.myName());
    this.authority.handle(0, 'look', this.look());
    this.authority.onMobHit = (i, d) => this.horde.hit(i, d);
  }

  async hostGame() {
    this.sfx.init(); this.hud.menuMsg('建立房間中…'); this.hud.menuBusy(true);
    this.code = roomCode(); this.me = 0;
    try {
      await this.net.host(this.code, LOCAL);
      this._mkAuthority();
      this.authority.flush();
      this.hud.menuMsg('');
      this.voice.attach(); if (this.settings.voice !== 'off') this.setVoice(this.settings.voice);
    } catch (e) { this.net.close(); this.hud.menuMsg(e.message || '建立房間失敗'); }
    this.hud.menuBusy(false);
  }

  async joinGame(code) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) { this.hud.menuMsg('請輸入 5 碼房號'); return; }
    this.sfx.init(); this.hud.menuMsg('連線中…'); this.hud.menuBusy(true);
    this.code = code; this.me = 1;
    try {
      await this.net.join(code, LOCAL, (m) => this.hud.menuMsg(m)); this.hud.menuMsg('已連上，等待房主資料…');
      this.voice.attach(); if (this.settings.voice !== 'off') this.setVoice(this.settings.voice);
    } catch (e) { this.net.close(); this.hud.menuMsg(e.message || '加入失敗'); }
    this.hud.menuBusy(false);
  }

  // map：指定地圖（編輯器的「試玩」用）；不給就照選單選的
  practice(map) {
    this.sfx.init(); this.me = 0; this.code = '';
    const level = this.settings.bot;
    this.bot = new Bot(this.world, level);
    this._wireBot();
    this.net.isHost = true;
    this._mkAuthority();
    this.net.hostBot(this.bot);
    this.authority.setName(1, level === 'dummy' ? '木樁' : '練習機器人');
    // 木樁模式是給你練身法、練槍的：每局 15 分鐘，對手不動也不開槍
    const m = map || this.settings.pmap;
    this.authority.setSettings({ map: MAPS[m] || m === 'rotate' ? m : 'random', roundTime: level === 'dummy' ? 900 : 120, mode: this.settings.prog ? 'rogue' : 'classic' });
    this.authority.startMatch();
  }

  // 自己一個人玩機器人模式：kind 'dm' 死鬥練習／'defense' 守據點
  practiceHorde(kind) {
    this.sfx.init(); this.me = 0; this.code = '';
    this.net.close(); this.net.isHost = true;
    this._mkAuthority();
    const c = kind === 'dm' ? this.settings.hzdm : this.settings.hzdef, m = c.map, hz = kind === 'dm' ? c : { lv: c.lv, atk: true };
    this.authority.setSettings({ mode: kind, map: MAPS[m] ? m : 'random', hz });
    this.authority.startMatch();
  }
  hzMode() { return !!this.authority && ['dm', 'defense'].includes(this.authority.settings.mode); }
  // 守據點：現在開放到第幾波的槍（休息時算下一波）
  hzTier() { const hz = this.gs && this.gs.hz; return !hz || hz.kind !== 'defense' ? 99 : hz.st === 'break' ? hz.wave + 1 : hz.wave; }
  shopSel() { return this.phase === 'horde' ? this.hsel : this.phase === 'warmup' ? this.wsel : this.sel; }

  // 機器人需要問遊戲的事：視線有沒有被煙擋住、子彈會不會被能量護罩擋下
  _wireBot() {
    this.bot.blocked = (ax, ay, az, bx, by, bz) => this.fx.smokeBlocked(ax, ay, az, bx, by, bz);
    this.bot.shield = (ox, oy, oz, dx, dy, dz) => this.skills.shieldDist(ox, oy, oz, dx, dy, dz);
  }

  // 熱身：沒有回合、無限重生。房間裡只有自己時，先叫一個機器人陪練，朋友一進來就結束
  startWarmup() {
    if (!this.authority || !this.gs || !this.net.isHost) return;
    if (!this.gs.here[1]) {
      const lv = this.settings.bot === 'dummy' ? 'normal' : this.settings.bot;
      this.bot = new Bot(this.world, lv);
      this._wireBot();
      this.warmBot = true;
      this.net.attachBot(this.bot);
      this.authority.setName(1, '陪練機器人'); this.authority.setPresent(1, true);
    } else this._sendMap(this.authority.settings.map);
    this.authority.startWarmup();
  }
  _dropWarmBot() {
    if (!this.warmBot) return;
    this.warmBot = false; this.bot = null; this.net.detachBot();
    if (this.authority) { this.authority.setPresent(1, false); this.authority.setName(1, ''); }
  }
  endWarmup() {
    if (this.authority && this.phase === 'horde') { this.authority.endHorde(); return; }   // 機器人模式：提早結束，看結算
    if (!this.authority || this.phase !== 'warmup') return; this._dropWarmBot(); this.authority.toLobby();
  }

  leave() {
    this.voice.close();
    this.net.close();
    if (this.authority) { this.authority.destroy(); this.authority = null; }
    this.bot = null; this.warmBot = false; this.gs = null; this.phase = 'menu'; this.round = 0; this.oppLook = ''; this.pendingGs = null;
    this.lockerOpen = false; this.doll.group.visible = this.pedestal.visible = false; this.buyOpen = false;
    this.remote.alive = false; this.remote.group.visible = false; this.ghost.group.visible = false; this.remote._lk = '';
    this._clearFoes(); this.storm = null; this.spec = -1; this.stormFx(false);
    this._endKillcam(); this.emote = null; this.editor.close(); this.hurtSrc = null; this.hud.hurtDir(0, 0);
    this.pets.clear();
    this.exitLock(); this.hud.showHud(false); this.hud.clearBanner(); this.hud.report(null); this.hud.show('menu'); this.hud.menuMsg('');
    this.combat.clearProjectiles(); this.fx.clear(); this.skills.clear(); this.horde.stop(); this.sfx.stopLoops(); this.sfx.ambient(null);
    for (const m of this.pickMeshes) m.visible = false;
    if (!MAPS[this.world.mapId]) this.setMap('plaza');
  }

  changeSettings(s) {
    if (!this.authority) return;
    this.authority.setSettings(s); if (s.map) this._sendMap(s.map);
    this.net.capacity = this.authority.ffa() ? FFA.SLOTS - 1 : 1;   // 混戰：房主 + 3 個訪客
  }
  // 對戰要等對手進來；機器人模式可以先自己開打，朋友晚點進來也會直接加入
  startMatch() {
    if (!this.authority || !this.gs || this.warmBot) return;
    const n = this.gs.here.filter(Boolean).length;
    if (this.authority.ffa() ? n < FFA.MIN : !(this.gs.here[1] || this.hzMode())) return;
    this._sendMap(this.authority.settings.map); this.authority.startMatch();
  }

  // 對裁判提出請求：房主直接呼叫、訪客走網路
  auth(type, data) {
    if (this.net.isHost) { if (this.authority) this.authority.handle(0, type, data); }
    else this.net.send('auth', { ...data, t: type });
  }
  sendPeer(type, data) { this.net.send(type, data); }

  // ───────── 買裝備 ─────────
  // kind: 'p' 主武器 / 's' 副武器 / 裝備代號（armor、he、flash、smoke、molotov）
  // 裝備：點一下多買一個（防彈衣是買／不買），dec = true 少買一個（商店卡片上的「−」或右鍵）
  buy(kind, id, dec = false) {
    const gs = this.gs;
    if (!gs) return;
    if (gs.phase === 'warmup' || gs.phase === 'horde') {   // 熱身、機器人模式：全部免費，愛拿什麼拿什麼
      if (!this.buyOpen) return;
      const horde = gs.phase === 'horde', n = { ...(horde ? this.hsel : this.wsel) };
      if (kind === 'p' && n.p !== id && (HZ_TIER[id] || 1) > this.hzTier()) { this.sfx.deny(); this.hud.toast(`撐到第 ${HZ_TIER[id]} 波才開放`); return; }
      if (kind === 'p') n.p = n.p === id ? null : id; else if (kind === 's') n.s = id;
      else if (GEAR[kind]) { const cap = Math.min(GEAR[kind].max, FREE_NADES); n[kind] = dec ? Math.max(0, n[kind] - 1) : n[kind] >= cap ? 0 : n[kind] + 1; } else return;
      if (horde) this.hsel = n; else { this.wsel = n; store.set('wsel', n); }
      this.sfx.buy(); this.hud.onState(gs);
      return;
    }
    if (gs.phase !== 'loadout') return;
    const money = gs.p[this.me].$, next = { ...this.sel };
    if (kind === 'p') {
      if (gs.round <= 1) { this.sfx.deny(); this.hud.toast('第 1 局是手槍局，下一局才能買主武器'); return; }
      next.p = next.p === id ? null : id;
    } else if (kind === 's') next.s = id;
    else if (GEAR[kind]) {
      const n = next[kind] || 0;
      if (dec) next[kind] = Math.max(0, n - 1);
      else if (GEAR[kind].max === 1) next[kind] = n ? 0 : 1;                       // 防彈衣：再點一次 = 取消
      else next[kind] = Math.min(GEAR[kind].max, n + 1);                           // 投擲物：一直點一直買，只看錢夠不夠
    }
    else return;
    if (loadoutCost(next) > money) { this.sfx.deny(); this.hud.toast('錢不夠'); return; }
    this.sel = next; this.sfx.buy();
    this.auth('loadout', this.sel);
    this.hud.onState(gs);
  }
  toggleReady() {
    if (!this.gs) return;
    if (this.phase === 'warmup' || this.phase === 'horde') { this.closeBuy(); return; }
    this.sfx.ui(); this.auth('ready', { v: !this.gs.p[this.me].rd });
  }
  // 選卡（一般模式的輸家強化也走這裡）。slot：兩格技能都滿了的時候，要換掉哪一格
  pickBuff(id, slot = 0) { const c = CARDS[id]; if (c) this.sfx.card(c.r); else this.sfx.pickup(); this.auth('buff', { id, slot }); }
  // Roguelike：花錢把這一局的卡重抽一次
  reroll() {
    const gs = this.gs, me = gs && gs.p[this.me];
    if (!me || gs.phase !== 'loadout' || !me.ch || me.rr >= ROGUE.REROLLS) return;
    if (me.$ - loadoutCost(this.sel) < ROGUE.REROLL) { this.sfx.deny(); this.hud.toast('錢不夠重抽（可以先取消幾樣裝備）'); return; }
    this.sfx.buy(); this.auth('reroll', {});
  }
  // 熱身中的商店
  openBuy() {
    if ((this.phase !== 'warmup' && this.phase !== 'horde') || this.buyOpen) return;
    const hz = this.gs && this.gs.hz;
    if (this.phase === 'horde' && hz && hz.kind === 'defense' && hz.st !== 'break') { this.sfx.deny(); this.hud.toast('打完這一波、休息的時候才能換裝備'); return; }
    this.buyOpen = true; this.mouse.l = this.mouse.r = false; this.exitLock(); this.hud.show('loadout'); this.hud.onState(this.gs);
  }
  closeBuy() {
    if (!this.buyOpen) return;
    this.buyOpen = false; this.hud.show(null);
    if (this.phase === 'warmup') { this.auth('loadout', this.wsel); if (this.meAlive()) this.combat.setLoadout(this.wsel, []); this.requestLock(); }
    else if (this.phase === 'horde') { this.auth('loadout', this.hsel); if (this.meAlive()) this.combat.setLoadout(this.hsel, this.gs.p[this.me].bf); this.requestLock(); }   // 換完裝備順便補滿彈藥
  }

  // ───────── 主機狀態 → 本機 ─────────
  onGs(gs) {
    // 用到還沒收到的自製地圖 → 先放著，等地圖資料到了再處理
    if (!MAPS[gs.map] || (gs.set && gs.set.map !== 'random' && gs.set.map !== 'rotate' && !MAPS[gs.set.map])) { this.pendingGs = gs; return; }
    const prev = this.gs; this.gs = gs;
    this.phaseEnd = performance.now() + gs.tLeft;
    const changed = !prev || prev.phase !== gs.phase || prev.round !== gs.round;
    if (changed) this.enterPhase(gs);
    if (gs.hz && gs.hz.cp && this.horde.on) this.horde.setCore(gs.hz.cp);   // 據點的位置以房主算的為準
    if (gs.phase === 'horde' && this.phase === 'horde') {                       // 守據點選到新的強化卡：馬上生效
      const bk = gs.p[this.me].bf.join(',');
      if (bk !== this.hzBf) { this.hzBf = bk; this.combat.applyMods(gs.p[this.me].bf); }
    }
    // 大廳裡房主指定地圖時，背景直接換成那張圖預覽
    if (gs.phase === 'lobby' && MAPS[gs.set.map] && this.world.mapId !== gs.set.map) this.setMap(gs.set.map);
    const inR = this.inRound(), ffa = this.ffa();
    if (!ffa && this.foes.size) this._clearFoes();
    if (ffa) { this.remote.alive = false; this.remote.group.visible = false; for (const [sl, r] of this.foes) if (!gs.here[sl]) { r.alive = false; r.group.visible = false; } }
    // 毒圈：時間是「離現在幾毫秒」，換成自己這台的時鐘
    if (gs.storm) { const t = performance.now(), st = gs.storm; this.storm = { x: st.x, z: st.z, r0: st.r0, r1: st.r1, a: t + st.a, b: t + st.b }; } else this.storm = null;
    for (const [sl, r] of this.others()) {
      const opp = gs.p[sl]; if (!opp || !r) continue;
      const lk = JSON.stringify(opp.lk);
      if (lk !== r._lk) { r._lk = lk; r.applySkin(opp.lk.s, TEAM[sl]); r.setWeapon(r.weapon, opp.lk); r._lit(); }
      const wasAlive = r.alive;
      r.alive = inR && opp.al;
      if (inR && wasAlive && !opp.al && r.die) {             // 對手倒下：往遠離我的方向倒
        const p = this.player.pos, rp = r.pos; r.die(rp.x - p.x, rp.z - p.z);
      } else if (r.alive && r.dead && r.revive) { r.revive(); r.clearBuffer(); }
      r.group.visible = inR && (opp.al || !!r.dead) && !this.kc;
    }
    for (let i = 0; i < this.pickMeshes.length; i++) this.pickMeshes[i].visible = inR && !!gs.pk[i];
    this.hud.onState(gs);
  }

  enterPhase(gs) {
    const from = this.phase;
    this.phase = gs.phase;
    const h = this.hud;
    if (gs.phase !== 'roundEnd') { this._endKillcam(); h.report(null); }
    if (gs.phase !== 'warmup' && gs.phase !== 'horde') this.buyOpen = false;
    if (gs.phase !== 'horde') this.horde.stop();
    if (gs.phase === 'lobby') {
      this.exitLock(); h.showHud(false); h.clearBanner(); h.show('lobby'); this.emote = null; this.ghost.group.visible = false;
      this.sfx.stopLoops(); this.sfx.ambient(null); this.skills.clear();
      if (from === 'warmup' || from === 'roundEnd' || from === 'playing' || from === 'countdown' || from === 'horde') { this.combat.clearProjectiles(); this.fx.clear(); }
    }
    else if (gs.phase === 'loadout') {
      this.exitLock(); h.showHud(false); h.clearBanner(); h.show('loadout'); this.emote = null; this.ghost.group.visible = false;
      this.mouse.l = this.mouse.r = false;
      this.sel = validLoadout(null);   // 商店重置：每局都要自己重新買
      this.auth('loadout', this.sel);
      this.sfx.stopLoops(); this.skills.clear();
    } else if (gs.phase === 'countdown') this.startRound(gs);
    else if (gs.phase === 'warmup') { this.startRound(gs); h.banner('熱身', `不計分、無限重生　按 ${h.key('buy')} 換裝備`, 2600); this.auth('loadout', this.wsel); }
    else if (gs.phase === 'horde') {
      const def = gs.hz.kind === 'defense';
      this.hsel = { ...this.wsel };
      if ((HZ_TIER[this.hsel.p] || 1) > this.hzTier()) this.hsel.p = 'smg';   // 守據點一開始只有衝鋒槍和副武器
      this.startRound(gs);
      this.horde.begin(gs);
      this.player.spawn(this.horde.playerSpawn());
      this.auth('loadout', this.hsel);
      if (def) h.banner('守據點', `守住中間的據點。第一波 ${HORDE.FIRST_BREAK} 秒後來　${h.key('skill1')} 蓋沙包牆　${h.key('buy')} 換裝備`, 4200);
      else h.banner('死鬥練習', `無限重生　按 ${h.key('buy')} 換裝備`, 2600);
    }
    else if (gs.phase === 'playing') {
      if (this.round !== gs.round) this.startRound(gs); // 保險：沒收到倒數階段也要先把這一局建好
      h.banner('開戰！', '', 800); this.sfx.beep(true); this.sfx.roundStart(); this.skills.go(performance.now());
    } else if (gs.phase === 'roundEnd') {
      if (this.round !== gs.round) this.startRound(gs);
      this.onRoundEnd(gs);
    }
    else if (gs.phase === 'matchEnd') {
      this.exitLock(); h.showHud(false); h.clearBanner(); h.show('end'); this.sfx.stopLoops(); this.skills.clear();
      if (gs.hz) { this._hzRecord(gs); this.sfx.win(); this._reward('horde', false); return; }   // 機器人模式：結算畫面另外畫，也不記進對戰戰績
      if (gs.mw === this.me) this.sfx.win(); else this.sfx.lose();
      const me = gs.p[this.me], opp = gs.p[1 - this.me];
      if (this.ffa()) { const os = this.others().map(([sl]) => gs.p[sl]); this.stats.match(this.mode(), { win: gs.mw === this.me, my: me.sc, their: Math.max(0, ...os.map((o) => o.sc)), opp: '混戰：' + os.map((o) => o.n).join('、'), map: MAPS[gs.map].name }); }
      else this.stats.match(this.mode(), { win: gs.mw === this.me, my: me.sc, their: opp.sc, opp: opp.n, map: MAPS[gs.map].name });
      this._reward(this.mode(), gs.mw === this.me);
    }
  }

  // 機器人模式的最佳紀錄（這台電腦）：死鬥看同樣時間內擊倒最多幾隻，守據點看每種難度撐過幾波
  _hzRecord(gs) {
    const hz = gs.hz, best = store.get('hzbest', null) || {}, me = this.me;
    const key = hz.kind === 'dm' ? `dm:${hz.cfg.time}:${hz.cfg.n}` : `def:${hz.cfg.lv}`, val = hz.kind === 'dm' ? hz.k[me] : hz.res ? hz.res.waves : 0;
    this.hzPrev = best[key] || 0;
    this.hzNew = val > this.hzPrev && (hz.kind !== 'dm' || !hz.res || hz.res.why === 'time');   // 死鬥提早結束不算紀錄
    if (this.hzNew) { best[key] = val; store.set('hzbest', best); }
    this.hzAcc = { shots: this.combat.shots - this.rs0, hits: this.combat.hits - this.rh0 };
  }

  startRound(gs) {
    const warm = gs.phase === 'warmup', horde = gs.phase === 'horde';
    this.round = gs.round;
    this.setMap(gs.map); this._setPickups(gs.map); this.fx.clear(); this.sfx.stopLoops(); this.combat.clearProjectiles();
    const meS = gs.p[this.me], sp = MAPS[gs.map].spawns, nsp = this.ffa() ? sp.length : 2;   // 混戰：四個出生點每局輪一次
    this.player.spawn(sp[(this.me + gs.round) % nsp]);
    this.combat.setLoadout(warm ? this.wsel : horde ? this.hsel : meS.lo, warm ? [] : meS.bf);
    this.hzBf = meS.bf.join(',');
    const def = horde && gs.hz && gs.hz.kind === 'defense';
    this.skills.wallType = def ? B.SANDBAG : B.METAL;
    this.skills.setup(warm ? null : meS.sk, def ? [HORDE.WALLS, 0] : undefined);
    this.player.maxAirJumps = this.combat.mods.airJumps;
    if (this.view.setLook) this.view.setLook(this.settings.skin, TEAM[this.me]);
    const opps = this.others().map(([sl, r]) => {
      const opp = gs.p[sl], os = sp[(sl + gs.round) % nsp];
      r.clearBuffer(); r.pos.set(os.x, os.y, os.z); r.yaw = os.yaw; r.lastPos.copy(r.pos); r._step = 0;
      if (r.revive) r.revive();
      r.applySkin(opp.lk.s, TEAM[sl]); r.setWeapon(opp.lo.p || opp.lo.s, opp.lk); r._lit(); r._lk = JSON.stringify(opp.lk);
      return opp;
    });
    this.spec = -1; this.stormFx(false);
    this.ghost.group.visible = false; this.emote = null; this.kc = false; this.kcAt = 0;
    this.replay.clear(); this.mini.reset(); this.rs0 = this.combat.shots; this.rh0 = this.combat.hits; this.hurtSrc = null; this.hud.hurtDir(0, 0);
    this.deathT = 0; this.shake = 0; this.landDip = 0; this.roll = 0; this.rStep = 0;
    this.lastCount = -1; this.keys = {}; this.mouse.l = this.mouse.r = false;
    this.hud.show(null); this.hud.showHud(true); this.hud.clearBanner(); this.hud.clearFlash(); this.hud.report(null);
    this.sfx.ambient(this.envDef ? this.envDef.ambient : null);
    // 先把這一局會用到的槍聲算好，第一槍才不會頓一下
    if (this.sfx.preload) this.sfx.preload([meS.lo.p, meS.lo.s, ...opps.flatMap((o) => [o.lo.p, o.lo.s]), this.wsel.p, this.wsel.s].filter((id) => WEAPONS[id]).map((id) => WEAPONS[id].snd));
    this.requestLock();
    // 瀏覽器不給自動鎖滑鼠時（例如剛按過 Esc），顯示「點一下繼續」
    setTimeout(() => { if (this.inRound() && !this.locked && !NOLOCK && !this.buyOpen) this.hud.setPaused(true); }, 300);
  }

  // 熱身中重生：挑離對手比較遠的出生點（機器人模式：據點旁邊，或離機器人最遠的地方）
  respawn() {
    const gs = this.gs; if (!gs) return;
    if (this.phase === 'horde' && this.horde.on) { this.player.spawn(this.horde.playerSpawn()); this.combat.setLoadout(this.hsel, gs.p[this.me].bf); }
    else {
      const sp = MAPS[gs.map].spawns, rp = this.remote.pos, d = (s) => Math.hypot(s.x - rp.x, s.z - rp.z);
      this.player.spawn(d(sp[0]) > d(sp[1]) ? sp[0] : sp[1]);
      this.combat.setLoadout(this.wsel, []);
    }
    this.deathT = 0; this.shake = 0; this.emote = null; this.ghost.group.visible = false;
    this.hud.clearFlash(); this.sfx.respawn();
  }

  // 擊倒訊息的文字（一般局和熱身共用）
  _killText(r, meWon) {
    const opp = this.gs.p[this.oppI()], wn = itemName(r.w) || cardName(r.w);
    const how = `${wn}${r.bk ? ' 背刺' : ''}${r.head ? ' 爆頭' : ''}${r.wb ? ' 穿牆' : ''}`;
    return r.reason === 'suicide' ? (r.victim === this.me ? '你把自己弄死了' : `${opp.n} 把自己弄死了`) : meWon ? `${how} 擊倒 ${opp.n}` : `${opp.n} 用 ${how} 擊倒你`;
  }

  onRoundEnd(gs) {
    if (this.ffa()) { this._ffaRoundEnd(gs); return; }
    const r = gs.res || {}, me = this.me, my = gs.p[me], opp = gs.p[1 - me], now = performance.now();
    const inc = r.inc ? `　·　獲得 $${r.inc[me]}` : '';
    this.stats.round(this.mode(), {
      win: r.winner === me, kill: r.reason === 'kill' && r.victim === 1 - me, died: r.victim === me, head: !!r.head, wb: !!r.wb, weapon: r.w,
      shots: this.combat.shots - this.rs0, hits: this.combat.hits - this.rh0, dmg: my.rdm,
    });
    // 每局結果（比賽結束畫面的時間軸用）：誰贏、怎麼贏的
    if (gs.round === 1 || !this.roundLog) this.roundLog = [];
    this.roundLog[gs.round - 1] = { w: r.winner === -1 ? -1 : r.winner === me ? 0 : 1, how: r.reason === 'time' ? 'time' : r.head ? 'head' : 'kill' };
    // 傷害報告：這一局雙方各打中幾發、多少血
    this.hud.report({ me: my, opp });
    if (r.winner === -1) { this.hud.banner('平手', '時間到，雙方血量相同' + inc, 0, 'draw'); return; }
    const sub = r.reason === 'time' ? '時間到，血量較多的一方獲勝' : this._killText(r, r.winner === me);
    if (r.winner === me) { this.hud.banner('拿下這一局', sub + inc, 0, 'win'); this.sfx.kill(); if (r.reason === 'kill') this.hud.killMark(r.head); }
    else { this.hud.banner('這局輸了', sub + inc, 0, 'lose'); this.sfx.lose(); }
    if (r.reason !== 'time') this.hud.killfeed({ killer: r.reason === 'suicide' ? null : gs.p[1 - r.victim].n, victim: gs.p[r.victim].n, w: r.w, head: r.head, wb: r.wb, bk: r.bk, mine: r.victim !== me });
    // 被擊倒 → 過一秒播擊殺回放
    if (r.reason === 'kill' && r.victim === me) { this.kcDeath = now; this.kcAt = now + 1100; }
  }

  // ───────── 混戰 ─────────
  // 毒圈的牆：一圈半透明的紫色圓筒，從地面通到天上，跟著半徑縮
  stormWall(now) {
    const on = this.ffa() && this.storm && this.inRound();
    if (!on) { if (this.stormMesh) this.stormMesh.visible = false; return; }
    if (!this.stormMesh) {
      const c = document.createElement('canvas'); c.width = 4; c.height = 128;
      const x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, 'rgba(200,140,255,0.05)'); gr.addColorStop(0.6, 'rgba(160,80,255,0.3)'); gr.addColorStop(1, 'rgba(170,90,255,0.55)');
      x.fillStyle = gr; x.fillRect(0, 0, 4, 128);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 128, 1, true), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false }));
      m.renderOrder = 5; m.frustumCulled = false; this.scene.add(m); this.stormMesh = m;
    }
    const m = this.stormMesh, r = Math.max(0.3, this.stormR(now)), H = this.world.Y * BS + 40;
    m.visible = true; m.scale.set(r, H, r); m.position.set(this.storm.x, H / 2 - 6, this.storm.z);
  }
  // 有人倒下：擊殺列表；我擊倒人 → 擊倒提示；我倒下 → 開始觀戰
  _ffaKill(e) {
    const g = this.gs, v = g.p[e.victim]; if (!v) return;
    const killer = e.reason === 'kill' && g.p[e.by] ? g.p[e.by].n : null;
    this.hud.killfeed({ killer, victim: v.n, w: e.reason === 'storm' ? 'storm' : e.w, head: e.head, wb: e.wb, bk: e.bk, mine: e.by === this.me || e.victim === this.me });
    if (e.by === this.me && e.victim !== this.me && e.reason === 'kill') { this.sfx.kill(); this.hud.killMark(e.head); }
    if (e.victim === this.me) {
      this.sfx.lose(); this.deathT = performance.now();
      const how = e.reason === 'storm' ? '被毒圈吞掉了' : e.reason === 'suicide' ? '你把自己弄死了' : `${killer} 用 ${itemName(e.w) || cardName(e.w) || '？'}${e.head ? ' 爆頭' : ''} 擊倒你`;
      const left = (g.here || []).filter((h, i) => h && i !== this.me && g.p[i].al).length;
      this.hud.banner('你倒下了', `${how}　·　還有 ${left} 個人在打，點左鍵換人看`, 3200, 'lose');
      this.spec = e.reason === 'kill' && e.by !== this.me ? e.by : -1;
    }
  }
  _ffaRoundEnd(gs) {
    const r = gs.res || {}, me = this.me, my = gs.p[me], inc = r.inc ? `　·　獲得 $${r.inc[me]}` : '';
    this.stats.round(this.mode(), { win: r.winner === me, kill: (my.rk || 0) > 0, died: !my.al, head: false, wb: false, weapon: r.w, shots: this.combat.shots - this.rs0, hits: this.combat.hits - this.rh0, dmg: my.rdm });
    if (gs.round === 1 || !this.roundLog) this.roundLog = [];
    this.roundLog[gs.round - 1] = { w: r.winner === -1 ? -1 : r.winner === me ? 0 : 1, who: r.winner, how: r.reason === 'time' ? 'time' : 'kill' };
    const mine = `你擊倒 ${my.rk || 0} 人、傷害 ${my.rdm || 0}`;
    if (r.winner === me) { this.hud.banner('你活到最後！', mine + inc, 0, 'win'); this.sfx.win(); }
    else if (r.winner >= 0 && gs.p[r.winner]) { this.hud.banner(`${gs.p[r.winner].n} 拿下這一局`, (r.reason === 'time' ? '時間到，血最多的人贏　·　' : '') + mine + inc, 0, 'lose'); this.sfx.lose(); }
    else { this.hud.banner('沒有人活下來', mine + inc, 0, 'draw'); }
    this.stormFx(false);
  }
  // 圈外的畫面：一層紫色
  stormFx(on) { if (this.stormOn !== on) { this.stormOn = on; this.hud.stormFx(on); } }
  // 死了以後看誰：活著的人輪流（左鍵換下一個）
  _specNext() {
    const live = this.others().filter(([, r]) => r.alive).map(([sl]) => sl);
    if (!live.length) { this.spec = -1; return; }
    const i = live.indexOf(this.spec);
    this.spec = live[(i + 1) % live.length];
  }

  _endKillcam() {
    this.kcAt = 0;
    if (!this.kc) return;
    this.kc = false; this.replay.stop(); this.ghost.group.visible = false; this.hud.killcam(false);
    if (this.combat.w) this.view.setWeapon(this.combat.w.id, this.look());
    if (this.gs) { const opp = this.gs.p[this.oppI()]; this.remote.group.visible = this.inRound() && (opp.al || !!this.remote.dead); }
  }

  onEv(e) {
    if (e.t === 'hurt') {
      if (!e.self) this.skills.breakStop();                              // 被時間暫停時挨打 → 馬上恢復
      this.sfx.hurt(); this.shake = Math.min(1.2, this.shake + 0.35);
      this.hud.hurt();
      // 被槍或刀打中：記下對手當時的位置，畫面上會有一段紅色弧線指著那個方向（轉頭時它會跟著轉）。
      // 爆炸和火不指方向（傷害不是從對手站的地方來的）
      const wd = WEAPONS[e.w];
      if (Array.isArray(e.src) && e.src.every(Number.isFinite)) this.hurtSrc = { x: e.src[0], z: e.src[1], t: performance.now() };   // 機器人打的：指向開槍的那一隻
      else if (!e.self && wd && !wd.proj) { const r = this.ffa() ? this.foe(e.by) : this.remote; if (r) this.hurtSrc = { x: r.pos.x, z: r.pos.z, t: performance.now() }; }
    } else if (e.t === 'pick' && e.by === this.me) this.sfx.pickup();
    else if (e.t === 'mkill' && this.gs && MOBS[e.kind]) {             // 有人打倒一隻機器人
      const mine = e.by === this.me;
      this.hud.killfeed({ killer: this.gs.p[e.by] ? this.gs.p[e.by].n : '', victim: MOBS[e.kind].name, w: e.w, head: e.head, mine });
      if (mine) { this.sfx.kill(); this.hud.killMark(e.head); }
    } else if (e.t === 'hkill' && this.gs) {                            // 有玩家倒下（被機器人、或自己炸到自己）
      const v = this.gs.p[e.victim]; if (!v) return;
      this.hud.killfeed({ killer: e.reason === 'suicide' ? null : MOBS[e.mob] ? MOBS[e.mob].name : '機器人', victim: v.n, w: e.w, head: e.head, mine: false });
    } else if (e.t === 'wave') this._hzWave(e);
    else if (e.t === 'core') this.horde.coreHit();
    else if (e.t === 'phoenix') this.skills.phoenix(e.who);
    else if (e.t === 'medkit') this.skills.medkit(e.who);
    else if (e.t === 'recall') this.skills.recall(e.who);
    else if (e.t === 'respawn') this.respawn();
    else if (e.t === 'fkill' && this.gs) this._ffaKill(e);
    else if (e.t === 'wkill' && this.gs) {
      const g = this.gs, mine = e.victim !== this.me;
      const by = this.ffa() && g.p[e.by] ? e.by : 1 - e.victim;
      this.hud.killfeed({ killer: e.reason === 'suicide' ? null : g.p[by].n, victim: g.p[e.victim].n, w: e.w, head: e.head, wb: e.wb, bk: e.bk, mine: this.ffa() ? e.by === this.me : mine });
      if (mine && e.reason === 'kill') { this.sfx.kill(); this.hud.killMark(e.head); } else if (!mine) this.sfx.lose();
    }
  }

  // 守據點：一波開始／打完
  _hzWave(e) {
    const h = this.hud, n = e.n | 0, gs = this.gs;
    if (e.st === 'wave') {
      if (this.buyOpen) this.closeBuy();
      const dirs = this.hud.gateText(gs && gs.hz);
      h.banner(`第 ${n} 波`, (n % 5 === 0 ? '巨人來了！　' : '') + (dirs ? `敵人從${dirs}來` : ''), 2400); this.sfx.roundStart();
    } else {
      h.banner('擋下來了！', `第 ${n} 波清光　休息 ${HORDE.BREAK} 秒：選強化卡、換裝備（${h.key('buy')}）、蓋沙包牆（${h.key('skill1')}）`, 3600); this.sfx.win();
      this.skills.refill(0, HORDE.WALLS);
      if (this.meAlive()) this.combat.setLoadout(this.hsel, gs ? gs.p[this.me].bf : []);   // 彈藥、投擲物補滿
      setTimeout(() => { const me = this.gs && this.gs.p[this.me]; if (this.phase === 'horde' && me && me.ch && me.al) this.openBuy(); }, 900);
    }
  }

  // ───────── 對手的動作 ─────────
  panOf(x, z) {
    const c = this.camera.position, dx = x - c.x, dz = z - c.z, l = Math.hypot(dx, dz) || 1, yaw = this.player.yaw;
    return clamp(((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / l) * 0.8, -1, 1);
  }

  onRemoteFire(d, from) {
    if (!d || !this.inRound()) return;
    const vec3 = (a) => Array.isArray(a) && a.length === 3 && a.every((v) => Number.isFinite(v) && Math.abs(v) < 500);
    if (d.v !== undefined && (!vec3(d.v) || !vec3(d.o) || this.combat.projectiles.length > 40)) return;
    if (d.e !== undefined && (!Array.isArray(d.e) || d.e.length > 90 || !d.e.every((v) => Number.isFinite(v)))) return;
    if (d.e2 !== undefined && (!Array.isArray(d.e2) || d.e2.length > 180 || !d.e2.every((v) => Number.isFinite(v)))) return;
    const R = this.foe(from) || this.remote, rp = R.pos, dist = rp.distanceTo(this.camera.position), now = performance.now();
    if (d.w === 'knife') { if (R.meleeAnim) R.meleeAnim(); if (dist < 12) this.sfx.knifeSwing(); return; }
    const def = WEAPONS[d.w];
    if (!def) {                                          // 投擲物
      if (d.v) { this.combat.spawnProjectile(d.w, d.pid, d.o, d.v, false); if (R.throwAnim) R.throwAnim(); }
      return;
    }
    this.sfx.shot(def.snd, Math.max(1, dist), this.panOf(rp.x, rp.z));
    if (!this.oppHas('ghost') && !this.coop()) this.mini.ping(now, rp.x, rp.z, this.ffa() ? from : undefined);   // 開槍會在小地圖上暴露位置（對手有「無聲步」就不會；隊友不算）
    this.replay.event(now + NET.INTERP_MS, 'fire', { w: d.w, e: d.e });
    if (R.fireKick) R.fireKick();
    if (d.v) { this.combat.spawnProjectile(d.w, d.pid, d.o, d.v, false); return; }
    if (!Array.isArray(d.e)) return;
    const m = R.muzzle(_v1);
    this.fx.muzzle(m.x, m.y, m.z);
    let near = false;
    const c = this.camera.position;
    for (let i = 0; i + 2 < d.e.length; i += 3) {
      this.fx.tracer(m, _v2.set(d.e[i], d.e[i + 1], d.e[i + 2]), 0xffc9a0);
      // 子彈從耳邊擦過：算鏡頭到這條彈道的距離
      const ax = _v2.x - m.x, ay = _v2.y - m.y, az = _v2.z - m.z, l2 = ax * ax + ay * ay + az * az || 1;
      const t = clamp(((c.x - m.x) * ax + (c.y - m.y) * ay + (c.z - m.z) * az) / l2, 0, 1);
      if (t > 0.05 && Math.hypot(m.x + ax * t - c.x, m.y + ay * t - c.y, m.z + az * t - c.z) < 1.3) near = true;
    }
    if (near && this.meAlive()) this.sfx.whiz(this.panOf(rp.x, rp.z));
    // 跳彈反彈之後的那一段
    if (d.e2) for (let i = 0; i + 5 < d.e2.length; i += 6) this.fx.tracer(_v1.set(d.e2[i], d.e2[i + 1], d.e2[i + 2]), _v2.set(d.e2[i + 3], d.e2[i + 4], d.e2[i + 5]), 0x9fe8ff);
  }

  onRemoteBlk(d) {
    if (!d || d.r !== this.round || !Array.isArray(d.h)) return;
    let broke = null;
    for (let i = 0, n = Math.min(d.h.length, 1600); i + 1 < n; i += 2) {
      const ci = d.h[i], dmg = d.h[i + 1];
      if (!Number.isInteger(ci) || !(dmg > 0)) continue;       // 壞掉的數字不處理（NaN 會讓方塊永遠打不壞）
      const res = this.world.damageIdx(ci, Math.min(dmg, 5000));
      if (!res) continue;
      if (res.destroyed) { this.fx.debris(res.x, res.y, res.z, res.type); broke = res; }
      else this.fx.impact((res.x + 0.5) * BS, (res.y + 0.5) * BS, (res.z + 0.5) * BS, 0, 0.4, 0, res.type, 2);
    }
    if (broke) this.sfx.blockBreak(_v1.set((broke.x + 0.5) * BS, (broke.y + 0.5) * BS, (broke.z + 0.5) * BS).distanceTo(this.camera.position));
  }

  // 爆炸：改地形 + 特效 + 把本機玩家炸飛（傷害由開槍方另外回報）
  doExplosion(m) {
    const [x, y, z] = m.p;
    if (m.kind === 'flash') { this.doFlash(x, y, z, m); return; }
    const dist = _v1.set(x, y, z).distanceTo(this.camera.position), pan = this.panOf(x, z);
    if (m.kind === 'smoke') {
      const r = m.cloud || 3;
      this.fx.smokeCloud(x, y, z, r, (m.dur || 12) * 1000, m.pid);
      this.combat.quench(x, y + r * 0.45, z, r);          // 煙會把火悶熄
      this.sfx.hiss(dist, pan);
      return;
    }
    if (m.kind === 'molotov') {
      const r = m.cloud || 2.6, dur = m.dur || 7;
      this.sfx.molotov(dist, pan);
      if (this.fx.smokeBlocked(x, y + 0.3, z, x, y + 0.31, z)) { this.fx.smoke(x, y, z, 5, 0.3); return; }   // 丟進煙裡：燒不起來
      this.fx.fire(x, y, z, r, dur * 1000, m.pid);
      this.combat.addFire({ x, y, z, r, dur, pid: m.pid, mine: m.own === this.me });
      return;
    }
    const destroyed = this.world.explode(x, y, z, m.br, m.bp);
    const step = Math.max(1, Math.floor(destroyed.length / 45));
    for (let i = 0; i < destroyed.length; i += step) { const d = destroyed[i]; this.fx.debris(d.x, d.y, d.z, d.type, 3, 1.5); }
    if (m.kind === 'dig') return;                           // 只挖地形（黑洞啃方塊、軌道砲往下鑽）：沒有爆炸特效，也不會把人炸飛
    if (m.fxk === 'mini') {                                  // 爆裂彈：一小團火光
      const f = this.fx, rn = () => Math.random() - 0.5;
      f.glowP.spawn(x, y, z, 0, 0, 0, 0.9, 0.2, 0.12, 8, 4.5, 1.2, 1);
      for (let i = 0; i < 5; i++) f.glowP.spawn(x, y, z, rn() * 9, rn() * 7 + 2, rn() * 9, 0.07, 0.02, 0.22 + Math.random() * 0.15, 10, 6, 2, 1, 14);
      f.smoke(x, y, z, 1, 0.2);
      const now = performance.now();
      if (now - this.miniSndAt > 90) { this.miniSndAt = now; this.sfx.explosion(dist + 7, pan, 0.4); }
      return;
    }
    const shock = m.fxk === 'shock';
    if (shock) {                                            // 震地衝擊波：貼地往外擴的藍白光圈 + 一圈灰
      this.skills.nova(x, y - 0.95, z, 0xa8dcff, m.rad, 0.45);
      this.fx.light(x, y, z, 0x9fd0ff, 140, 0.3, 22);
      for (let i = 0; i < 22; i++) { const a = (i / 22) * 6.283, s = 0.5 + Math.random() * 0.15; this.fx.dust.spawn(x, y - 0.75, z, Math.cos(a) * 9, 0.5, Math.sin(a) * 9, 0.45, 1.7, 0.7 + Math.random() * 0.4, s, s, s * 1.05, 0.5, 0, 2.6); }
    } else this.fx.explosion(x, y, z, m.rad);
    this.sfx.explosion(dist, pan, m.fxk === 'orbital' ? 2.6 : m.rad / 4.5);
    this.shake = Math.min(1.5, this.shake + Math.max(0, 1.2 - dist / 14));
    this.horde.kick(x, y, z, m.rad, m.k);                   // 機器人也會被炸飛（房主那邊算）
    if (this.inRound() && this.meAlive() && !(shock && m.own === this.me)) {   // 自己放的衝擊波不會震到自己
      const p = this.player, dx = p.pos.x - x, dy = p.pos.y + 0.9 - y, dz = p.pos.z - z, d = Math.hypot(dx, dy, dz);
      if (d < m.rad && d > 0.01) {
        const f = 1 - d / m.rad, k = (f * m.k) / d;
        p.vel.x += dx * k; p.vel.y += dy * k + 2 * f; p.vel.z += dz * k; p.onGround = false;
      }
    }
  }

  // 閃光彈：有看到它（沒被牆或煙擋住）才會被閃；正對著看最慘，背對只白一下
  // m.fk：閃光強度倍率（閃光大師）；m.ns：丟的人自己不會被閃到
  doFlash(x, y, z, m = {}) {
    const cam = this.camera, c = cam.position, fk = m.fk || 1, immune = m.ns && m.own === this.me;
    let dx = x - c.x, dy = y - c.y, dz = z - c.z;
    const dist = Math.hypot(dx, dy, dz) || 0.01;
    dx /= dist; dy /= dist; dz /= dist;
    this.fx.flashBurst(x, y, z);
    let dur = 0;
    if (this.inRound() && this.meAlive() && dist < 50 * fk && !this.kc && !immune) {
      const blocked = (dist > 0.8 && !!this.world.raycast(c.x, c.y, c.z, dx, dy, dz, dist - 0.5)) || this.fx.smokeBlocked(c.x, c.y, c.z, x, y, z);
      if (!blocked) {
        const e = cam.matrixWorld.elements, dot = -(e[8] * dx + e[9] * dy + e[10] * dz);
        const k = (dot > 0.3 ? 1 : dot > -0.35 ? 0.55 : 0.2) * clamp(1.2 - dist / (36 * fk), 0.2, 1);
        dur = (0.4 + 3 * k) * fk;
        this.hud.flash(Math.min(1, 0.4 + k), dur);
        this.sendPeer('blind', { d: +dur.toFixed(1) });
      }
    }
    this.sfx.flashbang(dist, this.panOf(x, z), dur);
    if (this.bot) this.bot.onFlash(x, y, z, fk);
    this.horde.onFlash(x, y, z, fk);
  }

  // ───────── 噴漆、表情動作 ─────────
  doSpray() {
    const now = performance.now();
    if (now < this.sprayAt || this.kc) return;
    const e = this.camera.matrixWorld.elements, ox = e[12], oy = e[13], oz = e[14], fx = -e[8], fy = -e[9], fz = -e[10];
    const h = this.world.raycast(ox, oy, oz, fx, fy, fz, 3.4);
    if (!h || h.oob || h.dist <= 0) return;
    this.sprayAt = now + 2200;
    const p = [r3(ox + fx * h.dist), r3(oy + fy * h.dist), r3(oz + fz * h.dist)], n = [h.nx, h.ny, h.nz], c = this.world.idx(h.x, h.y, h.z), id = this.settings.spray;
    this.fx.spray(sprayTex(id), p[0], p[1], p[2], n[0], n[1], n[2], this.player.yaw, c);
    this.sendPeer('spray', { r: this.round, id, p, n, y: r3(this.player.yaw), c });
    this.sfx.spray();
  }
  doEmote() {
    if (this.emote || this.kc || !this.meAlive()) return;
    const id = this.settings.emote, def = EMOTES[id]; if (!def) return;
    const g = this.ghost;
    g.applySkin(this.settings.skin, TEAM[this.me]); g.setWeapon(this.combat.w ? this.combat.w.id : 'pistol', this.look()); g._lit();
    if (g.revive) g.revive();
    if (g.emote) g.emote(id);
    this.emote = { id, end: performance.now() + (def.dur || 2.5) * 1000 };
    this.sendPeer('emote', { id }); this.sfx.emote();
  }

  // ───────── 地圖編輯器 ─────────
  openEditor(src, opts) {
    if (this.net.connected || this.authority) this.leave();
    this.sfx.init();
    this.phase = 'editor'; this.editor.open(src, opts);
    this.hud.showHud(false); this.hud.show('editor'); this.hud.editorState();
  }
  closeEditor() { this.editor.close(); this.exitLock(); this.phase = 'menu'; this.setMap('plaza'); this.hud.show('menu'); this.hud.refreshMaps(); }
  async editorSave(test) {
    const ed = this.editor, bad = ed.problem();
    if (bad) { this.hud.toast(bad); this.sfx.deny(); return null; }
    try {
      const r = await ed.save();
      this.hud.refreshMaps(); this.hud.editorState();
      if (test) { ed.close(); this.exitLock(); this.phase = 'menu'; this.practice(r.id); }
      else this.hud.toast('已儲存，可以在「地圖」選單裡選它');
      return r;
    } catch (e) { this.hud.toast('儲存失敗：' + (e.message || e)); return null; }
  }
  _editorCycle(d) { const ed = this.editor, i = PALETTE.indexOf(ed.type); ed.type = PALETTE[(i + d + PALETTE.length) % PALETTE.length]; this.hud.editorState(); }
  _editorKey(code, shift) {
    const ed = this.editor;
    if (code.startsWith('Digit')) { const n = +code.slice(5); if (n >= 1 && n <= 9 && PALETTE[n - 1]) ed.type = PALETTE[n - 1]; }
    else if (code === 'BracketRight') this._editorCycle(1); else if (code === 'BracketLeft') this._editorCycle(-1);
    else if (code === 'Minus') ed.brush = Math.max(1, ed.brush - 1); else if (code === 'Equal') ed.brush = Math.min(4, ed.brush + 1);
    else if (code === 'KeyB') ed.boxTool(shift); else if (code === 'Escape') ed.boxA = null;
    else if (code === 'KeyM') ed.sym = SYM[(SYM.findIndex((s) => s[0] === ed.sym) + 1) % SYM.length][0];
    else if (code === 'KeyP') ed.setSpawn(); else if (code === 'KeyH') ed.addPickup('hp', 40); else if (code === 'KeyJ') ed.addPickup('hp', 25); else if (code === 'KeyK') ed.addPickup('armor', 50);
    else if (code === 'Backspace' || code === 'Delete') ed.removePickup();
    else if (code === 'KeyZ') ed.undoLast(); else if (code === 'KeyQ') ed.pick(); else if (code === 'KeyE') ed.paint(false); else if (code === 'KeyF') ed.paint(true);
    else return;
    this.hud.editorState();
  }

  // 腳下踩的是什麼材質（腳步聲用）
  surfaceAt(x, y, z) { const t = this.world.get(Math.floor(x / BS), Math.floor((y - 0.05) / BS), Math.floor(z / BS)); return t && BLOCK[t] ? BLOCK[t].surf : 'concrete'; }

  // ───────── 主迴圈 ─────────
  loop() {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);   // 掉到 10fps 以內都還是照真實時間跑，不會變慢動作
    this.last = now;
    const gs = this.gs, inRound = this.inRound(), cam = this.camera, p = this.player, cb = this.combat;
    const meS = gs ? gs.p[this.me] : null, alive = !!(meS && meS.al);
    let showView = false;

    if (inRound) {
      const act = this.active();
      const live = this.phase === 'playing' || this.phase === 'warmup' || this.phase === 'horde';
      const canMove = act && alive && this.phase !== 'countdown';
      const w = cb.w;
      const adsKey = this.mouse.r || this.held('ads');   // 右鍵，或你綁的瞄準鍵（預設左 Shift）
      if (alive) {
        const mf = canMove ? (this.held('fwd') ? 1 : 0) - (this.held('back') ? 1 : 0) : 0, mr = canMove ? (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0) : 0;
        if (this.emote && (mf || mr || this.mouse.l || now >= this.emote.end)) { this.emote = null; this.ghost.group.visible = false; }   // 一動就取消
        this.skills.pre(dt, now);                              // 鉤索、黑洞會改速度，要排在物理之前
        p.update(dt, { f: mf, r: mr, jump: canMove && this.held('jump') && !this.skills.frozen(), crouch: canMove && this.held('crouch'), speed: (w ? w.def.move : 1) * cb.mods.speed * lerp(1, 0.6, cb.ads) * this.skills.speedMul(meS), grav: cb.mods.grav });
        const surf = this.surfaceAt(p.pos.x, p.pos.y, p.pos.z);
        if (p.justJumped) this.sfx.jump();
        if (p.justLanded) { this.sfx.land(surf); this.landDip = Math.min(0.24, p.landSpeed * 0.02); if (p.landSpeed > 7) this.fx.smoke(p.pos.x, p.pos.y + 0.05, p.pos.z, 2, 0.12); }
        // 跑步才有腳步聲；瞄準走、蹲走是安靜的（對手也聽不到）
        if (p.walkPhase - this.stepPhase > Math.PI) { this.stepPhase = p.walkPhase; if (!p.crouched && p.speed2d() > PLAYER.STEP_SOUND_SPEED) this.sfx.step(surf); }
      } else this.deathT = Math.min(1, this.deathT + dt * 2.2);

      // 被擊倒後過一下 → 開始擊殺回放
      if (this.kcAt && now >= this.kcAt) {
        this.kcAt = 0;
        if (this.phase === 'roundEnd' && this.replay.play(this.kcDeath - 3600, this.kcDeath + 250, now)) {
          this.kc = true; this.hud.killcam(true, gs.p[this.oppI()].n);
          const g = this.ghost; g.applySkin(this.settings.skin, TEAM[this.me]); g.setWeapon(cb.w ? cb.w.id : 'pistol', this.look()); g._lit(); if (g.revive) g.revive();
        }
      }
      this.shake = Math.max(0, this.shake - dt * 3.5);
      const sh = this.shake * this.shake * 0.02;
      let frame = null;
      if (this.kc) {
        frame = this.replay.sample(now, (ev) => {
          if (ev.type !== 'fire') return;
          const def = WEAPONS[ev.data.w]; if (!def) return;
          this.view.fire(def.pellets > 1 || def.dmg >= 50); this.sfx.shot(def.snd);
          if (!Array.isArray(ev.data.e)) return;
          const e = cam.matrixWorld.elements;
          _v1.set(e[12] + e[0] * 0.13 - e[4] * 0.1 - e[8] * 0.75, e[13] + e[1] * 0.13 - e[5] * 0.1 - e[9] * 0.75, e[14] + e[2] * 0.13 - e[6] * 0.1 - e[10] * 0.75);
          for (let i = 0; i + 2 < ev.data.e.length; i += 3) this.fx.tracer(_v1, _v2.set(ev.data.e[i], ev.data.e[i + 1], ev.data.e[i + 2]));
        });
        if (!frame) this._endKillcam();
      }
      if (frame) {
        // 擊殺回放：鏡頭放在對手的眼睛，畫面上的「我」是分身
        const vf = vfovOf(this.settings.afov); if (Math.abs(cam.fov - vf) > 0.01) { cam.fov = vf; cam.updateProjectionMatrix(); }
        cam.position.set(frame.kx, frame.ky + lerp(PLAYER.EYE, PLAYER.CROUCH_EYE, frame.kcr), frame.kz);
        cam.rotation.set(clamp(frame.kp, -1.55, 1.55), frame.kyaw, 0);
        const g = this.ghost;
        g.pos.set(frame.vx, frame.vy, frame.vz); g.yaw = frame.vyaw; g.crouched = !!frame.vcr; g.alive = true; g.group.visible = true; g.update(dt);
        this.remote.group.visible = false;
        if (WEAPONS[frame.kw]) this.view.setWeapon(frame.kw, this.remote.wskin);   // 同一把會直接略過
        this.hud.killcamTime(frame.left);
        showView = true;
      } else if (this.ffa() && !alive && this.phase === 'playing' && (this.spec >= 0 || this._specNext() || this.spec >= 0) && this.foe(this.spec) && this.foe(this.spec).alive) {
        // 混戰觀戰：鏡頭在那個人背後上方一點；左鍵換下一個
        if (this.mouse.lp) { this.mouse.lp = false; this._specNext(); }
        const r = this.foe(this.spec), ex = r.pos.x, ey = r.pos.y + 1.55, ez = r.pos.z;
        const bx = Math.sin(r.yaw) * Math.cos(0.3), by = Math.sin(0.3), bz = Math.cos(r.yaw) * Math.cos(0.3);
        const hit = this.world.raycast(ex, ey, ez, bx, by, bz, 3.6), d = Math.max(0.6, (hit ? hit.dist : 3.6) - 0.3);
        const vf = vfovOf(this.settings.afov); if (Math.abs(cam.fov - vf) > 0.01) { cam.fov = vf; cam.updateProjectionMatrix(); }
        cam.position.set(ex + bx * d, ey + by * d, ez + bz * d); cam.lookAt(ex - Math.sin(r.yaw) * 4, ey - 0.2, ez - Math.cos(r.yaw) * 4);
      } else if (this.emote && alive) {
        // 表情動作：鏡頭拉到背後看自己
        const g = this.ghost, ex = p.rpos.x, ey = p.rpos.y + 1.45, ez = p.rpos.z;
        g.pos.copy(p.rpos); g.yaw = p.yaw; g.crouched = false; g.alive = true; g.group.visible = true; g.update(dt);
        const bx = Math.sin(p.yaw) * Math.cos(0.25), by = Math.sin(0.25), bz = Math.cos(p.yaw) * Math.cos(0.25);
        const hit = this.world.raycast(ex, ey, ez, bx, by, bz, 3.4), d = Math.max(0.6, (hit ? hit.dist : 3.4) - 0.3);
        if (Math.abs(cam.fov - 70) > 0.01) { cam.fov = 70; cam.updateProjectionMatrix(); }
        cam.position.set(ex + bx * d, ey + by * d, ez + bz * d); cam.lookAt(ex, ey - 0.25, ez);
      } else {
        const zoom = this.zoom();
        const fov = 2 * Math.atan(Math.tan((vfovOf(this.settings.afov) * DEG) / 2) / zoom) / DEG;
        if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
        // 鏡頭小動作：落地下沉、橫移時微微傾斜
        this.landDip *= Math.exp(-9 * dt);
        const side = clamp((p.vel.x * Math.cos(p.yaw) - p.vel.z * Math.sin(p.yaw)) / PLAYER.SPEED, -1, 1);
        this.roll += (side * 0.013 - this.roll) * Math.min(1, dt * 8);
        cam.position.set(p.rpos.x, p.eyeY() - this.deathT * 1.15 - this.landDip, p.rpos.z);
        cam.rotation.set(
          clamp(p.pitch + cb.recP, -1.55, 1.55) + (Math.random() - 0.5) * sh,
          p.yaw + cb.recY + (Math.random() - 0.5) * sh,
          this.deathT * 0.6 - this.roll + (Math.random() - 0.5) * sh,
        );
        showView = alive;
      }
      cam.updateMatrixWorld();
      this.skills.update(dt, now);
      this.pets.update(dt, now);

      const canFire = act && alive && live && !this.emote && !this.kc && !this.skills.noFire();
      cb.update(dt, { fire: this.mouse.l, firePressed: this.mouse.lp, ads: adsKey, reload: this.reloadPressed }, canFire);
      cb.updateProjectiles(dt);
      this.mouse.lp = false; this.reloadPressed = false;

      // 補給品：走過去就向裁判申請
      if (alive && live && gs) {
        for (let i = 0; i < this.pickDefs.length; i++) {
          const pk = this.pickDefs[i];
          if (!gs.pk[i] || now < this.pickAt[i]) continue;
          if (Math.hypot(p.pos.x - pk.x, p.pos.z - pk.z) < 0.95 && Math.abs(p.pos.y - pk.y) < 1.6) {
            if (pk.type === 'hp' ? meS.hp < meS.mhp : meS.ar < 50) { this.pickAt[i] = now + 400; this.auth('pick', { i }); }
          }
        }
      }

      this.sendAcc += dt;
      if (this.sendAcc >= 1 / NET.SEND_HZ) {
        this.sendAcc = 0;
        this.sendPeer('st', [r3(p.pos.x), r3(p.pos.y), r3(p.pos.z), r3(p.yaw), r3(p.pitch + cb.recP), w ? w.id : 'ar', (p.crouched ? 1 : 0) | (p.onGround ? 2 : 0)]);
      }

      if (this.phase === 'countdown') {
        const n = Math.ceil((this.phaseEnd - now) / 1000);
        if (n !== this.lastCount && n > 0) { this.lastCount = n; this.hud.banner(String(n), `第 ${gs.round} 局`, 0); this.sfx.beep(false); }
      }

      // 槍有沒有曬到太陽（在陰影裡、室內會變暗）
      if (showView && !this.kc) {
        const s = this.env.sunDir, e = cam.position;
        this.lit += ((this.world.raycast(e.x, e.y, e.z, s.x, s.y, s.z, 70) ? 0 : 1) - this.lit) * Math.min(1, dt * 7);
      }
      this.view.update(dt, {
        ads: this.kc ? 0 : cb.ads, walkPhase: p.walkPhase, moving: this.kc ? 0.5 : p.onGround ? Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 5) : 0,
        reload: this.kc ? 0 : cb.reloadProgress(), draw: this.kc ? 1 : cb.drawProgress(), dx: this.mouse.dx, dy: this.mouse.dy, scoped: !this.kc && !!(w && w.def.scope),
        dip: this.landDip, vy: p.onGround ? 0 : p.vel.y, crouch: p.crouched, lit: this.lit, sky: this.world.light.at3(cam.position.x, cam.position.y, cam.position.z), camQuat: cam.quaternion,
      });
      this.mouse.dx = this.mouse.dy = 0;

      // 記錄給擊殺回放用；順便看對手有沒有在視線內（小地圖）
      if (live && alive && !this.coop() && !this.ffa() && this.remote.alive) this.replay.rec(now, this.remote, p);
      if (live && alive && !this.coop() && now >= this.spotAt) {
        this.spotAt = now + 120;
        const e = cam.matrixWorld.elements, c = cam.position, ffa = this.ffa();
        for (const [sl, r] of this.others()) {
          if (!r.alive) continue;
          const rp = r.pos;
          let dx = rp.x - c.x, dy = rp.y + 1.1 - c.y, dz = rp.z - c.z; const d = Math.hypot(dx, dy, dz) || 1; dx /= d; dy /= d; dz /= d;
          if (d < 80 && -(e[8] * dx + e[9] * dy + e[10] * dz) > 0.45 && !this.world.raycast(c.x, c.y, c.z, dx, dy, dz, d) && !this.fx.smokeBlocked(c.x, c.y, c.z, rp.x, rp.y + 1.1, rp.z) && (ffa || !this.skills.oppCloaked())) this.mini.spot(now, rp.x, rp.z, ffa ? sl : undefined);
        }
      }
      // 混戰的毒圈：活著、在圈外 → 每半秒跟裁判說一次（扣多少血裁判算）；畫面蒙一層紫
      if (this.ffa() && this.storm && live) {
        const out = alive && Math.hypot(p.pos.x - this.storm.x, p.pos.z - this.storm.z) > this.stormR(now);
        this.stormFx(out);
        if (out && now - this.stormAt > 500) { this.stormAt = now; this.auth('storm', { r: this.round }); }
      } else this.stormFx(false);
      // 受傷方向指示：1.6 秒內慢慢淡掉，角度每一幀照目前的視角重算
      if (this.hurtSrc) {
        const h = this.hurtSrc, age = now - h.t;
        if (age > 1600 || !alive || this.kc) { this.hurtSrc = null; this.hud.hurtDir(0, 0); }
        else {
          const dx = h.x - p.pos.x, dz = h.z - p.pos.z, s = Math.sin(p.yaw), c = Math.cos(p.yaw), k = age / 1600;
          this.hud.hurtDir(Math.atan2(dx * c - dz * s, -dx * s - dz * c), 1 - k * k * k);
        }
      }
      // 火焰的聲音：離最近的一團火越近越大聲
      let fg = 0, fpan = 0;
      for (const f of cb.fires) { const d = Math.hypot(f.x - cam.position.x, f.y - cam.position.y, f.z - cam.position.z), g = Math.max(0, 1 - d / 18); if (g > fg) { fg = g; fpan = this.panOf(f.x, f.z); } }
      this.sfx.loop('fire', 'fire', fg * 0.8, fpan);
      this.voice.setHeld(this.held('talk'));
    } else if (this.phase === 'editor') {
      const on = this.locked || NOLOCK;
      if (Math.abs(cam.fov - 75) > 0.01) { cam.fov = 75; cam.updateProjectionMatrix(); }
      this.editor.update(dt, {
        f: on ? (this.held('fwd') ? 1 : 0) - (this.held('back') ? 1 : 0) : 0, r: on ? (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0) : 0,
        up: on ? (this.keys.Space ? 1 : 0) - (this.keys.KeyC || this.keys.ControlLeft ? 1 : 0) : 0, fast: !!this.keys.ShiftLeft, place: on && this.mouse.l, remove: on && this.mouse.r,
      }, cam, now);
    } else if (this.lockerOpen) {
      // 造型預覽：假人在右邊慢慢左右轉
      const d = this.doll;
      d.yaw = Math.PI + Math.sin(now * 0.0007) * 1.2; d.update(dt);   // 面向鏡頭（也面向太陽，才不會背光）
      if (Math.abs(cam.fov - 38) > 0.01) { cam.fov = 38; cam.updateProjectionMatrix(); }
      cam.position.set(d.pos.x - 0.9, d.pos.y + 1.25, d.pos.z + 4.1);
      cam.lookAt(d.pos.x - 0.9, d.pos.y + 0.95, d.pos.z);
    } else {
      // 選單背景：鏡頭繞著地圖轉（debugCam 是截圖、測試用的固定鏡位）
      this.orbit += dt * 0.07;
      const dc = this.debugCam, f = dc ? dc.fov || 75 : 60;
      if (Math.abs(cam.fov - f) > 0.01) { cam.fov = f; cam.updateProjectionMatrix(); }
      if (dc) { cam.position.set(dc.p[0], dc.p[1], dc.p[2]); cam.lookAt(dc.l[0], dc.l[1], dc.l[2]); }
      else { const gy = MAPS[this.world.mapId] ? MAPS[this.world.mapId].ground || 0 : 0, hc = (this.world.X * BS) / 2, rr = hc * 1.67; cam.position.set(hc + Math.cos(this.orbit) * rr, gy + 22 * (hc / 24), hc + Math.sin(this.orbit) * rr); cam.lookAt(hc, gy + 2, hc); }
    }

    if (this.bot) this.bot.update(dt, now);
    this.horde.update(dt, now);
    if (!this.kc) { if (this.ffa()) { for (const r of this.foes.values()) if (r.group.visible) r.update(dt); } else this.remote.update(dt); }
    // 對手的腳步聲與落地聲（對手跑步、跳下來時聽得到位置）
    if (inRound && !this.kc) for (const [, rm] of this.others()) {
      if (!rm.alive) continue;
      if (rm.grounded && !rm.crouched && rm.speed > PLAYER.STEP_SOUND_SPEED && !this.oppHas('ghost')) {
        rm._step = (rm._step || 0) + rm.speed * dt;
        if (rm._step > 2.3) { rm._step = 0; this.sfx.stepRemote(rm.pos.distanceTo(cam.position), this.panOf(rm.pos.x, rm.pos.z), this.surfaceAt(rm.pos.x, rm.pos.y, rm.pos.z)); }
      }
      if (rm.justLanded) this.sfx.landRemote(rm.pos.distanceTo(cam.position), this.panOf(rm.pos.x, rm.pos.z), this.surfaceAt(rm.pos.x, rm.pos.y, rm.pos.z));
    }
    this.stormWall(now);
    this.fx.update(dt, cam, this.viewH || innerHeight, this.fxLight);
    this.world.update();
    const t = now * 0.001;
    for (const m of this.pickMeshes) { if (m.visible) { m.rotation.y = t * 1.6; m.children[0].position.y = Math.sin(t * 2.4) * 0.08; if (m.children[1] && m.children[1].geometry.type === 'BoxGeometry') m.children[1].position.y = m.children[0].position.y; } }

    this.fpsN++; this.fpsAcc += dt;
    if (this.fpsAcc >= 0.5) { this.fpsV = Math.round(this.fpsN / this.fpsAcc); this.fpsN = 0; this.fpsAcc = 0; }
    if (gs && (inRound || this.phase === 'loadout')) {
      const w = cb.w, scoped = !!(w && w.def.scope && cb.ads > 0.8) && !this.kc;
      this.hud.frame({
        phase: this.phase, tLeft: this.phaseEnd - now, hp: meS.hp, mhp: meS.mhp, armor: meS.ar, buffs: meS.bf, alive,
        w, slot: cb.cur, slots: cb.slots, other: cb.slots[cb.last], reload: cb.reloadProgress(), scoped, third: !!this.emote || this.kc,
        gap: (Math.tan(cb.spread() * DEG) / Math.tan((cam.fov * DEG) / 2)) * (innerHeight / 2),
        net: (this.net.mode === 'bot' || this.warmBot ? '練習模式' : !this.net.connected ? '單人' : `延遲 ${this.net.ping} ms`) + (this.settings.fps ? `　${this.fpsV} FPS` : ''),
        spd: alive ? p.speed2d() : 0, crouch: p.crouched, nades: cb.nades, money: meS.$, sk: this.skills.hudState(now),
        storm: this.ffa() && this.storm && this.phase === 'playing' ? { wait: Math.max(0, this.storm.a - now), left: Math.max(0, this.storm.b - now), out: !!this.stormOn } : null,
        spec: this.ffa() && !alive && this.spec >= 0 && gs.p[this.spec] ? gs.p[this.spec].n : null,
      });
      if (inRound && this.settings.minimap && now - this.miniAt > 50) {
        this.miniAt = now;
        this.mini.draw(now, {
          px: p.pos.x, pz: p.pos.z, yaw: p.yaw, alive, meColor: TEAM_CSS[this.me], oppColor: TEAM_CSS[1 - this.me], colors: TEAM_CSS,
          storm: this.ffa() && this.storm ? { x: this.storm.x, z: this.storm.z, r: this.stormR(now) } : null,
          pickups: this.pickDefs.map((k, i) => ({ x: k.x, z: k.z, type: k.type, on: !!gs.pk[i] })), smokes: this.fx.clouds, fires: cb.fires,
          // 機器人模式：所有機器人、據點、下一波從哪來、隊友
          mobs: this.horde.on ? this.horde.mini() : null, core: this.horde.on ? this.horde.core : null, gates: gs.hz && gs.hz.st === 'break' ? gs.hz.gates : null,
          ally: this.coop() && this.remote.alive ? { x: this.remote.pos.x, z: this.remote.pos.z } : null,
        });
      }
    }
    this.voice.poll(now);

    this.env.update(dt, cam.position);
    this.world.light.update(now);
    this.post.render(this.scene, cam, inRound && showView ? this.view : null, dt, alive && inRound && !this.kc ? clamp(1 - meS.hp / 30, 0, 1) : 0);
  }
}

window.__game = new Game();
// 第一格畫面畫好之後才把載入畫面淡掉（著色器在第一次畫的時候才編譯）
requestAnimationFrame(() => requestAnimationFrame(() => {
  const b = document.getElementById('boot'); if (!b) return;
  b.classList.add('done'); setTimeout(() => b.remove(), 700);
}));
