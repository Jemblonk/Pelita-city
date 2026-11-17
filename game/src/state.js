// The single source of truth: one state object `G`, built by createState,
// mutated only by the update systems. Rendering never writes game state
// (visual-only animation timers live on the entities themselves).
import { BLOCK, CAR_MAX_SPEED, CITY_SEED, DAY_LEN, PLAYER_HP, WORLD } from './config.js';
import { generateCity, isRoad } from './city.js';
import { intRange, mulberry32, pick, range } from './util.js';

export const CAR_COLORS = ['#b8442f', '#3f6db3', '#c8a13c', '#4d8a52', '#8a8f96', '#6a4a8a', '#c96a2e', '#3d8a8a'];
export const PED_SHIRTS = ['#d8b13c', '#4a7ab8', '#b84a6a', '#5aa06a', '#8a6ab8', '#c96a4a', '#4ab8a0', '#a0a8b0'];
export const MISSION_NAMES = ['Paket Kilat', 'Gang Berisik', 'Pelarian Besar'];

let NEXT_ID = 1;

export function newPlayer(x, y) {
  return {
    id: NEXT_ID++,
    kind: 'player',
    x,
    y,
    angle: -Math.PI / 2,
    hp: PLAYER_HP,
    maxHp: PLAYER_HP,
    cash: 60,
    ammo: 24,
    car: null, // car object while driving
    walkPhase: 0,
    hurtT: 0,
    punchT: 0,
    punchAnim: 0,
    shootT: 0,
    speed: 0,
  };
}

export function newCar(x, y, angle, opts = {}) {
  return {
    id: NEXT_ID++,
    kind: 'car',
    x,
    y,
    angle,
    speed: 0,
    steer: 0,
    color: opts.color || '#b8442f',
    body: opts.body || 'sedan',
    parked: !!opts.parked,
    traffic: opts.traffic || null, // {heading, cruise, waitT, lane}
    driver: opts.driver || null, // 'player' | 'cop' | null
    hp: 100,
    smoke: 0,
    brakeLight: 0,
    honkT: 0,
    stolen: false,
    target: false, // mission-3 target car
  };
}

export function newPed(x, y, rng) {
  return {
    id: NEXT_ID++,
    kind: 'ped',
    x,
    y,
    angle: range(rng, 0, Math.PI * 2),
    speed: 0,
    tx: x,
    ty: y,
    state: 'idle', // idle | walk | flee | down
    timer: range(rng, 0.5, 2.5),
    walkPhase: range(rng, 0, 6),
    shirt: pick(rng, PED_SHIRTS),
    skin: pick(rng, ['#e8b98a', '#c98d5e', '#8a5f3c', '#f0cba8']),
    scared: 0,
  };
}

export function newEnemy(x, y, kind, rng) {
  return {
    id: NEXT_ID++,
    kind,
    x,
    y,
    angle: range(rng, 0, Math.PI * 2),
    hp: kind === 'shooter' ? 50 : 60,
    maxHp: kind === 'shooter' ? 50 : 60,
    speed: 0,
    cooldown: range(rng, 0.2, 0.8),
    strafeDir: rng() < 0.5 ? -1 : 1,
    strafeT: range(rng, 1, 2.5),
    alerted: false,
    walkPhase: range(rng, 0, 6),
    hurtT: 0,
    dead: false,
    shirt: kind === 'shooter' ? '#3a3f4a' : '#7a2e2e',
  };
}

export function spawnParticle(G, x, y, opts = {}) {
  if (G.particles.length > 420) G.particles.splice(0, G.particles.length - 420);
  G.particles.push({
    x,
    y,
    vx: opts.vx ?? range(G.rng, -60, 60),
    vy: opts.vy ?? range(G.rng, -60, 60),
    life: opts.life ?? range(G.rng, 0.3, 0.7),
    maxLife: opts.life ?? 0.7,
    color: opts.color || '#d8d8d8',
    size: opts.size ?? range(G.rng, 2, 4.5),
    drag: opts.drag ?? 3,
  });
}

export function burst(G, x, y, color, n, speed) {
  for (let i = 0; i < n; i += 1) {
    const a = range(G.rng, 0, Math.PI * 2);
    const s = range(G.rng, speed * 0.3, speed);
    spawnParticle(G, x, y, {
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      color,
      life: range(G.rng, 0.25, 0.6),
    });
  }
}

export function addToast(G, text) {
  G.toasts.push({ text, t: 3.2 });
  if (G.toasts.length > 4) G.toasts.shift();
}

export function addWanted(G, n, reason) {
  const before = G.wanted;
  G.wanted = Math.max(0, Math.min(5, G.wanted + n));
  G.unseenT = 0;
  if (G.wanted > before && reason) addToast(G, reason);
  if (G.wanted > before && G.wanted >= 1) G.lastCrimeT = G.time;
}

/** Daylight factor 0..1 from timeOfDay (0 = midnight, 0.5 = noon). */
export function daylight(timeOfDay) {
  // Sun elevation peaks at 0.5, bottoms at 0.0/1.0; smooth cosine curve.
  const sun = Math.cos((timeOfDay - 0.5) * Math.PI * 2);
  return Math.max(0, Math.min(1, 0.5 + sun * 0.62));
}

