// 新功能測試：身法物理、Shift 瞄準、機器人尋路（三張地圖）、地圖輪換
import puppeteer from 'puppeteer-core';
import { load, reload, CHROME } from './load.mjs';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] || 'shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || 'http://localhost:8765/').replace(/\/?$/, '/');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--window-size=1280,760', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 760 }, protocolTimeout: 90000 });
const errs = [];
const ok = (name, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
const open = async (store = {}) => {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').includes('favicon')) errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message + '\n' + e.stack));
  await page.evaluateOnNewDocument((store) => { for (const k in store) localStorage.setItem('rubble.' + k, JSON.stringify(store[k])); }, store);
  await load(page, BASE + '?nolock=1');
  await sleep(500);
  return page;
};

// ═══ 1. 身法物理（直接用固定時間步模擬，不受畫面更新率影響）═══
{
  const page = await open();
  const r = await page.evaluate(async () => {
    const { Player } = await import('./js/player.js');
    const { PLAYER: P } = await import('./js/config.js');
    // 一塊什麼都沒有的平地（48×48m），再放幾個測試用的積木
    const w = __game.world; w.types.fill(0); w.hp.fill(0); w.box(0, 0, 0, w.X - 1, 2, w.Z - 1, 1);
    const G = 3, DT = 1 / 120, out = {};
    w.box(20, G, 20, 23, G + 2, 23, 3);      // 1.5m 箱子：x 10~12m, z 10~12m
    w.box(20, G, 30, 23, G + 1, 33, 3);      // 1m 箱子：  x 10~12m, z 15~17m
    w.box(20, G + 3, 40, 31, G + 3, 51, 3);  // 矮通道的天花板（離地 1.5m）：x 10~16m, z 20~26m
    w.rev++;
    const mk = (x, z, yaw) => { const p = new Player(w); p.spawn({ x, y: 1.5, z, yaw }); for (let i = 0; i < 30; i++) p.update(DT, { f: 0, r: 0, jump: false, crouch: false, speed: 1 }); return p; };
    const run = (p, sec, inp, each) => { const n = Math.round(sec / DT); for (let i = 0; i < n; i++) { const a = typeof inp === 'function' ? inp(i * DT, p) : inp; p.update(DT, { f: 0, r: 0, jump: false, crouch: false, speed: 1, ...a }); if (each) each(p, i * DT); } };
    const timeTo = (p, inp, cond) => { for (let i = 0; i < 600; i++) { p.update(DT, { f: 0, r: 0, jump: false, crouch: false, speed: 1, ...inp }); if (cond(p)) return (i + 1) * DT; } return 99; };

    let p = mk(4, 4, -Math.PI / 2);          // 面向 +x
    out.accelTime = timeTo(p, { f: 1 }, (q) => q.speed2d() > P.SPEED * 0.95);
    run(p, 0.5, { f: 1 }); out.top = p.speed2d();
    out.coast = timeTo(p, {}, (q) => q.speed2d() < 0.3);
    p = mk(4, 4, -Math.PI / 2); run(p, 1, { f: 1 });
    out.counter = timeTo(p, { f: -1 }, (q) => q.speed2d() < P.SPEED * 0.3);   // 急停到可以準確開槍的速度
    p = mk(4, 4, -Math.PI / 2); run(p, 1.2, { f: 1, crouch: true }); out.crouchSpeed = p.speed2d(); out.crouchEye = p.eyeH; out.crouchH = p.h;
    // 連跳（只按 W + 空白）：速度不該被摩擦吃掉
    p = mk(4, 4, -Math.PI / 2); run(p, 1, { f: 1 }); let minS = 99; run(p, 3, { f: 1, jump: true }, (q, t) => { if (t > 0.5) minS = Math.min(minS, q.speed2d()); }); out.bhopKeep = minS;
    // 空中轉向：全速起跳後按住前進、把視角往右轉 90° → 前進方向跟著轉，速度不掉
    p = mk(6, 30, -Math.PI / 2); run(p, 0.8, { f: 1 });               // 面向 +x 跑到全速
    let minAir = 99; const yaw0 = p.yaw;
    for (let i = 0; i < 0.55 / DT; i++) { p.yaw = yaw0 - Math.min(Math.PI / 2, i * DT * 4); p.update(DT, { f: 1, r: 0, jump: i < 3, crouch: false, speed: 1 }); if (!p.onGround) minAir = Math.min(minAir, p.speed2d()); }
    out.steerMin = minAir; out.steerVx = p.vel.x; out.steerVz = p.vel.z;   // 轉完應該朝 +z
    // 一邊連跳一邊持續轉彎 3 秒：速度全程保持
    p = mk(24, 24, 0); run(p, 0.8, { f: 1 }); let turnMin = 99;
    for (let i = 0; i < 3 / DT; i++) { p.yaw -= 1.2 * DT; p.update(DT, { f: 1, r: 0, jump: true, crouch: false, speed: 1 }); turnMin = Math.min(turnMin, p.speed2d()); }
    out.turnMin = turnMin; out.turnMax = p.speed2d();
    // 60Hz 和 144Hz 的畫面更新率要得到一樣的結果（比最後的位置）
    const sim = (fps) => { const q = mk(24, 24, 0); const d = 1 / fps; for (let i = 0; i < 0.6 * fps; i++) q.update(d, { f: 1, r: 0, jump: false, crouch: false, speed: 1 }); for (let i = 0; i < 2 * fps; i++) { q.yaw -= 1.2 * d; q.update(d, { f: 1, r: 0, jump: true, crouch: false, speed: 1 }); } return [q.pos.x, q.pos.z]; };
    const a60 = sim(60), a144 = sim(144); out.fpsDiff = Math.hypot(a60[0] - a144[0], a60[1] - a144[1]);
    // 原地起跳後按前進：空中也能加速到跑速
    p = mk(4, 4, -Math.PI / 2); let airS = 0; run(p, 0.6, (t) => ({ f: 1, jump: t < 0.02 }), (q) => { if (!q.onGround) airS = Math.max(airS, q.speed2d()); }); out.airFromStand = airS;
    // 空中不按方向：速度維持不變
    p = mk(4, 4, -Math.PI / 2); run(p, 0.8, { f: 1 }); let coastMin = 99; run(p, 0.5, (t) => ({ jump: t < 0.03 }), (q) => { if (!q.onGround) coastMin = Math.min(coastMin, q.speed2d()); }); out.airCoast = coastMin;
    p = mk(4, 4, 0); let top = 0; run(p, 0.9, (t) => ({ jump: t < 0.05 }), (q) => { top = Math.max(top, q.pos.y - 1.5); }); out.jumpH = top;
    // 1.5m 箱子：普通跳上不去、蹲跳上得去
    p = mk(9.4, 11, -Math.PI / 2); run(p, 1.2, (t) => ({ f: 1, jump: t < 0.6 })); out.normalJumpY = p.pos.y;
    p = mk(9.4, 11, -Math.PI / 2); run(p, 1.2, (t) => ({ f: t < 0.75 ? 1 : 0, jump: t < 0.05, crouch: t > 0.12 && t < 0.7 })); out.crouchJumpY = p.pos.y; out.crouchJumpX = p.pos.x;
    // 貼著 1m 箱子從靜止起跳也上得去
    p = mk(9.69, 16, -Math.PI / 2); run(p, 1.2, (t) => ({ f: t < 0.6 ? 1 : 0, jump: t > 0.2 && t < 0.3 })); out.standJump1m = p.pos.y;
    // 矮通道：站著進不去、蹲著過得去、在裡面站不起來、出來自動站起來（往 +z 走）
    p = mk(13, 18.5, Math.PI); run(p, 1.2, { f: 1 }); out.standBlockedZ = p.pos.z;
    p = mk(13, 18.5, Math.PI); run(p, 1.6, { f: 1, crouch: true }); out.crouchInZ = p.pos.z;
    run(p, 0.3, {}); out.cantStand = p.crouched;
    run(p, 2.2, { f: 1, crouch: true }); run(p, 0.3, {}); out.standAfter = !p.crouched; out.exitZ = p.pos.z;
    w.reset('plaza');
    return out;
  });
  const f = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v));
  ok('起步到全速約 0.35 秒', r.accelTime > 0.2 && r.accelTime < 0.5, f(r.accelTime) + 's');
  ok('全速 6.4 m/s', Math.abs(r.top - 6.4) < 0.1, f(r.top));
  ok('放開方向鍵會滑行一小段才停（0.25~0.5 秒）', r.coast > 0.25 && r.coast < 0.5, f(r.coast) + 's');
  ok('按反方向急停明顯比較快（< 0.14 秒降到可開槍速度）', r.counter < 0.14, f(r.counter) + 's');
  ok('蹲走速度約 2.9 m/s、視線降低', Math.abs(r.crouchSpeed - 2.88) < 0.15 && r.crouchEye < 1.15 && r.crouchH === 1.3, `${f(r.crouchSpeed)} m/s, eye ${f(r.crouchEye)}`);
  ok('按住空白連跳不掉速', r.bhopKeep > 6.2, '最低 ' + f(r.bhopKeep));
  ok('空中轉向：視角轉 90°，前進方向跟著轉、速度不掉', r.steerMin > 6.3 && r.steerVz > 6 && Math.abs(r.steerVx) < 1.2, `最低 ${f(r.steerMin)} m/s，轉完速度 (${f(r.steerVx)}, ${f(r.steerVz)})`);
  ok('邊連跳邊轉彎 3 秒，速度全程保持', r.turnMin > 6.3 && r.turnMax < 6.5, `${f(r.turnMin)} ~ ${f(r.turnMax)} m/s`);
  ok('60Hz 與 144Hz 螢幕的移動結果一致', r.fpsDiff < 0.35, `終點差 ${f(r.fpsDiff)} m`);
  ok('原地起跳後空中能加速到跑速', r.airFromStand > 6.2 && r.airFromStand < 6.5, f(r.airFromStand));
  ok('空中不按方向鍵，速度維持', r.airCoast > 6.3, f(r.airCoast));
  ok('跳躍高度約 1.3m', r.jumpH > 1.2 && r.jumpH < 1.4, f(r.jumpH));
  ok('1.5m 箱子：普通跳上不去', Math.abs(r.normalJumpY - 1.5) < 0.01, 'y=' + f(r.normalJumpY));
  ok('1.5m 箱子：蹲跳上得去', Math.abs(r.crouchJumpY - 3.0) < 0.01 && r.crouchJumpX > 10 && r.crouchJumpX < 12.3, `y=${f(r.crouchJumpY)} x=${f(r.crouchJumpX)}`);
  ok('貼著 1m 箱子原地跳也上得去', Math.abs(r.standJump1m - 2.5) < 0.01, 'y=' + f(r.standJump1m));
  ok('矮通道：站著被擋住', r.standBlockedZ < 19.75, 'z=' + f(r.standBlockedZ));
  ok('矮通道：蹲著進得去，在裡面站不起來', r.crouchInZ > 20.4 && r.crouchInZ < 25.6 && r.cantStand === true, 'z=' + f(r.crouchInZ));
  ok('矮通道：走出來之後自動站起來', r.standAfter === true && r.exitZ > 26.3, 'z=' + f(r.exitZ));
  await page.close();
}

