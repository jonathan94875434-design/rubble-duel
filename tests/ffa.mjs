// 混戰（3～4 人，1 打 1 打 1 打 1）：同一個瀏覽器開 3 個視窗走同機通道
// 開房 → 兩個人加入 → 房主選混戰 → 開打；位置同步、指定目標的命中、有人倒下回合繼續、最後一個人得分、毒圈扣血、死後觀戰、有人離開
// 用法：node ffa.mjs [截圖資料夾]
import puppeteer from 'puppeteer-core';
import { CHROME } from './load.mjs';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] || 'shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || 'http://localhost:8765/').replace(/\/?$/, '/');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--window-size=720,450', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: 720, height: 450 }, protocolTimeout: 600000 });
const errs = [];
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`); };
// 每位玩家各開一個視窗（背景分頁不會跑畫面）
const mk = async (tag) => {
  const cdp = await browser.target().createCDPSession();
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true });
  const target = await browser.waitForTarget((t) => t._targetId === targetId);
  const page = await target.page();
  await page.setViewport({ width: 720, height: 450 });
  await page.evaluateOnNewDocument(() => { localStorage.setItem('rubble.quality', '"low"'); });
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errs.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', (e) => errs.push(`[${tag} pageerror] ${e.message}\n${e.stack}`));
  return page;
};
const A = await mk('A'), B = await mk('B'), C = await mk('C'), P = [A, B, C];
const wait = (page, fn, ms = 30000, arg) => page.waitForFunction(fn, { timeout: ms, polling: 200 }, arg);
// 三個視窗同時在跑、施工大樓又大，慢的電腦開機要比較久：一次等久一點
const boot = async (page, url) => { await page.goto(url, { waitUntil: 'load' }).catch(() => {}); await page.waitForFunction('window.__game', { timeout: 240000 }); };
const phase = (page, ph, ms = 30000) => wait(page, (ph) => window.__game && __game.phase === ph, ms, ph);

// ── 開房、兩個人加入、選混戰 ──
await boot(A, `${BASE}?local=1&nolock=1`);
await A.evaluate(() => { __game.setSetting('name', '房主阿強'); document.getElementById('btn-host').click(); });
await phase(A, 'lobby');
await A.evaluate(() => __game.changeSettings({ mode: 'ffa' }));
const link = await A.evaluate(() => __game.inviteLink());
for (const [pg, nm] of [[B, '小明'], [C, '阿華']]) {
  await boot(pg, link + '&nolock=1');
  await pg.evaluate((nm) => { __game.setSetting('name', nm); document.getElementById('btn-join').click(); }, nm);
  await phase(pg, 'lobby');
}
await wait(A, () => __game.gs && __game.gs.here.filter(Boolean).length === 3 && __game.gs.p[2] && __game.gs.p[2].n === '阿華');
let st = await A.evaluate(() => ({ here: __game.gs.here, n: __game.gs.p.map((p) => p.n), mode: __game.gs.set.mode, map: __game.gs.set.map, start: !document.getElementById('btn-start').disabled, label: document.getElementById('btn-start').textContent, cap: __game.net.capacity }));
ok('混戰房間：三個人都在，名字正確，地圖換成施工大樓，可以開始', st.mode === 'ffa' && st.here.join() === 'true,true,true,false' && st.n[1] === '小明' && st.n[2] === '阿華' && (st.map === 'site' || st.map === 'random') && st.start && st.cap === 3, JSON.stringify(st));
const mes = await Promise.all(P.map((pg) => pg.evaluate(() => __game.me)));
ok('每個人拿到不同的座位（房主 0、訪客 1、2）', mes.join() === '0,1,2', mes.join());
st = await B.evaluate(() => ({ cls: document.querySelector('#scr-lobby .lobby').className, p2: document.getElementById('lb-p2').textContent, p3: document.getElementById('lb-p3').textContent }));
ok('訪客的大廳也看到 4 個位置（第 4 個是空位）', st.cls.includes('ffa') && st.p2 === '阿華' && st.p3 === '空位', JSON.stringify(st));
await A.screenshot({ path: OUT + '/f1-lobby.png' });
// 第 4 個人進不來（2 對 1 模式切不回去）
st = await A.evaluate(() => { __game.changeSettings({ mode: 'classic' }); return __game.gs.set.mode; });
await sleep(300);
ok('超過 2 個人時不能換回 1 對 1 的模式', (await A.evaluate(() => __game.authority.settings.mode)) === 'ffa');

// ── 開打 ──
await A.evaluate(() => __game.startMatch());
for (const pg of P) await phase(pg, 'loadout');
for (const pg of P) await pg.evaluate(() => { const g = __game; g.auth('ready', { v: true }); });
for (const pg of P) await phase(pg, 'playing', 90000);
await sleep(1500);
st = await Promise.all(P.map((pg) => pg.evaluate(() => { const p = __game.player.pos; return [Math.round(p.x), Math.round(p.z)]; })));
const sp1 = st, distinct = new Set(st.map((q) => q.join(','))).size === 3;
ok('三個人出生在不同的角落', distinct, JSON.stringify(st));
// 位置同步：A 看到的 B、C 在 B、C 自己說的位置附近
await B.evaluate(() => { const p = __game.player; p.pos.x += 1.5; });
await sleep(3500);
st = await A.evaluate(() => { const g = __game; return [1, 2].map((s) => { const r = g.foe(s); return r ? [+r.pos.x.toFixed(1), +r.pos.z.toFixed(1), r.alive, r.group.visible] : null; }); });
const real = await Promise.all([B, C].map((pg) => pg.evaluate(() => [+__game.player.pos.x.toFixed(1), +__game.player.pos.z.toFixed(1)])));
ok('房主看得到另外兩個人，位置跟他們自己的一樣（經過房主轉送）', st.every((q, i) => q && q[2] && q[3] && Math.hypot(q[0] - real[i][0], q[1] - real[i][1]) < 1.5), JSON.stringify([st, real]));
st = await B.evaluate(() => { const r = __game.foe(2), p = r && r.pos; return p ? [+p.x.toFixed(1), +p.z.toFixed(1), r.alive] : null; });
ok('訪客之間也看得到對方（C 的位置由房主轉給 B）', st && st[2] && Math.hypot(st[0] - real[1][0], st[1] - real[1][1]) < 1.5, JSON.stringify([st, real[1]]));
st = await A.evaluate(() => ({ storm: !!__game.gs.storm, r: __game.stormR(), wall: !!(__game.stormMesh && __game.stormMesh.visible), bar: document.getElementById('stormbar').textContent, board: document.querySelectorAll('#ffaboard .fb').length }));
ok('毒圈：開打就有、一開始蓋住整張圖，畫面上有倒數；計分板有 3 個人', st.storm && st.r > 40 && st.wall && st.bar.includes('毒圈') && st.board === 3, JSON.stringify(st));
await A.screenshot({ path: OUT + '/f2-playing.png' });
// 慢的電腦跑這個測試要很久：先把毒圈凍住（不然中途就縮到大家身上）
const freeze = () => A.evaluate(() => { const a = __game.authority, now = Date.now(); a.storm = { ...a.storm, r0: 200, r1: 200, t0: now + 6e5, t1: now + 7e5 }; a.dirty = true; a.flush(); });
await freeze(); await sleep(600);

// ── 命中指定的人：B 打 C（封包寫 t: 2）──
await A.evaluate(() => { const a = __game.authority, d0 = a.damage.bind(a); window.__dmg = []; a.damage = (...x) => { __dmg.push(x.slice(0, 4).map((v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)).join(',')); return d0(...x); }; });
const hp0 = await A.evaluate(() => __game.gs.p.map((p) => p.hp));
await B.evaluate(() => __game.hitTarget('p2', 30, false, 'ar'));
await sleep(800);
const hp1 = await A.evaluate(() => __game.gs.p.map((p) => p.hp));
ok('B 打 C：只有 C 扣血，房主和 B 不受影響', hp1[2] < hp0[2] && hp1[0] === hp0[0] && hp1[1] === hp0[1], JSON.stringify([hp0, hp1, await A.evaluate(() => __dmg.slice(0, 12))]));
// B 把 C 擊倒：回合繼續（還有 2 個人），C 開始觀戰
await B.evaluate(() => __game.hitTarget('p2', 400, true, 'ar'));
await wait(C, () => !__game.gs.p[2].al, 15000).catch(() => {});
await sleep(1500);
st = await A.evaluate(() => ({ ph: __game.gs.phase, al: __game.gs.p.map((p) => p.al), feed: document.getElementById('feed').textContent }));
ok('C 倒下：回合繼續（還剩 2 個人），擊殺列表寫著小明擊倒阿華', st.ph === 'playing' && st.al.slice(0, 3).join() === 'true,true,false' && st.feed.includes('小明') && st.feed.includes('阿華'), JSON.stringify(st));
st = await C.evaluate(() => ({ spec: __game.spec, bar: document.getElementById('specbar').textContent, hidden: document.getElementById('specbar').classList.contains('hidden') }));
ok('C 在觀戰活著的人，畫面下方寫著在看誰', st.spec >= 0 && st.spec !== 2 && !st.hidden && st.bar.includes('觀戰'), JSON.stringify(st));
await C.screenshot({ path: OUT + '/f3-spectate.png' });
await C.evaluate(() => { __game.mouse.lp = true; }); await sleep(1500);
const spec2 = await C.evaluate(() => __game.spec);
ok('觀戰時按左鍵換下一個人', spec2 >= 0 && spec2 !== st.spec, `${st.spec} → ${spec2}`);

// ── 毒圈扣血：把圈縮到地圖角落，大家都在圈外 ──
await A.evaluate(() => { const a = __game.authority; for (const p of a.players) if (p.alive) { p.maxHp = 500; p.hp = 500; } a.dirty = true; a.flush(); });
await sleep(800);
const hpS = await A.evaluate(() => __game.gs.p.map((p) => p.hp));
await A.evaluate(() => { const a = __game.authority, now = Date.now(); a.storm = { x: 1, z: 1, r0: 0.5, r1: 0.5, t0: now - 2000, t1: now - 1000 }; a.dirty = true; a.flush(); });
await sleep(3000);
const hpE = await A.evaluate(() => __game.gs.p.map((p) => p.hp));
st = await B.evaluate(() => ({ fx: document.getElementById('stormfx').classList.contains('on'), bar: document.getElementById('stormbar').textContent }));
ok('站在毒圈外會一直扣血（不吃護甲），畫面變紫、提示快回圈裡', hpE[0] < hpS[0] && hpE[1] < hpS[1] && st.fx && st.bar.includes('毒圈外'), JSON.stringify([hpS, hpE, st]));
await B.screenshot({ path: OUT + '/f4-storm.png' });
await freeze();
await A.evaluate(() => { const a = __game.authority; for (const p of a.players) if (p.alive) { p.maxHp = 100; p.hp = 100; } a.dirty = true; a.flush(); });   // 血還原（一發最多 400）
await sleep(800);

// ── 房主把 B 擊倒：只剩房主 → 這一局房主拿分 ──
await A.evaluate(() => __game.hitTarget('p1', 999, false, 'ar'));
await wait(A, () => __game.authority.phase !== 'playing', 60000).catch(async () => console.log('DIAG', await A.evaluate(() => JSON.stringify({ ph: __game.authority.phase, al: __game.authority.players.map((p) => [p.alive, Math.round(p.hp)]), here: __game.authority.present }))));
for (const pg of [B, C]) await wait(pg, () => __game.gs && __game.gs.res && __game.gs.res.winner !== undefined, 60000).catch(() => {});
await sleep(600);
st = await A.evaluate(() => ({ res: __game.gs.res, sc: __game.gs.p.map((p) => p.sc), banner: document.getElementById('banner').textContent }));
const bb = await B.evaluate(() => document.getElementById('banner').textContent);
ok('最後活著的房主拿 1 分；房主看到「你活到最後」，別人看到「房主阿強 拿下這一局」', st.res.winner === 0 && st.sc.slice(0, 3).join() === '1,0,0' && st.banner.includes('活到最後') && bb.includes('房主阿強'), JSON.stringify([st, bb]));
const money = await A.evaluate(() => __game.gs.p.map((p) => p.$));
ok('發錢：贏的人、輸的人都有，擊倒的人多拿', money[0] > 0 && money[1] > 0 && money[2] > 0, JSON.stringify(money));
await A.screenshot({ path: OUT + '/f5-roundend.png' });

// ── 下一局：出生點輪一個位置；有人離開，剩 2 個人照打 ──
for (const pg of P) await phase(pg, 'loadout', 90000);
for (const pg of P) await pg.evaluate(() => __game.auth('ready', { v: true }));
for (const pg of P) await phase(pg, 'playing', 90000);
await sleep(1000);
const sp2 = await Promise.all(P.map((pg) => pg.evaluate(() => { const p = __game.player.pos; return [Math.round(p.x), Math.round(p.z)]; })));
ok('第 2 局：出生點換了（每個人輪到下一個角落），還是各在不同角落', sp2.every((q, i) => q.join() !== sp1[i].join()) && new Set(sp2.map((q) => q.join())).size === 3, JSON.stringify([sp1, sp2]));
await C.close();
await wait(A, () => !__game.gs.here[2], 20000).catch(() => {});
await sleep(800);
st = await A.evaluate(() => ({ ph: __game.gs.phase, here: __game.gs.here, al2: __game.gs.p[2].al }));
ok('有人中途離開：他算出局，剩下 2 個人照樣打', st.ph === 'playing' && !st.here[2] && !st.al2, JSON.stringify(st));

ok('整個過程沒有任何錯誤訊息', errs.length === 0, errs.slice(0, 6).join('\n'));
console.log(`\n${pass} pass, ${fail} fail`);
await browser.close();
process.exit(fail ? 1 : 0);
