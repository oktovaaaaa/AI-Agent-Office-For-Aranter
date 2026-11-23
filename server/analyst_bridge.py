"""Aranter HQ — Analyst Bridge (server untuk agen "Analis Riset AI")

Alur:  browser (chat di kantor 3D)
         → POST /api/analyze {"symbol": "PADA", "question": "..."}
         → bridge ini: ambil data teknikal dari history.json + berita Google News RSS
         → jalankan CLI Antigravity kamu (ANALYST_CMD) dengan prompt dari prompt_template.md
         → balas JSON {sentiment, summary, good_news, bad_news, news[]}
Kalau ANALYST_CMD belum diisi, bridge tetap jalan dengan analisa sentimen heuristik (kata kunci).

Hanya library standar Python 3.9+. Jalankan:
  python server/analyst_bridge.py
Variabel lingkungan:
  PORT              (8787)
  ANALYST_CMD       perintah CLI. Bentuk JSON array paling aman di Windows, contoh:
                    ["C:/tools/antigravity-analis.exe", "--json"]
                    Prompt dikirim lewat STDIN. Kalau CLI-mu butuh prompt sebagai argumen,
                    tulis {prompt} di salah satu argumen: ["mycli", "-p", "{prompt}"]
  ANALYST_TIMEOUT   detik (240)
  ALLOWED_ORIGINS   daftar origin dipisah koma (default localhost:8080 + aranter.web.id)
  HISTORY_URL       sumber data teknikal (default https://aranter.web.id/data/history.json)
  RATE_PER_MIN      batas request per IP per menit (6)
  CACHE_MINUTES     cache jawaban per saham (10)

KEAMANAN: teks pertanyaan berasal dari pengunjung web. Kalau CLI Antigravity punya akses tool
(shell, file, browser), jalankan dalam mode tanpa auto-approve / sandbox, jangan beri akses ke
secret (token Fonnte, session TradingView, dll.).
"""
import json
import queue
import os
import re
import shlex
import shutil
import subprocess
import hmac
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8787"))
ANALYST_CMD = os.environ.get("ANALYST_CMD", "").strip()
ANALYST_TIMEOUT = int(os.environ.get("ANALYST_TIMEOUT", "240"))
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get(
    "ALLOWED_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080,https://aranter.web.id").split(",") if o.strip()]
HISTORY_URL = os.environ.get("HISTORY_URL", "https://aranter.web.id/data/history.json")
RATE_PER_MIN = int(os.environ.get("RATE_PER_MIN", "6"))
CACHE_MINUTES = int(os.environ.get("CACHE_MINUTES", "10"))
NEWS_DAYS = int(os.environ.get("NEWS_DAYS", "30"))
PROMPT_FILE = os.path.join(HERE, "prompt_template.md")
# Folder kerja KOSONG untuk CLI: agen tidak bisa membaca/menulis file proyek atau secret.
WORKDIR = os.environ.get("ANALYST_WORKDIR", os.path.join(HERE, "agy_workspace"))
UA = "Mozilla/5.0 (compatible; AranterHQ-Analyst/1.0)"
SYMBOL_RE = re.compile(r"^[A-Z]{4}$")

_cli_slots = threading.Semaphore(2)
_lock = threading.Lock()
_rate = {}
_cache = {}
_history = {"t": 0, "data": None}


LOG_FILE = os.path.join(HERE, "bridge.log")
_log_q = queue.Queue()


def _log_writer():
    """Thread terpisah: kalau jendela CMD dibekukan (QuickEdit/klik di jendela), server tetap jalan."""
    while True:
        line = _log_q.get()
        try:
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass
        try:
            print(line, flush=True)
        except Exception:  # noqa: BLE001  (mis. encoding console)
            pass


threading.Thread(target=_log_writer, daemon=True).start()


def log(*a):
    _log_q.put(" ".join([time.strftime("%H:%M:%S")] + [str(x) for x in a]))


