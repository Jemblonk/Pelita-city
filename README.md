# Pelita-city

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/Jemblonk/Pelita-city/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/Jemblonk/Pelita-city/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Pelita City is an open-world crime game in the spirit of GTA 6: a procedurally built city you explore on foot and by car, with traffic, pedestrians, car theft, a wanted system with road-following police pursuit, melee and shooter combat, three story missions plus side jobs, a HUD with minimap, saving, and a full day/night cycle — all in dependency-free Canvas 2D, playable offline in a desktop browser.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. Or open `game/index.html` directly from disk — the game makes zero network requests.

## Controls

| Keys | Action |
|---|---|
| W A S D / Arrows | Walk, or drive when in a car (W gas, S brake/reverse) |
| Shift | Run on foot |
| E | Enter / exit the nearest car (stealing one earns a wanted star) |
| Mouse + Click | Aim and shoot |
| F | Punch |
| H | Horn |
| N | Take a side job (taxi fare / cash collection) |
| Space / Enter | Advance dialog |
| P or Esc | Pause |
| M | Mute sound |

## What is in the game

- **Open city** — a 3200×3200 procedurally generated grid city (fixed seed, so the same city every load): roads, intersections, crosswalks, buildings with lit windows, parks, trees, lamps and parking lots.
- **Traffic & pedestrians** — cars cruise the roads, keep distance and turn at intersections; pedestrians wander the sidewalks, flee gunfire, and can be run over (which draws police attention).
- **Steal & drive** — take any parked or traffic car. Driving has acceleration, steering, braking, drift smoke and crash damage.
- **Wanted system & police** — crimes earn stars (up to 5). Police spawn in proportion, pursue along the road grid using BFS waypoints, cut across only with a clear line of sight, wait at intersections when you hide inside a block, and recover to the road when knocked off. Break line of sight to cool down; get caught and you are busted.
- **Combat** — punch up close, shoot with the mouse, dodge enemy bullets. Melee thugs close in and swing; shooters hold range, strafe, and fire only with a clear line of sight. Enemies drop cash and ammo.
- **Story** — three missions for Bos Darma and Sari (a timed delivery, clearing the alley gang, and stealing a hot car and losing the cops), plus random side jobs.
- **HUD & minimap** — health, cash, ammo, wanted stars, objective tracker with a beacon and edge arrow, and a live circular minimap.
- **Day/night cycle** — a 240-second cycle with a night overlay, glowing street lamps, lit windows and car headlight cones.
- **Save** — progress autosaves when a mission completes and can be saved from the pause menu; Continue on the title screen picks up where you left off.

## Layout

```
game/
├── index.html          — canvas + stylesheet + module entry
├── style.css           — fullscreen layout
└── src/
    ├── main.js         — boot, fixed-step loop, screens, save wiring
    ├── config.js       — world geometry + tuning constants
    ├── util.js         — math helpers + seeded RNG
    ├── city.js         — procedural city generation + collision
    ├── nav.js          — BFS road paths + line of sight
    ├── state.js        — the one state object + entity factories
    ├── update.js       — master update, camera, busted/respawn
    ├── player.js       — walking, driving, stealing, pickups
    ├── traffic.js      — traffic AI + pedestrians
    ├── police.js       — pursuit AI + wanted decay
    ├── combat.js       — punch, gun, bullets, enemy AI
    ├── missions.js     — story, dialog, missions, side jobs
    ├── render.js       — world, entities, lighting, HUD, minimap, menus
    ├── shots.js        — deterministic ?shot= screenshot scenes
    ├── input.js        — keyboard + mouse
    ├── audio.js        — procedural WebAudio sound (no audio files)
    └── save.js         — guarded localStorage save/load
```

Screenshot scenes: `?shot=start`, `?shot=play`, `?shot=chase`, `?shot=mission` (each with `&seed=N`) stage deterministic frames for capture.

---

Entered on [make.fun](https://make.fun/?ref=ptjgbdbh&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards
