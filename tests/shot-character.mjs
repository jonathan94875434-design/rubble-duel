// 第三人稱角色模型的截圖：各種姿勢、八個造型、受擊判定盒對位，最後確認遊戲本體開得起來。
// 用法：node shot-character.mjs [關鍵字 ...]   只拍檔名含關鍵字的（不給 = 全部）；加 --nogame 跳過遊戲本體那一段
// 圖存在 tests/shots/c-*.png
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || 'http://localhost:8765/').replace(/\/?$/, '/');
const args = process.argv.slice(2), only = args.filter((a) => !a.startsWith('--')), noGame = args.includes('--nogame');

// 檔名 → 預覽頁的網址參數
const SHOTS = {
  // 靜態：正面、側面、背面、斜角
  'idle-three': 'pose=idle&t=0.4&view=three',
  'idle-front': 'pose=idle&t=0.4&view=front&boxes=1',
  'idle-side': 'pose=idle&t=0.4&view=side&boxes=1',
  'idle-back': 'pose=idle&t=0.4&view=back',
  'idle-rear3': 'pose=idle&t=0.4&view=rear3&skin=desert',
  'idle-close': 'pose=idle&t=0.4&view=three&zoom=2.6&cy=1.38', 'idle-close-side': 'pose=idle&t=0.4&view=side&zoom=2.6&cy=1.38', 'idle-close-front': 'pose=idle&t=0.4&view=front&zoom=2.6&cy=1.38', 'idle-close-left': 'pose=idle&t=0.4&view=left&zoom=2.6&cy=1.38',
  'pistol-close': 'pose=idle&t=0.4&view=three&zoom=2.6&cy=1.38&w=pistol', 'pistol-close-side': 'pose=idle&t=0.4&view=side&zoom=2.6&cy=1.38&w=pistol',
  // 跑步循環的幾個相位
  'run-0': 'pose=run&t=0.00&view=side', 'run-1': 'pose=run&t=0.13&view=side', 'run-2': 'pose=run&t=0.26&view=side', 'run-3': 'pose=run&t=0.39&view=side',
  'run-three': 'pose=run&t=0.2&view=three', 'run-front': 'pose=run&t=0.33&view=front',
  'walk-side': 'pose=walk&t=0.3&view=side', 'strafe-front': 'pose=run&dir=90&t=0.2&view=front', 'back-side': 'pose=run&dir=180&t=0.2&view=side',
  // 蹲、蹲走、跳
  'crouch-three': 'pose=crouch&t=0.5&view=three', 'crouch-front': 'pose=crouch&t=0.5&view=front&boxes=1', 'crouch-side': 'pose=crouch&t=0.5&view=side&boxes=1',
  'crouchwalk-side': 'pose=crouchwalk&t=0.3&view=side&boxes=1', 'crouchwalk-three': 'pose=crouchwalk&t=0.55&view=three',
  'jump-side': 'pose=jump&t=0.4&view=side&boxes=1', 'jump-three': 'pose=jump&t=0.4&view=three',
  // 俯仰
  'pitch-up': 'pose=idle&t=0.4&pitch=0.7&view=side', 'pitch-down': 'pose=idle&t=0.4&pitch=-0.7&view=side', 'pitch-up-pistol': 'pose=idle&t=0.4&pitch=0.9&view=side&w=pistol',
  // 各種武器
  'w-pistol-three': 'pose=idle&t=0.4&w=pistol&view=three', 'w-pistol-side': 'pose=idle&t=0.4&w=pistol&view=side', 'w-pistol-run': 'pose=run&t=0.2&w=pistol&view=three',
  'w-sniper': 'pose=idle&t=0.4&w=sniper&view=three', 'w-smg': 'pose=idle&t=0.4&w=smg&view=side', 'w-lmg': 'pose=idle&t=0.4&w=lmg&view=three', 'w-shotgun': 'pose=crouch&t=0.4&w=shotgun&view=three',
  'w-rocket-three': 'pose=idle&t=0.4&w=rocket&view=three', 'w-rocket-front': 'pose=idle&t=0.4&w=rocket&view=front', 'w-gl': 'pose=idle&t=0.4&w=gl&view=side',
  'w-knife': 'pose=idle&t=0.4&w=knife&view=three',
  // 動作
  'fire': 'pose=fire&t=0.02&view=side', 'throw-1': 'pose=throw&t=0.12&view=three', 'throw-2': 'pose=throw&t=0.24&view=three', 'throw-side': 'pose=throw&t=0.2&view=left',
  'melee-1': 'pose=melee&t=0.1&w=knife&view=three', 'melee-2': 'pose=melee&t=0.2&w=knife&view=three', 'melee-gun': 'pose=melee&t=0.2&view=three',
  // 表情（動作中段）
  'emote-wave': 'pose=wave&t=1.1&view=three', 'emote-wave-front': 'pose=wave&t=1.25&view=front', 'emote-dance-1': 'pose=dance&t=1.0&view=three', 'emote-dance-2': 'pose=dance&t=1.26&view=front',
  'emote-salute': 'pose=salute&t=1.0&view=three', 'emote-salute-front': 'pose=salute&t=1.0&view=front', 'emote-taunt': 'pose=taunt&t=1.17&view=three', 'emote-taunt-front': 'pose=taunt&t=1.17&view=front',
  // 倒地：過程 + 結束
  'dead-0.2': 'pose=dead&t=0.2&view=side', 'dead-0.4': 'pose=dead&t=0.4&view=side', 'dead-end-side': 'pose=dead&t=1.5&view=side', 'dead-end-three': 'pose=dead&t=1.5&view=three', 'dead-end-top': 'pose=dead&t=1.5&view=top',
  'dead-fwd-side': 'pose=dead&t=1.5&view=side&dx=0&dz=-1', 'dead-fwd-three': 'pose=dead&t=1.5&view=three&dx=0&dz=-1', 'dead-fwd-0.35': 'pose=dead&t=0.35&view=side&dx=0&dz=-1',
  'dead-right': 'pose=dead&t=1.5&view=three&dx=1&dz=0.2', 'dead-pack': 'pose=dead&t=1.5&view=side&skin=desert', 'dead-crouch': 'pose=dead&t=1.5&view=three&crouch=1',
  // 八個造型
  'skins-front': 'grid=1&pose=idle&t=0.4&view=front', 'skins-back': 'grid=1&pose=idle&t=0.4&view=back', 'skins-run': 'grid=1&pose=run&t=0.2&view=front',
  'skins-a-front': 'grid=a&pose=idle&t=0.4&view=front', 'skins-b-front': 'grid=b&pose=idle&t=0.4&view=front', 'skins-a-back': 'grid=a&pose=idle&t=0.4&view=back', 'skins-b-back': 'grid=b&pose=idle&t=0.4&view=back',
  'skins-a-three': 'grid=a&pose=idle&t=0.4&view=three', 'skins-b-three': 'grid=b&pose=idle&t=0.4&view=three', 'skins-a-pistol': 'grid=a&pose=idle&t=0.4&view=front&w=pistol', 'skins-b-crouch': 'grid=b&pose=crouch&t=0.4&view=three',
  ...Object.fromEntries(['recruit', 'shadow', 'desert', 'arctic', 'jungle', 'gold', 'neon', 'lava'].map((s, i) => ['skin-' + s, `skin=${s}&team=${i % 2}&pose=idle&t=0.4&view=three&zoom=1.5`])),
  'skin-recruit-blue': 'skin=recruit&team=1&pose=idle&t=0.4&view=front&zoom=1.5',
};

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1280,760', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 760 }, protocolTimeout: 60000 });
const page = await browser.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').includes('favicon')) errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message + '\n' + e.stack));
const ok = (name, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);

