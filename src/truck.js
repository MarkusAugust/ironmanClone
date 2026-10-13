'use strict';
// Trucks: pre-rendered pseudo-3D sprites and arcade physics.

const TRUCK_DEFS = [
  { name: 'RED', color: [218, 44, 40], hud: '#ff5a4a' },
  { name: 'BLUE', color: [40, 96, 226], hud: '#5c8dff' },
  { name: 'YELLOW', color: [238, 192, 30], hud: '#ffd84a' },
  { name: 'IRONMAN', color: [150, 152, 164], hud: '#c8cad4' },
];

const PHYS = {
  baseTop: 86, topPer: 7.5,
  baseAcc: 112, accPer: 18,
  baseGrip: 4.0, gripPer: 0.85,
  turn: 3.4, revTop: 34, brake: 230, coast: 42,
  nitroTime: 1.5, nitroTop: 1.5, nitroAcc: 2.4,
  gravity: 250, slopeG: 140, radius: 4.5,
};

const SPRITE_STEPS = 32;
const SPRITE_SIZE = 30;
const SPRITE_CY = 18; // ground center inside the sprite

const TruckSprites = (() => {
  const cache = {};

  function shadeColor(col, k) {
    return `rgb(${Math.min(255, col[0] * k) | 0},${Math.min(255, col[1] * k) | 0},${Math.min(255, col[2] * k) | 0})`;
  }

  function render(color, angle) {
    const c = document.createElement('canvas');
    c.width = SPRITE_SIZE; c.height = SPRITE_SIZE;
    const g = c.getContext('2d');
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const ox = SPRITE_SIZE / 2, oy = SPRITE_CY;
    const proj = (x, y, z) => {
      const X = x * ca - y * sa, Y = x * sa + y * ca;
      return [ox + X, oy + Y * 0.8 - z * 0.95];
    };
    const body = color;
    const dark = [color[0] * 0.55, color[1] * 0.55, color[2] * 0.55];
    const glass = [40, 52, 70];
    const tire = [34, 32, 30];
    const chrome = [210, 210, 215];
    const boxes = [
      { x0: -7.5, x1: 7, y0: -4, y1: 4, z0: 2, z1: 5, col: body },
      { x0: -2.5, x1: 2.8, y0: -3.5, y1: 3.5, z0: 5, z1: 9, col: body, side: glass },
      { x0: -7.5, x1: -6.5, y0: -4, y1: 4, z0: 5, z1: 7, col: dark },
      { x0: 7, x1: 8.2, y0: -3.2, y1: 3.2, z0: 2, z1: 4, col: chrome },
      { x0: 3, x1: 7.2, y0: 3.6, y1: 6.2, z0: 0, z1: 4.5, col: tire },
      { x0: 3, x1: 7.2, y0: -6.2, y1: -3.6, z0: 0, z1: 4.5, col: tire },
      { x0: -7, x1: -2.8, y0: 3.6, y1: 6.2, z0: 0, z1: 4.5, col: tire },
      { x0: -7, x1: -2.8, y0: -6.2, y1: -3.6, z0: 0, z1: 4.5, col: tire },
    ];
    const L = [-0.35, -0.3, 0.88];
    const light = (nx, ny, nz) => 0.42 + 0.62 * Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
    const keyed = boxes.map(b => {
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      return { b, key: cx * sa + cy * ca + b.z0 * 0.45 };
    }).sort((a, b) => a.key - b.key);

    for (const { b } of keyed) {
      const faces = [
        { n: [1, 0], pts: [[b.x1, b.y0], [b.x1, b.y1]] },
        { n: [-1, 0], pts: [[b.x0, b.y1], [b.x0, b.y0]] },
        { n: [0, 1], pts: [[b.x1, b.y1], [b.x0, b.y1]] },
        { n: [0, -1], pts: [[b.x0, b.y0], [b.x1, b.y0]] },
      ];
      for (const f of faces) {
        const wx = f.n[0] * ca - f.n[1] * sa, wy = f.n[0] * sa + f.n[1] * ca;
        if (wy <= 0.02) continue;
        const [a, bb] = f.pts;
        const q = [proj(a[0], a[1], b.z0), proj(bb[0], bb[1], b.z0), proj(bb[0], bb[1], b.z1), proj(a[0], a[1], b.z1)];
        let col = b.side || b.col;
        if (b.side && f.n[0] === -1) col = b.col; // rear of cab is painted
        g.fillStyle = shadeColor(col, light(wx, wy, 0));
        g.beginPath(); q.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill();
      }
      const top = [proj(b.x0, b.y0, b.z1), proj(b.x1, b.y0, b.z1), proj(b.x1, b.y1, b.z1), proj(b.x0, b.y1, b.z1)];
      g.fillStyle = shadeColor(b.col, light(0, 0, 1));
      g.beginPath(); top.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill();
    }
    // racing stripe on the hood
    const s1 = proj(3.5, 0, 5.05), s2 = proj(6.8, 0, 5.05);
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(s1[0], s1[1]); g.lineTo(s2[0], s2[1]); g.stroke();

    // crisp pixels: hard alpha, then a dark outline
    const im = g.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    const d = im.data;
    const solid = new Uint8Array(SPRITE_SIZE * SPRITE_SIZE);
    for (let i = 0; i < solid.length; i++) {
      if (d[i * 4 + 3] >= 110) {
        const a = d[i * 4 + 3] / 255;
        d[i * 4] = Math.min(255, d[i * 4] / a); d[i * 4 + 1] = Math.min(255, d[i * 4 + 1] / a); d[i * 4 + 2] = Math.min(255, d[i * 4 + 2] / a);
        d[i * 4 + 3] = 255; solid[i] = 1;
      } else d[i * 4 + 3] = 0;
    }
    for (let y = 0; y < SPRITE_SIZE; y++) for (let x = 0; x < SPRITE_SIZE; x++) {
      const i = y * SPRITE_SIZE + x;
      if (solid[i]) continue;
      const nb = (x > 0 && solid[i - 1]) || (x < SPRITE_SIZE - 1 && solid[i + 1]) ||
        (y > 0 && solid[i - SPRITE_SIZE]) || (y < SPRITE_SIZE - 1 && solid[i + SPRITE_SIZE]);
      if (nb) { d[i * 4] = 16; d[i * 4 + 1] = 12; d[i * 4 + 2] = 10; d[i * 4 + 3] = 255; }
    }
    g.putImageData(im, 0, 0);
    return c;
  }

  function get(slot) {
    if (!cache[slot]) {
      const col = TRUCK_DEFS[slot].color;
      cache[slot] = Array.from({ length: SPRITE_STEPS }, (_, i) => render(col, (i / SPRITE_STEPS) * Math.PI * 2));
    }
    return cache[slot];
  }

  let shadow = null;
  function getShadow() {
    if (shadow) return shadow;
    shadow = document.createElement('canvas');
    shadow.width = 20; shadow.height = 12;
    const g = shadow.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.38)';
    for (let y = 0; y < 12; y++) for (let x = 0; x < 20; x++) {
      const dx = (x + 0.5 - 10) / 9, dy = (y + 0.5 - 6) / 5;
      if (dx * dx + dy * dy <= 1) g.fillRect(x, y, 1, 1);
    }
    return shadow;
  }

  return { get, getShadow };
})();

