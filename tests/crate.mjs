// 補給箱（局外抽獎）：抽獎券、開箱轉盤、保底、碎片、裝備、刀型與特殊塗裝的模型、造型送給裁判、重新整理後還在
// 用法：node crate.mjs [輸出資料夾]
import puppeteer from 'puppeteer-core';
import { load, reload, CHROME } from './load.mjs';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] || 'shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || 'http://localhost:8765/').replace(/\/?$/, '/');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--window-size=1280,760', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 760 }, protocolTimeout: 120000 });
const page = await browser.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').includes('favicon')) errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message + '\n' + e.stack));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`); };
const ev = (fn, ...a) => page.evaluate(fn, ...a);

// 第一次玩：清掉之前存的抽獎資料
await page.goto(BASE + '?nolock=1').catch(() => {});
await ev(() => { for (const k of ['tickets', 'shards', 'pity', 'opened', 'inv', 'knife', 'wsp']) localStorage.removeItem('rubble.' + k); localStorage.setItem('rubble.pmap', '"plaza"'); localStorage.setItem('rubble.bot', '"dummy"'); localStorage.setItem('rubble.prog', 'false'); localStorage.setItem('rubble.quality', '"low"'); });   // 最低畫質不拍圖示
await load(page, BASE + '?nolock=1');
await sleep(500);
let st = await ev(() => ({ t: __game.crate.tickets, badge: document.getElementById('crate-badge').textContent, hid: document.getElementById('crate-badge').classList.contains('hidden') }));
ok('第一次玩送 3 張抽獎券，主選單的補給箱按鈕上有數字', st.t === 3 && st.badge === '3' && !st.hid, JSON.stringify(st));

// ── 物品表：每一個都做得出模型 ──
st = await ev(async () => {
  const { ITEMS, ITEM_IDS } = await import('./js/skins.js'); const { itemGun } = await import('./js/crate.js'); const { buildGun } = await import('./js/gunmodel.js');
  const bad = [];
  for (const id of ITEM_IDS) {
    const { id: w, skin } = itemGun(id); let g = null;
    try { g = buildGun(w, skin); } catch (e) { bad.push(id + ' ' + e.message); continue; }
    let meshes = 0, tex = 0; g.traverse((o) => { if (o.isMesh) { meshes++; if (o.material.map) tex++; } });
    if (!meshes) bad.push(id + ' 沒有模型');
    if (ITEMS[id].f && !tex) bad.push(id + ' 沒有花紋');
    if (ITEMS[id].knife && g.userData.model !== ITEMS[id].knife) bad.push(id + ' 刀型不對 ' + g.userData.model);
  }
  return { n: ITEM_IDS.length, bad: bad.join('、') };
});
ok(`物品表的 ${st.n} 個東西都做得出模型：刀型換對、特殊塗裝有花紋`, st.n >= 20 && !st.bad, st.bad);

// ── 抽獎邏輯（固定亂數）──
st = await ev(async () => {
  const { Crate, PITY, SHARDS } = await import('./js/crate.js'); const { ITEMS } = await import('./js/skins.js');
  const c = new Crate(); c.save = () => {}; c.tickets = 100; c.inv.clear(); c.shards = 0; c.pity.classic = 0;
  const seq = (arr) => { let i = 0; return () => arr[i++ % arr.length]; };
  const out = {};
  // 保底：差一抽就到的時候一定出刀
  c.pity.classic = PITY - 1; const a = c.open(seq([0.99, 0.5])); out.pity = ITEMS[a.id].t; out.pityReset = c.pity.classic;
  // 同一個東西抽三次：第一次是新的，後兩次變碎片
  const b1 = c.open(seq([0.01, 0])), b2 = c.open(seq([0.01, 0])), b3 = c.open(seq([0.01, 0]));
  out.same = b1.id === b2.id && b2.id === b3.id; out.dup = [b1.dup, b2.dup, b3.dup]; out.shards = c.shards;
  c.shards = SHARDS - 1; const t0 = c.tickets, b4 = c.open(seq([0.01, 0])); out.bonus = b4.bonus; out.ticketsBack = c.tickets === t0;   // 碎片湊滿：花 1 張、換回 1 張
  // 機率：大量模擬，精良最多、傳奇刀約 4%
  const n = {}; const d = new Crate(); d.save = () => {}; d.tickets = 1e9; d.pity.classic = 0;
  for (let i = 0; i < 20000; i++) { const r = d.open(); n[ITEMS[r.id].t] = (n[ITEMS[r.id].t] || 0) + 1; }
  out.rate = Object.fromEntries(Object.entries(n).map(([k, v]) => [k, Math.round((v / 200)) ]));
  c.tickets = 0; out.empty = c.open() === null;
  return out;
});
ok('保底：連續 19 抽沒出刀，第 20 抽一定出刀，出刀後重算', st.pity === 'g' && st.pityReset === 0, JSON.stringify(st));
ok('重複抽到變碎片，碎片湊滿自動換 1 張券', st.same && st.dup.join() === 'false,true,true' && st.shards === 2 && st.bonus && st.ticketsBack, JSON.stringify(st));
ok('機率：精良最多，傳奇刀加保底大約 4～6%', st.rate.b > 45 && st.rate.g >= 3 && st.rate.g <= 7, JSON.stringify(st.rate));
ok('沒有券就不能開', st.empty);

