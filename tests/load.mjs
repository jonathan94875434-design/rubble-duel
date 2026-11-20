// 測試共用：Chrome 在哪裡、載入頁面並等到遊戲真的啟動（window.__game 出現）。
import { existsSync } from 'node:fs';

// Chrome 的位置：環境變數 CHROME 優先，否則依作業系統找預設安裝位置（Mac／Windows／Linux）。
const CHROMES = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};
const found = (CHROMES[process.platform] || []).find((f) => existsSync(f));
export const CHROME = process.env.CHROME || found || (CHROMES[process.platform] || CHROMES.darwin)[0];
// 用真的顯示卡算畫面（GPU=1 的截圖工具）時要用的繪圖後端
export const ANGLE = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d11' : 'gl';

// 新版開機要先算材質，所以不能只等固定的時間；本機伺服器偶爾斷線時也會自動重試。
export async function load(page, url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    await page.goto(url, { waitUntil: 'load' }).catch(() => {});
    if (await page.waitForFunction('window.__game', { timeout: 20000 }).then(() => true, () => false)) return;
  }
  throw new Error('遊戲沒有啟動：' + url);
}
export async function reload(page) {
  for (let i = 0; i < 5; i++) {
    await page.reload({ waitUntil: 'load' }).catch(() => {});
    if (await page.waitForFunction('window.__game', { timeout: 20000 }).then(() => true, () => false)) return;
  }
  throw new Error('重新整理後遊戲沒有啟動');
}
