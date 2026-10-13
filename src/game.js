'use strict';
// Game flow: title + attract demo, races, results, speed shop, seasons, game over.

const PRIZES = [100000, 60000, 30000, 10000];
const POINTS = [10, 6, 3, 1];
const START_MONEY = 40000;
const START_NITROS = 3;
const START_CREDITS = 3;
const NITRO_PRICE = 10000;
const UPGRADES = [
  { key: 'tires', label: 'TIRES' },
  { key: 'shocks', label: 'SHOCKS' },
  { key: 'accel', label: 'ACCELERATION' },
  { key: 'speed', label: 'TOP SPEED' },
];
const MAX_LEVEL = 5;
const upgradePrice = lvl => 30000 + lvl * 10000;
const SHOP_TIME = 30;

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
canvas.width = WORLD_W; canvas.height = WORLD_H;
ctx.imageSmoothingEnabled = false;

const trackCache = new Map();
function getTrack(i, variant) {
  const key = i + ':' + variant;
  if (!trackCache.has(key)) trackCache.set(key, new Track(i, variant));
  return trackCache.get(key);
}

let state = 'title';
let stateT = 0;
let career = null;
let race = null;
let demo = null;
let demoIndex = 0;
let paused = false;
let titleSel = 0;
let showHelp = false;
let shop = null;
let lastResults = null;
let resultNotes = [];
let best = null;
try { best = JSON.parse(localStorage.getItem('irondirt.best') || 'null'); } catch (e) { best = null; }

// ---------------- career ----------------
function newCareer(numHumans) {
  return {
    numHumans, season: 1, race: 0, racesRun: 0,
    points: [0, 0, 0, 0],
    players: Array.from({ length: numHumans }, () => ({
      active: true, credits: START_CREDITS, money: START_MONEY, nitros: START_NITROS,
      up: { tires: 0, shocks: 0, accel: 0, speed: 0 }, earned: 0, wins: 0,
    })),
  };
}

function aiLevel() { return (career.season - 1) * TRACK_DEFS.length + career.race; }

function droneEntrant(slot, lvl) {
  const u = Math.min(MAX_LEVEL, Math.floor(lvl / 3));
  return {
    slot, human: false, skill: Math.min(0.92, 0.55 + lvl * 0.025),
    up: { tires: u, shocks: u, accel: u, speed: u },
    nitros: 1 + Math.floor(lvl / 4), topMul: 0.95,
  };
}
function bossEntrant(lvl) {
  const u = Math.min(MAX_LEVEL, 1 + Math.floor(lvl / 2));
  return {
    slot: 3, human: false, boss: true, skill: Math.min(1, 0.86 + lvl * 0.015),
    up: { tires: u, shocks: u, accel: u, speed: u },
    nitros: 2 + Math.floor(lvl / 3), topMul: 1.04 + Math.min(0.06, lvl * 0.004),
  };
}

function entrants() {
  const lvl = aiLevel();
  const list = [];
  for (let slot = 0; slot < 2; slot++) {
    const p = career.players[slot];
    if (p && p.active) {
      list.push({ slot, human: true, player: slot, up: Object.assign({}, p.up), nitros: p.nitros, skill: 0.9 });
    } else list.push(droneEntrant(slot, lvl));
  }
  list.push(droneEntrant(2, lvl));
  list.push(bossEntrant(lvl));
  return list;
}

function startRace() {
  const variant = (career.season - 1) % 4;
  const track = getTrack(career.race % TRACK_DEFS.length, variant);
  const humans = career.players.filter(p => p.active).length;
  race = new Race(track, entrants(), {
    numHumans: career.numHumans === 2 && humans === 2 ? 2 : 1,
    season: career.season, raceNo: career.race + 1,
    moneyOf: t => career.players[t.player].money,
    onEnd: finishRace,
  });
  // in a 2P game where one player is out, the remaining one keeps their own keys
  if (career.numHumans === 2 && humans === 1) race.numHumans = 2;
  Sound.stopMusic();
  setState('race');
}

