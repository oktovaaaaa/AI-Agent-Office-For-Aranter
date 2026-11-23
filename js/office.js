import * as THREE from 'three';

// ---------- Helper material & canvas ----------
const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...opts }));
  }
  return matCache.get(key);
}

export function canvasPanel(w, h, ppu = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * ppu);
  canvas.height = Math.round(h * ppu);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true }),
  );
  return { mesh, canvas, ctx: canvas.getContext('2d'), tex };
}

function floorLabel(parent, text, pos, w = 6) {
  const p = canvasPanel(w, 0.9, 96);
  const { ctx, canvas } = p;
  ctx.font = `600 ${Math.round(canvas.height * 0.42)}px Inter, system-ui, sans-serif`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
  ctx.fillStyle = 'rgba(31,35,40,0.38)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  p.tex.needsUpdate = true;
  p.mesh.rotation.x = -Math.PI / 2;
  p.mesh.position.copy(pos);
  parent.add(p.mesh);
}

// ---------- Gambar layar ----------
const DOT_COLORS = ['#64748b', '#f59e0b', '#facc15', '#22c55e'];

export function drawMonitor(screen, { code = '', state = 'idle', dots = 0, tfs = '' } = {}) {
  const { ctx, canvas, tex } = screen;
  const W = canvas.width, H = canvas.height;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  if (state === 'done') {
    grad.addColorStop(0, dots >= 3 ? '#064e2b' : dots === 2 ? '#4a3b06' : '#1e293b');
    grad.addColorStop(1, '#0b1220');
  } else {
    grad.addColorStop(0, '#0f2a4a');
    grad.addColorStop(1, '#0b1220');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (state === 'idle') {
    ctx.fillStyle = '#38bdf8';
    ctx.font = `800 ${H * 0.2}px Inter, sans-serif`;
    ctx.fillText('ARANTER', W / 2, H * 0.42);
    ctx.fillStyle = '#64748b';
    ctx.font = `600 ${H * 0.1}px Inter, sans-serif`;
    ctx.fillText('standby', W / 2, H * 0.66);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${H * 0.3}px Inter, sans-serif`;
    ctx.fillText(code, W / 2, H * 0.36);
    if (state === 'scan') {
      ctx.fillStyle = '#7dd3fc';
      ctx.font = `600 ${H * 0.11}px Inter, sans-serif`;
      ctx.fillText('scan D · 1H · 45M …', W / 2, H * 0.68);
    } else {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(W / 2 + (i - 1) * H * 0.2, H * 0.7, H * 0.07, 0, Math.PI * 2);
        ctx.fillStyle = i < dots ? DOT_COLORS[3] : '#334155';
        ctx.fill();
      }
      ctx.fillStyle = '#cbd5e1';
      ctx.font = `600 ${H * 0.09}px Inter, sans-serif`;
      ctx.fillText(tfs || `${dots}/3 Rally Good`, W / 2, H * 0.88);
    }
  }
  tex.needsUpdate = true;
}

export function drawBoard(panel, title, subtitle, rows, accent = '#22c55e') {
  const { ctx, canvas, tex } = panel;
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, H * 0.16);
  ctx.fillStyle = '#04110a';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${H * 0.085}px Inter, sans-serif`;
  ctx.fillText(title, W * 0.03, H * 0.08);
  ctx.fillStyle = '#94a3b8';
  ctx.font = `600 ${H * 0.05}px Inter, sans-serif`;
  ctx.fillText(subtitle, W * 0.03, H * 0.22);
  const cols = 3, perCol = 9;
  const maxItems = cols * perCol;
  const shown = rows.slice(0, rows.length > maxItems ? maxItems - 1 : maxItems);
  ctx.font = `700 ${H * 0.058}px Inter, sans-serif`;
  shown.forEach((r, i) => {
    const col = Math.floor(i / perCol), row = i % perCol;
    const x = W * 0.03 + col * (W / cols);
    const y = H * 0.32 + row * H * 0.075;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(r.left, x, y);
    ctx.fillStyle = r.color || accent;
    ctx.fillText(r.right, x + W * 0.13, y);
  });
  if (rows.length > maxItems) {
    ctx.fillStyle = '#94a3b8';
    const i = maxItems - 1;
    ctx.fillText(`+${rows.length - shown.length} lainnya`, W * 0.03 + 2 * (W / cols), H * 0.32 + (i % perCol) * H * 0.075);
  }
  if (!rows.length) {
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'center';
    ctx.fillText('menunggu sinyal …', W / 2, H * 0.6);
  }
  tex.needsUpdate = true;
}

// state: true / 'open' = PASAR BUKA, false / 'closed' = PASAR TUTUP, 'closing' = penutupan (audit),
//        'break' = istirahat siang, 'replay' = memutar ulang data tersimpan
const SIGN = {
  open: ['PASAR BUKA', '#065f46', '#34d399'],
  closed: ['PASAR TUTUP', '#7f1d1d', '#f87171'],
  closing: ['PASAR TUTUP', '#92400e', '#fbbf24'],
  break: ['ISTIRAHAT', '#1e3a5f', '#60a5fa'],
  replay: ['REPLAY', '#334155', '#94a3b8'],
};
export function drawSign(panel, state, text) {
  const { ctx, canvas, tex } = panel;
  const W = canvas.width, H = canvas.height;
  const key = state === true ? 'open' : state === false ? 'closed' : state;
  const [title, bg, line] = SIGN[key] || SIGN.closed;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = line;
  ctx.lineWidth = H * 0.06;
  ctx.strokeRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${H * 0.36}px Inter, sans-serif`;
  ctx.fillText(title, W / 2, H * 0.38);
  ctx.font = `600 ${H * 0.2}px Inter, sans-serif`;
  ctx.fillText(text || '', W / 2, H * 0.74);
  tex.needsUpdate = true;
}


// ---------- Bangun kantor dari assets/office.glb (hasil blender/build_office.py) ----------
// Posisi meja, layar, dan agen dibaca dari anchor bernama di Blender.
export function buildOffice(scene, gltf) {
  const root = gltf.scene;
  scene.add(root);
  root.updateMatrixWorld(true);
  const pickables = [];
  const nodes = {};
  root.traverse((o) => {
    if (o.name) nodes[o.name] = o;
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      const m = o.material;
      if (m?.name === 'Glass') { m.transparent = true; m.opacity = 0.16; m.depthWrite = false; o.castShadow = false; }
      if (m?.name === 'Frosted') { m.transparent = true; m.opacity = 0.55; m.depthWrite = false; o.castShadow = false; }
      if (m?.name === 'Water') { m.transparent = true; m.opacity = 0.6; }
      if (m?.name === 'LogoDecal') { m.transparent = false; m.alphaTest = 0.5; o.castShadow = false; }
      if (/^(Floor|Carpet|City|LightBar)/.test(m?.name || '')) o.castShadow = false;
      if (/^City/.test(o.name) || /^City/.test(o.parent?.name || '')) o.receiveShadow = false;
    }
  });
  const byPrefix = (p) => Object.keys(nodes).filter((k) => k.startsWith(p)).sort().map((k) => nodes[k]);
  const wpos = (o) => o.getWorldPosition(new THREE.Vector3());
  const point = (name, fallback) => (nodes['POINT_' + name] ? wpos(nodes['POINT_' + name]) : fallback);

  // Layar dinamis (canvas) di posisi SCREEN_<nama>
  const screens = {};
  for (const o of byPrefix('SCREEN_')) {
    const u = o.userData || {};
    const p = canvasPanel(u.w || 1, u.h || 0.6, u.ppu || 200);
    p.mesh.position.copy(wpos(o));
    p.mesh.rotation.y = u.yaw || 0;
    scene.add(p.mesh);
    screens[o.name.slice(7)] = p;
  }

  // Agen: rumah / posisi berdiri
  const homes = {};
  for (const o of byPrefix('AGENT_HOME_')) {
    const p = wpos(o);
    homes[o.name.slice(11)] = { x: p.x, z: p.z, face: o.userData?.face || 0 };
  }

  // Tulisan zona di lantai
  const floorLabels = new THREE.Group(); // tulisan zona di lantai (bisa dimatikan dari Pengaturan)
  scene.add(floorLabels);
  for (const o of byPrefix('LABEL_')) floorLabel(floorLabels, o.userData?.text || '', wpos(o), o.userData?.w || 6);

  // Meja scanner
  const desks = [];
  for (let i = 1; screens['scanner' + i]; i++) {
    const s = screens['scanner' + i];
    s.mesh.userData.pick = { type: 'monitor', index: i - 1 };
    pickables.push(s.mesh);
    drawMonitor(s);
    desks.push({ screen: s, cardSpot: point('card_scanner' + i, s.mesh.position.clone()), home: homes['scanner' + i] });
  }

  // Papan & layar khusus
  const vipBoard = screens.vipboard;
  vipBoard.mesh.userData.pick = { type: 'vipboard' };
  const whiteboard = screens.whiteboard;
  whiteboard.mesh.userData.pick = { type: 'whiteboard' };
  const research = screens.research;
  research.mesh.userData.pick = { type: 'research' };
  pickables.push(vipBoard.mesh, whiteboard.mesh, research.mesh);
  drawSign(screens.sign, false, 'menunggu data…');
  drawMonitor(screens.courier);
  drawMonitor(screens.hunter);

  // Tumpukan kartu hunter (dinamis)
  const pileBase = point('pile', new THREE.Vector3(-14.2, 0.84, 3.05));
  const pile = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1, 0.4), mat('#f8fafc'));
  pile.geometry.translate(0, 0.5, 0);
  pile.position.copy(pileBase);
  pile.scale.y = 0.001;
  pile.castShadow = true;
  scene.add(pile);

  // LED server (material dipisah agar bisa berkedip sendiri-sendiri)
  const leds = byPrefix('LED_').map((o) => {
    let mesh = o.isMesh ? o : null;
    o.traverse((c) => { if (!mesh && c.isMesh) mesh = c; });
    mesh.material = mesh.material.clone();
    return mesh;
  });

  // Kabinet arsip: CABINET_00..23 dipetakan ke 24 tanggal terakhir
  const cabinetNodes = byPrefix('CABINET_');
  let cabinets = [];
  const labelGroup = new THREE.Group();
  scene.add(labelGroup);
  cabinetNodes.forEach((o) => o.traverse((c) => { if (c.isMesh) c.material = c.material.clone(); }));
  function buildCabinets(dates) {
    labelGroup.clear();
    cabinets.forEach((c) => c.meshes.forEach((m) => { const i = pickables.indexOf(m); if (i >= 0) pickables.splice(i, 1); }));
    cabinets = [];
    const list = dates.slice(-cabinetNodes.length);
    list.forEach((date, i) => {
      const node = cabinetNodes[i];
      const p = wpos(node);
      const meshes = [];
      node.traverse((c) => { if (c.isMesh) { c.userData.pick = { type: 'cabinet', date }; meshes.push(c); pickables.push(c); } });
      const lab = canvasPanel(0.42, 0.2, 200);
      const [, mm, dd] = date.split('-');
      lab.ctx.fillStyle = '#f8fafc';
      lab.ctx.fillRect(0, 0, lab.canvas.width, lab.canvas.height);
      lab.ctx.fillStyle = '#0f172a';
      lab.ctx.font = '800 26px Inter, sans-serif';
      lab.ctx.textAlign = 'center';
      lab.ctx.textBaseline = 'middle';
      lab.ctx.fillText(`${dd}/${mm}`, lab.canvas.width / 2, lab.canvas.height / 2);
      lab.tex.needsUpdate = true;
      lab.mesh.position.set(p.x, 1.24, p.z + 0.32);
      labelGroup.add(lab.mesh);
      cabinets.push({ date, meshes, front: new THREE.Vector3(p.x, 0, p.z < -11 ? -12.1 : p.z + 1.1) });
    });
  }
  function highlightCabinet(date) {
    cabinets.forEach((c) => c.meshes.forEach((m) => {
      m.material.emissive.set(c.date === date ? '#f59e0b' : '#000000');
      m.material.emissiveIntensity = c.date === date ? 0.55 : 0;
    }));
  }

  return {
    root, pickables, desks, screens, homes, leds, vipBoard, whiteboard, floorLabels,
    sign: screens.sign, hunterScreen: screens.hunter, courierScreen: screens.courier, researchScreen: research,
    windowPoint: point('window', new THREE.Vector3(-1, 2.4, -13.8)),
    analystTable: point('analyst_table', new THREE.Vector3(15.6, 0.9, 2.2)),
    vipCardPoint: point('vip_card', new THREE.Vector3(-14, 2.2, -13.5)),
    archive: {
      entry: point('archive_entry', new THREE.Vector3(16, 0, -9.2)),
      aisleFront: point('archive_aisle_front', new THREE.Vector3(12.1, 0, -9.2)),
      aisleBack: point('archive_aisle_back', new THREE.Vector3(12.1, 0, -12.1)),
    },
    pileTop: () => new THREE.Vector3(pileBase.x, pileBase.y + pile.scale.y + 0.05, pileBase.z),
    setPile(n, max) { pile.scale.y = Math.max(0.001, Math.min(1.6, (n / Math.max(1, max)) * 1.6)); },
    buildCabinets, highlightCabinet,
    cabinetFront(date) { return cabinets.find((c) => c.date === date)?.front || null; },
  };
}

// Layar terminal agen riset (gaya CLI)
export function drawTerminal(screen, lines, title = 'aranter — analis riset') {
  const { ctx, canvas, tex } = screen;
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, W, H * 0.12);
  ['#ef4444', '#f59e0b', '#22c55e'].forEach((c, i) => {
    ctx.beginPath(); ctx.arc(H * 0.06 + i * H * 0.07, H * 0.06, H * 0.022, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
  });
  ctx.fillStyle = '#94a3b8';
  ctx.font = `600 ${H * 0.06}px ui-monospace, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, W / 2, H * 0.06);
  ctx.textAlign = 'left';
  ctx.font = `600 ${H * 0.075}px ui-monospace, Consolas, monospace`;
  lines.slice(-8).forEach((ln, i) => {
    ctx.fillStyle = ln.startsWith('>') ? '#38bdf8' : ln.startsWith('✔') ? '#4ade80' : ln.startsWith('!') ? '#f87171' : '#cbd5e1';
    ctx.fillText(ln.slice(0, 34), W * 0.04, H * 0.2 + i * H * 0.1);
  });
  tex.needsUpdate = true;
}
