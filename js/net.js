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
const DEAD_MS = 8000;         // 這麼久沒收到對方任何東西就當作斷線

// 連線層。三種通道，介面一樣：
//   peer  — WebRTC 點對點（PeerJS 公用訊號伺服器），正式對戰用
//   local — 同一台電腦開好幾個分頁（BroadcastChannel），測試用，網址加 ?local=1
//   bot   — 練習模式，對手是同一頁裡的電腦
//
// 房主是中心：每個訪客只連房主（星狀）。房主最多接 capacity 個訪客（1 對 1 = 1，混戰 = 3），
// 每個訪客有一個座位號 slot（1、2、3；房主是 0），連上時房主先送 ['slot', 座位號]。
// 訊息格式是 [type, data] 或 [type, data, from]：
//   房主 send() 廣播給所有訪客；sendTo(座位, …) 只送一個人。訪客 send() 只送房主。
//   relay 裡的訊息類型（玩家之間的：位置、開槍、爆炸…）房主收到後會轉給其他訪客，第三格標上原本是誰送的。
//   收到訊息時 handler 拿到 (data, from)：from = 送的人的座位號（房主 = 0）。
export class Net {
  constructor() {
    this.h = {}; this.isHost = false; this.connected = false; this.mode = null;
    this.peer = null; this.bc = null; this.bot = null; this.ping = 0;
    this.links = new Map();       // 房主：座位號 → 連線 { send, close, open, lastRecv, ping, peerId }
    this.host_ = null;            // 訪客：連到房主的那條連線（同一個形狀）
    this.capacity = 1; this.slot = 0; this.relay = new Set();
    this._pingTimer = null;
    this.sideBot = null; this.hostId = '';   // sideBot：房主等朋友時陪練的機器人（朋友一連進來就換掉）
  }
  on(type, fn) { this.h[type] = fn; }
  emit(type, data, from = 0) { const f = this.h[type]; if (f) f(data, from); }
  // 現在有幾個人連著（房主：訪客數；訪客：0 或 1）
  count() { return this.isHost ? [...this.links.values()].filter((l) => l.open).length : this.connected ? 1 : 0; }
  slots() { return [...this.links.entries()].filter(([, l]) => l.open).map(([s]) => s); }

  send(type, data) {
    const msg = [type, data];
    if (this.sideBot) { const b = this.sideBot; setTimeout(() => this.sideBot === b && b.recv(msg), 0); return; }
    if (this.mode === 'bot') { setTimeout(() => this.bot && this.bot.recv(msg), 0); return; }
    if (!this.connected) return;
    if (this.isHost) { for (const l of this.links.values()) if (l.open) l.send(msg); }
    else if (this.host_ && this.host_.open) this.host_.send(msg);
  }
  // 房主只送給某一位（裁判的私人訊息：受傷、重生…）。練習模式只有一個對手，等於 send
  sendTo(slot, type, data) {
    if (this.sideBot || this.mode === 'bot') { if (slot === 1) this.send(type, data); return; }
    const l = this.links.get(slot); if (l && l.open) l.send([type, data]);
  }

  // 房主收到某位訪客的訊息
  _recvFrom(slot, msg) {
    const l = this.links.get(slot); if (!l || !Array.isArray(msg)) return;
    l.lastRecv = performance.now();
    if (msg[0] === 'bye') { this._dropSlot(slot); return; }
    if (msg[0] === 'ping') { l.send(['pong', msg[1]]); return; }
    if (msg[0] === 'pong') { l.ping = Math.round(performance.now() - msg[1]); this.ping = Math.max(...[...this.links.values()].map((x) => x.ping || 0)); return; }
    if (this.relay.has(msg[0])) for (const [s, o] of this.links) if (s !== slot && o.open) o.send([msg[0], msg[1], slot]);
    this.emit(msg[0], msg[1], slot);
  }
  // 訪客收到房主的訊息
  _recv(msg) {
    if (!Array.isArray(msg) || !this.host_) return;
    this.host_.lastRecv = performance.now();
    if (msg[0] === 'bye') { this._closed(); return; }
    if (msg[0] === 'full') { this._full && this._full(); this._closed(); return; }
    if (msg[0] === 'ping') { this.host_.send(['pong', msg[1]]); return; }
    if (msg[0] === 'pong') { this.ping = Math.round(performance.now() - msg[1]); return; }
    if (msg[0] === 'slot') { this.slot = msg[1] | 0; if (!this.connected) { this.connected = true; this._beat(); this.emit('_open', this.slot); } if (this._ready) this._ready(); return; }
    this.emit(msg[0], msg[1], (msg[2] | 0) || 0);
  }

