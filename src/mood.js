'use strict';
// Lighting moods per track: day, sunset or night under floodlights.
// The 3D scene turns these into sun, sky, fog and floodlights.

const MOODS = {
  day: {
    name: 'DAY', tint: [1.0, 0.99, 0.95], sun: [0.45, 0.6, 1.0],
    sky: [[96, 150, 222], [176, 210, 238]], fog: [176, 200, 222], stars: false, lamps: false, crowdLight: 1.0,
  },
  sunset: {
    name: 'SUNSET', tint: [1.0, 0.78, 0.6], sun: [1.15, 0.35, 0.85],
    sky: [[58, 36, 92], [255, 150, 70]], fog: [210, 120, 90], stars: false, lamps: false, crowdLight: 0.85, sunDisk: true,
  },
  night: {
    name: 'NIGHT', tint: [0.32, 0.36, 0.55], sun: [0.25, 0.3, 0.5],
    sky: [[8, 8, 22], [40, 30, 62]], fog: [26, 20, 38], stars: true, lamps: true, crowdLight: 0.7,
  },
};
const MOOD_ORDER = ['day', 'sunset', 'night'];
// floodlight towers just outside the stadium
const FLOODLIGHTS = [[-14, -14], [WORLD_W + 14, -14], [-14, WORLD_H + 14], [WORLD_W + 14, WORLD_H + 14], [WORLD_W / 2, -16], [WORLD_W / 2, WORLD_H + 16]];

const Mood = (() => {
  const reduceMotion = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  function of(track) { return MOODS[track.mood] || MOODS.day; }
  return { of, reduceMotion };
})();
