import * as THREE from 'three';
import { CONFIG } from './config.js';
import { signalsOf, gainOf, fmtPct, tfKeys, tfLabel } from './data.js';
import { drawMonitor, drawBoard, drawSign } from './office.js';

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Memutar ulang 1 hari scan dari history.json sebagai aktivitas kantor.
export class Replay {
  constructor({ office, agents, fx, ui, onLights }) {
    Object.assign(this, { office, agents, fx, ui, onLights });
    this.speed = 1;
    this.state = 'ready'; // ready | playing | paused | done | live
    this.mode = 'replay';  // replay | live
    this.time = 0;
    this.events = [];
  }

  at(delay, fn) {
    this.events.push({ t: this.time + delay, fn });
    this.events.sort((a, b) => a.t - b.t);
  }

  worldDt(dt) {
    if (this.state === 'paused') return 0;
    if (this.state === 'playing') return dt * this.speed;
    return dt; // ready / done / live: waktu nyata
  }

  update(dt) {
    if (this.state !== 'playing' && this.state !== 'live') return;
    this.time += dt * (this.state === 'live' ? 1 : this.speed);
    while (this.events.length && this.events[0].t <= this.time) this.events.shift().fn();
  }

  togglePause() {
    if (this.state === 'live') return;
    if (this.state === 'playing') this.state = 'paused';
    else if (this.state === 'paused') this.state = 'playing';
    else if (this.scan) this.load(this.scan, this.dateKey);
    this.ui.setPlayState(this.state);
  }

  load(scan, dateKey) {
    this.mode = 'replay';
    this.ui.setLive(false);
    this.scan = scan;
    this.dateKey = dateKey;
    this.events = [];
    this.time = 0;
    this.fx.clear();
    const { office, agents } = this;
    agents.list.forEach((a) => a.resetPose());
    office.desks.forEach((d) => { d.stock = null; drawMonitor(d.screen); });
    drawMonitor(office.courierScreen);
    drawMonitor(office.hunterScreen);
    office.setPile(0, 1);
    office.highlightCabinet(null);
    drawSign(office.sign, false, 'menunggu cek BBCA…');
    this.onLights(false);

    this.stocks = [...(scan.stocks || [])];
    this.queue = [...this.stocks];
    this.total = this.stocks.length;
    this.processed = 0;
    this.vip = [];
    this.radar = [];
    this.alerts = 0;
    this.signalLists = { smc: [], golden: [], macd: [], scalp: [] };
    this.courierQueue = [];
    this.courierBusy = false;
    this.finished = false;
    this.redrawVip();
    this.redrawWhiteboard();
    this.ui.resetLog();
    this.ui.setStats(this.statsObj());
    this.state = 'playing';
    this.ui.setPlayState(this.state);
    this.ui.log('🗂️', `Replay scan ${scan.date_display || dateKey} · ${scan.session_label || ''} (${scan.time_display || ''})`);
    this.schedule();
  }

  statsObj() {
    return { total: this.total, processed: this.processed, vip: this.vip.length, radar: this.radar.length, alerts: this.alerts };
  }

  schedule() {
    const { agents, office, scan } = this;
    const g = agents.guard;
    g.say('Cek harga BBCA & sesi IDX…', 1.6);
    this.ui.log('👮', 'Satpam: cek status pasar via BBCA');
    this.at(1.5, () => {
      this.onLights(true);
      drawSign(office.sign, 'replay', `${scan.date_display || ''} · ${scan.session_label || scan.session || ''}`);
      g.say(`Replay · ${scan.session_label || 'scan tersimpan'}`, 2.2);
    });

    this.at(2.2, () => {
      agents.hunter.setWorking(true);
      agents.hunter.say('Jalankan TradingView Screener…', 2);
      drawMonitor(office.hunterScreen, { code: 'SCREENER', state: 'scan' });
      this.ui.log('🎯', 'Hunter: filter Rp10–1.000 · Vol > Avg10D · Pre-mkt ≥ 500%');
    });
    const steps = 10;
    for (let i = 1; i <= steps; i++) this.at(2.2 + i * 0.18, () => office.setPile(Math.round((this.total * i) / steps), this.total));
    this.at(4.2, () => {
      agents.hunter.setWorking(false);
      agents.hunter.say(`${this.total} saham lolos screener`, 2.5);
      drawMonitor(office.hunterScreen, { code: String(this.total), state: 'done', dots: 0, tfs: 'saham lolos' });
      this.ui.log('🎯', `Hunter: ${this.total} saham lolos screener`);
      agents.tech.say(`${agents.scanners.length} worker Chromium aktif`, 2.5);
      agents.tech.setWorking(true);
    });
    this.at(4.8, () => agents.scanners.forEach((s, i) => this.at(i * 0.15, () => this.nextFor(s))));
  }

