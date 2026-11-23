import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mat } from './office.js';

function part(parent, geo, color, [x, y, z], opts = {}) {
  const m = new THREE.Mesh(geo, mat(color, opts));
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

// Karakter low-poly, menghadap +z.
function makeCharacter(look) {
  const { shirt, pants = '#2d3142', skin = '#d9a066', hair = '#2b1d14', acc = null } = look;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const legs = [];
  for (const sx of [-0.15, 0.15]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx, 0.85, 0);
    body.add(pivot);
    part(pivot, new THREE.BoxGeometry(0.2, 0.8, 0.22), pants, [0, -0.4, 0]);
    part(pivot, new THREE.BoxGeometry(0.22, 0.1, 0.32), '#1b1b1b', [0, -0.8, 0.05]);
    legs.push(pivot);
  }
  part(body, new THREE.BoxGeometry(0.62, 0.78, 0.36), shirt, [0, 1.25, 0]);
  const arms = [];
  for (const sx of [-0.4, 0.4]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx, 1.58, 0);
    body.add(pivot);
    part(pivot, new THREE.BoxGeometry(0.16, 0.64, 0.18), shirt, [0, -0.32, 0]);
    part(pivot, new THREE.SphereGeometry(0.09, 8, 6), skin, [0, -0.68, 0]);
    arms.push(pivot);
  }
  const head = new THREE.Group();
  head.position.set(0, 1.95, 0);
  body.add(head);
  part(head, new THREE.SphereGeometry(0.28, 16, 12), skin, [0, 0, 0]);
  const hairM = part(head, new THREE.SphereGeometry(0.295, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, [0, 0.02, -0.02]);
  hairM.rotation.x = -0.25;
  for (const ex of [-0.1, 0.1]) part(head, new THREE.BoxGeometry(0.06, 0.07, 0.02), '#111', [ex, 0.02, 0.27]);

  if (acc === 'cap' || acc === 'police') {
    const c = acc === 'police' ? '#1e3a8a' : '#25d366';
    part(head, new THREE.CylinderGeometry(0.31, 0.31, 0.14, 16), c, [0, 0.22, 0]);
    part(head, new THREE.BoxGeometry(0.36, 0.03, 0.22), c, [0, 0.16, 0.25]);
  }
  if (acc === 'glasses') {
    for (const ex of [-0.1, 0.1]) part(head, new THREE.TorusGeometry(0.06, 0.012, 6, 12), '#111', [ex, 0.02, 0.28]);
  }
  if (acc === 'headset') {
    part(head, new THREE.TorusGeometry(0.3, 0.025, 6, 16, Math.PI), '#111', [0, 0.05, 0]).rotation.z = 0;
    part(head, new THREE.BoxGeometry(0.08, 0.14, 0.1), '#ef4444', [0.3, 0, 0]);
  }
  if (acc === 'tie') {
    part(body, new THREE.BoxGeometry(0.1, 0.45, 0.02), '#dc2626', [0, 1.3, 0.19]);
  }
  if (acc === 'hood') {
    part(head, new THREE.SphereGeometry(0.32, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), shirt, [0, 0, -0.04]).rotation.x = -0.5;
  }
  return { root, body, legL: legs[0], legR: legs[1], armL: arms[0], armR: arms[1], head };
}

// Ambil pivot dari karakter Blender (AGENT_<id> / <id>_body / <id>_legL …)
function partsFromModel(model, id) {
  const get = (n) => model.getObjectByName(`${id}_${n}`);
  const parts = { root: model, body: get('body'), legL: get('legL'), legR: get('legR'), armL: get('armL'), armR: get('armR'), head: get('head') };
  return Object.values(parts).every(Boolean) ? parts : null;
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Agent {
  constructor(def, scene, model = null) {
    Object.assign(this, def);
    this.parts = model ? partsFromModel(model, def.id) : null;
    if (!this.parts) this.parts = makeCharacter(def.look); // cadangan kalau agents.glb tidak punya karakter ini
    this.root = this.parts.root;
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.root.position.set(def.home.x, 0, def.home.z);
    this.root.rotation.y = def.home.face;
    this.root.traverse((o) => { if (o.isMesh) o.userData.pick = { type: 'agent', agent: this }; });
    scene.add(this.root);

    const tag = document.createElement('div');
    tag.className = 'nametag';
    tag.textContent = def.name;
    this.tag = new CSS2DObject(tag);
    this.tag.position.set(0, 2.5, 0);
    this.root.add(this.tag);

    this.bubbleEl = document.createElement('div');
    this.bubbleEl.className = 'bubble';
    const bub = new CSS2DObject(this.bubbleEl);
    bub.position.set(0, 2.9, 0);
    this.root.add(bub);

    this.state = 'idle';
    this.working = false;
    this.path = [];
    this.bubbleT = 0;
    this.activity = 'Menunggu tugas';
    this.stats = {};
    this.phase = Math.random() * 10;
  }

  say(text, sec = 2.4) {
    this.bubbleEl.textContent = text;
    this.bubbleEl.classList.add('show');
    this.bubbleT = sec;
    this.activity = text;
  }

  get bubbleBusy() { return this.bubbleT > 0.5; }

  setWorking(on) { this.working = on; if (this.state !== 'walk') this.state = on ? 'work' : 'idle'; }

  walkTo(points, onArrive) {
    this.path = points.map((p) => new THREE.Vector3(p.x, 0, p.z));
    this.onArrive = onArrive || null;
    this.state = 'walk';
  }

  goHome(cb) {
    this.walkTo([{ x: this.home.x, z: this.home.z }], () => { this.root.rotation.y = this.home.face; cb && cb(); });
  }

  resetPose() {
    this.path = [];
    this.onArrive = null;
    this.root.position.set(this.home.x, 0, this.home.z);
    this.root.rotation.y = this.home.face;
    this.setWorking(false);
    this.state = 'idle';
    this.bubbleT = 0;
    this.bubbleEl.classList.remove('show');
    this.activity = 'Menunggu tugas';
    this.stats = {};
  }

  update(dt) {
    if (dt <= 0) return;
    this.phase += dt;
    if (this.bubbleT > 0) {
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) this.bubbleEl.classList.remove('show');
    }
    const p = this.parts;
    const k = Math.min(1, dt * 10);
    if (this.state === 'walk' && this.path.length) {
      const pos = this.root.position;
      const tgt = this.path[0];
      const d = new THREE.Vector3(tgt.x - pos.x, 0, tgt.z - pos.z);
      const dist = d.length();
      const step = 2.8 * dt;
      if (dist <= step) {
        pos.set(tgt.x, 0, tgt.z);
        this.path.shift();
        if (!this.path.length) {
          this.state = this.working ? 'work' : 'idle';
          const cb = this.onArrive;
          this.onArrive = null;
          cb && cb();
        }
      } else {
        d.normalize();
        pos.addScaledVector(d, step);
        this.root.rotation.y = lerpAngle(this.root.rotation.y, Math.atan2(d.x, d.z), k);
      }
      const s = Math.sin(this.phase * 11) * 0.6;
      p.legL.rotation.x = s; p.legR.rotation.x = -s;
      p.armL.rotation.x = -s * 0.8; p.armR.rotation.x = s * 0.8;
      p.body.position.y = Math.abs(Math.sin(this.phase * 11)) * 0.05;
      p.head.rotation.x = 0;
    } else if (this.state === 'work') {
      p.legL.rotation.x += (0 - p.legL.rotation.x) * k;
      p.legR.rotation.x += (0 - p.legR.rotation.x) * k;
      p.armL.rotation.x = -1.05 + Math.sin(this.phase * 22) * 0.12;
      p.armR.rotation.x = -1.05 + Math.sin(this.phase * 22 + 1.7) * 0.12;
      p.head.rotation.x = 0.18 + Math.sin(this.phase * 3) * 0.04;
      p.body.position.y = 0;
    } else {
      for (const l of [p.legL, p.legR, p.armL, p.armR]) l.rotation.x += (0 - l.rotation.x) * k;
      p.head.rotation.x += (0 - p.head.rotation.x) * k;
      p.head.rotation.y = Math.sin(this.phase * 0.7) * 0.25;
      p.body.position.y = Math.sin(this.phase * 2) * 0.012;
    }
  }
}

