'use strict';
// Lighting moods per track: day, sunset or night under floodlights.
// Applied as a multiply layer over the world (2D and isometric) and baked into
// the first-person terrain colors, so trucks, track and effects share one light.

const MOODS = {
  day: {
    name: 'DAY', tint: [1.0, 0.99, 0.95], sun: [0.45, 0.6, 1.0],
    sky: [[96, 150, 222], [176, 210, 238]], fog: [176, 200, 222], stars: false, lamps: false, crowdLight: 1.0,
  },
  sunset: {
    name: 'SUNSET', tint: [1.0, 0.78, 0.6], sun: [1.15, 0.35, 0.85],
    sky: [[58, 36, 92], [255, 150, 70]], fog: [210, 120, 90], stars: false, lamps: false, crowdLight: 0.85, sunDisk: true,
  },
  night: {
    name: 'NIGHT', tint: [0.32, 0.36, 0.55], sun: [0.25, 0.3, 0.5],
    sky: [[8, 8, 22], [40, 30, 62]], fog: [26, 20, 38], stars: true, lamps: true, crowdLight: 0.7,
  },
};
const MOOD_ORDER = ['day', 'sunset', 'night'];
// floodlight towers just outside the stadium
const FLOODLIGHTS = [[-14, -14], [WORLD_W + 14, -14], [-14, WORLD_H + 14], [WORLD_W + 14, WORLD_H + 14], [WORLD_W / 2, -16], [WORLD_W / 2, WORLD_H + 16]];

const Mood = (() => {
  const reduceMotion = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();

  function of(track) { return MOODS[track.mood] || MOODS.day; }

  // Per-pixel RGB light multiplier over the world.
  function lightMap(track) {
    if (track.lightMap) return track.lightMap;
    const m = of(track), W = WORLD_W, H = WORLD_H;
    const L = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let r = m.tint[0], g = m.tint[1], b = m.tint[2];
      if (track.mood === 'night') {
        let pool = 0;
        for (const [lx, ly] of FLOODLIGHTS) {
          const d2 = (x - lx) * (x - lx) + (y - ly) * (y - ly);
          pool += Math.exp(-d2 / (2 * 84 * 84));
        }
        pool = Math.min(0.78, pool * 0.8);
        r += (0.98 - r) * pool; g += (0.92 - g) * pool; b += (0.8 - b) * pool;
      } else if (track.mood === 'sunset') {
        const k = 0.88 + 0.2 * (1 - x / W);
        r *= k; g *= k; b *= k;
      }
      const i = (y * W + x) * 3;
      L[i] = r; L[i + 1] = g; L[i + 2] = b;
    }
    track.lightMap = L;
    return L;
  }

  function lightAt(track, x, y) {
    const L = lightMap(track);
    const xi = Math.max(0, Math.min(WORLD_W - 1, x | 0)), yi = Math.max(0, Math.min(WORLD_H - 1, y | 0));
    const i = (yi * WORLD_W + xi) * 3;
    return [L[i], L[i + 1], L[i + 2]];
  }

  // Multiply layer for the 2D and isometric views.
  function overlay(track, mode) {
    track.overlays = track.overlays || {};
    if (track.overlays[mode]) return track.overlays[mode];
    const W = WORLD_W, H = WORLD_H, m = of(track), L = lightMap(track);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const D = new Uint32Array(img.data.buffer);
    const pack = (r, gg, b) => (255 << 24) | ((Math.min(255, b * 255) & 255) << 16) | ((Math.min(255, gg * 255) & 255) << 8) | (Math.min(255, r * 255) & 255);
    D.fill(pack(m.tint[0], m.tint[1], m.tint[2]));
    if (mode === 'iso') {
      const I = View.ISO, VH = track.getViewHeights();
      for (let d = 0; d < W + H - 1; d++) {
        const xa = Math.max(0, d - (H - 1)), xb = Math.min(W - 1, d);
        for (let x = xa; x <= xb; x++) {
          const y = d - x, p = y * W + x;
          const sx = Math.round(I.ox + (x - y) * I.a);
          if (sx < 0 || sx >= W) continue;
          const base = I.oy + (x + y) * I.b;
          const top = Math.round(base - VH[p] * I.c), bottom = Math.round(base + I.slab);
          const col = pack(L[p * 3], L[p * 3 + 1], L[p * 3 + 2]);
          for (let yy = Math.max(0, top); yy <= Math.min(H - 1, bottom); yy++) D[yy * W + sx] = col;
        }
      }
    } else {
      for (let p = 0; p < W * H; p++) D[p] = pack(L[p * 3], L[p * 3 + 1], L[p * 3 + 2]);
    }
    g.putImageData(img, 0, 0);
    track.overlays[mode] = c;
    return c;
  }

  // Night headlights: additive cones in front of each truck.
  function headlights(ctx, race) {
    if (race.track.mood !== 'night') return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const t of race.trucks) {
      const c = Math.cos(t.h), s = Math.sin(t.h);
      const gh = race.track.heightAt(t.x, t.y);
      const P = (f, l) => View.point(t.x + c * f - s * l, t.y + s * f + c * l, gh, 0);
      const o = P(8, 0), a = P(46, -15), b = P(46, 15);
      const grad = ctx.createRadialGradient(o[0], o[1], 2, o[0], o[1], Math.hypot(a[0] - o[0], a[1] - o[1]));
      grad.addColorStop(0, 'rgba(255,240,190,0.38)');
      grad.addColorStop(1, 'rgba(255,240,190,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  return { of, lightMap, lightAt, overlay, headlights, reduceMotion };
})();
