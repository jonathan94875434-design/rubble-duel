// 新功能測試（單人）：穿牆、刀、燃燒瓶、傷害報告、擊殺回放、戰績、噴漆、表情、小地圖、準星、地圖編輯器
import puppeteer from 'puppeteer-core';
import { load } from './load.mjs';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] || 'shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || 'http://localhost:8765/').replace(/\/?$/, '/');
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1280,760', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio'], defaultViewport: { width: 1280, height: 760 }, protocolTimeout: 90000 });
const errs = [];
let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').includes('favicon') && !m.text().includes('ERR_SOCKET') && !m.text().includes('ERR_CONNECTION')) errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message + '\n' + e.stack));
await page.evaluateOnNewDocument(() => { for (const [k, v] of Object.entries({ pmap: 'plaza', bot: 'dummy' })) localStorage.setItem('rubble.' + k, JSON.stringify(v)); localStorage.removeItem('rubble.stats'); localStorage.removeItem('rubble.maps'); });
await load(page, BASE + '?nolock=1');
const playing = () => page.waitForFunction(() => __game.phase === 'playing', { timeout: 20000 });
const start = async () => { await page.waitForFunction(() => __game.phase === 'loadout', { timeout: 15000 }); await sleep(300); await page.evaluate(() => { const c = __game.gs.p[0].ch; if (c) __game.pickBuff(c[0]); }); await sleep(200); await page.click('#btn-ready'); await playing(); await sleep(400); };

// 測試場：清出一條 x 方向的走道，我站在 9.25m、對手（木樁）站在 15.25m，中間可以放一道牆
await page.evaluate(() => {
  const G = __game, w = G.world;
  window.T = {
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    lane() { w.box(16, 3, 74, 44, 12, 86, 0); w.rev++; for (let i = 0; i < w.chunks.length; i++) w.dirty.add(i); },
    wall(t, n = 1) { w.box(24, 3, 74, 24 + n - 1, 10, 86, t); w.rev++; for (let i = 0; i < w.chunks.length; i++) w.dirty.add(i); },
    nowall() { w.box(24, 3, 74, 26, 10, 86, 0); w.rev++; for (let i = 0; i < w.chunks.length; i++) w.dirty.add(i); },
    async place(bx = 15.25, yaw = Math.PI / 2) {
      const p = G.player; p.pos.set(9.25, 1.5, 40.25); p.vel.set(0, 0, 0); p.yaw = -Math.PI / 2; p.pitch = 0;
      const b = G.bot.body; b.pos.set(bx, 1.5, 40.25); b.vel.set(0, 0, 0); b.yaw = yaw;
      G.authority.players[1].hp = 100; G.authority.players[1].armor = 0; G.authority.players[0].hp = 100; G.authority.dirty = true;
      await T.sleep(450);
    },
    // 用某把槍朝對手身體開一槍，回傳對手掉了多少血
    async shoot(wid) {
      G.combat.setLoadout({ p: wid, s: 'pistol' }, []);
      await T.place();
      G.player.pitch = -0.103; await T.sleep(200);
      const hp0 = G.gs.p[1].hp;
      G.combat.bloom = 0; G.combat.recP = G.combat.recY = 0; G.combat.ads = 1;
      G.combat.fire(G.combat.w, performance.now());
      await T.sleep(350);
      return hp0 - G.gs.p[1].hp;
    },
  };
});

