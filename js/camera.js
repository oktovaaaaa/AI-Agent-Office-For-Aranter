import * as THREE from 'three';

// Preset sudut pandang mode Drone: posisi kamera & titik yang dilihat (koordinat dunia)
export const VIEWS = {
  iso: { label: 'Isometrik', pos: [3, 25, 31], target: [0, 0, -1] },
  top: { label: 'Atas', pos: [0, 46, 0.6], target: [0, 0, 0] },
  front: { label: 'Depan', pos: [0, 6.5, 24], target: [0, 1.4, 2] },
  vip: { label: 'Lounge VVIP', pos: [-7.5, 6, -2.5], target: [-14, 1.4, -10.5] },
  analyst: { label: 'Ruang Analis', pos: [8.5, 6.5, 9.5], target: [15.6, 1, 2.2] },
  research: { label: 'Riset AI', pos: [-9, 5, 16.5], target: [-14.5, 1, 10] },
  scanner: { label: 'Scanner', pos: [1, 7, 12], target: [1, 0.8, 1.5] },
};

// Mode kamera: 'drone' (orbit bebas), 'third' (jalan, orang ke-3), 'first' (mata, orang pertama)
export class CameraRig {
  constructor(camera, controls, dom, obstacles) {
    Object.assign(this, { camera, controls, dom, obstacles });
    this.mode = 'drone';
    this.yaw = 0;          // 0 = kamera di belakang pemain menghadap -z
    this.pitch = 0.32;
    this.dist = 4.4;
    this.tween = null;
    this.ray = new THREE.Raycaster();
    this.head = new THREE.Vector3();

    let drag = null;
    dom.addEventListener('pointerdown', (e) => { if (this.mode !== 'drone') drag = { x: e.clientX, y: e.clientY }; });
    addEventListener('pointerup', () => { drag = null; });
    dom.addEventListener('pointermove', (e) => {
      if (!drag || this.mode === 'drone') return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY };
      this.yaw -= dx * 0.005;
      const [lo, hi] = this.mode === 'first' ? [-0.7, 0.9] : [0.05, 1.15];
      this.pitch = Math.min(hi, Math.max(lo, this.pitch + dy * 0.004));
    });
    dom.addEventListener('wheel', (e) => {
      if (this.mode !== 'third') return;
      e.preventDefault();
      this.dist = Math.min(10, Math.max(2.2, this.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
    }, { passive: false });
  }

  forward() { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }

  setMode(mode, player) {
    const prev = this.mode;
    this.mode = mode;
    this.controls.enabled = mode === 'drone';
    if (mode === 'first') this.pitch = 0.1;
    if (mode === 'third' && prev !== 'third') this.pitch = 0.32;
    if (mode === 'drone' && prev !== 'drone' && player) {
      // kembali ke drone tepat di atas posisi pemain
      const p = player.pos;
      this.flyTo([p.x + 6, 14, p.z + 12], [p.x, 0.5, p.z]);
    }
  }

  flyTo(pos, target, sec = 1.1) {
    this.tween = {
      t: 0, sec,
      p0: this.camera.position.clone(), p1: new THREE.Vector3(...pos),
      t0: this.controls.target.clone(), t1: new THREE.Vector3(...target),
    };
  }

  view(name) {
    const v = VIEWS[name];
    if (v) this.flyTo(v.pos, v.target);
  }

  update(dt, player) {
    if (this.mode === 'drone') {
      if (this.tween) {
        const tw = this.tween;
        tw.t = Math.min(1, tw.t + dt / tw.sec);
        const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - Math.pow(-2 * tw.t + 2, 3) / 2;
        this.camera.position.lerpVectors(tw.p0, tw.p1, e);
        this.controls.target.lerpVectors(tw.t0, tw.t1, e);
        if (tw.t >= 1) this.tween = null;
      }
      this.controls.update();
      return;
    }
    this.tween = null;
    const p = player.pos;
    const f = this.forward();
    if (this.mode === 'first') {
      this.head.set(p.x + f.x * 0.12, 1.72, p.z + f.z * 0.12);
      this.camera.position.copy(this.head);
      const c = Math.cos(this.pitch);
      this.camera.lookAt(this.head.x + f.x * c, this.head.y - Math.sin(this.pitch), this.head.z + f.z * c);
      return;
    }
    // orang ke-3: kamera di belakang & atas pemain, tidak menembus dinding/furnitur
    this.head.set(p.x, 1.55, p.z);
    const c = Math.cos(this.pitch);
    const off = new THREE.Vector3(Math.sin(this.yaw) * c, Math.sin(this.pitch), Math.cos(this.yaw) * c);
    let d = this.dist;
    this.ray.set(this.head, off);
    this.ray.far = d;
    const hit = this.ray.intersectObjects(this.obstacles, false)[0];
    if (hit) d = Math.max(0.6, hit.distance - 0.25);
    const want = this.head.clone().addScaledVector(off, d);
    this.camera.position.lerp(want, 1 - Math.exp(-dt * 14));
    this.camera.lookAt(this.head);
  }
}
