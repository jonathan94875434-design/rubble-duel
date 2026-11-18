// 擊殺回放：平常一直記錄最近幾秒「對手的位置與視角」和「我的位置」，
// 被擊倒之後從對手的眼睛重播一次。地形不會倒帶（牆上的洞會提早出現），其餘照實重播。
const KEEP = 9000, STEP = 1000 / 30;

export class Replay {
  constructor() { this.f = []; this.ev = []; this.last = 0; this.playing = false; this.t0 = 0; this.t1 = 0; this.start = 0; this.ei = 0; }

  clear() { this.f.length = 0; this.ev.length = 0; this.playing = false; this.last = 0; }

  // 每幀呼叫；k = 對手（RemotePlayer）、p = 我（Player）
  rec(now, k, p) {
    if (this.playing || now - this.last < STEP) return;
    this.last = now;
    this.f.push({ t: now, kx: k.pos.x, ky: k.pos.y, kz: k.pos.z, kyaw: k.yaw, kp: k.pitch, kcr: k.cr, kw: k.weapon, vx: p.pos.x, vy: p.pos.y, vz: p.pos.z, vyaw: p.yaw, vcr: p.crouched ? 1 : 0 });
    while (this.f.length && now - this.f[0].t > KEEP) this.f.shift();
    while (this.ev.length && now - this.ev[0].t > KEEP) this.ev.shift();
  }
  // 記一個事件（對手開槍、丟東西…）。data 會在重播時原封不動交回去
  event(now, type, data) { if (!this.playing) this.ev.push({ t: now, type, data }); }

  // 從 t0 重播到 t1（都是當初記錄時的時間戳）
  play(t0, t1, now) {
    if (this.f.length < 5) return false;
    this.t0 = Math.max(t0, this.f[0].t); this.t1 = Math.min(t1, this.f[this.f.length - 1].t);
    if (this.t1 - this.t0 < 600) return false;
    this.start = now; this.playing = true;
    this.ei = this.ev.findIndex((e) => e.t >= this.t0); if (this.ei < 0) this.ei = this.ev.length;
    return true;
  }
  stop() { this.playing = false; }

  // 回傳這一刻的畫面資料（兩格之間內插）；播完回傳 null
  sample(now, onEvent) {
    if (!this.playing || this.f.length < 2) { this.playing = false; return null; }
    const t = this.t0 + (now - this.start);
    if (t >= this.t1) { this.playing = false; return null; }
    while (this.ei < this.ev.length && this.ev[this.ei].t <= t) onEvent(this.ev[this.ei++]);
    const f = this.f;
    let i = 0;
    while (i < f.length - 2 && f[i + 1].t < t) i++;
    const a = f[i], b = f[i + 1], k = Math.max(0, Math.min(1, (t - a.t) / Math.max(1, b.t - a.t)));
    const L = (x, y) => x + (y - x) * k;
    const A = (x, y) => { let d = (y - x) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return x + d * k; };
    return {
      kx: L(a.kx, b.kx), ky: L(a.ky, b.ky), kz: L(a.kz, b.kz), kyaw: A(a.kyaw, b.kyaw), kp: L(a.kp, b.kp), kcr: L(a.kcr, b.kcr), kw: a.kw,
      vx: L(a.vx, b.vx), vy: L(a.vy, b.vy), vz: L(a.vz, b.vz), vyaw: A(a.vyaw, b.vyaw), vcr: a.vcr, left: (this.t1 - t) / 1000,
    };
  }
}
