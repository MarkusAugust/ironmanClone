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

    // which pass of a figure eight is the bridge (reversing the track swaps the passes)
    this.upperPass = ((def.bridge || 'a') === 'a') !== !!(variant & 2) ? 'a' : 'b';
    this.buildCenterline();
    this.findCrossings();
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

  // Where the centerline crosses itself (figure eights). Each crossing has two
  // stretches of road, A (first pass) and B (second pass), around the crossing point.
  findCrossings() {
    const N = this.N, gap = Math.round(120 / this.sp);
    const found = [];
    for (let i = 0; i < N; i += 1) {
      for (let j = i + gap; j < N; j += 1) {
        if (N - (j - i) < gap) continue;
        const d = Math.hypot(this.cx[i] - this.cx[j], this.cy[i] - this.cy[j]);
        if (d > this.sp * 1.5) continue;
        const near = found.find(c => Math.abs(c.i - i) < 30 && Math.abs(c.j - j) < 30);
        if (!near) found.push({ i, j, d });
        else if (d < near.d) Object.assign(near, { i, j, d });
      }
    }
    // every crossing is a bridge: the upper road ramps up, crosses on a deck and ramps down
    this.crossings = found.map(f => {
      const up = this.upperPass === 'a' ? f.i : f.j, lo = this.upperPass === 'a' ? f.j : f.i;
      const sin = Math.abs(this.tx[up] * this.ty[lo] - this.ty[up] * this.tx[lo]);
      const D = (this.halfW + 4) / Math.max(0.35, sin) + 3;   // half length of the deck
      const ramp = 46, BH = 13;
      const r = Math.max(Math.round(64 / this.sp), Math.ceil((D + ramp + 14) / this.sp));
      return { a: f.i, b: f.j, up, lo, r, D, ramp, BH, sin, x: this.cx[f.i], y: this.cy[f.i] };
    });
  }

  // signed distance along the upper road from the middle of the bridge
  sRel(c, idx, x, y) {
    const s = idx * this.sp + (x - this.cx[idx]) * this.tx[idx] + (y - this.cy[idx]) * this.ty[idx];
    let d = s - c.up * this.sp;
    if (d > this.L / 2) d -= this.L;
    if (d < -this.L / 2) d += this.L;
    return d;
  }

  bridgeProfile(c, sr) {
    const a = Math.abs(sr);
    if (a <= c.D) return c.BH;
    if (a >= c.D + c.ramp) return 0;
    const t = 1 - (a - c.D) / c.ramp;
    return c.BH * t * t * (3 - 2 * t);
  }

  // the crossing whose upper road a truck on sample idx is driving, if any
  upperCrossing(idx) {
    if (idx == null || idx < 0) return null;
    for (const c of this.crossings) if (this.inStretch(idx, c.up, c.r)) return c;
    return null;
  }

  // ramp height baked into the visual terrain (the deck itself is drawn separately)
  rampAt(i, x, y) {
    const c = this.upperCrossing(i);
    if (!c) return 0;
    const sr = this.sRel(c, i, x, y);
    return Math.abs(sr) > c.D ? this.bridgeProfile(c, sr) : 0;
  }

  inStretch(idx, center, r) {
    const N = this.N;
    let d = Math.abs(idx - center);
    if (d > N / 2) d = N - d;
    return d <= r;
  }

  // Road mask stroked from the centerline, optionally leaving out one stretch.
  strokeMask(skipCenter = -1, skipR = 0) {
    const W = WORLD_W, H = WORLD_H, N = this.N;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.lineWidth = TRACK_WIDTH; g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = '#fff';
    g.beginPath();
    let pen = false;
    for (let k = 0; k <= N; k++) {
      const i = k % N;
      const skip = skipCenter >= 0 && this.inStretch(i, skipCenter, skipR);
      if (skip) { pen = false; continue; }
      if (!pen) { g.moveTo(this.cx[i], this.cy[i]); pen = true; } else g.lineTo(this.cx[i], this.cy[i]);
    }
    g.stroke();
    const img = g.getImageData(0, 0, W, H).data;
    const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (img[p * 4 + 3] >= 128 && y >= STANDS_Y + 2 && x >= 2 && x < W - 2 && y < H - 1) m[p] = 1;
    }
    return m;
  }

  sdfFromMask(isRoad) {
    const W = WORLD_W, H = WORLD_H;
    const dIn = this.chamfer(p => !isRoad(p));
    const dOut = this.chamfer(p => isRoad(p));
    const sdf = new Float32Array(W * H);
    for (let p = 0; p < W * H; p++) sdf[p] = isRoad(p) ? dIn[p] - 0.5 : -(dOut[p] - 0.5);
    return sdf;
  }

  // Signed distance to the wall edge: positive on the track, negative inside walls.
  buildSDF() {
    const surf = this.surf;
    this.sdf = this.sdfFromMask(p => surf[p] !== SURF.WALL);
    // at a crossing, each road keeps its own walls so trucks cannot turn onto the other road
    for (const c of this.crossings) {
      const noB = this.strokeMask(c.b, c.r), noA = this.strokeMask(c.a, c.r);
      c.sdfA = this.sdfFromMask(p => noB[p] === 1);
      c.sdfB = this.sdfFromMask(p => noA[p] === 1);
    }
  }

  chamfer(isSource) {
    const W = WORLD_W, H = WORLD_H, INF = 1e6;
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
  }

  // ---- queries ----
  inside(x, y) { return x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H; }
  pix(x, y) { return (y | 0) * WORLD_W + (x | 0); }
  isSolid(x, y) { return !this.inside(x, y) || this.surf[this.pix(x, y)] === SURF.WALL; }
  surfAt(x, y) { return this.inside(x, y) ? this.surf[this.pix(x, y)] : 0; }
  idxAt(x, y) { return this.inside(x, y) ? this.idx[this.pix(x, y)] : -1; }
  latAt(x, y) { return this.inside(x, y) ? this.lat[this.pix(x, y)] : 0; }
  // Ground height; with a truck's sample idx, a truck on a bridge road gets the bridge height.
  heightAt(x, y, idx) {
    if (idx != null && this.crossings.length) {
      const c = this.upperCrossing(idx);
      if (c) return this.groundAt(x, y) + this.bridgeProfile(c, this.sRel(c, idx, x, y));
    }
    return this.groundAt(x, y);
  }
  groundAt(x, y) {
    x -= 0.5; y -= 0.5;
    const x0 = Math.max(0, Math.min(WORLD_W - 2, Math.floor(x)));
    const y0 = Math.max(0, Math.min(WORLD_H - 2, Math.floor(y)));
    const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
    const H = this.hgt, p = y0 * WORLD_W + x0;
    const a = H[p], b = H[p + 1], c = H[p + WORLD_W], d = H[p + WORLD_W + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  // walls a truck on sample idx sees (crossings give each road its own walls)
  sdfFor(idx) {
    if (idx != null && idx >= 0) {
      for (const c of this.crossings) {
        if (this.inStretch(idx, c.a, c.r)) return c.sdfA;
        if (this.inStretch(idx, c.b, c.r)) return c.sdfB;
      }
    }
    return this.sdf;
  }
  clearance(x, y, idx) {
    x -= 0.5; y -= 0.5;
    if (x < 0 || y < 0 || x > WORLD_W - 2 || y > WORLD_H - 2) return -10;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const S = this.sdfFor(idx), p = y0 * WORLD_W + x0;
    const a = S[p], b = S[p + 1], c = S[p + WORLD_W], d = S[p + WORLD_W + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  // unit vector pointing away from the nearest wall
  wallNormal(x, y, idx) {
    const e = 1;
    let gx = this.clearance(x + e, y, idx) - this.clearance(x - e, y, idx);
    let gy = this.clearance(x, y + e, idx) - this.clearance(x, y - e, idx);
    const l = Math.hypot(gx, gy);
    if (l < 1e-6) return null;
    return [gx / l, gy / l];
  }
  // Nearest centerline sample, searched along the road from the last known one,
  // so a truck at a crossing stays on the road it is driving.
  localIdx(x, y, hint) {
    const N = this.N;
    let best = -1, bd = 1e9;
    for (let k = -12; k <= 30; k++) {
      const i = (hint + k + N) % N;
      const dx = this.cx[i] - x, dy = this.cy[i] - y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    if (bd <= (this.halfW + 8) * (this.halfW + 8)) return best;
    const g = this.idxAt(x, y);
    return g >= 0 ? g : hint;
  }

  gradAt(x, y, idx) {
    const e = 1.5;
    return [
      (this.heightAt(x + e, y, idx) - this.heightAt(x - e, y, idx)) / (2 * e),
      (this.heightAt(x, y + e, idx) - this.heightAt(x, y - e, idx)) / (2 * e),
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
    const W = WORLD_W, H = WORLD_H, R = RES, FW = W * R, FH = H * R;
    const seed = this.seed;

    // world-resolution heights (cockpit view): track, berms along the walls, fading infield
    const V = new Float32Array(W * H);
    const BERM = [0, 3, 5, 5.5, 4.5, 2.5, 1];
    for (let p = 0; p < W * H; p++) {
      const d = this.dist[p];
      const h = this.hgt[p];
      if (d === 0) V[p] = h;
      else if (d < BERM.length) V[p] = h + BERM[d];
      else V[p] = h * Math.max(0, 1 - (d - BERM.length) / 6);
      if (this.crossings.length && this.near[p] >= 0 && d < BERM.length) {
        const x = p % W, y = (p - x) / W;
        V[p] += this.rampAt(this.near[p], x + 0.5, y + 0.5);
      }
    }
    this.V = V;

    // fine-resolution classification and heights, from the exact distance to the centerline
    const KIND = { INFIELD: 0, DIRT: 1, MUD: 2, WATER: 3, BERM: 4, STANDS: 5 };
    const kind = new Uint8Array(FW * FH);
    const Vf = new Float32Array(FW * FH);
    const latF = new Float32Array(FW * FH);
    const alongF = new Float32Array(FW * FH);
    const bermProfile = bd => bd <= 0 ? 0 : 5.6 * Math.exp(-Math.pow((bd - 2.6) / 1.7, 2));
    const interior = (cx, cy) => this.surf[cy * W + cx] && this.surf[cy * W + Math.min(W - 1, cx + 1)] && this.surf[cy * W + Math.max(0, cx - 1)] &&
      this.surf[Math.min(H - 1, cy + 1) * W + cx] && this.surf[Math.max(0, cy - 1) * W + cx];
    for (let Y = 0; Y < FH; Y++) {
      const wy = (Y + 0.5) / R, cy = wy | 0;
      for (let X = 0; X < FW; X++) {
        const wx = (X + 0.5) / R, cx = wx | 0, p = cy * W + cx, f = Y * FW + X;
        if (wy < STANDS_Y) { kind[f] = KIND.STANDS; continue; }
        const i = this.near[p];
        const dc = this.dist[p];
        if (i < 0 || dc > 14) { kind[f] = KIND.INFIELD; Vf[f] = 0; continue; }
        const ox = wx - this.cx[i], oy = wy - this.cy[i];
        const d = ox * -this.ty[i] + oy * this.tx[i];
        const a = i * this.sp + ox * this.tx[i] + oy * this.ty[i];
        latF[f] = d; alongF[f] = a;
        const h = this.groundAt(wx, wy) + (this.crossings.length ? this.rampAt(i, wx, wy) : 0);
        const ad = Math.abs(d);
        if (dc === 0 && (ad < this.halfW || interior(cx, cy))) {
          const sf = this.featureSurface(a, d, wx, wy);
          kind[f] = sf === SURF.MUD ? KIND.MUD : sf === SURF.WATER ? KIND.WATER : KIND.DIRT;
          Vf[f] = h;
        } else {
          const bd = Math.max(0, ad - this.halfW);
          if (bd < 7) { kind[f] = KIND.BERM; Vf[f] = h + bermProfile(bd); latF[f] = bd; }
          else { kind[f] = KIND.INFIELD; Vf[f] = h * Math.max(0, 1 - (bd - 7) / 6); }
        }
      }
    }
    this.Vf = Vf;

    const c = document.createElement('canvas');
    c.width = FW; c.height = FH;
    const g = c.getContext('2d');
    const img = g.createImageData(FW, FH);
    const D = img.data;
    const Lx = -0.5, Ly = -0.7, Lz = 1.1, Ll = Math.hypot(Lx, Ly, Lz);
    const lx = Lx / Ll, ly = Ly / Ll, lz = Lz / Ll;
    const CROWD = [[220, 70, 60], [240, 220, 190], [70, 110, 200], [250, 200, 60], [60, 150, 80], [200, 200, 210], [150, 90, 60], [230, 120, 180]];
    const SKIN = [[236, 196, 160], [200, 150, 110], [150, 100, 70], [96, 64, 44]];
    this.waterPix = [];

    for (let Y = 0; Y < FH; Y++) {
      for (let X = 0; X < FW; X++) {
        const f = Y * FW + X;
        const wx = (X + 0.5) / R, wy = (Y + 0.5) / R;
        let r, gg, b;
        const k = kind[f];
        const fine = hash2(X, Y, seed);
        if (k === KIND.STANDS) {
          // grandstand: back wall, then tiers of fans (head over shirt) with seat rows
          if (wy < 20) {
            r = 20; gg = 18; b = 26;
            if (Y % 8 === 0) { r = 30; gg = 28; b = 38; }
          } else {
            const ty = Y - 20 * R, tier = Math.floor(ty / 6), row = ty % 6, col = Math.floor(X / 3);
            if (row === 5 || X % 3 === 2) { r = 46; gg = 44; b = 54; }
            else if (row <= 1) { [r, gg, b] = SKIN[Math.floor(hash2(col, tier, seed + 3) * SKIN.length)]; if (row === 0 && hash2(col, tier, seed + 4) > 0.6) { r *= 0.35; gg *= 0.3; b *= 0.3; } }
            else { const cc = CROWD[Math.floor(hash2(col, tier, seed + 9) * CROWD.length)]; const sh = row === 4 ? 0.75 : 1; r = cc[0] * sh; gg = cc[1] * sh; b = cc[2] * sh; }
          }
          D[f * 4] = r; D[f * 4 + 1] = gg; D[f * 4 + 2] = b; D[f * 4 + 3] = 255;
          continue;
        }
        const nz = fbm(wx * 0.09, wy * 0.09, seed);
        if (k === KIND.DIRT) {
          const d = Math.abs(latF[f]);
          const v = (0.84 + nz * 0.26 + (fine - 0.5) * 0.1) * (1.05 - Math.min(1, d / this.halfW) * 0.12);
          r = 186 * v; gg = 134 * v; b = 82 * v;
          if (Math.abs(d - 6) < 0.9 || Math.abs(d - 11) < 0.7) { r *= 0.88; gg *= 0.88; b *= 0.88; }   // worn grooves
          if (fine > 0.992) { r = 206; gg = 196; b = 180; }                                              // pebbles
          else if (fine < 0.008) { r = 92; gg = 66; b = 44; }
          else if (hash2(X >> 1, Y >> 1, seed + 21) > 0.985) { r *= 0.8; gg *= 0.78; b *= 0.75; }          // clods
          const a = alongF[f];
          if (a >= 0 && a < 6) {
            const chk = (Math.floor(a / 3) + Math.floor((latF[f] + 30) / 3)) % 2;
            if (chk) { r = 238; gg = 238; b = 232; } else { r = 28; gg = 28; b = 32; }
          }
          const ju = this.jumpU(a);
          if (ju > 0.6 && ju < 0.72) {
            const st = Math.floor((latF[f] + 40 + (ju - 0.6) * 30) / 3) % 2;
            if (st) { r = 242; gg = 198; b = 40; } else { r = 32; gg = 28; b = 24; }
          }
        } else if (k === KIND.MUD) {
          const v = 0.8 + nz * 0.35;
          r = 96 * v; gg = 64 * v; b = 40 * v;
          if (Math.abs(Math.abs(latF[f]) - 6) < 1) { r *= 0.78; gg *= 0.75; b *= 0.72; }                // ruts
          if (fbm(wx * 0.5, wy * 0.5, seed + 31) > 0.7 && fine > 0.5) { r += 46; gg += 36; b += 28; }    // wet sheen
        } else if (k === KIND.WATER) {
          const v = 0.85 + nz * 0.3;
          r = 50 * v; gg = 98 * v; b = 160 * v;
          const wet = (xx, yy) => this.surfAt(xx, yy) === SURF.WATER;
          const deep = wet(wx - 3, wy) && wet(wx + 3, wy) && wet(wx, wy - 3) && wet(wx, wy + 3);
          const edge = !(wet(wx - 0.8, wy) && wet(wx + 0.8, wy) && wet(wx, wy - 0.8) && wet(wx, wy + 0.8));
          if (deep) { r *= 0.72; gg *= 0.78; b *= 0.85; }
          if (fbm(wx * 0.3, wy * 0.6, seed + 5) > 0.68) { r += 50; gg += 50; b += 50; }
          if (edge) { r = 200; gg = 218; b = 226; }
          this.waterPix.push(f);
        } else if (k === KIND.BERM) {
          const bd = latF[f];
          const v = 0.92 + nz * 0.18;
          r = 206 * v; gg = 166 * v; b = 112 * v;
          // tire wall: round tires along the crest, every fifth one painted white
          const a = alongF[f], u = ((a % 3.2) + 3.2) % 3.2;
          const tx = u - 1.6, ty = bd - 2.5, rr = Math.hypot(tx, ty);
          if (rr < 1.45) {
            const white = Math.floor(a / 3.2) % 5 === 0;
            let base = white ? 226 : 36;
            if (rr < 0.6) base *= 0.45;
            else if (tx < -0.3 && ty < -0.3) base = white ? 250 : 64;
            r = base; gg = base; b = white ? base * 0.96 : base * 1.04;
          }
        } else {
          const v = 0.75 + nz * 0.4 + (fine - 0.5) * 0.12;
          const mow = Math.floor((wx + wy) / 12) % 2 ? 1.07 : 0.93;
          const blade = hash2(X, Y >> 1, seed + 7) > 0.7 ? 0.86 : 1;
          r = 78 * v * mow * blade; gg = 100 * v * mow * blade; b = 46 * v * mow * blade;
          if (fbm(wx * 0.05, wy * 0.05, seed + 40) > 0.66) { r = 120 * v; gg = 98 * v; b = 60 * v; }
          if (fine > 0.9975) { const fl = [[240, 240, 230], [250, 220, 90], [200, 140, 230]][Math.floor(hash2(X, Y, 99) * 3)]; [r, gg, b] = fl; }
        }
        // slope lighting from the fine heights
        const xm = Math.max(0, X - 1), xp = Math.min(FW - 1, X + 1);
        const ym = Math.max(0, Y - 1), yp = Math.min(FH - 1, Y + 1);
        const gx = (Vf[Y * FW + xp] - Vf[Y * FW + xm]) * R / 2;
        const gy = (Vf[yp * FW + X] - Vf[ym * FW + X]) * R / 2;
        const nl = Math.hypot(gx, gy, 1);
        const dot = (-gx * lx - gy * ly + lz) / nl;
        const shade = Math.max(0.5, Math.min(1.5, 1 + (dot - lz) * 1.9));
        D[f * 4] = Math.min(255, r * shade);
        D[f * 4 + 1] = Math.min(255, gg * shade);
        D[f * 4 + 2] = Math.min(255, b * shade);
        D[f * 4 + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);

    // stadium rail under the stands
    g.fillStyle = '#d0d0d8'; g.fillRect(0, (STANDS_Y - 1) * R, FW, 1);
    g.fillStyle = '#9a9aa6'; g.fillRect(0, (STANDS_Y - 1) * R + 1, FW, 1);
    g.fillStyle = '#4a4a56'; g.fillRect(0, STANDS_Y * R, FW, 2);
    for (let x = 0; x < FW; x += 16) { g.fillStyle = '#7a7a86'; g.fillRect(x, (STANDS_Y - 1) * R, 1, R + 2); }

    this.drawBoards(g);

    // tire stacks and hay bales on the infield
    let placed = 0;
    this.decor = [];
    for (let k = 0; k < 400 && placed < 16; k++) {
      const x = 8 + Math.floor(hash2(k, 1, seed) * (W - 16));
      const y = STANDS_Y + 8 + Math.floor(hash2(k, 2, seed) * (H - STANDS_Y - 14));
      if (this.dist[y * W + x] < 9) continue;
      const hay = placed % 3 === 1;
      if (hay) this.drawHayBale(g, x, y); else this.drawTireStack(g, x, y);
      this.decor.push([x, y, hay ? 3 : 4.5]);
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
      for (let y = dy - 3; y <= dy + 1; y++) for (let x = dx - 3; x <= dx + 3; x++) {
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

  // Same at fine resolution, for the isometric diorama.
  getViewHeightsFine() {
    if (this.viewHF) return this.viewHF;
    const R = RES, FW = WORLD_W * R, FH = WORLD_H * R;
    const VH = Float32Array.from(this.Vf);
    for (const [dx, dy, dh] of this.decor) {
      for (let Y = (dy - 3) * R; Y <= (dy + 1.5) * R; Y++) for (let X = (dx - 3.5) * R; X <= (dx + 3.5) * R; X++) {
        if (X >= 0 && Y >= 0 && X < FW && Y < FH) VH[Y * FW + X] += dh;
      }
    }
    for (const [x0, x1] of this.boards || []) {
      for (let Y = FH - 10 * R; Y < FH; Y++) for (let X = (x0 - 1) * R; X <= x1 * R; X++) VH[Y * FW + X] = Math.max(VH[Y * FW + X], 6);
    }
    for (let Y = 0; Y < STANDS_Y * R; Y++) {
      const h = (STANDS_Y - (Y + 0.5) / R) * 0.62 + 2;
      for (let X = 0; X < FW; X++) VH[Y * FW + X] = h;
    }
    this.viewHF = VH;
    return VH;
  }

  // Isometric diorama: every fine terrain sample becomes a column as tall as its terrain,
  // painted back to front so nearer columns cover farther ones.
  getIsoBg() {
    if (this.isoBg) return this.isoBg;
    const R = RES, FW = WORLD_W * R, FH = WORLD_H * R, I = View.ISO;
    const src = this.bg.getContext('2d').getImageData(0, 0, FW, FH).data;
    const c = document.createElement('canvas');
    c.width = FW; c.height = FH;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, FH);
    grad.addColorStop(0, '#1b1524'); grad.addColorStop(1, '#09070c');
    g.fillStyle = grad;
    g.fillRect(0, 0, FW, FH);
    for (const lx of [60, 200, 340]) {
      const rg = g.createRadialGradient(lx * R, 18 * R, 0, lx * R, 18 * R, 60 * R);
      rg.addColorStop(0, 'rgba(255,240,200,0.18)'); rg.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = rg; g.fillRect((lx - 60) * R, 0, 120 * R, 80 * R);
    }
    const img = g.getImageData(0, 0, FW, FH);
    const D = new Uint32Array(img.data.buffer);
    const S = new Uint32Array(src.buffer);
    const pack = (r, gg, b) => (255 << 24) | ((b & 255) << 16) | ((gg & 255) << 8) | (r & 255);
    const VH = this.getViewHeightsFine();
    const slabTop = pack(70, 50, 34), slabLow = pack(40, 28, 20);
    const water = [];
    const ox = I.ox * R, oy = I.oy * R, hc = I.c * R, slab = I.slab * R;
    for (let d = 0; d < FW + FH - 1; d++) {
      const xa = Math.max(0, d - (FH - 1)), xb = Math.min(FW - 1, d);
      for (let X = xa; X <= xb; X++) {
        const Y = d - X, f = Y * FW + X;
        const sx = Math.round(ox + (X - Y) * I.a);
        if (sx < 0 || sx >= FW) continue;
        const base = oy + (X + Y) * I.b;
        const top = Math.round(base - VH[f] * hc);
        const ground = Math.round(base);
        const bottom = Math.round(base + slab);
        const col = S[f];
        const side = pack((col & 255) * 0.6, ((col >> 8) & 255) * 0.6, ((col >> 16) & 255) * 0.6);
        const y0 = Math.max(0, top), y1 = Math.min(FH - 1, bottom);
        for (let yy = y0; yy <= y1; yy++) {
          D[yy * FW + sx] = yy === top ? col : yy < ground ? side : (yy === bottom ? slabLow : slabTop);
        }
      }
    }
    for (const f of this.waterPix) {
      const X = f % FW, Y = (f / FW) | 0;
      const sx = Math.round(ox + (X - Y) * I.a), top = Math.round(oy + (X + Y) * I.b - VH[f] * hc);
      if (sx >= 0 && sx < FW && top >= 0 && top < FH) water.push(top * FW + sx);
    }
    g.putImageData(img, 0, 0);
    this.isoWater = water;
    this.isoBg = c;
    return c;
  }

  drawHayBale(g, x, y) {
    const R = RES, X = x * R, Y = y * R;
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(X - 6, Y + 2, 20, 6);
    g.fillStyle = '#a8822a'; g.fillRect(X - 8, Y - 6, 18, 10);
    g.fillStyle = '#e4c058'; g.fillRect(X - 8, Y - 9, 18, 4);
    for (let i = 0; i < 18; i += 2) { g.fillStyle = i % 4 ? '#c8a040' : '#f0d070'; g.fillRect(X - 8 + i, Y - 9, 1, 3); }
    g.fillStyle = '#6a4a14'; g.fillRect(X - 4, Y - 9, 1, 13); g.fillRect(X + 4, Y - 9, 1, 13);
  }

  // Sponsor boards along the front edge of the stadium.
  drawBoards(g) {
    const R = RES, W = WORLD_W, H = WORLD_H;
    const names = ['DIRTCO', 'NITRO-X', 'MUDLINE', 'GRIT OIL', 'ROCKJAW', 'TREADZ'];
    const cols = [['#c8281c', '#fff'], ['#1c3c9c', '#ffd84a'], ['#f0c020', '#201810'], ['#1a1a1e', '#ff7020'], ['#2a7a3a', '#fff'], ['#e8e8e8', '#c8281c']];
    this.boards = [];
    for (let x0 = 2, k = (this.seed % names.length); x0 + 56 < W; x0 += 60, k++) {
      let clear = true;
      for (let x = x0; x < x0 + 56 && clear; x += 2) if (this.dist[(H - 4) * W + x] < 8) clear = false;
      if (!clear) continue;
      const [bg, fg] = cols[k % cols.length];
      g.fillStyle = '#111'; g.fillRect((x0 - 1) * R, (H - 10) * R, 58 * R, 10 * R);
      g.fillStyle = bg; g.fillRect(x0 * R, (H - 9) * R, 56 * R, 8 * R);
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x0 * R, (H - 9) * R, 56 * R, 1);
      Font.draw(g, names[k % names.length], (x0 + 28) * R, (H - 9) * R + 2, fg, { align: 'center', scale: 2 });
      this.boards.push([x0, x0 + 56]);
    }
  }

  drawTireStack(g, x, y) {
    const R = RES, X = x * R, Y = y * R;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.ellipse(X + 3, Y + 3, 9, 4, 0, 0, Math.PI * 2); g.fill();
    for (let i = 2; i >= 0; i--) {
      const yy = Y - i * 4;
      g.fillStyle = '#18181c'; g.beginPath(); g.ellipse(X, yy, 8, 4, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#34343c'; g.beginPath(); g.ellipse(X, yy - 1, 7, 3, 0, Math.PI, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#060608'; g.beginPath(); g.ellipse(X, Y - 9, 3, 1.4, 0, 0, Math.PI * 2); g.fill();
  }
}
