// Roguelike 模式的雙人同步：選卡要等自己選完才公開對手的、技能效果在兩邊都看得到、地形改動兩邊一致
// 用法：node rogue-duel.mjs <截圖資料夾> [peer]
import puppeteer from 'puppeteer-core';
import { load, CHROME } from './load.mjs';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] || 'shots';
mkdirSync(OUT, { recursive: true });
const PEER = process.argv[3] === 'peer';
const Q = PEER ? 'nolock=1' : 'local=1&nolock=1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || 'http://localhost:8765/').replace(/\/?$/, '/');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--window-size=1100,680', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: 1100, height: 680 }, protocolTimeout: 60000 });
const errs = [];
const mk = async (tag) => {
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
const waitPhase = async (page, ph, ms = 20000) => { await page.waitForFunction((ph) => window.__game && __game.phase === ph, { timeout: ms }, ph); };
const hash = (page) => page.evaluate(() => { const t = __game.world.types, h = __game.world.hp; let a = 0, n = 0, s = 0; for (let i = 0; i < t.length; i++) { if (t[i]) { n++; a = (Math.imul(a, 31) + i * t[i]) | 0; s += h[i]; } } return `${n}/${a}/${Math.round(s)}`; });
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`); };

await load(A, `${BASE}?${Q}`);
await A.type('#in-name', '阿強');
await A.click('#btn-host');
await waitPhase(A, 'lobby', 25000);
const link = await A.evaluate(() => __game.inviteLink());
await load(B, link + '&nolock=1');
await B.$eval('#in-name', (e) => { e.value = ''; });
await B.type('#in-name', '小明');
await B.click('#btn-join');
await waitPhase(B, 'lobby', 30000);
await sleep(500);
await A.select('#set-map', 'plaza');
await A.click('#lb-modes .mtile[data-mode="rogue"]');
await sleep(400);
let st = await B.evaluate(() => ({ mode: __game.gs.set.mode, sel: document.querySelector('#lb-modes .mtile.on').dataset.mode, buffHidden: document.getElementById('set-buff').parentElement.classList.contains('hidden') }));
ok('訪客看到房主把模式改成 Roguelike，輸家補償的選項收起來', st.mode === 'rogue' && st.sel === 'rogue' && st.buffHidden, JSON.stringify(st));
await A.click('#btn-start');
await waitPhase(A, 'loadout'); await waitPhase(B, 'loadout');
await sleep(500);

// ── 選卡：雙方各自有 3 張，內容不一樣是隨機的；我選好之前看不到對手選了什麼 ──
st = { a: await A.evaluate(() => __game.gs.p[0].ch), b: await B.evaluate(() => __game.gs.p[1].ch) };
ok('雙方各有 3 張卡', st.a.length === 3 && st.b.length === 3, JSON.stringify(st));
// 指定卡片：房主拿鋼牆，訪客拿時間凝結
const setCh = (i, ids) => A.evaluate((i, ids) => { const a = __game.authority; a.players[i].choices = ids; a.dirty = true; a.flush(); }, i, ids);
await setCh(0, ['wall', 'vital', 'tough']); await setCh(1, ['chrono', 'vital', 'tough']); await sleep(300);
await B.click('.card[data-id="chrono"]'); await sleep(400);
st = await A.evaluate(() => ({ opp: document.getElementById('lo-build-opp').textContent, sk: __game.gs.p[1].sk }));
ok('對手已經選好，但我還沒選：畫面上不公開他拿了什麼', st.sk[0] === 'chrono' && !st.opp.includes('時間凝結') && st.opp.includes('等你選完才公開'), JSON.stringify(st));
await A.click('.card[data-id="wall"]'); await sleep(400);
st = { a: await A.evaluate(() => document.getElementById('lo-build-opp').textContent), b: await B.evaluate(() => document.getElementById('lo-build-opp').textContent) };
ok('雙方都選好之後互相公開', st.a.includes('時間凝結') && st.b.includes('鋼牆'), JSON.stringify(st));
await A.screenshot({ path: OUT + '/rd1-revealed.png' });

// 之後要測的技能直接塞進去
const setBuild = (i, skills, buffs) => A.evaluate((i, skills, buffs) => { const a = __game.authority, p = a.players[i]; p.skills = skills; p.buffs = buffs; a.dirty = true; a.flush(); }, i, skills, buffs);
await setBuild(0, ['wall', 'dome'], ['phoenix']); await setBuild(1, ['chrono', 'cloak'], []);
await sleep(200);
await A.click('#btn-ready'); await B.click('#btn-ready');
await waitPhase(A, 'playing'); await waitPhase(B, 'playing');
await sleep(500);
st = { a: await A.evaluate(() => [__game.skills.slots, document.getElementById('oppbuild').children.length]), b: await B.evaluate(() => [__game.skills.slots, document.getElementById('oppbuild').children.length]) };
ok('開打後雙方的技能格正確，也看得到對手帶了什麼', st.a[0].join() === 'wall,dome' && st.b[0].join() === 'chrono,cloak' && st.a[1] === 3 && st.b[1] === 4, JSON.stringify(st));

// 兩邊各自把同一塊場地清空（地形是各自算的，這裡手動讓兩邊一致），面對面站好：A 在 z=34 往 -z 看，B 在 z=22 往 +z 看
const arena = (pg, x, z, yaw) => pg.evaluate((x, z, yaw) => { const g = __game, w = g.world, p = g.player; w.box(24, 0, 28, 72, 2, 76, 3); w.box(24, 3, 28, 72, 31, 76, 0); w.rebuildAll(); p.pos.set(x, 1.5, z); p.vel.set(0, 0, 0); p.yaw = yaw; p.pitch = 0; }, x, z, yaw);
const stand = (pg, x, z, yaw) => pg.evaluate((x, z, yaw) => { const p = __game.player; p.pos.set(x, 1.5, z); p.vel.set(0, 0, 0); p.yaw = yaw; p.pitch = 0; }, x, z, yaw);
await arena(A, 24, 34, 0); await arena(B, 24, 22, Math.PI);
await sleep(700);
ok('場地清好之後兩邊地形一致', (await hash(A)) === (await hash(B)));

// ── 鋼牆：A 立牆，B 那邊也長出來 ──
let used = await A.evaluate(() => __game.skills.use(0)); await sleep(500);
ok('鋼牆同步：兩邊的地形一模一樣', used && (await hash(A)) === (await hash(B)), `${await hash(A)} vs ${await hash(B)}`);
st = await B.evaluate(() => __game.world.types.reduce((n, t) => n + (t === 6 ? 1 : 0), 0));
ok('訪客那邊確實多了 35 格鋼板', st === (await A.evaluate(() => __game.world.types.reduce((n, t) => n + (t === 6 ? 1 : 0), 0))) && st >= 35, String(st));

// ── 時間凝結：B 對 A 放，A 的移動和轉頭變慢 ──
used = await B.evaluate(() => { __game.skills.ready = [0, 0]; return __game.skills.use(0); }); await sleep(350);
st = await A.evaluate(() => ({ mul: __game.skills.speedMul(__game.gs.p[0]), look: __game.skills.lookMul(), tint: document.getElementById('tintfx').className, chip: document.getElementById('status').textContent }));
ok('時間凝結：被放的人移動剩 1/3、轉頭變慢、畫面變藍', used && Math.abs(st.mul - 0.33) < 0.01 && st.look === 0.4 && st.tint === 'slow' && st.chip.includes('時間凝結'), JSON.stringify(st));
await A.screenshot({ path: OUT + '/rd2-chrono.png' });

// ── 光學迷彩：B 隱身，A 看不到他；B 開槍就現形 ──
await stand(A, 30, 34, 0); await stand(B, 30, 22, Math.PI); await sleep(500);
ok('隱身前看得到對手', await A.evaluate(() => __game.remote.group.visible));
used = await B.evaluate(() => __game.skills.use(1)); await sleep(350);
st = await A.evaluate(() => ({ vis: __game.remote.group.visible, cl: __game.skills.oppCloaked() }));
ok('光學迷彩：對手的模型不畫了', used && !st.vis && st.cl, JSON.stringify(st));
await B.evaluate(() => { __game.mouse.l = true; __game.mouse.lp = true; }); await sleep(150); await B.evaluate(() => { __game.mouse.l = false; }); await sleep(350);
st = await A.evaluate(() => ({ vis: __game.remote.group.visible, cl: __game.skills.oppCloaked() }));
ok('開槍之後現形', st.vis && !st.cl, JSON.stringify(st));

// ── 能量護罩：A 放護罩，B 從外面打不進去 ──
await stand(A, 36, 34, 0); await stand(B, 36, 24, Math.PI); await sleep(600);
used = await A.evaluate(() => __game.skills.use(1)); await sleep(400);
const hpA0 = await A.evaluate(() => __game.gs.p[0].hp + __game.gs.p[0].ar);
await B.evaluate(() => { __game.player.pitch = 0; __game.mouse.l = true; __game.mouse.lp = true; }); await sleep(150); await B.evaluate(() => { __game.mouse.l = false; }); await sleep(400);
st = { hp: await A.evaluate(() => __game.gs.p[0].hp + __game.gs.p[0].ar), domesB: await B.evaluate(() => __game.skills.domes.length) };
ok('能量護罩同步：對手那邊也有護罩，子彈被擋下', used && st.domesB === 1 && st.hp === hpA0, JSON.stringify([hpA0, st]));
await B.screenshot({ path: OUT + '/rd3-dome.png' });
// 走進護罩裡面就打得到
await stand(B, 36, 32.4, Math.PI); await sleep(500);
await B.evaluate(() => { __game.mouse.l = true; __game.mouse.lp = true; }); await sleep(150); await B.evaluate(() => { __game.mouse.l = false; }); await sleep(400);
ok('走進護罩裡面就打得到人', (await A.evaluate(() => __game.gs.p[0].hp + __game.gs.p[0].ar)) < hpA0);

// ── 不死鳥：A 吃到致命傷，兩邊都收到重生的通知 ──
await B.evaluate(() => { __game.auth('hit', { r: __game.round, d: 400, h: false, w: 'knife' }); }); await sleep(500);
st = { a: await A.evaluate(() => ({ hp: __game.gs.p[0].hp, al: __game.gs.p[0].al, banner: document.getElementById('banner').textContent })), b: await B.evaluate(() => document.getElementById('feed').textContent) };
ok('不死鳥：沒死、回到 40 血，自己看到大字、對手看到訊息', st.a.al && st.a.hp === 40 && st.a.banner.includes('不死鳥') && st.b.includes('浴火重生'), JSON.stringify(st));

// ── 黑洞、軌道砲：B 換技能再放，A 被吸、地形同步 ──
await A.evaluate(() => { const a = __game.authority; a.players[1].skills = ['blackhole', 'orbital']; a.players[0].maxHp = 900; a.players[0].hp = 900; a.dirty = true; a.flush(); });
await B.evaluate(() => { __game.skills.setup(['blackhole', 'orbital']); });
await stand(A, 28, 34, 0); await stand(B, 24, 24, Math.PI); await sleep(1400);      // 等不死鳥的無敵時間過去
await B.evaluate(() => { __game.player.pitch = -0.16; }); await sleep(200);          // B 往 +z 看，瞄 10 公尺外的地面 → 黑洞在 (24, ~1.7, 33) 附近，A 在旁邊 4 公尺
const ax0 = await A.evaluate(() => __game.player.pos.x);
used = await B.evaluate(() => __game.skills.use(0)); await sleep(2000);
st = await A.evaluate((ax0) => ({ dx: ax0 - __game.player.pos.x, holes: __game.skills.holes.length, chip: document.getElementById('status').textContent, tint: document.getElementById('tintfx').className }), ax0);
ok('黑洞同步：被放的人被吸過去，畫面有提示', used && st.holes === 1 && st.dx > 1 && st.chip.includes('黑洞'), JSON.stringify(st));
await A.screenshot({ path: OUT + '/rd4-blackhole.png' });
await sleep(2800);
ok('黑洞結束後兩邊地形一致（被吞掉的方塊一樣）', (await hash(A)) === (await hash(B)), `${await hash(A)} vs ${await hash(B)}`);
const hpA1 = await A.evaluate(() => __game.gs.p[0].hp);
ok('黑洞有造成傷害', hpA1 < 900, String(hpA1));

await stand(A, 32, 36, 0); await stand(B, 32, 26, Math.PI); await sleep(500);
await B.evaluate(() => { __game.player.pitch = -0.16; }); await sleep(200);          // 瞄準 A 腳邊
used = await B.evaluate(() => __game.skills.use(1)); await sleep(500);
st = await A.evaluate(() => __game.skills.marks.length);
ok('軌道砲同步：被瞄準的人也看得到標記', used && st === 1, String(st));
await A.screenshot({ path: OUT + '/rd5-mark.png' });
await sleep(1800);
st = { hp: await A.evaluate(() => __game.gs.p[0].hp), same: (await hash(A)) === (await hash(B)) };
ok('軌道砲：打下來之後兩邊地形一致，光柱附近的人大量受傷', st.same && st.hp < hpA1 - 60, JSON.stringify([hpA1, st]));

// ── 回合結束 → 下一局：輸的人有 4 張 ──
await B.evaluate(() => { __game.auth('hit', { r: __game.round, d: 400, h: false, w: 'knife' }); }); await sleep(300);
await B.evaluate(() => { __game.auth('hit', { r: __game.round, d: 400, h: false, w: 'knife' }); }); await sleep(300);
await B.evaluate(() => { __game.auth('hit', { r: __game.round, d: 400, h: false, w: 'knife' }); });
await waitPhase(A, 'loadout', 25000); await waitPhase(B, 'loadout', 25000); await sleep(500);
st = { a: await A.evaluate(() => ({ n: __game.gs.p[0].ch.length, lu: __game.gs.p[0].lu, cards: document.querySelectorAll('#lo-buff-cards .card').length, sub: document.getElementById('lo-buff-sub').textContent })), b: await B.evaluate(() => ({ n: __game.gs.p[1].ch.length, lu: __game.gs.p[1].lu })) };
ok('下一局：輸的人 4 張、贏的人 3 張', st.a.n === 4 && st.a.lu === 1 && st.a.cards === 4 && st.a.sub.includes('多一張') && st.b.n === 3 && st.b.lu === 0, JSON.stringify(st));
await A.screenshot({ path: OUT + '/rd6-loser-draft.png' });
st = await B.evaluate(() => document.getElementById('lo-build-opp').textContent);
ok('選卡畫面看得到對手累積的異能', st.includes('不死鳥') && st.includes('鋼牆'), st);

ok('整個過程沒有任何錯誤訊息', errs.length === 0, errs.slice(0, 5).join('\n'));
console.log(`\n${pass} pass, ${fail} fail`);
await browser.close();
process.exit(fail ? 1 : 0);