# ----------------------------------------------------------------- data teknikal (dari server sendiri)
def get_history():
    with _lock:
        if _history["data"] and time.time() - _history["t"] < 600:
            return _history["data"]
    req = urllib.request.Request(HISTORY_URL + "?v=" + str(int(time.time())), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read().decode("utf-8"))
    with _lock:
        _history.update(t=time.time(), data=data)
    return data


def tf_keys(s):
    tf = s.get("timeframes") or {}
    return ["D", "60", "45" if "45" in tf else "15"]


TF_LABEL = {"D": "1D", "60": "1H", "45": "45M", "15": "15M"}


def technical_context(symbol):
    try:
        h = get_history()
    except Exception as e:  # noqa: BLE001
        return {"available": False, "error": f"history.json tidak bisa diambil: {e}"}
    scans = h.get("daily_scans") or {}
    days = sorted(scans)
    seen = [(d, next((s for s in scans[d].get("stocks", []) if s.get("symbol") == symbol), None)) for d in days]
    seen = [(d, s) for d, s in seen if s]
    if not seen:
        return {"available": False, "in_screener": False, "days_checked": len(days)}
    d, s = seen[-1]
    tfs = {}
    for k in tf_keys(s):
        t = (s.get("timeframes") or {}).get(k) or {}
        tfs[TF_LABEL.get(k, k)] = {
            "dot_green": bool(t.get("status")), "tanggal_dot": t.get("date"), "gain_sejak_dot_pct": t.get("gain_pct"),
            "smc_status_7d": (t.get("smc") or {}).get("status_7d"),
            "supply": (t.get("smc") or {}).get("supply"), "demand": (t.get("smc") or {}).get("demand"),
            "golden_cross": bool((t.get("donalt") or {}).get("golden")),
            "macd_bull": bool((t.get("macd") or {}).get("bull")),
            "scalping_trend": (t.get("scalping") or {}).get("trend"),
        }
    return {
        "available": True, "in_screener": True,
        "scan_terakhir": d, "sesi": scans[d].get("session_label"),
        "close": s.get("close"), "change_pct": s.get("change"), "volume": s.get("volume"),
        "jumlah_dot_green": s.get("count_green"), "timeframe": tfs,
        "muncul_di_screener_hari": len(seen), "hari_3_dot": sum(1 for _, x in seen if (x.get("count_green") or 0) >= 3),
        "pertama_muncul": seen[0][0],
    }


# ----------------------------------------------------------------- berita
POS = ["naik", "melonjak", "menguat", "laba", "untung", "dividen", "akuisisi", "ekspansi", "kontrak", "rekor", "tumbuh",
       "buyback", "kerja sama", "kerjasama", "investasi", "akumulasi", "borong", "positif", "melesat", "terbang", "ara",
       "cuan", "upgrade", "membaik", "pulih", "menang", "tender", "proyek baru", "right issue", "rights issue"]
NEG = ["turun", "anjlok", "melemah", "rugi", "merugi", "suspensi", "suspend", "gugatan", "pkpu", "pailit", "gagal bayar",
       "default", "arb", "denda", "sanksi", "delisting", "uma", "unusual market activity", "koreksi", "negatif", "ambles",
       "terjun", "tersangka", "korupsi", "fraud", "lepas saham", "jual saham", "downgrade", "utang jatuh tempo", "merosot"]


def score_text(text):
    t = " " + text.lower() + " "
    pos = sum(1 for w in POS if re.search(r"\b" + re.escape(w) + r"\b", t))
    neg = sum(1 for w in NEG if re.search(r"\b" + re.escape(w) + r"\b", t))
    return "positif" if pos > neg else "negatif" if neg > pos else "netral"


_names = {}