// ═══ 第 1 局：穿牆、刀、傷害報告 ═══
await page.click('#btn-bot'); await start();
{
  const r = await page.evaluate(async () => {
    const G = __game, w = G.world, o = {};
    T.lane();
    o.open = await T.shoot('ar');
    T.wall(5); o.wood = await T.shoot('ar'); o.woodHp = Math.round(w.hp[w.idx(24, 5, 80)]) + '/' + w.types[w.idx(24, 5, 80)];
    T.wall(5, 2); o.wood2 = await T.shoot('ar');
    T.nowall(); T.wall(3); o.concAr = await T.shoot('ar'); o.concSn = await T.shoot('sniper');
    T.nowall(); T.wall(6); o.steelSn = await T.shoot('sniper'); T.wall(6, 2); o.steel2Sn = await T.shoot('sniper');
    T.nowall(); T.wall(7); o.wallSn = await T.shoot('sniper');
    T.nowall();
    return o;
  });
  ok('沒有牆：步槍一發 22', r.open === 22, JSON.stringify(r));
  ok('穿一格木板：傷害打折（17）而且木板有被打傷', r.wood === 17 && r.woodHp.endsWith('/5') && parseInt(r.woodHp) < 55, `${r.wood} ${r.woodHp}`);
  ok('穿兩格木板：傷害更低', r.wood2 > 0 && r.wood2 < r.wood, String(r.wood2));
  ok('水泥：步槍打不穿、狙擊槍打得穿（56）', r.concAr === 0 && r.concSn === 56, `${r.concAr} ${r.concSn}`);
  ok('鋼板：狙擊槍只穿得過一格', r.steelSn > 0 && r.steelSn < r.concSn && r.steel2Sn === 0, `${r.steelSn} ${r.steel2Sn}`);
  ok('地圖外圍的牆什麼都打不穿', r.wallSn === 0, String(r.wallSn));
}
{
  const r = await page.evaluate(async () => {
    const G = __game, o = {};
    G.combat.setLoadout({ p: 'ar', s: 'pistol' }, []);
    o.slots = G.combat.slots.map((s) => s && s.id).join(',');
    G.combat.switchTo(2); o.cur = G.combat.w.id; o.move = G.combat.w.def.move;
    await T.place(10.55, -Math.PI / 2 + Math.PI);          // 對手面向我
    G.combat.switchEnd = 0;
    let hp0 = G.gs.p[1].hp; G.combat.melee(G.combat.w, performance.now(), false); await T.sleep(350); o.slash = hp0 - G.gs.p[1].hp;
    await T.place(13.5, Math.PI / 2); hp0 = G.gs.p[1].hp; G.combat.melee(G.combat.w, performance.now(), true); await T.sleep(300); o.far = hp0 - G.gs.p[1].hp;   // 太遠砍不到
    G.combat.switchLast(); o.last = G.combat.w.id; G.combat.switchTo(2);
    await T.place(10.55, -Math.PI / 2);                    // 對手背對我 → 重刺必殺
    G.combat.switchEnd = 0; G.combat.w.nextFire = 0;
    G.combat.melee(G.combat.w, performance.now(), true); await T.sleep(500);
    o.phase = G.phase; o.res = G.gs.res; o.report = !document.getElementById('report').classList.contains('hidden') && document.getElementById('report').textContent;
    o.feed = document.getElementById('feed').textContent; o.banner = document.querySelector('#banner .sub').textContent;
    o.dead = !!G.remote.dead; o.vis = G.remote.group.visible;
    return o;
  });
  ok('武器欄有三格：主槍、副槍、刀；拿刀跑比較快', r.slots === 'ar,pistol,knife' && r.cur === 'knife' && r.move > 1.1, `${r.slots} ${r.move}`);
  ok('刀：快砍 45、太遠砍不到、Q 切回上一把', r.slash === 45 && r.far === 0 && r.last === 'ar', `${r.slash} ${r.far} ${r.last}`);
  ok('刀：背刺重擊一刀帶走，結果記成刀＋背刺', r.phase === 'roundEnd' && r.res && r.res.w === 'knife' && r.res.bk === true && r.res.winner === 0, JSON.stringify(r.res));
  ok('回合結束有傷害報告和擊倒訊息', !!r.report && r.report.includes('傷害報告') && r.report.includes('發命中') && r.banner.includes('背刺'), `${r.report} | ${r.banner}`);
  ok('對手倒下後屍體留在場上', r.dead && r.vis);
  await page.screenshot({ path: OUT + '/x1-knife-report.png' });
}