export function createState(seed) {
  const rng = mulberry32(seed >>> 0);
  const city = generateCity(CITY_SEED);
  const G = {
    seed,
    rng,
    city,
    time: 0,
    timeOfDay: 0.32, // mid-morning
    dayLen: DAY_LEN,
    mode: 'title', // title | play | pause | dialog | busted | help
    player: newPlayer(4 * BLOCK, 4 * BLOCK + 120), // on the road, not in a block
    cars: [],
    peds: [],
    cops: [],
    enemies: [],
    bullets: [],
    particles: [],
    pickups: [],
    wanted: 0,
    unseenT: 0,
    lastSeenX: undefined, // last position any cop saw the player
    lastSeenY: undefined,
    lastCrimeT: -999,
    mission: { idx: 0, stage: 'idle', timer: 0, data: {}, done: [false, false, false] },
    dialog: null,
    sideJob: null,
    sideJobCooldown: 0,
    camera: { x: WORLD / 2, y: WORLD / 2, shake: 0 },
    toasts: [],
    stats: { kills: 0, carsStolen: 0, missionsDone: 0, shotsFired: 0, pedsHit: 0 },
    objective: 'Press Enter to start. WASD to walk, E to enter a car.',
    marker: null,
    bustedT: 0,
    helpT: 18, // controls hint countdown
    muted: false,
    saveFlash: 0,
    hornT: 0,
  };
  spawnWorld(G);
  return G;
}

/** Fill a fresh state with traffic, parked cars, pedestrians and pickups. */
export function spawnWorld(G) {
  const rng = G.rng;
  // Traffic: cars cruising the roads on axis-aligned headings.
  const headings = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  for (let i = 0; i < 11; i += 1) {
    const horizontal = rng() < 0.5;
    const line = intRange(rng, 1, 7) * BLOCK;
    const along = range(rng, 120, WORLD - 120);
    const x = horizontal ? along : line;
    const y = horizontal ? line : along;
    const heading = horizontal ? (rng() < 0.5 ? 0 : Math.PI) : (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    const car = newCar(x, y, heading, {
      color: pick(rng, CAR_COLORS),
      body: pick(rng, ['sedan', 'sedan', 'van', 'taxi', 'sport']),
      traffic: { heading, cruise: range(rng, 120, 185), waitT: 0, lane: 15 },
    });
    car.speed = car.traffic.cruise;
    G.cars.push(car);
  }
  // Parked cars: in lots, plus a few along road edges.
  let parked = 0;
  for (const lot of G.city.lots) {
    for (const slot of lot.slots) {
      if (rng() < 0.55 && parked < 12) {
        G.cars.push(newCar(slot.x, slot.y, slot.angle, {
          color: pick(rng, CAR_COLORS),
          body: pick(rng, ['sedan', 'van', 'sport', 'taxi']),
          parked: true,
        }));
        parked += 1;
      }
    }
  }
  let tries = 0;
  while (parked < 10 && tries < 60) {
    tries += 1;
    const x = range(rng, 100, WORLD - 100);
    const y = Math.round(range(rng, 1, 7)) * BLOCK + 26;
    if (!isRoad(x, y)) continue;
    G.cars.push(newCar(x, y, rng() < 0.5 ? 0 : Math.PI, {
      color: pick(rng, CAR_COLORS),
      parked: true,
    }));
    parked += 1;
  }
  // Pedestrians wandering sidewalks and blocks.
  for (let i = 0; i < 15; i += 1) {
    let x = 0;
    let y = 0;
    let ok = false;
    for (let t = 0; t < 20 && !ok; t += 1) {
      x = range(rng, 80, WORLD - 80);
      y = range(rng, 80, WORLD - 80);
      ok = !isRoad(x, y) && !pointInSolid(G.city.solids, x, y, 20);
    }
    if (ok) G.peds.push(newPed(x, y, rng));
  }
  // Pickups scattered around the city.
  const pickupSpots = [
    { kind: 'ammo', amount: 18 },
    { kind: 'ammo', amount: 18 },
    { kind: 'health', amount: 40 },
    { kind: 'health', amount: 40 },
    { kind: 'cash', amount: 35 },
    { kind: 'cash', amount: 50 },
  ];
  for (const p of pickupSpots) {
    let x = 0;
    let y = 0;
    let ok = false;
    for (let t = 0; t < 20 && !ok; t += 1) {
      x = range(rng, 120, WORLD - 120);
      y = range(rng, 120, WORLD - 120);
      ok = !pointInSolid(G.city.solids, x, y, 24);
    }
    if (ok) G.pickups.push({ x, y, kind: p.kind, amount: p.amount, ttl: 1e9, bob: range(rng, 0, 6) });
  }
  // A few ambient thugs near the south-east blocks for free-roam combat.
  const alley = { x: 6 * BLOCK + 200, y: 6 * BLOCK + 200 };
  for (let i = 0; i < 3; i += 1) {
    G.enemies.push(newEnemy(alley.x + range(rng, -70, 70), alley.y + range(rng, -70, 70), i === 2 ? 'shooter' : 'melee', rng));
  }
}

function pointInSolid(solids, x, y, pad) {
  for (const s of solids) {
    if (x > s.x - pad && x < s.x + s.w + pad && y > s.y - pad && y < s.y + s.h + pad) return true;
  }
  return false;
}

export { CAR_MAX_SPEED };
