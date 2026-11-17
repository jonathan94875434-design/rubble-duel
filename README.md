# RUBBLE 1v1

瀏覽器裡的雙人單挑 FPS：競技場對決、地形可以打爛、每局重置、自選槍枝、輸家拿強化補償、搶分制。
純靜態網頁（Three.js + PeerJS），沒有建置步驟，也不需要自己的伺服器。

## 怎麼玩

- 自己試：雙擊 `start.command`，瀏覽器會打開 `http://localhost:8765/`，按「單人練習」。
- 跟朋友玩：兩個人都要能打開同一個網址（要放到網路上）。一人按「建立房間」→「複製邀請連結」傳給對方，對方打開後按「加入房間」。
- 同一台電腦測雙人：網址加 `?local=1`，開兩個視窗。

操作：WASD 移動、空白鍵跳、左鍵開火、右鍵瞄準、R 換彈、1/2/Q/滾輪切槍、Esc 設定。

## 想調整時改哪裡

| 想改的東西 | 檔案 |
| --- | --- |
| 移動手感、回合時間、獲勝分數預設值 | `js/config.js` |
| 槍枝數值、加新槍 | `js/weapons.js` |
| 輸家強化 | `js/buffs.js`（效果實作在 `authority.js`、`combat.js`） |
| 地圖、出生點、補給品 | `js/maps.js` |
| 方塊種類與耐久 | `js/world.js` 的 `BLOCK` |

## 架構

- `main.js` 主迴圈、輸入、畫面狀態機
- `world.js` 體素世界（破壞、區塊網格、射線、碰撞）；`maps.js` 地圖
- `player.js` 移動物理；`combat.js` 開槍與拋射物；`remote.js` 對手模型與插值
- `net.js` 連線（WebRTC／同機／電腦對手三種通道）
- `authority.js` 裁判，只在房主端執行：血量、回合、分數、強化、補給品
- `bot.js` 練習對手；`hud.js` 介面；`fx.js` 特效；`audio.js` 合成音效

連線模型：房主管回合與血量；命中由開槍方判定（打到就算，不會有「明明打到卻沒中」）；
方塊傷害雙向同步，每局開始兩邊各自重建同一張地圖。

## 測試

```
cd tests && npm install
npm run practice    # 物理、每把槍、補給品、電腦對手
npm run duel        # 雙人完整流程（同機通道）
npm run duel:peer   # 同上，走真的 WebRTC
```
需要先啟動本機伺服器（`start.command`）。
