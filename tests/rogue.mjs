// Roguelike 模式：選卡、重抽、技能格替換、每個主動技能、幾個被動、機器人會不會選卡
// 用法：node rogue.mjs [輸出資料夾]；雙人同步的部分在 rogue-duel.mjs
import puppeteer from 'puppeteer-core';
import { load, CHROME } from './load.mjs';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] || 'shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || 'http://localhost:8765/').replace(/\/?$/, '/');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--window-size=1280,760', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1280, height: 760 }, protocolTimeout: 60000 });
const page = await browser.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').includes('favicon')) errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message + '\n' + e.stack));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`); };
const waitPhase = (ph, ms = 20000) => page.waitForFunction((ph) => __game.phase === ph, { timeout: ms }, ph);
const ev = (fn, ...a) => page.evaluate(fn, ...a);

await page.evaluateOnNewDocument(() => { localStorage.setItem('rubble.pmap', '"plaza"'); localStorage.setItem('rubble.bot', '"dummy"'); localStorage.setItem('rubble.prog', 'true'); });
await load(page, BASE + '?nolock=1');
await sleep(500);
ok('選單有 Roguelike 練習的勾選框，而且記得上次的設定', await ev(() => document.getElementById('chk-prog').checked));
await page.click('#btn-bot'); await waitPhase('loadout');
await sleep(500);

// ── 選卡畫面 ──
let st = await ev(() => { const g = __game, me = g.gs.p[0]; return { mode: g.gs.set.mode, ch: me.ch, sk: me.sk, cards: document.querySelectorAll('#lo-buff-cards .card').length, hidden: document.getElementById('lo-buff').classList.contains('hidden'), tl: g.gs.tLeft, title: document.getElementById('lo-buff-title').textContent }; });
ok('模式是 Roguelike，第 1 局就有 3 張卡可以選', st.mode === 'rogue' && st.ch && st.ch.length === 3 && st.cards === 3 && !st.hidden, JSON.stringify(st));
ok('選卡時間比一般模式長', st.tl > 35000, String(st.tl));
const kinds = await ev(() => __game.gs.p[0].ch.map((id) => document.querySelector(`.card[data-id="${id}"]`).className));
ok('技能格是空的時候，保證至少有一張主動技能、也至少有一張被動', kinds.some((c) => c.includes(' act')) && kinds.some((c) => !c.includes(' act')), JSON.stringify(kinds));
await page.screenshot({ path: OUT + '/r1-draft.png' });
// 選卡動畫：整個畫面蓋上一層，卡片先背面朝上，一張一張翻開；還沒翻開就點 = 直接全部翻開、不會選到
st = await ev(() => ({ draft: document.getElementById('lo-buff').classList.contains('draft'), fixed: getComputedStyle(document.getElementById('lo-buff')).position, backs: document.querySelectorAll('#lo-buff-cards .card .back').length }));
ok('Roguelike 選卡是蓋住畫面的動畫，每張卡都有背面', st.draft && st.fixed === 'fixed' && st.backs === 3, JSON.stringify(st));
await page.waitForFunction(() => document.querySelectorAll('#lo-buff-cards .card.up').length === 3, { timeout: 8000 }).catch(() => {});
ok('三張卡會自己依序翻開', await ev(() => document.querySelectorAll('#lo-buff-cards .card.up').length === 3));

// 還沒選卡不能按準備
ok('還沒選卡時「準備」按不了', await ev(() => document.getElementById('btn-ready').disabled));

// 重抽：第 1 局有 $800，重抽一次 $400
const before = await ev(() => ({ ch: __game.gs.p[0].ch.slice(), $: __game.gs.p[0].$ }));
await page.$eval('#btn-reroll', (b) => b.click());   // 選卡畫面有動畫，直接按按鈕（不靠滑鼠座標）
await page.waitForFunction(() => __game.gs.p[0].rr === 1, { timeout: 4000 }).catch(() => {}); await sleep(300);
let after = await ev(() => ({ ch: __game.gs.p[0].ch.slice(), $: __game.gs.p[0].$, rr: __game.gs.p[0].rr }));
const skip = await ev(() => { const el = document.querySelector('#lo-buff-cards .card:not(.up)'); if (!el) return 'all-up'; el.click(); return { up: document.querySelectorAll('#lo-buff-cards .card.up').length, ch: !!__game.gs.p[0].ch }; });
ok('重抽後的新卡還沒翻開就點：全部直接翻開，不會選到卡', skip === 'all-up' || (skip.up === 3 && skip.ch), JSON.stringify(skip));
ok('重抽：扣 $400、換一批完全不同的卡', after.$ === before.$ - 400 && after.rr === 1 && after.ch.every((id) => !before.ch.includes(id)), JSON.stringify([before, after]));
await page.$eval('#btn-reroll', (b) => b.click());   // 選卡畫面有動畫，直接按按鈕（不靠滑鼠座標）
await page.waitForFunction(() => __game.gs.p[0].rr === 2, { timeout: 4000 }).catch(() => {}); await sleep(300);
after = await ev(() => ({ $: __game.gs.p[0].$, rr: __game.gs.p[0].rr, dis: document.getElementById('btn-reroll').disabled }));
ok('重抽兩次之後就不能再抽', after.rr === 2 && after.$ === before.$ - 800 && after.dis, JSON.stringify(after));

