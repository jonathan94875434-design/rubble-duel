import * as THREE from 'three';
import { BS, NET, TEAM, TEAM_CSS, PLAYER } from './config.js';
import { World, BLOCK } from './world.js';
import { Player } from './player.js';
import * as RP from './remote.js';
import { Combat } from './combat.js';
import { FX } from './fx.js';
import { Sfx } from './audio.js';
import { ViewModel } from './viewmodel.js';
import { Net } from './net.js';
import { Authority } from './authority.js';
import { Bot } from './bot.js';
import { validLook } from './skins.js';
import { Hud } from './hud.js';
import { WEAPONS, GEAR, NADE_IDS, validLoadout, loadoutCost, itemName } from './weapons.js';
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

const RemotePlayer = RP.RemotePlayer;
// 表情動作的清單（角色模型那邊有定義就用它的）
const EMOTES = RP.EMOTES || { wave: { name: '揮手', dur: 2.4 }, dance: { name: '跳舞', dur: 3 }, salute: { name: '敬禮', dur: 2.2 }, taunt: { name: '嘲諷', dur: 2.6 } };
const DEFAULT_XHAIR = { color: '#ffffff', len: 9, thick: 2, gap: 0, dot: true, outline: true, dyn: true, style: 'cross', alpha: 1 };

const qs = new URLSearchParams(location.search);
const LOCAL = qs.get('local') === '1';    // 同一台電腦兩個分頁測試
const NOLOCK = qs.get('nolock') === '1';  // 自動化測試用：不需要鎖定滑鼠
const DEG = Math.PI / 180;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v2s = new THREE.Vector2(), _c1 = new THREE.Color();
const ROUND_PHASES = ['countdown', 'playing', 'roundEnd', 'warmup'];
const WARM_LOADOUT = { p: 'ar', s: 'pistol', armor: 1, he: 1, flash: 1, smoke: 1, molotov: 1 };
// 音效模組還沒有的新聲音先當作沒事（舊版 audio.js 也能跑）
const SFX_OPTIONAL = ['setEnv', 'ambient', 'stopLoops', 'loop', 'impact', 'whiz', 'knifeSwing', 'knifeHit', 'molotov', 'shell', 'spray', 'emote', 'respawn', 'roundStart', 'voiceBlip', 'duck'];

