// 新功能測試：身法物理、Shift 瞄準、機器人尋路（三張地圖）、地圖輪換
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] || 'shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || 'http://localhost:8765/').replace(/\/?$/, '/');
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1280,760', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 760 }, protocolTimeout: 90000 });
const errs = [];
const ok = (name, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
const open = async (store = {}) => {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').includes('favicon')) errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message + '\n' + e.stack));
  await page.evaluateOnNewDocument((store) => { for (const k in store) localStorage.setItem('rubble.' + k, JSON.stringify(store[k])); }, store);
  await page.goto(BASE + '?nolock=1', { waitUntil: 'load' });
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
    // 旋轉跳：只按 D、視角往右轉；再換 A、視角往左轉 → 應該越跳越快
    p = mk(6, 30, -Math.PI / 2); run(p, 0.6, { f: 1 });
    let maxS = 0, hops = 0;
    for (let i = 0; i < 3 / DT; i++) { const right = Math.floor(i * DT / 0.75) % 2 === 0; p.yaw += (right ? -1 : 1) * 0.7 * DT; p.update(DT, { f: 0, r: right ? 1 : -1, jump: true, crouch: false, speed: 1 }); if (p.justJumped) hops++; maxS = Math.max(maxS, p.speed2d()); }
    out.strafeMax = maxS; out.hops = hops; out.strafeEnd = [p.pos.x, p.pos.z];
    // 60Hz 和 144Hz 的畫面更新率要得到一樣的結果
    const sim = (fps) => { const q = mk(6, 30, -Math.PI / 2); const d = 1 / fps; for (let i = 0; i < 0.6 * fps; i++) q.update(d, { f: 1, r: 0, jump: false, crouch: false, speed: 1 }); for (let i = 0; i < 2 * fps; i++) { q.yaw -= 0.7 * d; q.update(d, { f: 0, r: 1, jump: true, crouch: false, speed: 1 }); } return q.speed2d(); };
    out.fps60 = sim(60); out.fps144 = sim(144);
    // 空中不能直接加速：原地起跳後按 W，水平速度只能到 AIR_CAP
    p = mk(4, 4, -Math.PI / 2); let airS = 0; run(p, 0.5, (t) => ({ f: 1, jump: t < 0.02 }), (q) => { if (!q.onGround) airS = Math.max(airS, q.speed2d()); }); out.airFromStand = airS;
    p = mk(4, 4, 0); let top = 0; run(p, 0.9, (t) => ({ jump: t < 0.05 }), (q) => { top = Math.max(top, q.pos.y - 1.5); }); out.jumpH = top;
    // 1.5m 箱子：普通跳上不去、蹲跳上得去
    p = mk(9.4, 11, -Math.PI / 2); run(p, 1.2, (t) => ({ f: 1, jump: t < 0.6 })); out.normalJumpY = p.pos.y;
    p = mk(9.4, 11, -Math.PI / 2); run(p, 1.2, (t) => ({ f: t < 0.75 ? 1 : 0, jump: t < 0.05, crouch: t > 0.12 && t < 0.7 })); out.crouchJumpY = p.pos.y; out.crouchJumpX = p.pos.x;
    // 貼著 1m 箱子從靜止起跳也上得去
    p = mk(9.69, 16, -Math.PI / 2); run(p, 1.0, (t) => ({ f: 1, jump: t > 0.2 && t < 0.3 })); out.standJump1m = p.pos.y;
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
  ok('旋轉跳會加速（> 8 m/s）且不超過上限', r.strafeMax > 8 && r.strafeMax <= 11.6, `最高 ${f(r.strafeMax)} m/s，跳了 ${r.hops} 次`);
  ok('60Hz 與 144Hz 螢幕的身法結果一致', Math.abs(r.fps60 - r.fps144) < 0.25, `${f(r.fps60)} vs ${f(r.fps144)} m/s`);
  ok('原地起跳空中只能補一點速度', r.airFromStand < 0.9, f(r.airFromStand));
  ok('跳躍高度約 1.3m', r.jumpH > 1.2 && r.jumpH < 1.4, f(r.jumpH));
  ok('1.5m 箱子：普通跳上不去', Math.abs(r.normalJumpY - 1.5) < 0.01, 'y=' + f(r.normalJumpY));
  ok('1.5m 箱子：蹲跳上得去', Math.abs(r.crouchJumpY - 3.0) < 0.01 && r.crouchJumpX > 10 && r.crouchJumpX < 12, `y=${f(r.crouchJumpY)} x=${f(r.crouchJumpX)}`);
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
  ['plaza', [['出生點', null], ['中央塔二樓', [24, 5, 24]], ['角落高台上', [40.5, 5.5, 6.75]], ['出生點牆後', [5, 1.5, 9]]]],
  ['lanes', [['出生點', null], ['隧道深處', [42.5, 4.5, 17]], ['公寓二樓', [32, 8, 15.5]], ['倉庫裡', [15, 4.5, 15.5]], ['長巷貨櫃後', [2.2, 4.5, 24]], ['地下道裡', [24, 2, 24]]]],
  ['yard', [['出生點', null], ['空貨櫃裡', [14.75, 2, 12.25]], ['中央第一層上', [24, 4, 22.25]], ['角落', [40, 1.5, 8]], ['碼頭高台上', [10, 2.5, 36]]]],
  ['quarry', [['出生點（高地）', null], ['谷底西側', [5, 3.5, 24]], ['礦坑隧道十字路口', [24, 3.5, 24]], ['東邊半高平台', [41, 5, 24]], ['中央台地上', [20, 6.5, 21]], ['山裡的地道', [33.75, 3.5, 12.4]]]],
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
  await page.click('#btn-gear'); await sleep(200);
  ok('對局外可以開設定', await page.evaluate(() => !document.getElementById('pause').classList.contains('hidden') && document.getElementById('pause-title').textContent === '設定'));
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
  await page.reload({ waitUntil: 'load' }); await sleep(500);
  ok('按鍵設定重新整理後還在', (await page.evaluate(() => __game.binds.crouch)) === 'KeyX');
  await page.evaluate(() => localStorage.removeItem('rubble.binds'));
  await page.close();
}

// ═══ 6. 經濟：連敗加碼、自動配裝 ═══
{
  const page = await open({ pmap: 'plaza', bot: 'dummy' });
  await page.evaluate(() => localStorage.removeItem('rubble.wish'));
  await page.click('#btn-bot'); await page.waitForFunction(() => __game.phase === 'loadout');
  await page.evaluate(() => { __game.authority.settings.buffMode = 'off'; __game.authority.settings.target = 10; });
  const incs = [], sels = [];
  for (let r = 1; r <= 5; r++) {
    await sleep(300);
    sels.push(await page.evaluate(() => `${__game.gs.p[0].$}→${__game.sel.p || '無'}`));
    await page.click('#btn-ready'); await page.waitForFunction(() => __game.phase === 'playing', { timeout: 15000 });
    await page.evaluate(() => __game.authority.damage(0, 999, 1, 'pistol', false));   // 我輸
    await page.waitForFunction(() => __game.phase === 'roundEnd', { timeout: 5000 });
    incs.push(await page.evaluate(() => __game.gs.res.inc.join('/')));
    await page.waitForFunction(() => __game.phase === 'loadout', { timeout: 9000 });
  }
  ok('連敗加碼：3000 → 3500 → 4000 → 4500（上限），贏家固定 2000', incs.join(' ') === '3000/2000 3500/2000 4000/2000 4500/2000 4500/2000', incs.join(' '));
  ok('自動配裝：手槍局不買主武器，有錢後自動買回步槍', sels[0] === '800→無' && sels[1].endsWith('→ar'), sels.join(' | '));
  ok('關閉強化後輸家不會有強化選項', (await page.evaluate(() => __game.gs.p[0].ch)) === null);
  await page.screenshot({ path: OUT + '/f5-buy.png' });
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
    out.facing = await go(30, 4, -Math.PI / 2, 36, 4);        // 面向 +x，閃光在前方 6m
    await wait(2600);
    out.behind = await go(30, 4, Math.PI / 2, 36, 4);         // 背對
    await wait(1500);
    out.wall = await go(9, 9, -Math.PI / 2, 16, 9);           // 出生點磚牆（x 12~13m）的另一邊
    return out;
  });
  ok('閃光彈：正對全白、背對較輕、隔牆沒事', fl.facing >= 0.95 && fl.behind > 0.2 && fl.behind < fl.facing && fl.wall === 0, JSON.stringify(fl));
  // 煙霧彈：煙團出現、擋住視線判定、時間到消失
  const sm = await page.evaluate(async () => {
    const g = __game, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    g.doExplosion({ p: [30, 1.5, 4], kind: 'smoke', cloud: 3.4, dur: 2.5, pid: 7 });
    await wait(900);
    const a = { n: g.fx.clouds.length, through: g.fx.smokeBlocked(24, 2.5, 4, 36, 2.5, 4), beside: g.fx.smokeBlocked(24, 2.5, 12, 36, 2.5, 12) };
    await wait(2000);
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
    const place = () => { p.pos.set(26, 1.5, 4); p.vel.set(0, 0, 0); b.body.pos.set(40, 1.5, 4); b.body.vel.set(0, 0, 0); b.path = null; b.planAt = performance.now() + 5000; b.holdT = 5; };  // 兩邊站定、相距 14m、中間沒東西
    place(); await wait(1200); const open = shots;
    place(); g.doExplosion({ p: [33, 1.5, 4], kind: 'smoke', cloud: 3.4, dur: 4, pid: 9 }); await wait(700);
    shots = 0; place(); await wait(1200); const smoked = shots;
    g.fx.clearClouds(); place(); await wait(800); shots = 0;
    b.body.yaw = Math.PI / 2; b.onFlash(36, 2.5, 4); const blind = b.blindUntil - performance.now();
    place(); await wait(900); const flashed = shots;
    return { open, smoked, flashed, blindMs: Math.round(blind) };
  });
  ok('機器人：沒遮蔽會開槍、隔著煙不開槍、被閃到不開槍', r.open > 0 && r.smoked === 0 && r.flashed === 0 && r.blindMs > 1500, JSON.stringify(r));
  await page.close();
}
console.log('ERRORS:\n' + (errs.join('\n') || '(none)'));
await browser.close();
