// 雙人流程測試（同一個瀏覽器兩個分頁，走 BroadcastChannel 或真的 PeerJS）
// 用法：node t3.mjs <截圖資料夾> [peer]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] || 'shots';
mkdirSync(OUT, { recursive: true });
const PEER = process.argv[3] === 'peer';
const Q = PEER ? 'nolock=1' : 'local=1&nolock=1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1100,680', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: 1100, height: 680 }, protocolTimeout: 40000 });
const errs = [];
const mk = async (tag) => {
  // 每位玩家各開一個視窗，背景分頁才不會被暫停
  const cdp = await browser.target().createCDPSession();
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true });
  const target = await browser.waitForTarget((t) => t._targetId === targetId);
  const page = await target.page();
  await page.setViewport({ width: 1100, height: 680 });
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon') && !m.location().url?.includes('favicon')) errs.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', (e) => errs.push(`[${tag} pageerror] ${e.message}\n${e.stack}`));
  return page;
};
const A = await mk('A'), B = await mk('B');
const waitPhase = async (page, ph, ms = 15000) => { await page.waitForFunction((ph) => window.__game && __game.phase === ph, { timeout: ms }, ph); };
const hash = (page) => page.evaluate(() => { const t = __game.world.types, h = __game.world.hp; let a = 0, n = 0, s = 0; for (let i = 0; i < t.length; i++) { if (t[i]) { n++; a = (Math.imul(a, 31) + i * t[i]) | 0; s += h[i]; } } return `${n}/${a}/${Math.round(s)}`; });
const ok = (name, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);

await A.goto(`http://localhost:8765/?${Q}`, { waitUntil: 'load' });
await A.type('#in-name', '阿強');
await A.click('#btn-host');
await waitPhase(A, 'lobby', 20000);
const code = await A.evaluate(() => __game.code);
const link = await A.evaluate(() => __game.inviteLink());
console.log('room', code, link);
await B.goto(link + '&nolock=1', { waitUntil: 'load' });
ok('邀請連結帶入房號', (await B.$eval('#in-code', (e) => e.value)) === code);
await B.$eval('#in-name', (e) => { e.value = ''; });
await B.type('#in-name', '小明');
await B.click('#btn-join');
await waitPhase(B, 'lobby', 25000);
await sleep(500);
ok('大廳看到雙方名字', (await A.$eval('#lb-p1', (e) => e.textContent)) === '小明' && (await B.$eval('#lb-p0', (e) => e.textContent)) === '阿強');
await A.screenshot({ path: OUT + '/n1-lobby-host.png' });
await A.select('#set-target', '3');
await sleep(300);
ok('訪客看到房主改的規則', (await B.evaluate(() => __game.gs.set.target)) === 3);
await A.click('#btn-start');
await waitPhase(A, 'loadout'); await waitPhase(B, 'loadout');
await B.click('.wcard[data-id="shotgun"]'); await A.click('.wcard[data-id="rocket"]');
await sleep(200);
await A.click('#btn-ready'); await B.click('#btn-ready');
await waitPhase(A, 'playing'); await waitPhase(B, 'playing');
await sleep(600);
const s1 = await A.evaluate(() => ({ lo: __game.gs.p.map((p) => p.lo.p), me: __game.player.pos.toArray(), rem: __game.remote.pos.toArray(), vis: __game.remote.group.visible, w: __game.combat.w.id }));
const s1b = await B.evaluate(() => ({ me: __game.player.pos.toArray(), rem: __game.remote.pos.toArray(), w: __game.combat.w.id, vs: document.visibilityState }));
ok('武器選擇同步', s1.lo[0] === 'rocket' && s1.lo[1] === 'shotgun' && s1.w === 'rocket' && s1b.w === 'shotgun', JSON.stringify(s1.lo));
const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
ok('A 看到的 B 位置正確', d(s1.rem, s1b.me) < 0.3 && s1.vis, d(s1.rem, s1b.me).toFixed(3));
ok('B 看到的 A 位置正確', d(s1b.rem, s1.me) < 0.3, d(s1b.rem, s1.me).toFixed(3));
ok('兩人出生點不同', d(s1.me, s1b.me) > 20);
ok('開局地圖一致', (await hash(A)) === (await hash(B)));

// A 朝牆射火箭 → 兩邊地形要一致
const h0 = await hash(A);
await A.evaluate(() => { const p = __game.player; p.yaw += 0.5; p.pitch = -0.1; __game.mouse.lp = true; });
await sleep(1500);
const hA = await hash(A), hB = await hash(B);
ok('火箭有炸掉方塊', hA !== h0, `${h0} → ${hA}`);
ok('爆炸後兩邊地形一致', hA === hB, hB);
await A.screenshot({ path: OUT + '/n2-after-rocket.png' });

// B 用霰彈槍打牆
await B.evaluate(() => { __game.player.pitch = -0.6; __game.mouse.lp = true; });
await sleep(300); await B.evaluate(() => { __game.mouse.lp = true; }); await sleep(1200);
ok('霰彈打地板後兩邊地形一致', (await hash(A)) === (await hash(B)), await hash(B));