  // 心跳：每秒 ping 一次；太久沒收到東西就斷線。
  // 自己這邊卡住的時間（開局建地圖、慢電腦）不算在對方頭上：心跳本身晚了多久，就多等多久
  _beat() {
    clearInterval(this._pingTimer);
    if (this.mode === 'bot') return;
    let tick = performance.now();
    this._pingTimer = setInterval(() => {
      const now = performance.now(), lag = now - tick > 2000 ? now - tick - 1000 : 0;
      tick = now;
      const all = this.isHost ? [...this.links.entries()] : this.host_ ? [[0, this.host_]] : [];
      for (const [s, l] of all) {
        if (!l.open) continue;
        l.lastRecv += lag;
        if (now - l.lastRecv > DEAD_MS) { if (this.isHost) this._dropSlot(s); else { try { l.close(); } catch { /* 忽略 */ } this._closed(); } continue; }
        l.send(['ping', now]);
      }
    }, 1000);
  }

  // ───────── 房主這邊：座位 ─────────
  // 找一個空位（舊連線已經死了但還沒被判定斷線的，先收掉讓出位子）
  _freeSlot() {
    for (let s = 1; s <= this.capacity; s++) {
      const l = this.links.get(s);
      if (!l) return s;
      if (l.dead && l.dead()) this._dropSlot(s);
      if (!this.links.has(s)) return s;
    }
    return -1;
  }
  _addLink(slot, link) {
    link.open = false; link.lastRecv = performance.now(); link.ping = 0;
    this.links.set(slot, link);
  }
  _linkOpen(slot) {
    const l = this.links.get(slot); if (!l || l.open) return;
    l.open = true; l.lastRecv = performance.now();
    this.sideBot = null;                                // 真人連上了：之後的封包一律走真的連線，不再送給陪練機器人
    l.send(['slot', slot]);
    const first = !this.connected;
    this.connected = true; if (first) this._beat();
    this.emit('_open', slot);
  }
  _dropSlot(slot) {
    const l = this.links.get(slot); if (!l) return;
    this.links.delete(slot);
    try { l.close(); } catch { /* 忽略 */ }
    if (!l.open) return;
    if (!this.count()) { this.connected = false; clearInterval(this._pingTimer); }
    this.emit('_close', slot);
  }
  // 房主踢掉某個座位（例如混戰改回 1 對 1 時多出來的人）
  kick(slot) { const l = this.links.get(slot); if (l && l.open) { try { l.send(['full']); } catch { /* 忽略 */ } } this._dropSlot(slot); }

  _closed() {
    if (!this.connected) return;
    this.connected = false; clearInterval(this._pingTimer);
    this.emit('_close', 0);
  }