def company_info(symbol):
    """Nama emiten dari endpoint publik TradingView, mis. PADA -> 'Personel Alih Daya'."""
    if symbol in _names:
        return _names[symbol]
    info = {"name": None, "sector": None}
    try:
        url = f"https://scanner.tradingview.com/symbol?symbol=IDX:{symbol}&fields=description,sector&no_404=true"
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=15) as r:
            d = json.loads(r.read().decode("utf-8")) or {}
        name = (d.get("description") or "").strip()
        name = re.sub(r"^PT\.?\s+", "", name)
        name = re.sub(r"\s+(Tbk\.?|Persero)\b.*$", "", name, flags=re.I).strip()
        info = {"name": name or None, "sector": d.get("sector")}
    except Exception as e:  # noqa: BLE001
        log("company_info error", e)
    _names[symbol] = info
    return info


def fetch_news(symbol, limit=12):
    """Berita Google News. Kode saham seperti PADA juga kata umum ("pada"), jadi judul HANYA diterima
    kalau menyebut nama emiten atau kode saham dalam HURUF BESAR."""
    name = company_info(symbol).get("name")
    query = (f'"{name}" OR "saham {symbol}"' if name else f'"saham {symbol}"') + f" when:{NEWS_DAYS}d"
    url = "https://news.google.com/rss/search?q=" + urllib.parse.quote(query) + "&hl=id&gl=ID&ceid=ID:id"
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=20) as r:
        root = ET.fromstring(r.read())
    ticker_re = re.compile(r"(?<![A-Za-z])" + symbol + r"(?![A-Za-z])")
    cutoff = datetime.now(timezone.utc) - timedelta(days=NEWS_DAYS)
    items, seen = [], set()
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        src = (it.findtext("source") or "").strip()
        if src and title.endswith(" - " + src):
            title = title[: -len(src) - 3]
        if not (ticker_re.search(title) or (name and name.lower() in title.lower())):
            continue
        if title.lower() in seen:
            continue
        seen.add(title.lower())
        try:
            dt = parsedate_to_datetime(it.findtext("pubDate"))
        except Exception:  # noqa: BLE001
            dt = None
        if dt and dt < cutoff:
            continue
        items.append({"title": title, "link": it.findtext("link"), "source": src,
                      "date": dt.strftime("%Y-%m-%d") if dt else None, "sentiment": score_text(title)})
    items.sort(key=lambda x: x["date"] or "", reverse=True)
    return items[:limit]


def heuristic_answer(symbol, tech, news):
    pos = [n for n in news if n["sentiment"] == "positif"]
    neg = [n for n in news if n["sentiment"] == "negatif"]
    overall = "netral" if not news else "positif" if len(pos) > len(neg) else "negatif" if len(neg) > len(pos) else (
        "campuran" if pos else "netral")
    parts = []
    if tech.get("available"):
        parts.append(f"{symbol} punya {tech.get('jumlah_dot_green')}/3 dot green di scan {tech.get('scan_terakhir')}"
                     f" dan muncul {tech.get('muncul_di_screener_hari')} hari di screener.")
    else:
        parts.append(f"{symbol} tidak muncul di screener Aranter selama periode data.")
    nm = (tech.get("emiten") or {}).get("name")
    if nm:
        parts.insert(0, f"{symbol} = {nm}.")
    parts.append(f"Dari {len(news)} judul berita {NEWS_DAYS} hari terakhir: {len(pos)} bernada positif, {len(neg)} negatif "
                 f"(penilaian cepat berdasarkan kata kunci judul).")
    return {
        "engine": "heuristik", "sentiment": overall, "summary": " ".join(parts),
        "good_news": [n["title"] for n in pos[:5]], "bad_news": [n["title"] for n in neg[:5]],
    }


# ----------------------------------------------------------------- CLI Antigravity
def build_prompt(symbol, question, tech, news):
    with open(PROMPT_FILE, encoding="utf-8") as f:
        tpl = f.read()
    news_txt = "\n".join(f"- [{n['date']}] {n['title']} ({n['source']}) {n['link']}" for n in news) or "- (tidak ada berita)"
    return (tpl.replace("{symbol}", symbol).replace("{question}", question or f"Analisa saham {symbol}")
            .replace("{technical}", json.dumps(tech, ensure_ascii=False, indent=2)).replace("{news}", news_txt))