// ── 開箱畫面 ──
await page.click('#btn-crate'); await sleep(1500);
st = await ev(() => ({ scr: __game.hud.screen, coll: document.querySelectorAll('#cr-coll .ci').length, lock: document.querySelectorAll('#cr-coll .ci.lock').length, icons: Object.keys(__game.hud.itemIcons || {}).length, tix: document.getElementById('cr-tix').textContent }));
ok('補給箱畫面：收藏列出全部物品（還沒抽到的是剪影），每個都有側面照', st.scr === 'crate' && st.coll >= 20 && st.lock === st.coll && st.icons === st.coll && st.tix === '3', JSON.stringify(st));
await page.click('#btn-crate-open'); await sleep(1200);
st = await ev(() => ({ spin: __game.hud.spinning, tiles: document.querySelectorAll('#cr-strip .ci').length, tx: document.getElementById('cr-strip').style.transform, dis: document.getElementById('btn-crate-open').disabled && document.getElementById('btn-crate-back').disabled, t: __game.crate.tickets }));
ok('按開箱：花掉 1 張券，轉盤開始滑，轉的時候按鈕都不能按', st.spin && st.tiles > 40 && st.tx.includes('-') && st.dis && st.t === 2, JSON.stringify(st));
await page.screenshot({ path: OUT + '/k1-spin.png' });
await page.click('#cr-reel');   // 點轉盤 = 直接看結果
await page.waitForFunction(() => !__game.hud.spinning, { timeout: 20000 }).catch(() => {});
await sleep(400);
st = await ev(() => {
  const win = document.querySelector('#cr-strip .ci.win'), res = document.getElementById('cr-result'), mark = document.querySelector('#cr-reel .mark').getBoundingClientRect(), r = win && win.getBoundingClientRect();
  const inv = [...__game.crate.inv];
  return { win: win && win.dataset.id, inv, under: r ? r.left <= mark.left && r.right >= mark.right : false, res: !res.classList.contains('hidden') && res.textContent, own: document.querySelectorAll('#cr-coll .ci:not(.lock)').length };
});
ok('轉盤停下：金線停在抽到的那一格，下面顯示抽到什麼，收藏多一個', st.win && st.inv.includes(st.win) && st.under && st.res && st.own === 1, JSON.stringify(st));
await page.screenshot({ path: OUT + '/k2-result.png' });
const first = st.win;
await page.click('#btn-cr-equip'); await sleep(300);
st = await ev((id) => ({ eq: __game.equipped(id), badge: !!document.querySelector(`#cr-coll .ci[data-id="${id}"] .eq`), look: __game.look() }), first);
ok('按「裝備」：裝上了，收藏那一格標「裝備中」', st.eq && st.badge, JSON.stringify(st));