function finishRace(results) {
  lastResults = results;
  resultNotes = [];
  career.racesRun++;
  for (const r of results) {
    career.points[r.slot] += POINTS[r.place - 1];
    if (!r.human) continue;
    const p = career.players[r.player];
    const prize = PRIZES[r.place - 1];
    r.prize = prize;
    p.money += prize + r.bagMoney;
    p.earned += prize + r.bagMoney;
    p.nitros = r.nitros;
    if (r.place === 1) p.wins++;
    const who = career.numHumans === 2 ? `P${r.player + 1}` : 'YOU';
    if (r.place === 4) {
      p.credits--;
      if (p.credits <= 0) { p.active = false; resultNotes.push({ text: `${who} FINISHED LAST - OUT OF CREDITS`, col: '#ff5040' }); }
      else resultNotes.push({ text: `${who} FINISHED LAST - ${p.credits} CREDIT${p.credits === 1 ? '' : 'S'} LEFT`, col: '#ff9040' });
    }
  }
  const anyWin = results.some(r => r.human && r.place === 1);
  if (anyWin) Sound.playMusic('win');
  setState('results');
}

function afterResults() {
  if (!career.players.some(p => p.active)) { gameOver(); return; }
  career.race++;
  if (career.race >= TRACK_DEFS.length) { setState('season'); Sound.playMusic('win'); return; }
  openShop();
}

function openShop() {
  shop = {
    t: SHOP_TIME,
    cols: career.players.map((p, i) => ({ player: i, sel: 0, done: !p.active, hold: 0, flash: 0, msg: '' })),
  };
  Sound.playMusic('shop');
  setState('shop');
}

function gameOver() {
  const score = { season: career.season, race: career.race + 1, races: career.racesRun,
    money: Math.max(...career.players.map(p => p.earned)) };
  if (!best || score.races > best.races || (score.races === best.races && score.money > best.money)) {
    best = score;
    try { localStorage.setItem('irondirt.best', JSON.stringify(best)); } catch (e) { /* ignore */ }
  }
  Sound.playMusic('over');
  setState('gameover');
}

function setState(s) { state = s; stateT = 0; paused = false; }

function toTitle() {
  if (race) race.stopSounds();
  race = null; career = null; shop = null;
  setState('title');
  Sound.playMusic('title');
}

// ---------------- demo (attract mode) ----------------
function newDemo() {
  const track = getTrack(demoIndex % TRACK_DEFS.length, Math.floor(demoIndex / TRACK_DEFS.length) % 4);
  demoIndex++;
  const ent = [0, 1, 2, 3].map(slot => ({
    slot, human: false, skill: slot === 3 ? 1 : 0.7 + slot * 0.08,
    up: slot === 3 ? { tires: 3, shocks: 3, accel: 3, speed: 3 } : { tires: 2, shocks: 2, accel: 2, speed: 2 },
    nitros: 3, topMul: 1,
  }));
  demo = new Race(track, ent, { demo: true, onEnd: () => { demo = null; } });
}

// ---------------- view switching ----------------
let viewToastT = 0;
function toggleView() {
  View.toggle();
  Sound.sfx.select();
}
View.onChange(mode => {
  viewToastT = 1.4;
  const btn = document.getElementById('viewBtn');
  if (btn) btn.textContent = View.button(mode);
});

function renderViewToast() {
  if (viewToastT <= 0) return;
  const text = View.label();
  const w = Font.width(text) + 16;
  ctx.fillStyle = 'rgba(10,8,14,0.85)';
  ctx.fillRect(WORLD_W / 2 - w / 2, 24, w, 15);
  ctx.fillStyle = '#ffd84a';
  ctx.fillRect(WORLD_W / 2 - w / 2, 24, w, 1);
  Font.draw(ctx, text, WORLD_W / 2, 28, '#ffd84a', { align: 'center' });
}