// ═══ 2. Shift 瞄準、C 蹲下、速度表（走真正的遊戲迴圈）═══
{
  const page = await open({ pmap: 'plaza', bot: 'dummy' });
  await page.click('#btn-bot'); await page.waitForFunction(() => __game.phase === 'loadout');
  await page.click('#btn-ready'); await page.waitForFunction(() => __game.phase === 'playing', { timeout: 15000 });
  await page.keyboard.down('ShiftLeft'); await sleep(450);
  const a1 = await page.evaluate(() => __game.combat.ads);
  await page.screenshot({ path: OUT + '/f1-shift-ads.png' });
  await page.keyboard.up('ShiftLeft'); await sleep(450);
  const a2 = await page.evaluate(() => __game.combat.ads);
  ok('按住 Shift 會瞄準、放開恢復', a1 > 0.95 && a2 < 0.05, `${a1.toFixed(2)} → ${a2.toFixed(2)}`);
  await page.keyboard.down('ShiftLeft'); await sleep(300);
  const am0 = await page.evaluate(() => __game.combat.w.ammo);
  await page.evaluate(() => { __game.mouse.l = true; __game.mouse.lp = true; }); await sleep(300);
  const am1 = await page.evaluate(() => { __game.mouse.l = false; return { ammo: __game.combat.w.ammo, ads: __game.combat.ads }; });
  await page.keyboard.up('ShiftLeft');
  ok('Shift 瞄準時可以同時按左鍵開火', am1.ammo < am0 && am1.ads > 0.9, `彈藥 ${am0}→${am1.ammo}`);
  await page.keyboard.down('KeyC'); await sleep(400);
  const c1 = await page.evaluate(() => ({ cr: __game.player.crouched, eye: __game.player.eyeH, cls: document.getElementById('speed').className }));
  await page.keyboard.up('KeyC'); await sleep(300);
  ok('按 C 蹲下', c1.cr && c1.eye < 1.2 && c1.cls.includes('crouch'), JSON.stringify(c1));
  await page.keyboard.down('KeyW'); await sleep(700);
  const sp = await page.$eval('#speed-n', (e) => e.textContent);
  await page.keyboard.up('KeyW');
  ok('速度表顯示跑速', Math.abs(parseFloat(sp) - 6.5) < 0.5, sp + ' m/s');
  const dm = await page.evaluate(() => ({ t: __game.gs.set.roundTime, n: __game.gs.p[1].n }));
  ok('木樁模式：對手不動、每局 15 分鐘', dm.t === 900 && dm.n === '木樁', JSON.stringify(dm));
  const b0 = await page.evaluate(() => __game.bot.body.pos.toArray()); await sleep(1200);
  const b1 = await page.evaluate(() => __game.bot.body.pos.toArray());
  ok('木樁真的不動', Math.hypot(b1[0] - b0[0], b1[2] - b0[2]) < 0.01);
  await page.close();
}

