@echo off
REM Server "Analis Riset AI" + live feed bot untuk kantor 3D Aranter (port 8787)
cd /d "%~dp0"
title Aranter Analyst Bridge

REM Antigravity CLI (agy) mode headless. Prompt dikirim lewat {prompt}, keluaran JSON.
REM Login sekali dulu secara interaktif: jalankan "agy" di terminal biasa.
REM Kosongkan ANALYST_CMD (set ANALYST_CMD=) untuk mode heuristik tanpa AI.
REM {effort}: chat bebas = low (cepat), riset 1 saham = medium (lebih teliti). Atur lewat CHAT_EFFORT / ANALYZE_EFFORT.
set ANALYST_CMD=["agy","-p","{prompt}","--output-format","json","--print-timeout","200s","--effort","{effort}"]
set ANALYST_TIMEOUT=240
set ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080,https://aranter.web.id

REM Token rahasia live feed (dari bot ke kantor). Dibuat sekali, disimpan di server\.live_token (jangan di-commit).
REM Isi nilai yang SAMA di GitHub repo bot: Settings / Secrets / Actions / LIVE_TOKEN.
if not exist .live_token python -c "import secrets;print(secrets.token_urlsafe(24))" > .live_token
set /p LIVE_TOKEN=<.live_token

set PORT=8787
python analyst_bridge.py
pause
