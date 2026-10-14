'use strict';
// Particle effects for a race: dust clouds, mud clods that stain the track,
// water spray and rings, nitro flames and smoke, sparks, landing dust, shake.
// Particles live in world space (x, y, height z) so every view can draw them.

const FX = (() => {
  const MAX = 700;
  const rgbCache = new Map();
  function rgb(hex) {
    let v = rgbCache.get(hex);
    if (!v) { v = [parseInt(hex.substr(1, 2), 16), parseInt(hex.substr(3, 2), 16), parseInt(hex.substr(5, 2), 16)]; rgbCache.set(hex, v); }
    return v;
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  function add(race, p) {
    if (race.particles.length >= MAX) race.particles.shift();
    p.age = 0;
    p.rgb = rgb(p.col);
    race.particles.push(p);
  }

  // expanding soft cloud
  function puff(race, x, y, z, col, r0, r1, life, vx = 0, vy = 0, vz = 6, a0 = 0.7) {
    add(race, { k: 'puff', x, y, z, vx, vy, vz, col, r0, r1, life, a0, g: -4 });
  }
  // solid bit with gravity; mud ones leave a stain where they land
  function chunk(race, x, y, z, col, vx, vy, vz, life, stain) {
    add(race, { k: 'chunk', x, y, z, vx, vy, vz, col, life, g: 220, stain });
  }
  function spark(race, x, y, z, vx, vy, vz) {
    add(race, { k: 'spark', x, y, z, vx, vy, vz, col: Math.random() < 0.5 ? '#fff6c0' : '#ffb030', life: rnd(0.15, 0.35), g: 160 });
  }
  function flame(race, x, y, z, vx, vy) {
    add(race, { k: 'flame', x, y, z, vx, vy, vz: rnd(-4, 8), col: '#ffd040', life: rnd(0.1, 0.22), g: 0 });
  }
  function ring(race, x, y) {
    add(race, { k: 'ring', x, y, z: 0.2, vx: 0, vy: 0, vz: 0, col: '#d8ecff', life: 0.8, r0: 2, r1: 11, g: 0 });
  }

  function shake(race, t, amount) {
    if (Mood.reduceMotion || !t.human) return;
    race.shake = Math.max(race.shake || 0, Math.min(5, amount));
  }

  // ---- events from the trucks ----
  function nitroStart(race, t) {
    const c = Math.cos(t.h), s = Math.sin(t.h);
    for (let i = 0; i < 10; i++) flame(race, t.x - c * 9, t.y - s * 9, 4, -c * rnd(40, 90) + rnd(-15, 15), -s * rnd(40, 90) + rnd(-15, 15));
    for (let i = 0; i < 4; i++) puff(race, t.x - c * 10, t.y - s * 10, 4, '#d0d0d8', 2, 7, 0.8, -c * 20, -s * 20, 8, 0.5);
    shake(race, t, 1.5);
  }

  function wallHit(race, t, power) {
    const n = Math.min(14, 4 + power / 10);
    for (let i = 0; i < n; i++) spark(race, t.x, t.y, 4, rnd(-50, 50), rnd(-50, 50), rnd(20, 60));
    for (let i = 0; i < 4; i++) chunk(race, t.x, t.y, 3, '#a88458', rnd(-30, 30), rnd(-30, 30), rnd(30, 60), 0.6, false);
    puff(race, t.x, t.y, 2, '#d8c09a', 2, 8, 0.6);
    shake(race, t, power / 22);
  }

  function landing(race, t, impact) {
    const surf = race.track.surfAt(t.x, t.y);
    const col = surf === SURF.MUD ? '#6a4628' : surf === SURF.WATER ? '#cfe6ff' : '#dcc49a';
    const n = Math.min(14, 6 + impact / 15);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      puff(race, t.x + Math.cos(a) * 5, t.y + Math.sin(a) * 5, 1, col, 2, 7, rnd(0.5, 0.9), Math.cos(a) * 26, Math.sin(a) * 26, 4, 0.75);
    }
    if (surf === SURF.WATER) { ring(race, t.x, t.y); ring(race, t.x, t.y); }
    for (let i = 0; i < 6; i++) chunk(race, t.x, t.y, 1, surf === SURF.MUD ? '#4a2e18' : '#9a7448', rnd(-40, 40), rnd(-40, 40), rnd(40, 80), 0.7, surf === SURF.MUD);
    shake(race, t, impact / 35);
  }

  // ---- continuous emission ----
  function emit(race, dt) {
    const tr = race.track;
    for (const t of race.trucks) {
      const c = Math.cos(t.h), s = Math.sin(t.h);
      // nitro flame and smoke trail
      if (t.nitroT > 0) {
        for (let i = 0; i < 2; i++) flame(race, t.x - c * 9 + rnd(-1, 1), t.y - s * 9 + rnd(-1, 1), 4 + Math.max(0, t.z - tr.heightAt(t.x, t.y)) * 1.5, -c * rnd(50, 90) + t.vx * 0.5, -s * rnd(50, 90) + t.vy * 0.5);
        if (Math.random() < dt * 14) puff(race, t.x - c * 13, t.y - s * 13, 5, '#b8b8c4', 2, 8, 0.9, -c * 10, -s * 10, 10, 0.45);
      }
      if (t.air) continue;
      const sp = t.speed;
      const surf = tr.surfAt(t.x, t.y);
      // exhaust puffs when flooring it from low speed
      if (t.lastGas && sp < 40 && Math.random() < dt * 6) puff(race, t.x - c * 9, t.y - s * 9, 4, '#7a7a84', 1, 4, 0.6, -c * 8, -s * 8, 10, 0.45);
      if (sp < 18) continue;
      const rate = (sp / 100) * (surf === SURF.DIRT ? 10 + t.slip * 0.6 : 26) * dt;
      let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
      while (n-- > 0) {
        const side = (Math.random() < 0.5 ? -1 : 1) * 4.5;
        const x = t.x - c * 7 - s * side, y = t.y - s * 7 + c * side;
        const bvx = -c * sp * 0.25 + rnd(-12, 12), bvy = -s * sp * 0.25 + rnd(-12, 12);
        if (surf === SURF.WATER) {
          chunk(race, x, y, 1, Math.random() < 0.5 ? '#eef6ff' : '#9cc8f4', bvx * 1.4 - s * side * 4, bvy * 1.4 + c * side * 4, rnd(40, 70), 0.5, false);
        } else if (surf === SURF.MUD) {
          chunk(race, x, y, 1, Math.random() < 0.5 ? '#4a2e18' : '#6e4a2a', bvx * 1.3, bvy * 1.3, rnd(35, 70), 0.6, true);
          if (Math.random() < 0.3) puff(race, x, y, 1, '#7a5a3a', 1.5, 4, 0.5, bvx * 0.4, bvy * 0.4, 4, 0.5);
        } else {
          puff(race, x, y, 1, Math.random() < 0.5 ? '#dcc49a' : '#c8aa7c', 1.5, rnd(4, 7), rnd(0.6, 1.0), bvx * 0.6, bvy * 0.6, rnd(3, 8), 0.55 + Math.min(0.25, t.slip * 0.01));
        }
      }
      if (surf === SURF.WATER) {
        t.ringT = (t.ringT || 0) - dt;
        if (t.ringT <= 0) { ring(race, t.x - c * 4, t.y - s * 4); t.ringT = 0.12; }
        if (t.lastSurf !== SURF.WATER && t.human) Sound.sfx.splash();
      }
      t.lastSurf = surf;
    }
  }

  function update(race, dt) {
    const tr = race.track;
    for (const p of race.particles) {
      p.age += dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vz -= p.g * dt;
      const drag = p.k === 'puff' ? 2.2 : p.k === 'flame' ? 6 : 1.2;
      p.vx *= Math.exp(-drag * dt); p.vy *= Math.exp(-drag * dt);
      if (p.z < 0) {
        p.z = 0;
        if (p.k === 'chunk') {
          if (p.stain && !p.stained) {
            p.stained = true;
            race.stain(p.x, p.y, p.col);
          }
          p.vx *= 0.3; p.vy *= 0.3; p.vz = 0;
        } else if (p.k === 'spark') { p.vz = -p.vz * 0.3; }
        else p.vz = 0;
      }
    }
    race.particles = race.particles.filter(p => p.age < p.life);
    if (race.shake) race.shake = race.shake < 0.15 ? 0 : race.shake * Math.exp(-9 * dt);
  }

  // ---- drawing (2D and isometric) ----
  function draw(ctx, race, low) {
    const tr = race.track;
    for (const p of race.particles) {
      const isLow = p.z < 3 && p.k !== 'flame';
      if (isLow !== low) continue;
      const f = p.age / p.life;
      const [sx, sy] = View.point(p.x, p.y, View.iso ? tr.heightAt(p.x, p.y) : 0, p.z);
      if (p.k === 'puff') {
        const r = p.r0 + (p.r1 - p.r0) * Math.sqrt(f);
        ctx.globalAlpha = p.a0 * (1 - f);
        ctx.fillStyle = p.col;
        ctx.beginPath(); ctx.arc(sx, sy, r * (View.iso ? 0.8 : 1), 0, Math.PI * 2); ctx.fill();
      } else if (p.k === 'ring') {
        const r = p.r0 + (p.r1 - p.r0) * f;
        ctx.globalAlpha = 0.7 * (1 - f);
        ctx.strokeStyle = p.col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(sx, sy, r * (View.iso ? 0.85 : 1), r * (View.iso ? 0.5 : 0.8), 0, 0, Math.PI * 2); ctx.stroke();
      } else if (p.k === 'flame' || p.k === 'spark') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - f * 0.6;
        ctx.fillStyle = p.k === 'spark' ? p.col : f < 0.25 ? '#fff6d0' : f < 0.5 ? '#ffd040' : f < 0.75 ? '#ff8a20' : '#c83010';
        const sz = p.k === 'flame' ? (f < 0.5 ? 3 : 2) : 1;
        ctx.fillRect(Math.round(sx - sz / 2), Math.round(sy - sz / 2), sz, sz);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.globalAlpha = 1;
        ctx.fillStyle = p.col;
        ctx.fillRect(Math.round(sx), Math.round(sy), 2, 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  return { emit, update, draw, nitroStart, wallHit, landing, rgb };
})();