// ═══ 第 2 局：燃燒瓶、小地圖、擊殺回放 ═══
await start();
{
  const r = await page.evaluate(async () => {
    const G = __game, w = G.world, o = {};
    T.lane(); await T.place();
    o.alive = G.remote.alive && !G.remote.dead;
    await T.sleep(400);
    o.spotted = performance.now() - G.mini.seen.t < 1500;      // 面對面、沒有遮蔽 → 小地圖上看得到
    const d = G.mini.ctx.getImageData(94, 94, 1, 1).data; o.miniPx = d[3];
    // 真的丟一個燃燒瓶：碰到東西就破、地上起火
    G.combat.nades.molotov = 1; G.player.pitch = -0.5;
    await T.sleep(100);
    o.threw = G.combat.throwNade('molotov');
    for (let i = 0; i < 40 && !G.combat.fires.length; i++) await T.sleep(50);
    o.fires = G.combat.fires.length + '/' + G.fx.fires.length; o.mine = G.combat.fires[0] && G.combat.fires[0].mine;
    G.combat.fires.length = 0; G.fx.fires.length = 0;
    // 在對手腳邊放一把火（位置固定，比較好驗證），火場裡放一塊木頭
    w.box(31, 3, 82, 31, 3, 82, 5); w.rev++;
    G.doExplosion({ r: G.round, pid: 9001, p: [15.25, 1.6, 40.25], kind: 'molotov', cloud: 2.6, dur: 7, own: 0 });
    const hp0 = G.gs.p[1].hp;
    await T.sleep(1600);
    o.burn = hp0 - G.gs.p[1].hp;
    G.bot.body.pos.set(19.75, 1.5, 44.25); G.authority.players[1].hp = 100;   // 量完就把對手移出火場，免得等木頭燒掉的時候他先被燒死
    for (let i = 0; i < 60 && w.types[w.idx(31, 3, 82)]; i++) await T.sleep(100);
    o.wood = w.types[w.idx(31, 3, 82)];
    const me0 = G.gs.p[0].hp; G.player.pos.set(14.6, 1.5, 40.25); await T.sleep(700); o.self = me0 - G.gs.p[0].hp; G.player.pos.set(9.25, 1.5, 40.25);   // 自己走進去也會燒
    const f = G.combat.fires[0];
    if (f) { G.doExplosion({ r: G.round, pid: 9100, p: [f.x, f.y, f.z], kind: 'smoke', cloud: 3.4, dur: 12 }); }
    await T.sleep(150);
    o.quenched = G.combat.fires.length + '/' + G.fx.fires.length;
    await T.sleep(600);
    G.doExplosion({ r: G.round, pid: 9101, p: [15.25, 1.6, 40.25], kind: 'molotov', cloud: 2.6, dur: 7, own: 0 });   // 丟進煙裡：燒不起來
    await T.sleep(100); o.inSmoke = G.combat.fires.length;
    G.fx.clearClouds();
    return o;
  });
  ok('小地圖有畫面，面對面時對手會出現', r.miniPx === 255 && r.spotted && r.alive, JSON.stringify(r));
  ok('燃燒瓶：落地起火、火是我的', r.threw && r.fires === '1/1' && r.mine === true, r.fires);
  ok('站在火裡會一直扣血（對手和自己都會）', r.burn >= 28 && r.burn <= 80 && r.self >= 9, `${r.burn} ${r.self}`);
  ok('火會把木頭燒掉', r.wood === 0, String(r.wood));
  ok('煙霧彈可以滅火，丟進煙裡的燃燒瓶燒不起來', r.quenched === '0/0' && r.inSmoke === 0, `${r.quenched} ${r.inSmoke}`);
}
{
  await page.evaluate(async () => { await T.place(); await T.sleep(1500); __game.authority.damage(0, 999, 1, 'ar', true); });
  await sleep(1700);
  const a = await page.evaluate(() => ({ kc: __game.kc, el: !document.getElementById('killcam').classList.contains('hidden'), ghost: __game.ghost.group.visible, name: document.getElementById('kc-name').textContent, cam: __game.camera.position.distanceTo(__game.player.pos) }));   // 鏡頭離開自己、跑到對手那邊
  await page.screenshot({ path: OUT + '/x2-killcam.png' });
  ok('被擊倒後會播擊殺回放（鏡頭在對手位置、看得到自己的分身）', a.kc && a.el && a.ghost && a.cam > 3, JSON.stringify(a));
  await page.waitForFunction(() => !__game.kc, { timeout: 8000 });
  const b = await page.evaluate(() => ({ el: document.getElementById('killcam').classList.contains('hidden'), ghost: __game.ghost.group.visible, phase: __game.phase }));
  ok('回放播完自動結束', b.el && !b.ghost, JSON.stringify(b));
}