// ---------------- update ----------------
function update(dt) {
  stateT += dt;
  if (Input.pressed('KeyM')) Sound.toggleMute();
  if (Input.pressed('KeyV')) toggleView();
  viewToastT = Math.max(0, viewToastT - dt);

  switch (state) {
    case 'title': updateTitle(dt); break;
    case 'race': updateRace(dt); break;
    case 'results':
      if (stateT > 1 && (Input.pressed('Enter', 'Space') || tapped)) afterResults();
      break;
    case 'shop': updateShop(dt); break;
    case 'season':
      if (stateT > 1.5 && (Input.pressed('Enter', 'Space') || tapped)) {
        career.season++; career.race = 0; career.points = [0, 0, 0, 0];
        openShop();
      }
      break;
    case 'gameover':
      if (stateT > 2 && (Input.pressed('Enter', 'Space', 'Escape') || tapped)) toTitle();
      break;
  }
  tapped = false;
}

function updateTitle(dt) {
  if (!demo) newDemo();
  demo.update(dt);
  if (showHelp) {
    if (Input.pressed('Enter', 'Space', 'Escape', 'ArrowLeft', 'ArrowRight') || tapped) { showHelp = false; Sound.sfx.select(); }
    return;
  }
  if (Input.pressed('ArrowUp', 'KeyW')) { titleSel = (titleSel + 2) % 3; Sound.sfx.select(); }
  if (Input.pressed('ArrowDown', 'KeyS')) { titleSel = (titleSel + 1) % 3; Sound.sfx.select(); }
  let choice = -1;
  if (Input.pressed('Digit1')) choice = 0;
  if (Input.pressed('Digit2')) choice = 1;
  if (Input.pressed('Enter', 'Space')) choice = titleSel;
  if (tapped && tapPos) {
    const row = titleRowAt(tapPos.y);
    choice = row >= 0 ? row : 0;
  }
  if (choice === 2) { showHelp = true; Sound.sfx.confirm(); return; }
  if (choice === 0 || choice === 1) {
    Sound.init();
    Sound.sfx.confirm();
    demo = null;
    career = newCareer(choice + 1);
    startRace();
  }
}

function titleRowAt(y) {
  for (let i = 0; i < 3; i++) if (y >= 178 + i * 16 - 4 && y < 178 + i * 16 + 11) return i;
  return -1;
}

function updateRace(dt) {
  if (Input.pressed('KeyP', 'Escape')) { paused = !paused; Sound.sfx.select(); }
  if (paused) {
    race.engines.forEach(e => e.set(0, 0, false));
    if (Input.pressed('KeyQ')) toTitle();
    return;
  }
  // touch: tap to skip intro
  if (tapped && race.phase === 'intro') { race.phase = 'countdown'; race.phaseT = 0; }
  race.update(dt);
}

function updateShop(dt) {
  shop.t -= dt;
  for (const col of shop.cols) {
    if (col.done) continue;
    const m = Input.menu(col.player, career.numHumans);
    const p = career.players[col.player];
    const items = 2 + UPGRADES.length;
    if (m.up) { col.sel = (col.sel + items - 1) % items; Sound.sfx.select(); }
    if (m.down) { col.sel = (col.sel + 1) % items; Sound.sfx.select(); }
    let buy = m.buy;
    if (m.buyHeld && col.sel === 0) {
      col.hold += dt;
      if (col.hold > 0.4) { col.hold -= 0.1; buy = true; }
    } else col.hold = 0;
    if (buy) shopAction(col, p);
    col.flash = Math.max(0, col.flash - dt);
  }
  if (tapped && tapPos) shopTap(tapPos);
  if (shop.cols.every(c => c.done) || shop.t <= 0) {
    Sound.stopMusic();
    startRace();
  }
}

function shopAction(col, p) {
  const sel = col.sel;
  if (sel === 0) {
    if (p.money >= NITRO_PRICE && p.nitros < 99) { p.money -= NITRO_PRICE; p.nitros++; Sound.sfx.buy(); col.flash = 0.2; }
    else { Sound.sfx.deny(); col.msg = p.nitros >= 99 ? 'NITRO FULL' : 'NOT ENOUGH CASH'; col.msgT = stateT; }
  } else if (sel <= UPGRADES.length) {
    const u = UPGRADES[sel - 1];
    const lvl = p.up[u.key];
    if (lvl >= MAX_LEVEL) { Sound.sfx.deny(); col.msg = 'MAXED OUT'; col.msgT = stateT; }
    else if (p.money < upgradePrice(lvl)) { Sound.sfx.deny(); col.msg = 'NOT ENOUGH CASH'; col.msgT = stateT; }
    else { p.money -= upgradePrice(lvl); p.up[u.key]++; Sound.sfx.buy(); col.flash = 0.2; }
  } else {
    col.done = true;
    Sound.sfx.confirm();
  }
}

