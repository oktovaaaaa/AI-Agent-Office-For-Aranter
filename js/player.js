import { Agent } from './agents.js';

const isTyping = (e) => {
  const t = e.target;
  return t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
};
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
const DOUBLE_TAP_MS = 300;
const GRAVITY = 18;
const JUMP_SPEED = 6.2;

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Karakter yang dimainkan pengunjung: WASD / panah (Shift = lari), joystick di layar sentuh.
export class Player {
  constructor(scene, agentsGltf, nav) {
    const model = agentsGltf?.scene.getObjectByName('AGENT_player') || null;
    this.agent = new Agent({
      id: 'player', name: 'Kamu', role: 'Pengunjung kantor', func: '-', desc: 'Ini kamu.',
      look: { shirt: '#f8fafc', acc: null }, home: { x: 0, z: 12.6, face: Math.PI },
    }, scene, model);
    this.agent.manual = true;
    this.agent.root.visible = false;
    this.agent.tag.visible = false;
    this.nav = nav;
    this.keys = new Set();
    this.joy = { x: 0, y: 0 };
    this.active = false;
    this.moving = false;
    this.sprintLatch = false; // aktif setelah W/↑ diketuk 2x cepat, selama tombol masih ditahan
    this.lastTap = { code: '', t: 0 };
    this.vy = 0;             // kecepatan vertikal (lompat)
    this.onGround = true;
    this.jumpQueued = false;

    addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (!e.repeat && (e.code === 'KeyW' || e.code === 'ArrowUp')) {
        const now = performance.now();
        if (this.lastTap.code === e.code && now - this.lastTap.t < DOUBLE_TAP_MS) this.sprintLatch = true;
        this.lastTap = { code: e.code, t: now };
      }
      if (e.code === 'Space' && !e.repeat) this.jump();
      this.keys.add(e.code);
      if (this.active && MOVE_KEYS.includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.sprintLatch = false;
    });
    addEventListener('blur', () => this.keys.clear());
    this.setupJoystick();
  }

  get pos() { return this.agent.root.position; }

  setActive(on, firstPerson = false) {
    this.active = on;
    this.agent.root.visible = on && !firstPerson;
    document.body.classList.toggle('walking', on);
    if (!on) { this.keys.clear(); this.sprintLatch = false; }
  }

  jump() {
    if (this.active && this.onGround) this.jumpQueued = true;
  }

  setupJoystick() {
    const pad = document.getElementById('joy');
    const knob = document.getElementById('joyKnob');
    if (!pad) return;
    let id = null, cx = 0, cy = 0;
    const R = 46;
    const reset = () => { id = null; this.joy.x = this.joy.y = 0; knob.style.transform = 'translate(-50%, -50%)'; };
    pad.addEventListener('pointerdown', (e) => {
      id = e.pointerId; pad.setPointerCapture(id);
      const r = pad.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      this.joy.x = dx / R; this.joy.y = -dy / R;
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    });
    pad.addEventListener('pointerup', reset);
    pad.addEventListener('pointercancel', reset);
    const jb = document.getElementById('jumpBtn');
    if (jb) jb.addEventListener('pointerdown', (e) => { e.preventDefault(); this.jump(); });
  }

  // yaw kamera: arah "maju" = (-sin yaw, -cos yaw)
  update(dt, yaw) {
    if (!this.active) { this.agent.manualSpeed = 0; return; }
    // lompat + gravitasi
    const root = this.agent.root;
    if (this.jumpQueued && this.onGround) { this.vy = JUMP_SPEED; this.onGround = false; }
    this.jumpQueued = false;
    if (!this.onGround) {
      this.vy -= GRAVITY * dt;
      root.position.y += this.vy * dt;
      if (root.position.y <= 0) { root.position.y = 0; this.vy = 0; this.onGround = true; }
    }
    const k = (c) => (this.keys.has(c) ? 1 : 0);
    let f = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') + this.joy.y;
    let s = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft') + this.joy.x;
    const len = Math.min(1, Math.hypot(f, s));
    let speed = 0;
    if (len > 0.05) {
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const rx = -fz, rz = fx;
      let dx = fx * f + rx * s, dz = fz * f + rz * s;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl; dz /= dl;
      const sprint = this.sprintLatch || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || Math.hypot(this.joy.x, this.joy.y) > 0.97;
      this.sprinting = sprint;
      speed = (sprint ? 6.2 : 3.1) * len;
      const pos = this.pos;
      if (this.nav) this.nav.move(pos, dx * speed * dt, dz * speed * dt, 0.28);
      else { pos.x += dx * speed * dt; pos.z += dz * speed * dt; }
      this.agent.root.rotation.y = lerpAngle(this.agent.root.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 12));
    }
    this.moving = speed > 0;
    this.agent.manualSpeed = speed;
    this.agent.airborne = !this.onGround;
    this.agent.update(dt);
  }
}
