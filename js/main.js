import * as THREE from 'three';
import { BS, NET, TEAM } from './config.js';
import { World } from './world.js';
import { Player } from './player.js';
import { RemotePlayer } from './remote.js';
import { Combat } from './combat.js';
import { FX } from './fx.js';
import { Sfx } from './audio.js';
import { ViewModel } from './viewmodel.js';
import { Net } from './net.js';
import { Authority } from './authority.js';
import { Bot } from './bot.js';
import { Hud } from './hud.js';
import { WEAPONS, validLoadout } from './weapons.js';
import { SPAWNS, PICKUPS } from './maps.js';
import { clamp, lerp, r3, roomCode, store } from './util.js';

const qs = new URLSearchParams(location.search);
const LOCAL = qs.get('local') === '1';    // 同一台電腦兩個分頁測試
const NOLOCK = qs.get('nolock') === '1';  // 自動化測試用：不需要鎖定滑鼠
const DEG = Math.PI / 180;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const ROUND_PHASES = ['countdown', 'playing', 'roundEnd'];

class Game {
  constructor() {
    this.settings = { name: store.get('name', ''), sens: store.get('sens', 1), fov: store.get('fov', 82), vol: store.get('vol', 0.6) };
    this.sel = validLoadout(store.get('loadout'));
    this.phase = 'menu'; this.gs = null; this.me = 0; this.round = 0; this.code = '';
    this.authority = null; this.bot = null; this.locked = false; this.phaseEnd = 0;
    this.keys = {}; this.mouse = { l: false, r: false, lp: false, dx: 0, dy: 0 }; this.reloadPressed = false;
    this.shake = 0; this.deathT = 0; this.sendAcc = 0; this.orbit = 0; this.lastCount = -1; this.stepPhase = 0;
    this.pickAt = PICKUPS.map(() => 0);
    this.lastWheel = 0;

    this._initRender();
    this.world = new World(this.scene);
    this.fx = new FX(this.scene, this.world);
    this.sfx = new Sfx(); this.sfx.vol = this.settings.vol;
    this.view = new ViewModel();
    this.player = new Player(this.world);
    this.remote = new RemotePlayer(this.scene, TEAM[1]);
    this.combat = new Combat(this);
    this.net = new Net();
    this.hud = new Hud(this);
    this._initPickups();
    this._bindInput();
    this._bindNet();
    this._resize();
    addEventListener('resize', () => this._resize());
    addEventListener('pagehide', () => this.net.close()); // 關分頁時通知對手

    const room = (qs.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (room) { this.hud.setCode(room); this.hud.menuMsg('已帶入朋友的房號，輸入名字後按「加入房間」'); }
    this.hud.show('menu');

    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ───────── 畫面 ─────────
  _initRender() {
    const canvas = this.canvas = document.getElementById('game');
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    const s = this.scene = new THREE.Scene();
    s.fog = new THREE.Fog(0xbcd4ea, 45, 170);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.05, 500);
    this.camera.rotation.order = 'YXZ';
    s.add(new THREE.HemisphereLight(0xd6e8ff, 0x7a6f60, 1.25));
    const sun = this.sun = new THREE.DirectionalLight(0xfff1dc, 2.3);
    sun.position.set(24 + 28, 48, 24 + 14); sun.target.position.set(24, 0, 24);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 130;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
    s.add(sun, sun.target);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x2f6fc4) }, bot: { value: new THREE.Color(0xbcd4ea) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bot; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y * 1.3, 0.0, 1.0); gl_FragColor = vec4(mix(bot, top, pow(h, 0.6)), 1.0);\n#include <colorspace_fragment>\n}',
    }));
    sky.position.set(24, 0, 24); s.add(sky);
  }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.view.setAspect(w / h);
  }

  _initPickups() {
    this.pickMeshes = PICKUPS.map((p) => {
      const g = new THREE.Group();
      const c = p.type === 'hp' ? 0x54e07a : 0x4aa8ff;
      const mat = new THREE.MeshBasicMaterial({ color: c });
      const s = p.amount >= 40 ? 1 : 0.75;
      if (p.type === 'hp') { g.add(new THREE.Mesh(new THREE.BoxGeometry(0.44 * s, 0.14 * s, 0.14 * s), mat), new THREE.Mesh(new THREE.BoxGeometry(0.14 * s, 0.44 * s, 0.14 * s), mat)); }
      else g.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.46, 0.12), mat));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 20), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
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
      if (e.target && e.target.tagName === 'INPUT') return;
      this.keys[e.code] = true;
      if (!this.active()) return;
      if (!e.repeat) {
        if (e.code === 'Digit1') this.combat.switchTo(0);
        else if (e.code === 'Digit2') this.combat.switchTo(1);
        else if (e.code === 'KeyQ') this.combat.switchTo(1 - this.combat.cur);
        else if (e.code === 'KeyR') this.reloadPressed = true;
      }
      if (['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; this.mouse.l = this.mouse.r = false; });
    c.addEventListener('mousedown', (e) => {
      if (!this.active()) { if (this.inRound()) this.requestLock(); return; }
      if (e.button === 0) { this.mouse.l = true; this.mouse.lp = true; }
      else if (e.button === 2) this.mouse.r = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.l = false; else if (e.button === 2) this.mouse.r = false; });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const mx = clamp(e.movementX || 0, -400, 400), my = clamp(e.movementY || 0, -400, 400);
      const k = (0.0022 * this.settings.sens) / this.zoom();
      this.player.yaw -= mx * k;
      this.player.pitch = clamp(this.player.pitch - my * k, -1.54, 1.54);
      this.mouse.dx += mx; this.mouse.dy += my;
    });
    addEventListener('wheel', (e) => {
      // 觸控板/滑鼠滾一下會送出一大串事件，300ms 內只算一次
      const now = performance.now();
      if (!this.active() || !e.deltaY || now - this.lastWheel < 300) return;
      this.lastWheel = now; this.combat.switchTo(1 - this.combat.cur);
    }, { passive: true });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      if (!this.locked) { this.mouse.l = this.mouse.r = false; this.keys = {}; }
      this.hud.setPaused(this.inRound() && !this.locked && !NOLOCK);
    });
  }

  active() { return this.inRound() && (this.locked || NOLOCK); }
  inRound() { return ROUND_PHASES.includes(this.phase); }
  meAlive() { return !!(this.gs && this.gs.p[this.me].al); }
  zoom() { const w = this.combat.w; return w ? lerp(1, w.def.zoom, this.combat.ads) : 1; }

  requestLock() {
    if (NOLOCK || this.locked) return;
    try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => this.hud.setPaused(this.inRound())); }
    catch { this.hud.setPaused(this.inRound()); }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); this.hud.setPaused(false); }

  setSetting(k, v) {
    this.settings[k] = v; store.set(k, v);
    if (k === 'vol') this.sfx.setVolume(v);
    if (k === 'name' && this.net.connected) this.auth('name', { name: this.myName() });
  }
  myName() { return this.settings.name || (this.net.isHost ? '房主' : '挑戰者'); }
  inviteLink() { return `${location.origin}${location.pathname}?room=${this.code}${LOCAL ? '&local=1' : ''}`; }

  // ───────── 連線 ─────────
  _bindNet() {
    const n = this.net;
    n.on('_open', () => {
      if (n.isHost) { if (this.authority) this.authority.setPresent(1, true); if (n.mode !== 'bot') this.hud.toast('對手加入了房間'); }
      else this.auth('name', { name: this.myName() });
    });
    n.on('_close', () => {
      if (n.isHost) {
        this.hud.toast('對手離線了，房間還開著，可以重新邀請');
        if (this.authority) { this.authority.setPresent(1, false); this.authority.toLobby(); }
      } else { this.leave(); this.hud.menuMsg('與房主的連線中斷了'); }
    });
    n.on('_error', (t) => { if (t !== 'peer-unavailable') this.hud.toast('網路狀況不穩（' + t + '）'); });
    n.on('auth', (d) => { if (n.isHost && this.authority && d) this.authority.handle(1, d.t, d); });
    n.on('gs', (d) => { if (!n.isHost) this.onGs(d); });
    n.on('ev', (d) => { if (!n.isHost) this.onEv(d); });
    n.on('st', (d) => { this.remote.push(d); if (WEAPONS[d[5]]) this.remote.setWeapon(d[5]); });
    n.on('fire', (d) => this.onRemoteFire(d));
    n.on('blk', (d) => this.onRemoteBlk(d));
    n.on('expl', (d) => { if (d.r !== this.round) return; this.combat.removeProjectile(d.pid); this.doExplosion(d); });
  }

  _mkAuthority() {
    if (this.authority) this.authority.destroy();
    this.authority = new Authority((i, type, data) => {
      if (i === 0) queueMicrotask(() => { if (type === 'gs') this.onGs(data); else if (type === 'ev') this.onEv(data); });
      else this.net.send(type, data);
    });
    this.authority.setName(0, this.myName());
  }

  async hostGame() {
    this.sfx.init(); this.hud.menuMsg('建立房間中…'); this.hud.menuBusy(true);
    this.code = roomCode(); this.me = 0;
    try {
      await this.net.host(this.code, LOCAL);
      this._mkAuthority();
      this.authority.flush();
      this.hud.menuMsg('');
    } catch (e) { this.net.close(); this.hud.menuMsg(e.message || '建立房間失敗'); }
    this.hud.menuBusy(false);
  }

  async joinGame(code) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) { this.hud.menuMsg('請輸入 5 碼房號'); return; }
    this.sfx.init(); this.hud.menuMsg('連線中…'); this.hud.menuBusy(true);
    this.code = code; this.me = 1;
    try { await this.net.join(code, LOCAL); this.hud.menuMsg('已連上，等待房主資料…'); }
    catch (e) { this.net.close(); this.hud.menuMsg(e.message || '加入失敗'); }
    this.hud.menuBusy(false);
  }

  practice() {
    this.sfx.init(); this.me = 0; this.code = '';
    this.bot = new Bot(this.world);
    this.net.isHost = true;
    this._mkAuthority();
    this.net.hostBot(this.bot);
    this.authority.setName(1, '練習機器人');
    this.authority.startMatch();
  }

  leave() {
    this.net.close();
    if (this.authority) { this.authority.destroy(); this.authority = null; }
    this.bot = null; this.gs = null; this.phase = 'menu';
    this.remote.alive = false; this.remote.group.visible = false;
    this.exitLock(); this.hud.showHud(false); this.hud.clearBanner(); this.hud.show('menu'); this.hud.menuMsg('');
    this.combat.clearProjectiles(); this.fx.clear();
    for (const m of this.pickMeshes) m.visible = false;
  }

  changeSettings(s) { if (this.authority) this.authority.setSettings(s); }
  startMatch() { if (this.authority && this.gs && this.gs.here[1]) this.authority.startMatch(); }

  // 對裁判提出請求：房主直接呼叫、訪客走網路
  auth(type, data) {
    if (this.net.isHost) { if (this.authority) this.authority.handle(0, type, data); }
    else this.net.send('auth', { ...data, t: type });
  }
  sendPeer(type, data) { this.net.send(type, data); }

  selectWeapon(slot, id) {
    this.sel[slot] = id; store.set('loadout', this.sel); this.sfx.ui();
    this.auth('loadout', this.sel);
    if (this.gs) this.hud.onState(this.gs);
  }
  toggleReady() { if (this.gs) { this.sfx.ui(); this.auth('ready', { v: !this.gs.p[this.me].rd }); } }
  pickBuff(id) { this.sfx.pickup(); this.auth('buff', { id }); }

  // ───────── 主機狀態 → 本機 ─────────
  onGs(gs) {
    const prev = this.gs; this.gs = gs;
    this.phaseEnd = performance.now() + gs.tLeft;
    const changed = !prev || prev.phase !== gs.phase || prev.round !== gs.round;
    if (changed) this.enterPhase(gs);
    const opp = gs.p[1 - this.me];
    this.remote.alive = this.inRound() && opp.al;
    this.remote.group.visible = this.remote.alive;
    for (let i = 0; i < this.pickMeshes.length; i++) this.pickMeshes[i].visible = this.inRound() && !!gs.pk[i];
    this.hud.onState(gs);
  }

  enterPhase(gs) {
    this.phase = gs.phase;
    const h = this.hud;
    if (gs.phase === 'lobby') { this.exitLock(); h.showHud(false); h.clearBanner(); h.show('lobby'); }
    else if (gs.phase === 'loadout') {
      this.exitLock(); h.showHud(false); h.clearBanner(); h.show('loadout');
      this.mouse.l = this.mouse.r = false;
      this.auth('loadout', this.sel);
    } else if (gs.phase === 'countdown') this.startRound(gs);
    else if (gs.phase === 'playing') { h.banner('開戰！', '', 800); this.sfx.beep(true); }
    else if (gs.phase === 'roundEnd') this.onRoundEnd(gs);
    else if (gs.phase === 'matchEnd') {
      this.exitLock(); h.showHud(false); h.clearBanner(); h.show('end');
      if (gs.mw === this.me) this.sfx.win(); else this.sfx.lose();
    }
  }

  startRound(gs) {
    this.round = gs.round;
    this.world.reset(); this.fx.clear();
    const meS = gs.p[this.me];
    this.player.spawn(SPAWNS[(this.me + gs.round) % 2]);
    this.combat.setLoadout(meS.lo, meS.bf);
    this.player.maxAirJumps = this.combat.mods.airJumps;
    const os = SPAWNS[(1 - this.me + gs.round) % 2];
    this.remote.clearBuffer(); this.remote.pos.set(os.x, os.y, os.z); this.remote.yaw = os.yaw; this.remote.lastPos.copy(this.remote.pos);
    this.remote.setColor(TEAM[1 - this.me]); this.remote.setWeapon(gs.p[1 - this.me].lo.p);
    this.deathT = 0; this.shake = 0; this.lastCount = -1; this.keys = {}; this.mouse.l = this.mouse.r = false;
    this.hud.show(null); this.hud.showHud(true); this.hud.clearBanner();
    this.requestLock();
    // 瀏覽器不給自動鎖滑鼠時（例如剛按過 Esc），顯示「點一下繼續」
    setTimeout(() => { if (this.inRound() && !this.locked && !NOLOCK) this.hud.setPaused(true); }, 300);
  }

  onRoundEnd(gs) {
    const r = gs.res || {}, me = this.me, opp = gs.p[1 - me];
    const wn = r.w && WEAPONS[r.w] ? WEAPONS[r.w].name : '';
    if (r.victim === 1 - me) {
      const p = this.remote.pos;
      this.fx.hitSpark(p.x, p.y + 1, p.z, TEAM[1 - me], 40);
    }
    if (r.winner === -1) { this.hud.banner('平手', '時間到，雙方血量相同', 0); return; }
    const sub = r.reason === 'time' ? '時間到，血量較多的一方獲勝'
      : r.reason === 'suicide' ? (r.victim === me ? '你把自己炸死了' : `${opp.n} 把自己炸死了`)
      : r.victim === me ? `${opp.n} 用 ${wn}${r.head ? ' 爆頭' : ''} 擊倒你` : `${wn}${r.head ? ' 爆頭' : ''} 擊倒 ${opp.n}`;
    if (r.winner === me) { this.hud.banner('拿下這一局', sub, 0); this.sfx.kill(); }
    else { this.hud.banner('這局輸了', sub + '　·　下一局可以選一個強化', 0); this.sfx.lose(); }
    this.hud.feed(r.winner === me ? `你 擊倒了 ${opp.n}` : `${opp.n} 擊倒了 你`);
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
  }

  // ───────── 對手的動作 ─────────
  panOf(x, z) {
    const c = this.camera.position, dx = x - c.x, dz = z - c.z, l = Math.hypot(dx, dz) || 1, yaw = this.player.yaw;
    return clamp(((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / l) * 0.8, -1, 1);
  }

  onRemoteFire(d) {
    const def = WEAPONS[d.w];
    if (!def || !this.inRound()) return;
    const rp = this.remote.pos, dist = rp.distanceTo(this.camera.position);
    this.sfx.shot(def.snd, Math.max(1, dist), this.panOf(rp.x, rp.z));
    if (d.v) { this.combat.spawnProjectile(d.w, d.pid, d.o, d.v, false); return; }
    const m = this.remote.muzzle(_v1);
    for (let i = 0; i + 2 < d.e.length; i += 3) this.fx.tracer(m, _v2.set(d.e[i], d.e[i + 1], d.e[i + 2]), 0xffc9a0);
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
    const destroyed = this.world.explode(x, y, z, m.br, m.bp);
    const step = Math.max(1, Math.floor(destroyed.length / 45));
    for (let i = 0; i < destroyed.length; i += step) { const d = destroyed[i]; this.fx.debris(d.x, d.y, d.z, d.type, 3, 1.5); }
    this.fx.explosion(x, y, z, m.rad);
    const dist = _v1.set(x, y, z).distanceTo(this.camera.position);
    this.sfx.explosion(dist, this.panOf(x, z));
    this.shake = Math.min(1.5, this.shake + Math.max(0, 1.2 - dist / 14));
    if (this.inRound() && this.meAlive()) {
      const p = this.player, dx = p.pos.x - x, dy = p.pos.y + 0.9 - y, dz = p.pos.z - z, d = Math.hypot(dx, dy, dz);
      if (d < m.rad && d > 0.01) {
        const f = 1 - d / m.rad, k = (f * m.k) / d;
        p.vel.x += dx * k; p.vel.y += dy * k + 2 * f; p.vel.z += dz * k; p.onGround = false;
      }
    }
  }

  // ───────── 主迴圈 ─────────
  loop() {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const gs = this.gs, inRound = this.inRound(), cam = this.camera, p = this.player, cb = this.combat;
    const meS = gs ? gs.p[this.me] : null, alive = !!(meS && meS.al);

    if (inRound) {
      const act = this.active();
      const canMove = act && alive && this.phase !== 'countdown';
      const k = this.keys, w = cb.w;
      if (alive) {
        p.update(dt, {
          f: canMove ? (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0) : 0,
          r: canMove ? (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0) : 0,
          jump: canMove && !!k.Space,
          speed: (w ? w.def.move : 1) * cb.mods.speed * lerp(1, 0.6, cb.ads),
        });
        if (p.justJumped) this.sfx.jump();
        if (p.justLanded) this.sfx.land();
        if (p.walkPhase - this.stepPhase > Math.PI) { this.stepPhase = p.walkPhase; this.sfx.step(); }
      } else this.deathT = Math.min(1, this.deathT + dt * 2.2);

      this.shake = Math.max(0, this.shake - dt * 3.5);
      const sh = this.shake * this.shake * 0.02;
      const zoom = this.zoom();
      const fov = 2 * Math.atan(Math.tan((this.settings.fov * DEG) / 2) / zoom) / DEG;
      if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
      cam.position.set(p.pos.x, p.eyeY() - this.deathT * 1.15, p.pos.z);
      cam.rotation.set(
        clamp(p.pitch + cb.recP, -1.55, 1.55) + (Math.random() - 0.5) * sh,
        p.yaw + cb.recY + (Math.random() - 0.5) * sh,
        this.deathT * 0.6 + (Math.random() - 0.5) * sh,
      );
      cam.updateMatrixWorld();

      cb.update(dt, { fire: this.mouse.l, firePressed: this.mouse.lp, ads: this.mouse.r, reload: this.reloadPressed }, act && alive && this.phase === 'playing');
      cb.updateProjectiles(dt);
      this.mouse.lp = false; this.reloadPressed = false;

      // 補給品：走過去就向裁判申請
      if (alive && this.phase === 'playing' && gs) {
        for (let i = 0; i < PICKUPS.length; i++) {
          const pk = PICKUPS[i];
          if (!gs.pk[i] || now < this.pickAt[i]) continue;
          if (Math.hypot(p.pos.x - pk.x, p.pos.z - pk.z) < 0.95 && Math.abs(p.pos.y - pk.y) < 1.6) {
            if (pk.type === 'hp' ? meS.hp < meS.mhp : meS.ar < 50) { this.pickAt[i] = now + 400; this.auth('pick', { i }); }
          }
        }
      }

      this.sendAcc += dt;
      if (this.sendAcc >= 1 / NET.SEND_HZ) {
        this.sendAcc = 0;
        this.sendPeer('st', [r3(p.pos.x), r3(p.pos.y), r3(p.pos.z), r3(p.yaw), r3(p.pitch + cb.recP), w ? w.id : 'ar']);
      }

      if (this.phase === 'countdown') {
        const n = Math.ceil((this.phaseEnd - now) / 1000);
        if (n !== this.lastCount && n > 0) { this.lastCount = n; this.hud.banner(String(n), `第 ${gs.round} 局`, 0); this.sfx.beep(false); }
      }

      this.view.update(dt, {
        ads: cb.ads, walkPhase: p.walkPhase, moving: p.onGround ? Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 5) : 0,
        reload: cb.reloadProgress(), draw: cb.drawProgress(), dx: this.mouse.dx, dy: this.mouse.dy, scoped: !!(w && w.def.scope),
      });
      this.mouse.dx = this.mouse.dy = 0;
    } else {
      // 選單背景：鏡頭繞著地圖轉
      this.orbit += dt * 0.07;
      if (Math.abs(cam.fov - 60) > 0.01) { cam.fov = 60; cam.updateProjectionMatrix(); }
      cam.position.set(24 + Math.cos(this.orbit) * 40, 24, 24 + Math.sin(this.orbit) * 40);
      cam.lookAt(24, 3, 24);
    }

    if (this.bot) this.bot.update(dt, now);
    this.remote.update(dt);
    this.fx.update(dt);
    this.world.update();
    const t = now * 0.001;
    for (const m of this.pickMeshes) { if (m.visible) { m.rotation.y = t * 1.6; m.children[0].position.y = Math.sin(t * 2.4) * 0.08; if (m.children[1] && m.children[1].geometry.type === 'BoxGeometry') m.children[1].position.y = m.children[0].position.y; } }

    if (gs && (inRound || this.phase === 'loadout')) {
      const w = cb.w, scoped = !!(w && w.def.scope && cb.ads > 0.8);
      this.hud.frame({
        phase: this.phase, tLeft: this.phaseEnd - now, hp: meS.hp, mhp: meS.mhp, armor: meS.ar, buffs: meS.bf, alive,
        w, slot: cb.cur, other: cb.slots[1 - cb.cur], reload: cb.reloadProgress(), scoped,
        gap: (Math.tan(cb.spread() * DEG) / Math.tan((cam.fov * DEG) / 2)) * (innerHeight / 2),
        net: this.net.mode === 'bot' ? '練習模式' : `延遲 ${this.net.ping} ms`,
      });
    }

    this.renderer.autoClear = true;
    this.renderer.render(this.scene, cam);
    if (inRound && alive) { this.renderer.autoClear = false; this.view.render(this.renderer); }
  }
}

window.__game = new Game();