// ── 獎池：切到霓虹，收藏只列這一池；開出來的是這一池的東西；保底每池各算各的 ──
await ev(() => { __game.crate.tickets += 3; __game.hud._crateWallet(); });
st = await ev(() => ({ tabs: [...document.querySelectorAll('#cr-pools .pool')].map((e) => e.dataset.pool) }));
ok('補給箱有三個獎池可以切換（經典、霓虹、神話）', st.tabs.join() === 'classic,neon,myth', JSON.stringify(st));
await page.click('#cr-pools .pool[data-pool="neon"]'); await sleep(1500);
st = await ev(async () => { const { ITEMS } = await import('./js/skins.js'); const ids = [...document.querySelectorAll('#cr-coll .ci')].map((e) => e.dataset.id); return { n: ids.length, all: ids.every((id) => ITEMS[id].pool === 'neon'), on: document.querySelector('#cr-pools .pool.on').dataset.pool, pity: __game.crate.pity, saved: localStorage.getItem('rubble.crpool') }; });
ok('切到霓虹補給箱：收藏只列霓虹的 16 個東西，記住選的是哪一池', st.n === 16 && st.all && st.on === 'neon' && st.saved === '"neon"', JSON.stringify(st));
const pityC = await ev(() => __game.crate.pity.classic);
await page.click('#btn-crate-open'); await sleep(800); await page.click('#cr-reel');
await page.waitForFunction(() => !__game.hud.spinning, { timeout: 20000 }).catch(() => {});
st = await ev(async () => { const { ITEMS } = await import('./js/skins.js'); const w = document.querySelector('#cr-strip .ci.win'), fill = [...document.querySelectorAll('#cr-strip .ci')].every((e) => ITEMS[e.dataset.id].pool === 'neon'); return { win: w && w.dataset.id, pool: w && ITEMS[w.dataset.id].pool, fill, pity: __game.crate.pity }; });
ok('在霓虹開箱：開到的和轉盤上的都是霓虹的東西；保底只算霓虹這一池', st.pool === 'neon' && st.fill && st.pity.classic === pityC && (st.pity.neon === 1 || st.pity.neon === 0), JSON.stringify(st));
await page.screenshot({ path: OUT + '/k2b-neon.png' });
st = await ev(async () => {
  const { ITEMS, ITEM_IDS } = await import('./js/skins.js'); const { Crate } = await import('./js/crate.js');
  const c = new Crate(); c.save = () => {}; c.tickets = 3000; const seen = new Set();
  for (let i = 0; i < 1500; i++) { const r = c.open('myth'); seen.add(ITEMS[r.id].pool); }
  return { pools: [...seen], knives: ['k:kris', 'k:axe'].every((id) => c.inv.has(id)) };
});
ok('神話池只開得出神話的東西，刀（蛇形刀、戰斧）也開得到', st.pools.join() === 'myth' && st.knives, JSON.stringify(st));
await page.click('#cr-pools .pool[data-pool="classic"]'); await sleep(800);

// ── 裝備：沒抽到的不能裝；刀型、特殊塗裝；送給裁判 ──
st = await ev(() => { const g = __game; g.crate.inv.delete('k:karambit'); g.equipItem('k:karambit'); return g.settings.knife; });
ok('沒抽到的東西裝不上去', st !== 'karambit', st);
await ev(() => { const g = __game, c = g.crate; for (const id of ['k:butterfly', 'sniper:dragon', 'knife:fade']) c.inv.add(id); c.save(); for (const id of ['k:butterfly', 'sniper:dragon', 'knife:fade']) if (!g.equipped(id)) g.equipItem(id); });
st = await ev(async () => { const { validLook, gunSkin } = await import('./js/skins.js'); const lk = __game.look(); const pw = ['pistol', 'ar', 'smg', 'mp', 'lmg'].find((w) => !lk.p[w]); return { lk, knife: gunSkin(lk, 'knife'), sniper: gunSkin(lk, 'sniper'), plain: gunSkin(lk, pw), bad: validLook({ s: 'neon', w: 'gold', k: 'spoon', p: { ar: 'dragon', sniper: 'dragon', x: 'y' } }) }; });
ok('造型：刀型、特殊塗裝只套在指定的武器上，其他槍照用一般塗裝', st.knife === '*fade/butterfly' && st.sniper === '*dragon' && st.plain === st.lk.w, JSON.stringify(st));
ok('收到不存在的刀型或塗裝組合就丟掉（validLook）', st.bad.k === 'knife' && JSON.stringify(st.bad.p) === '{"sniper":"dragon"}', JSON.stringify(st.bad));

