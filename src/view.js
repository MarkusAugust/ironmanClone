'use strict';
// Camera: top-down 2D or isometric 3D. Physics always runs in flat world
// coordinates; the view only decides where things land on screen.

const View = (() => {
  let mode = 'iso';
  try {
    const saved = localStorage.getItem('irondirt.view');
    if (saved === 'top' || saved === 'iso') mode = saved;
  } catch (e) { /* storage blocked */ }

  // Isometric projection of the 400x300 world into the 400x300 screen.
  // a: horizontal scale, b: depth scale, c: height scale, slab: diorama thickness.
  const ISO = { a: 0.62, b: 0.364, c: 1.0, ox: 169, oy: 40, slab: 6, truckScale: 1.45 };
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
    toggle() { set(mode === 'iso' ? 'top' : 'iso'); return mode; },
    onChange(fn) { listeners.push(fn); },
    label(m = mode) { return m === 'iso' ? 'ISOMETRIC 3D' : 'TOP-DOWN 2D'; },
  };
})();
