import { CONFIG } from './config.js';

// ---------- Loader ----------
async function fetchJson(url, onProgress) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.json();
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress && onProgress(Math.min(1, got / total));
  }
  const buf = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return JSON.parse(new TextDecoder('utf-8').decode(buf));
}

export async function loadHistory(onProgress) {
  const errors = [];
  for (const url of CONFIG.DATA_URLS) {
    try {
      const sep = url.includes('?') ? '&' : '?';
      const json = await fetchJson(url + sep + 'v=' + Date.now(), onProgress);
      if (json && json.daily_scans && Object.keys(json.daily_scans).length) return { json, source: url };
      errors.push(url + ': format tidak dikenal / kosong');
    } catch (e) {
      errors.push(url + ': ' + e.message);
    }
  }
  console.warn('[Aranter HQ] Semua sumber data gagal, memakai data demo.', errors);
  return { json: makeDemoHistory(), source: 'demo', errors };
}

// ---------- Helper sinyal (disamakan dengan docs/app.js di repo bot) ----------
export function tfKeys(s) {
  const tf = s?.timeframes || {};
  return ['D', '60', tf['45'] ? '45' : '15'];
}

export function tfLabel(k) {
  return { D: '1D', '60': '1H', '45': '45M', '15': '15M' }[k] || k;
}

export function signalsOf(s) {
  const tf = s?.timeframes || {};
  const any = (f) => tfKeys(s).some((k) => tf[k] && f(tf[k]));
  return {
    dots: s?.count_green || 0,
    golden: any((t) => t.donalt?.golden),
    smc: any((t) => {
      const st = t.smc?.status_7d || '';
      return st.includes('BREAKOUT') || st.includes('BOS') || st.includes('CHoCH') ||
        (st.includes('Supply') && !st.includes('Di Antara Demand & Supply'));
    }),
    scalp: any((t) => {
      const sc = t.scalping;
      if (!sc) return false;
      const tr = sc.trend || '';
      return tr.includes('BUY') || tr.includes('Green') || (sc.buy != null && !sc.buy.reversed);
    }),
    macd: any((t) => t.macd?.bull),
  };
}

export function gainOf(s) {
  const g = s?.timeframes?.D?.gain_pct;
  return typeof g === 'number' ? g : (typeof s?.change === 'number' ? s.change : 0);
}

export function fmtPct(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '-';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

export function fmtNum(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '-';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + ' M';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + ' jt';
  return v.toLocaleString('id-ID');
}

// ---------- Data demo (kalau offline) ----------
function makeDemoHistory() {
  const codes = ['GOTO', 'BUMI', 'ADRO', 'ANTM', 'BRMS', 'DEWA', 'ELSA', 'ENRG', 'KIJA', 'MEDC', 'PTPP', 'SRTG',
    'WIKA', 'TINS', 'INKP', 'BRPT', 'ACES', 'ERAA', 'MNCN', 'SCMA', 'BSDE', 'PWON', 'CTRA', 'LPKR', 'ATLA',
    'BULL', 'HUMI', 'NICL', 'RAJA', 'WIFI', 'PANI', 'CUAN', 'DOID', 'ESSA', 'HRUM', 'INDY'];
  const daily = {};
  const today = new Date();
  for (let d = 4; d >= 0; d--) {
    const dt = new Date(today.getTime() - d * 86400000);
    const key = dt.toISOString().slice(0, 10);
    const stocks = codes.map((c) => {
      const dots = Math.floor(Math.random() * 4);
      const tf = (on) => ({
        status: on, date: '-', dot_close: 100, gain_pct: (Math.random() * 30) - 5,
        donalt: { golden: Math.random() < 0.15 ? { date: '-' } : null, death: null },
        scalping: { buy: null, sell: null, trend: Math.random() < 0.3 ? 'BUY (Green)' : 'SELL (Red)' },
        smc: { status_7d: Math.random() < 0.15 ? 'BREAKOUT SUPPLY (demo)' : 'Di Antara Demand & Supply' },
        macd: { bull: Math.random() < 0.2 ? { date: '-' } : null, bear: null },
      });
      return {
        symbol: c, name: c, close: Math.round(50 + Math.random() * 900), change: (Math.random() * 20) - 5,
        volume: Math.random() * 5e9, count_green: dots, has_green_dot: dots > 0,
        timeframes: { D: tf(dots >= 1), '60': tf(dots >= 2), '45': tf(dots >= 3) },
      };
    });
    daily[key] = {
      date: key,
      date_display: dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
      time_display: '16:05 WIB', session: 'DEMO', session_label: 'Data Demo (offline)',
      summary: { total_screener: stocks.length },
      stocks,
    };
  }
  return { last_updated: 'demo', daily_scans: daily, vip_3dot_history: [] };
}
