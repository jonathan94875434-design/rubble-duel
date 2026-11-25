// 雙人流程測試（同一個瀏覽器兩個分頁，走 BroadcastChannel 或真的 PeerJS）
// 用法：node t3.mjs <截圖資料夾> [peer]
import puppeteer from 'puppeteer-core';
import { load, reload, CHROME } from './load.mjs';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] || 'shots';
mkdirSync(OUT, { recursive: true });
const PEER = process.argv[3] === 'peer';
const Q = PEER ? 'nolock=1' : 'local=1&nolock=1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || 'http://localhost:8765/').replace(/\/?$/, '/'); // 要測線上版就設 BASE=網址
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
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

await load(A, `${BASE}?${Q}`);
await A.type('#in-name', '阿強');
await A.click('#btn-host');
await waitPhase(A, 'lobby', 20000);
const code = await A.evaluate(() => __game.code);
const link = await A.evaluate(() => __game.inviteLink());
console.log('room', code, link);
await load(B, link + '&nolock=1');
ok('邀請連結帶入房號', (await B.$eval('#in-code', (e) => e.value)) === code);
await B.$eval('#in-name', (e) => { e.value = ''; });
await B.type('#in-name', '小明');
await B.click('#btn-join');
await waitPhase(B, 'lobby', 25000);
await sleep(500);
ok('大廳看到雙方名字', (await A.$eval('#lb-p1', (e) => e.textContent)) === '小明' && (await B.$eval('#lb-p0', (e) => e.textContent)) === '阿強');
await A.screenshot({ path: OUT + '/n1-lobby-host.png' });
await A.select('#set-target', '3');
await A.select('#set-map', 'plaza'); // 後面的座標測試照廢墟廣場寫
await sleep(300);
ok('訪客看到房主改的規則', (await B.evaluate(() => __game.gs.set.target)) === 3);
ok('訪客的背景換成房主指定的地圖', (await B.evaluate(() => __game.world.mapId)) === 'plaza');
// 造型同步：B 換造型，A 看到的對手要跟著變
await B.evaluate(() => { __game.setLook('skin', 'neon'); __game.setLook('wskin', 'gold'); });
// remote.wskin 是整個造型物件（刀型、特殊塗裝也在裡面）；機器慢的時候要等一下才會傳到
const lookOf = () => { const r = __game.remote, w = r.wskin; return r.skin + '/' + (w && typeof w === 'object' ? w.w : w); };
await A.waitForFunction((f) => eval(f)() === 'neon/gold', { timeout: 8000 }, '(' + lookOf + ')').catch(() => {});
ok('造型同步給對手', (await A.evaluate(lookOf)) === 'neon/gold', await A.evaluate(() => JSON.stringify(__game.gs.p[1].lk)));
await A.click('#btn-start');
await waitPhase(A, 'loadout'); await waitPhase(B, 'loadout');
// ── 經濟：第 1 局是手槍局 ──
ok('開場 $800', (await A.evaluate(() => __game.gs.p.map((p) => p.$).join())) === '800,800');
await A.click('.wcard[data-id="rocket"]'); await sleep(150);
ok('第 1 局不能買主武器', (await A.evaluate(() => __game.sel.p)) === null);
// A：只買左輪（先把預設的防彈衣取消）；B：衝鋒手槍 + 閃光彈
const clearGear = () => { const g = __game; if (g.sel.armor) g.buy('armor'); for (const k of ['he', 'smoke', 'flash', 'molotov']) while (g.sel[k]) g.buy(k, null, true); };   // 投擲物不限數量：用「少買一個」清掉
await A.evaluate(clearGear);
await A.click('.wcard[data-id="revolver"]');
await B.evaluate(clearGear); await B.click('.wcard[data-id="mp"]'); await B.evaluate(() => __game.buy('flash'));
await sleep(300);
await A.screenshot({ path: OUT + '/n1b-buy-r1.png' });
await A.click('#btn-ready'); await B.click('#btn-ready');
await waitPhase(A, 'playing'); await waitPhase(B, 'playing');
await sleep(600);
const s1 = await A.evaluate(() => ({ lo: __game.gs.p.map((p) => p.lo.s), money: __game.gs.p.map((p) => p.$), me: __game.player.pos.toArray(), rem: __game.remote.pos.toArray(), vis: __game.remote.group.visible, w: __game.combat.w.id, remW: __game.remote.weapon }));
const s1b = await B.evaluate(() => ({ me: __game.player.pos.toArray(), rem: __game.remote.pos.toArray(), w: __game.combat.w.id, vs: document.visibilityState }));
ok('買的武器同步（含對手手上拿的槍）', s1.lo[0] === 'revolver' && s1.lo[1] === 'mp' && s1.w === 'revolver' && s1b.w === 'mp' && s1.remW === 'mp', JSON.stringify(s1.lo));
ok('開局結帳扣錢', s1.money.join() === '200,200', s1.money.join());
// 後面測地形同步要用火箭和霰彈槍：直接塞給他們（不走商店）
await A.evaluate(() => __game.combat.setLoadout({ p: 'rocket', s: 'pistol' }, []));
await B.evaluate(() => __game.combat.setLoadout({ p: 'shotgun', s: 'pistol', flash: 1, he: 1 }, []));
const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
ok('A 看到的 B 位置正確', d(s1.rem, s1b.me) < 0.3 && s1.vis, d(s1.rem, s1b.me).toFixed(3));
ok('B 看到的 A 位置正確', d(s1b.rem, s1.me) < 0.3, d(s1b.rem, s1.me).toFixed(3));
ok('兩人出生點不同', d(s1.me, s1b.me) > 20);
ok('開局地圖一致', (await hash(A)) === (await hash(B)));
// 蹲下狀態同步（影響受擊判定盒）
await B.evaluate(() => { __game.keys.KeyC = true; }); await sleep(500);
ok('B 蹲下，A 看到對手是蹲著的', await A.evaluate(() => __game.remote.crouched && __game.remote.cr > 0.8));
await B.evaluate(() => { __game.keys.KeyC = false; }); await sleep(400);
ok('B 站起來，A 也同步', await A.evaluate(() => !__game.remote.crouched));

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