// ═══ 3. 機器人尋路：三張地圖，玩家站在各種位置，機器人都要在時限內走到看得見玩家的地方 ═══
for (const [map, spots] of [
  ['plaza', [['出生點', null], ['中央塔二樓', [32, 5, 32]], ['角落高台上', [48.5, 5.5, 14.75]], ['出生點牆後', [13, 1.5, 17]]]],
  ['lanes', [['出生點', null], ['隧道深處', [50.5, 4.5, 25]], ['公寓二樓', [40, 8, 23.5]], ['倉庫裡', [23, 4.5, 23.5]], ['長巷貨櫃後', [10.2, 4.5, 32]], ['地下道裡', [32, 2, 32]]]],
  ['yard', [['出生點', null], ['空貨櫃裡', [22.75, 2, 20.25]], ['中央第一層上', [32, 4, 30.25]], ['角落', [48, 1.5, 16]], ['碼頭高台上', [18, 2.5, 44]]]],
  ['quarry', [['出生點（高地）', null], ['谷底西側', [13, 3.5, 32]], ['礦坑隧道十字路口', [32, 3.5, 32]], ['東邊半高平台', [49, 5, 32]], ['中央台地上', [28, 6.5, 29]], ['山裡的地道', [41.75, 3.5, 20.4]]]],
]) {
  const page = await open({ pmap: map, bot: 'normal' });
  await page.click('#btn-bot'); await page.waitForFunction(() => __game.phase === 'loadout');
  await page.evaluate(() => { __game.bot.fire = () => {}; });
  await page.click('#btn-ready'); await page.waitForFunction(() => __game.phase === 'playing', { timeout: 15000 });
  for (const [name, pos] of spots) {
    const res = await page.evaluate(async (pos) => {
      const g = __game, b = g.bot, p = g.player;
      const sp = (await import('./js/maps.js')).MAPS[g.gs.map].spawns;
      // 每個位置都讓機器人從它的出生點重新出發
      b.body.spawn(sp[(1 + g.gs.round) % 2]); b.path = null; b.planAt = 0; b.holdT = 0; b.breachT = 0; b.stuckN = 0;
      if (pos) { p.pos.set(pos[0], pos[1], pos[2]); p.vel.set(0, 0, 0); p.unstick(); }
      const t0 = performance.now(), start = b.body.pos.clone();
      const seen = () => { const ex = b.body.pos.x, ey = b.body.pos.y + 1.62, ez = b.body.pos.z; let dx = p.pos.x - ex, dy = p.pos.y + 1.15 - ey, dz = p.pos.z - ez; const d = Math.hypot(dx, dy, dz); return d < 16 && !g.world.raycast(ex, ey, ez, dx / d, dy / d, dz / d, d); };
      return await new Promise((resolve) => {
        const iv = setInterval(() => {
          const t = (performance.now() - t0) / 1000;
          if (seen() || t > 30) { clearInterval(iv); resolve({ ok: seen(), t: +t.toFixed(1), moved: +b.body.pos.distanceTo(start).toFixed(1), hasPath: !!b.path, me: p.pos.toArray().map((v) => +v.toFixed(1)), bot: b.body.pos.toArray().map((v) => +v.toFixed(1)) }); }
        }, 100);
      });
    }, pos);
    ok(`[${map}] 機器人找到「${name}」的玩家`, res.ok, `${res.t} 秒，走了 ${res.moved}m${res.ok ? '' : ' ' + JSON.stringify(res)}`);
  }
  await page.screenshot({ path: `${OUT}/f2-bot-${map}.png` });
  // 讓機器人開槍：要能在時限內真的擊倒站著不動的玩家
  await page.evaluate(async () => { const g = __game; delete g.bot.fire; const sp = (await import('./js/maps.js')).MAPS[g.gs.map].spawns; g.player.spawn(sp[g.gs.round % 2]); g.bot.body.spawn(sp[(1 + g.gs.round) % 2]); g.bot.path = null; g.bot.planAt = 0; });
  let killed = true;
  try { await page.waitForFunction(() => __game.phase === 'roundEnd', { timeout: 45000 }); } catch { killed = false; }
  const k = await page.evaluate(() => ({ res: __game.gs.res, hp: __game.gs.p.map((p) => p.hp), bot: __game.bot.body.pos.toArray().map((v) => +v.toFixed(1)) }));
  ok(`[${map}] 機器人從出生點走過來擊倒玩家`, killed && k.res && k.res.winner === 1, JSON.stringify(k));
  await page.close();
}