  nextFor(scanner) {
    if (!this.queue.length) {
      scanner.setWorking(false);
      scanner.say('Antrean habis ✔', 1.5);
      return;
    }
    const stock = this.queue.shift();
    const d = scanner.desk;
    const from = this.office.pileTop();
    this.office.setPile(this.queue.length, this.total);
    this.fx.fly(from, d.cardSpot, {
      dur: 0.6, height: 1.6,
      onDone: () => {
        scanner.setWorking(true);
        scanner.say(`Scan ${stock.symbol}`, 1.2);
        d.stock = stock;
        drawMonitor(d.screen, { code: stock.symbol, state: 'scan' });
        const dur = CONFIG.BASE_SCAN_SECONDS * (0.7 + Math.random() * 0.6);
        this.at(dur, () => this.finishStock(scanner, stock));
      },
    });
  }

  finishStock(scanner, stock, live = false) {
    const d = scanner.desk;
    if (live) { // satu saham bisa discan berkali-kali per hari: ganti data lama
      const drop = (arr) => { const i = arr.findIndex((x) => x.symbol === stock.symbol); if (i >= 0) arr.splice(i, 1); };
      drop(this.radar);
      Object.values(this.signalLists).forEach(drop);
    }
    const sig = signalsOf(stock);
    const tfOn = tfKeys(stock).filter((k) => stock.timeframes?.[k]?.status).map(tfLabel).join(' · ');
    drawMonitor(d.screen, { code: stock.symbol, state: 'done', dots: sig.dots, tfs: tfOn || 'tanpa dot' });
    this.processed++;
    const { agents } = this;

    const flags = [];
    if (sig.smc) flags.push(['smc', 'SMC Breakout']);
    if (sig.golden) flags.push(['golden', 'Golden Cross']);
    if (sig.macd) flags.push(['macd', 'MACD Bull']);
    if (sig.scalp) flags.push(['scalp', 'Scalp BUY']);
    const analystOf = { smc: agents.analysts.smc, golden: agents.analysts.donalt, macd: agents.analysts.macd, scalp: agents.analysts.scalp };

    if (flags.length) {
      this.fx.fly(d.cardSpot, this.office.analystTable, {
        color: '#86efac', dur: 0.9, height: 1.8,
        onDone: () => {
          for (const [k, label] of flags) {
            this.signalLists[k].push(stock);
            const a = analystOf[k];
            a.stats.count = (a.stats.count || 0) + 1;
            a.setWorking(true);
            this.at(0.8, () => a.setWorking(false));
            if (!a.bubbleBusy) a.say(`${label}: ${stock.symbol}`, 1.4);
          }
          this.redrawWhiteboard();
        },
      });
    }

    if (sig.dots >= 3) {
      this.fx.fly(d.cardSpot, this.office.vipCardPoint, {
        color: '#22c55e', dur: 1.2, height: 2.5,
        onDone: () => {
          const i = this.vip.findIndex((x) => x.symbol === stock.symbol);
          if (i >= 0) this.vip.splice(i, 1);
          this.vip.push(stock);
          this.redrawVip();
          agents.manager.say(`VVIP: ${stock.symbol} ${fmtPct(gainOf(stock))}`, 1.8);
          this.ui.setStats(this.statsObj());
        },
      });
      this.ui.log('🟢', `${stock.symbol} · FULL RALLY GOOD (3 TF) ${fmtPct(gainOf(stock))}`, stock);
      if (!live) this.enqueueAlert(stock); // mode live: alert datang dari bot (event "alert")
    } else if (sig.dots === 2) {
      if (live) { const i = this.vip.findIndex((x) => x.symbol === stock.symbol); if (i >= 0) { this.vip.splice(i, 1); this.redrawVip(); } }
      this.radar.push(stock);
      this.ui.log('🟡', `${stock.symbol} · 2 Rally Good (radar) ${fmtPct(gainOf(stock))}`, stock);
    } else if (flags.length) {
      this.ui.log('📐', `${stock.symbol} · ${flags.map((f) => f[1]).join(', ')}`, stock);
    }

    scanner.stats.count = (scanner.stats.count || 0) + 1;
    this.ui.setStats(this.statsObj());
    if (this.processed % 20 === 0) agents.tech.say(`Cleanup screenshot · ${this.processed}/${this.total}`, 1.6);
    if (live) {
      this.office.setPile(Math.max(0, this.total - this.processed), this.total);
      return;
    }
    this.at(0.25, () => this.nextFor(scanner));
    this.checkFinish();
  }