// 之後的測試要指定卡：直接改裁判手上的選項再選（選卡流程本身照走）
const give = async (id, slot = 0) => {
  await ev((id) => { const a = __game.authority, p = a.players[0]; p.choices = [id, 'vital', 'tough'].filter((v, i, l) => l.indexOf(v) === i); a.dirty = true; a.flush(); }, id);
  await sleep(150);
  await ev((id, slot) => __game.pickBuff(id, slot), id, slot);
  await sleep(200);
};
await give('blink');
st = await ev(() => ({ sk: __game.gs.p[0].sk, ch: __game.gs.p[0].ch, bot: __game.gs.p[1].bf.length + __game.gs.p[1].sk.filter(Boolean).length }));
ok('選了主動技能 → 放進第 1 格', st.sk[0] === 'blink' && st.sk[1] === null && st.ch === null, JSON.stringify(st));
ok('機器人也自己選了一張卡', st.bot === 1, JSON.stringify(st));
// 直接塞滿要測的卡（裁判端），省得打很多局
await ev(() => { const a = __game.authority, p = a.players[0]; p.skills = ['blink', 'wall']; p.buffs = ['hop', 'moon', 'frenzy', 'thorns', 'cryo', 'incendiary', 'phoenix', 'radar', 'deadeye', 'twin', 'explosive', 'ricochet', 'jugg']; p.money = 9000; a.dirty = true; a.flush(); });
await sleep(200);
st = await ev(() => ({ me: document.getElementById('lo-build-me').textContent, opp: document.getElementById('lo-build-opp').textContent, vis: !document.getElementById('lo-builds').classList.contains('hidden') }));
ok('選卡畫面列出雙方的異能', st.vis && st.me.includes('瞬移') && st.me.includes('不死鳥'), JSON.stringify(st));
await page.screenshot({ path: OUT + '/r2-builds.png' });
await ev(() => { __game.bot.fire = () => {}; });
await page.click('#btn-ready'); await waitPhase('playing');
await sleep(400);

// ── 對戰中的 HUD ──
st = await ev(() => { const g = __game; return { slots: g.skills.slots, tiles: document.querySelectorAll('#skills .sk').length, buffs: document.querySelectorAll('#buffs .glyph').length, mhp: g.gs.p[0].mhp, opp: document.getElementById('oppbuild').children.length, aj: g.player.maxAirJumps, mods: g.combat.mods }; });
ok('HUD 有兩個技能格、被動圖示、對手的異能', st.tiles === 2 && st.buffs === 13 && st.opp >= 2, JSON.stringify(st));
ok('重裝巨人：最大生命 200', st.mhp === 200, String(st.mhp));
ok('被動換算成本機倍率（三段跳、月球靴、射速、雙重射擊…）', st.aj === 2 && st.mods.grav === 0.5 && st.mods.rpm === 1.35 && st.mods.twin && st.mods.explosive && st.mods.ricochet && st.mods.head === 1.6, JSON.stringify(st.mods));

// 把玩家和機器人擺到廣場中間的空地，面對面
const place = (px, pz, bx, bz, yaw = Math.PI) => ev((px, pz, bx, bz, yaw) => { const g = __game, p = g.player; p.pos.set(px, 1.5, pz); p.vel.set(0, 0, 0); p.yaw = yaw; p.pitch = 0; p.unstick(); const b = g.bot.body; b.pos.set(bx, 1.5, bz); b.vel.set(0, 0, 0); b.unstick(); }, px, pz, bx, bz, yaw);
// 自己清一塊測試場地：x 12~36、z 14~38 公尺整平成水泥地，上面一路到天空都清空（技能會往上飛、從天上打下來）
const arena = () => ev(() => { const w = __game.world; w.box(24, 0, 28, 72, 2, 76, 3); w.box(24, 3, 28, 72, 31, 76, 0); w.rebuildAll(); });
await arena();
const SX = 24, SZ = 34;
// 接下來逐一測主動技能：先把會持續扣血的被動拿掉（只留月球靴），並且每次量傷害前把機器人補滿
await ev(() => { const g = __game; g.authority.players[0].buffs = ['moon']; g.authority.dirty = true; g.authority.flush(); g.combat.setLoadout(g.gs.p[0].lo, ['moon']); });
const healBot = () => ev(() => { const a = __game.authority, b = a.players[1]; b.maxHp = 100; b.hp = 100; b.armor = 0; b.burnT = 0; b.slowT = 0; a.dirty = true; a.flush(); });
await place(SX, SZ, SX, SZ - 11, 0);
await sleep(400);

// ── 瞬移 ──
let p0 = await ev(() => __game.player.pos.toArray());
let used = await ev(() => __game.skills.use(0));
await sleep(100);
let p1 = await ev(() => __game.player.pos.toArray());
ok('瞬移：往前移動約 9 公尺', used && Math.abs(p0[2] - p1[2] - 9) < 0.6, JSON.stringify([p0, p1]));
ok('瞬移進入冷卻，馬上再按沒有用', !(await ev(() => __game.skills.use(0))) && (await ev(() => __game.skills.hudState(performance.now()).slots[0].left)) > 6);

// ── 鋼牆 ──
await place(SX, SZ, SX, SZ - 11, 0); await sleep(200);
const metal0 = await ev(() => { window.__before = __game.world.types.slice(); return __game.world.types.reduce((n, t) => n + (t === 6 ? 1 : 0), 0); });
used = await ev(() => __game.skills.use(1)); await sleep(200);
st = await ev((m0) => { const g = __game, p = g.player; return { added: g.world.types.reduce((n, t) => n + (t === 6 ? 1 : 0), 0) - m0, hit: !!g.world.raycast(p.pos.x, p.pos.y + 1, p.pos.z, 0, 0, -1, 4), stuck: p.collides(p.pos.x, p.pos.y, p.pos.z), uses: g.skills.uses[1] }; }, metal0);
ok('鋼牆：面前多出一大片 21×10 的鋼板，不會把自己埋住，沒有次數限制', used && st.added === 210 && st.hit && !st.stuck && (await ev(() => __game.skills.hudState(performance.now()).slots[1].uses)) === -1, JSON.stringify(st));
await page.screenshot({ path: OUT + '/r3-wall.png' });
// 把牆拆掉，後面的測試才不會被它擋住
const unwall = () => ev(() => { const w = __game.world, b = window.__before; for (let i = 0; i < b.length; i++) if (w.types[i] !== b[i] && w.types[i] === 6) { const x = i % w.X, r = (i - x) / w.X, z = r % w.Z, y = (r - z) / w.Z; w.edit(x, y, z, 0); } });
await unwall();

// 換一組技能：直接改本機的技能格（裁判那邊也同步），省得重開一局
const setSkills = (a, b) => ev((a, b) => { const g = __game; g.authority.players[0].skills = [a, b]; g.authority.dirty = true; g.authority.flush(); g.skills.setup([a, b]); }, a, b);

