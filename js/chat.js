import { CONFIG } from './config.js';
import { tfKeys, tfLabel, fmtPct, fmtNum, gainOf, signalsOf } from './data.js';
import { drawTerminal } from './office.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Markdown ringan → HTML aman (escape dulu): **tebal**, baris "- " jadi daftar.
function md(text) {
  const lines = esc(text || '')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,!?:;]|$)/gm, '$1<i>$2</i>')
    .split(/\n/);
  let html = '';
  let inList = false;
  for (const ln of lines) {
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(ln)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<hr>';
      continue;
    }
    const m = ln.match(/^\s*[-•*]\s+(.*)/);
    if (m) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${m[1]}</li>`;
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    if (ln.trim()) html += `<p>${ln}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}

// Kata Indonesia 4 huruf yang juga kode saham — hanya dianggap kode saham kalau ditulis HURUF BESAR.
const STOP = new Set(['PADA', 'YANG', 'SAJA', 'BISA', 'BUAT', 'DARI', 'AKAN', 'JUGA', 'ATAU', 'LAGI', 'MANA', 'KALO', 'KAPA',
  'DONG', 'NIAT', 'BELI', 'JUAL', 'NAIK', 'MAIN', 'SAYA', 'KAMU', 'BARU', 'BAIK', 'BANK', 'NEWS', 'GOOD', 'DOTS', 'HARI',
  'INFO', 'DATA', 'SAHAM', 'APAKAH', 'TOLONG', 'BERITA', 'BUKA', 'BAGI', 'ANDA', 'SAMA', 'TAPI', 'KALAU', 'MAKA', 'SANA',
  'SINI', 'SIAP', 'LIST', 'AMAN', 'CUAN', 'AJAH', 'VVIP', 'MACD', 'IHSG', 'GOLD', 'BULL', 'BEAR', 'DONG', 'DONK', 'COBA', 'MOHON']);

export class Chat {
  constructor({ getHistory, research, screen }) {
    this.getHistory = getHistory;
    this.agent = research;
    this.screen = screen;
    this.term = ['> analis aranter siap', 'menunggu pertanyaan…'];
    this.busy = false;
    this.convo = []; // riwayat singkat untuk pertanyaan lanjutan
    drawTerminal(screen, this.term);

    $('chatToggle').onclick = () => this.toggle();
    $('chatClose').onclick = () => this.toggle(false);
    $('chatForm').onsubmit = (e) => { e.preventDefault(); this.send($('chatInput').value); };
    const ask = (e) => { const b = e.target.closest('[data-q]'); if (b) this.send(b.dataset.q); };
    $('chatChips').onclick = ask;
    $('chatLog').onclick = ask;
    $('chatEngine').textContent = CONFIG.CHAT_API_URL ? 'menghubungkan…' : 'mode data screener';
    if (CONFIG.CHAT_API_URL) {
      this.ping();
      setInterval(() => this.ping(), 15000); // server analis bisa menyala belakangan
    }
    this.bot(`Halo! Aku <b>Analis Riset AI</b> Aranter. Tanya apa saja seputar saham, misalnya <i>"berapa saham di screener hari ini?"</i>, <i>"analisa PADA, ada good news?"</i>, atau <i>"bandingkan PADA dan BUMI"</i>.`);
  }

  async ping() {
    try {
      const r = await fetch(this.apiUrl('/api/health'));
      const j = await r.json();
      $('chatEngine').textContent = j.engine === 'ai' ? '● online' : '● online · mode ringkas';
    } catch {
      $('chatEngine').textContent = '○ offline · mode data screener';
    }
  }

  toggle(force) {
    const open = force ?? !$('chat').classList.contains('open');
    $('chat').classList.toggle('open', open);
    if (open) setTimeout(() => $('chatInput').focus(), 50);
  }

  bot(html, cls = '') {
    const el = document.createElement('div');
    el.className = 'msg bot ' + cls;
    el.innerHTML = html;
    $('chatLog').appendChild(el);
    $('chatLog').scrollTop = 1e9;
    return el;
  }

