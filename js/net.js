import { NET } from './config.js';

// 打洞用的伺服器（兩邊各自問「我在外面看起來是哪個位址」），和直連不通時的中繼。
// 中繼是 PeerJS 官方免費提供的（帳號密碼是 PeerJS 內建的公開預設值，不是祕密）；多加 TCP 的連法，擋 UDP 的網路也有機會連上。
// 一定要整份寫出來：傳了 config 就會取代 PeerJS 原本的預設值。
const ICE = { iceServers: [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: ['turn:us-0.turn.peerjs.com:3478', 'turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478?transport=tcp', 'turn:eu-0.turn.peerjs.com:3478?transport=tcp'], username: 'peerjs', credential: 'peerjsp' },
] };
const JOIN_TIMEOUT = 30000;   // 跨國走中繼比較慢，不要太早放棄

// 連線層。三種通道，介面一樣：
//   peer  — WebRTC 點對點（PeerJS 公用訊號伺服器），正式對戰用
//   local — 同一台電腦開兩個分頁（BroadcastChannel），測試用，網址加 ?local=1
//   bot   — 練習模式，對手是同一頁裡的電腦
// 訊息格式一律是 [type, data]
export class Net {
  constructor() {
    this.h = {}; this.isHost = false; this.connected = false; this.mode = null;
    this.peer = null; this.conn = null; this.bc = null; this.bot = null; this.ping = 0; this.lastRecv = 0;
    this._pingTimer = null;
    this.sideBot = null; this.hostId = '';   // sideBot：房主等朋友時陪練的機器人（朋友一連進來就換掉）
  }
  on(type, fn) { this.h[type] = fn; }
  emit(type, data) { const f = this.h[type]; if (f) f(data); }

  send(type, data) {
    const msg = [type, data];
    if (this.sideBot) { const b = this.sideBot; setTimeout(() => this.sideBot === b && b.recv(msg), 0); return; }
    if (!this.connected) return;
    if (this.mode === 'peer') { if (this.conn && this.conn.open) this.conn.send(msg); }
    else if (this.mode === 'local') this.bc.postMessage({ from: this.isHost ? 'h' : 'g', m: msg });
    else if (this.mode === 'bot') setTimeout(() => this.bot && this.bot.recv(msg), 0);
  }
  _recv(msg) {
    if (!Array.isArray(msg)) return;
    this.lastRecv = performance.now();
    if (msg[0] === 'bye') { this._drop(); return; }
    if (msg[0] === 'ping') { this.send('pong', msg[1]); return; }
    if (msg[0] === 'pong') { this.ping = Math.round(performance.now() - msg[1]); return; }
    this.emit(msg[0], msg[1]);
  }
  _open() {
    if (this.connected) return;
    this.sideBot = null;                                // 真人連上了：之後的封包一律走真的連線，不再送給陪練機器人
    this.connected = true; this.lastRecv = performance.now();
    clearInterval(this._pingTimer);
    let tick = performance.now();
    if (this.mode !== 'bot') this._pingTimer = setInterval(() => {
      // 對方關掉分頁時 WebRTC 不一定會馬上通知，所以自己用心跳判斷。
      // 自己這邊卡住的時間（開局建地圖、慢電腦）不算在對方頭上：心跳本身晚了多久，就多等多久
      const now = performance.now();
      if (now - tick > 2000) this.lastRecv += now - tick - 1000;
      tick = now;
      if (now - this.lastRecv > 8000) { this._drop(); return; }
      this.send('ping', now);
    }, 1000);
    this.emit('_open');
  }
  _closed() {
    if (!this.connected) return;
    this.connected = false; clearInterval(this._pingTimer);
    this.emit('_close');
  }

  _drop() {
    const c = this.conn; this.conn = null;
    if (c) { try { c.close(); } catch { /* 忽略 */ } }
    this._closed();
  }

