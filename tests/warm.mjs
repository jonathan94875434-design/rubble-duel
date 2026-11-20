// 新功能測試（雙人）：熱身、陪練機器人讓位、自製地圖同步、噴漆／表情／火焰同步、擊殺回放、語音
// 用法：node warm.mjs <截圖資料夾> [peer]　（peer = 走真的 PeerJS 連線，才測得到語音）
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
  args: ['--window-size=1100,680', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  defaultViewport: { width: 1100, height: 680 }, protocolTimeout: 60000 });
const errs = [];
let fails = 0;
const mk = async (tag) => {
  const cdp = await browser.target().createCDPSession();
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true });
  const target = await browser.waitForTarget((t) => t._targetId === targetId);
  const page = await target.page();
  await page.setViewport({ width: 1100, height: 680 });
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon') && !m.text().includes('ERR_SOCKET') && !m.text().includes('ERR_CONNECTION') && !m.location().url?.includes('favicon')) errs.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', (e) => errs.push(`[${tag} pageerror] ${e.message}\n${e.stack}`));
  return page;
};
const A = await mk('A'), B = await mk('B');
const waitPhase = (page, ph, ms = 20000) => page.waitForFunction((ph) => window.__game && __game.phase === ph, { timeout: ms }, ph);
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
const hash = (page) => page.evaluate(() => { const t = __game.world.types; let a = 0, n = 0; for (let i = 0; i < t.length; i++) if (t[i]) { n++; a = (Math.imul(a, 31) + i * t[i]) | 0; } return `${n}/${a}`; });

// ── A 先用編輯器做一張自製地圖 ──
await load(A, `${BASE}?${Q}`);
await A.evaluate(() => { localStorage.removeItem('rubble.maps'); localStorage.setItem('rubble.bot', '"easy"'); });
const mapId = await A.evaluate(async () => {
  const G = __game, ed = G.editor;
  G.openEditor(null, { ground: 'sand' });
  ed.pos.set(20, 6, 20); ed.yaw = 0; ed.pitch = -1.2; await new Promise((r) => setTimeout(r, 300));
  ed.type = 3; ed.brush = 3; ed.sym = 'rot'; ed.paint(true); ed.name = '雙人測試圖'; ed.env = 'sunset';
  const r = await G.editorSave(false);
  G.closeEditor();
  return r.id;
});
ok('先做好一張自製地圖', typeof mapId === 'string' && mapId.startsWith('c_'), mapId);

// ── A 建房，一個人先熱身 ──
await A.type('#in-name', '阿強');
await A.click('#btn-host');
await waitPhase(A, 'lobby');
const link = await A.evaluate(() => __game.inviteLink());
await A.click('#btn-warm');
await waitPhase(A, 'warmup');
const botLevel = await A.evaluate(() => { const l = __game.bot.level; __game.bot.level = 'dummy'; return l; });   // 先確認它是會打人的等級，再讓它站著別動，後面的檢查才不會被它干擾
await sleep(1500);
{
  const r = await A.evaluate(async () => {
    const G = __game, S = (ms) => new Promise((r) => setTimeout(r, ms)), o = {};
    o.bot = G.warmBot && !!G.bot; o.here = G.gs.here[1]; o.name = G.gs.p[1].n; o.alive = G.gs.p[0].al && G.gs.p[1].al; o.hp = G.gs.p.map((p) => p.hp + '/' + p.al).join(' '); o.remote = G.remote.group.visible; o.slots = G.combat.slots.map((s) => s && s.id).join(',');
    o.nades = Object.values(G.combat.nades).join(''); o.hud = !document.getElementById('hud').classList.contains('hidden'); o.timer = document.getElementById('timer').textContent;
    G.authority.damage(0, 999, 1, 'ar', false); await S(300);
    o.dead = !G.gs.p[0].al && G.phase === 'warmup'; o.feed = document.querySelectorAll('#feed .kf').length;
    await S(2400); o.back = G.gs.p[0].al && G.gs.p[0].hp === 100 && G.player.pos.y > 0.5;
    G.authority.damage(1, 999, 0, 'ar', true); await S(300); o.botDead = !G.gs.p[1].al && !!G.remote.dead; await S(2500); o.botBack = G.gs.p[1].al && !G.remote.dead && G.remote.group.visible;
    o.score = G.gs.p[0].sc + G.gs.p[1].sc;
    G.openBuy(); await S(200);
    o.shop = !document.getElementById('scr-loadout').classList.contains('hidden') && document.getElementById('scr-loadout').classList.contains('warm') && document.getElementById('lo-title').textContent.includes('熱身');
    if (G.wsel.p === 'sniper') G.buy('p', 'sniper'); G.buy('p', 'sniper'); G.closeBuy(); await S(200);
    o.gun = G.combat.slots[0] && G.combat.slots[0].id; o.shopClosed = document.getElementById('scr-loadout').classList.contains('hidden') && !G.buyOpen;
    o.stats = G.stats.d.duel.rounds + '/' + G.stats.d.practice.rounds;
    return o;
  });
  ok('一個人按熱身：機器人陪練、裝備免費（含刀和四種投擲物）', r.bot && r.here && r.name === '陪練機器人' && r.alive && r.remote && r.slots === 'ar,pistol,knife' && r.nades === '1111' && r.hud && r.timer === '熱身' && botLevel !== 'dummy', JSON.stringify(r));
  ok('熱身中陣亡 2 秒後重生，不會結束回合', r.dead && r.back && r.feed >= 1, `${r.dead} ${r.back}`);
  ok('機器人被擊倒也會重生，不計分、不記戰績', r.botDead && r.botBack && r.score === 0 && r.stats === '0/0', `${r.botDead} ${r.botBack} ${r.score} ${r.stats}`);
  ok('熱身中可以開商店換槍', r.shop && r.gun === 'sniper' && r.shopClosed, `${r.shop} ${r.gun}`);
  await A.screenshot({ path: OUT + '/w1-warm-solo.png' });
}

