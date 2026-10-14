'use strict';
// One race: four trucks, pickups, particles, lap counting, HUD.

const LAPS = 4;
const PLACE_NAMES = ['1ST', '2ND', '3RD', '4TH'];
const STEP = 1 / 120;

const PICKUP_ART = {
  nitro: [
    '..kkk..',
    '..kwk..',
    '.kRRRk.',
    '.kRwRk.',
    '.kRwRk.',
    '.kRwRk.',
    '.kRRRk.',
    '..kkk..',
  ],
  money: [
    '...kkk...',
    '..kbbbk..',
    '...kbk...',
    '..kbbbbk.',
    '.kbbgbbbk',
    'kbbgggbbk',
    'kbbbgbbbk',
    'kbbgggbbk',
    '.kkkkkkk.',
  ],
};
const PICKUP_PAL = { k: '#140c08', w: '#ffffff', R: '#e02828', b: '#c8a060', g: '#2a8a2a' };

function pixelArt(rows) {
  const c = document.createElement('canvas');
  c.width = rows[0].length; c.height = rows.length;
  const g = c.getContext('2d');
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch !== '.') { g.fillStyle = PICKUP_PAL[ch]; g.fillRect(x, y, 1, 1); }
  }));
  return c;
}
let PICKUP_SPRITES = null;

