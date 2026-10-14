'use strict';
// The 3D world, drawn with Three.js. Physics still runs in the flat 400x300
// world; here world (x, y, height) maps to Three (X = x, Y = height, Z = y).
// One scene is built per track and cached; trucks, pickups and particles of
// the race being shown are attached to it.

const Scene3D = (() => {
  let renderer = null, ok = false, glCanvas = null;
  const views = [];                 // what was drawn last frame, for overlays
  const T = () => window.THREE;

  // ---------- setup ----------
  function init(canvas) {
    glCanvas = canvas;
    try {
      if (!T()) throw new Error('Three.js did not load');
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(1);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.autoClear = false;
      ok = true;
    } catch (e) {
      ok = false;
      console.warn('3D view unavailable:', e);
    }
    resize();
    return ok;
  }

  // Quality steps down on slow machines: 0 = full, 1 = 1x pixels and smaller
  // shadow maps, 2 = no sun shadows. Decided from sustained frame times.
  let quality = 0, slowT = 0, avgMs = 16;
  const shadowSize = () => quality ? 1024 : 2048;
  function applyQuality(w) {
    if (!w || !w.sun) return;
    w.sun.castShadow = quality < 2;
    if (w.sun.shadow.mapSize.x !== shadowSize()) {
      w.sun.shadow.mapSize.set(shadowSize(), shadowSize());
      if (w.sun.shadow.map) { w.sun.shadow.map.dispose(); w.sun.shadow.map = null; }
    }
  }
  function governQuality(ms, w) {
    if (ms <= 0 || ms > 250 || quality >= 2 || document.hidden) return;
    avgMs += (ms - avgMs) * 0.05;
    slowT = avgMs > 45 ? slowT + ms : 0;
    if (slowT < 3000) return;
    quality++; slowT = 0; avgMs = 30;
    console.info('Iron Dirt: lowering 3D quality to level', quality);
    resize();
    applyQuality(w);
  }

  function resize() {
    if (!renderer) return;
    const r = glCanvas.getBoundingClientRect();
    const dpr = quality ? 1 : Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(400, Math.round(r.width * dpr)), h = Math.max(300, Math.round(r.height * dpr));
    renderer.setSize(w, h, false);
  }

  // ---------- helpers ----------
  const P = (x, y, h) => new THREE.Vector3(x, h, y);
  function lambert(color, extra = {}) { return new THREE.MeshLambertMaterial(Object.assign({ color }, extra)); }
  function canvasTex(c, repeat) {
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.anisotropy = 4;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }
  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function rgb(c) { return new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255); }

  // ---------- textures ----------
  function crowdTexture(seed) {
    // two frames stacked: the second has some fans on their feet with arms up
    const W = 512, H = 32, c = document.createElement('canvas');
    c.width = W; c.height = H * 2;
    const g = c.getContext('2d');
    const shirts = ['#d8463c', '#f0dcbe', '#466ec8', '#fac83c', '#3c9650', '#c8c8d2', '#96583c', '#e678b4'];
    const skin = ['#ecc4a0', '#c8966e', '#966446', '#604030'];
    for (let f = 0; f < 2; f++) {
      g.fillStyle = '#2e2c36'; g.fillRect(0, f * H, W, H);
      for (let x = 0; x < W; x += 6) {
        const r = hash2(x, 3, seed), up = f === 1 && r > 0.72 ? 3 : 0;
        const y0 = f * H + 12 - up;
        g.fillStyle = shirts[Math.floor(hash2(x, 1, seed) * shirts.length)];
        g.fillRect(x + 1, y0 + 6, 4, 9);
        g.fillStyle = skin[Math.floor(hash2(x, 2, seed) * skin.length)];
        g.fillRect(x + 1.5, y0 + 1, 3, 4);
        if (up) { g.fillRect(x, y0 + 1, 1, 4); g.fillRect(x + 5, y0 + 1, 1, 4); }
        if (hash2(x, 4, seed) > 0.75) { g.fillStyle = '#1a1a1a'; g.fillRect(x + 1.5, y0, 3, 1.5); }
      }
      g.fillStyle = '#1c1a22'; g.fillRect(0, f * H + H - 4, W, 4);
    }
    const t = canvasTex(c);
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(4, 0.5);
    return t;
  }

  function textTexture(text, bg, fg, w = 256, h = 32, scale = 3) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 0, w, 2);
    Font.draw(g, text, w / 2, (h - 7 * scale) / 2, fg, { align: 'center', scale });
    return canvasTex(c);
  }

  function plankTexture() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    for (let i = 0; i < 8; i++) {
      const k = 0.85 + 0.3 * hash2(i, 9, 2);
      g.fillStyle = `rgb(${156 * k | 0},${112 * k | 0},${68 * k | 0})`;
      g.fillRect(0, i * 8, 64, 7);
      g.fillStyle = '#3e2a1a'; g.fillRect(0, i * 8 + 7, 64, 1);
      g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(Math.floor(hash2(i, 3, 2) * 60), i * 8 + 2, 3, 1);
    }
    return canvasTex(c, [1, 1]);
  }

  function treadTexture() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 16;
    const g = c.getContext('2d');
    g.fillStyle = '#1e1c1a'; g.fillRect(0, 0, 64, 16);
    g.fillStyle = '#3a3634';
    for (let x = 0; x < 64; x += 8) { g.fillRect(x, 0, 4, 7); g.fillRect(x + 4, 9, 4, 7); }
    return canvasTex(c, [1, 1]);
  }

  function hubTexture() {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#1e1c1a'; g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#b4b8c0'; g.beginPath(); g.arc(16, 16, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6a6e76'; g.beginPath(); g.arc(16, 16, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a2a2e';
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; g.fillRect(16 + Math.cos(a) * 6.5 - 1, 16 + Math.sin(a) * 6.5 - 1, 2, 2); }
    return canvasTex(c);
  }

  function flagTexture(kind) {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 12;
    const g = c.getContext('2d');
    const cols = { red: ['#e02020', '#e02020'], green: ['#20b030', '#20b030'], white: ['#f4f4f4', '#f4f4f4'], checkered: ['#f4f4f4', '#141414'] }[kind];
    for (let y = 0; y < 12; y += 3) for (let x = 0; x < 16; x += 4) { g.fillStyle = ((x / 4 + y / 3) % 2) ? cols[1] : cols[0]; g.fillRect(x, y, 4, 3); }
    return canvasTex(c);
  }

  // GPU resources are freed when a race or a track scene is no longer shown;
  // the shared textures and materials below are kept for the whole session.
  const keep = new Set();
  function dispose(obj) {
    obj.traverse(o => {
      if (o.geometry && !keep.has(o.geometry)) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (keep.has(m)) continue;
        for (const k of ['map']) if (m[k] && !keep.has(m[k])) m[k].dispose();
        m.dispose();
      }
    });
  }

  let shared = null;
  function sharedAssets() {
    if (shared) return shared;
    shared = {
      tread: treadTexture(), hub: hubTexture(), planks: plankTexture(),
      flags: { red: flagTexture('red'), green: flagTexture('green'), white: flagTexture('white'), checkered: flagTexture('checkered') },
      concrete: lambert(0x8a8a92), darkConcrete: lambert(0x55555e), steel: lambert(0x9aa0aa), rubber: lambert(0x1e1c1c),
    };
    for (const v of Object.values(shared)) {
      if (v.isTexture || v.isMaterial) keep.add(v);
      else for (const t of Object.values(v)) keep.add(t);
    }
    return shared;
  }

  // ---------- the stadium for one track ----------
  const recent = [];      // tracks with a built scene, most recent last
  function world(track) {
    if (track.world3d) {
      recent.splice(recent.indexOf(track), 1); recent.push(track);
      return track.world3d;
    }
    while (recent.length >= 3) {
      const old = recent.shift();
      if (old.world3d) {
        old.world3d.dynamic.clear();
        dispose(old.world3d.scene);
        if (old.world3d.scene.background) old.world3d.scene.background.dispose();
        old.world3d = null;
      }
    }
    recent.push(track);
    const S = sharedAssets();
    const scene = new THREE.Scene();
    const W = WORLD_W, H = WORLD_H, mood = MOODS[track.mood];
    const w = { scene, track, root: new THREE.Group(), dynamic: new THREE.Group() };
    scene.add(w.root, w.dynamic);

    // sky and fog
    const sky = document.createElement('canvas');
    sky.width = 2; sky.height = 256;
    const sg = sky.getContext('2d');
    const grad = sg.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, `rgb(${mood.sky[0].join(',')})`); grad.addColorStop(1, `rgb(${mood.sky[1].join(',')})`);
    sg.fillStyle = grad; sg.fillRect(0, 0, 2, 256);
    scene.background = new THREE.CanvasTexture(sky);
    w.fog = new THREE.Fog(rgb(mood.fog), 420, 1100);   // only for the chase and cockpit cameras

    // terrain: heights from the track's visual heights, painted with its texture
    const geo = new THREE.PlaneGeometry(W, H - STANDS_Y, W, H - STANDS_Y);
    geo.rotateX(-Math.PI / 2);
    geo.translate(W / 2, 0, (H + STANDS_Y) / 2);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    const V = track.V;
    const vAt = (x, y) => {
      const xi = Math.max(0, Math.min(W - 1, Math.round(x - 0.5))), yi = Math.max(0, Math.min(H - 1, Math.round(y - 0.5)));
      const x2 = Math.min(W - 1, xi + 1), y2 = Math.min(H - 1, yi + 1);
      return (V[yi * W + xi] + V[yi * W + x2] + V[y2 * W + xi] + V[y2 * W + x2]) / 4;
    };
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), y = pos.getZ(k);
      pos.setY(k, vAt(x, y));
      uv.setXY(k, x / W, 1 - y / H);
    }
    geo.computeVertexNormals();
    w.terrainMat = lambert(0xffffff);
    const terrain = new THREE.Mesh(geo, w.terrainMat);
    terrain.receiveShadow = true;
    w.root.add(terrain);

    // ground beyond the stadium
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), lambert(0x3a3a2c));
    outer.rotation.x = -Math.PI / 2; outer.position.set(W / 2, -0.3, H / 2);
    outer.receiveShadow = true;
    w.root.add(outer);

    buildStands(w, track);
    buildTireWalls(w, track);
    buildDecor(w, track);
    buildBridges(w, track);
    buildGantryAndFlagman(w, track);
    buildLights(w, track);
    return (track.world3d = w);
  }

  function buildStands(w, track) {
    const S = sharedAssets(), W = WORLD_W, H = WORLD_H;
    w.crowd = crowdTexture(track.seed);
    const crowdMat = new THREE.MeshLambertMaterial({ map: w.crowd });
    const seat = lambert(0x4a4652);
    // a raked grandstand: tiers stepping up and away from the field
    const stand = (len, tiers) => {
      const g = new THREE.Group();
      for (let k = 0; k < tiers; k++) {
        const mats = [seat, seat, seat, seat, crowdMat, seat];
        const m = new THREE.Mesh(new THREE.BoxGeometry(len, 3, 3.2), mats);
        m.position.set(0, 4 + k * 3 + 1.5, -k * 3.2 - 1.6);
        m.castShadow = true; m.receiveShadow = true;
        g.add(m);
      }
      const wall = box(len, 4, 1.2, S.darkConcrete, 0, 2, 0.6);
      g.add(wall);
      const back = box(len, tiers * 3 + 8, 1.5, S.darkConcrete, 0, (tiers * 3 + 8) / 2, -tiers * 3.2 - 0.8);
      g.add(back);
      // roof canopy over the top rows
      const roof = box(len, 1, tiers * 1.6, lambert(0xc8ccd4), 0, tiers * 3 + 9, -tiers * 2.4);
      g.add(roof);
      return g;
    };
    const north = stand(W + 40, 8);
    north.position.set(W / 2, 0, STANDS_Y);
    w.root.add(north);
    const west = stand(H - STANDS_Y, 6);
    west.rotation.y = Math.PI / 2; west.position.set(-1, 0, (H + STANDS_Y) / 2);
    w.root.add(west);
    // low walls on the camera side, carrying the sponsor boards
    const southWall = box(W + 40, 3, 1.4, S.darkConcrete, W / 2, 1.5, H + 0.7);
    const eastWall = box(1.4, 3, H - STANDS_Y, S.darkConcrete, W + 0.7, 1.5, (H + STANDS_Y) / 2);
    w.root.add(southWall, eastWall);
    const names = ['DIRTCO', 'NITRO-X', 'MUDLINE', 'GRIT OIL', 'ROCKJAW', 'TREADZ'];
    const cols = [['#c8281c', '#fff'], ['#1c3c9c', '#ffd84a'], ['#f0c020', '#201810'], ['#1a1a1e', '#ff7020'], ['#2a7a3a', '#fff'], ['#e8e8e8', '#c8281c']];
    let k = track.seed % names.length;
    for (let x0 = 4; x0 + 50 < W; x0 += 58, k++) {
      const [bg, fg] = cols[k % cols.length];
      const mat = new THREE.MeshLambertMaterial({ map: textTexture(names[k % names.length], bg, fg) });
      const b = box(52, 5, 0.8, [S.darkConcrete, S.darkConcrete, S.darkConcrete, S.darkConcrete, S.darkConcrete, mat], x0 + 26, 4.5, H + 0.2);
      b.material = [S.darkConcrete, S.darkConcrete, S.darkConcrete, S.darkConcrete, S.darkConcrete, mat];
      b.rotation.y = Math.PI;
      w.root.add(b);
    }
  }

  // stacks of real tires along the berm crests, every fifth one white
  function buildTireWalls(w, track) {
    const geo = new THREE.CylinderGeometry(1.45, 1.45, 1.15, 10);
    const pts = [];
    const step = 3.2;
    for (let s = 0; s < track.L; s += step) {
      const i = Math.floor(s / track.sp) % track.N;
      for (const side of [-1, 1]) {
        const lat = side * (track.halfW + 2.6);
        const x = track.cx[i] - track.ty[i] * lat, y = track.cy[i] + track.tx[i] * lat;
        if (!track.inside(x, y) || y < STANDS_Y + 2) continue;
        if (track.surf[track.pix(x, y)] !== SURF.WALL) continue;           // another road is here
        const c = track.upperCrossing(i);
        if (c && Math.abs(track.sRel(c, i, track.cx[i], track.cy[i])) < c.D + 2) continue; // bridge has railings
        const base = track.V[track.pix(x, y)];
        const white = Math.floor(s / step) % 5 === 0;
        pts.push([x, y, base, white]);
      }
    }
    const mesh = new THREE.InstancedMesh(geo, lambert(0xffffff), pts.length * 2);
    const m = new THREE.Matrix4(), black = new THREE.Color(0x222020), white = new THREE.Color(0xe6e6e0);
    let n = 0;
    for (const [x, y, base, wh] of pts) {
      for (let k = 0; k < 2; k++) {
        m.makeTranslation(x, base - 1.2 + 0.58 + k * 1.15, y);
        mesh.setMatrixAt(n, m);
        mesh.setColorAt(n, wh ? white : black);
        n++;
      }
    }
    mesh.castShadow = true; mesh.receiveShadow = true;
    w.root.add(mesh);
  }

  function buildDecor(w, track) {
    const S = sharedAssets();
    const tire = new THREE.CylinderGeometry(2.6, 2.6, 1.8, 12);
    const hay = lambert(0xd8b050), hayDark = lambert(0x9a7828);
    for (const [x, y, dh] of track.decor) {
      const gh = track.V[track.pix(x, y)];
      if (dh < 4) {
        const b = box(9, 4.6, 5, [hay, hay, hay, hay, hayDark, hayDark], x, gh + 2.3, y);
        w.root.add(b);
      } else {
        for (let k = 0; k < 3; k++) {
          const t = new THREE.Mesh(tire, S.rubber);
          t.position.set(x, gh + 0.9 + k * 1.8, y);
          t.castShadow = true;
          w.root.add(t);
        }
      }
    }
  }

  // real bridges: deck ribbon along the upper road, railings, pillars
  function buildBridges(w, track) {
    const S = sharedAssets();
    for (const c of track.crossings) {
      const n = Math.ceil(c.D / track.sp) + 1;
      const half = track.halfW + 1.8;
      const top = [], bot = [];
      for (let k = -n; k <= n; k++) {
        const i = (c.up + k + track.N) % track.N;
        const sr = k * track.sp;
        if (Math.abs(sr) > c.D) continue;
        const nx = -track.ty[i], ny = track.tx[i];
        top.push({ i, sr, l: [track.cx[i] - nx * half, track.cy[i] - ny * half], r: [track.cx[i] + nx * half, track.cy[i] + ny * half] });
      }
      // deck as a strip of quads: top (planks), underside, two sides
      const pos = [], uvs = [], idx = [];
      const quad = (a, b, cc, d, u0, u1, v0, v1) => {
        const o = pos.length / 3;
        pos.push(...a, ...b, ...cc, ...d);
        uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
        idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
      };
      const hT = c.BH, hB = c.BH - 2.5;
      for (let k = 0; k < top.length - 1; k++) {
        const A = top[k], B = top[k + 1];
        const u0 = A.sr / 6, u1 = B.sr / 6;
        quad([A.l[0], hT, A.l[1]], [A.r[0], hT, A.r[1]], [B.r[0], hT, B.r[1]], [B.l[0], hT, B.l[1]], 0, 1, u0, u1);
        quad([A.r[0], hB, A.r[1]], [A.l[0], hB, A.l[1]], [B.l[0], hB, B.l[1]], [B.r[0], hB, B.r[1]], 0, 1, u0, u1);
        quad([A.l[0], hB, A.l[1]], [A.l[0], hT, A.l[1]], [B.l[0], hT, B.l[1]], [B.l[0], hB, B.l[1]], 0, 0.2, u0, u1);
        quad([A.r[0], hT, A.r[1]], [A.r[0], hB, A.r[1]], [B.r[0], hB, B.r[1]], [B.r[0], hT, B.r[1]], 0, 0.2, u0, u1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const deck = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: S.planks, side: THREE.DoubleSide }));
      deck.castShadow = true; deck.receiveShadow = true;
      w.root.add(deck);
      // railings: red and white posts with a top rail
      const post = new THREE.BoxGeometry(0.7, 2.6, 0.7);
      const posts = new THREE.InstancedMesh(post, lambert(0xffffff), top.length * 2);
      const m = new THREE.Matrix4(), red = new THREE.Color(0xcc2c22), wht = new THREE.Color(0xeeeee8);
      let pn = 0;
      top.forEach((p, k) => {
        for (const e of [p.l, p.r]) { m.makeTranslation(e[0], hT + 1.3, e[1]); posts.setMatrixAt(pn, m); posts.setColorAt(pn, k % 4 < 2 ? red : wht); pn++; }
      });
      posts.castShadow = true;
      w.root.add(posts);
      for (const side of ['l', 'r']) {
        for (let k = 0; k < top.length - 1; k++) {
          const a = top[k][side], b = top[k + 1][side];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const rail = box(len + 0.2, 0.5, 0.5, k % 2 ? S.steel : lambert(0xcc2c22), (a[0] + b[0]) / 2, hT + 2.6, (a[1] + b[1]) / 2);
          rail.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
          w.root.add(rail);
        }
      }
      // pillars at the deck ends, beside the road underneath
      for (const end of [-1, 1]) {
        const i = (c.up + end * Math.round((c.D - 2.5) / track.sp) + track.N) % track.N;
        for (const side of [-1, 1]) {
          const off = side * (track.halfW - 4);
          const x = track.cx[i] - track.ty[i] * off, y = track.cy[i] + track.tx[i] * off;
          const gh = track.groundAt(x, y);
          w.root.add(box(3, hB - gh, 3, S.concrete, x, gh + (hB - gh) / 2, y));
        }
      }
    }
  }

  function buildGantryAndFlagman(w, track) {
    const S = sharedAssets();
    const [a, b] = track.gantry;
    for (const [x, y] of track.gantry) w.root.add(box(1.4, 22, 1.4, S.steel, x, 11, y));
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    w.bannerTex = { START: canvasTex(Stadium.bannerFor({ phase: 'intro' })), FINISH: canvasTex(Stadium.bannerFor({ phase: 'run' })) };
    w.bannerMat = new THREE.MeshLambertMaterial({ map: w.bannerTex.START });
    const ban = box(len, 6, 0.8, [S.steel, S.steel, S.steel, S.steel, w.bannerMat, w.bannerMat], (a[0] + b[0]) / 2, 20, (a[1] + b[1]) / 2);
    ban.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    w.root.add(ban);

    const fm = track.flagman;
    if (!fm) return;
    const g = new THREE.Group();
    g.position.set(fm.x, track.groundAt(fm.x, fm.y), fm.y);
    // face the start line
    g.rotation.y = -Math.atan2(track.cy[0] - fm.y, track.cx[0] - fm.x);
    const skin = lambert(0xe6b48a), shirt = lambert(0xf2f2f2), pants = lambert(0x22305a), black = lambert(0x161616);
    g.add(box(6, 1.2, 6, lambert(0x6a5034), 0, 0.6, 0));
    g.add(box(1.2, 4.5, 1, pants, 0, 3.4, -0.8), box(1.2, 4.5, 1, pants, 0, 3.4, 0.8));
    const torso = box(1.6, 4.5, 3.2, shirt, 0, 7.8, 0);
    g.add(torso);
    for (const z of [-1, 0, 1]) g.add(box(1.65, 4.5, 0.35, black, 0, 7.8, z));
    g.add(box(1.8, 1.8, 1.8, skin, 0, 11.1, 0), box(2, 0.6, 2, black, 0, 12.1, 0));
    g.add(box(0.8, 3.6, 0.8, skin, 0, 7.6, -2.1));
    const arm = new THREE.Group();
    arm.position.set(0, 9.6, 2.1);
    arm.add(box(0.8, 3.6, 0.8, skin, 0, 1.8, 0));
    arm.add(box(0.3, 4, 0.3, S.steel, 0, 5, 0));
    w.flagMat = new THREE.MeshLambertMaterial({ map: S.flags.green, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), w.flagMat);
    flag.position.set(0, 5.6, 2);
    flag.rotation.y = Math.PI / 2;
    arm.add(flag);
    g.add(arm);
    w.flagArm = arm;
    w.root.add(g);
  }

  function buildLights(w, track) {
    const mood = MOODS[track.mood], night = track.mood === 'night';
    const sky = { day: [0xcfe0ff, 0x5a4a30, 0.7], sunset: [0xffb890, 0x40281c, 0.55], night: [0x34406a, 0x101010, 0.32] }[track.mood];
    w.root.add(new THREE.HemisphereLight(sky[0], sky[1], sky[2]));
    const sun = new THREE.DirectionalLight(track.mood === 'day' ? 0xfff4e0 : track.mood === 'sunset' ? 0xffa868 : 0x8090c0,
      track.mood === 'night' ? 0.28 : 0.85);
    const elev = track.mood === 'day' ? 1.6 : track.mood === 'sunset' ? 0.38 : 1.0;
    const [sx, sy] = mood.sun;
    sun.position.set(WORLD_W / 2 - sx * 240, 240 * elev, WORLD_H / 2 - sy * 240);
    sun.target.position.set(WORLD_W / 2, 0, WORLD_H / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowSize(), shadowSize());
    const sc = sun.shadow.camera;
    sc.left = -280; sc.right = 280; sc.top = 260; sc.bottom = -260; sc.near = 10; sc.far = 900;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
    w.root.add(sun, sun.target);
    w.sun = sun;
    // floodlight towers around the stadium; lit at night
    const S = sharedAssets();
    const headMat = night ? new THREE.MeshBasicMaterial({ color: 0xfff6d8 }) : lambert(0x8a8c94);
    w.frontTowers = [];
    for (const [lx, ly] of FLOODLIGHTS) {
      const tower = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.4, 96, 8), S.steel);
      pole.position.set(lx, 48, ly);
      const head = box(16, 9, 3, headMat, lx, 100, ly);
      head.lookAt(WORLD_W / 2, 100, WORLD_H / 2);
      tower.add(pole, head);
      w.root.add(tower);
      // towers on the camera side would block the overhead views
      if (lx > WORLD_W || ly > WORLD_H) w.frontTowers.push(tower);
      if (night) {
        const spot = new THREE.SpotLight(0xfff0d0, 0.75, 0, 0.75, 0.6, 1);
        spot.position.set(lx, 100, ly);
        spot.target.position.set(WORLD_W / 2 + (WORLD_W / 2 - lx) * -0.2, 0, WORLD_H / 2 + (WORLD_H / 2 - ly) * -0.2);
        w.root.add(spot, spot.target);
      }
    }
    if (night) {
      // stars
      const n = 400, a = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        const th = hash2(k, 1, 5) * Math.PI * 2, el = 0.15 + hash2(k, 2, 5) * 1.2;
        a[k * 3] = WORLD_W / 2 + Math.cos(th) * Math.cos(el) * 900;
        a[k * 3 + 1] = Math.sin(el) * 900;
        a[k * 3 + 2] = WORLD_H / 2 + Math.sin(th) * Math.cos(el) * 900;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(a, 3));
      w.root.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false })));
    } else if (track.mood === 'sunset' || track.mood === 'day') {
      const sunDisk = new THREE.Mesh(new THREE.SphereGeometry(track.mood === 'sunset' ? 40 : 22, 16, 12),
        new THREE.MeshBasicMaterial({ color: track.mood === 'sunset' ? 0xffc070 : 0xfffbe8, fog: false }));
      sunDisk.position.copy(sun.position).sub(sun.target.position).normalize().multiplyScalar(950).add(sun.target.position);
      w.root.add(sunDisk);
    }
  }

  // ---------- trucks ----------
  function buildTruck(slot, night) {
    const S = sharedAssets();
    const col = TRUCK_DEFS[slot].color;
    const root = new THREE.Group(), tilt = new THREE.Group(), body = new THREE.Group();
    root.add(tilt); tilt.add(body);
    const mats = new Map();
    const matFor = (c, glow) => {
      const key = c.join(',') + (glow ? 'g' : '');
      if (!mats.has(key)) mats.set(key, glow ? new THREE.MeshBasicMaterial({ color: rgb(c) }) : lambert(rgb(c)));
      return mats.get(key);
    };
    const wheels = [], cabin = [];
    for (const p of TruckSprites.model(col, 0, 0)) {
      const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2, cz = (p.z0 + p.z1) / 2;
      if (p.tire) {
        const r = (p.z1 - p.z0) / 2, wdt = p.y1 - p.y0;
        const geo = new THREE.CylinderGeometry(r, r, wdt, 16);
        geo.rotateX(Math.PI / 2);
        const hubMat = new THREE.MeshLambertMaterial({ map: S.hub });
        const tread = new THREE.MeshLambertMaterial({ map: S.tread });
        const m = new THREE.Mesh(geo, [tread, hubMat, hubMat]);
        m.position.set(cx, r, cy);
        m.castShadow = true;
        tilt.add(m);
        wheels.push(m);
        continue;
      }
      const base = matFor(p.col, p.glow);
      let mat = base;
      if (p.glassSides) {
        const glass = lambert(rgb(p.glassSides));
        mat = [glass, base, base, base, glass, glass]; // +x windshield, -x rear, top, bottom, sides
      }
      const m = new THREE.Mesh(new THREE.BoxGeometry(p.x1 - p.x0, p.z1 - p.z0, p.y1 - p.y0), mat);
      m.position.set(cx, cz, cy);
      m.castShadow = !p.glow;
      body.add(m);
      if (p.z1 > 5.7) cabin.push(m);   // roof, glass, light bar, cage: hidden from your own cockpit
    }
    // nitro flame out of the back
    const flame = new THREE.Mesh(new THREE.ConeGeometry(1.3, 7, 8),
      new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.rotation.z = Math.PI / 2;
    flame.position.set(-11.5, 4, 0);
    flame.visible = false;
    body.add(flame);
    let head = null;
    if (night) {
      head = new THREE.SpotLight(0xfff0c0, 1.1, 140, 0.5, 0.55, 1);
      head.position.set(8, 4.5, 0);
      head.target.position.set(50, 0, 0);
      body.add(head, head.target);
    }
    // cockpit camera at the driver's eyes, looking forward
    const eye = new THREE.Object3D();
    eye.position.set(1.4, 8.3, -0.8);
    body.add(eye);
    return { root, tilt, body, wheels, cabin, flame, head, eye, spin: 0 };
  }

  function syncTruck(m, t, track, dt) {
    const gh = track.heightAt(t.x, t.y, t.idx);
    const lift = Math.max(0, t.z - gh);
    m.root.position.set(t.x, gh + lift * 1.25, t.y);
    m.root.rotation.y = -t.h;
    // follow the ground slope, nose up in the air when climbing
    const [gx, gy] = track.gradAt(t.x, t.y, t.idx);
    const c = Math.cos(t.h), s = Math.sin(t.h);
    let pitch = Math.atan(gx * c + gy * s), side = Math.atan(-gx * s + gy * c);
    if (t.air) pitch = Math.atan2(t.vz, Math.max(30, t.speed)) * 0.7;
    m.tilt.rotation.set(-side, 0, pitch, 'YXZ');
    // suspension and body roll
    const bob = t.air ? 0.8 : t.bumpT > 0.05 ? -0.7 : 0;
    m.body.position.y += (bob - m.body.position.y) * Math.min(1, dt * 14);
    m.body.rotation.x = -(t.roll || 0) * 0.12;
    m.spin -= (t.forward * dt) / 2.4;
    for (const wh of m.wheels) wh.rotation.z = m.spin;
    m.flame.visible = t.nitroT > 0;
    if (m.flame.visible) { const k = 0.7 + Math.random() * 0.6; m.flame.scale.set(1, k, 1); }
  }

  // ---------- particles ----------
  const PART_MAX = 900;
  function particleLayer() {
    const make = (additive) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PART_MAX * 3), 3));
      g.setAttribute('rgba', new THREE.BufferAttribute(new Float32Array(PART_MAX * 4), 4));
      g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(PART_MAX), 1));
      const mat = new THREE.ShaderMaterial({
        uniforms: { scale: { value: 1 }, ortho: { value: 0 } },
        vertexShader: `
          attribute vec4 rgba; attribute float size; varying vec4 vC;
          uniform float scale; uniform float ortho;
          void main() {
            vC = rgba;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = ortho > 0.5 ? size * scale : size * scale / max(1.0, -mv.z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          varying vec4 vC;
          void main() {
            vec2 d = gl_PointCoord - 0.5; float r = length(d);
            if (r > 0.5) discard;
            gl_FragColor = vec4(vC.rgb, vC.a * smoothstep(0.5, 0.25, r));
          }`,
        transparent: true, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const pts = new THREE.Points(g, mat);
      pts.frustumCulled = false;
      return pts;
    };
    return { normal: make(false), glow: make(true) };
  }

  function syncParticles(layer, race) {
    const tr = race.track;
    const fill = (pts, pick) => {
      const pos = pts.geometry.attributes.position.array, col = pts.geometry.attributes.rgba.array, size = pts.geometry.attributes.size.array;
      let n = 0;
      for (const p of race.particles) {
        if (n >= PART_MAX) break;
        const r = pick(p);
        if (!r) continue;
        const base = p.base != null ? p.base : tr.groundAt(p.x, p.y);
        pos[n * 3] = p.x; pos[n * 3 + 1] = base + p.z + 0.5; pos[n * 3 + 2] = p.y;
        col.set(r.c, n * 4);
        size[n] = r.s;
        n++;
      }
      pts.geometry.setDrawRange(0, n);
      pts.geometry.attributes.position.needsUpdate = true;
      pts.geometry.attributes.rgba.needsUpdate = true;
      pts.geometry.attributes.size.needsUpdate = true;
    };
    fill(layer.normal, p => {
      const f = p.age / p.life;
      if (p.k === 'puff') return { c: [p.rgb[0] / 255, p.rgb[1] / 255, p.rgb[2] / 255, p.a0 * (1 - f) * 0.85], s: 2 * (p.r0 + (p.r1 - p.r0) * Math.sqrt(f)) * 1.4 };
      if (p.k === 'chunk') return { c: [p.rgb[0] / 255, p.rgb[1] / 255, p.rgb[2] / 255, 1], s: 1.3 };
      return null;
    });
    fill(layer.glow, p => {
      const f = p.age / p.life;
      if (p.k === 'flame') {
        const c = f < 0.3 ? [1, 0.96, 0.8] : f < 0.6 ? [1, 0.8, 0.25] : [1, 0.5, 0.12];
        return { c: [...c, 1 - f * 0.6], s: 3.2 };
      }
      if (p.k === 'spark') return { c: [1, 0.85, 0.4, 1 - f], s: 1.1 };
      return null;
    });
  }

  // ---------- pickups ----------
  function pickupMesh(type) {
    const g = new THREE.Group();
    if (type === 'nitro') {
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 4.4, 12), lambert(0xd82020)));
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.65, 1.3, 12), lambert(0xf4f4f4)));
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1, 8), lambert(0xc0c4cc));
      cap.position.y = 2.7; g.add(cap);
      g.children.forEach(c => { c.position.y += 3; c.castShadow = true; });
    } else {
      const bag = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 10), lambert(0xc8a060));
      bag.scale.set(1, 0.85, 1); bag.position.y = 2.6;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 1.6, 8), lambert(0xb08c50));
      neck.position.y = 5;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.5, 8), lambert(0x2a8a2a));
      band.position.y = 4.6;
      g.add(bag, neck, band);
      g.children.forEach(c => { c.castShadow = true; });
    }
    return g;
  }

  // ---------- attach a race to its track's scene ----------
  function attach(race) {
    const w = world(race.track);
    if (w.race === race) return w;
    w.dynamic.clear();
    w.race = race;
    const night = race.track.mood === 'night';
    race.meshes = race.meshes || race.trucks.map(t => buildTruck(t.slot, night));
    race.meshes.forEach(m => w.dynamic.add(m.root));
    race.pickupMeshes = race.pickupMeshes || new Map();
    race.particles3d = race.particles3d || particleLayer();
    w.dynamic.add(race.particles3d.normal, race.particles3d.glow);
    race.terrainTex = race.terrainTex || (() => { const t = new THREE.CanvasTexture(race.bg); t.anisotropy = 8; return t; })();
    w.terrainMat.map = race.terrainTex;
    w.terrainMat.needsUpdate = true;
    return w;
  }

  function syncDynamic(w, race, dt) {
    const tr = race.track;
    race.meshes.forEach((m, k) => syncTruck(m, race.trucks[k], tr, dt));
    // pickups: reuse meshes by pickup object
    const live = new Set(race.pickups);
    for (const [p, m] of race.pickupMeshes) if (!live.has(p)) { w.dynamic.remove(m); race.pickupMeshes.delete(p); }
    for (const p of race.pickups) {
      let m = race.pickupMeshes.get(p);
      if (!m) { m = pickupMesh(p.type); race.pickupMeshes.set(p, m); w.dynamic.add(m); }
      m.visible = !(p.life < 2 && Math.floor(p.life * 8) % 2 === 0);
      m.position.set(p.x, tr.groundAt(p.x, p.y) + Math.sin(race.time * 4 + p.x) * 0.6, p.y);
      m.rotation.y = race.time * 2 + p.x;
    }
    syncParticles(race.particles3d, race);
    // tire marks and mud stains show up on the terrain
    race.texT = (race.texT || 0) + dt;
    if (race.texT > 0.5) { race.texT = 0; race.terrainTex.needsUpdate = true; }
    // flagman and banner
    if (w.flagArm) {
      const [flag, pose] = Stadium.flagState(race);
      w.flagMat.map = sharedAssets().flags[flag];
      const a = pose === 'down' ? Math.PI * 0.95 : pose === 'up' ? 0 : (pose === 'waveL' ? -0.5 : 0.5);
      w.flagArm.rotation.x += (a - w.flagArm.rotation.x) * Math.min(1, dt * 12);
    }
    const ban = race.phase === 'intro' || race.phase === 'countdown' ? 'START' : 'FINISH';
    if (w.bannerMat.map !== w.bannerTex[ban]) { w.bannerMat.map = w.bannerTex[ban]; w.bannerMat.needsUpdate = true; }
    // crowd: more fans on their feet when the action is close
    let hype = 0.25;
    for (const t of race.trucks) if (t.y < 90) hype += 0.25;
    if (race.leaderDoneT >= 0 || (race.phase === 'run' && race.raceTime < 3)) hype += 1;
    const tick = Math.floor(race.time * 4);
    w.crowd.offset.y = hash2(tick, 1, 3) < Math.min(0.9, hype * 0.4) ? 0.5 : 0;
    w.crowd.offset.x = (tick % 2) * 0.01;
  }

  // ---------- cameras ----------
  const cams = {
    iso: null, top: null, chase: [], fp: [],
  };
  function isoCam() {
    if (!cams.iso) cams.iso = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3000);
    return cams.iso;
  }
  function topCam() {
    if (!cams.top) cams.top = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3000);
    return cams.top;
  }
  function perspCam(list, k, fov) {
    if (!list[k]) list[k] = new THREE.PerspectiveCamera(fov, 1, 0.4, 2400);
    return list[k];
  }

  function placeOrtho(cam, aspect, mode) {
    if (mode === 'iso') {
      const halfW = 222, halfH = halfW / aspect;
      Object.assign(cam, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
      const el = 0.62, d = 900;
      const tgt = new THREE.Vector3(WORLD_W / 2 - 4, 0, WORLD_H / 2 + 6);
      cam.position.set(tgt.x + Math.cos(el) * 0.7071 * d, Math.sin(el) * d, tgt.z + Math.cos(el) * 0.7071 * d);
      cam.lookAt(tgt);
    } else {
      const halfW = 206, halfH = halfW / aspect;
      Object.assign(cam, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
      const tgt = new THREE.Vector3(WORLD_W / 2, 0, WORLD_H / 2 + 6);
      cam.position.set(tgt.x, 800, tgt.z + 190);
      cam.lookAt(tgt);
    }
    cam.updateProjectionMatrix();
  }

  // height of a bridge deck underside above (x, y), if there is one
  function deckAbove(track, x, y) {
    for (const c of track.crossings) {
      const span = Math.ceil(c.D / track.sp) + 12;
      let best = c.up, bd = 1e9;
      for (let k = -span; k <= span; k++) {
        const i = (c.up + k + track.N) % track.N;
        const d = (track.cx[i] - x) ** 2 + (track.cy[i] - y) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      const lat = Math.abs((x - track.cx[best]) * -track.ty[best] + (y - track.cy[best]) * track.tx[best]);
      if (lat < track.halfW + 6 && Math.abs(track.sRel(c, best, x, y)) < c.D + 6) return c.BH - 2.5;
    }
    return Infinity;
  }

  function placeChase(cam, m, t, dt, snap, track) {
    const c = Math.cos(t.h), s = Math.sin(t.h);
    const p = m.root.position;
    const want = new THREE.Vector3(p.x - c * 30, p.y + 13, p.z - s * 30);
    if (!track.upperCrossing(t.idx)) {
      // under a bridge: keep the camera (and the line to the truck) below the deck
      const roof = Math.min(deckAbove(track, want.x, want.z), deckAbove(track, p.x - c * 14, p.z - s * 14), deckAbove(track, p.x, p.z));
      if (roof < Infinity) want.y = Math.min(want.y, roof - 2.5);
    }
    if (snap || !cam.userData.init) { cam.position.copy(want); cam.userData.init = true; }
    else cam.position.lerp(want, Math.min(1, dt * 5));
    cam.lookAt(p.x + c * 14, p.y + 4, p.z + s * 14);
  }

  function placeFp(cam, m) {
    m.root.updateMatrixWorld(true);
    m.eye.getWorldPosition(cam.position);
    const q = new THREE.Quaternion();
    m.eye.getWorldQuaternion(q);
    cam.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.1));
  }

  // ---------- render ----------
  let lastT = 0;
  function render(race, opts = {}) {
    views.length = 0;
    if (!ok) return false;
    const now = performance.now();
    const ms = now - (lastT || now);
    const dt = Math.min(0.05, ms / 1000);
    lastT = now;
    const w = attach(race);
    applyQuality(w);
    governQuality(ms, w);
    syncDynamic(w, race, dt);
    renderer.setScissorTest(false);
    renderer.setClearColor(0x0d0b10, 1);
    renderer.clear();
    const top = opts.noHud ? 0 : 20;
    const mode = View.mode;
    const humans = race.trucks.filter(t => t.human).sort((a, b) => a.player - b.player);
    const focus = humans.length ? humans : [race.standings()[0]];
    const rects = [];
    if (mode === 'iso' || mode === 'top' || focus.length === 1) rects.push({ x: 0, y: top, w: WORLD_W, h: WORLD_H - top, truck: focus[0] });
    else {
      const h = Math.floor((WORLD_H - top - 2) / 2);
      rects.push({ x: 0, y: top, w: WORLD_W, h, truck: focus[0] }, { x: 0, y: top + h + 2, w: WORLD_W, h: WORLD_H - top - h - 2, truck: focus[1] });
    }
    const size = renderer.getSize(new THREE.Vector2());
    const k = size.x / WORLD_W;
    const shake = race.shake && !opts.noOverlay ? race.shake * 0.35 : 0;
    rects.forEach((r, i) => {
      const aspect = r.w / r.h;
      let cam;
      const m = race.meshes[race.trucks.indexOf(r.truck)];
      if (mode === 'iso' || mode === 'top') { cam = mode === 'iso' ? isoCam() : topCam(); placeOrtho(cam, aspect, mode); }
      else if (mode === 'chase') { cam = perspCam(cams.chase, i, 58); cam.aspect = aspect; cam.updateProjectionMatrix(); placeChase(cam, m, r.truck, dt, opts.snap, race.track); }
      else {
        cam = perspCam(cams.fp, i, 2 * Math.atan(Math.tan(42 * Math.PI / 180) / aspect) * 180 / Math.PI);
        cam.aspect = aspect; cam.updateProjectionMatrix(); placeFp(cam, m);
      }
      if (shake) { cam.position.x += (Math.random() - 0.5) * shake; cam.position.y += (Math.random() - 0.5) * shake; }
      // particle point size: pixels per world unit
      const vh = r.h * k;
      const ortho = cam.isOrthographicCamera;
      const scale = ortho ? vh / (cam.top - cam.bottom) : vh / (2 * Math.tan(cam.fov * Math.PI / 360));
      for (const pts of [race.particles3d.normal, race.particles3d.glow]) { pts.material.uniforms.scale.value = scale; pts.material.uniforms.ortho.value = ortho ? 1 : 0; }
      // own truck hidden from its own cockpit roof? keep hood visible: nothing to hide
      const x = Math.round(r.x * k), y = Math.round(size.y - (r.y + r.h) * k), wpx = Math.round(r.w * k), hpx = Math.round(r.h * k);
      w.scene.fog = ortho ? null : w.fog;
      for (const t of w.frontTowers) t.visible = !ortho;
      renderer.setViewport(x, y, wpx, hpx);
      renderer.setScissor(x, y, wpx, hpx);
      renderer.setScissorTest(true);
      const own = mode === 'fp' ? m : null;
      if (own) own.cabin.forEach(c => { c.visible = false; });
      renderer.render(w.scene, cam);
      if (own) own.cabin.forEach(c => { c.visible = true; });
      views.push({ rect: r, cam, truck: r.truck, mode });
    });
    renderer.setScissorTest(false);
    return true;
  }

  // free a race's trucks, pickups, particles and terrain texture
  function release(race) {
    if (!race || !ok) return;
    const w = race.track.world3d;
    if (w && w.race === race) { w.dynamic.clear(); w.race = null; }
    for (const m of race.meshes || []) dispose(m.root);
    for (const m of (race.pickupMeshes || new Map()).values()) dispose(m);
    if (race.particles3d) { dispose(race.particles3d.normal); dispose(race.particles3d.glow); }
    if (race.terrainTex) race.terrainTex.dispose();
    race.meshes = race.pickupMeshes = race.particles3d = race.terrainTex = null;
  }

  function clear() {
    if (!ok) return;
    renderer.setScissorTest(false);
    renderer.setClearColor(0x0d0b10, 1);
    renderer.clear();
    views.length = 0;
  }

  // world point -> overlay coordinates (400x300) in the first view
  function project(x, y, h, viewIndex = 0) {
    const v = views[viewIndex];
    if (!v) return null;
    const p = new THREE.Vector3(x, h, y).project(v.cam);
    if (p.z > 1 || p.z < -1) return null;
    return [v.rect.x + (p.x + 1) / 2 * v.rect.w, v.rect.y + (1 - p.y) / 2 * v.rect.h];
  }

  return { init, resize, render, clear, release, project, views, get ok() { return ok; } };
})();