// ═══ 4. 每局輪流換圖 ═══
{
  const page = await open({ bot: 'dummy' });
  await page.evaluate(() => { __game.settings.pmap = 'rotate'; });
  await page.click('#btn-bot'); await page.waitForFunction(() => __game.phase === 'loadout');
  const maps = [];
  for (let r = 0; r < 3; r++) {
    await page.click('#btn-ready'); await page.waitForFunction(() => __game.phase === 'playing', { timeout: 15000 });
    maps.push(await page.evaluate(() => `${__game.gs.map}:${__game.world.mapId}:${__game.pickDefs.length}`));
    await page.screenshot({ path: `${OUT}/f3-round${r + 1}.png` });
    if (r < 2) { await page.evaluate(() => { __game.authority.damage(1, 999, 0, 'ar', true); }); await page.waitForFunction(() => __game.phase === 'loadout', { timeout: 9000 }); await sleep(300); }
  }
  ok('每局輪流換圖，世界與補給品跟著換', maps.join() === 'plaza:plaza:5,lanes:lanes:6,yard:yard:5', maps.join());
  await page.close();
}
// ═══ 5. 設定（對局外）、自訂按鍵 ═══
{
  const page = await open({ pmap: 'plaza', bot: 'dummy' });
  await page.evaluate(() => localStorage.removeItem('rubble.binds'));
  await page.click('#btn-settings'); await sleep(200);
  ok('對局外可以開設定', await page.evaluate(() => !document.getElementById('pause').classList.contains('hidden') && document.getElementById('pause-title').textContent === '設定'));
  await page.click('.settab[data-tab="keys"]'); await sleep(150);                // 按鍵在設定的「按鍵」分頁
  await page.click('.kb[data-a="crouch"]'); await page.keyboard.press('KeyX'); await sleep(150);
  await page.click('.kb[data-a="he"]'); await page.keyboard.press('KeyW'); await sleep(150);   // 跟「前進」撞鍵 → 應該互換
  const b1 = await page.evaluate(() => JSON.stringify([__game.binds.crouch, __game.binds.he, __game.binds.fwd]));
  ok('改鍵成功；撞鍵時兩個動作互換', b1 === '["KeyX","KeyW","KeyG"]', b1);
  await page.click('.kb[data-a="he"]'); await page.keyboard.press('KeyG'); await sleep(150);   // 換回來
  await page.screenshot({ path: OUT + '/f4-settings.png' });
  await page.click('#btn-resume'); await sleep(150);
  ok('選單上的按鍵提示跟著更新', (await page.$eval('#keys-hint', (e) => e.textContent)).includes('X 蹲下'));
  await page.click('#btn-bot'); await page.waitForFunction(() => __game.phase === 'loadout');
  await page.click('#btn-ready'); await page.waitForFunction(() => __game.phase === 'playing', { timeout: 15000 });
  await page.keyboard.down('KeyX'); await sleep(300);
  const cx = await page.evaluate(() => __game.player.crouched);
  await page.keyboard.up('KeyX'); await page.keyboard.down('KeyC'); await sleep(300);
  const cc = await page.evaluate(() => __game.player.crouched);
  await page.keyboard.up('KeyC');
  ok('新按鍵 X 會蹲下，舊按鍵 C 不會', cx === true && cc === false, `X:${cx} C:${cc}`);
  await reload(page); await sleep(500);
  ok('按鍵設定重新整理後還在', (await page.evaluate(() => __game.binds.crouch)) === 'KeyX');
  await page.evaluate(() => localStorage.removeItem('rubble.binds'));
  await page.close();
}