// ── B 加入：機器人下場，回到大廳 ──
await load(B, link + '&nolock=1');
await B.$eval('#in-name', (e) => { e.value = ''; });
await B.type('#in-name', '小明');
await B.click('#btn-join');
await waitPhase(B, 'lobby', 30000);
await waitPhase(A, 'lobby');
await sleep(600);
{
  const a = await A.evaluate(() => ({ bot: __game.warmBot || !!__game.bot, p1: document.getElementById('lb-p1').textContent, warm: document.getElementById('btn-warm').textContent, start: !document.getElementById('btn-start').disabled }));
  ok('朋友一進來：陪練機器人下場、自動回大廳', !a.bot && a.p1 === '小明' && a.warm === '一起熱身' && a.start, JSON.stringify(a));
}

// ── 選自製地圖：資料自動傳給對方 ──
await A.select('#set-map', mapId);
await sleep(1500);
{
  const b = await B.evaluate(async (id) => { const M = await import('./js/maps.js'); return { has: !!M.MAPS[id], name: M.MAPS[id] && M.MAPS[id].name, world: __game.world.mapId, env: __game.env.id, sel: document.getElementById('set-map').value }; }, mapId);
  ok('房主選自製地圖，對方自動收到並預覽', b.has && b.name === '雙人測試圖' && b.world === mapId && b.env === 'sunset' && b.sel === mapId, JSON.stringify(b));
  ok('兩邊蓋出來的自製地圖一模一樣', (await hash(A)) === (await hash(B)));
}

// ── 兩個人一起熱身：噴漆、表情、燃燒瓶同步 ──
await A.click('#btn-warm');
await waitPhase(A, 'warmup'); await waitPhase(B, 'warmup');
await sleep(1200);
{
  await A.evaluate(async () => {
    const G = __game, S = (ms) => new Promise((r) => setTimeout(r, ms));
    G.player.pitch = -1.3; await S(250); G.doSpray(); await S(100);       // 噴在腳邊的地上
    G.player.pitch = 0; G.doEmote(); await S(200);
  });
  await sleep(500);
  const b = await B.evaluate(() => ({ spray: __game.fx.sprays.length, emote: __game.remote.emoteT > 0, map: __game.world.mapId, alive: __game.gs.p[0].al && __game.gs.p[1].al }));
  ok('噴漆和表情動作對方看得到', b.spray === 1 && b.emote && b.alive, JSON.stringify(b));
  // B 丟燃燒瓶到自己腳邊 → A 那邊也有火（但不是 A 的）；B 站在自己的火裡會扣血
  await B.evaluate(async () => { const G = __game; G.combat.nades.molotov = 1; G.player.pitch = -1.4; await new Promise((r) => setTimeout(r, 200)); G.combat.throwNade('molotov'); });
  await sleep(1800);
  const f = await A.evaluate(() => ({ n: __game.combat.fires.length, mine: __game.combat.fires[0] && __game.combat.fires[0].mine, fx: __game.fx.fires.length, bhp: __game.gs.p[1].hp }));
  ok('燃燒瓶的火兩邊都有，丟的人站在裡面會自己扣血', f.n === 1 && f.mine === false && f.fx === 1 && f.bhp < 100, JSON.stringify(f));
  await B.screenshot({ path: OUT + '/w2-warm-fire.png' });
  // B 打死 A → 兩邊都看到擊倒訊息，A 重生
  await B.evaluate(() => { const G = __game; G.auth('hit', { r: G.round, d: 500, h: true, w: 'dmr', wb: 1 }); });
  await sleep(500);
  const k = await A.evaluate(() => ({ dead: !__game.gs.p[0].al, feed: document.getElementById('feed').textContent, phase: __game.phase }));
  ok('熱身中被朋友擊倒：有擊倒訊息、不會進回合結算', k.dead && k.feed.includes('阿強') && k.phase === 'warmup', JSON.stringify(k));
  await sleep(2400);
  ok('重生後繼續打', await A.evaluate(() => __game.gs.p[0].al && __game.phase === 'warmup'));
}
await A.evaluate(() => __game.endWarmup());
await waitPhase(A, 'lobby'); await waitPhase(B, 'lobby');
ok('房主結束熱身，兩邊回大廳', true);

