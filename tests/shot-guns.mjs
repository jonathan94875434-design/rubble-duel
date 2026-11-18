// 槍枝模型與第一人稱持槍的截圖（看畫面用）：
//   node shot-guns.mjs            全部拍一輪 → shots/g-*.png（模型格子）、shots/v-*.png（第一人稱）
//   node shot-guns.mjs grid       只拍模型格子        node shot-guns.mjs view   只拍第一人稱
//   node shot-guns.mjs one <檔名> <網址（dev/ 之後的部分）>   只拍一張，例：one t "viewmodel.html?w=ar&reload=0.4"
//   node shot-guns.mjs boot       只檢查遊戲本體開得起來、沒有錯誤
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const [mode = 'all', a1, a2] = process.argv.slice(2);
mkdirSync('shots', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || 'http://localhost:8765/').replace(/\/?$/, '/');
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1280,760', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 760 }, protocolTimeout: 120000 });
const errs = [];
const page = await browser.newPage();
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !(m.location().url || '').includes('favicon')) errs.push(`[${m.type()}] ${m.text().slice(0, 500)}`); });
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));

async function shot(name, url) {
  const n0 = errs.length;
  for (let i = 0; i < 4; i++) {   // 其他測試同時在跑的時候本機伺服器偶爾會斷線 → 重試
    await page.goto(BASE + 'dev/' + url, { waitUntil: 'load' }).catch(() => {});
    if (await page.waitForFunction('window.__ready', { timeout: 20000 }).then(() => true, () => false)) break;
  }
  await sleep(150);
  await page.screenshot({ path: `shots/${name}.png` });
  console.log(`${errs.length > n0 ? 'ERR ' : 'ok  '} shots/${name}.png  ← ${url}`);
}

if (mode === 'one') await shot(a1 || 'one', a2 || 'guns.html');

if (mode === 'all' || mode === 'grid') {
  await shot('g-grid-stock', 'guns.html');
  await shot('g-grid-neon', 'guns.html?wskin=neon');
  await shot('g-grid-gold', 'guns.html?wskin=gold');
  await shot('g-grid-left', 'guns.html?view=left');
  await shot('g-grid-open', 'guns.html?open=1&view=left');
  for (const w of ['sand', 'snow', 'carbon', 'crimson', 'toxic']) await shot('g-ar-' + w, `guns.html?only=ar&wskin=${w}`);
}

if (mode === 'all' || mode === 'view') {
  const V = (name, q) => shot('v-' + name, 'viewmodel.html?' + q);
  for (const w of ['ar', 'smg', 'shotgun', 'dmr', 'sniper', 'lmg', 'rocket', 'gl', 'pistol', 'revolver', 'mp', 'knife']) await V(`${w}-hip`, `w=${w}`);
  for (const w of ['ar', 'pistol', 'sniper', 'shotgun', 'dmr', 'revolver', 'rocket']) await V(`${w}-ads`, `w=${w}&ads=1`);
  for (const w of ['ar', 'shotgun', 'revolver', 'rocket', 'pistol', 'sniper', 'gl', 'lmg']) for (const r of [0.25, 0.5, 0.85]) await V(`${w}-reload-${r * 100}`, `w=${w}&reload=${r}`);
  await V('ar-fire', 'w=ar&fire=0.02');
  await V('shotgun-pump', 'w=shotgun&fire=0.32');
  await V('sniper-bolt', 'w=sniper&fire=0.6');
  await V('pistol-fire', 'w=pistol&fire=0.03');
  await V('ar-draw', 'w=ar&draw=0.5');
  await V('knife-slash', 'w=knife&melee=0.14');
  await V('knife-stab', 'w=knife&melee=0.3&heavy=1');
  await V('ar-throw-1', 'w=ar&throw=0.12&nade=he');
  await V('ar-throw-2', 'w=ar&throw=0.24&nade=molotov');
  await V('ar-neon', 'w=ar&wskin=neon&skin=neon');
  await V('pistol-gold', 'w=pistol&wskin=gold&skin=gold');
  await V('ar-shade', 'w=ar&lit=0');
}

if (mode === 'all' || mode === 'boot') {
  // 遊戲本體：開得起來、進練習模式打幾槍換個彈，不能有錯誤
  const n0 = errs.length;
  await page.goto(BASE + '?nolock=1', { waitUntil: 'load' });
  const ok = await page.waitForFunction('window.__game', { timeout: 20000 }).then(() => true, () => false);
  await sleep(800);
  const r = !ok ? 'no __game' : await page.evaluate(async () => {
    const g = window.__game, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      const b = document.querySelector('#btn-bot'); if (b) b.click(); await sleep(900);
      const rd = document.querySelector('#btn-ready'); if (rd) rd.click(); await sleep(1800);
      if (g.bot) g.bot.fire = () => {};
      const v = g.view; let n = 0;
      for (const id of ['ar', 'smg', 'shotgun', 'dmr', 'sniper', 'lmg', 'rocket', 'gl', 'pistol', 'revolver', 'mp', 'knife']) { v.setWeapon(id, 'stock'); v.fire(false); v.update(0.016, {}); n++; }
      v.setWeapon('ar', g.settings ? g.settings.wskin : 'stock');
      return { phase: g.phase, guns: n };
    } catch (e) { return 'EVAL ' + e.message + '\n' + e.stack; }
  });
  await sleep(600);
  await page.screenshot({ path: 'shots/v-game-boot.png' });
  console.log(`${errs.length > n0 ? 'ERR ' : 'ok  '} game boot`, JSON.stringify(r));
}

if (errs.length) console.log('\nERRORS:\n' + [...new Set(errs)].slice(0, 20).join('\n'));
await browser.close();
process.exit(errs.length ? 1 : 0);
