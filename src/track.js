'use strict';
// Builds a playable track from a definition: centerline spline, wall mask,
// per-pixel progress index, heightmap, surfaces, and the pre-rendered background.

const WORLD_W = 400, WORLD_H = 300;
const TRACK_WIDTH = 36;
const STANDS_Y = 30; // everything above this is HUD and grandstand
const SURF = { WALL: 0, DIRT: 1, MUD: 2, WATER: 3 };

// ---- small deterministic noise ----
function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, seed) {
  return vnoise(x, y, seed) * 0.6 + vnoise(x * 2.1, y * 2.1, seed + 7) * 0.3 + vnoise(x * 4.3, y * 4.3, seed + 13) * 0.1;
}

function catmull(p0, p1, p2, p3, u) {
  // centripetal Catmull-Rom (Barry-Goldman)
  const k = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
  const t0 = 0, t1 = t0 + k(p0, p1), t2 = t1 + k(p1, p2), t3 = t2 + k(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const L = (a, b, ta, tb) => [
    ((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta),
    ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta),
  ];
  const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
  const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
  return L(B1, B2, t1, t2);
}

class Track {
  constructor(defIndex, variant = 0) {
    const def = TRACK_DEFS[defIndex];
    this.def = def;
    this.index = defIndex;
    this.variant = variant;
    this.name = def.name + (variant === 1 ? ' II' : variant === 2 ? ' III' : variant === 3 ? ' IV' : '');
    this.seed = defIndex * 31 + variant * 7 + 3;
    this.halfW = TRACK_WIDTH / 2;
    this.mood = MOOD_ORDER[(defIndex + variant) % MOOD_ORDER.length];

    let pts = def.pts.map(p => [p[0], p[1]]);
    let features = def.features.map(f => Object.assign({}, f));
    const n = pts.length;
    if (variant & 1) pts = pts.map(p => [WORLD_W - p[0], p[1]]);
    if (variant & 2) {
      pts = [pts[0]].concat(pts.slice(1).reverse());
      features.forEach(f => { f.at = (n - f.at) % n; });
    }
    this.pts = pts;

    this.buildCenterline();
    this.features = features.map(f => {
      const sc = this.sAtControl(f.at);
      return Object.assign(f, { s0: (sc - f.len / 2 + this.L) % this.L });
    });
    this.buildMaps();
    this.renderBackground();
  }

  buildCenterline() {
    const P = this.pts, n = P.length, SUB = 64;
    const dense = [];
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      for (let j = 0; j < SUB; j++) dense.push(catmull(p0, p1, p2, p3, j / SUB));
    }
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1], b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[dense.length];
    this.controlS = [];
    for (let i = 0; i <= n; i++) this.controlS.push(cum[i * SUB]);

    const N = Math.floor(total / 2);
    const sp = total / N;
    const cx = new Float32Array(N), cy = new Float32Array(N);
    let k = 0;
    for (let i = 0; i < N; i++) {
      const s = i * sp;
      while (cum[k + 1] < s) k++;
      const a = dense[k], b = dense[(k + 1) % dense.length];
      const f = (s - cum[k]) / (cum[k + 1] - cum[k] || 1);
      cx[i] = a[0] + (b[0] - a[0]) * f;
      cy[i] = a[1] + (b[1] - a[1]) * f;
    }
    const tx = new Float32Array(N), ty = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 2 + N) % N, b = (i + 2) % N;
      const dx = cx[b] - cx[a], dy = cy[b] - cy[a];
      const l = Math.hypot(dx, dy) || 1;
      tx[i] = dx / l; ty[i] = dy / l;
    }
    Object.assign(this, { N, sp, L: total, cx, cy, tx, ty });
  }

  sAtControl(at) {
    const n = this.pts.length;
    const i = Math.floor(at) % n, f = at - Math.floor(at);
    return this.controlS[i] + (this.controlS[i + 1] - this.controlS[i]) * f;
  }

  featureHeight(s, d) {
    let h = 0;
    for (const f of this.features) {
      if (!f.h) continue;
      const ds = ((s - f.s0) % this.L + this.L) % this.L;
      if (ds >= f.len) continue;
      const u = ds / f.len;
      switch (f.t) {
        case 'hill': h += f.h * Math.pow(Math.sin(Math.PI * u), 2); break;
        case 'moguls': h += f.h * Math.pow(Math.sin(Math.PI * u * f.n), 2); break;
        case 'jump':
          if (u < 0.72) h += f.h * (u / 0.72);
          else if (u < 0.84) h += f.h * (1 - (u - 0.72) / 0.12);
          break;
        case 'table':
          if (u < 0.28) h += f.h * (u / 0.28);
          else if (u < 0.7) h += f.h;
          else h += f.h * Math.max(0, 1 - (u - 0.7) / 0.3);
          break;
      }
    }
    return h;
  }

  featureSurface(s, d, x, y) {
    let surf = SURF.DIRT;
    for (const f of this.features) {
      if (f.t !== 'mud' && f.t !== 'water') continue;
      const ds = ((s - f.s0) % this.L + this.L) % this.L;
      if (ds >= f.len + 8) continue;
      const nx = (ds - f.len / 2) / (f.len / 2);
      const dc = (f.d0 + f.d1) / 2 * this.halfW;
      const dr = Math.max(4, (f.d1 - f.d0) / 2 * this.halfW);
      const ny = (d - dc) / dr;
      const r = nx * nx + Math.pow(Math.abs(ny), 4);
      const wob = (fbm(x * 0.15, y * 0.15, this.seed + 101) - 0.5) * 0.7;
      if (r < 1 + wob) surf = f.t === 'mud' ? SURF.MUD : SURF.WATER;
    }
    return surf;
  }

  buildMaps() {
    const W = WORLD_W, H = WORLD_H, N = this.N;
    // 1. mask by stroking the centerline
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.lineWidth = TRACK_WIDTH; g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = '#fff';
    g.beginPath();
    g.moveTo(this.cx[0], this.cy[0]);
    for (let i = 1; i < N; i++) g.lineTo(this.cx[i], this.cy[i]);
    g.closePath();
    g.stroke();
    const img = g.getImageData(0, 0, W, H).data;

    const surf = new Uint8Array(W * H);
    const idx = new Int16Array(W * H).fill(-1);
    const lat = new Float32Array(W * H);
    const hgt = new Float32Array(W * H);

    // bucket samples for nearest search
    const CS = 20, GW = Math.ceil(W / CS), GH = Math.ceil(H / CS);
    const buckets = Array.from({ length: GW * GH }, () => []);
    for (let i = 0; i < N; i++) {
      const bx = Math.min(GW - 1, Math.max(0, Math.floor(this.cx[i] / CS)));
      const by = Math.min(GH - 1, Math.max(0, Math.floor(this.cy[i] / CS)));
      buckets[by * GW + bx].push(i);
    }

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (img[p * 4 + 3] < 128 || y < STANDS_Y + 2 || x < 2 || x >= W - 2 || y >= H - 1) continue;
        const px = x + 0.5, py = y + 0.5;
        const bx = Math.floor(px / CS), by = Math.floor(py / CS);
        let best = -1, bd = 1e9;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const gx = bx + ox, gy = by + oy;
          if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) continue;
          for (const i of buckets[gy * GW + gx]) {
            const dx = this.cx[i] - px, dy = this.cy[i] - py;
            const dd = dx * dx + dy * dy;
            if (dd < bd) { bd = dd; best = i; }
          }
        }
        if (best < 0) continue;
        idx[p] = best;
        const d = (px - this.cx[best]) * -this.ty[best] + (py - this.cy[best]) * this.tx[best];
        lat[p] = d;
        const s = best * this.sp;
        hgt[p] = this.featureHeight(s, d);
        surf[p] = this.featureSurface(s, d, x, y);
      }
    }

    // 2. BFS outward from the track: distance to track and inherited height
    const dist = new Uint8Array(W * H).fill(255);
    const q = new Int32Array(W * H);
    let qh = 0, qt = 0;
    const near = Int16Array.from(idx); // nearest centerline sample, also off the track
    for (let p = 0; p < W * H; p++) if (surf[p]) { dist[p] = 0; q[qt++] = p; }
    while (qh < qt) {
      const p = q[qh++];
      const x = p % W, y = (p - x) / W;
      const nd = dist[p] + 1;
      if (nd > 40) continue;
      const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
      for (const o of nb) {
        if (o >= 0 && dist[o] === 255) { dist[o] = nd; hgt[o] = hgt[p]; near[o] = near[p]; q[qt++] = o; }
      }
    }
    // soften seams between samples so slopes stay continuous
    const tmp = new Float32Array(W * H);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let sum = 0, n = 0;
        for (let k = -2; k <= 2; k++) { const xx = x + k; if (xx >= 0 && xx < W) { sum += hgt[y * W + xx]; n++; } }
        tmp[y * W + x] = sum / n;
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let sum = 0, n = 0;
        for (let k = -2; k <= 2; k++) { const yy = y + k; if (yy >= 0 && yy < H) { sum += tmp[yy * W + x]; n++; } }
        hgt[y * W + x] = sum / n;
      }
    }
    Object.assign(this, { surf, idx, lat, hgt, dist, near });
    this.buildSDF();
    this.placeLandmarks();
  }

  // Flagman beside the start line and the start/finish gantry poles.
  placeLandmarks() {
    const nx = -this.ty[0], ny = this.tx[0];
    const cx = this.cx[0], cy = this.cy[0];
    this.gantry = [-1, 1].map(sd => [cx + nx * sd * (this.halfW + 3), cy + ny * sd * (this.halfW + 3)]);
    this.flagman = null;
    for (const sd of [1, -1]) {
      for (const off of [11, 14, 18]) {
        const x = cx + nx * sd * (this.halfW + off) + this.tx[0] * 6, y = cy + ny * sd * (this.halfW + off) + this.ty[0] * 6;
        if (!this.inside(x, y) || y < STANDS_Y + 6) continue;
        if (this.dist[this.pix(x, y)] >= 7) { this.flagman = { x, y }; break; }
      }
      if (this.flagman) break;
    }
  }

  // 0..1 position inside a jump if s is on one, else -1
  jumpU(s) {
    for (const f of this.features) {
      if (f.t !== 'jump') continue;
      const ds = ((s - f.s0) % this.L + this.L) % this.L;
      if (ds < f.len) return ds / f.len;
    }
    return -1;
  }

  // Signed distance to the wall edge: positive on the track, negative inside walls.
  buildSDF() {
    const W = WORLD_W, H = WORLD_H, INF = 1e6;
    const chamfer = (isSource) => {
      const d = new Float32Array(W * H);
      for (let p = 0; p < W * H; p++) d[p] = isSource(p) ? 0 : INF;
      const D2 = Math.SQRT2;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const p = y * W + x;
        let v = d[p];
        if (x > 0) v = Math.min(v, d[p - 1] + 1);
        if (y > 0) {
          v = Math.min(v, d[p - W] + 1);
          if (x > 0) v = Math.min(v, d[p - W - 1] + D2);
          if (x < W - 1) v = Math.min(v, d[p - W + 1] + D2);
        }
        d[p] = v;
      }
      for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
        const p = y * W + x;
        let v = d[p];
        if (x < W - 1) v = Math.min(v, d[p + 1] + 1);
        if (y < H - 1) {
          v = Math.min(v, d[p + W] + 1);
          if (x < W - 1) v = Math.min(v, d[p + W + 1] + D2);
          if (x > 0) v = Math.min(v, d[p + W - 1] + D2);
        }
        d[p] = v;
      }
      return d;
    };
    const surf = this.surf;
    const dIn = chamfer(p => surf[p] === SURF.WALL);
    const dOut = chamfer(p => surf[p] !== SURF.WALL);
    const sdf = new Float32Array(W * H);
    for (let p = 0; p < W * H; p++) sdf[p] = surf[p] !== SURF.WALL ? dIn[p] - 0.5 : -(dOut[p] - 0.5);
    this.sdf = sdf;
  }

  // ---- queries ----
  inside(x, y) { return x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H; }
  pix(x, y) { return (y | 0) * WORLD_W + (x | 0); }
  isSolid(x, y) { return !this.inside(x, y) || this.surf[this.pix(x, y)] === SURF.WALL; }
  surfAt(x, y) { return this.inside(x, y) ? this.surf[this.pix(x, y)] : 0; }
  idxAt(x, y) { return this.inside(x, y) ? this.idx[this.pix(x, y)] : -1; }
  latAt(x, y) { return this.inside(x, y) ? this.lat[this.pix(x, y)] : 0; }
  heightAt(x, y) {
    x -= 0.5; y -= 0.5;
    const x0 = Math.max(0, Math.min(WORLD_W - 2, Math.floor(x)));
    const y0 = Math.max(0, Math.min(WORLD_H - 2, Math.floor(y)));
    const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
    const H = this.hgt, p = y0 * WORLD_W + x0;
    const a = H[p], b = H[p + 1], c = H[p + WORLD_W], d = H[p + WORLD_W + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  clearance(x, y) {
    x -= 0.5; y -= 0.5;
    if (x < 0 || y < 0 || x > WORLD_W - 2 || y > WORLD_H - 2) return -10;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const S = this.sdf, p = y0 * WORLD_W + x0;
    const a = S[p], b = S[p + 1], c = S[p + WORLD_W], d = S[p + WORLD_W + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  // unit vector pointing away from the nearest wall
  wallNormal(x, y) {
    const e = 1;
    let gx = this.clearance(x + e, y) - this.clearance(x - e, y);
    let gy = this.clearance(x, y + e) - this.clearance(x, y - e);
    const l = Math.hypot(gx, gy);
    if (l < 1e-6) return null;
    return [gx / l, gy / l];
  }
  gradAt(x, y) {
    const e = 1.5;
    return [
      (this.heightAt(x + e, y) - this.heightAt(x - e, y)) / (2 * e),
      (this.heightAt(x, y + e) - this.heightAt(x, y - e)) / (2 * e),
    ];
  }

  // Start grid: 2x2 behind the line.
  gridPosition(slot) {
    const row = slot < 2 ? 0 : 1;
    const back = row === 0 ? 12 : 30;
    const i = (this.N - Math.round(back / this.sp)) % this.N;
    const side = (slot % 2 === 0 ? -1 : 1) * 8.5;
    const nx = -this.ty[i], ny = this.tx[i];
    return { x: this.cx[i] + nx * side, y: this.cy[i] + ny * side, h: Math.atan2(this.ty[i], this.tx[i]), idx: i };
  }

  // ---- background art ----
  renderBackground() {
    const W = WORLD_W, H = WORLD_H;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const D = img.data;
    const seed = this.seed;

    // visual height: track heights plus raised berms along the walls
    const V = new Float32Array(W * H);
    const BERM = [0, 3, 5, 5.5, 4.5, 2.5, 1];
    for (let p = 0; p < W * H; p++) {
      const d = this.dist[p];
      const h = this.hgt[p];
      if (d === 0) V[p] = h;
      else if (d < BERM.length) V[p] = h + BERM[d];
      else V[p] = h * Math.max(0, 1 - (d - BERM.length) / 6);
    }
    this.V = V;
    const Lx = -0.5, Ly = -0.7, Lz = 1.1, Ll = Math.hypot(Lx, Ly, Lz);
    const lx = Lx / Ll, ly = Ly / Ll, lz = Lz / Ll;

    this.waterPix = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        let r, gg, b;
        const s = this.surf[p];
        const nz = fbm(x * 0.09, y * 0.09, seed);
        const fine = hash2(x, y, seed);
        if (y < STANDS_Y) {
          // grandstand: tiers of spectators
          const tier = Math.floor((y - 20) / 3);
          if (y < 20) { r = 18; gg = 16; b = 22; }
          else if ((y - 20) % 3 === 2) { r = 52; gg = 50; b = 58; }
          else {
            const hh = hash2(Math.floor(x / 2), tier, seed + 9);
            const pal = [[220, 70, 60], [240, 220, 190], [70, 110, 200], [250, 200, 60], [60, 150, 80], [200, 200, 210], [150, 90, 60]];
            const col = pal[Math.floor(hh * pal.length)];
            const k = (x % 2 === 0) ? 1 : 0.7;
            [r, gg, b] = [col[0] * k, col[1] * k, col[2] * k];
          }
          D[p * 4] = r; D[p * 4 + 1] = gg; D[p * 4 + 2] = b; D[p * 4 + 3] = 255;
          continue;
        }
        if (s === SURF.DIRT) {
          const d = Math.abs(this.lat[p]);
          // packed racing line is lighter, loose dirt toward the walls darker
          const v = (0.84 + nz * 0.26 + (fine - 0.5) * 0.1) * (1.05 - Math.min(1, d / this.halfW) * 0.12);
          r = 186 * v; gg = 134 * v; b = 82 * v;
          if (Math.abs(d - 6) < 1.2 || Math.abs(d - 11) < 1) { r *= 0.9; gg *= 0.9; b *= 0.9; }
          if (fine > 0.986) { r = 196; gg = 186; b = 170; }          // pebbles
          else if (fine < 0.012) { r = 96; gg = 70; b = 48; }
          const si = this.idx[p] * this.sp;
          const ju = this.jumpU(si);
          if (ju > 0.6 && ju < 0.72) {                              // hazard stripes on the jump lip
            const st = Math.floor((this.lat[p] + 40 + (ju - 0.6) * 30) / 3) % 2;
            if (st) { r = 240; gg = 196; b = 40; } else { r = 34; gg = 30; b = 26; }
          }
          if (si < 6) {
            const chk = (Math.floor(si / 3) + Math.floor((this.lat[p] + 30) / 3)) % 2;
            if (chk) { r = 235; gg = 235; b = 230; } else { r = 30; gg = 30; b = 34; }
          }
        } else if (s === SURF.MUD) {
          const v = 0.8 + nz * 0.35;
          r = 96 * v; gg = 64 * v; b = 40 * v;
          if (fine > 0.94) { r += 40; gg += 32; b += 24; }
        } else if (s === SURF.WATER) {
          const v = 0.85 + nz * 0.3;
          r = 50 * v; gg = 98 * v; b = 160 * v;
          const wet = (xx, yy) => this.surfAt(xx, yy) === SURF.WATER;
          const deep = wet(x - 3, y) && wet(x + 3, y) && wet(x, y - 3) && wet(x, y + 3);
          const edge = !(wet(x - 1, y) && wet(x + 1, y) && wet(x, y - 1) && wet(x, y + 1));
          if (deep) { r *= 0.72; gg *= 0.78; b *= 0.85; }
          if (fbm(x * 0.3, y * 0.6, seed + 5) > 0.68) { r += 50; gg += 50; b += 50; }
          if (edge) { r = 196; gg = 214; b = 224; }                  // foam line
          this.waterPix.push(p);
        } else {
          const d = this.dist[p];
          if (d <= 6) {
            const v = 0.92 + nz * 0.18;
            r = 206 * v; gg = 166 * v; b = 112 * v;
            if (d === 2 || d === 3) {
              // tire wall along the berm crest, every fifth tire painted white
              const along = this.near[p] * this.sp;
              const seg = Math.floor(along / 3.2);
              if ((along % 3.2) < 2.5) {
                const white = seg % 5 === 0;
                const hole = d === 3 && (along % 3.2) > 0.8 && (along % 3.2) < 1.7;
                r = white ? 222 : 34; gg = white ? 222 : 32; b = white ? 214 : 34;
                if (hole) { r *= 0.5; gg *= 0.5; b *= 0.5; }
              }
            }
          } else {
            const v = 0.75 + nz * 0.4 + (fine - 0.5) * 0.12;
            const mow = Math.floor((x + y) / 12) % 2 ? 1.07 : 0.93;   // mowing stripes
            r = 78 * v * mow; gg = 100 * v * mow; b = 46 * v * mow;
            if (fbm(x * 0.05, y * 0.05, seed + 40) > 0.66) { r = 120 * v; gg = 98 * v; b = 60 * v; }
            if (fine > 0.995) { r = 230; gg = 220; b = 120; }          // wild flowers
          }
        }
        // slope lighting
        const xm = Math.max(0, x - 1), xp = Math.min(W - 1, x + 1);
        const ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1);
        const gx = (V[y * W + xp] - V[y * W + xm]) / 2;
        const gy = (V[yp * W + x] - V[ym * W + x]) / 2;
        const nl = Math.hypot(gx, gy, 1);
        const dot = (-gx * lx - gy * ly + lz) / nl;
        const shade = Math.max(0.5, Math.min(1.5, 1 + (dot - lz) * 1.9));
        D[p * 4] = Math.min(255, r * shade);
        D[p * 4 + 1] = Math.min(255, gg * shade);
        D[p * 4 + 2] = Math.min(255, b * shade);
        D[p * 4 + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);

    // stadium rail under the stands
    g.fillStyle = '#c8c8d0'; g.fillRect(0, STANDS_Y - 1, W, 1);
    g.fillStyle = '#5a5a66'; g.fillRect(0, STANDS_Y, W, 1);

    this.drawBoards(g);

    // tire stacks on the infield
    let placed = 0;
    this.decor = [];
    for (let k = 0; k < 400 && placed < 16; k++) {
      const x = 8 + Math.floor(hash2(k, 1, seed) * (W - 16));
      const y = STANDS_Y + 8 + Math.floor(hash2(k, 2, seed) * (H - STANDS_Y - 14));
      if (this.dist[y * W + x] < 9) continue;
      const hay = placed % 3 === 1;
      if (hay) this.drawHayBale(g, x, y); else this.drawTireStack(g, x, y);
      this.decor.push([x, y, hay ? 3 : 4]);
      placed++;
    }
    this.bg = c;
  }

  // Heights as drawn by the 3D views: terrain and berms, standing tire stacks, raked grandstand.
  getViewHeights() {
    if (this.viewH) return this.viewH;
    const W = WORLD_W, H = WORLD_H;
    const VH = Float32Array.from(this.V);
    for (const [dx, dy, dh] of this.decor) {
      for (let y = dy - 4; y <= dy + 1; y++) for (let x = dx - 3; x <= dx + 3; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H) VH[y * W + x] += dh;
      }
    }
    for (const [x0, x1] of this.boards || []) {
      for (let y = H - 10; y < H; y++) for (let x = x0 - 1; x <= x1; x++) VH[y * W + x] = Math.max(VH[y * W + x], 6);
    }
    for (let y = 0; y < STANDS_Y; y++) for (let x = 0; x < W; x++) VH[y * W + x] = (STANDS_Y - y) * 0.62 + 2;
    this.viewH = VH;
    return VH;
  }

  // Isometric diorama: every world pixel becomes a column as tall as its terrain,
  // painted back to front so nearer columns cover farther ones.
  getIsoBg() {
    if (this.isoBg) return this.isoBg;
    const W = WORLD_W, H = WORLD_H, I = View.ISO;
    const src = this.bg.getContext('2d').getImageData(0, 0, W, H).data;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#1b1524'); grad.addColorStop(1, '#09070c');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // stadium floodlight glow behind the stands
    for (const lx of [60, 200, 340]) {
      const rg = g.createRadialGradient(lx, 18, 0, lx, 18, 60);
      rg.addColorStop(0, 'rgba(255,240,200,0.18)'); rg.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = rg; g.fillRect(lx - 60, 0, 120, 80);
    }
    const img = g.getImageData(0, 0, W, H);
    const D = new Uint32Array(img.data.buffer);
    const pack = (r, gg, b) => (255 << 24) | ((b & 255) << 16) | ((gg & 255) << 8) | (r & 255);

    const VH = this.getViewHeights();
    const slabTop = pack(70, 50, 34), slabLow = pack(40, 28, 20);
    const water = [];
    for (let d = 0; d < W + H - 1; d++) {
      const xa = Math.max(0, d - (H - 1)), xb = Math.min(W - 1, d);
      for (let x = xa; x <= xb; x++) {
        const y = d - x, p = y * W + x;
        const h = VH[p];
        const sx = Math.round(I.ox + (x - y) * I.a);
        if (sx < 0 || sx >= W) continue;
        const base = I.oy + (x + y) * I.b;
        const top = Math.round(base - h * I.c);
        const ground = Math.round(base);
        const bottom = Math.round(base + I.slab);
        const r = src[p * 4], gg = src[p * 4 + 1], b = src[p * 4 + 2];
        const topCol = pack(r, gg, b);
        const side = pack(r * 0.6, gg * 0.6, b * 0.6);
        const y0 = Math.max(0, top), y1 = Math.min(H - 1, bottom);
        for (let yy = y0; yy <= y1; yy++) {
          D[yy * W + sx] = yy === top ? topCol : yy < ground ? side : (yy === bottom ? slabLow : slabTop);
        }
        if (this.surf[p] === SURF.WATER && top >= 0 && top < H) water.push(top * W + sx);
      }
    }
    g.putImageData(img, 0, 0);
    this.isoWater = water;
    this.isoBg = c;
    return c;
  }

  drawHayBale(g, x, y) {
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x - 3, y + 1, 9, 3);
    g.fillStyle = '#b8902e'; g.fillRect(x - 4, y - 3, 9, 5);
    g.fillStyle = '#e2bc52'; g.fillRect(x - 4, y - 4, 9, 2);
    g.fillStyle = '#8a6a20'; g.fillRect(x - 2, y - 4, 1, 6); g.fillRect(x + 2, y - 4, 1, 6);
  }

  // Sponsor boards along the front edge of the stadium.
  drawBoards(g) {
    const W = WORLD_W, H = WORLD_H;
    const names = ['DIRTCO', 'NITRO-X', 'MUDLINE', 'GRIT OIL', 'ROCKJAW', 'TREADZ'];
    const cols = [['#c8281c', '#fff'], ['#1c3c9c', '#ffd84a'], ['#f0c020', '#201810'], ['#1a1a1e', '#ff7020'], ['#2a7a3a', '#fff'], ['#e8e8e8', '#c8281c']];
    this.boards = [];
    for (let x0 = 2, k = (this.seed % names.length); x0 + 56 < W; x0 += 60, k++) {
      let clear = true;
      for (let x = x0; x < x0 + 56 && clear; x += 2) if (this.dist[(H - 4) * W + x] < 8) clear = false;
      if (!clear) continue;
      const [bg, fg] = cols[k % cols.length];
      g.fillStyle = '#111'; g.fillRect(x0 - 1, H - 10, 58, 10);
      g.fillStyle = bg; g.fillRect(x0, H - 9, 56, 8);
      Font.draw(g, names[k % names.length], x0 + 28, H - 8, fg, { align: 'center' });
      this.boards.push([x0, x0 + 56]);
    }
  }

  drawTireStack(g, x, y) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(x - 2, y + 2, 7, 3);
    for (let i = 2; i >= 0; i--) {
      const yy = y - i * 2;
      g.fillStyle = '#1c1c20'; g.fillRect(x - 3, yy - 1, 7, 4);
      g.fillStyle = '#3a3a42'; g.fillRect(x - 2, yy - 1, 5, 1);
    }
    g.fillStyle = '#0a0a0c'; g.fillRect(x - 1, y - 5, 3, 1);
  }
}