// Definisi agen — dipetakan ke fungsi nyata di bot_hunter.py.
// Posisi rumah tiap agen dibaca dari anchor AGENT_HOME_<id> di office.glb.
export function createAgents(scene, office, agentsGltf, workerCount) {
  const list = [];
  const H = office.homes;
  const add = (def) => {
    const home = def.home || H[def.id] || { x: 0, z: 0, face: 0 };
    const model = agentsGltf?.scene.getObjectByName('AGENT_' + def.id) || null;
    const a = new Agent({ ...def, home }, scene, model);
    list.push(a);
    return a;
  };

  const guard = add({
    id: 'guard', name: 'Satpam Pasar', role: 'Penjaga jam bursa IDX',
    func: 'check_bbca_market_status() · get_current_idx_session()',
    desc: 'Mengecek apakah pasar buka lewat harga BBCA dan menentukan sesi (Sesi I, Sesi II, Penutupan). Kalau pasar tutup, lampu kantor redup dan scan dibatalkan.',
    look: { shirt: '#1e3a8a', acc: 'police' },
  });
  const hunter = add({
    id: 'hunter', name: 'Hunter', role: 'Screener TradingView',
    func: 'get_hunter_stocks()',
    desc: 'Menyaring saham IDX Rp10–Rp1.000 dengan volume > rata-rata 10 hari & lonjakan volume pre-market ≥ 500%. Hasilnya jadi tumpukan kartu saham.',
    look: { shirt: '#b45309', hair: '#111', acc: 'hood' },
  });
  const scanners = office.desks.slice(0, workerCount).map((d, i) => add({
    id: 'scanner' + (i + 1), name: 'Scanner #' + (i + 1), role: 'Worker Playwright (Chromium)',
    func: 'scan_stock_rallygood(page, stock_info, worker_id)',
    desc: 'Membuka chart TradingView per saham dan mendeteksi Dot Green (人•ᴗ•)RallyGood di timeframe D, 1H, dan 45M/15M dalam 30 hari terakhir.',
    look: { shirt: ['#0ea5e9', '#6366f1', '#14b8a6', '#8b5cf6', '#06b6d4', '#3b82f6'][i % 6] },
    desk: d,
  }));
  const analysts = {
    smc: add({ id: 'smc', name: 'Analis SMC', role: 'Supply & Demand 1D/1H',
      func: 'parse_real_smc_levels() · calculate_smc_levels_fallback()',
      desc: 'Membaca level Supply/Demand dari Ultimate SMC Suite, mendeteksi Breakout Supply, BOS, dan CHoCH 7 hari terakhir.',
      look: { shirt: '#16a34a', acc: 'glasses' } }),
    donalt: add({ id: 'donalt', name: 'Analis DonAlt', role: 'EMA Golden Cross',
      func: 'format_donalt_wa() · format_donalt_notepad()',
      desc: 'Mencari sinyal DonAlt Golden Cross (bullish reversal) di setiap timeframe.',
      look: { shirt: '#ca8a04' } }),
    macd: add({ id: 'macd', name: 'Analis MACD', role: 'Momentum MACD',
      func: 'format_macd_wa() · format_macd_notepad()',
      desc: 'Mencatat MACD bullish cross sebagai konfirmasi momentum.',
      look: { shirt: '#dc2626', acc: 'glasses' } }),
    scalp: add({ id: 'scalp', name: 'Analis Scalp', role: 'Scalping & Swing',
      func: 'format_scalping_wa() · format_scalping_notepad()',
      desc: 'Menilai trend scalping (BUY/Green vs SELL/Red) dan sinyal BUY yang belum reversal.',
      look: { shirt: '#9333ea' } }),
  };
  const manager = add({
    id: 'manager', name: 'Manajer VVIP', role: 'Kurasi Full Rally Good',
    func: 'check_and_send_instant_alert() · kategori 3 TF / 2 TF',
    desc: 'Saham dengan 3 timeframe hijau naik ke papan VVIP ("ANALISA SAHAM INI"), 2 timeframe masuk radar ("PANTAU SAHAM INI").',
    look: { shirt: '#111827', acc: 'tie' },
  });
  const courier = add({
    id: 'courier', name: 'Kurir WhatsApp', role: 'Notifikasi Fonnte',
    func: 'kirim_whatsapp() · kirim_pesan_summary_wa()',
    desc: 'Mengirim alert instan & ringkasan harian ke grup WhatsApp lewat API Fonnte.',
    look: { shirt: '#25d366', acc: 'cap' },
  });
  const tech = add({
    id: 'tech', name: 'Teknisi Server', role: 'Monitor hardware & cleanup',
    func: 'HardwareMonitor · bersihkan_screenshot()',
    desc: 'Memantau beban CPU/RAM selama worker berjalan dan membersihkan screenshot sementara agar disk tidak penuh.',
    look: { shirt: '#475569', acc: 'headset' },
  });
  const archivist = add({
    id: 'archivist', name: 'Arsiparis', role: 'Database & riwayat 1 bulan',
    func: 'simpan_database_json() → docs/data/history.json',
    desc: 'Menyimpan hasil scan ke history.json (rotasi 1 bulan) yang dibaca dashboard aranter.web.id dan kantor ini.',
    look: { shirt: '#a16207', acc: 'glasses' },
  });
  const research = add({
    id: 'research', name: 'Analis Riset AI', role: 'Chatbot riset saham',
    func: 'POST /api/chat · /api/analyze → server/analyst_bridge.py',
    desc: 'Klik aku untuk bertanya apa saja seputar saham: jumlah saham di screener, radar 2 dot, analisa dot green, berita good/bad news, atau perbandingan saham. Pertanyaan di luar topik saham akan kutolak dengan sopan.',
    look: { shirt: '#0f172a', acc: 'glasses' },
  });
  return { list, guard, hunter, scanners, analysts, manager, courier, tech, archivist, research };
}