class Game {
  constructor() {
    this.EMOTES = EMOTES; this.DEFAULT_XHAIR = DEFAULT_XHAIR; this.QUALITY = QUALITY;
    const look = validLook({ s: store.get('skin'), w: store.get('wskin') });
    this.settings = {
      name: store.get('name', ''), sens: store.get('sens', 1), fov: store.get('fov', 82), vol: store.get('vol', 0.6),
      wheel: store.get('wheel', true),          // 滾輪切槍（Magic Mouse 容易誤觸，可以關）
      bot: store.get('bot', 'normal'), pmap: store.get('pmap', 'random'),  // 練習模式的難度與地圖
      skin: look.s, wskin: look.w,
      quality: store.get('quality', 'auto'),    // 畫質：auto / low / medium / high
      xh: { ...DEFAULT_XHAIR, ...(store.get('xh', null) || {}) },   // 準星
      minimap: store.get('minimap', true), fps: store.get('fps', false),
      voice: store.get('voice', 'off'), voiceVol: store.get('voiceVol', 1),   // 語音：off / ptt（按住說話）/ open（一直開）
      spray: SPRAYS[store.get('spray')] ? store.get('spray') : 'skull', emote: EMOTES[store.get('emote')] ? store.get('emote') : 'wave',
    };
    this.sel = validLoadout(null);   // 這一局在商店選的裝備；每局都從「只有免費手槍」開始，不沿用上一局
    this.wsel = validLoadout(store.get('wsel', WARM_LOADOUT));   // 熱身用的裝備（免費，會記住）
    this.binds = loadBinds(store.get('binds'));
    this.phase = 'menu'; this.gs = null; this.me = 0; this.round = 0; this.code = '';
    this.authority = null; this.bot = null; this.warmBot = false; this.locked = false; this.phaseEnd = 0;
    this.keys = {}; this.mouse = { l: false, r: false, lp: false, dx: 0, dy: 0 }; this.reloadPressed = false;
    this.shake = 0; this.deathT = 0; this.sendAcc = 0; this.orbit = 0; this.lastCount = -1; this.stepPhase = 0;
    this.pickAt = []; this.pickDefs = []; this.pickMeshes = []; this.pickMap = null;
    this.lastWheel = 0; this.wheelAcc = 0; this.wheelT = 0;
    this.landDip = 0; this.roll = 0; this.rStep = 0; this.lockerOpen = false; this.oppLook = '';
    this.buyOpen = false; this.kc = false; this.kcAt = 0; this.kcDeath = 0; this.emote = null; this.sprayAt = 0;
    this.spotAt = 0; this.lit = 1; this.pendingGs = null; this.rs0 = 0; this.rh0 = 0; this.fpsAcc = 0; this.fpsN = 0; this.fpsV = 0; this.miniAt = 0;
    this.fxLight = new THREE.Color(1, 1, 1); this.envDef = null;

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
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.05, 700);
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
  setMap(id) { this.world.reset(id); this._applyEnv(); }
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
      if (this.phase === 'editor') { const k = 0.0022 * this.settings.sens; this.editor.yaw -= mx * k; this.editor.pitch = clamp(this.editor.pitch - my * k, -1.54, 1.54); return; }
      const k = (0.0022 * this.settings.sens) / this.zoom();
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
    else if (code === b.buy) { if (this.phase === 'warmup') this.openBuy(); }
    else if ((this.phase === 'playing' || this.phase === 'warmup') && this.meAlive()) {
      const nade = NADE_IDS.find((k) => b[k] === code);
      if (nade) cb.throwNade(nade);
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
  // 戰績記在哪一邊：跟機器人打算練習
  mode() { return this.net.mode === 'bot' || this.warmBot ? 'practice' : 'duel'; }

  requestLock() {
    if (NOLOCK || this.locked) return;
    const fail = () => { if (this.phase !== 'editor') this.hud.setPaused(this.inRound() && !this.buyOpen); };
    try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(fail); } catch { fail(); }
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
  look() { return { s: this.settings.skin, w: this.settings.wskin }; }
  setLook(kind, id) {
    this.settings[kind] = id; store.set(kind, id); this.sfx.ui();
    this._dressDoll();
    if (this.authority || this.net.connected) this.auth('look', this.look());
  }
  _dressDoll() { this.doll.applySkin(this.settings.skin, TEAM[0]); this.doll.setWeapon('ar', this.settings.wskin); this.doll._lit(); }
  openLocker() { this.lockerOpen = true; this._dressDoll(); this.doll.group.visible = this.pedestal.visible = true; this.hud.show('locker'); }
  closeLocker() { this.lockerOpen = false; this.doll.group.visible = this.pedestal.visible = false; this.hud.show('menu'); }
  previewEmote(id) { if (this.doll.emote) this.doll.emote(id); }
  myName() { return this.settings.name || (this.net.isHost ? '房主' : '挑戰者'); }
  inviteLink() { return `${location.origin}${location.pathname}?room=${this.code}${LOCAL ? '&local=1' : ''}`; }

  // ───────── 連線 ─────────
  _bindNet() {
    const n = this.net;
    n.on('_open', () => {
      if (n.isHost) {
        if (this.warmBot) { this._dropWarmBot(); if (this.authority) this.authority.toLobby(); }   // 朋友來了：陪練的機器人下場
        if (this.authority) this.authority.setPresent(1, true);
        if (n.mode !== 'bot') { this.hud.toast('對手加入了房間'); this._sendMap(this.authority && this.authority.settings.map); }
      } else { this.auth('name', { name: this.myName() }); this.auth('look', this.look()); }
      this.voice.attach(); this.voice.call();
    });
    n.on('_close', () => {
      this.voice.hangup();
      if (n.isHost) {
        this.hud.toast('對手離線了，房間還開著，可以重新邀請');
        if (this.authority) { this.authority.setPresent(1, false); this.authority.toLobby(); }
      } else { this.leave(); this.hud.menuMsg('與房主的連線中斷了'); }
    });
    n.on('_error', (t) => { if (t !== 'peer-unavailable') this.hud.toast('網路狀況不穩（' + t + '）'); });
    n.on('auth', (d) => { if (n.isHost && this.authority && d) this.authority.handle(1, d.t, d); });
    n.on('gs', (d) => { if (!n.isHost) this.onGs(d); });
    n.on('ev', (d) => { if (!n.isHost) this.onEv(d); });
    n.on('st', (d) => { this.remote.push(d); if (WEAPONS[d[5]] && d[5] !== this.remote.weapon) { this.remote.setWeapon(d[5], this.remote.wskin); this.remote._lit(); } });
    n.on('fire', (d) => this.onRemoteFire(d));
    n.on('blk', (d) => this.onRemoteBlk(d));
    n.on('expl', (d) => { if (d.r !== this.round) return; this.combat.removeProjectile(d.pid); this.doExplosion(d); });
    n.on('blind', (d) => { if (this.gs && d && d.d > 0.6) this.hud.feed(`閃到 ${this.gs.p[1 - this.me].n}　${d.d} 秒`); });
    n.on('spray', (d) => { if (d && d.r === this.round && SPRAYS[d.id] && Array.isArray(d.p) && Array.isArray(d.n)) this.fx.spray(sprayTex(d.id), +d.p[0], +d.p[1], +d.p[2], +d.n[0], +d.n[1], +d.n[2], +d.y || 0, d.c | 0); });
    n.on('emote', (d) => { if (d && EMOTES[d.id] && this.remote.emote) this.remote.emote(d.id); });
    // 房主選了自製地圖：把地圖資料傳過來，登記好之後才處理用到它的狀態
    n.on('map', async (d) => {
      if (n.isHost || !d || typeof d.code !== 'string' || d.code.length > 400000) return;
      try { registerCustom(await decodeMap(d.code), d.code); this.hud.refreshMaps(); } catch { return; }
      if (this.pendingGs) { const g = this.pendingGs; this.pendingGs = null; this.onGs(g); }
    });
  }
  _sendMap(id) { const m = MAPS[id]; if (m && m.custom && this.net.isHost && this.net.connected) this.net.send('map', { id, code: m.code }); }

  _mkAuthority() {
    if (this.authority) this.authority.destroy();
    this.authority = new Authority((i, type, data) => {
      if (i === 0) queueMicrotask(() => { if (type === 'gs') this.onGs(data); else if (type === 'ev') this.onEv(data); });
      else this.net.send(type, data);
    });
    this.authority.setName(0, this.myName());
    this.authority.handle(0, 'look', this.look());
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
      await this.net.join(code, LOCAL); this.hud.menuMsg('已連上，等待房主資料…');
      this.voice.attach(); if (this.settings.voice !== 'off') this.setVoice(this.settings.voice);
    } catch (e) { this.net.close(); this.hud.menuMsg(e.message || '加入失敗'); }
    this.hud.menuBusy(false);
  }