// ═══ 5b. 滑鼠靈敏度：跟 Apex 同一套數字（每單位 0.022° × 靈敏度）、開鏡倍率、舊設定換算 ═══
{
  const page = await open({ pmap: 'plaza', bot: 'dummy', sens: 1, fov: 82 });
  await page.evaluate(() => { for (const k of ['asens', 'adsMul', 'raw', 'afov']) localStorage.removeItem('rubble.' + k); });
  await reload(page); await sleep(500);
  ok('舊版的靈敏度 1 換算成 Apex 的 5.73（手感不變）', (await page.evaluate(() => __game.settings.asens)) === 5.73, String(await page.evaluate(() => __game.settings.asens)));
  ok('舊版的視野（垂直 82°）換算成 Apex 的 98', (await page.evaluate(() => __game.settings.afov)) === 98, String(await page.evaluate(() => __game.settings.afov)));
  await page.click('#btn-settings'); await sleep(200);
  await page.$eval('#num-sens', (e) => { e.value = '1.6'; e.dispatchEvent(new Event('change')); });
  let st = await page.evaluate(() => ({ s: __game.settings.asens, rng: +document.getElementById('rng-sens').value, hint: document.getElementById('sens-hint').textContent, stored: localStorage.getItem('rubble.asens'), raw: document.getElementById('chk-raw').checked }));
  ok('數字框直接填 1.6：拉桿跟著動、記住、底下算出 eDPI 和轉一圈幾公分；原始輸入預設打開', st.s === 1.6 && st.rng === 1.6 && st.stored === '1.6' && st.hint.includes('eDPI 1280') && st.hint.includes('32.5') && st.raw, JSON.stringify(st));
  await page.$eval('#num-fov', (e) => { e.value = '90'; e.dispatchEvent(new Event('change')); });
  await page.click('#btn-resume'); await sleep(150);
  await page.click('#btn-bot'); await page.waitForFunction(() => __game.phase === 'loadout');
  await page.click('#btn-ready'); await page.waitForFunction(() => __game.phase === 'playing', { timeout: 15000 });
  await sleep(600);
  const vf = await page.evaluate(() => { const c = __game.camera, h = 2 * Math.atan(Math.tan(c.fov * Math.PI / 360) * 16 / 9) * 180 / Math.PI; return { v: c.fov, h16: h }; });
  ok('視野填 Apex 的 90：16:9 螢幕上水平 106.3°（跟 Apex 一樣）', Math.abs(vf.h16 - 106.26) < 0.1, JSON.stringify(vf));
  st = await page.evaluate(() => {
    const g = __game, p = g.player, c = g.combat, turn = (ads) => { g.locked = true; c.ads = ads; const y0 = p.yaw; dispatchEvent(new MouseEvent('mousemove', { movementX: 400 })); g.locked = false; return (y0 - p.yaw) * 180 / Math.PI; };
    g.setSetting('asens', 2); g.setSetting('adsMul', 0.5);
    const hip = turn(0), ads = turn(1), zoom = c.w.def.zoom;
    return { hip, ads, zoom };
  });
  ok('腰射：動 400 單位、靈敏度 2 → 轉 400 × 0.022° × 2 = 17.6°', Math.abs(st.hip - 17.6) < 0.01, JSON.stringify(st));
  ok('開鏡：照放大倍數等比變慢，再乘開鏡倍率 0.5', Math.abs(st.ads - 17.6 * 0.5 / st.zoom) < 0.01, JSON.stringify(st));
  await page.evaluate(() => { for (const k of ['sens', 'asens', 'adsMul', 'fov', 'afov']) localStorage.removeItem('rubble.' + k); });
  await page.close();
}