def parse_cmd(cmd):
    if cmd.startswith("["):
        args = json.loads(cmd)
    else:
        args = shlex.split(cmd, posix=os.name != "nt")
        args = [a.strip('"') for a in args]
    exe = os.path.expandvars(args[0])
    exe = shutil.which(exe) or exe
    if not shutil.which(exe) and os.path.basename(exe).lower() in ("agy", "agy.exe"):
        local = os.path.join(os.environ.get("LOCALAPPDATA", ""), "agy", "bin", "agy.exe")  # lokasi default installer
        if os.path.exists(local):
            exe = local
    return [exe] + args[1:]


def extract_json(text):
    try:
        return json.loads(text)
    except Exception:  # noqa: BLE001
        pass
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    cand = m.group(1) if m else text[text.find("{"): text.rfind("}") + 1]
    try:
        return json.loads(cand)
    except Exception:  # noqa: BLE001
        return None


def run_cli(prompt, require="summary", effort="medium"):
    """effort mengisi placeholder {effort} di ANALYST_CMD (chat = low agar cepat, riset saham = medium)."""
    try:
        return _run_cli_once(prompt, require, effort)
    except subprocess.TimeoutExpired:
        raise
    except Exception as e:  # noqa: BLE001
        log("CLI gagal, coba ulang sekali:", str(e)[:160])
        time.sleep(1.5)
        return _run_cli_once(prompt, require, effort)


def _run_cli_once(prompt, require, effort):
    args = parse_cmd(ANALYST_CMD)
    use_arg = any("{prompt}" in a for a in args)
    args = [a.replace("{effort}", effort).replace("{prompt}", prompt) for a in args]
    os.makedirs(WORKDIR, exist_ok=True)
    with _cli_slots:
        p = subprocess.run(args, input=None if use_arg else prompt, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=ANALYST_TIMEOUT, cwd=WORKDIR)
    out = p.stdout.strip()
    env = extract_json(out)
    # Antigravity CLI (agy --output-format json) membungkus jawaban:
    # {"status": "SUCCESS", "response": "<teks>", "structured_output": {...}, "error": ..., "usage": {...}}
    if isinstance(env, dict) and "status" in env and ("response" in env or "error" in env):
        if env.get("status") != "SUCCESS":
            raise RuntimeError(f"agy status {env.get('status')}: {str(env.get('error'))[:300]}")
        if isinstance(env.get("structured_output"), dict):
            data = env["structured_output"]
        else:
            out = str(env.get("response") or "").strip()
            data = extract_json(out)
        log("agy selesai", f"{env.get('duration_seconds', 0):.1f}s", "token:", (env.get("usage") or {}).get("total_tokens"))
    elif p.returncode != 0:
        raise RuntimeError(f"CLI exit {p.returncode}: {p.stderr.strip()[:400]}")
    else:
        data = env
    if p.stderr.strip():
        log("CLI stderr:", p.stderr.strip()[:300])
    if not isinstance(data, dict):
        if not out:
            raise RuntimeError("CLI tidak mengembalikan jawaban (kosong)")
        data = {require: out[:3000]}
    if not str(data.get(require) or "").strip():
        raise RuntimeError(f"jawaban CLI tanpa '{require}'")
    data["engine"] = "ai"
    return data


def analyze(symbol, question):
    key = symbol + "|" + (question or "").lower()
    with _lock:
        c = _cache.get(key)
        if c and time.time() - c[0] < CACHE_MINUTES * 60:
            return {**c[1], "cached": True}
    tech = technical_context(symbol)
    tech["emiten"] = company_info(symbol)
    try:
        news = fetch_news(symbol)
    except Exception as e:  # noqa: BLE001
        log("news error", e)
        news = []
    if ANALYST_CMD:
        try:
            ans = run_cli(build_prompt(symbol, question, tech, news), effort=ANALYZE_EFFORT)
        except Exception as e:  # noqa: BLE001
            log("CLI error", e)
            ans = heuristic_answer(symbol, tech, news)
            ans["warning"] = "Analisa AI sedang tidak tersedia, ini ringkasan cepat."
    else:
        ans = heuristic_answer(symbol, tech, news)
    result = {"ok": True, "symbol": symbol, "news": news, "technical": tech,
              "disclaimer": "Bukan ajakan jual/beli. Do Your Own Research!", **ans}
    with _lock:
        _cache[key] = (time.time(), result)
    return result


