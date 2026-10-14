'use strict';
// Scale the game to the largest 4:3 size that fits: the 3D canvas and the
// overlay canvas on top of it share the same box.

(() => {
  const screen = document.getElementById('screen');
  const world = document.getElementById('world');
  const legend = document.getElementById('legend');
  function fit() {
    const btn = document.getElementById('viewBtn');
    const legendH = (legend && legend.offsetParent ? legend.offsetHeight + 12 : 0) + (btn ? btn.offsetHeight + 12 : 0);
    const availW = window.innerWidth - 32 - 24;
    const availH = window.innerHeight - 24 - 24 - legendH;
    let w = Math.min(availW, availH * 4 / 3);
    w = Math.max(200, Math.floor(w));
    for (const c of [screen, world]) {
      if (!c) continue;
      c.style.width = w + 'px';
      c.style.height = Math.floor(w * 3 / 4) + 'px';
    }
    if (window.Scene3D) Scene3D.resize();
  }
  window.addEventListener('resize', fit);
  fit();
})();
