// Peta navigasi dari assets/navgrid.json (dibuat blender/build_office.py lewat ray-cast).
// Dipakai untuk tabrakan karakter pemain dan pencarian jalan (A*) agen yang menghampiri pemain.

const BOUNDS = { minX: -19.6, maxX: 19.6, minZ: -13.6, maxZ: 13.5 }; // dinding luar & dinding depan rendah

export class NavGrid {
  constructor(g) {
    Object.assign(this, { x0: g.x0, z0: g.z0, cell: g.cell, w: g.w, h: g.h });
    this.cells = new Uint8Array(g.w * g.h);
    g.rows.forEach((row, iz) => { for (let ix = 0; ix < g.w; ix++) this.cells[iz * g.w + ix] = row.charCodeAt(ix) === 49 ? 1 : 0; });
  }

  static async load(url) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      return new NavGrid(await r.json());
    } catch (e) {
      console.warn('navgrid tidak tersedia, tabrakan hanya batas ruangan', e);
      return null;
    }
  }

  ix(x) { return Math.floor((x - this.x0) / this.cell); }
  iz(z) { return Math.floor((z - this.z0) / this.cell); }
  center(ix, iz) { return { x: this.x0 + (ix + 0.5) * this.cell, z: this.z0 + (iz + 0.5) * this.cell }; }

  blockedCell(ix, iz) {
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.h) return true;
    return this.cells[iz * this.w + ix] === 1;
  }

  // titik bebas untuk lingkaran berjari-jari r?
  free(x, z, r = 0.25) {
    if (x - r < BOUNDS.minX || x + r > BOUNDS.maxX || z - r < BOUNDS.minZ || z + r > BOUNDS.maxZ) return false;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7]]) {
      if (this.blockedCell(this.ix(x + dx), this.iz(z + dz))) return false;
    }
    return true;
  }

  // gerak dengan "meluncur" di sepanjang rintangan (per sumbu)
  move(pos, dx, dz, r = 0.25) {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.1));
    const sx = dx / steps, sz = dz / steps;
    for (let i = 0; i < steps; i++) {
      if (this.free(pos.x + sx, pos.z, r)) pos.x += sx;
      if (this.free(pos.x, pos.z + sz, r)) pos.z += sz;
    }
    return pos;
  }

  nearestFree(x, z, r = 0.3, maxRing = 12) {
    if (this.free(x, z, r)) return { x, z };
    const cx = this.ix(x), cz = this.iz(z);
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const c = this.center(cx + dx, cz + dz);
          if (this.free(c.x, c.z, r)) return c;
        }
      }
    }
    return { x, z };
  }

  lineFree(a, b, r = 0.3) {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (this.cell * 0.5));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (!this.free(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, r)) return false;
    }
    return true;
  }

  // A* di grid (8 arah), lalu dirapikan dengan line-of-sight → daftar titik {x,z}
  path(from, to, r = 0.3) {
    const s = this.nearestFree(from.x, from.z, r);
    const g = this.nearestFree(to.x, to.z, r);
    if (this.lineFree(s, g, r)) return [g];
    const W = this.w, start = this.iz(s.z) * W + this.ix(s.x), goal = this.iz(g.z) * W + this.ix(g.x);
    const ok = (i) => { const c = this.center(i % W, Math.floor(i / W)); return this.free(c.x, c.z, r); };
    const gScore = new Float32Array(W * this.h).fill(Infinity);
    const came = new Int32Array(W * this.h).fill(-1);
    const open = [[0, start]];
    gScore[start] = 0;
    const hz = (i) => Math.hypot((i % W) - (goal % W), Math.floor(i / W) - Math.floor(goal / W));
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let found = false, guard = 0;
    while (open.length && guard++ < 40000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, cur] = open.splice(bi, 1)[0];
      if (cur === goal) { found = true; break; }
      const cx = cur % W, cz = Math.floor(cur / W);
      for (const [dx, dz, cost] of dirs) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= this.h) continue;
        const ni = nz * W + nx;
        if (!ok(ni)) continue;
        const ng = gScore[cur] + cost;
        if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = cur; open.push([ng + hz(ni), ni]); }
      }
    }
    if (!found) return [g];
    const cells = [];
    for (let i = goal; i !== -1; i = came[i]) cells.unshift(this.center(i % W, Math.floor(i / W)));
    // rapikan: lompati titik yang masih terlihat langsung
    const out = [];
    let anchor = s;
    for (let i = 1; i < cells.length; i++) {
      if (!this.lineFree(anchor, cells[i], r)) { out.push(cells[i - 1]); anchor = cells[i - 1]; }
    }
    out.push(g);
    return out;
  }
}