function shopLayout() {
  const active = shop.cols.filter(c => career.players[c.player].active);
  const n = active.length;
  return active.map((c, i) => ({ col: c, x: n === 1 ? 100 : 8 + i * 196, w: n === 1 ? 200 : 188 }));
}

function shopTap(pos) {
  for (const L of shopLayout()) {
    if (pos.x < L.x || pos.x > L.x + L.w || L.col.done) continue;
    for (let i = 0; i < 2 + UPGRADES.length; i++) {
      const y = 96 + i * 26;
      if (pos.y >= y - 4 && pos.y < y + 22) {
        L.col.sel = i;
        shopAction(L.col, career.players[L.col.player]);
      }
    }
  }
}

// ---------------- render ----------------
function render() {
  ctx.imageSmoothingEnabled = false;
  switch (state) {
    case 'title': renderTitle(); break;
    case 'race':
      race.render(ctx);
      if (paused) renderPause();
      break;
    case 'results': renderResults(); break;
    case 'shop': renderShop(); break;
    case 'season': renderSeason(); break;
    case 'gameover': renderGameOver(); break;
  }
  renderViewToast();
}

function dim(a) {
  ctx.fillStyle = `rgba(8,6,12,${a})`;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
}

function drawLogo(cx, y, scale) {
  const text = 'IRON DIRT';
  const w = Font.width(text, scale);
  const x = cx - w / 2;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [2, 2], [3, 3], [1, 3], [3, 1]]) {
    Font.draw(ctx, text, x + dx * Math.max(1, scale / 3), y + dy * Math.max(1, scale / 3), '#240c00', { scale });
  }
  const h = Font.HEIGHT * scale;
  const bands = [['#fff6a0', 0, 0.3], ['#ffd030', 0.3, 0.6], ['#ff8a18', 0.6, 0.85], ['#d84a10', 0.85, 1]];
  for (const [col, a, b] of bands) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x - 2, y + h * a, w + 4, h * (b - a) + 0.5); ctx.clip();
    Font.draw(ctx, text, x, y, col, { scale });
    ctx.restore();
  }
}

function renderTitle() {
  if (demo) demo.render(ctx, { noHud: true });
  dim(View.fp ? 0.72 : 0.55);
  ctx.fillStyle = '#0d0b10'; ctx.fillRect(0, 0, WORLD_W, 20);
  Font.draw(ctx, 'STADIUM OFF-ROAD RACING', WORLD_W / 2, 7, '#cfc8d8', { align: 'center' });
  drawLogo(WORLD_W / 2, 52, 7);
  Font.draw(ctx, 'FOUR TRUCKS. FOUR LAPS. ONE IRONMAN.', WORLD_W / 2, 116, '#ffffff', { align: 'center', shadow: '#000' });
  Font.draw(ctx, 'EIGHT TRACKS PER SEASON  -  SPEED SHOP UPGRADES', WORLD_W / 2, 130, '#a8a0b8', { align: 'center', shadow: '#000' });

  if (showHelp) { renderHelp(); return; }
  const items = ['1 PLAYER', '2 PLAYERS', 'HOW TO PLAY'];
  items.forEach((it, i) => {
    const y = 178 + i * 16;
    const sel = i === titleSel;
    if (sel) {
      ctx.fillStyle = 'rgba(255,216,74,0.16)';
      ctx.fillRect(130, y - 4, 140, 15);
      if (Math.floor(stateT * 4) % 2 === 0) Font.draw(ctx, '>', 138, y, '#ffd84a');
    }
    Font.draw(ctx, it, WORLD_W / 2, y, sel ? '#ffd84a' : '#cfc8d8', { align: 'center', shadow: '#000' });
  });
  if (best) Font.draw(ctx, `BEST RUN: ${best.races} RACES  ${shortMoney(best.money)}`, WORLD_W / 2, 238, '#8cf07a', { align: 'center', shadow: '#000' });
  Font.draw(ctx, Input.touchMode ? 'TAP TO START' : 'ARROWS + ENTER  -  V: VIEW  -  M: SOUND ' + (Sound.muted ? 'OFF' : 'ON'), WORLD_W / 2, 262, '#7a7486', { align: 'center', shadow: '#000' });
  Font.draw(ctx, 'A FAN-MADE TRIBUTE TO THE 1989 ARCADE CLASSIC', WORLD_W / 2, 284, '#5a5466', { align: 'center' });
}

