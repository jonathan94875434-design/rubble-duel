// 測試共用：載入頁面並等到遊戲真的啟動（window.__game 出現）。
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