  user(text) {
    const el = document.createElement('div');
    el.className = 'msg user';
    el.textContent = text;
    $('chatLog').appendChild(el);
    $('chatLog').scrollTop = 1e9;
  }

  terminal(line) {
    this.term.push(line);
    drawTerminal(this.screen, this.term);
  }

  allSymbols() {
    const h = this.getHistory();
    if (!this._symbols) {
      this._symbols = new Set();
      for (const d of Object.values(h?.daily_scans || {})) for (const s of d.stocks || []) this._symbols.add(s.symbol);
    }
    return this._symbols;
  }

  // Semua kode saham di pesan. Huruf besar = pasti kode; huruf kecil hanya kalau ada di data & bukan kata umum.
  findSymbols(text) {
    const raw = text.match(/\b[A-Za-z]{4}\b/g) || [];
    const out = [];
    const add = (w) => { if (!out.includes(w)) out.push(w); };
    for (const w of raw) {
      const u = w.toUpperCase();
      const known = this.allSymbols().has(u);
      if (w === u ? (known || !STOP.has(u)) : (known && !STOP.has(u))) add(u);
    }
    return out;
  }

  findSymbol(text) { return this.findSymbols(text)[0] || null; }

  remember(role, text) {
    this.convo.push({ role, text: String(text).slice(0, 600) });
    if (this.convo.length > 12) this.convo.shift();
  }

  apiUrl(path) { return CONFIG.CHAT_API_URL.replace(/\/api\/analyze.*$/, path); }

  async send(text) {
    text = (text || '').trim();
    if (!text || this.busy) return;
    $('chatInput').value = '';
    this.user(text);
    const history = this.convo.slice(-6);
    this.remember('user', text);
    const syms = this.findSymbols(text);
    const lower = text.toLowerCase();
    const compare = /bandingk|banding|\bvs\b|selain|dibanding|mana yang|lebih bagus|lainnya/.test(lower);

    // 1) satu kode saham → kartu data instan + riset berita/sentimen
    if (syms.length === 1 && !compare) {
      const sym = syms[0];
      this.bot(this.localAnalysis(sym));
      this.remember('bot', this.localSummary(sym));
      if (!CONFIG.CHAT_API_URL) return this.bot('Analisa berita & sentimen butuh server analis yang aktif.', 'muted');
      return this.askServer(sym, text);
    }

    // 2) pertanyaan pendek berpola jelas → dijawab instan dari data screener
    const short = text.split(/\s+/).length <= 9;
    const local = syms.length === 0 ? this.localIntent(lower) : null;
    if (local && (short || !CONFIG.CHAT_API_URL)) {
      this.bot(local.html);
      this.remember('bot', local.text);
      return;
    }

    // 3) selebihnya → analis AI (pertanyaan bebas, tetap harus seputar saham)
    if (!CONFIG.CHAT_API_URL) {
      return this.bot('Aku belum bisa menjawab pertanyaan bebas karena server analis tidak aktif. Coba: <i>"berapa saham di screener"</i>, <i>"daftar radar"</i>, atau sebut kode saham, mis. <b>PADA</b>.');
    }
    return this.askChat(text, history, local);
  }