// B 傳送到 A 面前並瞄準開槍
const aim = () => { const g = __game, p = g.player, r = g.remote.pos; p.pos.set(r.x + 3, r.y, r.z); p.vel.set(0, 0, 0); const dx = r.x - p.pos.x, dy = r.y + 1.0 - (p.pos.y + 1.62), dz = r.z - p.pos.z, l = Math.hypot(dx, dy, dz); p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.asin(dy / l); };
await B.evaluate(aim); await sleep(400);
await B.evaluate(aim); await B.evaluate(() => { __game.mouse.lp = true; });
await sleep(500);
const hp1 = await A.evaluate(() => __game.gs.p.map((p) => p.hp));
ok('B 的霰彈打中 A', hp1[0] < 100, JSON.stringify(hp1));
await B.screenshot({ path: OUT + '/n3-b-shoots-a.png' });
await A.screenshot({ path: OUT + '/n3-a-hurt.png' });
for (let i = 0; i < 6 && (await A.evaluate(() => __game.phase)) === 'playing'; i++) { await B.evaluate(aim); await B.evaluate(() => { __game.mouse.lp = true; }); await sleep(900); }
await waitPhase(A, 'roundEnd', 8000);
await sleep(300);
const r1 = await A.evaluate(() => ({ res: __game.gs.res, sc: __game.gs.p.map((p) => p.sc) }));
ok('A 被擊殺、B 得 1 分', r1.res.winner === 1 && r1.sc[1] === 1 && r1.sc[0] === 0, JSON.stringify(r1));
await A.screenshot({ path: OUT + '/n4-roundend-loser.png' });
await waitPhase(A, 'loadout', 9000); await waitPhase(B, 'loadout', 9000);
await sleep(400);
const ch = await A.evaluate(() => __game.gs.p[0].ch);
ok('輸家拿到 3 個強化選項', Array.isArray(ch) && ch.length === 3, JSON.stringify(ch));
ok('贏家沒有強化選項', (await B.evaluate(() => __game.gs.p[1].ch)) === null);
await A.screenshot({ path: OUT + '/n5-loadout-buff.png' });
ok('沒選強化前不能準備', await A.$eval('#btn-ready', (e) => e.disabled));
await A.click('.buffcard'); await sleep(400);
const bf = await A.evaluate(() => __game.gs.p[0].bf);
ok('強化已選', bf.length === 1 && bf[0] === ch[0], JSON.stringify(bf));
await A.click('#btn-ready'); await B.click('#btn-ready');
await waitPhase(A, 'playing'); await waitPhase(B, 'playing');
await sleep(500);
const h2A = await hash(A), h2B = await hash(B);
ok('第 2 局地形已重置且一致', h2A === h2B && h2A === h0, `${h2A}`);
const s2 = await A.evaluate(() => ({ round: __game.round, hp: __game.gs.p.map((p) => [p.hp, p.mhp, p.ar]), bf: __game.gs.p[0].bf, me: __game.player.pos.toArray() }));
ok('第 2 局出生點互換', d(s2.me, s1b.me) < 1.5, JSON.stringify(s2.me.map((v) => +v.toFixed(1))));
console.log('round2', JSON.stringify(s2));
await A.screenshot({ path: OUT + '/n6-round2.png' });

// 讓 B 連贏到比賽結束（搶 3）
for (let round = 2; round <= 3; round++) {
  for (let i = 0; i < 8 && (await A.evaluate(() => __game.phase)) === 'playing'; i++) { await B.evaluate(aim); await B.evaluate(() => { __game.mouse.lp = true; }); await sleep(900); }
  await waitPhase(A, 'roundEnd', 8000);
  if (round < 3) {
    await waitPhase(A, 'loadout', 9000); await sleep(300);
    await A.click('.buffcard'); await sleep(300);
    await A.click('#btn-ready'); await B.click('#btn-ready');
    await waitPhase(A, 'playing'); await waitPhase(B, 'playing'); await sleep(400);
  }
}
await waitPhase(A, 'matchEnd', 9000); await waitPhase(B, 'matchEnd', 9000);
await sleep(300);
const fin = await B.evaluate(() => ({ mw: __game.gs.mw, sc: __game.gs.p.map((p) => p.sc), bf: __game.gs.p.map((p) => p.bf), title: document.getElementById('end-title').textContent }));
ok('比賽結束、B 獲勝', fin.mw === 1 && fin.sc[1] === 3 && fin.title === '勝利', JSON.stringify(fin));
await B.screenshot({ path: OUT + '/n7-end-winner.png' });
await A.click('#btn-rematch');
await waitPhase(B, 'loadout', 5000);
ok('再來一場：分數歸零', (await B.evaluate(() => __game.gs.p.map((p) => p.sc).join())) === '0,0');
// 訪客離線 → 房主回大廳
const tClose = Date.now();
await B.close();
let back = false;
for (let i = 0; i < 30 && !back; i++) { await sleep(500); back = (await A.evaluate(() => __game.phase === 'lobby' && __game.gs.here[1] === false)); }
ok('訪客離線後房主回到大廳', back, `偵測花了 ${((Date.now() - tClose) / 1000).toFixed(1)} 秒`);
// 同一個房間可以再讓人加入
const C = await mk('C');
await C.goto(link + '&nolock=1', { waitUntil: 'load' });
await C.click('#btn-join');
await waitPhase(C, 'lobby', 25000); await sleep(600);
ok('斷線後同一房號可重新加入', (await A.evaluate(() => __game.gs.here[1])) === true);
console.log('ping', await A.evaluate(() => __game.net.ping));
console.log('ERRORS:\n' + (errs.join('\n') || '(none)'));
await browser.close();
