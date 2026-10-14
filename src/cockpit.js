'use strict';
// Cockpit overlay for the first-person camera: A-pillars, dashboard, a steering
// wheel that turns with the input, a speedometer and a nitro button that lights
// up while the boost burns. The road, hood and other trucks come from the 3D scene.

const Cockpit = (() => {
  // ---- cockpit art ----
  let wheelImg = null;
  function wheel() {
    if (wheelImg) return wheelImg;
    const S = 256, c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    g.scale(2, 2);
    const cx = 64;
    g.lineCap = 'round';
    // spokes
    g.strokeStyle = '#3a3640'; g.lineWidth = 11;
    for (const a of [Math.PI, 0, Math.PI / 2]) {
      g.beginPath(); g.moveTo(cx, cx); g.lineTo(cx + Math.cos(a) * 50, cx + Math.sin(a) * 50); g.stroke();
    }
    g.strokeStyle = '#55505c'; g.lineWidth = 4;
    for (const a of [Math.PI, 0, Math.PI / 2]) {
      g.beginPath(); g.moveTo(cx, cx - 2); g.lineTo(cx + Math.cos(a) * 48, cx + Math.sin(a) * 48 - 2); g.stroke();
    }
    // rim
    g.strokeStyle = '#141216'; g.lineWidth = 15;
    g.beginPath(); g.arc(cx, cx, 54, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#2c2830'; g.lineWidth = 9;
    g.beginPath(); g.arc(cx, cx, 54, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#4a4552'; g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cx, 56, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    // grip wraps
    g.strokeStyle = '#1c1a20'; g.lineWidth = 2;
    for (let k = 0; k < 28; k++) {
      const a = k / 28 * Math.PI * 2;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * 49, cx + Math.sin(a) * 49); g.lineTo(cx + Math.cos(a) * 59, cx + Math.sin(a) * 59); g.stroke();
    }
    // top-center marker
    g.strokeStyle = '#ffc93a'; g.lineWidth = 10; g.lineCap = 'butt';
    g.beginPath(); g.arc(cx, cx, 54, -Math.PI / 2 - 0.12, -Math.PI / 2 + 0.12); g.stroke();
    // hub
    g.fillStyle = '#201d24'; g.beginPath(); g.arc(cx, cx, 17, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c8ccd4'; g.beginPath(); g.arc(cx, cx, 11, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d83020'; g.beginPath(); g.arc(cx, cx, 7, 0, Math.PI * 2); g.fill();
    // hard alpha for a pixel look
    const im = g.getImageData(0, 0, S, S);
    for (let i = 3; i < im.data.length; i += 4) im.data[i] = im.data[i] > 100 ? 255 : 0;
    g.putImageData(im, 0, 0);
    wheelImg = c;
    return c;
  }

  function shade(col, k) {
    return `rgb(${Math.min(255, col[0] * k) | 0},${Math.min(255, col[1] * k) | 0},${Math.min(255, col[2] * k) | 0})`;
  }

  function poly(ctx, pts, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.closePath();
    ctx.fill();
  }

  function drawCockpit(ctx, race, t, X, Y, W, H, label) {
    const k = H / 280; // layout unit relative to the full-height view
    ctx.save();
    ctx.translate(X, Y);
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    const dashY = Math.round(H * 0.72);
    // roof and A-pillars
    ctx.fillStyle = '#15111a'; ctx.fillRect(0, 0, W, Math.round(H * 0.06));
    poly(ctx, [[0, 0], [W * 0.1, 0], [W * 0.035, dashY], [0, dashY]], '#1d1822');
    poly(ctx, [[W, 0], [W * 0.9, 0], [W * 0.965, dashY], [W, dashY]], '#1d1822');
    poly(ctx, [[W * 0.1, 0], [W * 0.112, 0], [W * 0.047, dashY], [W * 0.035, dashY]], '#3a3244');
    poly(ctx, [[W * 0.9, 0], [W * 0.888, 0], [W * 0.953, dashY], [W * 0.965, dashY]], '#3a3244');
    // roll cage bar
    ctx.fillStyle = '#4a4252'; ctx.fillRect(0, Math.round(H * 0.06), W, Math.max(1, Math.round(2 * k)));
    // dashboard
    poly(ctx, [[0, dashY], [W * 0.2, dashY - 6 * k], [W * 0.8, dashY - 6 * k], [W, dashY], [W, H], [0, H]], '#2a2430');
    ctx.fillStyle = '#4a4054';
    ctx.fillRect(0, dashY - Math.round(6 * k), W, Math.max(1, Math.round(1.5 * k)));
    ctx.fillStyle = '#1c1820';
    ctx.fillRect(0, dashY + Math.round(14 * k), W, Math.max(1, Math.round(2 * k)));

    // speedometer
    const sp = Math.max(0, t.forward);
    const gx = W * 0.15, gy = dashY + (H - dashY) * 0.55, gr = Math.max(8, 30 * k);
    ctx.fillStyle = '#100d14'; ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#6a6274'; ctx.lineWidth = Math.max(1, 2 * k); ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * 0.8 + i / 8 * Math.PI * 1.4;
      ctx.strokeStyle = i >= 6 ? '#ff5040' : '#cfc8d8';
      ctx.beginPath(); ctx.moveTo(gx + Math.cos(a) * gr * 0.78, gy + Math.sin(a) * gr * 0.78); ctx.lineTo(gx + Math.cos(a) * gr * 0.92, gy + Math.sin(a) * gr * 0.92); ctx.stroke();
    }
    const frac = Math.min(1, sp / 150);
    const na = Math.PI * 0.8 + frac * Math.PI * 1.4;
    ctx.strokeStyle = '#ff7a30'; ctx.lineWidth = Math.max(1, 2 * k);
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + Math.cos(na) * gr * 0.85, gy + Math.sin(na) * gr * 0.85); ctx.stroke();
    const mph = String(Math.round(sp * 0.9)).padStart(3, '0');
    Font.draw(ctx, mph, gx, gy + gr * 0.35, '#8cf07a', { align: 'center', scale: k > 0.75 ? 1 : 1 });

    // nitro button
    const bx = W * 0.85, by = gy, br = Math.max(6, 17 * k);
    const on = t.nitroT > 0;
    const flick = on && Math.random() < 0.85;
    if (on) {
      const glow = ctx.createRadialGradient(bx, by, br * 0.5, bx, by, br * 2.6);
      glow.addColorStop(0, 'rgba(255,90,40,0.7)'); glow.addColorStop(1, 'rgba(255,90,40,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(bx, by, br * 2.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#0e0b10'; ctx.beginPath(); ctx.arc(bx, by + 2 * k, br + 3 * k, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5a5262'; ctx.beginPath(); ctx.arc(bx, by, br + 2 * k, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = on ? (flick ? '#ffef9a' : '#ff9a40') : t.nitros > 0 ? '#7a1810' : '#2a1414';
    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = on ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.arc(bx - br * 0.35, by - br * 0.35, br * 0.28, 0, Math.PI * 2); ctx.fill();
    Font.draw(ctx, 'NITRO', bx, by - br - 11 * k - 4, on ? '#ffd040' : '#a89cb4', { align: 'center' });
    Font.draw(ctx, 'x' + t.nitros, bx, by + br + 4 * k + 2, '#ff8070', { align: 'center' });

    // steering wheel, turning with the input
    const img = wheel();
    const wr = H * 0.34;
    ctx.save();
    ctx.translate(W / 2, H + wr * 0.12);
    ctx.rotate(t.wheel || 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, -wr, -wr, wr * 2, wr * 2);
    ctx.restore();

    // windshield info
    const order = race.standings();
    const place = PLACE_NAMES[order.indexOf(t)];
    const lap = t.finished ? 'FINISHED' : `LAP ${Math.max(1, Math.min(LAPS, t.crossings))}/${LAPS}`;
    Font.draw(ctx, label ? `${label}  ${place}` : place, W * 0.13, H * 0.06 + 6, t.def.hud, { shadow: '#000' });
    Font.draw(ctx, lap, W * 0.87, H * 0.06 + 6, '#ffffff', { align: 'right', shadow: '#000' });
    if (t.human && t.wrongWayT > 50 && !t.finished && Math.floor(race.time * 4) % 2 === 0) {
      Font.draw(ctx, 'WRONG WAY', W / 2, H * 0.3, '#ff4040', { align: 'center', scale: 2, shadow: '#000' });
    }
    ctx.restore();
  }

  // Draw a cockpit over every first-person view the 3D scene drew this frame.
  function render(ctx, race) {
    const two = Scene3D.views.length > 1;
    for (const v of Scene3D.views) {
      if (v.mode !== 'fp') continue;
      const r = v.rect, t = v.truck;
      const label = two || race.numHumans === 2 ? `P${t.player + 1}` : '';
      drawCockpit(ctx, race, t, r.x, r.y, r.w, r.h, label);
    }
    if (two && Scene3D.views[0].mode !== 'iso' && Scene3D.views[0].mode !== 'top') {
      ctx.fillStyle = '#ffd84a';
      ctx.fillRect(0, Scene3D.views[0].rect.y + Scene3D.views[0].rect.h, WORLD_W, 2);
    }
  }

  return { render };
})();
