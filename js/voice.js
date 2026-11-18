// 內建語音：走 WebRTC（PeerJS 的通話功能），聲音直接點對點傳給對方，不經過任何伺服器。
// 做法是「各打各的」：誰開了麥克風，誰就打一通只送不收的電話給對方；對方接起來只聽。
// mode：'off' 關、'ptt' 按住才說話、'open' 一直開著
export class Voice {
  constructor(net, onChange) {
    this.net = net; this.onChange = onChange || (() => {});
    this.mode = 'off'; this.stream = null; this.out = null; this.inc = null; this.peer = null;
    this.audio = new Audio(); this.audio.autoplay = true; this.vol = 1;
    this.held = false; this.tx = false; this.rx = false; this.err = '';
    this.an = null; this.buf = null; this.actx = null; this.rxT = 0;
  }

  available() { return this.net.mode === 'peer' && !!this.net.peer; }

  // 連線建立（或換了一個 Peer）之後呼叫：開始接聽對方打來的語音
  attach() {
    const peer = this.net.peer;
    if (!peer || peer === this.peer) return;
    this.peer = peer;
    peer.on('call', (call) => {
      if (this.inc) { try { this.inc.close(); } catch { /* 忽略 */ } }
      this.inc = call;
      call.answer();                                   // 只收不送；我的聲音走我自己打出去的那一通
      call.on('stream', (s) => this._play(s));
      call.on('close', () => { if (this.inc === call) { this.inc = null; this.rx = false; this.onChange(); } });
    });
  }

  _play(stream) {
    this.audio.srcObject = stream; this.audio.volume = this.vol;
    const p = this.audio.play(); if (p && p.catch) p.catch(() => {});
    try {                                              // 另外接一個音量計，畫面上才知道對方正在講話
      const AC = window.AudioContext || window.webkitAudioContext;
      this.actx = this.actx || new AC();
      this.an = this.actx.createAnalyser(); this.an.fftSize = 256; this.buf = new Uint8Array(this.an.fftSize);
      this.actx.createMediaStreamSource(stream).connect(this.an);
    } catch { this.an = null; }
  }

  setVolume(v) { this.vol = v; this.audio.volume = v; }

  async setMode(mode) {
    this.mode = mode; this.err = '';
    if (mode === 'off') { this._stopMic(); this.onChange(); return true; }
    if (!this.stream) {
      try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
      catch (e) { this.mode = 'off'; this.err = e && e.name === 'NotAllowedError' ? '瀏覽器沒有允許使用麥克風' : '找不到麥克風'; this.onChange(); return false; }
    }
    this._gate(); this.call();
    this.onChange();
    return true;
  }

  _stopMic() {
    if (this.out) { try { this.out.close(); } catch { /* 忽略 */ } this.out = null; }
    if (this.stream) { for (const t of this.stream.getTracks()) t.stop(); this.stream = null; }
    this.tx = false;
  }

  // 打給對方（已經在通話、或還沒連線就不做事）。每次重新連上都要再打一次
  call() {
    if (!this.stream || !this.available() || !this.net.connected) return;
    const id = this.net.remoteId();
    if (!id) return;
    if (this.out) { try { this.out.close(); } catch { /* 忽略 */ } }
    try { this.out = this.net.peer.call(id, this.stream, { metadata: { voice: 1 } }); } catch { this.out = null; }
  }
  hangup() {
    if (this.out) { try { this.out.close(); } catch { /* 忽略 */ } this.out = null; }
    if (this.inc) { try { this.inc.close(); } catch { /* 忽略 */ } this.inc = null; }
    this.rx = false; this.onChange();
  }

  // 按住說話鍵
  setHeld(h) { if (h === this.held) return; this.held = h; this._gate(); }
  _gate() {
    const on = !!this.stream && (this.mode === 'open' || (this.mode === 'ptt' && this.held));
    if (this.stream) for (const t of this.stream.getAudioTracks()) t.enabled = on;
    if (on !== this.tx) { this.tx = on; this.onChange(); }
  }

  // 每隔一小段時間呼叫：看對方是不是正在講話
  poll(now) {
    if (!this.an || now - this.rxT < 120) return;
    this.rxT = now;
    this.an.getByteTimeDomainData(this.buf);
    let m = 0;
    for (let i = 0; i < this.buf.length; i++) m = Math.max(m, Math.abs(this.buf[i] - 128));
    const rx = !!this.inc && m > 6;
    if (rx !== this.rx) { this.rx = rx; this.onChange(); }
  }

  close() { this._stopMic(); this.hangup(); this.peer = null; }
}