class Truck {
  constructor(slot, opts = {}) {
    this.slot = slot;
    this.def = TRUCK_DEFS[slot];
    this.name = opts.name || this.def.name;
    this.sprites = TruckSprites.get(slot);
    this.human = !!opts.human;
    this.player = opts.player == null ? -1 : opts.player;
    this.up = Object.assign({ tires: 0, shocks: 0, accel: 0, speed: 0 }, opts.up || {});
    this.nitros = opts.nitros || 0;
    this.topMul = opts.topMul || 1;
    this.accMul = opts.accMul || 1;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.h = 0;
    this.air = false; this.airTime = 0;
    this.nitroT = 0;
    this.bumpT = 0;
    this.idx = 0; this.crossings = 0; this.maxCross = 0;
    this.finished = false; this.finishTime = 0; this.place = 0;
    this.lapTimes = [];
    this.wrongWayT = 0;
    this.slip = 0;
    this.lastImpact = 0;
    this.events = [];
  }

  get topSpeed() { return (PHYS.baseTop + PHYS.topPer * this.up.speed) * this.topMul; }
  get accel() { return (PHYS.baseAcc + PHYS.accPer * this.up.accel) * this.accMul; }
  get grip() { return PHYS.baseGrip + PHYS.gripPer * this.up.tires; }
  get speed() { return Math.hypot(this.vx, this.vy); }
  get forward() { return this.vx * Math.cos(this.h) + this.vy * Math.sin(this.h); }

