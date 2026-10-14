'use strict';
// Stadium life shared by the 3D scene and the overlay: what the flagman
// signals, the start/finish banner art, and confetti for a win.

const Stadium = (() => {
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

  // ---- gantry banner ----
  const banners = {};
  function banner(text) {
    if (banners[text]) return banners[text];
    const K = RES, W = 46 * K, H = 11 * K;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#141414'; g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 2) {
      for (let row = 0; row < 2; row++) {
        g.fillStyle = ((x / 2) + row) % 2 ? '#f4f4f4' : '#141414'; g.fillRect(x, row * 2, 2, 2);
        g.fillStyle = ((x / 2) + row) % 2 ? '#141414' : '#f4f4f4'; g.fillRect(x, H - 4 + row * 2, 2, 2);
      }
    }
    Font.draw(g, text, W / 2, 5, '#ffd030', { align: 'center', scale: 2, shadow: '#5a3a00', shadowOffset: 1 });
    c.res = K;
    c.px = new Uint32Array(g.getImageData(0, 0, W, H).data.buffer);
    banners[text] = c;
    return c;
  }
  function bannerFor(race) { return banner(race.phase === 'intro' || race.phase === 'countdown' ? 'START' : 'FINISH'); }

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

  return { flagState, bannerFor, confetti, updateConfetti, drawConfetti };
})();
