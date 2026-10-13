# Iron Dirt

A fan-made clone of the 1989 arcade game *Ivan "Ironman" Stewart's Super Off Road*: stadium off-road racing with four trucks, single-screen dirt tracks, jumps, nitro and a speed shop between races.

Plain HTML5 Canvas and JavaScript, no build step and no dependencies. All graphics are drawn in code and all sound is synthesized with the Web Audio API.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
npx serve .
```

| | Steer | Gas | Reverse | Nitro |
|---|---|---|---|---|
| Player 1 | ← → | ↑ | ↓ | Right Shift, Enter or Space |
| Player 2 | A D | W | S | Q or Left Shift |

In one-player mode either set works. `P` pauses, `M` toggles sound. On a phone, touch buttons appear and the gas is held for you.

## Rules

- Four trucks race four laps: red (P1), blue (P2 or CPU), yellow (CPU) and the grey **Ironman** (the boss CPU).
- Finishing last costs one of your three credits. Lose all three and it's game over.
- Grab nitro canisters and money bags on the track.
- Prize money per race: $100,000 / $60,000 / $30,000 / $10,000.
- In the speed shop, buy nitros ($10,000) and five levels each of tires, shocks, acceleration and top speed.
- A season is eight tracks. Each new season mirrors and/or reverses the tracks, and the CPU drivers get faster and better equipped.

## Code

| File | What it does |
|---|---|
| `src/tracks.js` | Track layouts: spline control points plus hills, jumps, moguls, mud and water |
| `src/track.js` | Builds a track: wall mask, distance field for collisions, heightmap, lap index, background art |
| `src/truck.js` | Truck sprites (pseudo-3D boxes rendered to 32 angles) and arcade physics |
| `src/ai.js` | CPU drivers |
| `src/race.js` | A race: laps, pickups, particles, HUD |
| `src/game.js` | Title, career, results, speed shop, seasons, game over |
| `src/audio.js` | Engine sounds, effects and chiptune music |
| `src/font.js` | 5x7 bitmap font |