function renderHelp() {
  panel(ctx, 20, 140, 360, 158);
  const L = 30, C = '#cfc8d8', H = '#ffd84a';
  let y = 147;
  const line = (t, col = C) => { Font.draw(ctx, t, L, y, col); y += 10; };
  line('CONTROLS', H);
  line('P1  ARROWS: STEER / GAS / REVERSE');
  line('    NITRO: RIGHT SHIFT, ENTER OR SPACE');
  line('P2  W A S D: STEER / GAS / REVERSE');
  line('    NITRO: Q OR LEFT SHIFT');
  line('ONE PLAYER CAN USE EITHER SET.');
  line('V: VIEW (ISO 3D / COCKPIT / 2D)  P: PAUSE  M: SOUND');
  y += 4;
  line('RULES', H);
  line('RACE 4 LAPS AGAINST THE CPU AND IRONMAN.');
  line('FINISH LAST AND YOU LOSE ONE OF 3 CREDITS.');
  line('GRAB NITROS AND MONEY BAGS ON THE TRACK.');
  line('SPEND PRIZE MONEY ON UPGRADES IN THE SHOP.');
  line('JUMPS LAUNCH YOU. SHOCKS SOFTEN LANDINGS.');
}

function renderPause() {
  dim(0.6);
  panel(ctx, 110, 110, 180, 64);
  Font.draw(ctx, 'PAUSED', WORLD_W / 2, 120, '#ffd84a', { align: 'center', scale: 2 });
  Font.draw(ctx, 'P OR ESC: RESUME', WORLD_W / 2, 144, '#cfc8d8', { align: 'center' });
  Font.draw(ctx, 'Q: QUIT TO TITLE', WORLD_W / 2, 156, '#cfc8d8', { align: 'center' });
}