// Pickups drawn at RES x detail.
function nitroSprite() {
  const K = RES, c = document.createElement('canvas');
  c.width = 7 * K; c.height = 9 * K;
  const g = c.getContext('2d');
  g.scale(K, K);
  g.fillStyle = '#140c08'; g.fillRect(0.5, 1.5, 6, 7.5);
  g.fillStyle = '#d82020'; g.fillRect(1, 2, 5, 6.5);
  g.fillStyle = '#ff6a50'; g.fillRect(1.5, 2, 1, 6.5);
  g.fillStyle = '#8a1010'; g.fillRect(5, 2, 1, 6.5);
  g.fillStyle = '#f4f4f4'; g.fillRect(1, 4, 5, 2);
  g.fillStyle = '#d82020'; g.fillRect(2.5, 4.5, 0.5, 1); g.fillRect(4, 4.5, 0.5, 1); g.fillRect(3, 4.5, 0.5, 0.5); g.fillRect(3.5, 5, 0.5, 0.5);
  g.fillStyle = '#b8bcc4'; g.fillRect(2, 0.5, 3, 1.5);
  g.fillStyle = '#e8ecf0'; g.fillRect(2.5, 0.5, 1, 1);
  c.res = K;
  return c;
}
function moneySprite() {
  const K = RES, c = document.createElement('canvas');
  c.width = 9 * K; c.height = 9 * K;
  const g = c.getContext('2d');
  g.scale(K, K);
  g.fillStyle = '#140c08';
  g.beginPath(); g.ellipse(4.5, 6, 4.3, 3, 0, 0, Math.PI * 2); g.fill(); g.fillRect(3, 1.5, 3, 3);
  g.fillStyle = '#c8a060';
  g.beginPath(); g.ellipse(4.5, 6, 3.8, 2.6, 0, 0, Math.PI * 2); g.fill(); g.fillRect(3.4, 2, 2.2, 2.6);
  g.fillStyle = '#e4c488'; g.beginPath(); g.ellipse(3.4, 5.2, 1.4, 1, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#7a5a2a'; g.fillRect(3, 3.6, 3, 0.6);
  Font.draw(g, '$', 4.6, 4.6, '#2a8a2a', { align: 'center', scale: 0.5 });
  c.res = K;
  return c;
}

function formatMoney(v) {
  return '$' + Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function shortMoney(v) {
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M';
  return '$' + Math.round(v / 1000) + 'K';
}

class Race {
  constructor(track, entrants, opts = {}) {
    if (!PICKUP_SPRITES) PICKUP_SPRITES = { nitro: nitroSprite(), money: moneySprite() };
    this.track = track;
    this.opts = opts;
    this.demo = !!opts.demo;
    this.numHumans = opts.numHumans || 0;
    this.trucks = entrants.map(e => {
      const t = new Truck(e.slot, e);
      t.placeAt(track.gridPosition(e.slot), track);
      t.ai = new AIDriver(e.skill == null ? 0.9 : e.skill, e.boss);
      t.bagMoney = 0;
      return t;
    });
    // working copy of the background so tire marks can accumulate
    this.bg = document.createElement('canvas');
    this.bg.width = WORLD_W * RES; this.bg.height = WORLD_H * RES;
    this.bgCtx = this.bg.getContext('2d');
    this.bgCtx.drawImage(track.bg, 0, 0);

    if (View.iso) this.background(); // build the diorama now, not mid-race
    if (View.fp) Cockpit.terrain(this);

    this.pickups = [];
    this.particles = [];
    this.floaters = [];
    this.messages = [];
    this.phase = this.demo ? 'run' : 'intro';
    this.phaseT = 0;
    this.time = 0;
    this.raceTime = 0;
    this.finishOrder = [];
    this.leaderDoneT = -1;
    this.spawnT = 1.5;
    this.acc = 0;
    this.ended = false;
    this.engines = [];
    this.lastCount = -1;
    if (!this.demo) {
      for (const t of this.trucks) if (t.human) {
        const pan = this.numHumans === 2 ? (t.player === 0 ? -0.4 : 0.4) : 0;
        t.engine = Sound.createEngine(pan);
        t.skid = Sound.createSkid(pan);
        this.engines.push(t.engine, t.skid);
      }
      this.spawnPickup(); this.spawnPickup();
    }
  }

  stopSounds() { this.engines.forEach(e => e.stop()); this.engines = []; }

  update(dt) {
    this.time += dt;
    this.phaseT += dt;
    if (this.phase === 'intro') {
      this.idleEngines();
      if (this.phaseT > 2.6 || Input.pressed('Enter', 'Space')) { this.phase = 'countdown'; this.phaseT = 0; }
      return;
    }
    if (this.phase === 'countdown') {
      this.idleEngines();
      const n = Math.floor(this.phaseT);
      if (n !== this.lastCount) {
        this.lastCount = n;
        if (n < 3) Sound.sfx.count(); else Sound.sfx.go();
      }
      if (this.phaseT >= 3) { this.phase = 'run'; this.phaseT = 0; }
      return;
    }
    // fixed-step simulation
    this.acc += Math.min(dt, 0.05);
    while (this.acc >= STEP) {
      this.step(STEP);
      this.acc -= STEP;
    }
    this.updateEffects(dt);
    this.updateEngines();
    if (this.phase === 'over' && !this.ended && this.phaseT > 2.6) {
      this.ended = true;
      this.stopSounds();
      if (this.opts.onEnd) this.opts.onEnd(this.results());
    }
  }

  idleEngines() {
    for (const t of this.trucks) if (t.engine) {
      const human = t.human ? Input.controls(t.player, this.numHumans) : null;
      t.engine.set(0, human && human.gas ? 0.6 : 0, false);
    }
  }

  updateEngines() {
    for (const t of this.trucks) if (t.engine) {
      const sp = Math.min(1.4, Math.abs(t.forward) / t.topSpeed);
      t.engine.set(sp, t.lastGas ? 1 : 0, t.nitroT > 0);
      if (t.skid) {
        const surf = this.track.surfAt(t.x, t.y);
        const lvl = t.air || surf === SURF.WATER ? 0 : Math.max(t.drift * 0.8, Math.min(1, (t.slip - 12) / 40));
        t.skid.set(lvl, surf === SURF.MUD ? 0.2 : 0.8);
      }
    }
  }

  step(dt) {
    this.raceTime += dt;
    const track = this.track;
    for (const t of this.trucks) {
      let ctl;
      if (t.human && !t.finished && this.phase === 'run') ctl = Input.controls(t.player, this.numHumans);
      else ctl = t.ai.control(dt, t, track, this.time);
      if (this.phase === 'over' && t.finished) { ctl.nitro = false; ctl.gas = t.forward < 40 && ctl.gas; }
      t.lastGas = ctl.gas;
      t.lastSteer = ctl.steer;
      t.update(dt, ctl, track);
      this.handleEvents(t);
      this.tireMarks(t);
    }
    this.collideTrucks();
    this.collectPickups();

    if (this.phase === 'run' || this.phase === 'over') {
      const humans = this.trucks.filter(t => t.human);
      const allHumansDone = humans.length > 0 && humans.every(t => t.finished);
      const allDone = this.trucks.every(t => t.finished);
      if (this.phase === 'run') {
        if (this.demo && this.leaderDoneT >= 0 && this.raceTime - this.leaderDoneT > 3) this.toOver();
        else if (!this.demo && (allDone || allHumansDone || (this.leaderDoneT >= 0 && this.raceTime - this.leaderDoneT > 14))) this.toOver();
      }
    }
  }

  toOver() {
    this.phase = 'over';
    this.phaseT = 0;
    // rank everyone who has not finished by distance covered
    const rest = this.trucks.filter(t => !t.finished).sort((a, b) => b.progress(this.track) - a.progress(this.track));
    for (const t of rest) { t.place = this.finishOrder.length + 1; this.finishOrder.push(t); t.dnf = true; }
  }

  handleEvents(t) {
    for (const e of t.events) {
      if (e === 'nitro') {
        if (t.human) Sound.sfx.nitro();
        FX.nitroStart(this, t);
      } else if (e === 'cross') {
        if (t.crossings > t.maxCross) {
          t.maxCross = t.crossings;
          if (t.crossings >= 2) t.lapTimes.push(this.raceTime);
          if (t.crossings === LAPS + 1 && !t.finished && !t.dnf) this.finishTruck(t);
          else if (t.human && t.crossings >= 2) {
            Sound.sfx.lap();
            if (t.crossings === LAPS) this.message('FINAL LAP', t.def.hud, 1.6);
          }
        }
      } else if (e.t === 'wall') {
        if (t.human || this.isNearHuman(t)) Sound.sfx.crash(e.power / 60);
        FX.wallHit(this, t, e.power);
      } else if (e.t === 'land') {
        if (t.human) Sound.sfx.land();
        FX.landing(this, t, e.power);
      }
    }
    t.events.length = 0;
  }

  isNearHuman(t) {
    return this.trucks.some(o => o.human && Math.hypot(o.x - t.x, o.y - t.y) < 40);
  }

  finishTruck(t) {
    t.finished = true;
    t.finishTime = this.raceTime;
    t.place = this.finishOrder.length + 1;
    this.finishOrder.push(t);
    if (this.leaderDoneT < 0) this.leaderDoneT = this.raceTime;
    if (t.human) {
      if (t.place === 1) Stadium.confetti(this);
      Sound.sfx.finish();
      const who = this.numHumans === 2 ? `P${t.player + 1} ` : '';
      this.message(`${who}FINISHED ${PLACE_NAMES[t.place - 1]}!`, t.def.hud, 2.5);
    }
    this.floaters.push({ x: t.x, y: t.y, off: 16, text: PLACE_NAMES[t.place - 1], col: t.def.hud, life: 1.6 });
  }

  message(text, col, life) {
    this.messages.push({ text, col, life, max: life });
  }

  collideTrucks() {
    const T = this.trucks, R = 5.2;
    for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) {
      const a = T[i], b = T[j];
      if (Math.abs(a.z - b.z) > 7) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= (2 * R) * (2 * R) || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
      const overlap = 2 * R - d;
      const ax = a.x - nx * overlap / 2, ay = a.y - ny * overlap / 2;
      const bx = b.x + nx * overlap / 2, by = b.y + ny * overlap / 2;
      if (this.track.clearance(ax, ay, a.idx) > PHYS.radius * 0.5) { a.x = ax; a.y = ay; }
      if (this.track.clearance(bx, by, b.idx) > PHYS.radius * 0.5) { b.x = bx; b.y = by; }
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) {
        const imp = -(1 + 0.5) * rv / 2;
        a.vx -= imp * nx; a.vy -= imp * ny;
        b.vx += imp * nx; b.vy += imp * ny;
        if (-rv > 30 && (a.human || b.human)) Sound.sfx.bump();
        a.bumpT = Math.max(a.bumpT, 0.12); b.bumpT = Math.max(b.bumpT, 0.12);
      }
    }
  }

  spawnPickup() {
    const tr = this.track;
    for (let k = 0; k < 20; k++) {
      const i = Math.floor(Math.random() * tr.N);
      const lat = (Math.random() * 2 - 1) * (tr.halfW - 8);
      const x = tr.cx[i] - tr.ty[i] * lat, y = tr.cy[i] + tr.tx[i] * lat;
      if (tr.surfAt(x, y) !== SURF.DIRT) continue;
      if (this.trucks.some(t => Math.hypot(t.x - x, t.y - y) < 30)) continue;
      const money = Math.random() < 0.38;
      const value = money ? [10000, 20000, 20000, 30000, 50000][Math.floor(Math.random() * 5)] : 1;
      this.pickups.push({ type: money ? 'money' : 'nitro', x, y, life: 10, value });
      return;
    }
  }

  collectPickups() {
    for (const p of this.pickups) {
      for (const t of this.trucks) {
        if (p.taken) break;
        const gh = this.track.heightAt(t.x, t.y);
        if (t.z - gh > 6) continue;
        if (Math.hypot(t.x - p.x, t.y - p.y) < 9) {
          p.taken = true;
          if (p.type === 'nitro') {
            t.nitros = Math.min(99, t.nitros + 1);
            if (t.human) { Sound.sfx.pickup(); this.floaters.push({ x: p.x, y: p.y, off: 8, text: '+NITRO', col: '#ff6a5a', life: 1.2 }); }
          } else if (t.human) {
            t.bagMoney += p.value;
            Sound.sfx.money();
            this.floaters.push({ x: p.x, y: p.y, off: 8, text: '+' + shortMoney(p.value), col: '#8cf07a', life: 1.2 });
          } else if (this.isNearHuman(t)) {
            this.floaters.push({ x: p.x, y: p.y, off: 8, text: 'GRABBED!', col: t.def.hud, life: 1 });
          }
        }
      }
    }
    this.pickups = this.pickups.filter(p => !p.taken && p.life > 0);
  }

  // mud splat left where a clod lands
  stain(x, y, col) {
    if (this.track.surfAt(x, y) === SURF.WATER) return;
    this.bgCtx.fillStyle = col;
    this.bgCtx.globalAlpha = 0.55;
    this.bgCtx.fillRect(Math.round(x * RES), Math.round(y * RES), 3, 2);
    if (this.isoCtx) {
      const I = View.ISO, gh = this.track.heightAt(x, y);
      this.isoCtx.fillStyle = col; this.isoCtx.globalAlpha = 0.55;
      this.isoCtx.fillRect(Math.round((I.ox + (x - y) * I.a) * RES), Math.round((I.oy + (x + y) * I.b - gh * I.c) * RES), 2, 1);
      this.isoCtx.globalAlpha = 1;
    }
    this.bgCtx.globalAlpha = 1;
  }

  tireMarks(t) {
    if (t.air || t.speed < 8) return;
    const surf = this.track.surfAt(t.x, t.y);
    if (surf === SURF.WATER) return;
    const c = Math.cos(t.h), s = Math.sin(t.h);
    const a = surf === SURF.MUD ? 0.12 : Math.min(0.16, 0.012 + t.slip * 0.004);
    this.bgCtx.fillStyle = surf === SURF.MUD ? `rgba(40,24,12,${a})` : `rgba(90,56,26,${a})`;
    if (this.isoCtx) this.isoCtx.fillStyle = this.bgCtx.fillStyle;
    for (const side of [-4, 4]) {
      const x = t.x - c * 5 - s * side, y = t.y - s * 5 + c * side;
      this.bgCtx.fillRect(Math.round(x * RES), Math.round(y * RES), 2, 2);
      if (this.isoCtx) {
        const I = View.ISO, gh = this.track.heightAt(x, y);
        this.isoCtx.fillRect(Math.round((I.ox + (x - y) * I.a) * RES), Math.round((I.oy + (x + y) * I.b - gh * I.c) * RES), 2, 1);
      }
    }
  }

  updateEffects(dt) {
    // pickups
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.phase === 'run') {
      if (this.pickups.length < 3) this.spawnPickup();
      this.spawnT = 3 + Math.random() * 4;
    }
    for (const p of this.pickups) p.life -= dt;
    // cockpit: wheel follows steering, camera pitches with vertical motion
    for (const t of this.trucks) {
      const k = Math.min(1, dt * 10);
      t.wheel = (t.wheel || 0) + ((t.lastSteer || 0) * 1.7 - (t.wheel || 0)) * k;
      const pitch = Math.max(-28, Math.min(28, t.vz * 0.35));
      t.camPitch = (t.camPitch || 0) + (pitch - (t.camPitch || 0)) * Math.min(1, dt * 6);
    }
    FX.emit(this, dt);
    FX.update(this, dt);
    Stadium.updateConfetti(this, dt);
    for (const f of this.floaters) { f.off += 14 * dt; f.life -= dt; }
    this.floaters = this.floaters.filter(f => f.life > 0);
    for (const m of this.messages) m.life -= dt;
    this.messages = this.messages.filter(m => m.life > 0);
  }

  standings() {
    const done = this.finishOrder.slice();
    const rest = this.trucks.filter(t => !done.includes(t)).sort((a, b) => b.progress(this.track) - a.progress(this.track));
    return done.concat(rest);
  }

  results() {
    return this.standings().map((t, i) => ({
      slot: t.slot, name: t.name, human: t.human, player: t.player, place: i + 1,
      time: t.finished && !t.dnf ? t.finishTime : null, nitros: t.nitros, bagMoney: t.bagMoney,
    }));
  }

  // ---------------- drawing ----------------
  // Background for the current view. The iso copy is made on first use so tire marks can build up on it too.
  background() {
    if (!View.iso) return this.bg;
    if (!this.isoBg) {
      this.isoBg = document.createElement('canvas');
      this.isoBg.width = WORLD_W * RES; this.isoBg.height = WORLD_H * RES;
      this.isoCtx = this.isoBg.getContext('2d');
      this.isoCtx.drawImage(this.track.getIsoBg(), 0, 0);
    }
    return this.isoBg;
  }

  render(ctx, opts = {}) {
    const tr = this.track;
    const sh = this.shake && !opts.noOverlay ? this.shake : 0;
    const jx = sh ? Math.round((Math.random() * 2 - 1) * sh) : 0, jy = sh ? Math.round((Math.random() * 2 - 1) * sh) : 0;
    if (View.fp) {
      ctx.fillStyle = '#0d0b10'; ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      ctx.save(); ctx.translate(jx, jy);
      Cockpit.render(ctx, this, opts.noHud ? 0 : 20);
      ctx.restore();
      Stadium.drawConfetti(ctx, this);
      if (!opts.noHud) this.drawHud(ctx);
      if (!opts.noOverlay) this.drawOverlays(ctx);
      return;
    }
    ctx.save();
    ctx.translate(jx, jy);
    ctx.drawImage(this.background(), 0, 0, WORLD_W, WORLD_H);
    // shimmering water
    const water = View.iso ? tr.isoWater : tr.waterPix;
    if (water.length) {
      ctx.fillStyle = 'rgba(220,240,255,0.75)';
      const n = Math.min(30, water.length / 20);
      for (let i = 0; i < n; i++) {
        const p = water[(Math.random() * water.length) | 0];
        ctx.fillRect((p % (WORLD_W * RES)) / RES, ((p / (WORLD_W * RES)) | 0) / RES, 1 / RES, 1 / RES);
      }
    }
    Stadium.drawCrowd(ctx, this);
    Stadium.drawPennants(ctx, this);
    // pickups
    for (const p of this.pickups) {
      if (p.life < 2 && Math.floor(p.life * 8) % 2 === 0) continue;
      const spr = PICKUP_SPRITES[p.type];
      const bob = Math.sin(this.time * 6 + p.x) > 0 ? 1 : 0;
      const [sx, sy] = View.point(p.x, p.y, tr.heightAt(p.x, p.y), 0);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(Math.round(sx - 3), Math.round(sy + 2), 7, 2);
      const w = spr.width / spr.res, h = spr.height / spr.res;
      ctx.drawImage(spr, Math.round(sx - w / 2), Math.round(sy - h + 2 - bob), w, h);
    }
    Stadium.drawFlagman(ctx, this);
    FX.draw(ctx, this, true);
    const sun = Mood.of(tr).sun;
    const sorted = this.trucks.slice().sort((a, b) => View.depth(a.x, a.y) - View.depth(b.x, b.y));
    for (const t of sorted) t.draw(ctx, tr, this.time, sun);
    FX.draw(ctx, this, false);
    Stadium.drawGantry(ctx, this);
    // light: multiply the mood over the world, then add headlights at night
    ctx.globalCompositeOperation = 'multiply';
    ctx.imageSmoothingEnabled = !View.iso;
    ctx.drawImage(Mood.overlay(tr, View.mode), 0, 0, WORLD_W, WORLD_H);
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'source-over';
    Mood.headlights(ctx, this);

    for (const f of this.floaters) {
      const [sx, sy] = View.point(f.x, f.y, tr.heightAt(f.x, f.y), 0);
      Font.draw(ctx, f.text, sx, sy - f.off, f.col, { align: 'center', shadow: '#000' });
    }
    // player markers
    if (!this.demo && !opts.noOverlay) {
      for (const t of this.trucks) if (t.human) {
        const gh = tr.heightAt(t.x, t.y);
        const lift = Math.max(0, t.z - gh) * 1.5;
        const [sx, sy] = View.point(t.x, t.y, gh, lift);
        if (this.phase !== 'run' || this.raceTime < 3) Font.draw(ctx, `P${t.player + 1}`, sx, sy - 24, t.def.hud, { align: 'center', shadow: '#000' });
        if (t.wrongWayT > 50 && !t.finished && Math.floor(this.time * 4) % 2 === 0) {
          Font.draw(ctx, 'WRONG WAY', sx, sy - 26, '#ff4040', { align: 'center', shadow: '#000' });
        }
      }
    }
    ctx.restore();
    Stadium.drawConfetti(ctx, this);
    if (!opts.noHud) this.drawHud(ctx);
    if (!opts.noOverlay) this.drawOverlays(ctx);
  }

  drawHud(ctx) {
    ctx.fillStyle = '#0d0b10';
    ctx.fillRect(0, 0, WORLD_W, 20);
    const order = this.standings();
    const total = (LAPS + 1) * this.track.N;
    for (const t of this.trucks) {
      const x = t.slot * 100;
      const grad = ctx.createLinearGradient(0, 0, 0, 20);
      grad.addColorStop(0, '#2a2532'); grad.addColorStop(1, '#17141c');
      ctx.fillStyle = grad;
      ctx.fillRect(x + 1, 0, 98, 19);
      ctx.fillStyle = t.def.hud;
      ctx.fillRect(x + 1, 0, 98, 1);
      drawTruckIcon(ctx, t.slot, x + 1, 2);
      const place = order.indexOf(t);
      const nm = t.human ? (this.numHumans === 2 ? `P${t.player + 1} ` : 'P1 ') + t.name : t.name;
      Font.draw(ctx, nm, x + 21, 3, t.def.hud);
      placeBadge(ctx, place, x + 97, 2);
      const lap = t.finished ? 'FIN' : `L${Math.max(1, Math.min(LAPS, t.crossings))}/${LAPS}`;
      Font.draw(ctx, lap, x + 21, 11, '#cfc8d8');
      ctx.drawImage(PICKUP_SPRITES.nitro, x + 46, 10, 5, 6);
      Font.draw(ctx, String(t.nitros), x + 53, 11, t.nitroT > 0 ? '#ffe070' : '#ff8070');
      if (t.human && this.opts.moneyOf) {
        Font.draw(ctx, shortMoney(this.opts.moneyOf(t) + t.bagMoney), x + 97, 11, '#8cf07a', { align: 'right' });
      } else if (!t.human) {
        Font.draw(ctx, 'CPU', x + 97, 11, '#7a7486', { align: 'right' });
      }
      // race progress
      const prog = t.finished ? 1 : Math.max(0, Math.min(1, t.progress(this.track) / total));
      ctx.fillStyle = '#0a080c'; ctx.fillRect(x + 1, 19, 98, 1);
      ctx.fillStyle = t.def.hud; ctx.fillRect(x + 1, 19, Math.round(98 * prog), 1);
    }
  }

  drawOverlays(ctx) {
    const cx = WORLD_W / 2;
    if (this.phase === 'intro' && !this.demo) {
      panel(ctx, 70, 92, 260, 96);
      Font.draw(ctx, `SEASON ${this.opts.season}  -  RACE ${this.opts.raceNo} OF ${TRACK_DEFS.length}${this.opts.diffLabel ? '  -  ' + this.opts.diffLabel : ''}`, cx, 102, '#cfc8d8', { align: 'center' });
      Font.draw(ctx, this.track.name, cx, 118, '#ffd84a', { align: 'center', scale: 2, shadow: '#5a2a00' });
      Font.draw(ctx, `${LAPS} LAPS`, cx, 142, '#ffffff', { align: 'center' });
      Font.draw(ctx, 'DO NOT FINISH LAST!', cx, 158, '#ff7060', { align: 'center' });
      if (Math.floor(this.time * 3) % 2 === 0) Font.draw(ctx, 'GET READY', cx, 172, '#8cf07a', { align: 'center' });
    }
    if (this.phase === 'countdown' || (this.phase === 'run' && this.phaseT < 1)) {
      const n = this.phase === 'countdown' ? Math.floor(this.phaseT) : 3;
      // light tree
      ctx.fillStyle = '#111'; ctx.fillRect(cx - 26, 40, 52, 18);
      ctx.fillStyle = '#444'; ctx.fillRect(cx - 25, 41, 50, 16);
      for (let i = 0; i < 3; i++) {
        let col = '#331414';
        if (n >= 3) col = '#40ff60';
        else if (i <= n) col = '#ff3020';
        ctx.fillStyle = col;
        ctx.fillRect(cx - 20 + i * 15, 44, 10, 10);
      }
      const txt = n >= 3 ? 'GO!' : String(3 - n);
      Font.draw(ctx, txt, cx, 120, n >= 3 ? '#40ff60' : '#ffffff', { align: 'center', scale: 5, shadow: '#000', shadowOffset: 3 });
    }
    let my = 120;
    for (const m of this.messages) {
      if (m.life < 0.4 && Math.floor(m.life * 10) % 2 === 0) continue;
      Font.draw(ctx, m.text, cx, my, m.col, { align: 'center', scale: 2, shadow: '#000' });
      my += 20;
    }
    if (this.phase === 'over' && !this.demo) {
      Font.draw(ctx, 'RACE OVER', cx, 150, '#ffffff', { align: 'center', scale: 3, shadow: '#000', shadowOffset: 2 });
    }
  }
}

// Small side-view of a truck for HUD rows and tables.
function drawTruckIcon(ctx, slot, x, y) {
  const spr = TruckSprites.get(slot, 'top', 8)[0];
  const k = spr.res || 1;
  ctx.drawImage(spr, 7 * k, 8 * k, 18 * k, 17 * k, x, y, 18, 17);
}

const BADGE = [['#ffd84a', '#4a3200'], ['#d8dae2', '#30323a'], ['#d8904a', '#3a1c00'], ['#4a4452', '#cfc8d8']];
function placeBadge(ctx, place, right, y) {
  const [bg, fg] = BADGE[place] || BADGE[3];
  ctx.fillStyle = bg;
  ctx.fillRect(right - 20, y, 20, 9);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(right - 20, y, 20, 1);
  Font.draw(ctx, PLACE_NAMES[place], right - 10, y + 1, fg, { align: 'center' });
}

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(10,8,14,0.86)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#ffd84a';
  ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
  ctx.fillStyle = '#8a5a10';
  ctx.fillRect(x + 2, y + 2, w - 4, 1);
}