  placeAt(p, track) {
    this.x = p.x; this.y = p.y; this.h = p.h;
    this.z = track.heightAt(p.x, p.y);
    this.idx = p.idx;
  }

  useNitro() {
    if (this.nitros <= 0 || this.nitroT > 0.2) return false;
    this.nitros--;
    this.nitroT = PHYS.nitroTime;
    this.events.push('nitro');
    return true;
  }

  update(dt, ctl, track) {
    const surf = track.surfAt(this.x, this.y);
    const c = Math.cos(this.h), s = Math.sin(this.h);
    let f = this.vx * c + this.vy * s;
    let l = -this.vx * s + this.vy * c;
    let top = this.topSpeed, acc = this.accel, grip = this.grip;
    if (ctl.nitro) this.useNitro();
    if (this.nitroT > 0) { top *= PHYS.nitroTop; acc *= PHYS.nitroAcc; this.nitroT -= dt; }
    if (surf === SURF.MUD) { top *= 0.6; acc *= 0.6; grip *= 0.55; }
    else if (surf === SURF.WATER) { top *= 0.68; acc *= 0.7; grip *= 0.8; }
    if (this.bumpT > 0) { grip *= 0.5 + this.up.shocks * 0.08; this.bumpT -= dt; }

    let steerRate = 0;
    if (!this.air) {
      const sp = Math.abs(f);
      const turnF = Math.min(1, 0.4 + sp / 40);
      steerRate = ctl.steer * PHYS.turn * turnF * (f < -3 ? -1 : 1);
      if (ctl.gas && !ctl.brake) {
        if (f < top) f = Math.min(top, f + acc * dt);
      } else if (ctl.brake) {
        if (f > 3) f = Math.max(0, f - PHYS.brake * dt);
        else f = Math.max(-PHYS.revTop, f - 90 * dt);
      } else {
        f -= Math.sign(f) * Math.min(Math.abs(f), PHYS.coast * dt);
      }
      if (f > top) f = top + (f - top) * Math.exp(-2.2 * dt);
      const [gx, gy] = track.gradAt(this.x, this.y);
      f -= PHYS.slopeG * (gx * c + gy * s) * dt;
      // moguls and slopes kick the truck a bit sideways
      l -= PHYS.slopeG * 0.3 * (-gx * s + gy * c) * dt;
      l *= Math.exp(-grip * dt);
      this.slip = Math.abs(l);
    } else {
      steerRate = ctl.steer * PHYS.turn * 0.3;
      f *= Math.exp(-0.05 * dt);
    }
    this.vx = c * f - s * l;
    this.vy = s * f + c * l;
    this.h += steerRate * dt;
    if (this.h > Math.PI) this.h -= Math.PI * 2;
    if (this.h < -Math.PI) this.h += Math.PI * 2;

    this.move(dt, track);
    this.updateHeight(dt, track);
    this.updateProgress(track);
  }

