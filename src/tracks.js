'use strict';
// Track layouts. Points are spline control points in the 400x300 stadium.
// Feature "at" is a control-point index (fractional = between points); len is in pixels.
// Types: hill, jump, table, moguls (bumps), mud, water (surfaces, d0..d1 = lateral span -1..1).

const TRACK_DEFS = [
  {
    name: 'DUSTY OVAL',
    pts: [[200, 276], [330, 276], [366, 242], [366, 90], [330, 54], [70, 54], [34, 90], [34, 242], [70, 276]],
    features: [
      { t: 'jump', at: 2.45, len: 52, h: 13 },
      { t: 'hill', at: 4.5, len: 120, h: 12 },
      { t: 'moguls', at: 6.5, len: 96, h: 3, n: 4 },
      { t: 'mud', at: 0.55, len: 56, d0: -1, d1: 0.1 },
    ],
  },
  {
    name: 'CROSSROADS',
    // figure eight: the first pass crosses on a bridge
    bridge: 'a',
    pts: [[310, 268], [356, 262], [376, 224], [374, 106], [344, 58], [290, 56], [252, 90], [148, 226], [110, 262],
      [56, 260], [28, 222], [28, 104], [58, 58], [110, 56], [148, 90], [252, 226], [275, 256]],
    features: [
      { t: 'jump', at: 2.5, len: 52, h: 13 },
      { t: 'water', at: 3.7, len: 44, d0: -0.2, d1: 1 },
      { t: 'mud', at: 8.6, len: 60, d0: -1, d1: 1 },
      { t: 'moguls', at: 10.5, len: 80, h: 3, n: 4 },
      { t: 'hill', at: 12.5, len: 70, h: 11 },
    ],
  },

  {
    name: 'HAIRPIN HOLLOW',
    pts: [[200, 276], [330, 276], [368, 244], [368, 84], [336, 52], [84, 52], [42, 76], [44, 108], [80, 128],
      [268, 128], [312, 166], [268, 205], [92, 205], [52, 236], [90, 276]],
    features: [
      { t: 'jump', at: 2.6, len: 52, h: 13 },
      { t: 'hill', at: 9.4, len: 110, h: 10 },
      { t: 'mud', at: 11.6, len: 80, d0: -1, d1: 1 },
      { t: 'moguls', at: 0.45, len: 100, h: 3, n: 5 },
      { t: 'water', at: 4.6, len: 50, d0: -0.1, d1: 1 },
    ],
  },
  {
    name: 'TWIN PEAKS',
    pts: [[200, 276], [320, 276], [366, 236], [332, 172], [356, 112], [330, 56], [254, 54], [200, 100],
      [146, 54], [70, 56], [44, 112], [68, 172], [34, 236], [80, 276]],
    features: [
      { t: 'hill', at: 6.5, len: 66, h: 14 },
      { t: 'hill', at: 7.5, len: 66, h: 14 },
      { t: 'jump', at: 0.55, len: 52, h: 13 },
      { t: 'water', at: 11, len: 52, d0: -1, d1: 1 },
      { t: 'moguls', at: 3.5, len: 70, h: 3, n: 3 },
    ],
  },
  {
    name: 'MUD EIGHT',
    // figure eight: the second pass bridges over a mud pool
    bridge: 'b',
    pts: [[96, 268], [60, 264], [30, 226], [30, 110], [62, 62], [122, 60], [168, 100], [262, 240], [300, 268],
      [352, 264], [378, 228], [376, 120], [346, 62], [296, 60], [262, 100], [168, 240], [128, 268]],
    features: [
      { t: 'mud', at: 6.5, len: 70, d0: -1, d1: 1 },
      { t: 'water', at: 2.5, len: 60, d0: -1, d1: 1 },
      { t: 'jump', at: 9.5, len: 50, h: 13 },
      { t: 'hill', at: 11.5, len: 80, h: 10 },
      { t: 'moguls', at: 4.4, len: 60, h: 3, n: 3 },
    ],
  },

  {
    name: 'MOGUL MILE',
    pts: [[200, 276], [340, 276], [370, 246], [370, 80], [340, 52], [252, 52], [222, 84], [178, 84], [148, 52],
      [60, 52], [30, 80], [30, 246], [60, 276]],
    features: [
      { t: 'moguls', at: 2.5, len: 150, h: 3.5, n: 6 },
      { t: 'moguls', at: 10.5, len: 150, h: 3.5, n: 6 },
      { t: 'jump', at: 0.45, len: 56, h: 13 },
      { t: 'table', at: 6.5, len: 70, h: 8 },
      { t: 'mud', at: 12.5, len: 46, d0: -0.2, d1: 1 },
    ],
  },
  {
    name: 'LEAPFROG',
    // figure eight with a chicane; the first pass hops over the bridge
    bridge: 'a',
    pts: [[310, 268], [356, 262], [378, 226], [348, 168], [376, 112], [344, 58], [288, 54], [246, 90], [154, 230],
      [112, 264], [56, 262], [28, 224], [28, 104], [58, 58], [112, 54], [154, 90], [246, 230], [275, 258]],
    features: [
      { t: 'jump', at: 0.55, len: 50, h: 13 },
      { t: 'moguls', at: 3.5, len: 60, h: 3, n: 3 },
      { t: 'water', at: 10.5, len: 50, d0: -1, d1: 1 },
      { t: 'mud', at: 12.5, len: 60, d0: -1, d1: 1 },
      { t: 'hill', at: 14, len: 60, h: 10 },
    ],
  },

  {
    name: 'IRON GAUNTLET',
    pts: [[200, 276], [300, 276], [342, 252], [332, 212], [282, 196], [272, 160], [320, 140], [364, 108],
      [350, 56], [290, 50], [242, 78], [200, 118], [158, 78], [110, 50], [50, 56], [36, 108], [80, 140],
      [128, 160], [118, 196], [68, 212], [58, 252], [100, 276]],
    features: [
      { t: 'jump', at: 0.5, len: 50, h: 13 },
      { t: 'moguls', at: 3.5, len: 60, h: 3, n: 3 },
      { t: 'hill', at: 7.4, len: 70, h: 12 },
      { t: 'water', at: 11, len: 44, d0: -1, d1: 1 },
      { t: 'table', at: 14.5, len: 70, h: 9 },
      { t: 'mud', at: 18.5, len: 60, d0: -1, d1: 1 },
    ],
  },
];
