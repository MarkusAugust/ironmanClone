'use strict';
// Bridge decks over figure-eight crossings. The ramps are part of the terrain;
// the deck, its railings, pillars and shadow are drawn as their own layer so
// trucks under the bridge are hidden by it and trucks on it are drawn on top.

Object.assign(Track.prototype, {
  // nearest sample of the upper road around a crossing
  upperSample(c, x, y) {
    const N = this.N, span = Math.ceil(c.D / this.sp) + 14;
    let best = c.up, bd = 1e9;
    for (let k = -span; k <= span; k++) {
      const i = (c.up + k + N) % N;
      const dx = this.cx[i] - x, dy = this.cy[i] - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  },

  // which fine pixels belong to the deck (1) or its railings (2), and pillar spots
  deckInfo(c) {
    if (c.deck) return c.deck;
    const R = RES, W = WORLD_W, H = WORLD_H, FW = W * R, FH = H * R;
    const ext = c.D + this.halfW + 10;
    const X0 = Math.max(0, Math.floor((c.x - ext) * R)), X1 = Math.min(FW - 1, Math.ceil((c.x + ext) * R));
    const Y0 = Math.max(0, Math.floor((c.y - ext) * R)), Y1 = Math.min(FH - 1, Math.ceil((c.y + ext) * R));
    const mask = new Uint8Array(FW * FH), srF = new Float32Array(FW * FH), latF = new Float32Array(FW * FH);
    const maskW = new Uint8Array(W * H);
    for (let Y = Y0; Y <= Y1; Y++) for (let X = X0; X <= X1; X++) {
      const wx = (X + 0.5) / R, wy = (Y + 0.5) / R;
      const i = this.upperSample(c, wx, wy);
      const d = (wx - this.cx[i]) * -this.ty[i] + (wy - this.cy[i]) * this.tx[i];
      const sr = this.sRel(c, i, wx, wy);
      if (Math.abs(sr) > c.D || Math.abs(d) > this.halfW + 2.2) continue;
      const f = Y * FW + X;
      mask[f] = Math.abs(d) > this.halfW ? 2 : 1;
      srF[f] = sr; latF[f] = d;
      maskW[(wy | 0) * W + (wx | 0)] = Math.max(maskW[(wy | 0) * W + (wx | 0)], mask[f]);
    }
    // pillars at the ends of the deck, beside the road underneath
    const pillars = [];
    for (const end of [-1, 1]) {
      const sr = end * (c.D - 2.5);
      const i = (c.up + Math.round(sr / this.sp) + this.N) % this.N;
      for (const side of [-1, 1]) {
        const off = side * (this.halfW - 4);
        pillars.push([this.cx[i] - this.ty[i] * off, this.cy[i] + this.tx[i] * off]);
      }
    }
    c.deck = { mask, srF, latF, maskW, pillars, box: [X0, X1, Y0, Y1] };
    return c.deck;
  },

  deckColor(c, f) {
    const D = c.deck, sr = D.srF[f] + 200;
    if (D.mask[f] === 2) {
      const red = Math.floor(sr / 3) % 2 === 0;
      return red ? [204, 44, 34] : [238, 238, 232];
    }
    if (Math.abs(D.srF[f]) > c.D - 1.2) return [120, 124, 132];                 // steel lip at the deck ends
    if (sr % 1.6 < 0.28) return [62, 42, 26];                                    // plank gaps
    const k = 0.85 + 0.3 * hash2(Math.floor(sr / 1.6), 7, this.seed);
    const grain = hash2(Math.floor(D.latF[f] * 2), Math.floor(sr / 1.6), 3) > 0.8 ? 0.9 : 1;
    return [156 * k * grain, 112 * k * grain, 68 * k * grain];
  },

  // top view: deck canvas and its shadow on the road below
  deckTop(c) {
    if (c.top) return c.top;
    const R = RES, FW = WORLD_W * R, FH = WORLD_H * R, D = this.deckInfo(c);
    const sun = MOODS[this.mood].sun;
    const deck = document.createElement('canvas'), shadow = document.createElement('canvas');
    deck.width = shadow.width = FW; deck.height = shadow.height = FH;
    const g = deck.getContext('2d'), gs = shadow.getContext('2d');
    const img = g.createImageData(FW, FH), sh = gs.createImageData(FW, FH);
    const [X0, X1, Y0, Y1] = D.box;
    const ox = Math.round(sun[0] * c.BH * 0.6 * R), oy = Math.round(sun[1] * c.BH * 0.6 * R);
    for (let Y = Y0; Y <= Y1; Y++) for (let X = X0; X <= X1; X++) {
      const f = Y * FW + X;
      if (!D.mask[f]) continue;
      const [r, gg, b] = this.deckColor(c, f);
      img.data.set([r, gg, b, 255], f * 4);
      const sx = X + ox, sy = Y + oy;
      if (sx >= 0 && sy >= 0 && sx < FW && sy < FH) sh.data.set([8, 4, 2, 110], (sy * FW + sx) * 4);
    }
    g.putImageData(img, 0, 0);
    gs.putImageData(sh, 0, 0);
    c.top = { deck, shadow };
    return c.top;
  },

  // isometric: deck slab on pillars, and its shadow on the ground
  deckIso(c) {
    if (c.iso) return c.iso;
    const R = RES, FW = WORLD_W * R, FH = WORLD_H * R, I = View.ISO, D = this.deckInfo(c);
    const VH = this.getViewHeightsFine();
    const sun = MOODS[this.mood].sun;
    const deck = document.createElement('canvas'), shadow = document.createElement('canvas');
    deck.width = shadow.width = FW; deck.height = shadow.height = FH;
    const g = deck.getContext('2d'), gs = shadow.getContext('2d');
    const img = g.createImageData(FW, FH), sh = gs.createImageData(FW, FH);
    const P = new Uint32Array(img.data.buffer), S = new Uint32Array(sh.data.buffer);
    const pack = (r, gg, b, a = 255) => (a << 24) | ((b & 255) << 16) | ((gg & 255) << 8) | (r & 255);
    const ox = I.ox * R, oy = I.oy * R, hc = I.c * R;
    const [X0, X1, Y0, Y1] = D.box;
    const nearPillar = (wx, wy) => D.pillars.some(([px, py]) => Math.abs(px - wx) < 1.6 && Math.abs(py - wy) < 1.6);
    const sox = sun[0] * c.BH * 0.6 * R, soy = sun[1] * c.BH * 0.6 * R;
    for (let d = X0 + Y0; d <= X1 + Y1; d++) {
      for (let X = Math.max(X0, d - Y1); X <= Math.min(X1, d - Y0); X++) {
        const Y = d - X, f = Y * FW + X;
        const wx = (X + 0.5) / R, wy = (Y + 0.5) / R;
        const sx = Math.round(ox + (X - Y) * I.a);
        if (sx < 0 || sx >= FW) continue;
        const base = oy + (X + Y) * I.b;
        if (nearPillar(wx, wy)) {
          const top = Math.round(base - (c.BH - 2.5) * hc), bot = Math.round(base - VH[f] * hc);
          const lit = (X + Y) % 3 === 0 ? 0.8 : 1;
          for (let yy = Math.max(0, top); yy <= Math.min(FH - 1, bot); yy++) P[yy * FW + sx] = pack(150 * lit, 150 * lit, 158 * lit);
        }
        if (!D.mask[f]) continue;
        const [r, gg, b] = this.deckColor(c, f);
        const topH = D.mask[f] === 2 ? c.BH + 2.5 : c.BH;
        const top = Math.round(base - topH * hc), bot = Math.round(base - (c.BH - 2.5) * hc);
        for (let yy = Math.max(0, top); yy <= Math.min(FH - 1, bot); yy++) {
          P[yy * FW + sx] = yy === top ? pack(r, gg, b) : D.mask[f] === 2 ? pack(r * 0.7, gg * 0.7, b * 0.7) : pack(70, 62, 56);
        }
        // shadow lands on the ground beside/below
        const gx = Math.round(X + sox), gy = Math.round(Y + soy);
        if (gx >= 0 && gy >= 0 && gx < FW && gy < FH) {
          const gsx = Math.round(ox + (gx - gy) * I.a), gsy = Math.round(oy + (gx + gy) * I.b - VH[gy * FW + gx] * hc);
          if (gsx >= 0 && gsx < FW && gsy >= 0 && gsy < FH) { S[gsy * FW + gsx] = pack(8, 4, 2, 110); if (gsy + 1 < FH) S[(gsy + 1) * FW + gsx] = pack(8, 4, 2, 110); }
        }
      }
    }
    g.putImageData(img, 0, 0);
    gs.putImageData(sh, 0, 0);
    c.iso = { deck, shadow };
    return c.iso;
  },

  // cockpit: deck heights and colors at world resolution
  deckWorld(c) {
    if (c.world) return c.world;
    const R = RES, W = WORLD_W, FW = W * R, D = this.deckInfo(c);
    const cols = new Map();
    for (let p = 0; p < D.maskW.length; p++) {
      if (!D.maskW[p]) continue;
      const x = p % W, y = (p - x) / W, f = (y * R + 1) * FW + x * R + 1;
      const m = D.mask[f] || D.maskW[p];
      const col = D.mask[f] ? this.deckColor(c, f) : [156, 112, 68];
      cols.set(p, { col, h: m === 2 ? c.BH + 2.5 : c.BH });
    }
    c.world = cols;
    return cols;
  },
});