// ═══ 第 3 局：噴漆、表情、準星、戰績 ═══
await start();
{
  const r = await page.evaluate(async () => {
    const G = __game, o = {};
    T.lane(); T.wall(3); await T.place();
    G.player.pos.set(11.2, 1.5, 40.25); await T.sleep(250);
    G.doSpray(); await T.sleep(100);
    o.spray = G.fx.sprays.length; o.sprayCell = G.fx.sprays[0] && G.fx.sprays[0].cell >= 0;
    G.doSpray(); o.cooldown = G.fx.sprays.length;                 // 冷卻中，不會再噴
    G.world.box(24, 3, 74, 24, 10, 86, 0); G.world.rev++; await T.sleep(150);
    o.sprayGone = G.fx.sprays.length;                             // 牆被拆掉，噴漆跟著消失
    G.doEmote(); await T.sleep(300);
    o.emote = !!G.emote; o.ghost = G.ghost.group.visible; o.third = G.camera.position.distanceTo(G.player.pos) > 2.2;
    o.cross = document.getElementById('crosshair').classList.contains('off');
    G.keys[G.binds.fwd] = true; await T.sleep(200); G.keys[G.binds.fwd] = false;
    o.cancel = !G.emote && !G.ghost.group.visible;
    G.setSetting('xh', { ...G.settings.xh, color: '#ff0000', style: 'circle', len: 14 });
    const ch = document.getElementById('crosshair');
    o.xh = ch.dataset.style + ch.style.getPropertyValue('--xc') + ch.style.getPropertyValue('--xl');
    G.setSetting('xh', { ...G.DEFAULT_XHAIR });
    const s = G.stats.d.practice;
    o.stats = `${s.rounds}/${s.rwins}/${s.kills}/${s.deaths}/${s.knife}/${s.shots > 0}/${s.hits > 0}`;
    return o;
  });
  ok('噴漆：噴得上去、有冷卻、牆被拆掉就消失', r.spray === 1 && r.sprayCell && r.cooldown === 1 && r.sprayGone === 0, JSON.stringify(r));
  ok('表情動作：切到第三人稱看自己，一移動就取消', r.emote && r.ghost && r.third && r.cross && r.cancel, JSON.stringify(r));
  ok('準星設定會套用', r.xh === 'circle#ff000014px', r.xh);
  ok('戰績有記到前兩局（2 局、1 勝、1 擊倒、1 陣亡、1 刀殺）', r.stats === '2/1/1/1/1/true/true', r.stats);
  await page.evaluate(() => __game.leave());
  await page.click('#btn-stats'); await sleep(300);
  const tiles = await page.$eval('#st-tiles', (e) => e.textContent);
  await page.click('.stats .tab[data-mode="practice"]'); await sleep(200);
  const tiles2 = await page.$eval('#st-tiles', (e) => e.textContent);
  await page.screenshot({ path: OUT + '/x3-stats.png' });
  ok('戰績頁：練習的紀錄不會算進連線對戰', tiles.includes('比賽0') && tiles2.includes('刀殺1'), tiles2.slice(0, 60));
  await page.click('#btn-stats-back');
}

