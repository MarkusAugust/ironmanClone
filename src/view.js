'use strict';
// Camera choice: isometric, chase cam, cockpit or top-down. Physics always runs
// in flat world coordinates; the 3D scene is drawn from the chosen camera.

// Pixels per world unit on screen: the game thinks in 400x300, the canvas is 800x600.
const RES = 2;

const View = (() => {
  // V cycles through these in order
  const MODES = ['iso', 'chase', 'fp', 'top'];
  const LABELS = { iso: 'ISOMETRIC', chase: 'CHASE CAM', fp: 'COCKPIT', top: 'TOP-DOWN' };
  const BUTTONS = { iso: 'VIEW: ISO', chase: 'VIEW: CHASE', fp: 'VIEW: COCKPIT', top: 'VIEW: TOP' };
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

  return {
    ISO, set,
    get mode() { return mode; },
    get iso() { return mode === 'iso'; },
    get fp() { return mode === 'fp'; },
    get chase() { return mode === 'chase'; },
    toggle() { set(MODES[(MODES.indexOf(mode) + 1) % MODES.length]); return mode; },
    onChange(fn) { listeners.push(fn); },
    label(m = mode) { return LABELS[m]; },
    button(m = mode) { return BUTTONS[m]; },
  };
})();