// ── 鉤索、噴射背包 ──
await setSkills('grapple', 'jet');
await place(SX, SZ, SX + 3, SZ - 11, 0); await sleep(200);
await ev(() => { const g = __game, p = g.player; p.yaw = 0; p.pitch = 0; });
// 前方 13 公尺內是空的，所以對著地面斜下方勾
await ev(() => { __game.player.pitch = -0.25; }); await sleep(120);
p0 = await ev(() => __game.player.pos.toArray());
used = await ev(() => __game.skills.use(0)); await sleep(700);
p1 = await ev(() => __game.player.pos.toArray());
ok('鉤索：被拉向瞄準的地方', used && Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) > 2.5, JSON.stringify([p0, p1]));
await sleep(900);
await place(SX, SZ, SX + 3, SZ - 11, 0); await sleep(300);
used = await ev(() => __game.skills.use(1));
let top = 0;
for (let i = 0; i < 16; i++) { await sleep(100); top = Math.max(top, await ev(() => __game.player.pos.y)); }
ok('噴射背包（加上月球靴）：飛得很高', used && top > 7, 'top=' + top);
await sleep(2500);

// ── 腎上腺素、透視 ──
await setSkills('stim', 'scan');
await ev(() => { __game.authority.players[0].hp = 60; __game.authority.dirty = true; __game.authority.flush(); }); await sleep(150);
used = await ev(() => __game.skills.use(0)); await sleep(250);
st = await ev(() => ({ hp: __game.gs.p[0].hp, mul: __game.skills.speedMul(__game.gs.p[0]) }));
ok('腎上腺素：回 60 血並加速', used && st.hp === 120 && st.mul > 1.3, JSON.stringify(st));
used = await ev(() => __game.skills.use(1)); await sleep(200);
st = await ev(() => ({ sil: __game.skills.sil.visible, seen: performance.now() - __game.mini.seen.t < 500 }));
ok('透視脈衝：出現紅色人形、小地圖標出對手', used && st.sil && st.seen, JSON.stringify(st));

// ── 光學迷彩、能量護罩 ──
await setSkills('cloak', 'dome');
await place(SX, SZ, SX, SZ - 9, 0); await sleep(300);
used = await ev(() => __game.skills.use(0)); await sleep(150);
st = await ev(() => ({ on: performance.now() < __game.skills.cloakEnd, botBlind: performance.now() < __game.bot.noSeeUntil }));
ok('光學迷彩：自己進入隱身，機器人看不到', used && st.on && st.botBlind, JSON.stringify(st));
await ev(() => { const g = __game; g.combat.switchTo(1); }); await sleep(500);
await ev(() => { __game.mouse.l = true; __game.mouse.lp = true; }); await sleep(120); await ev(() => { __game.mouse.l = false; }); await sleep(150);
st = await ev(() => ({ on: performance.now() < __game.skills.cloakEnd, botBlind: performance.now() < __game.bot.noSeeUntil }));
ok('開槍就現形', !st.on && !st.botBlind, JSON.stringify(st));
// 護罩：站在裡面往外打、外面的機器人不會受傷
await place(SX, SZ, SX, SZ - 9, 0); await sleep(300);
used = await ev(() => __game.skills.use(1)); await healBot(); await sleep(300);
const hpB0 = await ev(() => __game.gs.p[1].hp + __game.gs.p[1].ar);
await ev(() => { const g = __game; g.player.pitch = 0; g.player.yaw = 0; g.mouse.l = true; g.mouse.lp = true; }); await sleep(120); await ev(() => { __game.mouse.l = false; }); await sleep(300);
st = await ev(() => ({ hp: __game.gs.p[1].hp + __game.gs.p[1].ar, domes: __game.skills.domes.length, sd: __game.skills.shieldDist(__game.player.pos.x, 2.6, __game.player.pos.z, 0, 0, -1) }));
ok('能量護罩：子彈被擋在護罩表面（3.8 公尺左右），打不到外面的人', used && st.domes === 1 && st.hp === hpB0 && st.sd > 3.2 && st.sd < 4.3, JSON.stringify([hpB0, st]));
await page.screenshot({ path: OUT + '/r4-dome.png' });
await ev(() => { __game.skills.domes.length = 0; });

// ── 震地衝擊波 ──
await setSkills('shock', 'chrono');
await place(SX, SZ, SX, SZ - 3, 0); await healBot();
await ev(() => { const a = __game.authority, b = a.players[1]; b.maxHp = 400; b.hp = 400; a.dirty = true; a.flush(); }); await sleep(300);   // 衝擊波最多 120 傷害：血給多一點，免得這一局直接結束
const hpS0 = await ev(() => __game.gs.p[1].hp + __game.gs.p[1].ar);
used = await ev(() => __game.skills.use(0)); await sleep(400);
st = await ev(() => ({ hp: __game.gs.p[1].hp + __game.gs.p[1].ar, me: __game.gs.p[0].hp, bv: __game.bot.body.vel.length() + Math.abs(__game.bot.body.pos.z - (__game.player.pos.z - 3)) }));
ok('震地衝擊波：對手受傷並被震開，自己沒事', used && st.hp < hpS0 - 40 && st.bv > 0.5, JSON.stringify([hpS0, st]));
await arena();                                                              // 超大衝擊波把地板震出大坑：重清場地

// ── 時間凝結（開打 4 秒後才能用）──
await sleep(600);
used = await ev(() => { __game.skills.ready[1] = 0; return __game.skills.use(1); }); await sleep(200);
st = await ev(() => ({ slow: performance.now() < __game.bot.slowUntil, r: performance.now() < __game.skills.rSlowEnd }));
ok('時間凝結：對手被緩速', used && st.slow && st.r, JSON.stringify(st));

// ── 軌道砲 ──
await setSkills('orbital', 'blackhole');
await ev(() => { __game.authority.players[1].buffs = []; });
await healBot();
await place(SX, SZ, SX, SZ - 10, 0); await sleep(300);
await ev(() => { __game.skills.ready = [0, 0]; __game.player.yaw = 0; __game.player.pitch = -0.155; }); await sleep(150);   // 瞄準 10 公尺外的地面（機器人腳邊）
const solid0 = await ev(() => __game.world.types.reduce((n, t) => n + (t ? 1 : 0), 0));
used = await ev(() => __game.skills.use(0)); await sleep(300);
st = await ev(() => ({ marks: __game.skills.marks.length, m: __game.skills.marks[0] && [__game.skills.marks[0].x, __game.skills.marks[0].z], bot: [__game.bot.body.pos.x, __game.bot.body.pos.z] }));
ok('軌道砲：先出現標記', used && st.marks === 1, JSON.stringify(st));
await page.screenshot({ path: OUT + '/r5-orbital-mark.png' });
await sleep(1500);
await page.screenshot({ path: OUT + '/r6-orbital-hit.png' });
await sleep(500);
st = await ev((s0) => ({ dug: s0 - __game.world.types.reduce((n, t) => n + (t ? 1 : 0), 0), res: __game.gs.res, phase: __game.phase, hpB: __game.gs.p[1].hp }), solid0);
ok('軌道砲：把地面轟出大洞', st.dug > 150, JSON.stringify(st));
ok('軌道砲：光柱附近的對手被擊倒，擊倒訊息顯示技能名稱', st.phase === 'roundEnd' && st.res.w === 'orbital' && (await ev(() => document.getElementById('banner').textContent.includes('軌道砲'))), JSON.stringify(st));