// ── 正式開打（自製地圖）：穿牆擊倒 → 對方看到擊殺回放 ──
await A.click('#btn-start');
await waitPhase(A, 'loadout'); await waitPhase(B, 'loadout');
await sleep(300);
await A.click('#btn-ready'); await B.click('#btn-ready');
await waitPhase(A, 'playing'); await waitPhase(B, 'playing');
await sleep(2200);
ok('自製地圖正式對戰：兩邊地形一致', (await hash(A)) === (await hash(B)) && (await B.evaluate(() => __game.world.mapId)) === mapId);
await A.evaluate(() => { const G = __game; G.auth('hit', { r: G.round, d: 500, h: true, w: 'sniper', wb: 1 }); });
await waitPhase(B, 'roundEnd');
await sleep(400);
{
  const b = await B.evaluate(() => ({ sub: document.querySelector('#banner .sub').textContent, rep: document.getElementById('report').textContent, res: __game.gs.res }));
  ok('穿牆爆頭擊倒：結果和文字都有標示', b.res.wb === true && b.res.head === true && b.sub.includes('穿牆') && b.sub.includes('爆頭') && b.rep.includes('1 發命中'), `${b.sub} | ${b.rep}`);
  await sleep(1300);
  const k = await B.evaluate(() => ({ kc: __game.kc, name: document.getElementById('kc-name').textContent, hudKc: document.getElementById('hud').classList.contains('kc') }));
  await B.screenshot({ path: OUT + '/w3-killcam.png' });
  ok('被擊倒的人看到擊殺回放', k.kc && k.name.includes('阿強') && k.hudKc, JSON.stringify(k));
  await B.mouse.click(550, 340); await sleep(300);
  ok('點一下可以跳過回放', await B.evaluate(() => !__game.kc && document.getElementById('killcam').classList.contains('hidden')));
  const s = await A.evaluate(() => { const d = __game.stats.d.duel; return `${d.rounds}/${d.rwins}/${d.kills}/${d.hs}/${d.wb}`; });
  ok('連線對戰的戰績有記（1 局 1 勝 1 擊倒 1 爆頭 1 穿牆）', s === '1/1/1/1/1', s);
}

// ── 語音（要真的 PeerJS 連線）──
if (PEER) {
  await A.evaluate(() => __game.setSetting('voice', 'open'));
  await sleep(3500);
  const b = await B.evaluate(() => { const v = __game.voice, s = v.audio.srcObject; return { inc: !!v.inc, tracks: s ? s.getAudioTracks().length : 0, live: s && s.getAudioTracks()[0] ? s.getAudioTracks()[0].readyState : '' }; });
  const a = await A.evaluate(() => ({ tx: __game.voice.tx, stream: !!__game.voice.stream, out: !!__game.voice.out, bar: !document.getElementById('v-tx').classList.contains('hidden') }));
  ok('語音：A 開麥克風，B 收得到聲音串流', a.tx && a.stream && a.out && a.bar && b.inc && b.tracks === 1 && b.live === 'live', JSON.stringify({ a, b }));
  await B.evaluate(() => __game.setSetting('voice', 'ptt'));
  await sleep(2500);
  const p0 = await B.evaluate(() => ({ tx: __game.voice.tx, en: __game.voice.stream && __game.voice.stream.getAudioTracks()[0].enabled }));
  await waitPhase(B, 'loadout', 15000); await waitPhase(A, 'loadout', 15000);
  await sleep(300);
  await B.evaluate(() => { const c = __game.gs.p[1].ch; if (c) __game.pickBuff(c[0]); });
  await sleep(300);
  await A.click('#btn-ready'); await B.click('#btn-ready');
  await waitPhase(B, 'playing'); await sleep(600);
  await B.evaluate(() => { __game.keys[__game.binds.talk] = true; }); await sleep(400);
  const p1 = await B.evaluate(() => ({ tx: __game.voice.tx, en: __game.voice.stream.getAudioTracks()[0].enabled }));
  await B.evaluate(() => { __game.keys[__game.binds.talk] = false; }); await sleep(400);
  const p2 = await B.evaluate(() => __game.voice.tx);
  const ainc = await A.evaluate(() => { const s = __game.voice.audio.srcObject; return !!__game.voice.inc && !!s && s.getAudioTracks().length === 1; });
  ok('語音：按住說話鍵才會送出聲音', p0.tx === false && p0.en === false && p1.tx === true && p1.en === true && p2 === false && ainc, JSON.stringify({ p0, p1, p2, ainc }));
  await A.evaluate(() => __game.setSetting('voice', 'off')); await sleep(300);
  ok('語音：關掉之後麥克風真的放開', await A.evaluate(() => !__game.voice.stream && !__game.voice.tx));
  await A.evaluate(() => localStorage.removeItem('rubble.voice')); await B.evaluate(() => localStorage.removeItem('rubble.voice'));
}

console.log('ERRORS:\n' + (errs.length ? [...new Set(errs)].slice(0, 12).join('\n') : '(none)'));
await browser.close();
process.exit(fails || errs.length ? 1 : 0);
