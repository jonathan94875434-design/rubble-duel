@echo off
rem Windows: double-click to start a local web server and open the game.
rem (Mac: use start.command)
cd /d "%~dp0"
start "" "http://localhost:8765/"
where py >nul 2>nul
if %errorlevel%==0 (py -3 -m http.server 8765) else (python -m http.server 8765)
