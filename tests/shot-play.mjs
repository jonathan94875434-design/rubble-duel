// 截圖小工具（看畫面用）：進練習模式之後，照清單一張一張擺姿勢截圖。
//   node shot-play.mjs <前綴> <地圖> <清單 JSON>
// 清單的每一項：{ n: 檔名, js: 要執行的程式, wait: 等幾毫秒 }
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { load } from './load.mjs';
const [prefix = 'vm', map = 'plaza', listJson = '[]', quality = 'high'] = process.argv.slice(2);
mkdirSync('shots', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || 'http://localhost:8765/').replace(/\/?$/, '/');
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1280,720', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu', '--mute-audio'], defaultViewport: { width: 1280, height: 720 }, protocolTimeout: 120000 });
const page = await browser.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 500)); });
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
await page.evaluateOnNewDocument((q) => { localStorage.setItem('rubble.quality', JSON.stringify(q)); }, quality);
await load(page, BASE + '?nolock=1');
await page.evaluate((map) => { __game.settings.bot = 'dummy'; __game.settings.pmap = map; __game.practice(); }, map);
await page.waitForFunction(() => __game.phase === 'loadout', { timeout: 15000 });
await sleep(400);
await page.evaluate(() => __game.toggleReady());
await page.waitForFunction(() => __game.phase === 'playing', { timeout: 20000 });
await sleep(500);
for (const it of JSON.parse(listJson)) {
  if (it.js) { const r = await page.evaluate(`(async () => { ${it.js} })()`).catch((e) => 'EVAL ERROR: ' + e.message); if (r !== undefined) console.log(it.n, '→', JSON.stringify(r)); }
  await sleep(it.wait || 500);
  await page.screenshot({ path: `shots/${prefix}-${it.n}.png` });
}
if (errs.length) console.log('ERRORS:\n' + [...new Set(errs)].slice(0, 10).join('\n'));
await browser.close();