# ----------------------------------------------------------------- chat bebas (seputar saham)
def signals_of(s):
    """Sama dengan signalsOf() di js/data.js & docs/app.js."""
    tf = s.get("timeframes") or {}
    ks = [k for k in tf_keys(s) if tf.get(k)]
    out = []
    if any((tf[k].get("donalt") or {}).get("golden") for k in ks):
        out.append("GoldenCross")
    for k in ks:
        st = (tf[k].get("smc") or {}).get("status_7d") or ""
        if "BREAKOUT" in st or "BOS" in st or "CHoCH" in st or ("Supply" in st and "Di Antara Demand & Supply" not in st):
            out.append("SMC-Breakout")
            break
    if any((tf[k].get("macd") or {}).get("bull") for k in ks):
        out.append("MACD-Bull")
    for k in ks:
        sc = tf[k].get("scalping") or {}
        tr = sc.get("trend") or ""
        if "BUY" in tr or "Green" in tr or (sc.get("buy") is not None and not (sc.get("buy") or {}).get("reversed")):
            out.append("Scalp-BUY")
            break
    return out


def market_context():
    """Ringkasan screener untuk prompt chat: scan terakhir lengkap + rekap per hari."""
    h = get_history()
    scans = h.get("daily_scans") or {}
    days = sorted(scans)
    if not days:
        return "(data screener kosong)"
    last = scans[days[-1]]
    stocks = last.get("stocks") or []
    rows = []
    for s in sorted(stocks, key=lambda x: (-(x.get("count_green") or 0), x.get("symbol", ""))):
        g = ((s.get("timeframes") or {}).get("D") or {}).get("gain_pct")
        tfs = s.get("timeframes") or {}
        on = [TF_LABEL.get(k, k) for k in tf_keys(s) if (tfs.get(k) or {}).get("status")]
        off = [TF_LABEL.get(k, k) for k in tf_keys(s) if not (tfs.get(k) or {}).get("status")]
        rows.append(f"{s.get('symbol')} dot={s.get('count_green') or 0}/3 hijau=[{'+'.join(on)}] belum=[{'+'.join(off)}] "
                    f"close={s.get('close')} "
                    f"chg={(s.get('change') or 0):+.2f}% gainSejakDotD={(g if isinstance(g, (int, float)) else 0):+.2f}% "
                    f"vol={s.get('volume') or 0:.0f} sinyal=[{','.join(signals_of(s))}]")
    cnt = [sum(1 for s in stocks if (s.get("count_green") or 0) == n) for n in (3, 2, 1, 0)]
    recap = [f"{d}: {len(scans[d].get('stocks') or [])} saham, "
             f"{sum(1 for s in scans[d].get('stocks') or [] if (s.get('count_green') or 0) >= 3)} full-rally(3 dot)"
             for d in days[-30:]]
    return (f"SCAN TERAKHIR: {days[-1]} ({last.get('session_label') or ''} {last.get('time_display') or ''})\n"
            f"Total lolos screener: {len(stocks)} saham | 3 dot (VVIP/Full Rally Good): {cnt[0]} | "
            f"2 dot (radar): {cnt[1]} | 1 dot: {cnt[2]} | 0 dot: {cnt[3]}\n"
            f"DAFTAR SAHAM SCAN TERAKHIR:\n" + "\n".join(rows) +
            "\n\nREKAP PER HARI (30 hari):\n" + "\n".join(recap))


# ----------------------------------------------------------------- live feed dari bot (realtime kantor 3D)
LIVE_TOKEN = os.environ.get("LIVE_TOKEN", "").strip()
LIVE_MAX_EVENTS = 4000
LIVE_ACTIVE_SECONDS = 8 * 60
WIB = timezone(timedelta(hours=7))
_live = {"seq": 0, "events": [], "stocks": {}, "meta": {}, "day": None}


