import { tfKeys, tfLabel, fmtPct, fmtNum, gainOf, signalsOf } from './data.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class UI {
  constructor(handlers) {
    this.h = handlers;
    $('btnPlay').onclick = () => handlers.onTogglePlay();
    $('dateSelect').onchange = (e) => handlers.onDate(e.target.value);
    document.querySelectorAll('[data-speed]').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('active', x === b));
        handlers.onSpeed(Number(b.dataset.speed));
      };
    });
    $('panelClose').onclick = () => this.closePanel();
    $('liveBadge').onclick = () => handlers.onGoLive && handlers.onGoLive();
    // ---- Pengaturan (semua kontrol berkumpul di sini) ----
    const settings = $('settings');
    $('settingsBtn').onclick = (e) => { e.stopPropagation(); settings.classList.toggle('open'); };
    document.addEventListener('pointerdown', (e) => {
      if (settings.classList.contains('open') && !settings.contains(e.target) && !$('settingsBtn').contains(e.target)) settings.classList.remove('open');
    });
    $('btnLabels').onchange = (e) => document.body.classList.toggle('hide-tags', !e.target.checked);
    $('optFloor').onchange = (e) => handlers.onFloorLabels && handlers.onFloorLabels(e.target.checked);
    $('optLog').onchange = (e) => $('logBox').classList.toggle('hidden', !e.target.checked);
    $('optLive').onchange = (e) => handlers.onLiveToggle && handlers.onLiveToggle(e.target.checked);
    $('logToggle').onclick = () => {
      const c = $('logBox').classList.toggle('collapsed');
      $('logToggle').setAttribute('aria-expanded', String(!c));
    };
    $('logList').onclick = (e) => {
      const li = e.target.closest('[data-idx]');
      if (li && this.logStocks[li.dataset.idx]) this.showStock(this.logStocks[li.dataset.idx]);
    };
    $('panelBody').onclick = (e) => {
      const el = e.target.closest('[data-sym]');
      if (el) handlers.onStockSymbol(el.dataset.sym);
    };
    this.logStocks = [];
  }

  setLoading(p, text) {
    $('loadBar').style.width = Math.round(p * 100) + '%';
    if (text) $('loadText').textContent = text;
  }
  hideLoading() { $('loading').classList.add('hidden'); }

  setSource(source, lastUpdated) {
    const host = source === 'demo' ? 'DATA DEMO (offline)' : new URL(source, location.href).host;
    $('srcInfo').textContent = `Sumber ${host} · update ${lastUpdated || '-'}`;
    $('srcInfo').classList.toggle('warn', source === 'demo');
  }

  setDates(daily, selected) {
    const sel = $('dateSelect');
    sel.innerHTML = Object.keys(daily).sort().reverse().map((k) => {
      const d = daily[k];
      return `<option value="${esc(k)}" ${k === selected ? 'selected' : ''}>${esc(d.date_display || k)} · ${esc(d.session_label || '')}</option>`;
    }).join('');
  }
  selectDate(k) { $('dateSelect').value = k; }

  setPlayState(state) {
    $('btnPlay').disabled = state === 'live';
    if (state === 'live') { $('btnPlay').textContent = 'LIVE'; return; }
    $('btnPlay').textContent = state === 'playing' ? 'Jeda' : state === 'paused' ? 'Lanjut' : 'Ulangi';
  }

  setStats({ total, processed, vip, radar, alerts }) {
    $('stTotal').textContent = total;
    $('stProg').textContent = `${processed}/${total}`;
    $('stVip').textContent = vip;
    $('stRadar').textContent = radar;
    $('stAlert').textContent = alerts;
    $('progFill').style.width = total ? (processed / total) * 100 + '%' : '0';
  }

  setLive(on, text) {
    const b = $('liveBadge');
    b.classList.toggle('on', on);
    b.classList.toggle('avail', !on && Boolean(this.liveAvailable));
    b.textContent = on ? 'LIVE' : (this.liveAvailable ? 'LIVE ›' : 'Replay');
    b.title = on ? `Data realtime dari bot · ${text || ''}` : (this.liveAvailable ? 'Bot sedang berjalan, klik untuk ikut LIVE' : 'Memutar ulang scan tersimpan');
  }

  resetLog() { $('logList').innerHTML = ''; this.logStocks = []; }
  log(icon, text, stock) {
    const ul = $('logList');
    const li = document.createElement('li');
    if (stock) { li.dataset.idx = this.logStocks.length; this.logStocks.push(stock); li.classList.add('clickable'); }
    li.innerHTML = `<span class="ico">${icon}</span><span>${esc(text)}</span>`;
    ul.prepend(li);
    while (ul.children.length > 60) ul.lastChild.remove();
  }

  openPanel(html) { $('panelBody').innerHTML = html; $('panel').classList.add('open'); }
  closePanel() { $('panel').classList.remove('open'); this.h.onPanelClose && this.h.onPanelClose(); }

  showAgent(a) {
    const stats = Object.entries(a.stats).map(([k, v]) => `<div class="kv"><span>${esc(k === 'count' ? 'Diproses' : k)}</span><b>${esc(v)}</b></div>`).join('');
    this.openPanel(`
      <div class="eyebrow">AGENT</div>
      <h2>${esc(a.name)}</h2>
      <div class="role">${esc(a.role)}</div>
      <p>${esc(a.desc)}</p>
      <div class="code">${esc(a.func)}</div>
      <div class="kv"><span>Aktivitas</span><b id="agentActivity">${esc(a.activity)}</b></div>
      ${stats}`);
  }

  showStock(s) {
    const sig = signalsOf(s);
    const tfRows = tfKeys(s).map((k) => {
      const t = s.timeframes?.[k] || {};
      return `<tr><td>${tfLabel(k)}</td><td>${t.status ? '🟢' : '⚪'}</td><td>${esc(t.date || '-')}</td><td class="${(t.gain_pct || 0) >= 0 ? 'up' : 'down'}">${fmtPct(t.gain_pct)}</td></tr>
        <tr class="sub"><td colspan="4">SMC: ${esc(t.smc?.status_7d || '-')}<br>Scalp: ${esc(t.scalping?.trend || '-')}${t.donalt?.golden ? ' · Golden Cross' : ''}${t.macd?.bull ? ' · MACD Bull' : ''}</td></tr>`;
    }).join('');
    const chips = [
      sig.dots >= 3 ? '<span class="chip g">FULL RALLY GOOD</span>' : sig.dots === 2 ? '<span class="chip y">2 RALLY GOOD</span>' : '',
      sig.golden ? '<span class="chip">Golden Cross</span>' : '', sig.smc ? '<span class="chip">SMC Breakout</span>' : '',
      sig.scalp ? '<span class="chip">Scalp BUY</span>' : '', sig.macd ? '<span class="chip">MACD Bull</span>' : '',
    ].join('');
    this.openPanel(`
      <div class="eyebrow">SAHAM</div>
      <h2>${esc(s.symbol)}</h2>
      <div class="chips">${chips}</div>
      <div class="kv"><span>Close</span><b>Rp ${fmtNum(s.close)}</b></div>
      <div class="kv"><span>Change</span><b class="${(s.change || 0) >= 0 ? 'up' : 'down'}">${fmtPct(s.change)}</b></div>
      <div class="kv"><span>Gain sejak Dot D</span><b>${fmtPct(gainOf(s))}</b></div>
      <div class="kv"><span>Volume</span><b>${fmtNum(s.volume)}</b></div>
      <table class="tf"><thead><tr><th>TF</th><th>Dot</th><th>Tanggal</th><th>Gain</th></tr></thead><tbody>${tfRows}</tbody></table>
      <p class="muted">Do Your Own Research! Data dari aranter.web.id</p>`);
  }

  showList(title, sub, stocks) {
    const rows = stocks.length
      ? stocks.map((s) => `<li data-sym="${esc(s.symbol)}" class="clickable"><b>${esc(s.symbol)}</b><span class="${gainOf(s) >= 0 ? 'up' : 'down'}">${fmtPct(gainOf(s))}</span></li>`).join('')
      : '<li class="muted">Belum ada.</li>';
    this.openPanel(`<div class="eyebrow">DAFTAR</div><h2>${esc(title)}</h2><div class="role">${esc(sub)}</div><ul class="slist">${rows}</ul>`);
  }
}
