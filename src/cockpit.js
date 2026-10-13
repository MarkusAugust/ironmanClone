'use strict';
// First-person view from the driver's seat: a voxel heightfield renderer over the
// track's own texture and heights, depth-tested truck billboards, and a cockpit
// with a turning steering wheel, gauges and a nitro button that lights up.

const Cockpit = (() => {
  const HS = 1.6;        // height exaggeration so berms and jumps read as walls and ramps
  const EYE = 7.5;       // driver eye height above the truck's ground point
  const FAR = 470;
  const FOV = 76 * Math.PI / 180;
  const WALL_H = 34;     // stadium wall around the world edge
  const TAN = Math.tan(FOV / 2);

  const pack = (r, g, b) => (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
  const FOG = [26, 20, 38];
  const CROWD = [[220, 70, 60], [240, 220, 190], [70, 110, 200], [250, 200, 60], [60, 150, 80], [200, 200, 210], [150, 90, 60]];

  // ---- per-size view buffers ----
  const views = new Map();
  function viewBuf(w, h) {
    const key = w + 'x' + h;
    let v = views.get(key);
    if (!v) {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const g = canvas.getContext('2d');
      const img = g.createImageData(w, h);
      v = { canvas, g, img, buf: new Uint32Array(img.data.buffer), depth: new Float32Array(w * h), sky: skyRows(h) };
      views.set(key, v);
    }
    return v;
  }
  function skyRows(h) {
    return Array.from({ length: h * 2 }, (_, i) => {
      const t = Math.min(1, i / (h * 1.2));
      return pack(10 + t * 30, 9 + t * 18, 22 + t * 34);
    });
  }

  // ---- terrain data: colors refresh from the race background so tire marks show ----
  function terrain(race) {
    const tr = race.track;
    if (!tr.fpHeights) {
      const VH = tr.getViewHeights();
      tr.fpHeights = Float32Array.from(VH, v => v * HS);
    }
    if (!race.fpColors || race.time - race.fpColorsT > 1) {
      const d = race.bgCtx.getImageData(0, 0, WORLD_W, WORLD_H).data;
      race.fpColors = new Uint32Array(d.buffer);
      race.fpColorsT = race.time;
    }
    return { h: tr.fpHeights, c: race.fpColors };
  }

  function fogMix(c, f) {
    const r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
    return pack(r + (FOG[0] - r) * f, g + (FOG[1] - g) * f, b + (FOG[2] - b) * f);
  }

  function wallColor(along, hw, f) {
    let r, g, b;
    if (hw < 5) { r = 70; g = 66; b = 74; }                              // concrete base
    else if (hw < 9) {                                                   // sponsor boards
      const seg = Math.floor(along / 24) % 3;
      [r, g, b] = seg === 0 ? [200, 40, 30] : seg === 1 ? [240, 200, 40] : [30, 70, 170];
      if (hw > 6.5 && hw < 7.5 && Math.floor(along / 3) % 2) { r = 250; g = 250; b = 240; }
    } else if (hw < WALL_H - 3) {                                        // crowd tiers
      const tier = Math.floor(hw / 3);
      if (Math.floor(hw) % 3 === 0) { r = 40; g = 38; b = 46; }
      else {
        const col = CROWD[Math.floor(hash2(Math.floor(along / 1.5), tier, 77) * CROWD.length)];
        const k = 0.55 + 0.45 * (hw / WALL_H);
        r = col[0] * k; g = col[1] * k; b = col[2] * k;
      }
    } else { r = 200; g = 200; b = 210; }                                // rail
    return pack(r + (FOG[0] - r) * f, g + (FOG[1] - g) * f, b + (FOG[2] - b) * f);
  }

  // ---- camera ----
  function camera(t, w, h) {
    const c = Math.cos(t.h), s = Math.sin(t.h);
    const focal = (w / 2) / TAN;
    const gh = t.z;
    return {
      x: t.x + c * 2, y: t.y + s * 2, eye: gh * HS + EYE,
      fx: c, fy: s, rx: -s, ry: c, focal, cx: w / 2,
      horizon: Math.round(h * 0.4 + (t.camPitch || 0) * h / 280),
      w, h, heading: t.h,
    };
  }

  // ---- voxel terrain ----
  function drawTerrain(v, cam, td) {
    const { buf, depth } = v;
    const W = cam.w, H = cam.h;
    for (let y = 0; y < H; y++) {
      const idx = Math.max(0, Math.min(v.sky.length - 1, y - cam.horizon + H));
      buf.fill(v.sky[Math.min(v.sky.length - 1, Math.max(0, idx - H + H))], y * W, (y + 1) * W);
    }
    depth.fill(Infinity);
    drawStars(v, cam);
    const WW = WORLD_W, WH = WORLD_H;
    for (let i = 0; i < W; i++) {
      const t = (i + 0.5 - cam.cx) / cam.focal;
      const dx = cam.fx + cam.rx * t, dy = cam.fy + cam.ry * t;
      let ybuf = H, z = 1.2, dz = 0.35;
      while (z < FAR && ybuf > 0) {
        const px = cam.x + dx * z, py = cam.y + dy * z;
        const out = px < 0 || py < 0 || px >= WW || py >= WH;
        const hh = out ? WALL_H : td.h[(py | 0) * WW + (px | 0)];
        const sy = cam.horizon + (cam.eye - hh) * cam.focal / z;
        let top = Math.ceil(sy);
        if (top < 0) top = 0;
        if (top < ybuf) {
          const f = Math.min(0.75, Math.pow(z / FAR, 1.4) * 0.9);
          if (out) {
            const along = px + py;
            for (let y = top; y < ybuf; y++) {
              const hw = cam.eye - (y - cam.horizon) * z / cam.focal;
              const di = y * W + i;
              buf[di] = wallColor(along, hw, f); depth[di] = z;
            }
          } else {
            const col = fogMix(td.c[(py | 0) * WW + (px | 0)], f);
            for (let y = top; y < ybuf; y++) { const di = y * W + i; buf[di] = col; depth[di] = z; }
          }
          ybuf = top;
        }
        if (out) break;
        z += dz; dz *= 1.012;
      }
    }
  }

  const STARS = Array.from({ length: 70 }, (_, k) => [hash2(k, 1, 5) * Math.PI * 2, hash2(k, 2, 5), hash2(k, 3, 5)]);
  function drawStars(v, cam) {
    for (const [ang, el, br] of STARS) {
      let a = ang - cam.heading;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(a) > 0.75) continue;
      const x = Math.round(cam.cx + Math.tan(a) * cam.focal);
      const y = Math.round(cam.horizon - 20 - el * cam.h * 0.6);
      if (x < 0 || x >= cam.w || y < 0 || y >= cam.h) continue;
      const k = 120 + br * 135;
      v.buf[y * cam.w + x] = pack(k, k, k * 0.9 + 20);
    }
  }

  // ---- billboards with depth test ----
  function project(cam, wx, wy, wz) {
    const dx = wx - cam.x, dy = wy - cam.y;
    const fwd = dx * cam.fx + dy * cam.fy;
    if (fwd < 2.5) return null;
    const lat = dx * cam.rx + dy * cam.ry;
    return { fwd, sx: cam.cx + lat / fwd * cam.focal, sy: cam.horizon + (cam.eye - wz) * cam.focal / fwd };
  }

  function blit(v, cam, spr, px, pw, ph, ox, oy, ppu, p) {
    const scale = cam.focal / p.fwd / ppu; // screen px per sprite px
    const x0 = p.sx - ox * scale, y0 = p.sy - oy * scale;
    const xa = Math.max(0, Math.floor(x0)), xb = Math.min(cam.w, Math.ceil(x0 + pw * scale));
    const ya = Math.max(0, Math.floor(y0)), yb = Math.min(cam.h, Math.ceil(y0 + ph * scale));
    const inv = 1 / scale;
    for (let y = ya; y < yb; y++) {
      const v0 = Math.floor((y + 0.5 - y0) * inv);
      if (v0 < 0 || v0 >= ph) continue;
      for (let x = xa; x < xb; x++) {
        const u = Math.floor((x + 0.5 - x0) * inv);
        if (u < 0 || u >= pw) continue;
        const c = px[v0 * pw + u];
        if ((c >>> 24) < 128) continue;
        const di = y * cam.w + x;
        if (v.depth[di] <= p.fwd) continue;
        v.buf[di] = fogMix(c, Math.min(0.6, Math.pow(p.fwd / FAR, 1.4) * 0.9));
        v.depth[di] = p.fwd;
      }
    }
  }

  function rect(v, cam, p, wW, wH, color) {
    const s = cam.focal / p.fwd;
    const w = Math.max(1, wW * s), h = Math.max(1, wH * s);
    const xa = Math.max(0, Math.round(p.sx - w / 2)), xb = Math.min(cam.w, Math.round(p.sx + w / 2) || xa + 1);
    const ya = Math.max(0, Math.round(p.sy - h)), yb = Math.min(cam.h, Math.round(p.sy));
    for (let y = ya; y < Math.max(yb, ya + 1) && y < cam.h; y++) for (let x = xa; x < Math.max(xb, xa + 1) && x < cam.w; x++) {
      const di = y * cam.w + x;
      if (v.depth[di] <= p.fwd) continue;
      v.buf[di] = color; v.depth[di] = p.fwd;
    }
  }

  const pickupPx = new Map();
  function pixelsOf(canvas) {
    let px = pickupPx.get(canvas);
    if (!px) {
      px = new Uint32Array(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.buffer);
      pickupPx.set(canvas, px);
    }
    return px;
  }

  const LIGHTS = [[-14, -14], [WORLD_W + 14, -14], [-14, WORLD_H + 14], [WORLD_W + 14, WORLD_H + 14], [WORLD_W / 2, -16], [WORLD_W / 2, WORLD_H + 16]];
  const POLE = pack(30, 28, 34), LAMP = pack(255, 248, 210), LAMP2 = pack(255, 214, 120);

  function drawObjects(v, cam, race, self) {
    const tr = race.track;
    // floodlight towers
    for (const [lx, ly] of LIGHTS) {
      const pb = project(cam, lx, ly, 0);
      if (!pb) continue;
      rect(v, cam, pb, 2.5, 95, POLE);
      const ph = project(cam, lx, ly, 104);
      if (ph) { rect(v, cam, ph, 16, 9, LAMP2); rect(v, cam, Object.assign({}, ph, { sy: ph.sy - 2 * cam.focal / ph.fwd }), 13, 5, LAMP); }
    }
    // pickups
    for (const pk of race.pickups) {
      if (pk.life < 2 && Math.floor(pk.life * 8) % 2 === 0) continue;
      const spr = PICKUP_SPRITES[pk.type];
      const gh = tr.heightAt(pk.x, pk.y) * HS;
      const p = project(cam, pk.x, pk.y, gh + Math.sin(race.time * 6 + pk.x) * 0.6);
      if (p) blit(v, cam, spr, pixelsOf(spr), spr.width, spr.height, spr.width / 2, spr.height, 1.3, p);
    }
    // trucks
    for (const t of race.trucks) {
      if (t === self) continue;
      const gh = tr.heightAt(t.x, t.y);
      const lift = Math.max(0, t.z - gh) * 1.5;
      const p = project(cam, t.x, t.y, (gh + lift) * HS);
      if (!p || p.fwd > FAR) continue;
      const bearing = Math.atan2(t.y - cam.y, t.x - cam.x);
      let rel = (t.h - bearing) / (Math.PI * 2) * SPRITE_STEPS;
      let fi = Math.round(rel) % SPRITE_STEPS;
      if (fi < 0) fi += SPRITE_STEPS;
      const spr = TruckSprites.get(t.slot, 'fp')[fi];
      // shadow on the ground
      const ps = project(cam, t.x, t.y, gh * HS);
      if (ps && lift > 1) rect(v, cam, ps, 12, 1.5, pack(20, 14, 10));
      blit(v, cam, spr, spr.px, spr.width, spr.height, spr.ox, spr.oy, FP_PPU, p);
      if (t.nitroT > 0) {
        const pf = project(cam, t.x - Math.cos(t.h) * 10, t.y - Math.sin(t.h) * 10, (gh + lift) * HS + 4);
        if (pf) rect(v, cam, pf, 3 + Math.random() * 2, 3, Math.random() < 0.5 ? pack(255, 210, 60) : pack(255, 120, 30));
      }
    }
    // particles
    for (const pt of race.particles) {
      const gh = tr.heightAt(pt.x, pt.y);
      const p = project(cam, pt.x, pt.y, (gh + pt.z) * HS);
      if (!p || p.fwd > 160 || p.fwd < 10) continue;
      const c = pt.col;
      rect(v, cam, p, pt.dust ? 2.4 : 1.2, pt.dust ? 2.4 : 1.2, pack(parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16), parseInt(c.substr(5, 2), 16)));
    }
  }

  // ---- cockpit art ----
  let wheelImg = null;
  function wheel() {
    if (wheelImg) return wheelImg;
    const S = 128, c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    const cx = S / 2;
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
    const col = t.def.color;
    const k = H / 280; // layout unit relative to the full-height view
    ctx.save();
    ctx.translate(X, Y);
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    const dashY = Math.round(H * 0.7);
    // hood seen through the windshield
    poly(ctx, [[W * 0.1, dashY + 2], [W * 0.27, H * 0.61], [W * 0.73, H * 0.61], [W * 0.9, dashY + 2]], shade(col, 0.95));
    poly(ctx, [[W * 0.27, H * 0.61], [W * 0.73, H * 0.61], [W * 0.75, H * 0.625], [W * 0.25, H * 0.625]], shade(col, 1.25));
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(Math.round(W * 0.5 - 2 * k), Math.round(H * 0.62), Math.max(2, Math.round(4 * k)), dashY - Math.round(H * 0.62));
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

  // ---- public ----
  function renderView(ctx, race, t, X, Y, W, H, label) {
    const v = viewBuf(W, H);
    const cam = camera(t, W, H);
    drawTerrain(v, cam, terrain(race));
    drawObjects(v, cam, race, t);
    v.g.putImageData(v.img, 0, 0);
    ctx.drawImage(v.canvas, X, Y);
    drawCockpit(ctx, race, t, X, Y, W, H, label);
  }

  // Which trucks get a camera: the human players, or the leader in attract mode.
  function render(ctx, race, top) {
    const humans = race.trucks.filter(t => t.human).sort((a, b) => a.player - b.player);
    const focus = humans.length ? humans : [race.standings()[0]];
    const avail = WORLD_H - top;
    if (focus.length === 1) {
      renderView(ctx, race, focus[0], 0, top, WORLD_W, avail, race.numHumans === 2 ? `P${focus[0].player + 1}` : '');
    } else {
      const h = Math.floor((avail - 2) / 2);
      renderView(ctx, race, focus[0], 0, top, WORLD_W, h, 'P1');
      ctx.fillStyle = '#ffd84a'; ctx.fillRect(0, top + h, WORLD_W, 2);
      renderView(ctx, race, focus[1], 0, top + h + 2, WORLD_W, avail - h - 2, 'P2');
    }
  }

  return { render, terrain };
})();