def live_push(events):
    """Simpan kejadian dari bot. Data harian (saham, alert, putaran) di-reset otomatis saat hari berganti."""
    today = datetime.now(WIB).strftime("%Y-%m-%d")
    n = 0
    with _lock:
        if _live["day"] != today:
            _live.update(day=today, stocks={}, meta={"date": today, "cycle": 0, "alerts": 0})
        m = _live["meta"]
        for e in events[:500]:
            if not isinstance(e, dict) or not isinstance(e.get("t"), str):
                continue
            _live["seq"] += 1
            e = {**e, "seq": _live["seq"], "rx": time.time()}
            t = e["t"]
            if t == "session":
                m.update(status=e.get("status"), name=e.get("name"), session=e.get("session"))
            elif t == "cycle_start":
                m.update(cycle=m.get("cycle", 0) + 1, total=e.get("total"), done=0, running=True, realtime=e.get("realtime"))
            elif t == "stock" and isinstance(e.get("stock"), dict) and e["stock"].get("symbol"):
                m["done"] = m.get("done", 0) + 1
                _live["stocks"][e["stock"]["symbol"]] = e["stock"]
            elif t == "cycle_done":
                m.update(running=False, last_cycle_secs=e.get("secs"))
            elif t == "alert":
                m["alerts"] = m.get("alerts", 0) + 1
            elif t == "saved":
                m["saved_at"] = e.get("last_updated")
            m["updated_at"] = time.time()
            _live["events"].append(e)
            n += 1
        if len(_live["events"]) > LIVE_MAX_EVENTS:
            del _live["events"][: len(_live["events"]) - LIVE_MAX_EVENTS]
    return n


def live_state(since):
    with _lock:
        m = dict(_live["meta"])
        fresh = time.time() - m.get("updated_at", 0) < LIVE_ACTIVE_SECONDS
        active = bool(fresh and m.get("status") not in (None, "ENDED"))
        out = {"ok": True, "active": active, "seq": _live["seq"], "meta": m,
               "events": [e for e in _live["events"] if e["seq"] > since][-400:]}
        if since <= 0:  # klien baru: kirim snapshot saham hari ini supaya papan langsung terisi
            out["stocks"] = list(_live["stocks"].values())
        return out


CHAT_FILE = os.path.join(HERE, "chat_template.md")
CHAT_EFFORT = os.environ.get("CHAT_EFFORT", "low")          # chat bebas: cepat (~10-20 detik)
ANALYZE_EFFORT = os.environ.get("ANALYZE_EFFORT", "medium")  # riset 1 saham + berita: lebih teliti


NOT_TICKERS = {"VVIP", "MACD", "IHSG", "DYOR", "SELL", "HOLD", "GOOD", "NEWS", "BULL", "BEAR", "SWING", "RADAR",
               "GAIN", "LOSS", "TREN", "LIST", "INFO", "DATA_"}
NEWS_WORDS = re.compile(r"berita|news|sentimen|kabar|katalis|isu", re.I)


def _latest_stocks():
    scans = get_history().get("daily_scans") or {}
    return scans[sorted(scans)[-1]].get("stocks") or [] if scans else []


def _safe_news(sym, limit):
    try:
        return fetch_news(sym, limit=limit)
    except Exception as e:  # noqa: BLE001
        log("news error", sym, e)
        return []


