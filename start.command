#!/bin/sh
# 雙擊這個檔案：在本機開一個小網頁伺服器並打開遊戲。
cd "$(dirname "$0")" || exit 1
PORT=8765
if ! lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  python3 -m http.server $PORT >/dev/null 2>&1 &
  sleep 1
fi
open "http://localhost:$PORT/"
