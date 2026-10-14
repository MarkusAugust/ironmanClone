# Iron Dirt

A fan-made tribute to the stadium off-road arcade racers of the late 1980s: stadium off-road racing with four trucks, single-screen dirt tracks, jumps, nitro and a speed shop between races.

The stadium is a real 3D scene (Three.js): low-poly trucks, tire walls, grandstands, bridges and floodlight towers, lit by a sun that casts shadows. Four camera views, cycled with `V` or the VIEW button under the screen, even mid-race:

1. **Isometric** (default): the whole stadium as a diorama.
2. **Chase cam**: behind and above your truck. It stays under the deck when you drive beneath a bridge.
3. **Cockpit**: from the driver's seat, with a steering wheel that turns as you steer, a speedometer and a NITRO button that lights up while the boost burns.
4. **Top-down**: the classic arcade view, looking straight down.

With two players, chase cam and cockpit split the screen into a top half (P1) and a bottom half (P2).

Each track has its own light: daytime sun, sunset, or night under floodlights with headlights on. The stadium is alive with a jumping crowd, a flagman who signals the start, final lap and finish, and a start/finish gantry. Trucks kick up dust, sling mud that stains the track, spray water, spit nitro flames and throw sparks off the walls; hard landings shake the screen (off when your system asks for reduced motion).

The game logic runs in a flat 400x300 world with a height for every point. The 3D scene is drawn on a WebGL canvas; menus, HUD and the cockpit dashboard are drawn on a transparent 800x600 canvas on top. On a slow machine the 3D quality steps down by itself (lower resolution and smaller shadow maps first, then no sun shadows).

Plain JavaScript with no build step. The only library is Three.js (r149), included in `vendor/` under its MIT license. All textures are drawn in code and all sound is synthesized with the Web Audio API. It needs a browser with WebGL.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
npx serve .
```

Live: https://iron-dirt.netlify.app (once deployed; see below)

| | Steer | Gas | Reverse | Nitro |
|---|---|---|---|---|
| Player 1 | ← → | ↑ | ↓ | Right Shift, Enter or Space |
| Player 2 | A D | W | S | Q or Left Shift |

In one-player mode either set works. `V` switches view, `P` pauses, `M` toggles sound. On a phone, touch buttons appear and the gas is held for you.

## Rules

- Choose EASY, NORMAL or HARD on the title screen: it sets CPU strength, starting money and credits (5 / 3 / 2).
- On the gas through a corner the rear steps out into a power slide; better tires tame it. Trucks lean in corners and have some yaw inertia.
- CROSSROADS, MUD EIGHT and LEAPFROG are figure eights where one road climbs a ramp and crosses the other on a bridge (plank deck, railings, concrete pillars), and the other road runs underneath. There are no level crossings: trucks on the bridge and under it never meet.
- Four trucks race four laps: red (P1), blue (P2 or CPU), yellow (CPU) and the grey **Titan** (the boss CPU).
- Finishing last costs one of your three credits. Lose all three and it's game over.
- Grab nitro canisters and money bags on the track.
- Prize money per race: $100,000 / $60,000 / $30,000 / $10,000.
- In the speed shop, buy nitros ($10,000) and five levels each of tires, shocks, acceleration and top speed.
- Progress is saved automatically in the browser (localStorage) after every race and every purchase. CONTINUE on the title screen picks up in the speed shop before your next race. Game over deletes the save.
- A season is eight tracks. Each new season mirrors and/or reverses the tracks, and the CPU drivers get faster and better equipped.

## Code

| File | What it does |
|---|---|
| `src/tracks.js` | Track layouts: spline control points plus hills, jumps, moguls, mud and water |
| `src/track.js` | Builds a track: wall mask, distance fields for collisions, heightmap, bridges over crossings, lap index and the ground texture |
| `src/scene3d.js` | The 3D world in Three.js: terrain, tire walls, grandstands, bridges, gantry, flagman, lights, trucks, pickups, particles and the four cameras |
| `src/view.js` | Camera modes: isometric, chase cam, cockpit, top-down |
| `src/cockpit.js` | Cockpit overlay: dashboard, steering wheel, gauges and nitro light |
| `src/truck.js` | Truck models (stadium pickups built from boxes), HUD and shop icons, and arcade physics |
| `src/ai.js` | CPU drivers |
| `src/race.js` | A race: laps, pickups, HUD and overlays |
| `src/fx.js` | Particles: dust, mud, water, nitro flames, sparks, landing dust, screen shake |
| `src/mood.js` | Lighting per track: day, sunset, night with floodlights and headlights |
| `src/stadium.js` | Flagman signals, start/finish banners, confetti |
| `src/game.js` | Title, career, results, speed shop, seasons, game over |
| `src/audio.js` | Engine sounds, effects and chiptune music |
| `src/font.js` | 5x7 bitmap font |

## Deploy

It is a static site, so any static host works. `netlify.toml` tells Netlify to publish the repository root with no build command: connect the repository in Netlify (or drop `index.html` plus the `src` and `vendor` folders on https://app.netlify.com/drop) and it is live.