def pick_symbols(message, history):
    """Kode saham yang dibahas. Pertanyaan berita untuk 'VVIP'/'radar' -> semua saham grup itu (maks. 15)."""
    stocks = _latest_stocks()
    known = {s.get("symbol") for s in stocks}
    for d in (get_history().get("daily_scans") or {}).values():
        known.update(s.get("symbol") for s in d.get("stocks") or [])
    syms = []
    for w in re.findall(r"\b[A-Z]{4}\b", message):
        if w in syms or w in NOT_TICKERS:
            continue
        if w in known or company_info(w).get("name"):
            syms.append(w)
    low = message.lower()
    if not syms and NEWS_WORDS.search(message):
        context = low + " " + " ".join(h.get("text", "").lower() for h in history[-2:])
        if re.search(r"radar|2 ?dot|selain (yang )?vvip", low):
            grp = [s for s in stocks if (s.get("count_green") or 0) == 2]
            grp.sort(key=lambda s: -(s.get("volume") or 0))
            return [s["symbol"] for s in grp[:15]], "radar 2 dot (15 volume terbesar)"
        if re.search(r"vvip|3 ?dot|full rally", context):
            return [s["symbol"] for s in stocks if (s.get("count_green") or 0) >= 3][:15], "VVIP 3 dot"
    return syms[:5], None


def chat(message, history):
    if not ANALYST_CMD:
        return {"engine": "none", "off_topic": False,
                "answer": "Untuk pertanyaan bebas, analis AI di server sedang tidak aktif. Coba tanya kode saham "
                          "(mis. **analisa PADA**), **berapa saham di screener**, atau **daftar radar 2 dot**."}
    key = "chat|" + message.lower() + "|" + "|".join(h.get("text", "")[:80] for h in history[-2:])
    with _lock:
        c = _cache.get(key)
        if c and time.time() - c[0] < CACHE_MINUTES * 60:
            return {**c[1], "cached": True}
    syms, group = pick_symbols(message, history)
    detail = []
    if group:
        detail.append(f"(Pertanyaan berita untuk grup {group}: {len(syms)} saham, berita diambil untuk semuanya.)")
    with ThreadPoolExecutor(max_workers=6) as ex:
        news_map = dict(zip(syms, ex.map(lambda s: _safe_news(s, 5 if group else 6), syms)))
    for sym in syms:
        info = company_info(sym)
        if group:  # ringkas: data teknikal sudah ada di daftar screener
            head = f"### {sym} ({info.get('name') or '-'})"
        else:
            t = technical_context(sym)
            t["emiten"] = info
            head = f"### {sym}\n" + json.dumps(t, ensure_ascii=False)
        news = news_map.get(sym) or []
        detail.append(head + "\nBerita: " + ("; ".join(f"[{n['date']}] {n['title']}" for n in news) or "(tidak ada berita 30 hari)"))
    convo = "\n".join(f"{'Pengguna' if h.get('role') == 'user' else 'Analis'}: {h.get('text', '')}" for h in history[-6:])
    with open(CHAT_FILE, encoding="utf-8") as f:
        tpl = f.read()
    prompt = (tpl.replace("{market}", market_context()).replace("{details}", "\n".join(detail) or "(tidak ada)")
              .replace("{history}", convo or "(awal percakapan)").replace("{message}", message))
    try:
        data = run_cli(prompt, require="answer", effort=ANALYZE_EFFORT if group else CHAT_EFFORT)
        log("chat prompt", len(prompt), "karakter,", len(syms), "saham", f"(grup {group})" if group else "")
    except Exception as e:  # noqa: BLE001
        log("CLI error", e)
        return {"engine": "none", "off_topic": False,
                "answer": "Maaf, analis AI sedang sibuk atau tidak tersedia. Coba lagi sebentar."}
    result = {"engine": "ai", "off_topic": bool(data.get("off_topic")), "answer": str(data.get("answer", ""))[:12000],
              "symbols": [s for s in (data.get("symbols") or []) if isinstance(s, str) and re.match(r"^[A-Z]{4}$", s)][:30]}
    with _lock:
        _cache[key] = (time.time(), result)
    return result


