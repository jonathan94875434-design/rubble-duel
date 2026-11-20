// 截圖小工具（看畫面用，不是測試）：
//   node shot.mjs <檔名> [畫質 low|medium|high|min] [要在頁面裡執行的 JS] [等幾毫秒]
// 例：node shot.mjs plaza high "__game.setMap('plaza')" 1500
// 環境變數 GPU=1 → 用真的顯示卡算（比較快，畫面也跟玩家看到的一樣）
import puppeteer from 'puppeteer-core';
import { CHROME, ANGLE } from './load.mjs';
import { mkdirSync } from 'node:fs';
const [name = 'shot', quality = 'high', js = '', wait = '1500'] = process.argv.slice(2);
mkdirSync('shots', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || 'http://localhost:8765/').replace(/\/?$/, '/');
const W = +(process.env.W || 1280), H = +(process.env.H || 720);
const args = [`--window-size=${W},${H}`, '--ignore-gpu-blocklist', ...(process.env.GPU ? ['--use-angle=' + ANGLE, '--enable-gpu'] : ['--enable-unsafe-swiftshader'])];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args, defaultViewport: { width: W, height: H }, protocolTimeout: 120000 });
const page = await browser.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 600)); });
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
await page.evaluateOnNewDocument((q) => { localStorage.setItem('rubble.quality', JSON.stringify(q)); }, quality);
// 其他測試同時在跑的時候，本機伺服器偶爾會斷線 → 載入失敗就重試
let loaded = false;
for (let i = 0; i < 5 && !loaded; i++) {
  errs.length = 0;
  await page.goto(BASE + '?nolock=1' + (process.env.Q || ''), { waitUntil: 'load' }).catch(() => {});
  loaded = await page.waitForFunction('window.__game', { timeout: 12000 }).then(() => true, () => false);
}
if (!loaded) { console.log('頁面沒有載入成功\n' + errs.join('\n')); process.exit(1); }
await sleep(600);
if (js) { const r = await page.evaluate(`(async () => { ${js} })()`).catch((e) => 'EVAL ERROR: ' + e.message); if (r !== undefined) console.log('result:', JSON.stringify(r)); }
await sleep(+wait);
const info = await page.evaluate(() => ({ gpu: __game.gpu, q: __game.qualityId, calls: __game.renderer.info.render.calls, tris: __game.renderer.info.render.triangles }));
console.log(JSON.stringify(info));
await page.screenshot({ path: `shots/${name}.png` });
if (errs.length) console.log('ERRORS:\n' + [...new Set(errs)].slice(0, 12).join('\n'));
await browser.close();