// ═══ 5c. 投擲物不限數量（只看錢）、少買一個；傷害報告算進打掉的護甲 ═══
{
  const page = await open({ pmap: 'plaza', bot: 'dummy' });
  await page.click('#btn-bot'); await page.waitForFunction(() => __game.phase === 'loadout');
  await sleep(300);
  let st = await page.evaluate(() => {
    const g = __game, out = {};
    g.buy('he'); g.buy('he'); out.two = g.sel.he;                      // $800：兩顆 $600
    g.buy('he'); out.three = g.sel.he;                                  // 第三顆 $900 > $800 → 買不起
    g.buy('he', null, true); out.dec = g.sel.he;                        // 少買一個
    const a = g.authority; a.players[0].money = 9000; a.dirty = true; a.flush();
    return out;
  });
  ok('投擲物一直點一直買，錢不夠才停；「少買一個」會減一', st.two === 2 && st.three === 2 && st.dec === 1, JSON.stringify(st));
  await sleep(300);
  await page.evaluate(() => { for (let i = 0; i < 6; i++) __game.buy('flash'); });
  await page.click('.gcard[data-id="flash"]', { button: 'right' }); await sleep(150);   // 右鍵 = 少買一個
  st = await page.evaluate(() => ({ flash: __game.sel.flash, dec: !!document.querySelector('.gcard[data-id="flash"] .dec'), auth: __game.authority.players[0].loadout.flash }));
  ok('閃光彈可以買到 6 顆（以前最多 2）；卡片上按右鍵少買一個，裁判那邊也是 5', st.flash === 5 && st.dec && st.auth === 5, JSON.stringify(st));
  await page.click('#btn-ready'); await page.waitForFunction(() => __game.phase === 'playing', { timeout: 15000 });
  await sleep(300);
  st = await page.evaluate(() => {
    const g = __game, a = g.authority, T = a.players[1];
    const nades = { ...g.combat.nades };
    T.armor = 50; T.hp = 100; a.players[0].rDmg = 0; a.players[0].dmg = 0;
    a.handle(0, 'hit', { r: a.round, d: 30, h: false, w: 'ar' });     // 全部被護甲吃掉
    a.handle(0, 'hit', { r: a.round, d: 30, h: false, w: 'ar' });     // 20 打護甲、10 打血
    return { nades, rdm: a.players[0].rDmg, hp: T.hp, armor: T.armor };
  });
  ok('開打後身上真的有 5 顆閃光彈', st.nades.flash === 5, JSON.stringify(st.nades));
  const am = await page.evaluate(async () => {
    const { WEAPONS } = await import('./js/weapons.js'), c = __game.combat, out = {};
    for (const id of ['rocket', 'gl']) { c.setLoadout({ p: id, s: 'pistol' }, []); const w = c.slots.find((x) => x && x.id === id); out[id] = { total: w.reserve === Infinity ? 'inf' : w.ammo + w.reserve, mag: w.mag, dmg: WEAPONS[id].dmg, r: WEAPONS[id].proj.radius }; }
    return out;
  });
  ok('火箭筒、榴彈槍子彈無限（傷害 140、半徑 5.5；榴彈槍一匣 6 發、傷害 105）', am.rocket.total === 'inf' && am.rocket.dmg === 140 && am.rocket.r === 5.5 && am.gl.mag === 6 && am.gl.total === 'inf' && am.gl.dmg === 105, JSON.stringify(am));
  ok('傷害報告：打在護甲上的也算（30 + 30 = 60，對手剩 90 血 0 護甲）', st.rdm === 60 && st.hp === 90 && st.armor === 0, JSON.stringify(st));
  await page.close();
}