// ── 造型頁 ──
await ev(() => __game.hud.show('menu')); await sleep(200);
await page.click('#btn-locker'); await sleep(1500);
st = await ev(() => ({ items: document.querySelectorAll('#lk-items .it').length, sel: [...document.querySelectorAll('#lk-items .it.sel')].map((e) => e.dataset.id) }));
ok('造型頁列出抽到的東西，裝備中的有標出來', st.items >= 4 && st.sel.includes('k:butterfly') && st.sel.includes('sniper:dragon'), JSON.stringify(st));
await ev(() => document.querySelector('#lk-items .it[data-id="sniper:dragon"]').click()); await sleep(1200);
st = await ev(() => ({ gun: __game.doll.gunKey, eq: __game.equipped('sniper:dragon') }));
ok('造型頁點一下：卸下，模特兒換成那把槍給你看', !st.eq && st.gun.startsWith('sniper|'), JSON.stringify(st));
await ev(() => document.querySelector('#lk-items .it[data-id="sniper:dragon"]').click()); await sleep(1200);
st = await ev(() => __game.doll.gunKey);
ok('再點一下：裝回去，模特兒手上的狙擊槍換成龍紋', st === 'sniper|*dragon', st);
await page.screenshot({ path: OUT + '/k3-locker.png' });
await ev(() => __game.closeLocker()); await sleep(300);

// ── 練習：自己拿刀是蝴蝶刀、裁判收到造型；打完一場拿到券 ──
await page.click('#btn-bot');
await page.waitForFunction(() => __game.phase === 'loadout', { timeout: 30000 });
await ev(() => { const a = __game.authority; a.players[0].ready = true; a.tEnd = Date.now(); });
await page.waitForFunction(() => __game.phase === 'playing', { timeout: 30000 });
await sleep(800);
await ev(() => { const c = __game.combat; c.switchTo(c.slots.findIndex((w) => w && w.id === 'knife')); }); await sleep(600);
st = await ev(() => ({ w: __game.combat.w && __game.combat.w.id, model: __game.view.u && __game.view.u.model, key: __game.view.key, lk: __game.authority.players[0].look }));
ok('拿刀：第一人稱是蝴蝶刀、刀身是霓彩漸層', st.w === 'knife' && st.model === 'butterfly' && st.key === 'knife|*fade/butterfly', JSON.stringify(st));
ok('裁判收到完整的造型（對手看得到刀型和特殊塗裝）', st.lk && st.lk.k === 'butterfly' && st.lk.p.sniper === 'dragon', JSON.stringify(st.lk));
await page.screenshot({ path: OUT + '/k4-knife.png' });
st = await ev(() => { const lk = __game.gs.p[1].lk; return { lk, key: __game.remote.gunKey }; });
ok('練習機器人也帶著抽獎才有的刀型（造型裡有 k）', st.lk && typeof st.lk.k === 'string', JSON.stringify(st));
const t0 = await ev(() => __game.crate.tickets);
await ev(() => { const a = __game.authority; a.players[0].score = a.settings.target - 1; a.handle(0, 'hit', { r: a.round, d: 999, h: true, w: 'ar' }); });
await page.waitForFunction(() => __game.phase === 'matchEnd' || !document.getElementById('scr-end').classList.contains('hidden'), { timeout: 30000 }).catch(() => {});
await sleep(800);
st = await ev((t0) => ({ t: __game.crate.tickets, t0, msg: document.getElementById('end-tix').textContent, vis: !document.getElementById('end-tix').classList.contains('hidden') }), t0);
ok('打贏一場練習：抽獎券 +2（練習 1 + 贏 1），結算畫面有寫', st.t === t0 + 2 && st.vis && st.msg.includes('+2'), JSON.stringify(st));
await page.screenshot({ path: OUT + '/k5-end.png' });

// ── 重新整理：收藏、券、裝備都還在 ──
const before = await ev(() => ({ t: __game.crate.tickets, n: __game.crate.inv.size, k: __game.settings.knife, p: __game.settings.wsp }));
await reload(page); await sleep(500);
st = await ev(() => ({ t: __game.crate.tickets, n: __game.crate.inv.size, k: __game.settings.knife, p: __game.settings.wsp }));
ok('重新整理後抽獎券、收藏、裝備都還在', JSON.stringify(st) === JSON.stringify(before), JSON.stringify([before, st]));

ok('整個過程沒有任何錯誤訊息', errs.length === 0, errs.slice(0, 5).join('\n'));
console.log(`\n${pass} pass, ${fail} fail`);
await browser.close();
process.exit(fail ? 1 : 0);