  // map：指定地圖（編輯器的「試玩」用）；不給就照選單選的
  practice(map) {
    this.sfx.init(); this.me = 0; this.code = '';
    const level = this.settings.bot;
    this.bot = new Bot(this.world, level);
    this.bot.blocked = (ax, ay, az, bx, by, bz) => this.fx.smokeBlocked(ax, ay, az, bx, by, bz);   // 煙霧會擋住機器人的視線
    this.net.isHost = true;
    this._mkAuthority();
    this.net.hostBot(this.bot);
    this.authority.setName(1, level === 'dummy' ? '木樁' : '練習機器人');
    // 木樁模式是給你練身法、練槍的：每局 15 分鐘，對手不動也不開槍
    const m = map || this.settings.pmap;
    this.authority.setSettings({ map: MAPS[m] ? m : 'random', roundTime: level === 'dummy' ? 900 : 120 });
    this.authority.startMatch();
  }

  // 熱身：沒有回合、無限重生。房間裡只有自己時，先叫一個機器人陪練，朋友一進來就結束
  startWarmup() {
    if (!this.authority || !this.gs || !this.net.isHost) return;
    if (!this.gs.here[1]) {
      const lv = this.settings.bot === 'dummy' ? 'normal' : this.settings.bot;
      this.bot = new Bot(this.world, lv);
      this.bot.blocked = (ax, ay, az, bx, by, bz) => this.fx.smokeBlocked(ax, ay, az, bx, by, bz);
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
  endWarmup() { if (!this.authority || this.phase !== 'warmup') return; this._dropWarmBot(); this.authority.toLobby(); }

  leave() {
    this.voice.close();
    this.net.close();
    if (this.authority) { this.authority.destroy(); this.authority = null; }
    this.bot = null; this.warmBot = false; this.gs = null; this.phase = 'menu'; this.round = 0; this.oppLook = ''; this.pendingGs = null;
    this.lockerOpen = false; this.doll.group.visible = this.pedestal.visible = false; this.buyOpen = false;
    this.remote.alive = false; this.remote.group.visible = false; this.ghost.group.visible = false;
    this._endKillcam(); this.emote = null; this.editor.close();
    this.exitLock(); this.hud.showHud(false); this.hud.clearBanner(); this.hud.report(null); this.hud.show('menu'); this.hud.menuMsg('');
    this.combat.clearProjectiles(); this.fx.clear(); this.sfx.stopLoops(); this.sfx.ambient(null);
    for (const m of this.pickMeshes) m.visible = false;
    if (!MAPS[this.world.mapId]) this.setMap('plaza');
  }

  changeSettings(s) { if (this.authority) { this.authority.setSettings(s); if (s.map) this._sendMap(s.map); } }
  startMatch() { if (this.authority && this.gs && this.gs.here[1] && !this.warmBot) { this._sendMap(this.authority.settings.map); this.authority.startMatch(); } }

  // 對裁判提出請求：房主直接呼叫、訪客走網路
  auth(type, data) {
    if (this.net.isHost) { if (this.authority) this.authority.handle(0, type, data); }
    else this.net.send('auth', { ...data, t: type });
  }
  sendPeer(type, data) { this.net.send(type, data); }

  // ───────── 買裝備 ─────────
  // kind: 'p' 主武器 / 's' 副武器 / 裝備代號（armor、he、flash、smoke、molotov）
  buy(kind, id) {
    const gs = this.gs;
    if (!gs) return;
    if (gs.phase === 'warmup') {                       // 熱身：全部免費，愛拿什麼拿什麼
      if (!this.buyOpen) return;
      const n = { ...this.wsel };
      if (kind === 'p') n.p = n.p === id ? null : id; else if (kind === 's') n.s = id;
      else if (GEAR[kind]) n[kind] = n[kind] >= GEAR[kind].max ? 0 : n[kind] + 1; else return;
      this.wsel = n; store.set('wsel', n); this.sfx.buy(); this.hud.onState(gs);
      return;
    }
    if (gs.phase !== 'loadout') return;
    const money = gs.p[this.me].$, next = { ...this.sel };
    if (kind === 'p') {
      if (gs.round <= 1) { this.sfx.deny(); this.hud.toast('第 1 局是手槍局，下一局才能買主武器'); return; }
      next.p = next.p === id ? null : id;
    } else if (kind === 's') next.s = id;
    else if (GEAR[kind]) {
      next[kind] = next[kind] >= GEAR[kind].max ? 0 : next[kind] + 1;
      if (this.sel[kind] > 0 && loadoutCost(next) > money) next[kind] = 0;   // 買不起下一個 → 當作取消
    }
    else return;
    if (loadoutCost(next) > money) { this.sfx.deny(); this.hud.toast('錢不夠'); return; }
    this.sel = next; this.sfx.buy();
    this.auth('loadout', this.sel);
    this.hud.onState(gs);
  }
  toggleReady() {
    if (!this.gs) return;
    if (this.phase === 'warmup') { this.closeBuy(); return; }
    this.sfx.ui(); this.auth('ready', { v: !this.gs.p[this.me].rd });
  }
  pickBuff(id) { this.sfx.pickup(); this.auth('buff', { id }); }
  // 熱身中的商店
  openBuy() { if (this.phase !== 'warmup' || this.buyOpen) return; this.buyOpen = true; this.mouse.l = this.mouse.r = false; this.exitLock(); this.hud.show('loadout'); this.hud.onState(this.gs); }
  closeBuy() {
    if (!this.buyOpen) return;
    this.buyOpen = false; this.hud.show(null);
    if (this.phase === 'warmup') { this.auth('loadout', this.wsel); if (this.meAlive()) this.combat.setLoadout(this.wsel, []); this.requestLock(); }
  }

  // ───────── 主機狀態 → 本機 ─────────
  onGs(gs) {
    // 用到還沒收到的自製地圖 → 先放著，等地圖資料到了再處理
    if (!MAPS[gs.map] || (gs.set && gs.set.map !== 'random' && gs.set.map !== 'rotate' && !MAPS[gs.set.map])) { this.pendingGs = gs; return; }
    const prev = this.gs; this.gs = gs;
    this.phaseEnd = performance.now() + gs.tLeft;
    const changed = !prev || prev.phase !== gs.phase || prev.round !== gs.round;
    if (changed) this.enterPhase(gs);
    const opp = gs.p[1 - this.me];
    const lk = opp.lk.s + '|' + opp.lk.w;
    if (lk !== this.oppLook) { this.oppLook = lk; this.remote.applySkin(opp.lk.s, TEAM[1 - this.me]); this.remote.setWeapon(this.remote.weapon, opp.lk.w); this.remote._lit(); }
    // 大廳裡房主指定地圖時，背景直接換成那張圖預覽
    if (gs.phase === 'lobby' && MAPS[gs.set.map] && this.world.mapId !== gs.set.map) this.setMap(gs.set.map);
    const inR = this.inRound(), wasAlive = this.remote.alive;
    this.remote.alive = inR && opp.al;
    if (inR && wasAlive && !opp.al && this.remote.die) {     // 對手倒下：往遠離我的方向倒
      const p = this.player.pos, rp = this.remote.pos; this.remote.die(rp.x - p.x, rp.z - p.z);
    } else if (this.remote.alive && this.remote.dead && this.remote.revive) { this.remote.revive(); this.remote.clearBuffer(); }
    this.remote.group.visible = inR && (opp.al || !!this.remote.dead) && !this.kc;
    for (let i = 0; i < this.pickMeshes.length; i++) this.pickMeshes[i].visible = inR && !!gs.pk[i];
    this.hud.onState(gs);
  }

  enterPhase(gs) {
    const from = this.phase;
    this.phase = gs.phase;
    const h = this.hud;
    if (gs.phase !== 'roundEnd') { this._endKillcam(); h.report(null); }
    if (gs.phase !== 'warmup') this.buyOpen = false;
    if (gs.phase === 'lobby') {
      this.exitLock(); h.showHud(false); h.clearBanner(); h.show('lobby'); this.emote = null; this.ghost.group.visible = false;
      this.sfx.stopLoops(); this.sfx.ambient(null);
      if (from === 'warmup' || from === 'roundEnd' || from === 'playing' || from === 'countdown') { this.combat.clearProjectiles(); this.fx.clear(); }
    }
    else if (gs.phase === 'loadout') {
      this.exitLock(); h.showHud(false); h.clearBanner(); h.show('loadout'); this.emote = null; this.ghost.group.visible = false;
      this.mouse.l = this.mouse.r = false;
      this.sel = validLoadout(null);   // 商店重置：每局都要自己重新買
      this.auth('loadout', this.sel);
      this.sfx.stopLoops();
    } else if (gs.phase === 'countdown') this.startRound(gs);
    else if (gs.phase === 'warmup') { this.startRound(gs); h.banner('熱身', `不計分、無限重生　按 ${h.key('buy')} 換裝備`, 2600); this.auth('loadout', this.wsel); }
    else if (gs.phase === 'playing') {
      if (this.round !== gs.round) this.startRound(gs); // 保險：沒收到倒數階段也要先把這一局建好
      h.banner('開戰！', '', 800); this.sfx.beep(true); this.sfx.roundStart();
    } else if (gs.phase === 'roundEnd') {
      if (this.round !== gs.round) this.startRound(gs);
      this.onRoundEnd(gs);
    }
    else if (gs.phase === 'matchEnd') {
      this.exitLock(); h.showHud(false); h.clearBanner(); h.show('end'); this.sfx.stopLoops();
      if (gs.mw === this.me) this.sfx.win(); else this.sfx.lose();
      const me = gs.p[this.me], opp = gs.p[1 - this.me];
      this.stats.match(this.mode(), { win: gs.mw === this.me, my: me.sc, their: opp.sc, opp: opp.n, map: MAPS[gs.map].name });
    }
  }

  startRound(gs) {
    const warm = gs.phase === 'warmup';
    this.round = gs.round;
    this.setMap(gs.map); this._setPickups(gs.map); this.fx.clear(); this.sfx.stopLoops();
    const meS = gs.p[this.me], opp = gs.p[1 - this.me], sp = MAPS[gs.map].spawns;
    this.player.spawn(sp[(this.me + gs.round) % 2]);
    this.combat.setLoadout(warm ? this.wsel : meS.lo, warm ? [] : meS.bf);
    this.player.maxAirJumps = this.combat.mods.airJumps;
    if (this.view.setLook) this.view.setLook(this.settings.skin, TEAM[this.me]);
    const os = sp[(1 - this.me + gs.round) % 2];
    this.remote.clearBuffer(); this.remote.pos.set(os.x, os.y, os.z); this.remote.yaw = os.yaw; this.remote.lastPos.copy(this.remote.pos);
    if (this.remote.revive) this.remote.revive();
    this.remote.applySkin(opp.lk.s, TEAM[1 - this.me]); this.remote.setWeapon(opp.lo.p || opp.lo.s, opp.lk.w); this.remote._lit();
    this.ghost.group.visible = false; this.emote = null; this.kc = false; this.kcAt = 0;
    this.replay.clear(); this.mini.reset(); this.rs0 = this.combat.shots; this.rh0 = this.combat.hits;
    this.deathT = 0; this.shake = 0; this.landDip = 0; this.roll = 0; this.rStep = 0;
    this.lastCount = -1; this.keys = {}; this.mouse.l = this.mouse.r = false;
    this.hud.show(null); this.hud.showHud(true); this.hud.clearBanner(); this.hud.clearFlash(); this.hud.report(null);
    this.sfx.ambient(this.envDef ? this.envDef.ambient : null);
    this.requestLock();
    // 瀏覽器不給自動鎖滑鼠時（例如剛按過 Esc），顯示「點一下繼續」
    setTimeout(() => { if (this.inRound() && !this.locked && !NOLOCK && !this.buyOpen) this.hud.setPaused(true); }, 300);
  }

  // 熱身中重生：挑離對手比較遠的出生點
  respawn() {
    const gs = this.gs; if (!gs) return;
    const sp = MAPS[gs.map].spawns, rp = this.remote.pos, d = (s) => Math.hypot(s.x - rp.x, s.z - rp.z);
    this.player.spawn(d(sp[0]) > d(sp[1]) ? sp[0] : sp[1]);
    this.combat.setLoadout(this.wsel, []);
    this.deathT = 0; this.shake = 0; this.emote = null; this.ghost.group.visible = false;
    this.hud.clearFlash(); this.sfx.respawn();
  }

  // 擊倒訊息的文字（一般局和熱身共用）
  _killText(r, meWon) {
    const opp = this.gs.p[1 - this.me], wn = itemName(r.w);
    const how = `${wn}${r.bk ? ' 背刺' : ''}${r.head ? ' 爆頭' : ''}${r.wb ? ' 穿牆' : ''}`;
    return r.reason === 'suicide' ? (r.victim === this.me ? '你把自己弄死了' : `${opp.n} 把自己弄死了`) : meWon ? `${how} 擊倒 ${opp.n}` : `${opp.n} 用 ${how} 擊倒你`;
  }

  onRoundEnd(gs) {
    const r = gs.res || {}, me = this.me, my = gs.p[me], opp = gs.p[1 - me], now = performance.now();
    const inc = r.inc ? `　·　獲得 $${r.inc[me]}` : '';
    this.stats.round(this.mode(), {
      win: r.winner === me, kill: r.reason === 'kill' && r.victim === 1 - me, died: r.victim === me, head: !!r.head, wb: !!r.wb, weapon: r.w,
      shots: this.combat.shots - this.rs0, hits: this.combat.hits - this.rh0, dmg: my.rdm,
    });
    // 傷害報告：這一局雙方各打中幾發、多少血
    this.hud.report({ me: my, opp });
    if (r.winner === -1) { this.hud.banner('平手', '時間到，雙方血量相同' + inc, 0); return; }
    const sub = r.reason === 'time' ? '時間到，血量較多的一方獲勝' : this._killText(r, r.winner === me);
    if (r.winner === me) { this.hud.banner('拿下這一局', sub + inc, 0); this.sfx.kill(); }
    else { this.hud.banner('這局輸了', sub + inc, 0); this.sfx.lose(); }
    if (r.reason !== 'time') this.hud.killfeed({ killer: r.reason === 'suicide' ? null : gs.p[1 - r.victim].n, victim: gs.p[r.victim].n, w: r.w, head: r.head, wb: r.wb, bk: r.bk, mine: r.victim !== me });
    // 被擊倒 → 過一秒播擊殺回放
    if (r.reason === 'kill' && r.victim === me) { this.kcDeath = now; this.kcAt = now + 1100; }
  }

  _endKillcam() {
    this.kcAt = 0;
    if (!this.kc) return;
    this.kc = false; this.replay.stop(); this.ghost.group.visible = false; this.hud.killcam(false);
    if (this.combat.w) this.view.setWeapon(this.combat.w.id, this.settings.wskin);
    if (this.gs) { const opp = this.gs.p[1 - this.me]; this.remote.group.visible = this.inRound() && (opp.al || !!this.remote.dead); }
  }

  onEv(e) {
    if (e.t === 'hurt') {
      this.sfx.hurt(); this.shake = Math.min(1.2, this.shake + 0.35);
      if (e.self) this.hud.hurt(null);
      else {
        const p = this.player, dx = this.remote.pos.x - p.pos.x, dz = this.remote.pos.z - p.pos.z;
        const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
        this.hud.hurt(Math.atan2(dx * c - dz * s, -dx * s - dz * c));
      }
    } else if (e.t === 'pick' && e.by === this.me) this.sfx.pickup();
    else if (e.t === 'respawn') this.respawn();
    else if (e.t === 'wkill' && this.gs) {
      const g = this.gs, mine = e.victim !== this.me;
      this.hud.killfeed({ killer: e.reason === 'suicide' ? null : g.p[1 - e.victim].n, victim: g.p[e.victim].n, w: e.w, head: e.head, wb: e.wb, bk: e.bk, mine });
      if (mine && e.reason === 'kill') this.sfx.kill(); else if (!mine) this.sfx.lose();
    }
  }

  // ───────── 對手的動作 ─────────
  panOf(x, z) {
    const c = this.camera.position, dx = x - c.x, dz = z - c.z, l = Math.hypot(dx, dz) || 1, yaw = this.player.yaw;
    return clamp(((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / l) * 0.8, -1, 1);
  }

  onRemoteFire(d) {
    if (!d || !this.inRound()) return;
    const rp = this.remote.pos, dist = rp.distanceTo(this.camera.position), now = performance.now();
    if (d.w === 'knife') { if (this.remote.meleeAnim) this.remote.meleeAnim(); if (dist < 12) this.sfx.knifeSwing(); return; }
    const def = WEAPONS[d.w];
    if (!def) {                                          // 投擲物
      if (d.v) { this.combat.spawnProjectile(d.w, d.pid, d.o, d.v, false); if (this.remote.throwAnim) this.remote.throwAnim(); }
      return;
    }
    this.sfx.shot(def.snd, Math.max(1, dist), this.panOf(rp.x, rp.z));
    this.mini.ping(now, rp.x, rp.z);                      // 開槍會在小地圖上暴露位置
    this.replay.event(now + NET.INTERP_MS, 'fire', { w: d.w, e: d.e });
    if (this.remote.fireKick) this.remote.fireKick();
    if (d.v) { this.combat.spawnProjectile(d.w, d.pid, d.o, d.v, false); return; }
    if (!Array.isArray(d.e)) return;
    const m = this.remote.muzzle(_v1);
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
  }

  onRemoteBlk(d) {
    if (d.r !== this.round || !d.h) return;
    let broke = null;
    for (let i = 0; i + 1 < d.h.length; i += 2) {
      const res = this.world.damageIdx(d.h[i], d.h[i + 1]);
      if (!res) continue;
      if (res.destroyed) { this.fx.debris(res.x, res.y, res.z, res.type); broke = res; }
      else this.fx.impact((res.x + 0.5) * BS, (res.y + 0.5) * BS, (res.z + 0.5) * BS, 0, 0.4, 0, res.type, 2);
    }
    if (broke) this.sfx.blockBreak(_v1.set((broke.x + 0.5) * BS, (broke.y + 0.5) * BS, (broke.z + 0.5) * BS).distanceTo(this.camera.position));
  }

  // 爆炸：改地形 + 特效 + 把本機玩家炸飛（傷害由開槍方另外回報）
  doExplosion(m) {
    const [x, y, z] = m.p;
    if (m.kind === 'flash') { this.doFlash(x, y, z); return; }
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
    this.fx.explosion(x, y, z, m.rad);
    this.sfx.explosion(dist, pan, m.rad / 4.5);
    this.shake = Math.min(1.5, this.shake + Math.max(0, 1.2 - dist / 14));
    if (this.inRound() && this.meAlive()) {
      const p = this.player, dx = p.pos.x - x, dy = p.pos.y + 0.9 - y, dz = p.pos.z - z, d = Math.hypot(dx, dy, dz);
      if (d < m.rad && d > 0.01) {
        const f = 1 - d / m.rad, k = (f * m.k) / d;
        p.vel.x += dx * k; p.vel.y += dy * k + 2 * f; p.vel.z += dz * k; p.onGround = false;
      }
    }
  }

  // 閃光彈：有看到它（沒被牆或煙擋住）才會被閃；正對著看最慘，背對只白一下
  doFlash(x, y, z) {
    const cam = this.camera, c = cam.position;
    let dx = x - c.x, dy = y - c.y, dz = z - c.z;
    const dist = Math.hypot(dx, dy, dz) || 0.01;
    dx /= dist; dy /= dist; dz /= dist;
    this.fx.flashBurst(x, y, z);
    let dur = 0;
    if (this.inRound() && this.meAlive() && dist < 34 && !this.kc) {
      const blocked = (dist > 0.8 && !!this.world.raycast(c.x, c.y, c.z, dx, dy, dz, dist - 0.5)) || this.fx.smokeBlocked(c.x, c.y, c.z, x, y, z);
      if (!blocked) {
        const e = cam.matrixWorld.elements, dot = -(e[8] * dx + e[9] * dy + e[10] * dz);
        const k = (dot > 0.3 ? 1 : dot > -0.35 ? 0.55 : 0.2) * clamp(1.2 - dist / 24, 0.2, 1);
        dur = 0.4 + 3 * k;
        this.hud.flash(Math.min(1, 0.4 + k), dur);
        this.sendPeer('blind', { d: +dur.toFixed(1) });
      }
    }
    this.sfx.flashbang(dist, this.panOf(x, z), dur);
    if (this.bot) this.bot.onFlash(x, y, z);
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
    g.applySkin(this.settings.skin, TEAM[this.me]); g.setWeapon(this.combat.w ? this.combat.w.id : 'pistol', this.settings.wskin); g._lit();
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
      const live = this.phase === 'playing' || this.phase === 'warmup';
      const canMove = act && alive && this.phase !== 'countdown';
      const w = cb.w;
      const adsKey = this.mouse.r || this.held('ads');   // 右鍵，或你綁的瞄準鍵（預設左 Shift）
      if (alive) {
        const mf = canMove ? (this.held('fwd') ? 1 : 0) - (this.held('back') ? 1 : 0) : 0, mr = canMove ? (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0) : 0;
        if (this.emote && (mf || mr || this.mouse.l || now >= this.emote.end)) { this.emote = null; this.ghost.group.visible = false; }   // 一動就取消
        p.update(dt, { f: mf, r: mr, jump: canMove && this.held('jump'), crouch: canMove && this.held('crouch'), speed: (w ? w.def.move : 1) * cb.mods.speed * lerp(1, 0.6, cb.ads) });
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
          this.kc = true; this.hud.killcam(true, gs.p[1 - this.me].n);
          const g = this.ghost; g.applySkin(this.settings.skin, TEAM[this.me]); g.setWeapon(cb.w ? cb.w.id : 'pistol', this.settings.wskin); g._lit(); if (g.revive) g.revive();
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
        if (Math.abs(cam.fov - this.settings.fov) > 0.01) { cam.fov = this.settings.fov; cam.updateProjectionMatrix(); }
        cam.position.set(frame.kx, frame.ky + lerp(PLAYER.EYE, PLAYER.CROUCH_EYE, frame.kcr), frame.kz);
        cam.rotation.set(clamp(frame.kp, -1.55, 1.55), frame.kyaw, 0);
        const g = this.ghost;
        g.pos.set(frame.vx, frame.vy, frame.vz); g.yaw = frame.vyaw; g.crouched = !!frame.vcr; g.alive = true; g.group.visible = true; g.update(dt);
        this.remote.group.visible = false;
        if (WEAPONS[frame.kw] && this.view.cur !== frame.kw + '|' + this.remote.wskin) this.view.setWeapon(frame.kw, this.remote.wskin);
        this.hud.killcamTime(frame.left);
        showView = true;
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
        const fov = 2 * Math.atan(Math.tan((this.settings.fov * DEG) / 2) / zoom) / DEG;
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

      const canFire = act && alive && live && !this.emote && !this.kc;
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
      if (live && alive && this.remote.alive) {
        this.replay.rec(now, this.remote, p);
        if (now >= this.spotAt) {
          this.spotAt = now + 120;
          const rp = this.remote.pos, e = cam.matrixWorld.elements, c = cam.position;
          let dx = rp.x - c.x, dy = rp.y + 1.1 - c.y, dz = rp.z - c.z; const d = Math.hypot(dx, dy, dz) || 1; dx /= d; dy /= d; dz /= d;
          if (d < 80 && -(e[8] * dx + e[9] * dy + e[10] * dz) > 0.45 && !this.world.raycast(c.x, c.y, c.z, dx, dy, dz, d) && !this.fx.smokeBlocked(c.x, c.y, c.z, rp.x, rp.y + 1.1, rp.z)) this.mini.spot(now, rp.x, rp.z);
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
      else { const gy = MAPS[this.world.mapId] ? MAPS[this.world.mapId].ground || 0 : 0; cam.position.set(24 + Math.cos(this.orbit) * 40, gy + 22, 24 + Math.sin(this.orbit) * 40); cam.lookAt(24, gy + 2, 24); }
    }

    if (this.bot) this.bot.update(dt, now);
    if (!this.kc) this.remote.update(dt);
    // 對手的腳步聲與落地聲（對手跑步、跳下來時聽得到位置）
    const rm = this.remote;
    if (inRound && rm.alive && !this.kc) {
      if (rm.grounded && !rm.crouched && rm.speed > PLAYER.STEP_SOUND_SPEED) {
        this.rStep += rm.speed * dt;
        if (this.rStep > 2.3) { this.rStep = 0; this.sfx.stepRemote(rm.pos.distanceTo(cam.position), this.panOf(rm.pos.x, rm.pos.z), this.surfaceAt(rm.pos.x, rm.pos.y, rm.pos.z)); }
      }
      if (rm.justLanded) this.sfx.landRemote(rm.pos.distanceTo(cam.position), this.panOf(rm.pos.x, rm.pos.z), this.surfaceAt(rm.pos.x, rm.pos.y, rm.pos.z));
    }
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
        net: (this.net.mode === 'bot' || this.warmBot ? '練習模式' : `延遲 ${this.net.ping} ms`) + (this.settings.fps ? `　${this.fpsV} FPS` : ''),
        spd: alive ? p.speed2d() : 0, crouch: p.crouched, nades: cb.nades, money: meS.$,
      });
      if (inRound && this.settings.minimap && now - this.miniAt > 50) {
        this.miniAt = now;
        this.mini.draw(now, {
          px: p.pos.x, pz: p.pos.z, yaw: p.yaw, alive, meColor: TEAM_CSS[this.me], oppColor: TEAM_CSS[1 - this.me],
          pickups: this.pickDefs.map((k, i) => ({ x: k.x, z: k.z, type: k.type, on: !!gs.pk[i] })), smokes: this.fx.clouds, fires: cb.fires,
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
