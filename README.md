# AI-Agent-Office-For-Aranter
# by Oktovaaaaa


# Project ini dibuat untuk mengetahu isi dari proses agent ai aranter
## Panduan menggunakan office aranter

**Live demo:** https://oktovaaaaa.github.io/AI-Agent-Office-For-Aranter/

---

## Aranter — Agent Office

Kantor 3D (Three.js) tempat "karyawan" Aranter bekerja. Setiap karakter mewakili satu tahap pipeline di bot
[Agent-AI-For-Trade](https://github.com/oktovaaaaa/Agent-AI-For-Trade), dan aktivitasnya diputar dari data scan asli
`history.json` milik aranter.web.id.

## Arsitektur: repo terpisah, data lewat HTTP

```
Repo Agent-AI-For-Trade (server/bot)          Repo Agent-AI-Office (kantor 3D, repo ini)
┌───────────────────────────────┐             ┌──────────────────────────────────┐
│ GitHub Actions → bot_hunter.py │             │ index.html + js/ (statis)         │
│   └ simpan_database_json()     │  HTTPS GET  │   js/config.js → DATA_URLS        │
│ docs/data/history.json ────────┼────────────►│   replay scan → animasi agen      │
│ (GitHub Pages: aranter.web.id) │  CORS: *    │ (deploy: GitHub Pages/Vercel/dll) │
└───────────────────────────────┘             └──────────────────────────────────┘
```

Kedua repo tidak perlu digabung. Kantor ini hanya **membaca** `https://aranter.web.id/data/history.json`
(header `Access-Control-Allow-Origin: *` dari GitHub Pages), dengan cadangan ke `raw.githubusercontent.com`.
Kalau dua sumber itu gagal, kantor otomatis memakai data demo.

## Agen & fungsi aslinya

| Agen | Fungsi di `bot_hunter.py` |
|---|---|
| Satpam Pasar | `check_bbca_market_status()`, `get_current_idx_session()` |
| Hunter | `get_hunter_stocks()` |
| Scanner #1–6 | `scan_stock_rallygood(page, stock_info, worker_id)` |
| Analis SMC / DonAlt / MACD / Scalp | `parse_real_smc_levels()`, `format_donalt_*`, `format_macd_*`, `format_scalping_*` |
| Manajer VVIP | `check_and_send_instant_alert()` (kategori 3 TF / 2 TF) |
| Kurir WhatsApp | `kirim_whatsapp()`, `kirim_pesan_summary_wa()` |
| Teknisi Server | `HardwareMonitor`, `bersihkan_screenshot()` |
| Arsiparis | `simpan_database_json()` |
| **Analis Riset AI** (baru) | chatbot → `server/analyst_bridge.py` → Antigravity CLI |

Logika sinyal (Golden Cross, SMC Breakout, Scalp BUY) disalin dari `docs/app.js` supaya hasilnya sama dengan dashboard.

## Menjalankan lokal

```bash
python -m http.server 8080
# buka http://localhost:8080
```
Atau cukup klik dua kali **`start-office.bat`**. ES module tidak bisa dibuka langsung lewat `file://` (klik dua kali `index.html`), jadi perlu server lokal.

## Model 3D dari Blender

Gaya kantor: open-plan modern minimalis (karpet bergaris, kubikel putih + meja oak, planter kayu, kursi mesh hitam,
dinding kaca dengan pemandangan kota, lampu linear, panel oak + kaca buram, dinding logo ARANTER). Tekstur karpet dan kayu
dibuat prosedural ke `blender/tex/`. Kantor dan semua karakter dibuat lewat script Python Blender (pola yang sama dengan proyek 3dbatak):

| Script | Hasil | Isi |
|---|---|---|
| `blender/build_office.py` | `assets/office.glb`, `blender/office.blend` | gedung, furnitur, zona, anchor |
| `blender/build_agents.py` | `assets/agents.glb`, `blender/agents.blend` | 17 karakter dengan pivot kaki/lengan/kepala |
| `blender/common.py` | — | helper (koordinat web↔Blender, material, primitif ber-bevel) |

Build ulang: klik dua kali **`build-blender.bat`** (butuh Blender 5.3 di `C:\Program Files\Blender Foundation\Blender 5.3`).

**Web mengikuti Blender.** Posisi agen, layar, papan, dan titik animasi dibaca dari objek bernama di `office.glb`:
`AGENT_HOME_<id>` (posisi + `face`), `SCREEN_<nama>` (layar canvas: `w`, `h`, `yaw`), `POINT_<nama>`, `LABEL_<n>`,
`CABINET_<nn>`, `LED_<nn>`. Geser meja di script (atau di `office.blend`, lalu export glTF dengan *Include → Custom Properties*),
maka agen dan layar ikut pindah tanpa mengubah JavaScript. Karakter dianimasikan prosedural di web lewat pivot
`<id>_legL/_legR/_armL/_armR/_head` (tanpa rig/armature).

## Chatbot "Analis Riset AI" + Antigravity CLI

```
chat di kantor 3D ──POST /api/analyze {symbol, question}──► server/analyst_bridge.py (port 8787)
   │  langsung: dot green, TF, gain, SMC dari history.json     ├─ data teknikal: history.json (diambil server sendiri)
   │                                                           ├─ nama emiten: TradingView (PADA → Personel Alih Daya)
   ◄──────────── JSON {sentiment, summary, good_news,          ├─ berita 30 hari: Google News RSS (difilter nama/kode)
                  bad_news, risks, news[]} ──────────────────── └─ ANALYST_CMD = CLI Antigravity kamu (prompt via STDIN)
```

1. Jalankan bridge: `server/start-analyst.bat` (atau `python server/analyst_bridge.py`). Hanya butuh library standar Python.
2. Tanpa CLI pun sudah jalan (mode **heuristik**: berita + penilaian kata kunci). Untuk analisa AI, isi `ANALYST_CMD`.

**Antigravity CLI (`agy`) sudah didukung langsung.** `server/start-analyst.bat` memakai:
`["agy","-p","{prompt}","--output-format","json","--print-timeout","200s"]`. Bridge membaca amplop JSON `agy`
(`status`, `response`, `structured_output`) dan mencari `agy.exe` di `%LOCALAPPDATA%/agy/bin` kalau belum ada di PATH.
- Install: `irm https://antigravity.google/cli/install.ps1 | iex` (PowerShell), lalu login sekali dengan menjalankan `agy` interaktif.
- CLI dijalankan di folder kosong `server/agy_workspace/`, dan prompt melarang pemakaian tool. Jangan pakai `--dangerously-skip-permissions`.
- Waktu analisa sekitar 25–90 detik per saham (±20 ribu token). Hasil di-cache 10 menit per pertanyaan.

**Kontrak CLI umum** (kalau memakai CLI lain):
- Input: prompt lengkap lewat **STDIN** (template: `server/prompt_template.md`, berisi data teknikal + daftar berita).
  Kalau CLI-mu menerima prompt sebagai argumen, tulis `{prompt}` di argumennya, mis. `["mycli","-p","{prompt}"]`.
- Output: JSON di **STDOUT**: `{"sentiment","summary","technical_view","good_news":[],"bad_news":[],"risks":[]}`.
  Teks log sebelum JSON atau blok ```json tetap bisa dibaca bridge.
- Exit code ≠ 0 atau timeout (`ANALYST_TIMEOUT`, default 240 detik) → bridge memakai heuristik dan memberi peringatan.

**Pertanyaan bebas (harus seputar saham).** Alur chat di web (`js/chat.js`):
1. Menyebut **satu kode saham** (mis. "analisa PADA, ada good news?") → kartu data instan + `POST /api/analyze` (berita + sentimen, effort `medium`).
2. **Pertanyaan pendek berpola jelas** ("berapa saham di screener", "selain yang vvip", "radar", "golden cross", "top gain") → dijawab instan dari history.json.
3. **Selebihnya** ("bandingkan PADA dan BUMI", "radar mana yang tinggal butuh 1D?", pertanyaan lanjutan) → `POST /api/chat`.
   Server mengirim ringkasan seluruh scan terakhir, rekap 30 hari, detail saham yang disebut, dan 6 pesan terakhir
   ke AI (`server/chat_template.md`, effort `low`, sekitar 10–20 detik). Pertanyaan di luar topik saham ditolak sopan (`off_topic`).

UI tidak menampilkan nama mesin AI; status chat hanya "online / offline".
Kode saham yang juga kata umum (PADA = "pada") hanya dikenali kalau ditulis HURUF BESAR di chat.

**Produksi:** jalankan bridge di VPS (di belakang HTTPS, mis. `https://api.aranter.web.id`), set
`ALLOWED_ORIGINS` ke domain kantor, lalu isi `CHAT_API_URL` di `js/config.js`. Ada rate limit per IP dan cache 10 menit per saham.
⚠️ Pertanyaan datang dari pengunjung publik. Jalankan CLI tanpa auto-approve tool, dan jangan beri akses ke secret
(token Fonnte, session TradingView).

## Mode kamera: jadi karakter di kantor

Pengaturan (⚙) → **Kamera**: **Drone** (orbit bebas + preset Isometrik/Atas/Depan/Scanner/Lounge VVIP/Analis/Riset AI),
**Jalan** (orang ke-3), **Mata** (orang pertama). Tombol **V** berganti mode.
- Jalan: **WASD/panah**, ketuk **W W** lalu tahan (atau **Shift**) untuk lari, **Spasi** lompat, **drag** putar kamera, **scroll** zoom. Layar sentuh: joystick kiri bawah.
- Tabrakan memakai `assets/navgrid.json` (sel 0,25 m) yang dibuat `blender/build_office.py` lewat ray-cast,
  jadi pemain tidak menembus meja, kaca, atau rak, dan kamera orang ke-3 tidak menembus dinding.
- Saat mode Jalan/Mata dan chat dibuka, **Analis Riset AI** berjalan menghampiri (jalur A* mengitari furnitur), berdiri
  di samping pemain, dan menyusul bila pemain pindah. Chat ditutup → ia kembali ke mejanya.

## Kontrol
- Klik **agen** untuk melihat peran, fungsi kode, dan aktivitasnya
- Klik **monitor** scanner untuk melihat detail saham yang sedang/selesai di-scan
- Klik **papan VVIP** / **whiteboard analis** untuk melihat daftar saham
- Klik **kabinet arsip** untuk memutar ulang scan tanggal itu
- Klik **Analis Riset AI** (atau tombol 💬 Tanya Analis) untuk chat: "analisa PADA", "berita BUMI good news?", "VVIP hari ini"
- Kecepatan 1x / 3x / 10x, jeda, putar ulang, dan toggle nama agen

## LIVE: kantor bergerak realtime saat bot berjalan

```
bot_hunter.py (GitHub Actions)  --POST /api/live/push (X-Live-Token)-->  server/analyst_bridge.py  <--GET /api/live?since=N (2,5 dtk)--  kantor 3D
```
Repo bot memancarkan kejadian lewat `live_feed.py` (8 titik di `bot_hunter.py`): `session` (cek BBCA/sesi), `cycle_start`
(hasil screener), `stock` (1 saham selesai di Worker N, format sama dengan history.json), `alert` (WA terkirim),
`cycle_done`, `saved`. Kantor otomatis pindah ke mode **● LIVE** selama ada kejadian dalam 8 menit terakhir, lalu kembali ke replay.
Memilih tanggal/kabinet = keluar dari LIVE; klik badge LIVE untuk kembali.

- Token: dibuat otomatis oleh `server/start-analyst.bat` di `server/.live_token` (jangan di-commit).
- Bot: isi GitHub Secrets repo bot `LIVE_PUSH_URL` (mis. `https://live.aranter.web.id/api/live/push`) dan `LIVE_TOKEN`.
  Tanpa kedua secret itu, live feed mati total dan bot berjalan seperti biasa. Pengiriman tidak pernah memperlambat atau menggagalkan bot.
- Runner GitHub Actions ada di internet, jadi bridge harus punya **URL publik** (VPS atau Cloudflare Tunnel), bukan `localhost`.
- Coba tanpa bot: `python server/live_demo.py --speed 2` memutar scan terakhir sebagai kejadian live.

## Deploy
Repo ini 100% statis. Push ke GitHub → Settings → Pages → branch `main`, folder root.
Kalau mau, bisa dipasang di subdomain, misalnya `office.aranter.web.id`, lewat file `CNAME`.