  async askChat(text, history, local) {
    this.busy = true;
    $('chatSend').disabled = true;
    const wait = this.bot('<span class="dots">Analis sedang membaca data screener</span>', 'pending');
    this.agent.setWorking(true);
    this.agent.say('Sebentar, aku cek datanya…', 999);
    this.terminal('> tanya: ' + text.slice(0, 26));
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), CONFIG.CHAT_TIMEOUT_MS);
    try {
      const r = await fetch(this.apiUrl('/api/chat'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }), signal: ctrl.signal,
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'HTTP ' + r.status);
      wait.remove();
      if (j.engine === 'none' && local) {
        this.bot(local.html);
        this.remember('bot', local.text);
      } else {
        const chips = (j.symbols || []).map((s) => `<button class="chip ask" data-q="analisa ${esc(s)}">${esc(s)}</button>`).join('');
        this.bot(`${md(j.answer)}${chips ? `<div class="chips">${chips}</div>` : ''}`, j.off_topic ? 'muted' : '');
        this.remember('bot', j.answer);
      }
      this.terminal(j.off_topic ? '! di luar topik saham' : '✔ jawaban terkirim');
      this.agent.say(j.off_topic ? 'Aku khusus urusan saham ya 🙂' : 'Sudah kujawab ✔', 3);
    } catch (e) {
      wait.remove();
      if (local) {
        this.bot(local.html);
        this.remember('bot', local.text);
      } else {
        const msg = e.name === 'AbortError' ? 'waktu habis' : e.message;
        this.bot(`Analis sedang tidak bisa dihubungi (${esc(msg)}). Coba lagi sebentar.`, 'err');
      }
      this.terminal('! server tidak merespons');
      this.agent.say('Server analis offline 😕', 3);
    } finally {
      clearTimeout(to);
      this.agent.setWorking(false);
      this.busy = false;
      $('chatSend').disabled = false;
    }
  }

  // ---------- jawaban instan dari data screener (pola pertanyaan umum)
  latestScan() {
    const h = this.getHistory();
    const key = Object.keys(h?.daily_scans || {}).sort().pop();
    return { key, scan: h.daily_scans[key] };
  }

  stockList(title, stocks, note = '') {
    const sorted = [...stocks].sort((a, b) => gainOf(b) - gainOf(a));
    const chip = (s) => {
      const d = s.count_green || 0;
      return `<button class="chip ${d >= 3 ? 'g' : d === 2 ? 'y' : ''} ask" data-q="analisa ${esc(s.symbol)}">${esc(s.symbol)} ${fmtPct(gainOf(s))}</button>`;
    };
    return {
      html: `<div class="ans-h"><b>${esc(title)}</b> <span class="muted">(${sorted.length} saham)</span></div>` +
        (sorted.length ? `<div class="chips">${sorted.slice(0, 40).map(chip).join('')}</div>` : '<div class="muted">Tidak ada.</div>') +
        (sorted.length > 40 ? `<div class="muted">+${sorted.length - 40} lainnya</div>` : '') +
        `<div class="muted">${note || 'Klik kode untuk analisa + berita.'}</div>`,
      text: `${title} (${sorted.length} saham): ${sorted.map((s) => `${s.symbol} ${fmtPct(gainOf(s))}`).join(', ')}`,
    };
  }

  localIntent(lower) {
    const { key, scan } = this.latestScan();
    if (!scan) return null;
    const stocks = scan.stocks || [];
    const when = scan.date_display || key;
    const by = (n) => stocks.filter((s) => (s.count_green || 0) === n);
    const vip = stocks.filter((s) => (s.count_green || 0) >= 3);

    if (/(selain|kecuali|bukan|non)[\s-]*(yang\s+)?(vvip|3 ?dot)|2 ?(dot|tf)|dua dot|radar|pantau/.test(lower)) {
      return this.stockList(`Radar 2 dot (selain VVIP) · ${when}`, by(2), 'Sudah 2 timeframe hijau, tinggal menunggu konfirmasi ke-3.');
    }
    if (/vvip|3 ?(dot|tf)|tiga dot|full rally|rekomendasi/.test(lower)) return this.stockList(`VVIP · Full Rally Good · ${when}`, vip);
    if (/golden|donalt/.test(lower)) return this.stockList(`DonAlt Golden Cross · ${when}`, stocks.filter((s) => signalsOf(s).golden));
    if (/\bsmc\b|breakout|supply/.test(lower)) return this.stockList(`SMC Breakout · ${when}`, stocks.filter((s) => signalsOf(s).smc));
    if (/macd/.test(lower)) return this.stockList(`MACD Bullish · ${when}`, stocks.filter((s) => signalsOf(s).macd));
    if (/scalp|swing/.test(lower)) return this.stockList(`Scalp & Swing BUY · ${when}`, stocks.filter((s) => signalsOf(s).scalp));
    if (/(naik|gain|kenaikan|cuan).*(tertinggi|terbesar|paling)|(paling|top) (naik|gain|cuan)/.test(lower)) {
      const top = [...stocks].sort((a, b) => gainOf(b) - gainOf(a)).slice(0, 10);
      return this.stockList(`Top 10 kenaikan sejak Dot Green · ${when}`, top);
    }
    if (/(berapa|jumlah|total|ada berapa|banyak)/.test(lower) && /(saham|emiten|screener|lolos|hari ini)/.test(lower)) {
      const c = [3, 2, 1, 0].map((n) => (n === 3 ? vip.length : by(n).length));
      return {
        html: `<div class="ans-h"><b>${stocks.length} saham</b> lolos screener · ${esc(when)} <span class="muted">${esc(scan.session_label || '')}</span></div>` +
          `<div class="chips"><button class="chip g ask" data-q="VVIP hari ini">3 dot (VVIP): ${c[0]}</button>` +
          `<button class="chip y ask" data-q="daftar radar 2 dot">2 dot (radar): ${c[1]}</button>` +
          `<span class="chip">1 dot: ${c[2]}</span><span class="chip">0 dot: ${c[3]}</span></div>`,
        text: `Scan ${when}: ${stocks.length} saham lolos screener; 3 dot ${c[0]}, 2 dot ${c[1]}, 1 dot ${c[2]}, 0 dot ${c[3]}.`,
      };
    }
    if (/(semua|daftar|list|saham apa( aja| saja)?|ada apa aja)/.test(lower) && /saham|screener|hari ini/.test(lower)) {
      return this.stockList(`Semua saham screener · ${when}`, stocks);
    }
    return null;
  }

  localSummary(sym) {
    const { scan } = this.latestScan();
    const s = scan?.stocks?.find((x) => x.symbol === sym);
    return s ? `${sym}: ${s.count_green || 0}/3 dot, gain sejak dot ${fmtPct(gainOf(s))}` : `${sym}: tidak ada di scan terakhir`;
  }

  async askServer(sym, question) {
    this.busy = true;
    $('chatSend').disabled = true;
    const wait = this.bot(`<span class="dots">Mencari berita & menganalisa sentimen <b>${esc(sym)}</b></span>`, 'pending');
    this.agent.setWorking(true);
    this.agent.say(`Riset ${sym}: cari berita…`, 999);
    this.terminal(`> riset ${sym}`);
    this.terminal('mengambil history.json…');
    this.terminal('mengambil Google News…');
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), CONFIG.CHAT_TIMEOUT_MS);
    try {
      const r = await fetch(CONFIG.CHAT_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, question }), signal: ctrl.signal,
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'HTTP ' + r.status);
      wait.remove();
      this.bot(this.renderServer(j));
      this.remember('bot', `Riset ${sym}: sentimen ${j.sentiment}. ${j.summary || ''}`);
      this.terminal(`✔ ${sym}: ${j.sentiment || 'selesai'}`);
      this.agent.say(`Analisa ${sym} selesai ✔`, 3);
    } catch (e) {
      wait.remove();
      const msg = e.name === 'AbortError' ? 'waktu habis' : e.message;
      this.bot(`Analis sedang tidak bisa dihubungi (${esc(msg)}). Coba lagi sebentar.`, 'err');
      this.terminal('! gagal: ' + msg);
      this.agent.say('Server analis offline 😕', 3);
    } finally {
      clearTimeout(to);
      this.agent.setWorking(false);
      this.busy = false;
      $('chatSend').disabled = false;
    }
  }

  // ---------- jawaban dari data history.json (langsung, tanpa server)
  localAnalysis(sym) {
    const h = this.getHistory();
    const days = Object.keys(h?.daily_scans || {}).sort();
    const hits = days.map((d) => [d, h.daily_scans[d].stocks?.find((s) => s.symbol === sym)]).filter(([, s]) => s);
    if (!hits.length) {
      return `<b>${esc(sym)}</b> tidak muncul di screener Aranter selama ${days.length} hari data terakhir, jadi belum ada data dot green. Aku cek berita & sentimennya di server ya.`;
    }
    const [date, s] = hits[hits.length - 1];
    const sig = signalsOf(s);
    const scan = h.daily_scans[date];
    const label = sig.dots >= 3 ? '<span class="chip g">FULL RALLY GOOD · VVIP</span>' : sig.dots === 2 ? '<span class="chip y">2 RALLY GOOD · RADAR</span>' : `<span class="chip">${sig.dots}/3 dot</span>`;
    const rows = tfKeys(s).map((k) => {
      const t = s.timeframes?.[k] || {};
      return `<tr><td>${tfLabel(k)}</td><td>${t.status ? '🟢' : '⚪'}</td><td>${esc(t.date || '-')}</td><td class="${(t.gain_pct || 0) >= 0 ? 'up' : 'down'}">${fmtPct(t.gain_pct)}</td></tr>`;
    }).join('');
    const smc = s.timeframes?.D?.smc?.status_7d || s.timeframes?.['60']?.smc?.status_7d;
    const extra = [sig.golden && 'DonAlt Golden Cross', sig.smc && 'SMC Breakout', sig.macd && 'MACD Bullish', sig.scalp && 'Scalp BUY'].filter(Boolean);
    const vipDays = hits.filter(([, x]) => (x.count_green || 0) >= 3).length;
    return `
      <div class="ans-h"><b>${esc(sym)}</b> · scan ${esc(scan.date_display || date)} ${label}</div>
      <div class="kv"><span>Close</span><b>Rp ${fmtNum(s.close)} <small class="${(s.change || 0) >= 0 ? 'up' : 'down'}">${fmtPct(s.change)}</small></b></div>
      <table class="tf"><thead><tr><th>TF</th><th>Dot</th><th>Muncul</th><th>Gain sejak dot</th></tr></thead><tbody>${rows}</tbody></table>
      ${smc ? `<div class="muted">SMC: ${esc(smc)}</div>` : ''}
      ${extra.length ? `<div class="muted">Konfirmasi: ${esc(extra.join(' · '))}</div>` : ''}
      <div class="muted">Muncul di screener ${hits.length} dari ${days.length} hari · ${vipDays} hari Full Rally Good · gain D ${fmtPct(gainOf(s))}</div>`;
  }

  // ---------- jawaban riset saham dari server (AI / ringkasan cepat)
  renderServer(j) {
    const sentClass = { positif: 'g', negatif: 'r', campuran: 'y', netral: '' }[j.sentiment] || '';
    const list = (arr, cls) => (arr && arr.length ? `<ul class="${cls}">${arr.map((x) => `<li>${esc(typeof x === 'string' ? x : JSON.stringify(x))}</li>`).join('')}</ul>` : '<div class="muted">-</div>');
    const news = (j.news || []).slice(0, 8).map((n) => {
      let href = '#';
      try { const u = new URL(n.link); if (u.protocol === 'https:' || u.protocol === 'http:') href = u.href; } catch { /* abaikan */ }
      const dot = n.sentiment === 'positif' ? '🟢' : n.sentiment === 'negatif' ? '🔴' : '⚪';
      return `<li>${dot} <a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a> <span class="muted">${esc(n.source || '')} ${esc(n.date || '')}</span></li>`;
    }).join('');
    return `
      <div class="ans-h">Riset <b>${esc(j.symbol)}</b> <span class="chip ${sentClass}">${esc((j.sentiment || 'netral').toUpperCase())}</span>
        <span class="muted">${j.engine === 'ai' ? 'Analis AI' : 'ringkasan cepat'}</span></div>
      ${md(j.summary || '')}
      ${j.technical_view ? `<p class="muted">${esc(j.technical_view)}</p>` : ''}
      <div class="nb"><b class="up">Good news</b>${list(j.good_news, 'good')}</div>
      <div class="nb"><b class="down">Bad news</b>${list(j.bad_news, 'bad')}</div>
      ${j.risks?.length ? `<div class="nb"><b>Risiko</b>${list(j.risks, '')}</div>` : ''}
      ${news ? `<details><summary>${(j.news || []).length} berita terbaru</summary><ul class="news">${news}</ul></details>` : '<div class="muted">Tidak ada berita 30 hari terakhir.</div>'}
      ${j.warning ? `<div class="muted">⚠ ${esc(j.warning)}</div>` : ''}
      <div class="muted">${esc(j.disclaimer || 'Do Your Own Research!')}</div>`;
  }
}
