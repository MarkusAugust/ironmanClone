'use strict';
// Scale the 400x300 screen to the largest size that fits, keeping 4:3.

(() => {
  const screen = document.getElementById('screen');
  const legend = document.getElementById('legend');
  function fit() {
    const btn = document.getElementById('viewBtn');
    const legendH = (legend && legend.offsetParent ? legend.offsetHeight + 12 : 0) + (btn ? btn.offsetHeight + 12 : 0);
    const availW = window.innerWidth - 32 - 24;
    const availH = window.innerHeight - 24 - 24 - legendH;
    let w = Math.min(availW, availH * 4 / 3);
    w = Math.max(200, Math.floor(w));
    screen.style.width = w + 'px';
    screen.style.height = Math.floor(w * 3 / 4) + 'px';
  }
  window.addEventListener('resize', fit);
  fit();
})();