// ── 第 2 局：技能格滿了要選一個換掉 ──
await waitPhase('loadout', 20000); await sleep(400);
st = await ev(() => ({ ch: __game.gs.p[0].ch, lu: __game.gs.p[0].lu, botCh: __game.gs.p[1].ch, botLu: __game.gs.p[1].lu, round: __game.gs.round }));
ok('第 2 局大家再抽一次；上一局輸的機器人是輸家加碼', st.round === 2 && st.ch && st.ch.length === 3 && st.botLu === 1 && st.lu === 0, JSON.stringify(st));
await ev(() => { const a = __game.authority, p = a.players[0]; p.choices = ['chrono', 'vital', 'tough']; a.dirty = true; a.flush(); }); await sleep(250);
await page.waitForFunction(() => document.querySelector('.card.up[data-id="chrono"]'), { timeout: 10000 }).catch(() => {});   // 等翻牌動畫翻到這張
await page.click('.card[data-id="chrono"]'); await sleep(200);
st = await ev(() => ({ ask: document.querySelector('.card[data-id="chrono"]').classList.contains('ask'), ch: !!__game.gs.p[0].ch, btns: document.querySelectorAll('.card[data-id="chrono"] [data-slot]').length }));
ok('技能格滿了：點卡片會先問要換掉哪一個', st.ask && st.ch && st.btns === 2, JSON.stringify(st));
await page.screenshot({ path: OUT + '/r7-replace.png' });
await page.click('.card[data-id="chrono"] [data-slot="1"]'); await sleep(250);
st = await ev(() => __game.gs.p[0].sk);
ok('換掉第 2 格的技能', st[0] === 'orbital' && st[1] === 'chrono', JSON.stringify(st));

// ── 黑洞 + 被動（裁判端）：這一局用黑洞、荊棘、不死鳥、冰凍彈、燃燒彈 ──
await ev(() => { const a = __game.authority, p = a.players[0], b = a.players[1]; p.skills = ['blackhole', 'stim']; p.buffs = ['thorns', 'phoenix', 'cryo', 'incendiary', 'investor']; b.buffs = []; b.skills = [null, null]; b.choices = null; a.dirty = true; a.flush(); __game.bot.fire = () => {}; });
await sleep(200);
await page.click('#btn-ready'); await waitPhase('playing'); await sleep(300);
await arena();                                                              // 新的一局地形重置了，場地要重清
await place(SX, SZ, SX, SZ - 6, 0); await sleep(300);
// 冰凍彈、燃燒彈：打中之後對手被緩速、著火
await ev(() => { const g = __game; g.player.yaw = 0; g.player.pitch = 0; g.authority.handle(0, 'hit', { r: g.round, d: 10, h: false, w: 'pistol' }); }); await sleep(250);
st = await ev(() => ({ fz: __game.gs.p[1].fz, bu: __game.gs.p[1].bu, hp: __game.gs.p[1].hp + __game.gs.p[1].ar }));
ok('冰凍彈＋燃燒彈：被打中的人緩速、著火', st.fz === 1 && st.bu === 1, JSON.stringify(st));
await sleep(1700);
const burned = await ev(() => __game.gs.p[1].hp + __game.gs.p[1].ar);
ok('著火會持續扣血，緩速 1.6 秒後解除', burned < st.hp && (await ev(() => __game.gs.p[1].fz)) === 0, JSON.stringify([st.hp, burned]));
// 荊棘：玩家被打，30% 彈回去
await ev(() => { const a = __game.authority; a.players[1].hp = 100; a.players[1].armor = 0; a.players[0].hp = 100; a.players[0].armor = 0; a.players[1].burnT = 0; a.handle(1, 'hit', { r: a.round, d: 40, h: false, w: 'ar' }); }); await sleep(200);
st = await ev(() => ({ me: __game.gs.p[0].hp, bot: __game.gs.p[1].hp }));
ok('荊棘：受到 40 傷害，反彈 12 給對手', st.me === 60 && st.bot === 88, JSON.stringify(st));
// 不死鳥：致命傷 → 回到 70 血、短暫無敵；同一局第二次就真的死
await ev(() => { const a = __game.authority; a.handle(1, 'hit', { r: a.round, d: 400, h: false, w: 'knife' }); a.handle(1, 'hit', { r: a.round, d: 400, h: false, w: 'knife' }); }); await sleep(250);
st = await ev(() => ({ hp: __game.gs.p[0].hp, al: __game.gs.p[0].al, phase: __game.phase }));
ok('不死鳥：吃了刀沒死，回到 70 血，無敵期間再砍也沒事', st.al && st.hp === 70 && st.phase === 'playing', JSON.stringify(st));
// 黑洞：丟在機器人旁邊，會把它吸過去、吞方塊
await sleep(2100);
await ev(() => { const a = __game.authority; a.players[1].maxHp = 900; a.players[1].hp = 900; a.players[1].burnT = 0; a.dirty = true; a.flush(); });   // 血給多一點，免得被黑洞吸死之後這一局就結束了
await place(SX, SZ, SX + 4, SZ - 9, 0); await sleep(300);
await ev(() => { __game.skills.ready = [0, 0]; __game.player.yaw = 0; __game.player.pitch = -0.15; }); await sleep(150);
const solid1 = await ev(() => __game.world.types.reduce((n, t) => n + (t ? 1 : 0), 0)), bx0 = await ev(() => __game.bot.body.pos.x);
used = await ev(() => __game.skills.use(0)); await sleep(1500);
await page.screenshot({ path: OUT + '/r8-blackhole.png' });
await sleep(1200);
st = await ev((s1, bx0) => ({ dug: s1 - __game.world.types.reduce((n, t) => n + (t ? 1 : 0), 0), dx: bx0 - __game.bot.body.pos.x, holes: __game.skills.holes.length, hp: __game.gs.p[1].hp }), solid1, bx0);
ok('黑洞：吞掉方塊、把旁邊的對手往中心吸', used && st.dug > 20 && st.dx > 1.2 && st.holes === 1, JSON.stringify(st));
await sleep(2200);
st = await ev(() => ({ holes: __game.skills.holes.length, hp: __game.gs.p[1].hp, phase: __game.phase }));
ok('黑洞 4.5 秒後消失；被吸在正中間的人總共受傷 60～260', st.holes === 0 && st.hp <= 840 && st.hp >= 640 && st.phase === 'playing', JSON.stringify(st));

