# CLAUDE.md

瀏覽器裡的雙人單挑 FPS，純靜態網頁（Three.js + PeerJS），沒有建置步驟。

動手之前先讀 `README.md` 最後一節「交接：給協作者和他的 Claude」。裡面有目前的狀態、接下來要做的事、已經定案不能改回去的設計、連線模型和測試的坑。

最要緊的幾條：

- push 到 `main` 大約 30 秒後就上線（GitHub Pages），沒有測試環境。動手前先 `git pull --rebase`，push 前跑 `tests/` 裡跟改動有關的測試，不要 force push。
- repo 是公開的：真名、信箱、金鑰都不要寫進檔案或 commit。
- 介面文字、註解、commit 訊息用繁體中文。
- 不要加框架、打包工具或素材檔；圖片、模型、音效全部是程式產生的。
- 開放性的設計問題先問人，明確的修改直接做。
- 本機執行：Mac 用 `start.command`，Windows 用 `start.bat`（`http://localhost:8765/`）。測試：`cd tests && npm install && npm run features`，其他套件見 README 的「測試」。