for (const [name, q] of Object.entries(SHOTS)) {
  if (only.length && !only.some((k) => name.includes(k))) continue;
  await page.goto(`${BASE}dev/character.html?${q}`, { waitUntil: 'load' });
  try { await page.waitForFunction(() => window.__ready, { timeout: 20000 }); } catch { console.log('FAIL  ' + name + ' 沒有畫出來'); continue; }
  await sleep(80);
  await page.screenshot({ path: `${OUT}/c-${name}.png` });
  const info = await page.evaluate(() => window.__info[0]);
  console.log(`shot  c-${name}.png  top=${info.top} bottom=${info.bottom} x=${info.x} z=${info.z} headY=${info.headY} tris=${info.tris} meshes=${info.meshes} muzzle=${info.muzzle} kind=${info.kind} low=${info.low} hi=${info.hi}`);
  // 數字檢查：站著頭頂 ≈1.82、蹲著 ≈1.32；頭要落在頭部判定盒裡
  if (name === 'idle-front') { ok('站立頭頂 ≈ 1.82', Math.abs(info.top - 1.81) < 0.04, info.top); ok('腳底貼地', Math.abs(info.bottom) < 0.012, info.bottom); ok('頭在頭部判定盒內（寬 ±0.2）', info.headX[0] > -0.2 && info.headX[1] < 0.2, info.headX); ok('身體寬度在 ±0.33 內', info.x[0] > -0.35 && info.x[1] < 0.35, info.x); ok('三角形 ≤ 6000', info.tris <= 6000, info.tris); }
  if (name === 'crouch-front') { ok('蹲下頭頂 ≈ 1.32', Math.abs(info.top - 1.31) < 0.04, info.top); ok('蹲下腳底貼地', Math.abs(info.bottom) < 0.012, info.bottom); }
  if (name === 'dead-end-side' || name === 'dead-fwd-side') ok(name + ' 屍體貼地（不飄也不陷）', info.bottom > -0.03 && info.bottom < 0.03 && info.top < 0.5, `bottom=${info.bottom} top=${info.top}`);
  if (name === 'dead-0.2' || name === 'dead-0.4' || name === 'dead-fwd-0.35') ok(name + ' 倒下途中腳不穿地', info.bottom > -0.03, `bottom=${info.bottom} low=${info.low}`);
}