  // ================================================================ MODE LIVE (event dari bot)
  goLive(meta = {}, stocks = [], baseline = null) {
    this.mode = 'live';
    this.state = 'live';
    this.events = [];
    this.time = 0;
    this.fx.clear();
    const { office, agents } = this;
    agents.list.forEach((a) => a.resetPose());
    office.desks.forEach((d) => { d.stock = null; drawMonitor(d.screen); });
    drawMonitor(office.courierScreen);
    office.highlightCabinet(null);
    // Belum ada saham live hari ini (awal sesi): isi papan dari scan terakhir dulu, diganti hasil live begitu masuk.
    const seeded = !stocks.length && baseline?.stocks?.length;
    const seed = seeded ? baseline.stocks : stocks;
    this.scan = { date_display: seeded ? `LIVE · sementara data ${baseline.date_display || 'scan terakhir'}` : 'LIVE hari ini', stocks: [] };
    this.dateKey = 'live';
    this.total = meta.total || seed.length;
    this.processed = meta.done || 0;
    this.vip = [];
    this.radar = [];
    this.alerts = meta.alerts || 0;
    this.signalLists = { smc: [], golden: [], macd: [], scalp: [] };
    this.courierQueue = [];
    this.courierBusy = false;
    this.liveQueues = new Map();
    for (const s of seed) this.applySilently(s); // papan langsung terisi (snapshot hari ini / scan terakhir)
    this.redrawVip();
    this.redrawWhiteboard();
    office.setPile(Math.max(0, this.total - this.processed), this.total);
    this.ui.resetLog();
    this.ui.setStats(this.statsObj());
    this.ui.setPlayState('live');
    this.ui.setLive(true, meta.name || '');
    this.ui.log('🔴', `LIVE dari bot: ${meta.name || 'sesi aktif'} · putaran #${meta.cycle || 1} · ${this.processed}/${this.total} saham`);
    if (seeded) this.ui.log('📋', `Papan sementara memakai scan ${baseline.date_display || 'terakhir'} sampai bot selesai memindai saham hari ini`);
    this.applySession(meta);
    agents.research.say('Kantor sedang LIVE 🔴', 3);
  }

  applySilently(stock) {
    this.scan.stocks = this.scan.stocks.filter((x) => x.symbol !== stock.symbol).concat(stock);
    const sig = signalsOf(stock);
    const put = (arr) => { const i = arr.findIndex((x) => x.symbol === stock.symbol); if (i >= 0) arr.splice(i, 1); arr.push(stock); };
    const del = (arr) => { const i = arr.findIndex((x) => x.symbol === stock.symbol); if (i >= 0) arr.splice(i, 1); };
    if (sig.dots >= 3) { put(this.vip); del(this.radar); } else if (sig.dots === 2) { put(this.radar); del(this.vip); } else { del(this.vip); del(this.radar); }
    for (const k of ['smc', 'golden', 'macd', 'scalp']) (sig[k] ? put : del)(this.signalLists[k]);
  }

  applySession(m) {
    const { office, agents } = this;
    const st = m.status;
    const open = st === 'OPEN';
    // lampu terang hanya saat pasar buka; istirahat agak redup; tutup/penutupan = suasana sore
    this.onLights(open ? 1 : st === 'BREAK' ? 0.65 : 0.25);
    const sign = open ? 'open' : st === 'BREAK' ? 'break' : st === 'CLOSING' ? 'closing' : 'closed';
    drawSign(office.sign, sign, m.name || (open ? 'Sesi aktif' : 'Tutup'));
    if (open) agents.guard.say(`BBCA terbaca · ${m.name || 'pasar buka'}`, 3);
    else if (st === 'BREAK') agents.guard.say('Istirahat siang ☕ tim menyimpan snapshot Sesi I', 4);
    else if (st === 'CLOSING') agents.guard.say('Pasar tutup 🔒 tim menyelesaikan audit penutupan', 5);
    else if (st) agents.guard.say(m.name || 'Pasar tutup', 3);
    if (st === 'CLOSING' || st === 'BREAK') agents.hunter.say(st === 'CLOSING' ? 'Audit VIP penutupan…' : 'Snapshot siang…', 3);
  }