# ----------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "AranterAnalyst/1.0"

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin and ("*" in ALLOWED_ORIGINS or origin in ALLOWED_ORIGINS):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(code)
            self._cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionError, OSError):
            log("klien menutup koneksi sebelum jawaban terkirim")

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/api/health"):
            return self._json(200, {"ok": True, "engine": "ai" if ANALYST_CMD else "heuristik", "live": bool(LIVE_TOKEN)})
        if self.path.startswith("/api/live"):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                since = int((q.get("since") or ["0"])[0])
            except ValueError:
                since = 0
            return self._json(200, live_state(since))
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):  # noqa: N802
        if self.path.startswith("/api/live/push"):
            return self._live_push()
        if not (self.path.startswith("/api/analyze") or self.path.startswith("/api/chat")):
            return self._json(404, {"ok": False, "error": "not found"})
        ip = self.headers.get("X-Forwarded-For", self.client_address[0]).split(",")[0].strip()
        now = time.time()
        with _lock:
            hits = [t for t in _rate.get(ip, []) if now - t < 60]
            if len(hits) >= RATE_PER_MIN:
                return self._json(429, {"ok": False, "error": "Terlalu banyak permintaan, coba lagi sebentar."})
            _rate[ip] = hits + [now]
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 40000:
                return self._json(413, {"ok": False, "error": "body terlalu besar"})
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:  # noqa: BLE001
            return self._json(400, {"ok": False, "error": "JSON tidak valid"})
        clean = lambda t, n: re.sub(r"[^\w\s.,?!%/()\-:+]", " ", str(t or ""))[:n]  # noqa: E731
        if self.path.startswith("/api/chat"):
            message = clean(body.get("message"), 1500).strip()
            hist = body.get("history") if isinstance(body.get("history"), list) else []
            hist = [{"role": "user" if h.get("role") == "user" else "bot", "text": clean(h.get("text"), 600)}
                    for h in hist[-6:] if isinstance(h, dict)]
            if not message:
                return self._json(400, {"ok": False, "error": "pesan kosong"})
            log("chat dari", ip, ":", message[:80])
            try:
                return self._json(200, {"ok": True, **chat(message, hist)})
            except Exception as e:  # noqa: BLE001
                log("error", repr(e))
                return self._json(500, {"ok": False, "error": "terjadi kesalahan di server analis"})
        symbol = str(body.get("symbol", "")).upper().strip()
        question = re.sub(r"[^\w\s.,?!%/()\-:+]", " ", str(body.get("question", "")))[:500]
        if not SYMBOL_RE.match(symbol):
            return self._json(400, {"ok": False, "error": "Kode saham harus 4 huruf, mis. PADA"})
        log("analyze", symbol, "dari", ip)
        try:
            self._json(200, analyze(symbol, question))
        except subprocess.TimeoutExpired:
            self._json(504, {"ok": False, "error": f"CLI melebihi {ANALYST_TIMEOUT} detik"})
        except Exception as e:  # noqa: BLE001
            log("error", repr(e))
            self._json(500, {"ok": False, "error": str(e)[:300]})

    def _live_push(self):
        token = self.headers.get("X-Live-Token", "")
        if not LIVE_TOKEN or not hmac.compare_digest(token, LIVE_TOKEN):
            return self._json(403, {"ok": False, "error": "token live salah / LIVE_TOKEN belum diset"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 3_000_000:
                return self._json(413, {"ok": False, "error": "batch terlalu besar"})
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:  # noqa: BLE001
            return self._json(400, {"ok": False, "error": "JSON tidak valid"})
        events = body.get("events") if isinstance(body.get("events"), list) else []
        got = live_push(events)
        kinds = {}
        for e in events:
            if isinstance(e, dict):
                kinds[e.get("t")] = kinds.get(e.get("t"), 0) + 1
        if any(k != "stock" for k in kinds):
            log("live", ", ".join(f"{k}:{v}" for k, v in kinds.items()))
        return self._json(200, {"ok": True, "received": got})

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    log(f"Analyst bridge di http://localhost:{PORT}  · engine: {'ai' if ANALYST_CMD else 'heuristik'}")
    log("origin diizinkan:", ", ".join(ALLOWED_ORIGINS))
    log("live feed bot:", "AKTIF (POST /api/live/push)" if LIVE_TOKEN else "nonaktif (LIVE_TOKEN kosong)")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