// ── 行為檢查（截圖看不出來的）：屍體不跟封包走、空中被打死會掉到地上、表情計時、revive 還原 ──
if (!only.length || only.includes('logic')) {
  await page.goto(`${BASE}dev/character.html?pose=idle&t=0.2`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready, { timeout: 20000 });
  const r = await page.evaluate(() => {
    const rp = window.__rp, step = (sec) => { for (let t = 0; t < sec; t += 1 / 120) rp.update(1 / 120); }, out = {};
    // 1) 死掉之後再收到位置封包，屍體不能被拉走
    rp.pos.set(0, 0, 0); rp.lastPos.copy(rp.pos); rp.die(0, 1); step(0.3);
    for (let i = 0; i < 5; i++) rp.push([5, 0, 5, 1, 0, 'ar', 2]);
    step(1.0); out.corpse = rp.pos.toArray(); out.dead = rp.dead; out.buf = rp.buf.length;
    // 2) revive 之後照常跟著封包走
    rp.revive(); out.afterRevive = { dead: rp.dead, rigX: rp.rig.rotation.x, fallY: rp.fall.position.y };
    step(0.3); out.followed = rp.pos.toArray(); rp.clearBuffer();
    // 3) 空中被打死：掉到 groundY
    rp.pos.set(0, 3, 0); rp.lastPos.copy(rp.pos); rp.die(0, 1, 0); step(0.2); out.midY = rp.pos.y; step(1.5); out.landY = rp.pos.y; rp.revive();
    // 4) 表情：emoteT 倒數到 0；不認得的代號回 false
    rp.pos.set(0, 0, 0); rp.lastPos.copy(rp.pos);
    out.bad = rp.emote('nope'); out.ok = rp.emote('salute'); out.t0 = rp.emoteT; step(1); out.t1 = rp.emoteT; step(2); out.t2 = rp.emoteT;
    // 5) 沒有模型的武器不會丟例外
    try { rp.setWeapon('no-such-gun'); out.badGun = rp.kind; } catch (e) { out.badGun = 'THROW ' + e.message; }
    rp.setWeapon('ar');
    return out;
  });
  ok('屍體不跟封包走', r.dead && Math.hypot(r.corpse[0], r.corpse[2]) < 1e-6, JSON.stringify(r.corpse));
  ok('revive 還原姿勢並恢復跟隨封包', !r.afterRevive.dead && r.afterRevive.rigX === 0 && r.afterRevive.fallY === 0 && Math.abs(r.followed[0] - 5) < 1e-6, JSON.stringify([r.afterRevive, r.followed]));
  ok('空中被打死會掉到地面', r.midY < 3 && r.midY > 0 && r.landY === 0, `mid=${r.midY.toFixed(2)} land=${r.landY}`);
  ok('表情計時 emoteT', r.bad === false && r.ok === true && Math.abs(r.t0 - 2.2) < 1e-9 && r.t1 > 1.1 && r.t1 < 1.3 && r.t2 === 0, JSON.stringify([r.bad, r.ok, r.t0, r.t1, r.t2]));
  ok('不存在的武器代號不會丟例外', !String(r.badGun).startsWith('THROW'), r.badGun);
}