  move(dt, track) {
    const R = PHYS.radius;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const c = track.clearance(this.x, this.y);
    if (c >= R) return;
    const n = track.wallNormal(this.x, this.y);
    if (!n) return;
    this.x += n[0] * (R - c);
    this.y += n[1] * (R - c);
    const vn = this.vx * n[0] + this.vy * n[1];
    if (vn < 0) {
      this.vx -= 1.35 * vn * n[0];
      this.vy -= 1.35 * vn * n[1];
      this.vx *= 0.92; this.vy *= 0.92;
      if (-vn > 25) { this.events.push({ t: 'wall', power: -vn }); this.bumpT = Math.max(this.bumpT, 0.15); }
    }
  }

  updateHeight(dt, track) {
    const gh = track.heightAt(this.x, this.y);
    if (this.air) {
      this.airTime += dt;
      this.vz -= PHYS.gravity * dt;
      this.z += this.vz * dt;
      if (this.z <= gh) {
        const impact = -this.vz;
        this.z = gh;
        this.air = false;
        if (this.airTime > 0.12) {
          const pen = Math.max(0, Math.min(0.35, (impact - 50) / 350)) * (1 - this.up.shocks * 0.16);
          this.vx *= 1 - pen; this.vy *= 1 - pen;
          this.bumpT = 0.25 + pen;
          this.events.push({ t: 'land', power: impact });
          if (impact > 110 && this.up.shocks < 3) {
            this.vz = impact * (0.22 - this.up.shocks * 0.06);
            this.air = true; this.airTime = 0;
          }
        }
        if (!this.air) this.vz = 0;
      }
    } else {
      const vzg = (gh - this.z) / dt;
      if (vzg < this.vz - PHYS.gravity * dt * 1.5 && this.vz > -5) {
        this.air = true;
        this.airTime = 0;
        this.vz -= PHYS.gravity * dt;
        this.z += this.vz * dt;
        if (this.z < gh) { this.z = gh; this.air = false; }
      } else {
        this.z = gh;
        const lim = 20 + this.speed * 0.55;
        this.vz = Math.max(-lim, Math.min(lim, vzg));
      }
    }
  }

  updateProgress(track) {
    const i = track.idxAt(this.x, this.y);
    if (i < 0) return;
    const N = track.N;
    const d = i - this.idx;
    if (d < -N / 2) { this.crossings++; this.events.push('cross'); }
    else if (d > N / 2) this.crossings--;
    this.idx = i;
    const back = d < 0 && d > -N / 2;
    this.wrongWayT = back ? this.wrongWayT + 1 : Math.max(0, this.wrongWayT - 2);
  }

  progress(track) { return this.crossings * track.N + this.idx; }

  draw(ctx, track, t) {
    const gh = track.heightAt(this.x, this.y);
    const lift = Math.max(0, this.z - gh) * 1.5;
    const sh = TruckSprites.getShadow();
    ctx.drawImage(sh, Math.round(this.x - 10 + lift * 0.35), Math.round(this.y - 6 + 1 + lift * 0.4));
    let a = this.h / (Math.PI * 2) * SPRITE_STEPS;
    let fi = Math.round(a) % SPRITE_STEPS;
    if (fi < 0) fi += SPRITE_STEPS;
    const bob = (!this.air && this.speed > 20 && track.surfAt(this.x, this.y) !== SURF.DIRT) ? ((t * 20 | 0) % 2) : 0;
    const sx = Math.round(this.x - SPRITE_SIZE / 2), sy = Math.round(this.y - SPRITE_CY - lift - bob);
    if (this.nitroT > 0) {
      const c = Math.cos(this.h), s = Math.sin(this.h);
      for (let k = 0; k < 4; k++) {
        const back = 9 + k * 2 + Math.random() * 2;
        const fx = this.x - c * back + (Math.random() - 0.5) * 2;
        const fy = this.y - s * back * 0.8 - 3 - lift + (Math.random() - 0.5) * 2;
        ctx.fillStyle = k < 1 ? '#fff6c0' : k < 2 ? '#ffd040' : k < 3 ? '#ff8a20' : '#d03010';
        ctx.fillRect(Math.round(fx), Math.round(fy), 2, 2);
      }
    }
    ctx.drawImage(this.sprites[fi], sx, sy);
  }
}
