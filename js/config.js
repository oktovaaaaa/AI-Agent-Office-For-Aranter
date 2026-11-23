// Konfigurasi koneksi kantor 3D ke "server" Aranter (repo Agent-AI-For-Trade).
// Repo ini TIDAK perlu satu repo dengan bot: data dibaca lewat HTTP (CORS aranter.web.id = "*").
export const CONFIG = {
  // Dicoba berurutan. Yang pertama berhasil akan dipakai.
  DATA_URLS: [
    'https://aranter.web.id/data/history.json',
    'https://raw.githubusercontent.com/oktovaaaaa/Agent-AI-For-Trade/main/docs/data/history.json',
    './data/history.json', // salinan lokal (opsional) untuk development offline
  ],

  // Bridge publik di VPS (server/deploy), mis. 'https://live.aranter.web.id'. Bot mengirim kejadian live ke sini.
  PUBLIC_API_BASE: 'https://tati-glory.tail10defd.ts.net:8443',

  // LIVE: kejadian realtime dari bot. null = PUBLIC_API_BASE + '/api/live' kalau diisi,
  // selain itu bridge lokal yang sama dengan CHAT_API_URL.
  LIVE_API_URL: null,

  // Chatbot "Analis Riset AI": endpoint server/analyst_bridge.py (yang memanggil analis AI).
  // Saat dibuka di localhost otomatis ke bridge lokal. Untuk produksi isi URL VPS, mis.
  // 'https://api.aranter.web.id/api/analyze'. null = chat hanya memakai data history.json.
  CHAT_API_URL: ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:8787/api/analyze' : null,
  // (di domain publik, chat memakai PUBLIC_API_BASE kalau CHAT_API_URL null — lihat main.js / chat.js)
  CHAT_TIMEOUT_MS: 240000,

  SCANNER_WORKERS: 6,      // jumlah meja scanner (maks. 6 = jumlah meja di office.glb)
  BASE_SCAN_SECONDS: 1.1,  // durasi animasi scan 1 saham pada kecepatan 1x
};
if (!CONFIG.CHAT_API_URL && CONFIG.PUBLIC_API_BASE) CONFIG.CHAT_API_URL = CONFIG.PUBLIC_API_BASE.replace(/\/$/, '') + '/api/analyze';
