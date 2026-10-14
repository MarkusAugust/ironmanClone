'use strict';
// Trucks: pre-rendered pseudo-3D sprites and arcade physics.

const TRUCK_DEFS = [
  { name: 'RED', color: [218, 44, 40], hud: '#ff5a4a' },
  { name: 'BLUE', color: [40, 96, 226], hud: '#5c8dff' },
  { name: 'YELLOW', color: [238, 192, 30], hud: '#ffd84a' },
  { name: 'TITAN', color: [150, 152, 164], hud: '#c8cad4' },
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
const FP_PPU = 2.4; // first-person sprite pixels per world unit

const TruckSprites = (() => {
  const cache = {};
  const VARIANTS = 6; // 2 tread phases x 3 suspension heights

  function shadeColor(col, k) {
    return `rgb(${Math.min(255, col[0] * k) | 0},${Math.min(255, col[1] * k) | 0},${Math.min(255, col[2] * k) | 0})`;
  }

  // Stadium pickup in local units: x forward, y to the right, z up.
  // Parts marked body ride on the suspension; wheels stay on the ground.
  function model(color, bob, roll = 0) {
    const body = color;
    const dark = color.map(v => v * 0.5);
    const light = color.map(v => Math.min(255, v * 1.25 + 30));
    const contrast = (color[0] + color[1] + color[2]) / 3 > 150 ? [30, 30, 36] : [245, 245, 240];
    const glass = [38, 52, 72];
    const tire = [30, 28, 26];
    const frame = [48, 46, 52];
    const chrome = [205, 208, 214];
    const cage = [60, 60, 68];
    const parts = [];
    const B = (x0, x1, y0, y1, z0, z1, col, opts = {}) => parts.push(Object.assign({ x0, x1, y0, y1, z0, z1, col }, opts));
    // body parts ride on the suspension and lean with the roll (outer side down)
    const bodyB = (x0, x1, y0, y1, z0, z1, col, opts = {}) => {
      const lean = roll * (y0 + y1) / 2 * 0.17;
      B(x0, x1, y0, y1, z0 + bob + lean, z1 + bob + lean, col, opts);
    };
    // wheels with tread
    for (const [x0, x1] of [[3.0, 7.4], [-7.4, -3.0]]) {
      B(x0, x1, 3.7, 6.6, 0, 4.8, tire, { tire: true, side: 1 });
      B(x0, x1, -6.6, -3.7, 0, 4.8, tire, { tire: true, side: -1 });
    }
    // frame and lower body
    bodyB(-7.8, 7.6, -3.6, 3.6, 1.4, 3.0, frame);
    bodyB(-8.4, -7.6, -3.7, 3.7, 1.8, 3.0, frame);                    // rear bumper
    bodyB(7.4, 8.6, -3.5, 3.5, 1.8, 3.8, chrome);                     // front bumper / grille guard
    // hood and engine
    bodyB(2.6, 7.4, -3.9, 3.9, 3.0, 5.3, body);
    bodyB(3.6, 5.8, -1.0, 1.0, 5.3, 6.0, dark);                       // hood scoop
    bodyB(7.4, 7.7, -3.0, 3.0, 3.2, 4.8, [26, 26, 30]);               // grille
    bodyB(7.4, 7.8, 2.2, 3.5, 4.0, 4.9, [255, 250, 220], { glow: true });  // headlights
    bodyB(7.4, 7.8, -3.5, -2.2, 4.0, 4.9, [255, 250, 220], { glow: true });
    // fenders over the wheels
    for (const [x0, x1] of [[2.6, 7.8], [-7.8, -2.6]]) {
      bodyB(x0, x1, 3.9, 5.5, 4.6, 5.4, body);
      bodyB(x0, x1, -5.5, -3.9, 4.6, 5.4, body);
    }
    // cab: painted lower half, glass greenhouse, roof
    bodyB(-2.4, 2.6, -3.8, 3.8, 3.0, 5.6, body);
    bodyB(-2.0, 2.2, -3.4, 3.4, 5.6, 8.4, body, { glassSides: glass });
    bodyB(-2.2, 2.0, -3.6, 3.6, 8.4, 9.0, body);
    bodyB(-1.4, 0.6, -1.5, 1.5, 9.0, 9.06, [250, 250, 250]);          // roof number roundel
    bodyB(-0.9, 0.1, -0.7, 0.7, 9.06, 9.1, [20, 20, 24]);
    // light bar
    bodyB(1.2, 2.0, -3.2, 3.2, 9.0, 9.7, [24, 24, 28]);
    for (const y of [-2.4, -0.8, 0.8, 2.4]) bodyB(1.95, 2.15, y - 0.55, y + 0.55, 9.05, 9.65, [255, 220, 90], { glow: true });
    // bed
    bodyB(-7.8, -2.4, -3.9, 3.9, 3.0, 3.6, dark);
    bodyB(-7.8, -2.4, 3.4, 3.9, 3.6, 5.4, body);
    bodyB(-7.8, -2.4, -3.9, -3.4, 3.6, 5.4, body);
    bodyB(-7.8, -7.3, -3.4, 3.4, 3.6, 5.2, dark);                      // tailgate
    bodyB(-8.2, -7.8, 2.4, 3.8, 3.9, 5.0, [255, 36, 28], { glow: true }); // tail lights
    bodyB(-8.2, -7.8, -3.8, -2.4, 3.9, 5.0, [255, 36, 28], { glow: true });
    // roll cage over the bed
    bodyB(-3.0, -2.5, 2.8, 3.3, 5.4, 8.6, cage);
    bodyB(-3.0, -2.5, -3.3, -2.8, 5.4, 8.6, cage);
    bodyB(-3.1, -2.4, -3.3, 3.3, 8.1, 8.7, cage);
    bodyB(-7.2, -3.0, 2.8, 3.3, 6.9, 7.4, cage);
    bodyB(-7.2, -3.0, -3.3, -2.8, 6.9, 7.4, cage);
    bodyB(-7.3, -6.8, 2.8, 3.3, 5.4, 7.4, cage);
    bodyB(-7.3, -6.8, -3.3, -2.8, 5.4, 7.4, cage);
    // sponsor stripe along both sides, mud flaps
    bodyB(-7.8, 7.4, 3.9, 4.0, 3.9, 4.5, contrast);
    bodyB(-7.8, 7.4, -4.0, -3.9, 3.9, 4.5, contrast);
    bodyB(-2.0, 2.6, 3.8, 3.9, 3.2, 5.2, light);                      // door panel
    bodyB(-2.0, 2.6, -3.9, -3.8, 3.2, 5.2, light);
    B(-7.9, -7.6, 3.8, 6.4, 0.6 + bob * 0.5, 3.6 + bob, [20, 20, 22]);
    B(-7.9, -7.6, -6.4, -3.8, 0.6 + bob * 0.5, 3.6 + bob, [20, 20, 22]);
    return parts;
  }

  function render(color, angle, mode, variant) {
    const iso = mode === 'iso', fp = mode === 'fp';
    const K = fp ? 1 : RES; // 2D and isometric sprites carry RES x detail
    const SIZE = (fp ? 60 : iso ? 38 : 32) * K;
    const c = document.createElement('canvas');
    c.width = SIZE; c.height = SIZE;
    const g = c.getContext('2d');
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const ox = SIZE / 2, oy = (fp ? 46 : iso ? 24 : 20) * K;
    c.ox = ox; c.oy = oy; c.res = K;
    c.ppu = fp ? FP_PPU : 1;
    const I = View.ISO, S = I.truckScale;
    const phase = variant % 2;
    const bob = [-0.7, 0, 0.8][Math.floor(variant / 2) % 3];
    const roll = [-1, 0, 1][Math.floor(variant / 6)] ;
    // first person: camera looks along +X from slightly above
    const EL = 0.2, cosE = Math.cos(EL), sinE = Math.sin(EL);
    const rot = (x, y) => [x * ca - y * sa, x * sa + y * ca];
    const proj = fp
      ? (x, y, z) => { const [X, Y] = rot(x, y); return [ox + Y * FP_PPU, oy - z * cosE * FP_PPU - X * sinE * FP_PPU]; }
      : iso
        ? (x, y, z) => { const [X, Y] = rot(x, y); return [ox + (X - Y) * I.a * S * K, oy + ((X + Y) * I.b * S - z * 0.78 * S) * K]; }
        : (x, y, z) => { const [X, Y] = rot(x, y); return [ox + X * K, oy + (Y * 0.8 - z * 0.95) * K]; };
    // which way faces the camera, in world x/y
    const toCam = fp ? [-1, 0] : iso ? [0.7071, 0.7071] : [0, 1];
    const L = fp ? [-0.6, 0.35, 0.72] : iso ? [-0.25, 0.45, 0.86] : [-0.35, -0.3, 0.88];
    const light = (nx, ny, nz) => 0.42 + 0.62 * Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
    const parts = model(color, bob, roll).map(b => {
      const [X, Y] = rot((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
      return { b, key: X * toCam[0] + Y * toCam[1] + b.z0 * 0.45 };
    }).sort((a, b) => a.key - b.key);

    const fillQuad = (q, style) => {
      g.fillStyle = style;
      g.beginPath(); q.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill();
    };
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const line = (a, b, style, w) => {
      g.strokeStyle = style; g.lineWidth = w;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    };
    const lw = fp ? 1.3 : 0.9;

    for (const { b } of parts) {
      const faces = [
        { n: [1, 0], pts: [[b.x1, b.y0], [b.x1, b.y1]] },
        { n: [-1, 0], pts: [[b.x0, b.y1], [b.x0, b.y0]] },
        { n: [0, 1], pts: [[b.x1, b.y1], [b.x0, b.y1]] },
        { n: [0, -1], pts: [[b.x0, b.y0], [b.x1, b.y0]] },
      ];
      for (const f of faces) {
        const [wx, wy] = rot(f.n[0], f.n[1]);
        if (wx * toCam[0] + wy * toCam[1] <= 0.02) continue;
        const [a, bb] = f.pts;
        const q = [proj(a[0], a[1], b.z0), proj(bb[0], bb[1], b.z0), proj(bb[0], bb[1], b.z1), proj(a[0], a[1], b.z1)];
        let col = b.col;
        if (b.glassSides && f.n[0] !== -1) col = b.glassSides; // windshield and side windows; rear wall is painted
        const k = b.glow ? 1.15 : light(wx, wy, 0);
        fillQuad(q, shadeColor(col, k));
        if (b.glassSides && f.n[0] !== -1) {
          // window frame and a glint
          line(lerp(q[3], q[2], 0.1), lerp(q[0], q[1], 0.1), 'rgba(255,255,255,0.25)', lw);
        }
        if (b.tire) {
          if (f.n[0] !== 0) {
            // tread blocks across the rolling face
            for (const t of [0.2, 0.45, 0.7, 0.95]) {
              const tt = (t + phase * 0.125) % 1;
              line(lerp(q[0], q[3], tt), lerp(q[1], q[2], tt), 'rgba(0,0,0,0.6)', lw);
            }
          } else if (f.n[1] === b.side) {
            // outer sidewall: rim and a lug that moves with the tread phase
            const hub = [lerp(lerp(q[0], q[1], 0.3), lerp(q[3], q[2], 0.3), 0.3), lerp(lerp(q[0], q[1], 0.7), lerp(q[3], q[2], 0.7), 0.3),
              lerp(lerp(q[0], q[1], 0.7), lerp(q[3], q[2], 0.7), 0.7), lerp(lerp(q[0], q[1], 0.3), lerp(q[3], q[2], 0.3), 0.7)];
            fillQuad(hub, shadeColor([170, 172, 180], k));
            const lug = phase ? lerp(lerp(hub[0], hub[1], 0.5), lerp(hub[3], hub[2], 0.5), 0.2) : lerp(lerp(hub[0], hub[1], 0.5), lerp(hub[3], hub[2], 0.5), 0.8);
            g.fillStyle = '#222'; g.fillRect(lug[0] - 0.6 * K, lug[1] - 0.6 * K, 1.2 * K, 1.2 * K);
          }
        }
      }
      const top = [proj(b.x0, b.y0, b.z1), proj(b.x1, b.y0, b.z1), proj(b.x1, b.y1, b.z1), proj(b.x0, b.y1, b.z1)];
      fillQuad(top, shadeColor(b.col, b.glow ? 1.2 : light(0, 0, 1)));
      if (b.tire) {
        for (const t of [0.15, 0.4, 0.65, 0.9]) {
          const tt = (t + phase * 0.125) % 1;
          line(lerp(top[0], top[1], tt), lerp(top[3], top[2], tt), 'rgba(0,0,0,0.55)', lw);
        }
      }
    }
    // hood stripe
    line(proj(3.0, 0, 5.32 + bob), proj(7.3, 0, 5.32 + bob), 'rgba(255,255,255,0.8)', fp ? 1.6 : 1.4);

    // crisp pixels: hard alpha, then a dark outline
    const im = g.getImageData(0, 0, SIZE, SIZE);
    const d = im.data;
    const solid = new Uint8Array(SIZE * SIZE);
    for (let i = 0; i < solid.length; i++) {
      if (d[i * 4 + 3] >= 110) {
        const a = d[i * 4 + 3] / 255;
        d[i * 4] = Math.min(255, d[i * 4] / a); d[i * 4 + 1] = Math.min(255, d[i * 4 + 1] / a); d[i * 4 + 2] = Math.min(255, d[i * 4 + 2] / a);
        d[i * 4 + 3] = 255; solid[i] = 1;
      } else d[i * 4 + 3] = 0;
    }
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      if (solid[i]) continue;
      const nb = (x > 0 && solid[i - 1]) || (x < SIZE - 1 && solid[i + 1]) ||
        (y > 0 && solid[i - SIZE]) || (y < SIZE - 1 && solid[i + SIZE]);
      if (nb) { d[i * 4] = 16; d[i * 4 + 1] = 12; d[i * 4 + 2] = 10; d[i * 4 + 3] = 255; }
    }
    g.putImageData(im, 0, 0);
    c.px = new Uint32Array(im.data.buffer.slice(0));
    return c;
  }

  // variant: tread phase (0/1) + 2 * suspension (0 compressed, 1 normal, 2 extended) + 6 * roll (0 left, 1 level, 2 right)
  function get(slot, mode = View.mode, variant = 8) {
    const key = slot + mode + variant;
    if (!cache[key]) {
      const col = TRUCK_DEFS[slot].color;
      cache[key] = Array.from({ length: SPRITE_STEPS }, (_, i) => render(col, (i / SPRITE_STEPS) * Math.PI * 2, mode, variant));
    }
    return cache[key];
  }

  // Footprint shadow cast along the sun direction.
  function drawShadow(ctx, t, track, sun) {
    const gh = track.heightAt(t.x, t.y);
    const lift = Math.max(0, t.z - gh) * 1.5;
    const c = Math.cos(t.h), s = Math.sin(t.h);
    const off = 4 + lift;
    const dx = sun[0] * off, dy = sun[1] * off;
    const corners = [[8.4, 6.4], [8.4, -6.4], [-8.4, -6.4], [-8.4, 6.4]].map(([x, y]) =>
      View.point(t.x + x * c - y * s + dx * 0.5, t.y + x * s + y * c + dy * 0.5, gh, 0));
    const a = Math.max(0.12, 0.38 - lift * 0.01) * (sun[2] == null ? 1 : sun[2]);
    ctx.fillStyle = `rgba(10,6,4,${a})`;
    ctx.beginPath();
    corners.forEach((p, i) => i ? ctx.lineTo(Math.round(p[0]), Math.round(p[1])) : ctx.moveTo(Math.round(p[0]), Math.round(p[1])));
    ctx.closePath();
    ctx.fill();
  }

  return { get, drawShadow, VARIANTS };
})();

class Truck {
  constructor(slot, opts = {}) {
    this.slot = slot;
    this.def = TRUCK_DEFS[slot];
    this.name = opts.name || this.def.name;
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
    this.drift = 0; this.yawRate = 0; this.roll = 0;
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
    // power slide: on the gas and turning at speed, the rear steps out; better tires hold it in
    const slideWant = (!this.air && ctl.gas && !ctl.brake && Math.abs(ctl.steer) > 0.3 && f > top * 0.45) ? Math.abs(ctl.steer) : 0;
    this.drift += (slideWant - this.drift) * Math.min(1, dt * (slideWant > this.drift ? 3.2 : 5));
    if (!this.air) {
      const sp = Math.abs(f);
      const turnF = Math.min(1, 0.4 + sp / 40);
      steerRate = ctl.steer * PHYS.turn * turnF * (f < -3 ? -1 : 1) * (1 + 0.5 * this.drift);
      grip *= 1 - 0.62 * this.drift * (1 - this.up.tires * 0.08);
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
    // the heading follows the wheel with a little inertia, so the truck has weight
    this.yawRate += (steerRate - this.yawRate) * Math.min(1, dt * (this.air ? 3 : 9));
    this.h += this.yawRate * dt;
    // body roll toward the outside of the turn
    const rollWant = this.air ? 0 : Math.max(-1, Math.min(1, this.yawRate * Math.max(0, f) / 260));
    this.roll += (rollWant - this.roll) * Math.min(1, dt * 7);
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
    const c = track.clearance(this.x, this.y, this.idx);
    if (c >= R) return;
    const n = track.wallNormal(this.x, this.y, this.idx);
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
    const i = track.localIdx(this.x, this.y, this.idx);
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

  // Which pre-rendered variant fits right now: wheels roll, suspension squats or hangs.
  spriteVariant(t) {
    this.treadT = (this.treadT || 0) + Math.abs(this.forward) * 0.02;
    const phase = Math.floor(this.treadT) % 2;
    let susp = 1;
    if (this.air) susp = 2;
    else if (this.bumpT > 0.05) susp = 0;
    const roll = this.roll > 0.35 ? 2 : this.roll < -0.35 ? 0 : 1;
    return phase + susp * 2 + roll * 6;
  }

  draw(ctx, track, t, sun) {
    const gh = track.heightAt(this.x, this.y);
    const lift = Math.max(0, this.z - gh) * 1.5;
    TruckSprites.drawShadow(ctx, this, track, sun || [0.5, 0.6]);
    const a = this.h / (Math.PI * 2) * SPRITE_STEPS;
    let fi = Math.round(a) % SPRITE_STEPS;
    if (fi < 0) fi += SPRITE_STEPS;
    const surf = track.surfAt(this.x, this.y);
    const bob = (!this.air && this.speed > 20 && surf !== SURF.DIRT) ? ((t * 20 | 0) % 2) : 0;
    const spr = TruckSprites.get(this.slot, View.mode, this.spriteVariant(t))[fi];
    const [px, py] = View.point(this.x, this.y, gh, lift + bob);
    const k = spr.res;
    ctx.drawImage(spr, Math.round(px * k - spr.ox) / k, Math.round(py * k - spr.oy) / k, spr.width / k, spr.height / k);
  }
}