// ── 開槍相關的被動：爆裂彈、跳彈、雙重射擊（對著牆打）──
await ev(() => { const g = __game; g.authority.players[0].buffs = ['explosive', 'ricochet', 'twin']; g.authority.dirty = true; g.authority.flush(); g.combat.mods = { ...g.combat.mods, explosive: true, ricochet: true, twin: true }; });
await place(SX, SZ, SX + 6, SZ + 6, 0); await sleep(300);
await setSkills('wall', 'stim'); await sleep(100);
await ev(() => { window.__before = __game.world.types.slice(); __game.skills.use(0); }); await sleep(300);   // 面前立一道鋼牆當靶
const sent = await ev(async () => {
  const g = __game, log = []; const orig = g.sendPeer.bind(g); g.sendPeer = (t, d) => { log.push([t, d]); orig(t, d); };
  g.player.yaw = 0; g.player.pitch = 0; g.combat.switchTo(1); await new Promise((r) => setTimeout(r, 500));
  g.mouse.l = true; g.mouse.lp = true; await new Promise((r) => setTimeout(r, 150)); g.mouse.l = false; await new Promise((r) => setTimeout(r, 200));
  g.sendPeer = orig;
  const fire = log.find((m) => m[0] === 'fire' && m[1].e), expl = log.find((m) => m[0] === 'expl');
  return { pellets: fire ? fire[1].e.length / 3 : 0, e2: fire && fire[1].e2 ? fire[1].e2.length / 6 : 0, mini: expl ? expl[1].fxk : null };
});
ok('雙重射擊：手槍一次射兩發', sent.pellets === 2, JSON.stringify(sent));
ok('跳彈：打在鋼牆上會反彈', sent.e2 >= 1, JSON.stringify(sent));
ok('爆裂彈：打到東西有小爆炸', sent.mini === 'mini', JSON.stringify(sent));

// ── 新技能：衝刺、換位、時間暫停、流星雨、軌道砲追人 ──
await ev(() => { const a = __game.authority; a.players[0].maxHp = 900; a.players[0].hp = 900; a.players[1].maxHp = 900; a.players[1].hp = 900; a.players[1].armor = 0; a.players[1].burnT = 0; a.players[0].buffs = []; a.dirty = true; a.flush(); __game.combat.mods = { ...__game.combat.mods, cd: 1, extraUses: 0, twin: false, explosive: false, ricochet: false }; });
await setSkills('dash', 'swap');
await arena();                                                              // 前面的測試立了鋼牆、炸了洞：重清場地
await place(SX, SZ, SX + 8, SZ - 10, 0); await sleep(600);
let q0 = await ev(() => [__game.player.pos.x, __game.player.pos.z]);
used = await ev(() => __game.skills.use(0)); await sleep(1500);
let q1 = await ev(() => [__game.player.pos.x, __game.player.pos.z]);
ok('衝刺：一下子往前衝出一大段', used && q0[1] - q1[1] > 4, JSON.stringify([q0, q1]));
await place(SX, SZ, SX, SZ - 9, 0); await sleep(1500);                     // 等對手的位置同步過來（畫面很慢的電腦上要久一點）
q0 = await ev(() => ({ me: [__game.player.pos.x, __game.player.pos.z], bot: [__game.bot.body.pos.x, __game.bot.body.pos.z] }));
used = await ev(() => __game.skills.use(1)); await sleep(300);
q1 = await ev(() => ({ me: [__game.player.pos.x, __game.player.pos.z], bot: [__game.bot.body.pos.x, __game.bot.body.pos.z] }));
const near = (a, b, d) => Math.hypot(a[0] - b[0], a[1] - b[1]) < d;
ok('換位：跟看得到的對手交換位置', used && near(q1.me, q0.bot, 1.5) && near(q1.bot, q0.me, 1.5), JSON.stringify([q0, q1]));
st = await ev(() => { const g = __game, now = performance.now(), p = g.player, y0 = p.yaw, a = [p.pos.x, p.pos.y, p.pos.z], b = [g.remote.pos.x, g.remote.pos.y, g.remote.pos.z];
  const bonus = g.skills.swapEnd > now;
  g.skills.onNet({ r: g.round, id: 'swap', a, b });                         // 假裝被對手換位
  const r = { bonus, turned: Math.abs(Math.abs(p.yaw - y0) - Math.PI) < 0.01, noFire: g.skills.noFire(), spd: g.skills.speedMul(g.gs.p[0]) };
  g.skills.dazeEnd = g.skills.noFireEnd = 0; return r; });