  // ───────── 建立房間 ─────────
  host(code, local) {
    this.isHost = true;
    if (local) return this._hostLocal(code);
    this.mode = 'peer';
    return new Promise((resolve, reject) => {
      let opened = false;
      const peer = this.peer = new Peer(NET.PREFIX + code, { debug: 1, config: ICE });
      peer.on('open', () => { opened = true; resolve(); });
      peer.on('connection', (conn) => {
        if (this.conn && this.conn.open) { conn.on('open', () => conn.close()); return; } // 房間已滿
        if (this.connected) this._closed(); // 舊連線已死但還沒被判定斷線：先收尾，新對手才會從大廳開始
        this._wire(conn);
      });
      peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch { /* 已關閉 */ } }, 1500); });
      peer.on('error', (e) => {
        if (!opened) reject(new Error(e.type === 'unavailable-id' ? '房號被占用，請再試一次' : '無法連到配對伺服器（' + e.type + '）'));
        else this.emit('_error', e.type);
      });
    });
  }

  // ───────── 加入房間 ─────────
  // step(文字)：連線進度，給選單顯示（連配對伺服器 → 跟房主打洞 → 連上）
  join(code, local, step = () => {}) {
    this.isHost = false;
    if (local) return this._joinLocal(code);
    this.mode = 'peer'; this.hostId = NET.PREFIX + code;
    return new Promise((resolve, reject) => {
      let done = false, stage = 'signal', ice = '', kinds = new Set();
      const fail = (m) => { if (!done) { done = true; clearTimeout(timer); reject(new Error(m)); } };
      // 失敗時說清楚卡在哪一段：連不到配對伺服器、還是兩邊的網路打不通（有沒有拿到中繼位址）
      const why = () => stage === 'signal'
        ? '連不到配對伺服器（0.peerjs.com）：可能是網路擋住了，或伺服器正忙，過一下再試'
        : `找到房間了，但連不上房主${ice ? `（${ice}）` : ''}：雙方網路沒辦法直接連線${kinds.has('relay') ? '，走中繼也失敗' : '，也連不上中繼伺服器'}。換個網路（例如手機熱點）、關掉 VPN，或換對方開房間再試`;
      const timer = setTimeout(() => fail(why()), JOIN_TIMEOUT);
      step('連線中：連配對伺服器…');
      const peer = this.peer = new Peer(undefined, { debug: 1, config: ICE });
      peer.on('open', () => {
        stage = 'ice'; step('找到配對伺服器，正在跟房主建立連線（跨國可能要十幾秒）…');
        const conn = peer.connect(NET.PREFIX + code, { reliable: true, serialization: 'json' });
        const pc = conn.peerConnection;
        if (pc && pc.addEventListener) {
          pc.addEventListener('icecandidate', (e) => { if (e.candidate && e.candidate.type) kinds.add(e.candidate.type); });
          pc.addEventListener('iceconnectionstatechange', () => { ice = pc.iceConnectionState; if (ice === 'failed') fail(why()); });
        }
        this._wire(conn, () => { if (!done) { done = true; clearTimeout(timer); resolve(); } });
      });
      peer.on('error', (e) => {
        clearTimeout(timer);
        if (!done) fail(e.type === 'peer-unavailable' ? '找不到這個房間：確認房號，房主要停在房間裡（別關掉分頁）' : ['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type) ? why() : '連線失敗（' + e.type + '）');
        else this.emit('_error', e.type);
      });
    });
  }

  _wire(conn, onOpen) {
    this.conn = conn;
    conn.on('open', () => { this._open(); if (onOpen) onOpen(); });
    conn.on('data', (d) => this._recv(d));
    conn.on('close', () => { if (this.conn === conn) { this.conn = null; this._closed(); } });
    conn.on('error', () => { if (this.conn === conn) { this.conn = null; this._closed(); } });
  }

  // ───────── 同機測試 ─────────
  _hostLocal(code) {
    this.mode = 'local';
    this.bc = new BroadcastChannel(NET.PREFIX + code);
    this.bc.onmessage = (e) => {
      const d = e.data;
      if (d.sys === 'join') { this.bc.postMessage({ sys: 'welcome' }); this._open(); }
      else if (d.sys === 'bye' && d.from === 'g') this._closed();
      else if (d.from === 'g') this._recv(d.m);
    };
    addEventListener('pagehide', () => this.bc && this.bc.postMessage({ sys: 'bye', from: 'h' }));
    return Promise.resolve();
  }
  _joinLocal(code) {
    this.mode = 'local';
    this.bc = new BroadcastChannel(NET.PREFIX + code);
    return new Promise((resolve, reject) => {
      const iv = setInterval(() => this.bc.postMessage({ sys: 'join' }), 250);
      const to = setTimeout(() => { clearInterval(iv); reject(new Error('找不到本機房間')); }, 8000);
      this.bc.onmessage = (e) => {
        const d = e.data;
        if (d.sys === 'welcome') { if (!this.connected) { clearInterval(iv); clearTimeout(to); this._open(); resolve(); } }
        else if (d.sys === 'bye' && d.from === 'h') this._closed();
        else if (d.from === 'h') this._recv(d.m);
      };
      addEventListener('pagehide', () => this.bc && this.bc.postMessage({ sys: 'bye', from: 'g' }));
    });
  }

  // ───────── 練習（對手是 bot）─────────
  hostBot(bot) {
    this.isHost = true; this.mode = 'bot'; this.bot = bot;
    bot.link = (msg) => setTimeout(() => this.mode === 'bot' && this._recv(msg), 0);
    this._open();
  }

  // 房主一個人熱身：先塞一個機器人當對手，真人連進來時由 main.js 把它拿掉
  attachBot(bot) { this.sideBot = bot; bot.link = (msg) => setTimeout(() => this.sideBot === bot && this.emit(msg[0], msg[1]), 0); }
  detachBot() { this.sideBot = null; }
  // 對方的 PeerJS 代號（語音通話要用）
  remoteId() { return this.mode !== 'peer' ? '' : this.isHost ? (this.conn ? this.conn.peer : '') : this.hostId; }

  close() {
    clearInterval(this._pingTimer);
    if (this.connected && this.mode === 'peer' && this.conn && this.conn.open) { try { this.conn.send(['bye']); } catch { /* 忽略 */ } }
    this.connected = false;
    if (this.bc) { try { this.bc.postMessage({ sys: 'bye', from: this.isHost ? 'h' : 'g' }); this.bc.close(); } catch { /* 忽略 */ } this.bc = null; }
    if (this.conn) { try { this.conn.close(); } catch { /* 忽略 */ } this.conn = null; }
    if (this.peer) { try { this.peer.destroy(); } catch { /* 忽略 */ } this.peer = null; }
    this.bot = null; this.sideBot = null; this.mode = null;
  }
}