function fmtTime(t) {
  if (t == null) return '--:--.-';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

function renderResults() {
  race.render(ctx, { noHud: true, noOverlay: true });
  dim(0.72);
  ctx.fillStyle = '#0d0b10'; ctx.fillRect(0, 0, WORLD_W, 20);
  Font.draw(ctx, `RACE ${career.race + 1} RESULTS  -  ${race.track.name}`, WORLD_W / 2, 7, '#ffd84a', { align: 'center' });

  Font.draw(ctx, 'POS', 24, 34, '#7a7486');
  Font.draw(ctx, 'DRIVER', 56, 34, '#7a7486');
  Font.draw(ctx, 'TIME', 170, 34, '#7a7486');
  Font.draw(ctx, 'PRIZE', 290, 34, '#7a7486', { align: 'right' });
  Font.draw(ctx, 'PTS', 376, 34, '#7a7486', { align: 'right' });
  lastResults.forEach((r, i) => {
    const y = 50 + i * 16;
    const d = TRUCK_DEFS[r.slot];
    if (r.human) { ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(16, y - 4, 368, 15); }
    Font.draw(ctx, PLACE_NAMES[r.place - 1], 24, y, r.place === 1 ? '#fff27a' : '#ffffff');
    ctx.fillStyle = d.hud; ctx.fillRect(56, y, 6, 7);
    const nm = r.human ? `P${r.player + 1} ${r.name}` : r.name;
    Font.draw(ctx, nm, 66, y, d.hud);
    Font.draw(ctx, fmtTime(r.time), 170, y, '#cfc8d8');
    if (r.human) {
      Font.draw(ctx, formatMoney(r.prize), 290, y, '#8cf07a', { align: 'right' });
      if (r.bagMoney) Font.draw(ctx, '+' + shortMoney(r.bagMoney), 296, y, '#5ab04a');
    }
    Font.draw(ctx, '+' + POINTS[r.place - 1], 376, y, '#cfc8d8', { align: 'right' });
  });

  // season standings
  Font.draw(ctx, `SEASON ${career.season} STANDINGS`, 24, 126, '#ffd84a');
  const order = [0, 1, 2, 3].sort((a, b) => career.points[b] - career.points[a]);
  order.forEach((slot, i) => {
    const x = 24 + i * 92, y = 140;
    const d = TRUCK_DEFS[slot];
    ctx.fillStyle = d.hud; ctx.fillRect(x, y, 6, 7);
    Font.draw(ctx, d.name, x + 10, y, d.hud);
    Font.draw(ctx, `${career.points[slot]} PTS`, x + 10, y + 10, '#cfc8d8');
  });

  let y = 172;
  for (const p of career.players.map((p, i) => ({ p, i }))) {
    const who = career.numHumans === 2 ? `P${p.i + 1}` : 'YOU';
    const credits = Math.max(0, p.p.credits);
    Font.draw(ctx, `${who}: ${formatMoney(p.p.money)}   NITROS ${p.p.nitros}   CREDITS ${credits}`, 24, y, p.p.active ? '#ffffff' : '#7a7486');
    y += 12;
  }
  y += 6;
  for (const n of resultNotes) { Font.draw(ctx, n.text, WORLD_W / 2, y, n.col, { align: 'center' }); y += 12; }
  const ironWon = lastResults[0].slot === 3;
  if (ironWon && !resultNotes.length) Font.draw(ctx, 'IRONMAN TAKES IT. UPGRADE AND GET HIM NEXT TIME!', WORLD_W / 2, y, '#c8cad4', { align: 'center' });
  if (stateT > 1 && Math.floor(stateT * 2) % 2 === 0) {
    const next = career.players.some(p => p.active) ? 'PRESS ENTER FOR THE SPEED SHOP' : 'PRESS ENTER';
    Font.draw(ctx, next, WORLD_W / 2, 280, '#8cf07a', { align: 'center' });
  }
}

function renderShop() {
  ctx.fillStyle = '#16121c';
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  // diamond-plate floor
  ctx.fillStyle = '#1e1926';
  for (let y = 0; y < WORLD_H; y += 8) for (let x = (y / 8) % 2 * 4; x < WORLD_W; x += 8) ctx.fillRect(x, y, 3, 1);
  ctx.fillStyle = '#0d0b10'; ctx.fillRect(0, 0, WORLD_W, 20);
  drawLogoSmall('SPEED SHOP', WORLD_W / 2, 30);
  const t = Math.max(0, Math.ceil(shop.t));
  Font.draw(ctx, `TIME ${t}`, WORLD_W - 8, 7, t <= 5 ? '#ff5040' : '#cfc8d8', { align: 'right' });
  const nextTrack = TRACK_DEFS[career.race % TRACK_DEFS.length].name;
  Font.draw(ctx, `NEXT: ${nextTrack}`, 8, 7, '#cfc8d8');

  for (const L of shopLayout()) {
    const col = L.col, p = career.players[col.player];
    const d = TRUCK_DEFS[col.player];
    const x = L.x, w = L.w;
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x, 58, w, 232);
    ctx.fillStyle = d.hud; ctx.fillRect(x, 58, w, 2);
    const who = career.numHumans === 2 ? `P${col.player + 1} ${d.name}` : `${d.name} TRUCK`;
    Font.draw(ctx, who, x + 6, 66, d.hud);
    Font.draw(ctx, formatMoney(p.money), x + w - 6, 66, col.flash > 0 ? '#ffffff' : '#8cf07a', { align: 'right' });
    Font.draw(ctx, `CREDITS ${p.credits}`, x + 6, 78, '#7a7486');

    const rows = [{ label: 'NITRO', sub: `x${p.nitros}`, price: NITRO_PRICE }]
      .concat(UPGRADES.map(u => ({ label: u.label, lvl: p.up[u.key], price: p.up[u.key] >= MAX_LEVEL ? null : upgradePrice(p.up[u.key]) })))
      .concat([{ label: col.done ? 'READY!' : 'DONE - RACE!' }]);
    rows.forEach((r, i) => {
      const y = 96 + i * 26;
      const sel = i === col.sel && !col.done;
      ctx.fillStyle = sel ? 'rgba(255,216,74,0.18)' : 'rgba(255,255,255,0.04)';
      ctx.fillRect(x + 4, y - 4, w - 8, 22);
      if (sel) { ctx.fillStyle = '#ffd84a'; ctx.fillRect(x + 4, y - 4, 2, 22); }
      Font.draw(ctx, r.label, x + 12, y, sel ? '#ffd84a' : '#ffffff');
      if (r.sub) Font.draw(ctx, r.sub, x + 12, y + 9, '#ff8070');
      if (r.lvl != null) {
        for (let k = 0; k < MAX_LEVEL; k++) {
          ctx.fillStyle = k < r.lvl ? d.hud : '#3a3444';
          ctx.fillRect(x + 12 + k * 9, y + 9, 7, 4);
        }
      }
      if (r.price) Font.draw(ctx, formatMoney(r.price), x + w - 10, y + 4, p.money >= r.price ? '#8cf07a' : '#7a4a4a', { align: 'right' });
      else if (r.lvl != null) Font.draw(ctx, 'MAX', x + w - 10, y + 4, '#ffd84a', { align: 'right' });
    });
    if (col.msg && stateT - col.msgT < 1.2) Font.draw(ctx, col.msg, x + w / 2, 276, '#ff6050', { align: 'center' });
    else if (!col.done) {
      const keys = Input.touchMode ? 'TAP TO BUY' : (career.numHumans === 2 ? (col.player === 0 ? 'UP/DOWN  RIGHT: BUY' : 'W/S  D: BUY') : 'UP/DOWN  ENTER: BUY');
      Font.draw(ctx, keys, x + w / 2, 276, '#7a7486', { align: 'center' });
    }
  }
}

