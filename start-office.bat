@echo off
REM Menjalankan Aranter Agent Office: server analis AI (port 8787) + web kantor 3D (port 8080)
cd /d "%~dp0"
set PORT=8080

REM 1) Server analis (chat AI). Dibuka di jendela sendiri kalau belum berjalan.
curl -s -m 2 http://localhost:8787/api/health >nul 2>&1
if errorlevel 1 (
  echo Menyalakan server analis AI di jendela baru...
  start "Aranter Analyst Bridge" /min cmd /c "server\start-analyst.bat"
) else (
  echo Server analis AI sudah berjalan.
)

REM 2) Web kantor 3D
echo Membuka Aranter di http://localhost:%PORT%  (tutup jendela ini untuk berhenti)
start "" "http://localhost:%PORT%/index.html"
python -m http.server %PORT%
if errorlevel 1 (
  echo.
  echo Python tidak ditemukan / port %PORT% terpakai. Coba: npx serve -l %PORT%
  pause
)