  liveEvent(e) {
    if (this.mode !== 'live' || !e) return;
    const { agents, office } = this;
    switch (e.t) {
      case 'session':
        this.applySession(e);
        this.ui.setLive(true, e.name || '');
        if (e.status === 'ENDED') { // runner bot selesai: semua istirahat
          agents.scanners.forEach((s) => s.setWorking(false));
          agents.tech.setWorking(false);
          agents.tech.say('Semua worker dimatikan ✔', 4);
        }
        this.ui.log('👮', `Sesi: ${e.name || e.status}`);
        break;
      case 'cycle_start':
        this.total = e.total || 0;
        this.processed = 0;
        if (Array.isArray(e.symbols) && e.symbols.length) { // papan hanya berisi saham yang lolos screener hari ini
          const keep = new Set(e.symbols);
          const prune = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (!keep.has(arr[i].symbol)) arr.splice(i, 1); };
          prune(this.vip); prune(this.radar); Object.values(this.signalLists).forEach(prune);
          this.scan.stocks = this.scan.stocks.filter((x) => keep.has(x.symbol));
          this.scan.date_display = 'LIVE hari ini';
          this.redrawVip(); this.redrawWhiteboard();
        }
        agents.hunter.setWorking(true);
        agents.hunter.say(`Screener: ${e.screener ?? e.total} saham lolos`, 3);
        drawMonitor(office.hunterScreen, { code: String(e.total || 0), state: 'done', dots: 0, tfs: 'antrean scan' });
        office.setPile(this.total, this.total);
        this.at(1.5, () => agents.hunter.setWorking(false));
        agents.tech.setWorking(true);
        agents.tech.say('Worker Chromium jalan', 2.5);
        this.ui.log('🎯', `Putaran scan baru: ${e.total} saham (screener ${e.screener ?? '-'})`);
        this.ui.setStats(this.statsObj());
        break;
      case 'stock': {
        if (!e.stock?.symbol) break;
        const sc = agents.scanners;
        const scanner = sc[((Number(e.worker) || 1) - 1) % sc.length];
        if (!this.liveQueues.has(scanner)) this.liveQueues.set(scanner, []);
        this.liveQueues.get(scanner).push(e.stock);
        this.pumpLive(scanner);
        break;
      }
      case 'cycle_done':
        agents.tech.setWorking(false);
        agents.tech.say(`Putaran selesai · ${e.count} saham · ${Math.round(e.secs || 0)} dtk`, 4);
        agents.hunter.say('Menunggu putaran berikutnya (~3 menit)…', 4);
        this.ui.log('✅', `Putaran selesai: ${e.count} saham dalam ${Math.round(e.secs || 0)} detik`);
        break;
      case 'alert':
        this.enqueueAlert({ symbol: e.symbol });
        this.ui.log('📲', `Alert WA terkirim: ${e.symbol}`);
        break;
      case 'saved':
        agents.archivist.say('history.json tersimpan ✔', 4);
        this.ui.log('🗄️', `Database web disimpan (${e.last_updated || ''})`);
        break;
      default:
        break;
    }
  }

  pumpLive(scanner) {
    const q = this.liveQueues.get(scanner);
    if (!q || !q.length || scanner.liveBusy) return;
    const stock = q.shift();
    this.applySilently(stock);
    if (q.length > 4) { // tertinggal jauh: langsung tampilkan hasil tanpa animasi kartu
      this.finishStock(scanner, stock, true);
      this.at(0.05, () => this.pumpLive(scanner));
      return;
    }
    scanner.liveBusy = true;
    const d = scanner.desk;
    this.fx.fly(this.office.pileTop(), d.cardSpot, {
      dur: 0.6, height: 1.6,
      onDone: () => {
        scanner.setWorking(true);
        scanner.say(`Scan ${stock.symbol}`, 1.2);
        d.stock = stock;
        drawMonitor(d.screen, { code: stock.symbol, state: 'scan' });
        this.at(0.9, () => {
          this.finishStock(scanner, stock, true);
          scanner.setWorking(false);
          scanner.liveBusy = false;
          this.pumpLive(scanner);
        });
      },
    });
  }

  enqueueAlert(stock) {
    this.courierQueue.push(stock);
    if (!this.courierBusy) this.sendNextAlert();
  }

  sendNextAlert() {
    const c = this.agents.courier;
    const stock = this.courierQueue.shift();
    if (!stock) { this.courierBusy = false; c.setWorking(false); this.checkFinish(); return; }
    this.courierBusy = true;
    c.setWorking(true);
    c.say(`Alert WA: ${stock.symbol}`, 1.2);
    drawMonitor(this.office.courierScreen, { code: stock.symbol, state: 'done', dots: 3, tfs: 'alert terkirim' });
    this.fx.fly(v3(c.root.position.x, 1.6, c.root.position.z - 0.4), this.office.windowPoint, {
      kind: 'plane', color: '#25d366', dur: 1.1, height: 1.2,
    });
    this.alerts++;
    this.ui.setStats(this.statsObj());
    this.at(1.0, () => this.sendNextAlert());
  }

  checkFinish() {
    if (this.mode === 'live') return;
    if (this.finished || this.processed < this.total || this.courierBusy) return;
    this.finished = true;
    const { agents, office } = this;
    agents.tech.setWorking(false);
    this.at(0.8, () => {
      const c = agents.courier;
      c.say('Ringkasan harian terkirim 📨', 2.5);
      this.fx.fly(v3(c.root.position.x, 1.6, c.root.position.z - 0.4), office.windowPoint, { kind: 'plane', color: '#ffffff', dur: 1.3 });
      this.ui.log('📨', `Ringkasan WA: ${this.vip.length} VVIP · ${this.radar.length} radar · ${this.total} saham`);
    });
    this.at(2.0, () => {
      const ar = agents.archivist;
      const front = office.cabinetFront(this.dateKey);
      ar.say('Simpan ke history.json…', 2);
      const done = () => {
        office.highlightCabinet(this.dateKey);
        ar.say(`Arsip ${this.dateKey} tersimpan ✔`, 2.5);
        this.ui.log('🗄️', `Arsiparis: simpan_database_json() → ${this.dateKey}`);
        const { entry, aisleFront, aisleBack } = office.archive;
        const back = ar.root.position.z < -11 ? [aisleBack, aisleFront, entry] : [entry];
        this.at(1.2, () => ar.walkTo([...back, { x: ar.home.x, z: ar.home.z }], () => { ar.root.rotation.y = ar.home.face; }));
        this.at(1.5, () => {
          this.state = 'done';
          this.ui.setPlayState(this.state);
          agents.research.say('Ada saham yang mau dianalisa? Klik aku 💬', 4);
        });
      };
      if (!front) { done(); return; }
      const { entry, aisleFront, aisleBack } = office.archive;
      const path = front.z < -11
        ? [entry, aisleFront, aisleBack, { x: front.x, z: aisleBack.z }] // lorong belakang
        : [entry, { x: front.x, z: entry.z }];
      ar.walkTo(path, () => { ar.root.rotation.y = Math.PI; done(); });
    });
  }

  redrawVip() {
    const rows = [...this.vip].sort((a, b) => gainOf(b) - gainOf(a)).map((s) => ({
      left: s.symbol, right: fmtPct(gainOf(s)), color: gainOf(s) >= 0 ? '#4ade80' : '#f87171',
    }));
    drawBoard(this.office.vipBoard, `VVIP · FULL RALLY GOOD  (${this.vip.length})`,
      `${this.scan?.date_display || ''} · D + 1H + 45M hijau · Do Your Own Research!`, rows);
  }

  redrawWhiteboard() {
    const L = this.signalLists;
    const rows = [
      { left: 'SMC', right: `${L.smc.length} breakout/BOS`, color: '#4ade80' },
      { left: 'DonAlt', right: `${L.golden.length} golden cross`, color: '#facc15' },
      { left: 'MACD', right: `${L.macd.length} bullish`, color: '#f87171' },
      { left: 'Scalp', right: `${L.scalp.length} BUY`, color: '#c084fc' },
    ];
    drawBoard(this.office.whiteboard, 'MEJA ANALIS', 'konfirmasi indikator per saham', rows, '#38bdf8');
  }
}