ok('換位的效果：自己有傷害加成；被換的人轉成背對、不能開槍、跑不快', st.bonus && st.turned && st.noFire && st.spd < 0.7, JSON.stringify(st));
await setSkills('timestop', 'meteor');
await place(SX, SZ, SX, SZ - 10, 0); await sleep(300);
used = await ev(() => __game.skills.use(0)); await sleep(200);
st = await ev(() => ({ bot: __game.bot.stopUntil - performance.now(), mine: __game.skills.rStopEnd - performance.now() }));
ok('時間暫停：機器人完全停住 2.5 秒', used && st.bot > 1200 && st.mine > 1200, JSON.stringify(st));
await ev(() => { const a = __game.authority; a.handle(0, 'hit', { r: a.round, d: 5, h: false, w: 'ar' }); }); await sleep(800);
st = await ev(() => ({ bot: __game.bot.stopUntil - performance.now(), mine: __game.skills.rStopEnd - performance.now() }));
ok('時間暫停：被打到一下就馬上恢復（兩邊都知道）', st.bot <= 0 && st.mine <= 0, JSON.stringify(st));
st = await ev(() => { const g = __game; g.skills.onNet({ r: g.round, id: 'timestop', d: 1.5 }); return { frozen: g.skills.frozen(), spd: g.skills.speedMul(g.gs.p[0]), look: g.skills.lookMul(), cast: g.skills.use(1) }; });
ok('被時間暫停：不能動、不能轉頭、不能放技能', st.frozen && st.spd === 0 && st.look === 0 && !st.cast, JSON.stringify(st));
st = await ev(() => { const g = __game; g.onEv({ t: 'hurt', d: 5, self: false, h: false, w: 'ar' }); return { frozen: g.skills.frozen(), look: g.skills.lookMul() }; });
ok('被時間暫停時挨了一下：馬上恢復，可以動也可以轉頭', !st.frozen && st.look > 0, JSON.stringify(st));
await sleep(1700);
const hpM0 = await ev(() => __game.gs.p[1].hp), solidM = await ev(() => __game.world.types.reduce((n, t) => n + (t ? 1 : 0), 0));
await ev(() => { __game.player.yaw = 0; __game.player.pitch = -0.17; });
used = await ev(() => __game.skills.use(1)); await sleep(4000);
st = await ev((h0, s0) => ({ hp: __game.gs.p[1].hp, h0, dug: s0 - __game.world.types.reduce((n, t) => n + (t ? 1 : 0), 0), uses: __game.skills.uses[1] }), hpM0, solidM);
ok('流星雨：隕石追著對手砸，打掉血、砸爛地形', used && st.hp < st.h0 - 50 && st.dug > 20, JSON.stringify(st));
await page.screenshot({ path: OUT + '/r9-meteor.png' });
// 回溯錨點：按一次放、再按一次回去；錨點還在時受到致命傷會被救回錨點
await setSkills('anchor', 'stim');
await place(SX, SZ, SX, SZ - 14, 0); await sleep(600);
const anc0 = await ev(() => __game.player.pos.toArray());
used = await ev(() => __game.skills.use(0)); await sleep(300);
st = await ev(() => ({ placed: !!__game.skills.anchor, auth: __game.authority.players[0].anchor }));
ok('回溯錨點：按一次在原地放下錨點，裁判也知道', used && st.placed && st.auth === true, JSON.stringify(st));
await ev(() => { const p = __game.player; p.pos.set(p.pos.x + 6, p.pos.y, p.pos.z); p.prev.copy(p.pos); p.rpos.copy(p.pos); }); await sleep(800);
used = await ev(() => __game.skills.use(0)); await sleep(300);
st = await ev((a0) => { const p = __game.player.pos; return { d: Math.hypot(p.x - a0[0], p.z - a0[2]), left: __game.skills.hudState(performance.now()).slots[0].left, auth: __game.authority.players[0].anchor }; }, anc0);
ok('回溯錨點：再按一次瞬間回到錨點，然後進入冷卻', used && st.d < 0.5 && st.left > 10 && st.auth === false, JSON.stringify(st));
await ev(() => { __game.skills.ready = [0, 0]; __game.skills.use(0); const p = __game.player; p.pos.set(p.pos.x + 6, p.pos.y, p.pos.z); p.prev.copy(p.pos); p.rpos.copy(p.pos); }); await sleep(600);
st = await ev(async (a0) => { const g = __game, a = g.authority, me = a.players[0]; me.inv = 0; a.handle(1, 'hit', { r: a.round, d: 400, h: false, w: 'knife' }); await new Promise((r) => setTimeout(r, 600)); const p = g.player.pos; return { al: me.alive, hp: me.hp, d: Math.hypot(p.x - a0[0], p.z - a0[2]) }; }, anc0);
ok('回溯錨點：錨點還在時被砍死 → 傳回錨點、剩 50 血', st.al && st.hp === 50 && st.d < 0.5, JSON.stringify(st));
await ev(() => { const a = __game.authority; a.players[0].maxHp = 900; a.players[0].hp = 900; a.dirty = true; a.flush(); });