// ═══ 6. 經濟：連敗加碼、商店每局重置 ═══
{
  const page = await open({ pmap: 'plaza', bot: 'dummy' });
  await page.click('#btn-bot'); await page.waitForFunction(() => __game.phase === 'loadout');
  await page.evaluate(() => { __game.authority.settings.buffMode = 'off'; __game.authority.settings.target = 10; });
  const incs = [], sels = [];
  let carried = null, bought = null;
  for (let r = 1; r <= 5; r++) {
    await sleep(300);
    sels.push(await page.evaluate(() => `${__game.gs.p[0].$}→${JSON.stringify(Object.values(__game.sel))}`));
    if (r >= 2) { await page.evaluate(() => { __game.buy('p', 'ar'); __game.buy('armor'); __game.buy('flash'); }); await sleep(200); }   // 每局都把錢花掉，才不會碰到金錢上限
    await page.click('#btn-ready'); await page.waitForFunction(() => __game.phase === 'playing', { timeout: 15000 });
    if (r === 2) bought = await page.evaluate(() => `${__game.combat.slots[0] && __game.combat.slots[0].id}/${__game.gs.p[0].ar}/${__game.combat.nades.flash}/$${__game.gs.p[0].$}`);
    await page.evaluate(() => __game.authority.damage(0, 999, 1, 'pistol', false));   // 我輸
    await page.waitForFunction(() => __game.phase === 'roundEnd', { timeout: 5000 });
    incs.push(await page.evaluate(() => __game.gs.res.inc.join('/')));
    await page.waitForFunction(() => __game.phase === 'loadout', { timeout: 9000 });
    if (r === 2) { await sleep(300); carried = await page.evaluate(() => JSON.stringify({ sel: __game.sel, host: __game.gs.p[0].lo })); }
  }
  const empty = '[null,"pistol",0,0,0,0,0]', none = { p: null, s: 'pistol', armor: 0, he: 0, flash: 0, smoke: 0, molotov: 0 };
  ok('連敗加碼：3000 → 3500 → 4000 → 4500（上限），贏家固定 2000', incs.join(' ') === '3000/2000 3500/2000 4000/2000 4500/2000 4500/2000', incs.join(' '));
  ok('商店每局都是空的（只有免費手槍），有錢也不會自動買', sels.every((x) => x.endsWith('→' + empty)), '每局開始的錢：' + sels.map((x) => x.split('→')[0]).join(' → '));
  ok('第 2 局買的步槍、防彈衣、閃光彈有拿到並扣錢', bought === 'ar/50/1/$500', bought);
  ok('上一局買的東西不會沿用到下一局', carried === JSON.stringify({ sel: none, host: none }), carried);
  // 金錢上限：快滿的時候只會補到 $12000
  await page.evaluate(() => { __game.authority.players[0].money = 11000; });
  await page.click('#btn-ready'); await page.waitForFunction(() => __game.phase === 'playing', { timeout: 15000 });
  await page.evaluate(() => __game.authority.damage(0, 999, 1, 'pistol', false));
  await page.waitForFunction(() => __game.phase === 'roundEnd', { timeout: 5000 });
  const cap = await page.evaluate(() => `${__game.gs.p[0].$}/${__game.gs.res.inc[0]}`);
  ok('金錢上限 $12000', cap === '12000/1000', cap);
  await page.waitForFunction(() => __game.phase === 'loadout', { timeout: 9000 });
  ok('關閉強化後輸家不會有強化選項', (await page.evaluate(() => __game.gs.p[0].ch)) === null);
  await page.screenshot({ path: OUT + '/f5-buy.png' });
  await page.close();
}

// ═══ 6b. 經濟無限：每局錢補滿、第 1 局就能買主武器、不顯示拿到多少錢 ═══
{
  const page = await open({ pmap: 'plaza', bot: 'dummy', inf: true });
  await page.click('#btn-bot'); await page.waitForFunction(() => __game.phase === 'loadout');
  await sleep(300);
  await page.evaluate(() => { __game.buy('p', 'sniper'); __game.buy('armor'); __game.buy('he'); __game.buy('flash'); });
  await sleep(300);
  let st = await page.evaluate(() => ({ econ: __game.gs.set.econ, $: __game.gs.p[0].$, p: __game.sel.p, title: document.getElementById('lo-title').textContent, money: document.getElementById('lo-money').textContent }));
  ok('經濟無限：第 1 局就能買狙擊槍，商店顯示 $∞', st.econ === 'inf' && st.$ === 99999 && st.p === 'sniper' && st.money.includes('∞') && st.title.includes('經濟無限'), JSON.stringify(st));
  await page.click('#btn-ready'); await page.waitForFunction(() => __game.phase === 'playing', { timeout: 15000 });
  await sleep(300);
  st = await page.evaluate(() => ({ gun: __game.combat.slots[0] && __game.combat.slots[0].id, ar: __game.gs.p[0].ar, hud: document.getElementById('money').textContent }));
  ok('買的狙擊槍、防彈衣有拿到；遊戲中錢顯示 $∞', st.gun === 'sniper' && st.ar === 50 && st.hud === '$∞', JSON.stringify(st));
  await page.evaluate(() => __game.authority.damage(0, 999, 1, 'pistol', false));
  await page.waitForFunction(() => __game.phase === 'roundEnd', { timeout: 5000 });
  const inc = await page.evaluate(() => __game.gs.res.inc);
  await page.waitForFunction(() => __game.phase === 'loadout', { timeout: 9000 });
  await sleep(300);
  const m2 = await page.evaluate(() => __game.gs.p[0].$);
  ok('回合結束不顯示拿到多少錢；下一局錢又補滿', inc === null && m2 === 99999, JSON.stringify({ inc, m2 }));
  await page.close();
}

