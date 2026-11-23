import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './config.js';
import { loadHistory, signalsOf, gainOf } from './data.js';
import { buildOffice } from './office.js';
import { createAgents } from './agents.js';
import { FX } from './fx.js';
import { Replay } from './sim.js';
import { UI } from './ui.js';
import { Chat } from './chat.js';

// ---------- Renderer & scene ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.className = 'labels';
app.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const BG_ON = new THREE.Color('#e8ecef'), BG_OFF = new THREE.Color('#5b6470'); // siang (pasar buka) / sore (tutup)
scene.background = BG_OFF.clone();
scene.fog = new THREE.Fog(BG_OFF.clone(), 46, 100);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(3, 25, 31);
if (camera.aspect < 1) camera.position.set(3, 25, 31).multiplyScalar(1 + (1 - camera.aspect) * 1.1); // layar HP potret
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, -1);
controls.enableDamping = true;
controls.maxPolarAngle = 1.32;
controls.minDistance = 6;
controls.maxDistance = 70;
controls.update();

const hemi = new THREE.HemisphereLight('#f3f6fa', '#8a8378', 0.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff3e2', 0.7);
sun.position.set(-22, 30, -12); // matahari dari sisi jendela kaca
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 22, bottom: -22, near: 1, far: 80 });
sun.shadow.bias = -0.0005;
scene.add(sun);

let lightTarget = 0; // 0 = pasar tutup, 1 = buka
let lightLevel = 0;
function applyLights(level) {
  hemi.intensity = 0.5 + level * 0.9;
  sun.intensity = 0.7 + level * 1.5;
  scene.background.copy(BG_OFF).lerp(BG_ON, level);
  scene.fog.color.copy(scene.background);
}

// ---------- Dunia (model dari Blender: blender/build_office.py & build_agents.py) ----------
document.getElementById('loadText').textContent = 'Memuat model 3D kantor (Blender)…';
const gltfLoader = new GLTFLoader();
const [officeGltf, agentsGltf] = await Promise.all([
  gltfLoader.loadAsync(`assets/office.glb?v=${window.ARANTER_BUILD || ''}`).catch((e) => {
    document.getElementById('loadText').innerHTML = 'Gagal memuat <b>assets/office.glb</b>. Jalankan <code>build-blender.bat</code> dulu.';
    throw e;
  }),
  gltfLoader.loadAsync(`assets/agents.glb?v=${window.ARANTER_BUILD || ''}`).catch((e) => { console.warn('agents.glb gagal, pakai karakter cadangan', e); return null; }),
]);
const office = buildOffice(scene, officeGltf);
office.floorLabels.visible = false;
const agents = createAgents(scene, office, agentsGltf, Math.min(CONFIG.SCANNER_WORKERS, office.desks.length));
const fx = new FX(scene);
let history = null;

const ui = new UI({
  onTogglePlay: () => replay.togglePause(),
  onSpeed: (s) => { replay.speed = s; },
  onDate: (k) => playDate(k, true),
  onStockSymbol: (sym) => {
    const s = replay.scan?.stocks?.find((x) => x.symbol === sym);
    if (s) ui.showStock(s);
  },
  onPanelClose: () => { selectedAgent = null; },
  onGoLive: () => { liveWanted = true; document.getElementById('optLive').checked = true; },
  onLiveToggle: (on) => {
    liveWanted = on;
    if (!on && replay.mode === 'live') { const ds = Object.keys(history.daily_scans).sort(); playDate(ds[ds.length - 1]); }
  },
  onFloorLabels: (on) => { office.floorLabels.visible = on; },
});
let liveWanted = true; // otomatis ikut LIVE saat bot berjalan
const replay = new Replay({ office, agents, fx, ui, onLights: (on) => { lightTarget = on ? 1 : 0; } });
const chat = new Chat({ getHistory: () => history, research: agents.research, screen: office.researchScreen });

function playDate(k, manual = false) {
  if (!history?.daily_scans?.[k]) return;
  if (manual) liveWanted = false;
  ui.selectDate(k);
  replay.load(history.daily_scans[k], k);
}

// ---------- Interaksi (klik objek) ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selectedAgent = null;
let focusTarget = null;
let downAt = null;

function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  for (const h of hits) if (h.object.userData.pick) return h.object.userData.pick;
  return null;
}

renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return; // drag kamera, bukan klik
  const p = pick(e);
  if (!p) return;
  if (p.type === 'research' || (p.type === 'agent' && p.agent.id === 'research')) {
    chat.toggle(true);
    agents.research.say('Mau analisa saham apa? 🙂', 3);
    focusTarget = agents.research.root.position.clone().setY(1);
  } else if (p.type === 'agent') {
    selectedAgent = p.agent;
    ui.showAgent(p.agent);
    focusTarget = p.agent.root.position.clone().setY(1);
  } else if (p.type === 'monitor') {
    const st = office.desks[p.index]?.stock;
    if (st) ui.showStock(st);
    else ui.showAgent(agents.scanners[p.index]);
  } else if (p.type === 'vipboard') {
    ui.showList('VVIP · Full Rally Good', 'D + 1H + 45M hijau (diurutkan gain)', [...(replay.vip || [])].sort((a, b) => gainOf(b) - gainOf(a)));
  } else if (p.type === 'whiteboard') {
    const L = replay.signalLists || { smc: [], golden: [], macd: [], scalp: [] };
    const all = [...new Set([...L.smc, ...L.golden, ...L.macd, ...L.scalp])];
    ui.showList('Konfirmasi Analis', `SMC ${L.smc.length} · DonAlt ${L.golden.length} · MACD ${L.macd.length} · Scalp ${L.scalp.length}`, all);
  } else if (p.type === 'cabinet') {
    playDate(p.date, true);
  }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.buttons) return;
  renderer.domElement.style.cursor = pick(e) ? 'pointer' : 'default';
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Loop ----------
const clock = new THREE.Clock();
let ledT = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  replay.update(dt);
  const wdt = replay.worldDt(dt);
  agents.list.forEach((a) => a.update(wdt));
  fx.update(wdt);

  lightLevel += (lightTarget - lightLevel) * Math.min(1, dt * 2);
  applyLights(lightLevel);

  ledT += wdt;
  const busy = agents.scanners.filter((s) => s.working).length / Math.max(1, agents.scanners.length);
  office.leds.forEach((l, i) => {
    const on = Math.sin(ledT * (2 + busy * 14) + i * 1.7) > (0.6 - busy);
    l.material.emissiveIntensity = on ? 1.4 : 0.1;
  });

  if (selectedAgent) {
    const el = document.getElementById('agentActivity');
    if (el && el.textContent !== selectedAgent.activity) el.textContent = selectedAgent.activity;
  }
  if (focusTarget) {
    const delta = focusTarget.clone().sub(controls.target).multiplyScalar(Math.min(1, dt * 4));
    controls.target.add(delta);
    camera.position.add(delta);
    if (delta.lengthSq() < 1e-5) focusTarget = null;
  }
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});

// ---------- Boot ----------
(async () => {
  ui.setLoading(0.02, 'Menghubungi server Aranter…');
  const { json, source } = await loadHistory((p) => ui.setLoading(p, `Mengunduh history.json… ${Math.round(p * 100)}%`));
  history = json;
  ui.setLoading(1, 'Menyiapkan kantor…');
  ui.setSource(source, json.last_updated);
  const dates = Object.keys(json.daily_scans).sort();
  office.buildCabinets(dates);
  const latest = dates[dates.length - 1];
  ui.setDates(json.daily_scans, latest);
  ui.hideLoading();
  playDate(latest);
  window.__aranter = { replay, agents, office, history, signalsOf, cam: camera };
  window.__chat = chat; // debug helper

  // ---------- Data baru otomatis ----------
  // Bot menyimpan history.json ±11.30 WIB (akhir Sesi I) dan ±16.10 WIB (penutupan). Cek header Last-Modified
  // tiap 3 menit (ringan, tanpa unduh 10 MB); kalau berubah, muat ulang dan putar scan terbaru.
  if (source !== 'demo') {
    const lastModified = async () => {
      try {
        const r = await fetch(source, { method: 'HEAD', cache: 'no-store' });
        return r.ok ? r.headers.get('last-modified') : null;
      } catch { return null; }
    };
    let seen = await lastModified();
    setInterval(async () => {
      const lm = await lastModified();
      if (!lm || lm === seen) return;
      seen = lm;
      const { json: fresh } = await loadHistory(() => {});
      if (!fresh?.daily_scans || fresh.last_updated === history.last_updated) return;
      const prevLatest = Object.keys(history.daily_scans).sort().pop();
      history = fresh;
      window.__aranter.history = fresh;
      chat._symbols = null; // daftar kode saham ikut diperbarui
      const ds = Object.keys(fresh.daily_scans).sort();
      const newest = ds[ds.length - 1];
      office.buildCabinets(ds);
      ui.setSource(source, fresh.last_updated);
      ui.setDates(fresh.daily_scans, replay.dateKey || newest);
      const sc = fresh.daily_scans[newest];
      ui.log('🆕', `Data baru masuk: ${sc.date_display || newest} · ${sc.session_label || ''} ${sc.time_display || ''}`);
      // sedang melihat scan terbaru & replay tidak berjalan → langsung putar data baru
      if (replay.dateKey === prevLatest && replay.state !== 'playing') playDate(newest);
    }, 180000);
  }

  // ---------- LIVE: kejadian realtime dari bot (bridge /api/live) ----------
  const liveUrl = CONFIG.LIVE_API_URL
    || (CONFIG.PUBLIC_API_BASE ? CONFIG.PUBLIC_API_BASE.replace(/\/$/, '') + '/api/live' : null)
    || (CONFIG.CHAT_API_URL ? CONFIG.CHAT_API_URL.replace(/\/api\/analyze.*$/, '/api/live') : null);
  if (liveUrl) {
    let since = 0;
    const poll = async () => {
      let j;
      try {
        const r = await fetch(`${liveUrl}?since=${replay.mode === 'live' ? since : 0}`, { cache: 'no-store' });
        j = await r.json();
      } catch { return; }
      ui.liveAvailable = j.active;
      if (j.active && liveWanted && replay.mode !== 'live') {
        const ds = Object.keys(history.daily_scans).sort();
        replay.goLive(j.meta, j.stocks || [], history.daily_scans[ds[ds.length - 1]]);
        since = j.seq; // kejadian lama sudah terwakili snapshot
        return;
      }
      if (!j.active && replay.mode === 'live') {
        ui.log('⏹️', 'Bot berhenti / sesi selesai · kembali ke replay');
        const ds = Object.keys(history.daily_scans).sort();
        playDate(ds[ds.length - 1]);
      }
      if (replay.mode === 'live') {
        for (const e of j.events || []) replay.liveEvent(e);
        since = j.seq;
      } else {
        ui.setLive(false);
      }
    };
    poll();
    setInterval(poll, 2500);
  }
})();