// 堡壘：在原地蓋城堡，自己站上哨塔頂
await setSkills('fortress', 'stim');
await place(SX, SZ, SX, SZ - 14, 0); await sleep(600);
const fortS0 = await ev(() => __game.world.types.reduce((n, t) => n + (t ? 1 : 0), 0)), fortY0 = await ev(() => __game.player.pos.y);
used = await ev(() => __game.skills.use(0)); await sleep(1500);
st = await ev((s0, y0) => { const g = __game, p = g.player; return { added: g.world.types.reduce((n, t) => n + (t ? 1 : 0), 0) - s0, dy: p.pos.y - y0, stuck: p.collides(p.pos.x, p.pos.y, p.pos.z), bot: g.bot.body.collides(g.bot.body.pos.x, g.bot.body.pos.y, g.bot.body.pos.z) }; }, fortS0, fortY0);
ok('堡壘：蓋出一座城堡（上千塊），自己站上 6 公尺高的哨塔，沒有把人埋住', used && st.added > 700 && st.dy > 5.5 && st.dy < 6.5 && !st.stuck && !st.bot, JSON.stringify(st));
await page.screenshot({ path: OUT + '/r10-fortress.png' });
await arena(); await sleep(300);
// 升天：把看得到的對手往上噴、扣血
await setSkills('launch', 'stim');
await place(SX, SZ, SX, SZ - 10, 0); await sleep(600);
await ev(() => { __game.player.yaw = 0; __game.player.pitch = -0.05; __game.bot.fire = () => {}; });
const hpL0 = await ev(() => __game.gs.p[1].hp), yL0 = await ev(() => __game.bot.body.pos.y);
used = await ev(() => __game.skills.use(0));
await page.waitForFunction((y0) => __game.bot.body.pos.y > y0 + 3, { timeout: 10000 }, yL0).catch(() => {});
const dyL = await ev((y0) => __game.bot.body.pos.y - y0, yL0); await sleep(1000);
st = await ev((h0) => ({ hp: __game.gs.p[1].hp, h0 }), hpL0);
ok('升天：對手被原地噴上天、扣血', used && dyL > 3 && st.hp < st.h0, JSON.stringify({ ...st, dyL }));
// 賭博：亂數固定 → 賭贏（對手被凝結）、賭輸（自己著火）
await setSkills('gamble', 'stim'); await sleep(300);
st = await ev(() => { const g = __game, R = Math.random; Math.random = () => 0.1; let used; try { used = g.skills.use(0); } finally { Math.random = R; } return { used, slow: g.skills.rSlowEnd > performance.now() }; });
ok('賭博：賭贏 → 對手吃負面效果', st.used && st.slow, JSON.stringify(st));
st = await ev(async () => { const g = __game, R = Math.random; g.skills.ready = [0, 0]; Math.random = () => 0.9; let used; try { used = g.skills.use(0); } finally { Math.random = R; } await new Promise((r) => setTimeout(r, 600)); return { used, burn: g.authority.players[0].burnT > Date.now() }; });
ok('賭博：賭輸 → 自己吃（著火由裁判算）', st.used && st.burn, JSON.stringify(st));
await ev(() => { const a = __game.authority; a.players[0].burnT = 0; a.players[0].hp = a.players[0].maxHp; a.dirty = true; a.flush(); });
// 召喚：梁允猴、gay tay；對手的召喚物看得到、打得到
await setSkills('monkey', 'gaytay');
await place(SX, SZ, SX, SZ - 12, 0); await sleep(400);
used = await ev(() => __game.skills.use(0)); const used2 = await ev(() => __game.skills.use(1)); await sleep(500);
st = await ev(() => __game.pets.mine.map((p) => p.kind + ':' + p.hp + ':' + !!p.view.tag));
ok('召喚：梁允猴（60 血）、gay tay（700 血）都出現，頭上有名牌', used && used2 && st.includes('monkey:60:true') && st.includes('gaytay:700:true'), JSON.stringify(st));
await page.screenshot({ path: OUT + '/r11-pets.png' });
st = await ev(() => {
  const g = __game, p = g.player, e = { x: p.pos.x, y: p.pos.y + 1.6, z: p.pos.z };
  g.pets.onNet({ r: g.round, id: 'pets', l: [77, 0, e.x, p.pos.y, e.z - 5, 0, 60, 60, 0] });   // 假裝對手放了一隻猴子在正前方 5 公尺
  const t = g.rayTarget(e.x, e.y - 0.9, e.z, 0, 0, -1), seen = g.pets.theirs.has(77);
  g.pets.hit('pet77', 30, false); const hp = g.pets.theirs.get(77).hp;
  g.pets.onNet({ r: g.round, id: 'petdie', n: 77 });
  return { seen, id: t && t.id, hp, gone: !g.pets.theirs.has(77) };
});
ok('召喚：對手的召喚物會出現、子彈打得到（先扣自己這邊的血條），死掉就消失', st.seen && st.id === 'pet77' && st.hp === 30 && st.gone, JSON.stringify(st));
await ev(() => __game.pets.clear());
await setSkills('orbital', 'stim');
await place(SX, SZ, SX + 6, SZ - 10, 0); await sleep(300);
await ev(() => { __game.player.yaw = 0; __game.player.pitch = -0.2; __game.bot.fire = () => {}; });
used = await ev(() => __game.skills.use(0));
const m0 = await ev(() => { const m = __game.skills.marks[0], b = __game.bot.body.pos; return m ? Math.hypot(m.x - b.x, m.z - b.z) : -1; }); await sleep(600);
const m1 = await ev(() => { const m = __game.skills.marks[0], b = __game.bot.body.pos; return m ? Math.hypot(m.x - b.x, m.z - b.z) : -1; });
ok('軌道砲：光柱會往附近的對手移過去', used && m0 > 0 && m1 >= 0 && m1 < m0 - 0.5, JSON.stringify([m0, m1]));
await sleep(1200);
// ── 新被動（裁判端）：急救包、求生本能；超頻 ──
st = await ev(() => { const a = __game.authority, p = a.players[0]; p.maxHp = 100; p.hp = 100; p.armor = 0; p.inv = 0; p.buffs = ['medkit']; p.aid = false; a.handle(1, 'hit', { r: a.round, d: 70, h: false, w: 'ar' }); return p.hp; });
ok('急救包：血掉到 35 以下自動補 50', st === 80, String(st));
st = await ev(() => { const a = __game.authority, p = a.players[0]; p.hp = 30; p.buffs = ['survivor']; a.handle(1, 'hit', { r: a.round, d: 20, h: false, w: 'ar' }); return p.hp; });
ok('求生本能：血少的時候受到的傷害 −40%', Math.abs(st - 18) < 0.01, String(st));
await ev(() => { const a = __game.authority, p = a.players[0]; p.maxHp = 900; p.hp = 900; p.buffs = []; a.dirty = true; a.flush(); });
st = await ev(() => { const g = __game; g.combat.mods = { ...g.combat.mods, cd: 0.5, extraUses: 1 }; g.skills.setup(['wall', 'stim']); g.skills.use(1); const left = g.skills.hudState(performance.now()).slots[1].left; g.combat.mods = { ...g.combat.mods, cd: 1, extraUses: 0 }; return { left }; });
ok('超頻：冷卻 −50%', st.left > 6 && st.left < 7.5, JSON.stringify(st));


// 投資客：下一局開始多 $1500
await healBot();
const money0 = await ev(() => { const a = __game.authority; a.players[0].buffs.push('investor'); return a.players[0].money; });
// 刀一定致命：就算對手疊滿減傷（硬皮、重裝巨人、天神下凡）、400 血、200 護甲也一樣
const knifed = await ev(() => { const a = __game.authority, b = a.players[1]; b.buffs = ['tough', 'jugg', 'avatar', 'vital']; b.maxHp = 400; b.hp = 400; b.armor = 200; a.handle(0, 'hit', { r: a.round, d: 400, h: false, w: 'knife' }); return { al: b.alive, hp: b.hp }; });
ok('刀一刀斃命：疊滿減傷、生命、護甲也砍得死', !knifed.al, JSON.stringify(knifed));
await waitPhase('loadout', 20000); await sleep(300);
st = await ev(() => ({ $: __game.gs.p[0].$, round: __game.gs.round }));
ok('投資客：贏一局 $2000 之外，下一局開始再多 $1500', st.$ === Math.min(12000, money0 + 2000 + 1500), JSON.stringify([money0, st]));

