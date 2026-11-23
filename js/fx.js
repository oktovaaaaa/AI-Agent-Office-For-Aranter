import * as THREE from 'three';

const cardGeo = new THREE.BoxGeometry(0.36, 0.025, 0.26);
const planeGeo = (() => {
  // pesawat kertas sederhana (2 segitiga)
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([
    0, 0, 0.35, -0.22, 0, -0.25, 0, 0.06, -0.15,
    0, 0, 0.35, 0, 0.06, -0.15, 0.22, 0, -0.25,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
})();

// Objek terbang (kartu saham / pesawat kertas WA) dengan lintasan busur.
export class FX {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  fly(from, to, { color = '#f8fafc', dur = 0.8, height = 1.2, kind = 'card', onDone } = {}) {
    const material = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: kind === 'plane' ? 0.25 : 0.35,
      side: THREE.DoubleSide, transparent: true,
    });
    const mesh = new THREE.Mesh(kind === 'plane' ? planeGeo : cardGeo, material);
    mesh.position.copy(from);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.items.push({ mesh, from: from.clone(), to: to.clone(), t: 0, dur, height, kind, onDone, prev: from.clone() });
  }

  clear() {
    for (const it of this.items) { this.scene.remove(it.mesh); it.mesh.material.dispose(); }
    this.items = [];
  }

  update(dt) {
    if (dt <= 0) return;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t = Math.min(1, it.t + dt / it.dur);
      const e = it.t < 0.5 ? 2 * it.t * it.t : 1 - Math.pow(-2 * it.t + 2, 2) / 2;
      it.prev.copy(it.mesh.position);
      it.mesh.position.lerpVectors(it.from, it.to, e);
      it.mesh.position.y += Math.sin(Math.PI * it.t) * it.height;
      if (it.kind === 'plane') {
        const look = it.mesh.position.clone().add(it.mesh.position.clone().sub(it.prev));
        it.mesh.lookAt(look);
        if (it.t > 0.75) it.mesh.material.opacity = (1 - it.t) / 0.25;
      } else {
        it.mesh.rotation.y += dt * 8;
      }
      if (it.t >= 1) {
        this.scene.remove(it.mesh);
        it.mesh.material.dispose();
        this.items.splice(i, 1);
        it.onDone && it.onDone();
      }
    }
  }
}