  // ───────── 建立房間 ─────────
  host(code, local) {
    this.isHost = true; this.slot = 0;
    if (local) return this._hostLocal(code);
    this.mode = 'peer';
    return new Promise((resolve, reject) => {
      let opened = false;
      const peer = this.peer = new Peer(NET.PREFIX + code, { debug: 1, config: ICE });
      peer.on('open', () => { opened = true; resolve(); });
      peer.on('connection', (conn) => {
        const slot = this._freeSlot();
        if (slot < 0) { conn.on('open', () => { try { conn.send(['full']); } catch { /* 忽略 */ } setTimeout(() => conn.close(), 400); }); return; }   // 房間已滿
        this._addLink(slot, { send: (m) => conn.send(m), close: () => conn.close(), dead: () => !conn.open, peerId: conn.peer });
        conn.on('open', () => this._linkOpen(slot));
        conn.on('data', (d) => this._recvFrom(slot, d));
        const gone = () => { const l = this.links.get(slot); if (l && l.peerId === conn.peer) this._dropSlot(slot); };
        conn.on('close', gone); conn.on('error', gone);
      });
      peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch { /* 已關閉 */ } }, 1500); });
      peer.on('error', (e) => {
        if (!opened) reject(new Error(e.type === 'unavailable-id' ? '房號被占用，請再試一次' : '無法連到配對伺服器（' + e.type + '）'));
        else this.emit('_error', e.type);
      });
    });
  }

  // ───────── 加入房間 ─────────
  // step(文字)：連線進度，給選單顯示（連配對伺服器 → 跟房主打洞 → 連上）。拿到座位號才算連上
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
      this._ready = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
      this._full = () => fail('房間已經滿了');
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
        const link = this.host_ = { send: (m) => conn.send(m), close: () => conn.close(), open: false, lastRecv: performance.now(), peerId: conn.peer };
        conn.on('open', () => { link.open = true; link.lastRecv = performance.now(); step('連上了，等房主分配位子…'); });
        conn.on('data', (d) => this._recv(d));
        const gone = () => { if (this.host_ === link) { link.open = false; this._closed(); } };
        conn.on('close', gone); conn.on('error', gone);
      });
      peer.on('error', (e) => {
        clearTimeout(timer);
        if (!done) fail(e.type === 'peer-unavailable' ? '找不到這個房間：確認房號，房主要停在房間裡（別關掉分頁）' : ['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type) ? why() : '連線失敗（' + e.type + '）');
        else this.emit('_error', e.type);
      });
    });
  }

  // ───────── 同機測試（BroadcastChannel）─────────
  // 訪客 → 房主：{ g: 訪客代號, sys | m }；房主 → 訪客：{ to: 訪客代號, sys | m }（大家都收得到，各自只看寫給自己的）
  _hostLocal(code) {
    this.mode = 'local';
    const bc = this.bc = new BroadcastChannel(NET.PREFIX + code), byG = new Map();   // 訪客代號 → 座位號
    bc.onmessage = (e) => {
      const d = e.data; if (!d || !d.g) return;
      if (d.sys === 'join') {
        if (byG.has(d.g) && this.links.has(byG.get(d.g))) { bc.postMessage({ to: d.g, sys: 'welcome' }); return; }
        const slot = this._freeSlot();
        if (slot < 0) { bc.postMessage({ to: d.g, m: ['full'] }); return; }
        byG.set(d.g, slot);
        this._addLink(slot, { send: (m) => bc.postMessage({ to: d.g, m }), close: () => bc.postMessage({ to: d.g, sys: 'bye' }), g: d.g });
        bc.postMessage({ to: d.g, sys: 'welcome' });
        this._linkOpen(slot);
      } else if (byG.has(d.g)) {
        const slot = byG.get(d.g), l = this.links.get(slot);
        if (!l || l.g !== d.g) return;
        if (d.sys === 'bye') { byG.delete(d.g); this._dropSlot(slot); } else if (d.m) this._recvFrom(slot, d.m);
      }
    };
    addEventListener('pagehide', () => { if (this.bc === bc) for (const l of this.links.values()) l.close(); });
    return Promise.resolve();
  }
  _joinLocal(code) {
    this.mode = 'local';
    const bc = this.bc = new BroadcastChannel(NET.PREFIX + code), g = Math.random().toString(36).slice(2, 10);
    const link = this.host_ = { send: (m) => bc.postMessage({ g, m }), close: () => bc.postMessage({ g, sys: 'bye' }), open: false, lastRecv: performance.now() };
    return new Promise((resolve, reject) => {
      const iv = setInterval(() => bc.postMessage({ g, sys: 'join' }), 250);
      const to = setTimeout(() => { clearInterval(iv); reject(new Error('找不到本機房間')); }, 8000);
      this._ready = () => { clearInterval(iv); clearTimeout(to); resolve(); };
      this._full = () => { clearInterval(iv); clearTimeout(to); reject(new Error('房間已經滿了')); };
      bc.onmessage = (e) => {
        const d = e.data; if (!d || d.to !== g) return;
        if (d.sys === 'welcome') { link.open = true; link.lastRecv = performance.now(); }
        else if (d.sys === 'bye') this._closed();
        else if (d.m) this._recv(d.m);
      };
      addEventListener('pagehide', () => this.bc === bc && link.close());
    });
  }

  // ───────── 練習（對手是 bot）─────────
  hostBot(bot) {
    this.isHost = true; this.mode = 'bot'; this.bot = bot; this.slot = 0;
    bot.link = (msg) => setTimeout(() => this.mode === 'bot' && this.emit(msg[0], msg[1], 1), 0);
    this.connected = true; this.emit('_open', 1);
  }

  // 房主一個人熱身：先塞一個機器人當對手，真人連進來時由 main.js 把它拿掉
  attachBot(bot) { this.sideBot = bot; bot.link = (msg) => setTimeout(() => this.sideBot === bot && this.emit(msg[0], msg[1], 1), 0); }
  detachBot() { this.sideBot = null; }
  // 對方的 PeerJS 代號（語音通話要用；只有 1 對 1 有語音）
  remoteId() { if (this.mode !== 'peer') return ''; if (!this.isHost) return this.hostId; const l = this.links.get(1); return l && l.open ? l.peerId : ''; }

  close() {
    clearInterval(this._pingTimer);
    const bye = (l) => { if (l && l.open) { try { l.send(['bye']); } catch { /* 忽略 */ } } };
    if (this.isHost) for (const l of this.links.values()) bye(l); else bye(this.host_);
    if (this.mode === 'local') { for (const l of this.links.values()) { try { l.close(); } catch { /* 忽略 */ } } if (this.host_) { try { this.host_.close(); } catch { /* 忽略 */ } } }
    this.connected = false;
    if (this.mode === 'peer') { for (const l of this.links.values()) { try { l.close(); } catch { /* 忽略 */ } } if (this.host_) { try { this.host_.close(); } catch { /* 忽略 */ } } }
    if (this.bc) { try { this.bc.close(); } catch { /* 忽略 */ } this.bc = null; }
    if (this.peer) { try { this.peer.destroy(); } catch { /* 忽略 */ } this.peer = null; }
    this.links.clear(); this.host_ = null; this._ready = this._full = null;
    this.bot = null; this.sideBot = null; this.mode = null; this.slot = 0;
  }
}