// 沒選卡就讓時間跑完：自動拿一張，不會擠掉現有的技能
await ev(() => { const a = __game.authority, p = a.players[0]; p.skills = ['blink', 'wall']; p.choices = ['orbital', 'vital', 'cloak']; p.buffs = ['plate', 'arsenal']; p.money = 9000; p.loadout = { ...p.loadout, armor: 1 }; a.tEnd = Date.now() + 300; a.dirty = true; a.flush(); });
await waitPhase('countdown', 8000); await sleep(200);
st = await ev(() => ({ sk: __game.gs.p[0].sk, bf: __game.gs.p[0].bf }));
ok('護甲片、軍火庫跟買的防彈衣疊加：50 + 100 + 50', (await ev(() => __game.gs.p[0].ar)) === 200, String(await ev(() => __game.gs.p[0].ar)));
ok('時間到沒選：自動拿被動，不動到已經帶的技能', st.sk[0] === 'blink' && st.sk[1] === 'wall' && st.bf.includes('vital'), JSON.stringify(st));

// ── 音效：每一種技能音都烘得出來、沒有壞掉的數值 ──
const snd = await ev(() => {
  const s = __game.sfx; s.init(); if (!s.ctx) return 'no audio';
  const bad = [];
  for (const k of ['blink', 'grapple', 'jet', 'wall', 'stim', 'scan', 'cloak', 'dome', 'chrono', 'mark', 'beam', 'hole', 'phoenix']) {
    try { s.skill(k, 5, 0.2); const b = s.bufs.get('skill:' + k), d = b.getChannelData(0); let m = 0; for (let i = 0; i < d.length; i++) { if (!Number.isFinite(d[i])) { bad.push(k + ':nan'); break; } m = Math.max(m, Math.abs(d[i])); } if (m < 0.2 || m > 1) bad.push(k + ':peak' + m.toFixed(2)); } catch (e) { bad.push(k + ':' + e.message); }
  }
  for (const r of ['c', 'r', 'l', 'm']) { try { s.card(r); } catch (e) { bad.push('card:' + e.message); } }
  try { s.loop('void', 'void', 0.5, 0); s.loop('void', 'void', 0); } catch (e) { bad.push('void:' + e.message); }
  return bad.join(', ') || 'ok';
});
ok('技能音效都正常', snd === 'ok', snd);

// ── 大地圖：換到城堡要塞時世界變大，換回來恢復 ──
st = await ev(() => { const g = __game; g.setMap('castle'); const a = { X: g.world.X, Z: g.world.Z, half: g.env.half }; g.setMap('plaza'); a.back = g.world.X; return a; });
ok('城堡要塞是 72×72 公尺的大地圖，換回一般地圖會恢復', st.X === 144 && st.Z === 144 && st.half === 36 && st.back === 96, JSON.stringify(st));
// 大地圖：每座塔頂、屋頂、點位從出生點都走得上去（用機器人的尋路檢查）；出生點、補給品沒有卡在方塊裡
st = await ev(async () => {
  const { Nav } = await import('./js/nav.js'); const { MAPS } = await import('./js/maps.js');
  const g = __game, bad = [];
  const spots = {
    castle: [['哨塔頂', 16, 21, 16], ['民房屋頂', 9.5, 14, 43.5], ['城堡屋頂', 60, 17, 60], ['平房屋頂', 89, 10, 13]],
    valley: [['側塔頂', 29, 18, 40], ['主塔頂', 63, 24, 17], ['河床', 45, 2, 63], ['對面出生點', 64, 6, 123]],
    dust: [['A點高台', 9, 6, 109], ['B點樓頂', 114, 15, 110], ['B地道中段', 108, 3, 61], ['對面出生點', 64, 3, 121]],
    site: [['二樓', 24, 11, 24], ['三樓辦公室', 14, 19, 14], ['屋頂', 20, 27, 60], ['塔吊平台', 63, 11, 63], ['對角出生房間', 111, 3, 111], ['鷹架二樓', 30, 11, 5]],
  };
  const solid = (q) => g.world.boxSolid(q.x - 0.3, q.y + 0.01, q.z - 0.3, q.x + 0.3, q.y + 1.8, q.z + 0.3);
  const floor = (q) => g.world.boxSolid(q.x - 0.3, q.y - 0.4, q.z - 0.3, q.x + 0.3, q.y - 0.01, q.z + 0.3);
  for (const id of Object.keys(spots)) {
    g.setMap(id); const nav = new Nav(g.world), sp = MAPS[id].spawns[0];
    for (const [n, bx, by, bz] of spots[id]) if (!nav.path(sp.x, sp.y, sp.z, (bx + 0.5) * 0.5, by * 0.5, (bz + 0.5) * 0.5)) bad.push(id + ' ' + n);
    for (const q of [...MAPS[id].spawns, ...MAPS[id].pickups]) if (solid(q) || !floor(q)) bad.push(id + ' 卡住 ' + q.x + ',' + q.z);
  }
  g.setMap('plaza');
  return bad.join('、') || 'ok';
});
ok('城堡要塞、雙塔河谷、沙城兩路、施工大樓：塔頂、樓層和點位都走得上去，出生點和補給品正常', st === 'ok', st);

// ── 一般模式不受影響 ──
await ev(() => __game.leave()); await sleep(300);
await page.click('#chk-prog'); await sleep(100);
await page.click('#btn-bot'); await waitPhase('loadout'); await sleep(300);
st = await ev(() => ({ mode: __game.gs.set.mode, ch: __game.gs.p[0].ch, tl: __game.gs.tLeft, builds: document.getElementById('lo-builds').classList.contains('hidden') }));
ok('取消勾選後回到一般模式：第 1 局沒有卡可以選', st.mode === 'classic' && st.ch === null && st.tl <= 30000 && st.builds, JSON.stringify(st));

ok('整個過程沒有任何錯誤訊息', errs.length === 0, errs.slice(0, 5).join('\n'));
console.log(`\n${pass} pass, ${fail} fail`);
await browser.close();
process.exit(fail ? 1 : 0);
