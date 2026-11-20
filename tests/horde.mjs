// 機器人模式：死鬥練習（定點／左右閃／來找你、會不會開槍、時間到結算）、守據點（據點位置、波次、沙包牆、
// 鎖槍、選卡、自爆兵、據點被打爆），以及兩個人一起守據點時兩邊看到的一樣（機器人、擊倒、受傷、地形）。
// 用法：node horde.mjs <截圖資料夾> [peer]
import puppeteer from 'puppeteer-core';
import { load, CHROME, ANGLE } from './load.mjs';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] || 'shots';
mkdirSync(OUT, { recursive: true });
const PEER = process.argv[3] === 'peer';
const Q = PEER ? 'nolock=1' : 'local=1&nolock=1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || 'http://localhost:8765/').replace(/\/?$/, '/');
const gpu = process.env.GPU ? ['--use-angle=' + ANGLE, '--enable-gpu'] : ['--enable-unsafe-swiftshader'];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--window-size=1100,680', '--ignore-gpu-blocklist', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', ...gpu],
  defaultViewport: { width: 1100, height: 680 }, protocolTimeout: 90000 });
const errs = [];
const mk = async (tag) => {
  const cdp = await browser.target().createCDPSession();
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true });
  const target = await browser.waitForTarget((t) => t._targetId === targetId);
  const page = await target.page();
  await page.setViewport({ width: 1100, height: 680 });
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon') && !m.text().includes('ERR_SOCKET_NOT_CONNECTED')) errs.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', (e) => errs.push(`[${tag} pageerror] ${e.message}\n${e.stack}`));
  return page;
};
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`); };
const until = async (page, fn, arg, ms = 15000) => { try { await page.waitForFunction(fn, { timeout: ms, polling: 100 }, arg); return true; } catch { return false; } };
const hash = (page) => page.evaluate(() => { const t = __game.world.types, h = __game.world.hp; let a = 0, n = 0, s = 0; for (let i = 0; i < t.length; i++) { if (t[i]) { n++; a = (Math.imul(a, 31) + i * t[i]) | 0; s += h[i]; } } return `${n}/${a}/${Math.round(s)}`; });

const A = await mk('A');
await A.evaluateOnNewDocument(() => { localStorage.setItem('rubble.hzmap', '"plaza"'); localStorage.removeItem('rubble.hzbest'); });
await load(A, `${BASE}?nolock=1`);

// ═════════ 死鬥練習 ═════════
const dm = (cfg) => A.evaluate((cfg) => { __game.leave(); __game.settings.hzdm = { n: 8, beh: 'hunt', atk: true, lv: 'normal', time: 300, ...cfg }; __game.practiceHorde('dm'); }, cfg);
const alive = () => A.evaluate(() => __game.horde.mobs.filter((m) => m.alive).length);
const god = (page, on) => page.evaluate((on) => { const a = __game.authority; if (a) for (const p of a.players) p.inv = on ? Date.now() + 1e9 : 0; }, on);
const dist = () => A.evaluate(() => { const g = __game, p = g.player.pos, ms = g.horde.mobs.filter((m) => m.alive); return ms.reduce((s, m) => s + Math.hypot(m.body.pos.x - p.x, m.body.pos.z - p.z), 0) / Math.max(1, ms.length); });

await A.evaluate(() => { document.getElementById('btn-dm').click(); });
await sleep(300);
let st = await A.evaluate(() => ({ scr: !document.getElementById('scr-hz').classList.contains('hidden'), title: document.getElementById('hz-title').textContent, dmOpts: [...document.querySelectorAll('#scr-hz .dmopt')].filter((e) => !e.classList.contains('hidden')).length }));
ok('主選單「死鬥練習」打開設定畫面（數量、行為、會不會開槍、時間）', st.scr && st.title === '死鬥練習' && st.dmOpts === 4, JSON.stringify(st));
await A.screenshot({ path: OUT + '/hz1-setup.png' });

await dm({ n: 8, beh: 'hunt' });
await until(A, () => __game.phase === 'horde' && __game.horde.mobs.filter((m) => m.alive).length === 8, null, 8000);
await god(A, true);
st = await A.evaluate(() => ({ ph: __game.phase, n: __game.horde.mobs.filter((m) => m.alive).length, views: [...__game.horde.views.values()].filter((o) => o.alive && o.v.group.visible).length, mini: __game.horde.mini().length, opp: document.getElementById('nm-opp').textContent, sc: document.getElementById('sc-opp').textContent }));
ok('開始死鬥：場上 8 個機器人，模型、小地圖都有，記分板右邊顯示機器人數量', st.ph === 'horde' && st.n === 8 && st.views === 8 && st.mini === 8 && st.opp === '機器人' && st.sc === '8', JSON.stringify(st));
const d0 = await dist(); await sleep(4500); const d1 = await dist();
ok('「主動來找你」的機器人會走過來', d1 < d0 - 3, `${d0.toFixed(1)} → ${d1.toFixed(1)}`);
await god(A, false);
const hurt = await until(A, () => __game.gs.p[0].hp < 100 || __game.gs.hz.d[0] > 0, null, 15000);
ok('機器人會開槍打你', hurt);
st = await A.evaluate(() => ({ ev: __game.hurtSrc }));
await A.screenshot({ path: OUT + '/hz2-dm.png' });

// 自己真的開槍、出刀打機器人：把一隻擺到面前
await god(A, true);
await A.evaluate(() => { const a = __game.authority; if (!a.players[0].alive) a.players[0].respawnAt = 0; });
await until(A, () => __game.gs.p[0].al, null, 5000);
// 把一隻機器人擺到我面前 d 公尺（找一個前面空著、地面平的方向），其他的先移開
const place = (d) => A.evaluate((d) => {
  const g = __game, h = g.horde, p = g.player, w = g.world, m = h.mobs.find((x) => x.alive);
  for (const o of h.mobs) if (o !== m && o.alive) { o.body.pos.set(2, 30, 2); o.body.vel.set(0, 0, 0); o.beh = 'hold'; o.post = { x: 2, y: 30, z: 2 }; }
  for (let k = 0; k < 16; k++) {
    const yaw = (k / 16) * Math.PI * 2, fx = -Math.sin(yaw), fz = -Math.cos(yaw), x = p.pos.x + fx * d, z = p.pos.z + fz * d;
    if (w.raycast(p.pos.x, p.pos.y + 1, p.pos.z, fx, 0, fz, d + 1) || m.body.collides(x, p.pos.y, z) || !m.body.collides(x, p.pos.y - 0.3, z)) continue;
    p.yaw = yaw; p.pitch = -0.05;
    m.body.pos.set(x, p.pos.y, z); break;
  }
  m.body.vel.set(0, 0, 0); m.beh = 'hold'; m.post = { x: m.body.pos.x, y: m.body.pos.y, z: m.body.pos.z };
  m.body.prev.copy(m.body.pos); m.body.rpos.copy(m.body.pos);
  return m.id;
}, d);
await A.evaluate(() => { __game.settings.hzdm.atk = false; __game.horde.cfg.atk = false; });
await sleep(300);
let id = await place(4);
await sleep(250);
st = await A.evaluate((id) => {
  const g = __game, cb = g.combat, m = g.horde.byId.get(id);
  cb.switchTo(0); cb.switchEnd = 0; cb.bloom = 0; const w = cb.w; w.nextFire = 0; const hp0 = m.hp;
  g.camera.updateMatrixWorld(); cb.fire(w, performance.now());
  return { hp0, id };
}, id);
await sleep(300);
let st2 = await A.evaluate((id) => { const m = __game.horde.byId.get(id); return { hp: m.hp, max: m.maxHp }; }, id);
ok('用槍打機器人：子彈判定打得到它、房主扣它的血', st2.hp < st.hp0, JSON.stringify([st, st2]));
const k0 = await A.evaluate(() => __game.gs.hz.k[0]);
id = await place(1.1);
await sleep(250);
await A.evaluate(() => { const cb = __game.combat; cb.switchTo(2); cb.switchEnd = 0; cb.w.nextFire = 0; __game.camera.updateMatrixWorld(); cb.melee(cb.w, performance.now(), false); });
await sleep(500);
st = await A.evaluate((id) => ({ dead: !__game.horde.byId.get(id) || !__game.horde.byId.get(id).alive, k: __game.gs.hz.k[0], feed: document.getElementById('feed').textContent }), id);
ok('出刀砍機器人一刀死，擊倒數 +1，擊倒訊息有出現', st.dead && st.k === k0 + 1 && st.feed.includes('房主'), JSON.stringify(st));
const respawned = await until(A, () => __game.horde.mobs.filter((m) => m.alive).length === 8, null, 6000);
ok('死鬥：倒下的機器人過幾秒會補一個新的', respawned);

// 定點不動 + 不開槍：當靶子
await dm({ n: 4, beh: 'hold', atk: false });
await until(A, () => __game.phase === 'horde' && __game.horde.mobs.filter((m) => m.alive).length === 4, null, 8000);
await sleep(800);
const pos = () => A.evaluate(() => __game.horde.mobs.filter((m) => m.alive).map((m) => [m.id, m.body.pos.x, m.body.pos.z]));
const p0 = await pos(); await sleep(3500); const p1 = await pos();
const moved = p0.map(([id, x, z]) => { const q = p1.find((r) => r[0] === id); return q ? Math.hypot(q[1] - x, q[2] - z) : 0; });
st = await A.evaluate(() => ({ hp: __game.gs.p[0].hp, d: __game.gs.hz.d[0] }));
ok('「定點不動」＋「不開槍」：機器人站著不動、也不會打你', Math.max(...moved) < 0.6 && st.hp === 100 && st.d === 0, JSON.stringify({ moved, st }));

// 定點左右閃：會動，但不會離開原位太遠
await dm({ n: 4, beh: 'strafe', atk: false });
await until(A, () => __game.phase === 'horde' && __game.horde.mobs.filter((m) => m.alive).length === 4, null, 8000);
await A.evaluate(() => { const g = __game, m = g.horde.mobs[0]; g.player.spawn({ x: m.post.x + 6, y: m.post.y, z: m.post.z, yaw: Math.PI / 2 }); });
await sleep(4000);
st = await A.evaluate(() => { const m = __game.horde.mobs.find((x) => x.alive && x.vis[0]); return m ? { off: Math.hypot(m.body.pos.x - m.post.x, m.body.pos.z - m.post.z), moved: Math.hypot(m.body.pos.x - m.post.x, m.body.pos.z - m.post.z) > 0.2 || m.body.speed2d() > 0.5 } : null; });
ok('「定點左右閃」：看到你會左右閃，但不會離開原位兩公尺以上', st && st.moved && st.off < 2.4, JSON.stringify(st));

// 時間到：結算
await dm({ n: 4, beh: 'hold', atk: false, time: 120 });
await until(A, () => __game.phase === 'horde' && __game.horde.mobs.filter((m) => m.alive).length === 4, null, 8000);
await sleep(400);
st = await A.evaluate(() => ({ left: __game.authority.hz.end - Date.now(), timer: document.getElementById('timer').textContent }));
ok('死鬥設 2 分鐘：倒數計時有在跑', st.left > 110000 && st.left <= 120000 && /^[12]:\d\d$/.test(st.timer), JSON.stringify(st));
await A.evaluate(() => { const g = __game, h = g.horde; for (const m of h.mobs) if (m.alive) h.hit(0, { id: m.id, d: 999, h: true, w: 'ar' }); });
await sleep(300);
await A.evaluate(() => { __game.authority.hz.end = Date.now() + 200; });
await until(A, () => __game.phase === 'matchEnd', null, 5000);
await sleep(400);
st = await A.evaluate(() => ({ title: document.getElementById('end-title').textContent, score: document.getElementById('end-score').textContent, stats: document.getElementById('end-stats').textContent, best: JSON.parse(localStorage.getItem('rubble.hzbest') || '{}'), views: [...__game.horde.views.values()].length, again: document.getElementById('btn-rematch').textContent }));
ok('死鬥時間到：結算顯示擊倒數、爆頭，記下最佳紀錄，機器人都收掉', st.title === '時間到' && st.score.startsWith('4') && st.stats.includes('爆頭') && st.best['dm:120:4'] === 4 && st.views === 0 && st.again === '再來一次', JSON.stringify(st));
await A.screenshot({ path: OUT + '/hz3-dm-end.png' });

// ═════════ 守據點（自己一個人）═════════
await A.evaluate(() => { __game.leave(); __game.settings.hzlv = 'normal'; __game.practiceHorde('defense'); });
await until(A, () => __game.phase === 'horde' && __game.horde.core, null, 8000);
await sleep(500);
st = await A.evaluate(() => {
  const g = __game, c = g.horde.core, hz = g.gs.hz;
  return { st: hz.st, cp: hz.cp, c, sky: !g.world.raycast(c[0], c[1] + 2.8, c[2], 0, 1, 0, 40), gates: hz.gates.length, sk: g.skills.slots, uses: g.skills.uses[0], wall: g.skills.wallType, bar: !document.getElementById('hz-core').classList.contains('hidden'),
    dme: Math.hypot(g.player.pos.x - c[0], g.player.pos.z - c[2]), line: document.getElementById('hz-line').textContent };
});
ok('守據點：據點在露天的地面上、玩家生在旁邊、下一波的方向已經決定', st.st === 'break' && st.cp && st.cp.join() === st.c.join() && st.sky && st.gates >= 1 && st.dme < 7 && st.bar, JSON.stringify(st));
ok('守據點：技能格是沙包牆（3 次），提示寫著下一波從哪來', st.sk[0] === 'wall' && st.uses === 3 && st.wall === 18 && /從.+來/.test(st.line), JSON.stringify(st));
// 蓋沙包牆
const bags = () => A.evaluate(() => { const t = __game.world.types; let n = 0; for (let i = 0; i < t.length; i++) if (t[i] === 18) n++; return n; });
const b0 = await bags();
await A.evaluate(() => { const g = __game, c = g.horde.core; g.player.spawn({ x: c[0] + 3, y: c[1], z: c[2], yaw: -Math.PI / 2 }); });
await sleep(300);
st = await A.evaluate(() => ({ ok: __game.skills.use(0), uses: __game.skills.uses[0] }));
const b1 = await bags();
ok('按技能鍵蓋出一道沙包牆（次數 -1）', st.ok && b1 - b0 >= 4 && st.uses === 2, JSON.stringify({ st, b0, b1 }));
// 商店：衝鋒槍以外的主武器要撐到後面才開放
await A.evaluate(() => __game.openBuy());
await sleep(400);
st = await A.evaluate(() => { const g = __game; g.buy('p', 'ar'); const ar = document.querySelector('.wcard[data-id="ar"]'); return { p: g.hsel.p, locked: ar.classList.contains('locked'), price: ar.querySelector('.price').textContent, smg: document.querySelector('.wcard[data-id="smg"]').classList.contains('locked') }; });
ok('守據點的商店：步槍鎖著（第 3 波開放），衝鋒槍可以拿', st.p !== 'ar' && st.locked && st.price === '第 3 波開放' && !st.smg, JSON.stringify(st));
await A.screenshot({ path: OUT + '/hz4-def-shop.png' });
await A.evaluate(() => __game.closeBuy());

// 第一波
await god(A, true);
await A.evaluate(() => { __game.authority.hz.next = Date.now(); });
await until(A, () => __game.gs.hz.st === 'wave' && __game.horde.list.length === 0 && __game.horde.mobs.filter((m) => m.alive).length >= 4, null, 12000);
st = await A.evaluate(() => {
  const h = __game.horde, g = h.gates;
  return { n: h.mobs.length, near: h.mobs.every((m) => g.some((q) => Math.hypot(m.post.x - q.x, m.post.z - q.z) < 6)), line: document.getElementById('hz-line').textContent, timer: document.getElementById('timer').textContent };
});
ok('第 1 波：4 個步兵從預告的方向生出來', st.n === 4 && st.near && st.line.includes('剩') && st.timer === '第 1 波', JSON.stringify(st));
const c0 = await A.evaluate(() => __game.gs.hz.core);
const hit = await until(A, (c0) => __game.gs.hz.core < c0 - 20, c0, 30000);
ok('機器人會走到據點附近開槍打它', hit, String(c0));
await A.screenshot({ path: OUT + '/hz5-def-wave.png' });
// 自爆兵：衝到據點旁邊炸開
st = await A.evaluate(() => {
  const h = __game.horde, c = h.core, sp = h._pick((s) => { const d = Math.hypot(s.x - c[0], s.z - c[2]); return d > 5 && d < 9; }, 400);
  const m = h._spawn('bomber', 'core', sp); return { id: m && m.id, core: __game.authority.hz.core };
});
const boomed = await until(A, (s) => !__game.horde.byId.get(s.id) || !__game.horde.byId.get(s.id).alive, st, 15000);
await sleep(300);
st2 = await A.evaluate(() => __game.authority.hz.core);
ok('自爆兵衝到據點旁邊炸開，據點掉一大塊血', boomed && st.core - st2 >= 40, JSON.stringify({ st, st2 }));
// 清光這一波 → 休息、選卡、據點回一點血
const coreBefore = await A.evaluate(() => { const h = __game.horde; h.list.length = 0; for (const m of h.mobs) if (m.alive) h.hit(0, { id: m.id, d: 9999, h: false, w: 'ar' }); return __game.authority.hz.core; });
await until(A, () => __game.gs.hz.st === 'break', null, 5000);
await sleep(1500);
st = await A.evaluate(() => ({ st: __game.gs.hz.st, cleared: __game.gs.hz.cleared, core: __game.gs.hz.core, ch: __game.gs.p[0].ch, buy: __game.buyOpen, cards: document.querySelectorAll('#lo-buff-cards .card').length, uses: __game.skills.uses[0] }));
const bad = ['plate', 'arsenal', 'radar', 'ghost', 'investor', 'thorns', 'cryo', 'incendiary', 'blink', 'wall', 'orbital'];
ok('一波清光：進入休息、據點回血、商店自動打開讓你選強化卡、沙包牆次數補滿', st.st === 'break' && st.cleared === 1 && st.core > coreBefore && st.buy && st.cards === 3 && st.ch.every((id) => !bad.includes(id)) && st.uses === 3, JSON.stringify({ st, coreBefore }));
await A.screenshot({ path: OUT + '/hz6-def-break.png' });
await A.evaluate(() => { const a = __game.authority; a.players[0].choices = ['vital', 'tough', 'steady']; a.dirty = true; a.flush(); });
await sleep(300);
await A.click('.card[data-id="vital"]');
await sleep(400);
st = await A.evaluate(() => ({ bf: __game.gs.p[0].bf, mhp: __game.gs.p[0].mhp, ch: __game.gs.p[0].ch }));
ok('選了「厚血」：血量上限變 135', st.bf.includes('vital') && st.mhp === 135 && !st.ch, JSON.stringify(st));
await A.evaluate(() => __game.closeBuy());
await sleep(200);
const mag0 = await A.evaluate(() => __game.combat.slots[0].mag);
await A.evaluate(() => { const a = __game.authority; a.players[0].buffs.push('mag'); a.dirty = true; a.flush(); });   // 等於下一波開始時自動拿到「擴充彈匣」
await sleep(300);
st = await A.evaluate(() => ({ m: __game.combat.mods.mag, mag: __game.combat.slots[0].mag }));
ok('拿到新卡（沒有重生、沒換槍）馬上生效：彈匣變大', st.m === 1.5 && st.mag > mag0, JSON.stringify({ mag0, st }));
// 第 5 波有巨人；巨人會砲擊（先畫紅圈）
st = await A.evaluate(async () => { const H = await import(new URL('js/horde.js', location.href).href); return { w5: H.waveList(5).slice(-1)[0], w4: H.waveList(4).includes('boss'), two: H.waveList(3, true).length > H.waveList(3).length }; });
ok('每 5 波來一隻巨人；兩個人一起守時敵人比較多', st.w5 === 'boss' && !st.w4 && st.two, JSON.stringify(st));
await A.evaluate(() => { const a = __game.authority; a.hz.next = Date.now(); });
await until(A, () => __game.gs.hz.st === 'wave', null, 5000);
st = await A.evaluate(() => {
  const g = __game, h = g.horde, p = g.player.pos, sp = h._pick((s) => { const d = Math.hypot(s.x - p.x, s.z - p.z); return d > 8 && d < 16; }, 400);
  const m = h._spawn('boss', 'core', sp); m.artAt = performance.now(); m.vis[0] = true; return { id: m.id };
});
const warned = await until(A, () => __game.horde.warnM.some((m) => m.visible), null, 4000);
await sleep(600);
st = await A.evaluate((s) => ({ boss: __game.gs.hz.boss, bar: !document.getElementById('hz-boss').classList.contains('hidden'), scale: __game.horde.views.get(s.id).v.group.scale.x }), st);
ok('巨人：體型比較大、上面有血條、會先在地上畫紅圈再砲擊', warned && st.boss > 0.9 && st.bar && st.scale > 1.5, JSON.stringify(st));
await A.screenshot({ path: OUT + '/hz7-boss.png' });
// 據點被打爆 → 結算
await A.evaluate(() => { const a = __game.authority; a.hz.core = 3; a.hzCore(10); });
await until(A, () => __game.phase === 'matchEnd', null, 5000);
await sleep(400);
st = await A.evaluate(() => ({ title: document.getElementById('end-title').textContent, score: document.getElementById('end-score').textContent, best: JSON.parse(localStorage.getItem('rubble.hzbest') || '{}') }));
ok('據點被打爆：結算「據點被攻陷」、撐過 1 波、記下紀錄', st.title === '據點被攻陷' && st.score.startsWith('1') && st.best['def:normal'] === 1, JSON.stringify(st));
await A.screenshot({ path: OUT + '/hz8-def-end.png' });
await A.evaluate(() => __game.leave());

// ═════════ 兩個人一起守據點 ═════════
const B = await mk('B');
await A.evaluate(() => { document.getElementById('in-name').value = '阿強'; __game.setSetting('name', '阿強'); });
await load(A, `${BASE}?${Q}`);
await A.$eval('#in-name', (e) => { e.value = ''; }); await A.type('#in-name', '阿強');
await A.click('#btn-host');
await until(A, () => __game.phase === 'lobby', null, 25000);
const link = await A.evaluate(() => __game.inviteLink());
await load(B, link + '&nolock=1');
await B.$eval('#in-name', (e) => { e.value = ''; }); await B.type('#in-name', '小明');
await B.click('#btn-join');
await until(B, () => __game.phase === 'lobby', null, 30000);
await sleep(500);
await A.select('#set-map', 'plaza');
await A.select('#set-mode', 'defense');
await sleep(500);
st = await B.evaluate(() => ({ mode: __game.gs.set.mode, duelHidden: document.querySelector('#scr-lobby .duelopt').classList.contains('hidden'), lv: !document.getElementById('set-hzlv').parentElement.classList.contains('hidden'), n: document.getElementById('set-hzn').parentElement.classList.contains('hidden') }));
ok('大廳選「守據點」：訪客也看到，對戰的選項收起來、只剩難度', st.mode === 'defense' && st.duelHidden && st.lv && st.n, JSON.stringify(st));
await A.click('#btn-start');
await until(A, () => __game.phase === 'horde', null, 10000); await until(B, () => __game.phase === 'horde', null, 10000);
await sleep(1500);
st = { a: await A.evaluate(() => __game.horde.core), b: await B.evaluate(() => __game.horde.core) };
ok('兩邊的據點在同一個位置', st.a && st.b && st.a.join() === st.b.join(), JSON.stringify(st));
await god(A, true);
await A.evaluate(() => { __game.authority.hz.next = Date.now(); });
await until(A, () => __game.horde.list.length === 0 && __game.gs.hz.st === 'wave' && __game.horde.mobs.filter((m) => m.alive).length > 0, null, 15000);
await sleep(1500);
const mobsA = await A.evaluate(() => __game.horde.mobs.filter((m) => m.alive).map((m) => [m.id, m.body.pos.x, m.body.pos.z]));
const mobsB = await B.evaluate(() => [...__game.horde.views.values()].filter((o) => o.alive).map((o) => [o.id, o.v.pos.x, o.v.pos.z]));
const off = mobsA.map(([id, x, z]) => { const q = mobsB.find((r) => r[0] === id); return q ? Math.hypot(q[1] - x, q[2] - z) : 99; });
ok('訪客看到的機器人跟房主一樣（數量、位置）', mobsA.length >= 6 && mobsB.length === mobsA.length && Math.max(...off) < 2.5, JSON.stringify({ a: mobsA.length, b: mobsB.length, off: off.map((v) => +v.toFixed(2)) }));
// 訪客開槍打倒一隻
const tid = mobsA[0][0];
await B.evaluate((id) => __game.hitTarget(id, 999, true, 'ar'), tid);
await sleep(700);
st = { a: await A.evaluate((id) => ({ dead: !__game.horde.byId.get(id).alive, k: __game.gs.hz.k, feed: document.getElementById('feed').textContent }), tid), b: await B.evaluate((id) => ({ dead: !__game.horde.views.get(id) || !__game.horde.views.get(id).alive, k: __game.gs.hz.k })) };
ok('訪客打倒機器人：房主那邊它也倒了，擊倒算訪客的', st.a.dead && st.b.dead && st.a.k[1] === 1 && st.b.k[1] === 1 && st.a.feed.includes('小明'), JSON.stringify(st));
// 訪客打不到房主（同一隊）
await god(A, false);
const hp0 = await A.evaluate(() => { __game.authority.players[0].inv = Date.now() + 1e9; return __game.authority.players[0].hp; });
await B.evaluate(() => __game.auth('hit', { r: __game.round, d: 50, h: false, w: 'ar' }));
await sleep(400);
st = await A.evaluate(() => __game.authority.players[0].hp);
ok('機器人模式打不到隊友', st === hp0, `${hp0} → ${st}`);
// 機器人也會打訪客（房主先「倒下」，免得機器人一直打打不死的房主）
await A.evaluate(() => { const a = __game.authority; a.players[1].inv = 0; a.players[0].alive = false; a.players[0].respawnAt = Date.now() + 1e9; a.dirty = true; });
// 訪客走到空曠的地方、站在一隻機器人面前（躲在掩體後面的話機器人只會打據點）
await B.evaluate(() => {
  const g = __game, w = g.world, o = [...g.horde.views.values()].find((x) => x.alive); if (!o) return;
  const m = o.v.pos;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a), x = m.x + dx * 5, z = m.z + dz * 5;
    if (w.raycast(m.x, m.y + 1.5, m.z, dx, 0, dz, 5.5) || g.player.collides(x, m.y, z) || !g.player.collides(x, m.y - 0.3, z)) continue;
    g.player.spawn({ x, y: m.y, z, yaw: Math.atan2(dx, dz) }); return;
  }
});
const bh = await until(B, () => __game.gs.p[1].hp < 100 || __game.gs.hz.d[1] > 0, null, 25000);
ok('機器人也會開槍打訪客', bh);
await B.screenshot({ path: OUT + '/hz9-coop-guest.png' });
// 訪客蓋沙包牆 → 房主那邊也有；機器人打爛的掩體兩邊一樣
await A.evaluate(() => { const p = __game.authority.players[1]; p.inv = Date.now() + 1e9; if (!p.alive) p.respawnAt = 0; });
await until(B, () => __game.gs.p[1].al, null, 5000);
await B.evaluate(() => { const g = __game, c = g.horde.core; g.player.spawn({ x: c[0] - 3, y: c[1], z: c[2], yaw: Math.PI / 2 }); });
await sleep(300);
const wb = await B.evaluate(() => __game.skills.use(0));
await sleep(600);
await A.evaluate(() => { const h = __game.horde; h.list.length = 0; for (const m of h.mobs) if (m.alive) h.hit(0, { id: m.id, d: 9999, h: false, w: 'ar' }); });
await sleep(1500);
const ha = await hash(A), hb = await hash(B);
ok('訪客蓋的沙包牆、被打爛的地形，兩邊一模一樣', wb && ha === hb, `${ha} vs ${hb}`);
st = { a: await A.evaluate(() => [__game.gs.hz.st, __game.gs.p[0].ch && __game.gs.p[0].ch.length]), b: await B.evaluate(() => [__game.gs.hz.st, __game.gs.p[1].ch && __game.gs.p[1].ch.length, __game.buyOpen]) };
ok('一波打完，兩個人各自選強化卡', st.a[0] === 'break' && st.a[1] === 3 && st.b[1] === 3 && st.b[2], JSON.stringify(st));
// 訪客離開：房主自己繼續守
await B.evaluate(() => __game.leave());
await sleep(1500);
st = await A.evaluate(() => ({ ph: __game.phase, here: __game.gs.here[1], al: __game.gs.p[1].al }));
ok('隊友離開：房主留在遊戲裡自己繼續守', st.ph === 'horde' && !st.here && !st.al, JSON.stringify(st));

console.log(`\n${pass} pass, ${fail} fail`);
console.log('ERRORS:\n' + ([...new Set(errs)].slice(0, 12).join('\n') || '(none)'));
await browser.close();
process.exit(fail ? 1 : 0);