// ═══ 地圖編輯器 ═══
{
  await page.click('#btn-editor'); await sleep(600);
  const r = await page.evaluate(async () => {
    const G = __game, ed = G.editor, w = G.world, o = {};
    const count = (t) => { let n = 0; for (let i = 0; i < w.types.length; i++) if (w.types[i] === t) n++; return n; };
    o.phase = G.phase; o.screen = !document.getElementById('scr-editor').classList.contains('hidden');
    ed.pos.set(16, 6, 14); ed.yaw = 0; ed.pitch = -1.2; await T.sleep(250);
    o.tgt = !!ed.tgt;
    ed.type = 4; ed.sym = 'rot'; ed.brush = 1; ed.paint(true); o.placed = count(4);       // 旋轉對稱：一次放兩塊
    ed.undoLast(); o.undone = count(4);
    ed.boxTool(false); ed.pos.x += 2; ed.pos.z += 1; await T.sleep(250); ed.boxTool(false); o.box = count(4);
    ed.sym = 'none'; ed.type = 5; ed.brush = 2; ed.paint(true); o.brush = count(5);       // 2×2×2 的筆刷 = 8 塊
    ed.paint(false); o.removed = count(5) < 8;
    ed.addPickup('hp', 40); o.pick = ed.pickups.length;
    o.problem = ed.problem();
    ed.name = '測試圖'; ed.env = 'night';
    const sv = await G.editorSave(false); o.id = sv && sv.id; o.len = sv && sv.code.length;
    const M = await import('./js/maps.js');
    o.registered = !!(M.MAPS[o.id] && M.MAPS[o.id].custom && M.MAPS[o.id].name === '測試圖');
    const d = await M.decodeMap(sv.code);
    let same = d.types.length === w.types.length; for (let i = 0; same && i < w.types.length; i++) if (d.types[i] !== w.types[i]) same = false;
    o.round = same && d.env === 'night' && d.spawns.length === 2 && d.pickups.length === o.pick;
    o.opt = [...document.getElementById('sel-pmap').options].some((x) => x.value === o.id);
    o.stored = JSON.parse(localStorage.getItem('rubble.maps')).length;
    let bad = ''; try { await M.decodeMap('RBL1.xxxx'); } catch (e) { bad = 'err'; }
    o.bad = bad;
    return o;
  });
  await page.screenshot({ path: OUT + '/x4-editor.png' });
  ok('編輯器：進得去、瞄得到方塊', r.phase === 'editor' && r.screen && r.tgt, JSON.stringify(r));
  ok('放方塊（對稱一次兩塊）、復原、拉框填滿', r.placed === 2 && r.undone === 0 && r.box >= 8, `${r.placed} ${r.undone} ${r.box}`);
  ok('筆刷大小、拆除、放補給品', r.brush === 8 && r.removed && r.pick === 1, `${r.brush} ${r.pick}`);
  ok('存檔：登記成可選的地圖、代碼解回來一模一樣', r.problem === '' && r.registered && r.round && r.opt && r.stored === 1 && r.bad === 'err', `代碼 ${r.len} 字`);
  // 儲存並試玩
  await page.evaluate(() => __game.editorSave(true));
  await start();
  const p = await page.evaluate(async () => {
    const G = __game, o = { map: G.gs.map, world: G.world.mapId, env: G.env.id, picks: G.pickDefs.length, y: +G.player.pos.y.toFixed(2) };
    await T.sleep(500); o.onGround = G.player.onGround; o.remote = G.remote.group.visible;
    return o;
  });
  await page.screenshot({ path: OUT + '/x5-custom-play.png' });
  ok('自製地圖可以直接開打（天氣、補給品、出生點都對）', p.map.startsWith('c_') && p.world === p.map && p.env === 'night' && p.picks === 1 && p.onGround && p.remote, JSON.stringify(p));
}

console.log('ERRORS:\n' + (errs.length ? [...new Set(errs)].slice(0, 12).join('\n') : '(none)'));
await browser.close();
process.exit(fails || errs.length ? 1 : 0);