// ── 遊戲本體：開練習模式，確認對手模型有畫出來、沒有錯誤 ──
if (!noGame && (!only.length || only.includes('game'))) {
  const n0 = errs.length;
  await page.evaluateOnNewDocument(() => { localStorage.setItem('rubble.pmap', '"plaza"'); localStorage.setItem('rubble.bot', '"easy"'); });
  await page.goto(BASE + '?nolock=1', { waitUntil: 'load' });
  await sleep(800);
  try {
    await page.click('#btn-bot'); await sleep(6000);
    // 還在選槍畫面的話按準備，等開打
    if (await page.evaluate(() => window.__game && __game.phase === 'loadout')) { await page.evaluate(() => { __game.bot.fire = () => {}; }); await page.click('#btn-ready'); await page.waitForFunction(() => __game.phase === 'playing', { timeout: 15000 }); await sleep(600); }
    const st = await page.evaluate(() => {
      const g = window.__game, r = g && g.remote; if (!r) return null;
      let meshes = 0; r.group.traverse((o) => { if (o.isMesh) meshes++; });
      return { phase: g.phase, visible: r.group.visible, alive: r.alive, meshes, pos: r.pos.toArray().map((v) => +v.toFixed(2)), skin: r.skin, weapon: r.weapon, kind: r.kind, missing: ['die', 'revive', 'fireKick', 'throwAnim', 'emote', 'meleeAnim', 'muzzle', 'rayHit', 'hitFlash', 'applySkin', 'setColor', 'setWeapon', 'push', 'clearBuffer', 'update'].filter((k) => typeof r[k] !== 'function') };
    });
    ok('遊戲本體：對手模型存在、API 齊全', !!st && st.meshes > 10 && !st.missing.length, JSON.stringify(st));
    // 把機器人定住，對手擺在空地上，自己站到他面前看（遊戲裡的光影 + 後製）
    const place = (skin, w, yawOff = 0) => page.evaluate((skin, w, yawOff) => {
      const g = __game, r = g.remote, p = g.player;
      g.bot.update = () => {}; g.bot.fire = () => {};
      r.revive(); r.clearBuffer(); r.pos.set(26, 1.5, 6.4); r.lastPos.copy(r.pos); r.yaw = Math.PI + yawOff; r.pitch = 0;
      r.applySkin(skin, 0x3cc8ff); r.setWeapon(w, 'stock'); r.alive = true; r.group.visible = true;
      p.pos.set(26.5, 1.5, 9.1); p.vel.set(0, 0, 0); p.yaw = Math.atan2(0.5, 2.7); p.pitch = -0.1;
    }, skin, w, yawOff);
    await place('recruit', 'ar', 0.5); await sleep(700);
    await page.screenshot({ path: `${OUT}/c-game-idle.png` });
    const mz = await page.evaluate(() => { const g = __game, v = g.remote.muzzle(g.camera.position.clone()); return [v.x - g.remote.pos.x, v.y - g.remote.pos.y, v.z - g.remote.pos.z].map((x) => +x.toFixed(2)); });
    ok('遊戲本體：槍口在槍上（往前約 1 公尺、肩膀高度）', Math.hypot(mz[0], mz[2]) > 0.5 && Math.hypot(mz[0], mz[2]) < 1.3 && mz[1] > 1.2 && mz[1] < 1.7, JSON.stringify(mz));
    const hit = await page.evaluate(() => { const g = __game, r = g.remote; const h = r.rayHit(r.pos.x, r.pos.y + 1.6, r.pos.z + 3, 0, 0, -1), b = r.rayHit(r.pos.x, r.pos.y + 1.0, r.pos.z + 3, 0, 0, -1); return { head: h && h.head, body: b && !b.head }; });
    ok('遊戲本體：rayHit 頭 / 身體', hit.head === true && hit.body === true, JSON.stringify(hit));
    await page.evaluate(() => { __game.remote.emote('wave'); }); await sleep(1100);
    await page.screenshot({ path: `${OUT}/c-game-wave.png` });
    await place('desert', 'pistol', -0.4); await sleep(600);
    await page.screenshot({ path: `${OUT}/c-game-desert.png` });
    await page.evaluate(() => { const r = __game.remote; r.die(Math.sin(r.yaw), Math.cos(r.yaw)); }); await sleep(1300);
    await page.evaluate(() => { __game.player.pitch = -0.45; __game.remote.group.visible = true; }); await sleep(250);
    await page.screenshot({ path: `${OUT}/c-game-dead.png` });
    const dead = await page.evaluate(() => { const r = __game.remote, d = r.dead; r.revive(); return { dead: d, after: r.dead, emoteT: r.emoteT }; });
    ok('遊戲本體：die / revive', dead.dead === true && dead.after === false, JSON.stringify(dead));
  } catch (e) { console.log('FAIL  遊戲本體流程：' + e.message); }
  ok('遊戲本體：沒有 console / page 錯誤', errs.length === n0);
}
console.log('ERRORS:\n' + (errs.join('\n') || '(none)'));
await browser.close();