// ═══ 7. 手榴彈、閃光彈、煙霧彈 ═══
{
  const page = await open({ pmap: 'plaza', bot: 'dummy' });
  await page.click('#btn-bot'); await page.waitForFunction(() => __game.phase === 'loadout');
  await page.click('#btn-ready'); await page.waitForFunction(() => __game.phase === 'playing', { timeout: 15000 });
  await sleep(300);
  // 手榴彈：放在木樁腳邊，引信到了要扣對手血、炸掉方塊
  const he = await page.evaluate(async () => {
    const g = __game, r = g.remote.pos, rev = g.world.rev;
    g.combat.spawnProjectile('he', 999001, [r.x + 0.8, r.y + 0.3, r.z], [0, 0, 0], true);
    await new Promise((res) => setTimeout(res, 2100));
    return { hp: g.gs.p[1].hp, ar: g.gs.p[1].ar, broke: g.world.rev - rev, mine: g.gs.p[0].hp };
  });
  ok('手榴彈炸傷對手、炸開方塊，遠處的自己沒事', he.hp < 100 && he.hp > 0 && he.broke > 0 && he.mine === 100, JSON.stringify(he));
  // 閃光彈：正對著看 → 全白；隔著牆 → 沒事；背對 → 只白一點
  const fl = await page.evaluate(async () => {
    const g = __game, p = g.player, out = {};
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const op = () => +document.getElementById('flashfx').style.opacity;
    const go = async (x, z, yaw, fx, fz) => {
      g.hud.clearFlash(); p.pos.set(x, 1.5, z); p.vel.set(0, 0, 0); p.yaw = yaw; p.pitch = 0; await wait(200);
      g.combat.spawnProjectile('flash', 999002 + Math.random(), [fx, 2.6, fz], [0, 0, 0], true); await wait(1500);
      return op();
    };
    out.facing = await go(38, 12, -Math.PI / 2, 44, 12);        // 面向 +x，閃光在前方 6m
    await wait(2600);
    out.behind = await go(38, 12, Math.PI / 2, 44, 12);         // 背對
    await wait(1500);
    out.wall = await go(17, 17, -Math.PI / 2, 24, 17);       // 出生點磚牆（x 20~21m）的另一邊
    return out;
  });
  ok('閃光彈：正對全白、背對較輕、隔牆沒事', fl.facing >= 0.95 && fl.behind > 0.2 && fl.behind < fl.facing && fl.wall === 0, JSON.stringify(fl));
  // 煙霧彈：煙團出現、擋住視線判定、時間到消失
  const sm = await page.evaluate(async () => {
    const g = __game, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    g.doExplosion({ p: [38, 1.5, 12], kind: 'smoke', cloud: 3.4, dur: 4, pid: 7 });   // 煙在第 0.5 秒到「持續時間 - 1.2 秒」之間擋視線；慢的電腦上檢查會晚一點，所以放久一點
    await wait(900);
    const a = { n: g.fx.clouds.length, through: g.fx.smokeBlocked(32, 2.5, 12, 44, 2.5, 12), beside: g.fx.smokeBlocked(32, 2.5, 20, 44, 2.5, 20) };
    await wait(3600);
    return { ...a, after: g.fx.clouds.length };
  });
  ok('煙霧彈：擋住穿過煙的視線、旁邊不受影響、時間到消失', sm.n === 1 && sm.through === true && sm.beside === false && sm.after === 0, JSON.stringify(sm));
  await page.close();
}
{
  // 機器人：隔著煙不會開槍；被閃到也不會開槍
  const page = await open({ pmap: 'plaza', bot: 'hard' });
  await page.click('#btn-bot'); await page.waitForFunction(() => __game.phase === 'loadout');
  await page.click('#btn-ready'); await page.waitForFunction(() => __game.phase === 'playing', { timeout: 15000 });
  const r = await page.evaluate(async () => {
    const g = __game, b = g.bot, p = g.player, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    let shots = 0; b.fire = () => { shots++; b.nextShot = performance.now() + 100; };
    const place = () => { p.pos.set(34, 1.5, 12); p.vel.set(0, 0, 0); b.body.pos.set(48, 1.5, 12); b.body.vel.set(0, 0, 0); b.path = null; b.planAt = performance.now() + 5000; b.holdT = 5; };  // 兩邊站定、相距 14m、中間沒東西
    place(); await wait(1200); const open = shots;
    place(); g.doExplosion({ p: [41, 1.5, 12], kind: 'smoke', cloud: 3.4, dur: 8, pid: 9 }); await wait(700);
    shots = 0; place(); await wait(1200); const smoked = shots;
    g.fx.clearClouds(); place(); await wait(800); shots = 0;
    b.body.yaw = Math.PI / 2; b.onFlash(44, 2.5, 12); const blind = b.blindUntil - performance.now();
    place(); await wait(900); const flashed = shots;
    return { open, smoked, flashed, blindMs: Math.round(blind) };
  });
  ok('機器人：沒遮蔽會開槍、隔著煙不開槍、被閃到不開槍', r.open > 0 && r.smoked === 0 && r.flashed === 0 && r.blindMs > 1500, JSON.stringify(r));
  await page.close();
}
console.log('ERRORS:\n' + (errs.join('\n') || '(none)'));
await browser.close();
