// 練習模式：逐把槍試射、物理檢查、讓 bot 殺玩家走完「輸→選強化→下一局」
import puppeteer from 'puppeteer-core';
import { load, reload } from './load.mjs';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] || 'shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || 'http://localhost:8765/').replace(/\/?$/, '/'); // 要測線上版就設 BASE=網址
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1280,760', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 760 }, protocolTimeout: 40000 });
const page = await browser.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').includes('favicon')) errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message + '\n' + e.stack));
const ok = (name, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
const waitPhase = (ph, ms = 15000) => page.waitForFunction((ph) => __game.phase === ph, { timeout: ms }, ph);
// 這支測試的座標是照「廢墟廣場」寫的，所以固定地圖與難度
await page.evaluateOnNewDocument(() => { localStorage.setItem('rubble.pmap', '"plaza"'); localStorage.setItem('rubble.bot', '"normal"'); });
await load(page, BASE + '?nolock=1');
await sleep(600);
await page.screenshot({ path: OUT + '/p0-menu.png' });
await page.click('#btn-bot'); await waitPhase('loadout');
await page.screenshot({ path: OUT + '/p1-loadout.png' });
await page.evaluate(() => { __game.bot.fire = () => {}; }); // 先讓 bot 不開槍
await page.click('#btn-ready'); await waitPhase('playing');

// ── 物理：走上角落高台的樓梯 ──
const walk = async (x, y, z, yaw, ms, keys = { KeyW: true }) => {
  await page.evaluate((x, y, z, yaw, keys) => { const p = __game.player; p.pos.set(x, y, z); p.vel.set(0, 0, 0); p.yaw = yaw; p.pitch = 0; Object.assign(__game.keys, keys); }, x, y, z, yaw, keys);
  await sleep(ms);
  const r = await page.evaluate(() => { const p = __game.player; for (const k in __game.keys) __game.keys[k] = false; return { pos: p.pos.toArray().map((v) => +v.toFixed(2)), ground: p.onGround }; });
  return r;
};
// 樓梯：x 方塊 64..71（32~36m），z 方塊 9..11（4.5~6m），往 +x 走 → yaw = -90°
let r = await walk(30.5, 1.5, 5.25, -Math.PI / 2, 1600);
ok('走樓梯上高台', r.pos[1] >= 5.4 && r.ground, JSON.stringify(r));
await page.screenshot({ path: OUT + '/p2-on-platform.png' });
// 撞牆不穿牆：朝外圍牆走
r = await walk(3, 1.5, 24, Math.PI / 2, 1200);
ok('不會穿出外牆', r.pos[0] >= 1.29 && r.pos[0] < 1.5, JSON.stringify(r));
// 跳躍高度
await page.evaluate(() => { const p = __game.player; p.pos.set(10, 1.5, 3); p.vel.set(0, 0, 0); window.__maxY = 0; __game.keys.Space = true; window.__iv = setInterval(() => { window.__maxY = Math.max(window.__maxY, p.pos.y); }, 5); });
await sleep(900);
const jy = await page.evaluate(() => { clearInterval(window.__iv); __game.keys.Space = false; return window.__maxY - 1.5; });
ok('跳躍高度約 1.3m（跳得上 1m 的箱子）', jy > 1.1 && jy < 1.5, jy.toFixed(2));

// ── 每把槍試射 ──
const fireTest = async (id, slot) => {
  await page.evaluate((id, slot) => { const g = __game; const lo = slot === 'p' ? { p: id, s: 'pistol' } : { p: 'ar', s: id }; g.combat.setLoadout(lo, []); if (slot === 's') g.combat.switchTo(1); const p = g.player; p.pos.set(12, 1.5, 8); p.vel.set(0, 0, 0); p.yaw = -Math.PI / 2; p.pitch = -0.05; }, id, slot);
  await sleep(450);
  const before = await page.evaluate(() => __game.combat.w.ammo);
  await page.evaluate(() => { __game.mouse.l = true; __game.mouse.lp = true; });
  await sleep(500);
  const mid = await page.evaluate(() => { __game.mouse.l = false; return { ammo: __game.combat.w.ammo, proj: __game.combat.projectiles.length, id: __game.combat.w.id }; });
  await sleep(1900);
  ok(`試射 ${id}`, mid.id === id && mid.ammo < before, `彈藥 ${before}→${mid.ammo}${mid.proj ? ' 飛行中彈體 ' + mid.proj : ''}`);
};
for (const id of ['ar', 'smg', 'shotgun', 'dmr', 'sniper', 'lmg', 'rocket', 'gl']) await fireTest(id, 'p');
for (const id of ['pistol', 'revolver', 'mp']) await fireTest(id, 's');
ok('拋射物都已清掉', (await page.evaluate(() => __game.combat.projectiles.length)) === 0);

// 狙擊鏡截圖 + 換彈
await page.evaluate(() => { const g = __game; g.combat.setLoadout({ p: 'sniper', s: 'pistol' }, []); g.player.pos.set(8, 1.5, 3.2); g.player.yaw = -Math.PI / 2; g.player.pitch = 0.02; g.mouse.r = true; });
await sleep(700);
await page.screenshot({ path: OUT + '/p3-scope.png' });
await page.evaluate(() => { __game.mouse.r = false; __game.combat.w.ammo = 1; __game.reloadPressed = true; });
await sleep(300);
const rl = await page.evaluate(() => __game.combat.reloadProgress());
ok('換彈進行中', rl > 0 && rl < 1, rl.toFixed(2));
await page.screenshot({ path: OUT + '/p4-reload.png' });

// 補給品：扣血後去吃補包
await page.evaluate(() => { __game.authority.players[0].hp = 40; __game.authority.dirty = true; });
await sleep(200);
await page.evaluate(() => { const p = __game.player; p.pos.set(24, 1.5, 9); p.vel.set(0, 0, 0); });
await sleep(700);
const hp = await page.evaluate(() => ({ hp: __game.gs.p[0].hp, pk: __game.gs.pk }));
ok('吃到補血包 +40', hp.hp === 80 && hp.pk[0] === 0, JSON.stringify(hp));

// ── 讓 bot 把玩家打死 ──
// 兩邊都擺到空曠處，避免把人傳送進牆裡
await page.evaluate(() => { delete __game.bot.fire; __game.bot.level = 'hard'; const p = __game.player, b = __game.bot.body; p.pos.set(26, 1.5, 9.5); p.vel.set(0, 0, 0); b.pos.set(26, 1.5, 4); b.vel.set(0, 0, 0); });
try { await waitPhase('roundEnd', 20000); } catch (e) {
  console.log('DIAG bot 沒殺掉玩家：', JSON.stringify(await page.evaluate(() => { const g = __game, b = g.bot, now = performance.now(); const ex = b.body.pos.x, ey = b.body.pos.y + 1.62, ez = b.body.pos.z; let dx = b.tx - ex, dy = b.ty + 1.15 - ey, dz = b.tz - ez; const d = Math.hypot(dx, dy, dz); const hit = g.world.raycast(ex, ey, ez, dx / d, dy / d, dz / d, d);
    return { phase: g.phase, t: Math.round(g.phaseEnd - now), hp: g.gs.p.map((p) => p.hp), al: g.gs.p.map((p) => p.al), bot: b.body.pos.toArray().map((v) => +v.toFixed(2)), me: g.player.pos.toArray().map((v) => +v.toFixed(2)), tgt: [b.tx, b.ty, b.tz], w: b.weapon, ammo: b.ammo, next: Math.round(b.nextShot - now), react: Math.round(b.reactAt - now), stuck: +b.stuck.toFixed(2), dist: +d.toFixed(2), block: hit && [hit.x, hit.y, hit.z, hit.type, +hit.dist.toFixed(2)], ownFire: Object.prototype.hasOwnProperty.call(b, 'fire'), yaw: +b.body.yaw.toFixed(2), pitch: +b.body.pitch.toFixed(2) }; })));
  throw e;
}
await sleep(500);
const res = await page.evaluate(() => ({ res: __game.gs.res, sc: __game.gs.p.map((p) => p.sc) }));
ok('bot 擊殺玩家得分', res.res.winner === 1 && res.sc[1] === 1, JSON.stringify(res));
await page.screenshot({ path: OUT + '/p5-dead.png' });
await waitPhase('loadout', 9000); await sleep(400);
await page.screenshot({ path: OUT + '/p6-buff.png' });
await page.click('.buffcard'); await sleep(300); await page.click('#btn-ready');
await waitPhase('playing', 12000);
ok('第 2 局開始，玩家帶著強化', (await page.evaluate(() => __game.gs.p[0].bf.length)) === 1 && (await page.evaluate(() => __game.round)) === 2);
// 玩家用狙擊殺 bot（爆頭）
await page.evaluate(() => { __game.bot.fire = () => {}; __game.combat.setLoadout({ p: 'sniper', s: 'pistol' }, []); });
const aimHead = () => { const g = __game, p = g.player, r = g.remote.pos; p.pos.set(r.x + 5, r.y, r.z + 0.01); p.vel.set(0, 0, 0); const dx = r.x - p.pos.x, dy = r.y + 1.62 - (p.pos.y + 1.62), dz = r.z - p.pos.z, l = Math.hypot(dx, dy, dz); p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.asin(dy / l); g.mouse.r = true; };
for (let i = 0; i < 8 && (await page.evaluate(() => __game.phase)) === 'playing'; i++) { await page.evaluate(aimHead); await sleep(500); await page.evaluate(aimHead); await page.evaluate(() => { __game.mouse.lp = true; }); await sleep(700); }
await waitPhase('roundEnd', 5000); await sleep(300);
const res2 = await page.evaluate(() => ({ res: __game.gs.res, sc: __game.gs.p.map((p) => p.sc), bf: __game.gs.p.map((p) => p.bf) }));
ok('狙擊爆頭擊殺 bot；贏了之後強化清空', res2.res.winner === 0 && res2.res.head === true && res2.bf[0].length === 0, JSON.stringify(res2));
await page.screenshot({ path: OUT + '/p7-win.png' });
console.log('ERRORS:\n' + (errs.join('\n') || '(none)'));
await browser.close();
