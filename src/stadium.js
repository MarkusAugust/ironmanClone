'use strict';
// Stadium life: the flagman, the start/finish gantry, a jumping crowd,
// pennants on the rail and confetti for a win.

const Stadium = (() => {
  // ---- flagman sprites ----
  const FLAGS = {
    red: ['#e02020', '#e02020'], green: ['#20b030', '#20b030'], white: ['#f4f4f4', '#f4f4f4'],
    checkered: ['#f4f4f4', '#141414'],
  };
  const cache = {};
  function flagman(flag, pose) {
    const key = flag + pose;
    if (cache[key]) return cache[key];
    const W = 22, H = 22;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const px = (x, y, col, w = 1, h = 1) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    const ox = 8;
    // legs and shoes
    px(ox + 1, 14, '#22305a', 2, 5); px(ox + 4, 14, '#22305a', 2, 5);
    px(ox + 1, 19, '#111', 2, 1); px(ox + 4, 19, '#111', 2, 1);
    // referee shirt
    px(ox, 8, '#f2f2f2', 7, 6);
    for (let x = 0; x < 7; x += 2) px(ox + x, 8, '#1a1a1a', 1, 6);
    // head and cap
    px(ox + 2, 4, '#e6b48a', 3, 4);
    px(ox + 1, 3, '#1a1a1a', 5, 2);
    px(ox + 5, 4, '#1a1a1a', 1, 1);
    // left arm at the side
    px(ox - 1, 9, '#e6b48a', 1, 4);
    const [f0, f1] = FLAGS[flag];
    const flagRect = (x, y) => {
      for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 5; xx++) px(x + xx, y + yy, ((xx + yy) % 2) ? f1 : f0);
    };
    if (pose === 'down') {
      px(ox + 7, 9, '#e6b48a', 1, 4);
      px(ox + 8, 10, '#555', 1, 8);
      flagRect(ox + 9, 13);
    } else if (pose === 'up') {
      px(ox + 7, 5, '#e6b48a', 1, 4);
      px(ox + 7, 0, '#555', 1, 5);
      flagRect(ox + 8, 0);
    } else if (pose === 'waveL') {
      px(ox + 6, 6, '#e6b48a', 1, 3); px(ox + 5, 5, '#e6b48a', 1, 1);
      px(ox + 4, 0, '#555', 1, 5);
      flagRect(ox - 1, 0);
    } else {
      px(ox + 7, 6, '#e6b48a', 1, 3); px(ox + 8, 5, '#e6b48a', 1, 1);
      px(ox + 9, 0, '#555', 1, 5);
      flagRect(ox + 10, 0);
    }
    c.ox = ox + 3; c.oy = 20;
    c.px = new Uint32Array(g.getImageData(0, 0, W, H).data.buffer);
    cache[key] = c;
    return c;
  }

  function flagState(race) {
    if (race.phase === 'intro') return ['red', 'down'];
    if (race.phase === 'countdown') return ['red', 'up'];
    const wave = Math.floor(race.time * 5) % 2 ? 'waveL' : 'waveR';
    if (race.leaderDoneT >= 0) return ['checkered', wave];
    if (race.raceTime < 2.5) return ['green', wave];
    const leader = race.standings()[0];
    if (leader && leader.crossings === LAPS) return ['white', wave];
    return ['green', 'down'];
  }

  function flagmanSprite(race) {
    const [flag, pose] = flagState(race);
    return flagman(flag, pose);
  }

  // ---- gantry banner ----
  const banners = {};
  function banner(text) {
    if (banners[text]) return banners[text];
    const W = 46, H = 11;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#141414'; g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 2) {
      g.fillStyle = (x / 2) % 2 ? '#f4f4f4' : '#141414'; g.fillRect(x, 0, 2, 2);
      g.fillStyle = (x / 2) % 2 ? '#141414' : '#f4f4f4'; g.fillRect(x, H - 2, 2, 2);
    }
    Font.draw(g, text, W / 2, 2, '#ffd030', { align: 'center' });
    c.px = new Uint32Array(g.getImageData(0, 0, W, H).data.buffer);
    banners[text] = c;
    return c;
  }
  function bannerFor(race) { return banner(race.phase === 'intro' || race.phase === 'countdown' ? 'START' : 'FINISH'); }

  const GANTRY_H = 20;

  // ---- 2D / isometric drawing ----
  function drawFlagman(ctx, race) {
    const fm = race.track.flagman;
    if (!fm) return;
    const spr = flagmanSprite(race);
    const gh = race.track.heightAt(fm.x, fm.y);
    const [sx, sy] = View.point(fm.x, fm.y, gh, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(Math.round(sx - 4), Math.round(sy - 1), 9, 2);
    // small platform
    ctx.fillStyle = '#5a4630'; ctx.fillRect(Math.round(sx - 5), Math.round(sy - 2), 11, 2);
    ctx.drawImage(spr, Math.round(sx - spr.ox), Math.round(sy - spr.oy - 2));
  }

  function drawGantry(ctx, race) {
    const tr = race.track;
    const ends = tr.gantry.map(([x, y]) => {
      const gh = tr.heightAt(x, y);
      return { base: View.point(x, y, gh, 0), top: View.point(x, y, gh, GANTRY_H) };
    });
    for (const e of ends) {
      ctx.fillStyle = '#2a2a30';
      ctx.fillRect(Math.round(e.top[0]) - 1, Math.round(e.top[1]), 2, Math.round(e.base[1] - e.top[1]));
      ctx.fillStyle = '#6a6a74';
      ctx.fillRect(Math.round(e.top[0]) - 1, Math.round(e.top[1]), 1, Math.round(e.base[1] - e.top[1]));
    }
    const a = ends[0].top, b = ends[1].top;
    const ban = bannerFor(race);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 4) return;
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    let start = a;
    if (Math.abs(ang) > Math.PI / 2) { ang += Math.PI; start = b; } // keep the text upright
    ctx.save();
    ctx.translate(Math.round(start[0]), Math.round(start[1]));
    ctx.rotate(ang);
    // seen from straight above the banner is just its checkered top edge
    if (View.mode === 'top') ctx.drawImage(ban, 0, 0, ban.width, 3, 0, -3, len, 3);
    else ctx.drawImage(ban, 0, -ban.height, len, ban.height);
    ctx.restore();
  }

  // ---- crowd and pennants ----
  function crowdPixels(track, mode) {
    track.crowd = track.crowd || {};
    if (track.crowd[mode]) return track.crowd[mode];
    const list = [];
    const d = track.bg.getContext('2d').getImageData(0, 0, WORLD_W, 30).data;
    const I = View.ISO, VH = track.getViewHeights();
    for (let y = 20; y < STANDS_Y - 1; y++) {
      if ((y - 20) % 3 === 2) continue;
      for (let x = 0; x < WORLD_W; x += 2) {
        const p = y * WORLD_W + x;
        const col = `rgb(${d[p * 4]},${d[p * 4 + 1]},${d[p * 4 + 2]})`;
        if (mode === 'iso') {
          const sx = Math.round(I.ox + (x - y) * I.a), sy = Math.round(I.oy + (x + y) * I.b - VH[p] * I.c);
          if (sx >= 0 && sx < WORLD_W && sy > 20) list.push([sx, sy, col]);
        } else list.push([x, y, col]);
      }
    }
    track.crowd[mode] = list;
    return list;
  }

  function drawCrowd(ctx, race) {
    const list = crowdPixels(race.track, View.mode);
    if (!list.length) return;
    // excitement: trucks near the stands, the finish, the start
    let hype = 0.25;
    for (const t of race.trucks) if (t.y < 90) hype += 0.25;
    if (race.leaderDoneT >= 0 || (race.phase === 'run' && race.raceTime < 3)) hype += 1;
    const n = Math.floor(list.length * 0.04 * hype);
    const tick = Math.floor(race.time * 8);
    for (let i = 0; i < n; i++) {
      const e = list[Math.floor(hash2(i, tick, 5) * list.length)];
      ctx.fillStyle = e[2];
      ctx.fillRect(e[0], e[1] - 1, 1, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(e[0], e[1], 1, 1);
    }
    if (race.track.mood !== 'day') {
      // camera flashes
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 3; i++) if (Math.random() < 0.25) {
        const e = list[Math.floor(Math.random() * list.length)];
        ctx.fillRect(e[0], e[1] - 1, 1, 1);
      }
    }
  }

  function drawPennants(ctx, race) {
    const cols = ['#e02020', '#ffd030', '#2060e0', '#f4f4f4', '#20a040'];
    const y = STANDS_Y + 0.5;
    for (let x = 6, k = 0; x < WORLD_W; x += 9, k++) {
      const sway = Math.round(Math.sin(race.time * 4 + x * 0.3));
      const [sx, sy] = View.point(x, y, 0, 4);
      if (View.iso && (sx < 0 || sx >= WORLD_W)) continue;
      ctx.fillStyle = cols[k % cols.length];
      ctx.fillRect(Math.round(sx) - 1, Math.round(sy), 3, 1);
      ctx.fillRect(Math.round(sx) + sway, Math.round(sy) + 1, 2, 1);
      ctx.fillRect(Math.round(sx) + sway, Math.round(sy) + 2, 1, 1);
    }
  }

  // ---- confetti (screen space) ----
  function confetti(race) {
    const cols = ['#ff4040', '#ffd030', '#40c0ff', '#60e060', '#ff80ff', '#ffffff'];
    race.confetti = race.confetti || [];
    for (let i = 0; i < 160; i++) {
      race.confetti.push({ x: Math.random() * WORLD_W, y: -Math.random() * 120, vx: (Math.random() - 0.5) * 30,
        vy: 20 + Math.random() * 40, col: cols[i % cols.length], ph: Math.random() * 6, life: 4 + Math.random() * 2 });
    }
  }
  function updateConfetti(race, dt) {
    if (!race.confetti) return;
    for (const c of race.confetti) {
      c.x += (c.vx + Math.sin(race.time * 3 + c.ph) * 18) * dt; c.y += c.vy * dt; c.life -= dt;
    }
    race.confetti = race.confetti.filter(c => c.life > 0 && c.y < WORLD_H + 4);
  }
  function drawConfetti(ctx, race) {
    if (!race.confetti) return;
    for (const c of race.confetti) {
      ctx.fillStyle = c.col;
      const w = Math.sin(race.time * 10 + c.ph) > 0 ? 2 : 1;
      ctx.fillRect(Math.round(c.x), Math.round(c.y), w, 2);
    }
  }

  return { drawFlagman, drawGantry, drawCrowd, drawPennants, confetti, updateConfetti, drawConfetti, flagmanSprite, bannerFor, GANTRY_H };
})();
