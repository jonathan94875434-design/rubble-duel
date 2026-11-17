import { NET } from './config.js';

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
  }
  on(type, fn) { this.h[type] = fn; }
  emit(type, data) { const f = this.h[type]; if (f) f(data); }

  send(type, data) {
    if (!this.connected) return;
    const msg = [type, data];
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
    this.connected = true; this.lastRecv = performance.now();
    clearInterval(this._pingTimer);
    if (this.mode !== 'bot') this._pingTimer = setInterval(() => {
      // 對方關掉分頁時 WebRTC 不一定會馬上通知，所以自己用心跳判斷
      if (performance.now() - this.lastRecv > 8000) { this._drop(); return; }
      this.send('ping', performance.now());
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
      const peer = this.peer = new Peer(NET.PREFIX + code, { debug: 1 });
      peer.on('open', () => { opened = true; resolve(); });
      peer.on('connection', (conn) => {
        if (this.conn && this.conn.open) { conn.on('open', () => conn.close()); return; } // 房間已滿
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
  join(code, local) {
    this.isHost = false;
    if (local) return this._joinLocal(code);
    this.mode = 'peer';
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = (m) => { if (!done) { done = true; reject(new Error(m)); } };
      const peer = this.peer = new Peer(undefined, { debug: 1 });
      const timer = setTimeout(() => fail('連線逾時：房主可能還沒開房，或雙方網路無法直連'), 15000);
      peer.on('open', () => {
        const conn = peer.connect(NET.PREFIX + code, { reliable: true, serialization: 'json' });
        this._wire(conn, () => { if (!done) { done = true; clearTimeout(timer); resolve(); } });
      });
      peer.on('error', (e) => {
        clearTimeout(timer);
        if (!done) fail(e.type === 'peer-unavailable' ? '找不到這個房間，請確認房號' : '連線失敗（' + e.type + '）');
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

  close() {
    clearInterval(this._pingTimer);
    if (this.connected && this.mode === 'peer' && this.conn && this.conn.open) { try { this.conn.send(['bye']); } catch { /* 忽略 */ } }
    this.connected = false;
    if (this.bc) { try { this.bc.postMessage({ sys: 'bye', from: this.isHost ? 'h' : 'g' }); this.bc.close(); } catch { /* 忽略 */ } this.bc = null; }
    if (this.conn) { try { this.conn.close(); } catch { /* 忽略 */ } this.conn = null; }
    if (this.peer) { try { this.peer.destroy(); } catch { /* 忽略 */ } this.peer = null; }
    this.bot = null; this.mode = null;
  }
}