function drawLogoSmall(text, cx, y) {
  Font.draw(ctx, text, cx, y, '#240c00', { align: 'center', scale: 2, shadow: '#240c00', shadowOffset: 2 });
  Font.draw(ctx, text, cx, y, '#ffd030', { align: 'center', scale: 2 });
}

function renderSeason() {
  ctx.fillStyle = '#16121c'; ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  drawLogoSmall(`SEASON ${career.season} COMPLETE`, WORLD_W / 2, 40);
  const order = [0, 1, 2, 3].sort((a, b) => career.points[b] - career.points[a]);
  const champ = TRUCK_DEFS[order[0]];
  Font.draw(ctx, 'CHAMPION', WORLD_W / 2, 74, '#cfc8d8', { align: 'center' });
  Font.draw(ctx, champ.name, WORLD_W / 2, 88, champ.hud, { align: 'center', scale: 3, shadow: '#000' });
  order.forEach((slot, i) => {
    const y = 130 + i * 16, d = TRUCK_DEFS[slot];
    Font.draw(ctx, PLACE_NAMES[i], 120, y, '#ffffff');
    Font.draw(ctx, d.name, 160, y, d.hud);
    Font.draw(ctx, `${career.points[slot]} PTS`, 290, y, '#cfc8d8', { align: 'right' });
  });
  const humanChamp = career.players[order[0]] && order[0] < 2;
  Font.draw(ctx, humanChamp ? 'YOU BEAT IRONMAN FOR THE TITLE!' : 'THE TRACKS GET MIRRORED AND THE CPU GETS FASTER.',
    WORLD_W / 2, 210, humanChamp ? '#8cf07a' : '#ffd84a', { align: 'center' });
  Font.draw(ctx, `SEASON ${career.season + 1} STARTS NOW. POINTS RESET.`, WORLD_W / 2, 224, '#cfc8d8', { align: 'center' });
  if (stateT > 1.5 && Math.floor(stateT * 2) % 2 === 0) Font.draw(ctx, 'PRESS ENTER', WORLD_W / 2, 260, '#8cf07a', { align: 'center' });
}