// ── 投擲物同步 ──
// B 朝腳邊丟手榴彈再走開：兩邊地形要一致
const hBefore = await hash(A);
await B.evaluate(() => { const p = __game.player; p.pitch = -1.2; __game.combat.throwNade('he'); });
await sleep(400);
await B.evaluate(() => { const p = __game.player; p.pos.x += 8; p.vel.set(0, 0, 0); });
await sleep(2200);
ok('手榴彈炸開地形，兩邊一致', (await hash(A)) !== hBefore && (await hash(A)) === (await hash(B)), await hash(B));
// B 把閃光彈丟到 A 面前：A 的畫面要變白，B 會看到「閃到」的提示
await B.evaluate(() => { const g = __game, p = g.player, r = g.remote.pos; const f = [-Math.sin(g.remote.yaw), -Math.cos(g.remote.yaw)]; p.pos.set(r.x + f[0] * 7, r.y, r.z + f[1] * 7); p.vel.set(0, 0, 0); p.yaw = g.remote.yaw + Math.PI; p.pitch = 0.1; g.keys.KeyS = false; });
await sleep(350);
await B.evaluate(() => { __game.combat.throwAt = 0; __game.combat.throwNade('flash'); });
await sleep(1750);
const fl = await A.evaluate(() => +document.getElementById('flashfx').style.opacity);
const feedB = await B.evaluate(() => document.getElementById('feed').textContent);
ok('閃光彈閃到對手（A 畫面變白）', fl > 0.4, 'opacity ' + fl);
ok('丟的人看到「閃到」提示', feedB.includes('閃到'), feedB);
await A.screenshot({ path: OUT + '/n2b-flashed.png' });

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
const mon = await A.evaluate(() => ({ m: __game.gs.p.map((p) => p.$), inc: __game.gs.res.inc }));
ok('發錢：輸家 +3000、贏家 +2000', mon.inc.join() === '3000,2000' && mon.m.join() === '3200,2200', JSON.stringify(mon));
// A 用輸家的錢買步槍 + 防彈衣
await A.evaluate(() => { const g = __game; for (const k of ['he', 'smoke', 'flash', 'molotov']) while (g.sel[k]) g.buy(k, null, true); g.buy('s', 'pistol'); if (g.sel.p !== 'ar') g.buy('p', 'ar'); if (!g.sel.armor) g.buy('armor'); });
await sleep(300);
ok('第 2 局可以買主武器', (await A.evaluate(() => __game.sel.p + ':' + __game.sel.armor)) === 'ar:1');
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
const s2 = await A.evaluate(() => ({ round: __game.round, hp: __game.gs.p.map((p) => [p.hp, p.mhp, p.ar]), bf: __game.gs.p[0].bf, me: __game.player.pos.toArray(), slots: __game.combat.slots.map((x) => x && x.id), money: __game.gs.p[0].$ }));
ok('第 2 局：A 拿到步槍與 50 護甲、錢扣掉', s2.slots[0] === 'ar' && s2.hp[0][2] === 50 && s2.money === 100, JSON.stringify(s2.slots) + ' $' + s2.money);
ok('第 2 局出生點互換', d(s2.me, s1b.me) < 1.5, JSON.stringify(s2.me.map((v) => +v.toFixed(1))));
console.log('round2', JSON.stringify(s2));
await A.screenshot({ path: OUT + '/n6-round2.png' });

// 讓 B 連贏到比賽結束（搶 3）
for (let round = 2; round <= 3; round++) {
  await B.evaluate(() => __game.combat.setLoadout({ p: 'shotgun', s: 'pistol' }, []));
  for (let i = 0; i < 12 && (await A.evaluate(() => __game.phase)) === 'playing'; i++) { await B.evaluate(aim); await B.evaluate(() => { __game.mouse.lp = true; }); await sleep(900); }
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
ok('再來一場：造型還在', (await A.evaluate(() => __game.remote.skin)) === 'neon');
// 訪客離線 → 房主回大廳
const tClose = Date.now();
await B.close();
let back = false;
for (let i = 0; i < 30 && !back; i++) { await sleep(500); back = (await A.evaluate(() => __game.phase === 'lobby' && __game.gs.here[1] === false)); }
ok('訪客離線後房主回到大廳', back, `偵測花了 ${((Date.now() - tClose) / 1000).toFixed(1)} 秒`);
// 同一個房間可以再讓人加入
const C = await mk('C');
await load(C, link + '&nolock=1');
await C.click('#btn-join');
await waitPhase(C, 'lobby', 25000); await sleep(600);
ok('斷線後同一房號可重新加入', (await A.evaluate(() => __game.gs.here[1])) === true);
console.log('ping', await A.evaluate(() => __game.net.ping));
console.log('ERRORS:\n' + (errs.join('\n') || '(none)'));
await browser.close();
