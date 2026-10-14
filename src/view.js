'use strict';
// Camera: top-down 2D or isometric 3D. Physics always runs in flat world
// coordinates; the view only decides where things land on screen.

// Pixels per world unit on screen: the game thinks in 400x300, the canvas is 800x600.
const RES = 2;

const View = (() => {
  // V cycles through these in order
  const MODES = ['iso', 'fp', 'top'];
  const LABELS = { iso: 'ISOMETRIC 3D', fp: 'FIRST PERSON', top: 'TOP-DOWN 2D' };
  const BUTTONS = { iso: 'VIEW: ISO 3D', fp: 'VIEW: COCKPIT', top: 'VIEW: 2D' };
  let mode = 'iso';
  try {
    const saved = localStorage.getItem('irondirt.view');
    if (MODES.includes(saved)) mode = saved;
  } catch (e) { /* storage blocked */ }

  // Isometric projection of the 400x300 world into the 400x300 screen.
  // a: horizontal scale, b: depth scale, c: height scale, slab: diorama thickness.
  // Sized so every track (all variants, berms included) fits the 400x280 play area.
  // Track width relative to a truck is 1 / truckScale of the top-down proportion.
  const ISO = { a: 0.68, b: 0.41, c: 1.0, ox: 175, oy: 18, slab: 6, truckScale: 1.2 };
  const listeners = [];

  function set(m) {
    if (m === mode) return;
    mode = m;
    try { localStorage.setItem('irondirt.view', mode); } catch (e) { /* ignore */ }
    listeners.forEach(fn => fn(mode));
  }

  // Screen position of a world point. gh = ground height there, lift = height above ground.
  function point(x, y, gh, lift) {
    if (mode === 'top') return [x, y - lift];
    return [ISO.ox + (x - y) * ISO.a, ISO.oy + (x + y) * ISO.b - (gh + lift) * ISO.c];
  }

  // Painter's order: larger depth is nearer the viewer.
  function depth(x, y) { return mode === 'top' ? y : x + y; }

  return {
    ISO, point, depth, set,
    get mode() { return mode; },
    get iso() { return mode === 'iso'; },
    get fp() { return mode === 'fp'; },
    toggle() { set(MODES[(MODES.indexOf(mode) + 1) % MODES.length]); return mode; },
    onChange(fn) { listeners.push(fn); },
    label(m = mode) { return LABELS[m]; },
    button(m = mode) { return BUTTONS[m]; },
  };
})();