function renderGameOver() {
  if (race) race.render(ctx, { noHud: true, noOverlay: true });
  dim(0.8);
  Font.draw(ctx, 'GAME OVER', WORLD_W / 2, 80, '#ff5040', { align: 'center', scale: 5, shadow: '#300', shadowOffset: 3 });
  Font.draw(ctx, `REACHED SEASON ${career.season}, RACE ${career.race + 1}`, WORLD_W / 2, 140, '#cfc8d8', { align: 'center' });
  Font.draw(ctx, `RACES RUN: ${career.racesRun}`, WORLD_W / 2, 154, '#cfc8d8', { align: 'center' });
  career.players.forEach((p, i) => {
    const who = career.numHumans === 2 ? `P${i + 1}` : 'YOU';
    Font.draw(ctx, `${who}: ${p.wins} WINS, ${formatMoney(p.earned)} EARNED`, WORLD_W / 2, 172 + i * 12, TRUCK_DEFS[i].hud, { align: 'center' });
  });
  if (best) Font.draw(ctx, `BEST RUN: ${best.races} RACES, ${formatMoney(best.money)}`, WORLD_W / 2, 210, '#8cf07a', { align: 'center' });
  if (stateT > 2 && Math.floor(stateT * 2) % 2 === 0) Font.draw(ctx, 'PRESS ENTER', WORLD_W / 2, 250, '#ffffff', { align: 'center' });
}

// ---------------- touch ----------------
let tapped = false, tapPos = null;
function setupTouch() {
  const pad = document.getElementById('touchpad');
  canvas.addEventListener('pointerdown', e => {
    Sound.init();
    if (e.pointerType === 'touch') enableTouch();
    const r = canvas.getBoundingClientRect();
    tapPos = { x: (e.clientX - r.left) / r.width * WORLD_W, y: (e.clientY - r.top) / r.height * WORLD_H };
    tapped = true;
  });
  window.addEventListener('touchstart', enableTouch, { passive: true, once: true });
  function enableTouch() {
    if (Input.touchMode) return;
    Input.setTouchMode(true);
    if (pad) pad.hidden = false;
  }
  if (!pad) return;
  pad.querySelectorAll('[data-key]').forEach(btn => {
    const code = btn.dataset.key;
    const on = e => { e.preventDefault(); Sound.init(); btn.setPointerCapture?.(e.pointerId); Input.keyDown(code); btn.classList.add('on'); };
    const off = e => { e.preventDefault(); Input.keyUp(code); btn.classList.remove('on'); };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('lostpointercapture', off);
  });
}

// ---------------- boot ----------------
function frame(now) {
  const dt = Math.min(0.05, (now - (frame.last || now)) / 1000);
  frame.last = now;
  update(dt);
  render();
  Input.endFrame();
  requestAnimationFrame(frame);
}

function start(data) {
  setupTouch();
  const btn = document.getElementById('viewBtn');
  if (btn) {
    btn.textContent = View.button();
    btn.addEventListener('click', () => { Sound.init(); toggleView(); btn.blur(); });
  }
  if (data && data.career) {
    career = data.career;
    openShop();
  } else {
    setState('title');
    Sound.playMusic('title');
  }
  requestAnimationFrame(frame);
}

window.claude?.hot?.snapshot?.(() => (career && state !== 'gameover' ? { career: JSON.parse(JSON.stringify(career)) } : {}));
const hot = window.claude?.hot;
if (hot?.ready) hot.ready(start); else start(hot?.data ?? {});

// test hook for automated checks
window.__ironDirt = {
  get state() { return state; }, get race() { return race; }, get career() { return career; },
  getTrack, newCareer, startRace: n => { career = newCareer(n || 1); startRace(); },
};
