'use strict';
// Keyboard and touch input. Keys are tracked by KeyboardEvent.code.

const Input = (() => {
  const down = new Set();
  const pressed = new Set();
  const GAME_KEYS = new Set([
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'Tab',
    'ShiftLeft', 'ShiftRight', 'Slash', 'Period', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
  ]);

  function keyDown(code) {
    if (!down.has(code)) pressed.add(code);
    down.add(code);
  }
  function keyUp(code) { down.delete(code); }

  window.addEventListener('keydown', e => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    keyDown(e.code);
    Sound.init();
  });
  window.addEventListener('keyup', e => keyUp(e.code));
  window.addEventListener('blur', () => down.clear());

  // Player bindings. In one-player mode player 1 may use either set.
  const BIND = [
    { left: ['ArrowLeft'], right: ['ArrowRight'], gas: ['ArrowUp'], brake: ['ArrowDown'],
      nitro: ['ShiftRight', 'Slash', 'Period', 'Enter', 'Space'] },
    { left: ['KeyA'], right: ['KeyD'], gas: ['KeyW'], brake: ['KeyS'],
      nitro: ['ShiftLeft', 'KeyQ', 'KeyE', 'Tab'] },
  ];

  function any(codes) { return codes.some(c => down.has(c)); }
  function anyPressed(codes) { return codes.some(c => pressed.has(c)); }

  function bindingsFor(player, numHumans) {
    if (numHumans === 1 && player === 0) {
      const a = BIND[0], b = BIND[1];
      return {
        left: a.left.concat(b.left), right: a.right.concat(b.right), gas: a.gas.concat(b.gas),
        brake: a.brake.concat(b.brake), nitro: a.nitro.concat(b.nitro),
      };
    }
    return BIND[player];
  }

  function controls(player, numHumans) {
    const b = bindingsFor(player, numHumans);
    return {
      steer: (any(b.right) ? 1 : 0) - (any(b.left) ? 1 : 0),
      gas: any(b.gas) || touchAutoGas(player),
      brake: any(b.brake),
      nitro: anyPressed(b.nitro),
    };
  }

  // Menu helpers for shop screens: per-player up/down/buy.
  function menu(player, numHumans) {
    const b = bindingsFor(player, numHumans);
    return {
      up: anyPressed(b.gas),
      down: anyPressed(b.brake),
      buy: anyPressed(b.nitro) || anyPressed(b.right),
      buyHeld: any(b.nitro) || any(b.right),
    };
  }

  let touchMode = false;
  function touchAutoGas(player) { return touchMode && player === 0 && !down.has('ArrowDown'); }

  return {
    isDown: code => down.has(code),
    pressed: (...codes) => codes.some(c => pressed.has(c)),
    anyKeyPressed: () => pressed.size > 0,
    controls, menu,
    keyDown, keyUp,
    endFrame() { pressed.clear(); },
    setTouchMode(v) { touchMode = v; },
    get touchMode() { return touchMode; },
  };
})();
