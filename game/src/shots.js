// Deterministic screenshot scenes behind ?shot=start|play|chase|mission.
// Each scene plays the real rules forward from a fresh seeded world for a
// fixed number of steps, steered by a small autopilot, so the captured frame
// is what real play looks like — and the same seed always stages the same
// frame. Unknown names fall back to the title scene.
import { BLOCK, STEP } from './config.js';
import { findRoadPath } from './nav.js';
import { newEnemy } from './state.js';
import { updateGame } from './update.js';
import { angDiff, dist } from './util.js';

const PLAY_SECONDS = 20;
const CHASE_SECONDS = 22;
const MISSION_SECONDS = 5;

function stubInput() {
  return {
    keys: new Set(),
    pressed: new Set(),
    mouse: { x: 640, y: 360, down: false, clicked: false, rightDown: false },
  };
}

/** Drive the player's car along the road grid toward far corners. */
function makeDriver() {
  const corners = [
    { x: 7 * BLOCK, y: 7 * BLOCK },
    { x: 1 * BLOCK, y: 6 * BLOCK },
    { x: 6 * BLOCK, y: 1 * BLOCK },
    { x: 2 * BLOCK, y: 2 * BLOCK },
  ];
  let cornerI = 0;
  let path = [];
  let pathI = 0;
  return function drive(G, input) {
    const car = G.player.car;
    if (!car) return;
    if (pathI >= path.length) {
      const target = corners[cornerI % corners.length];
      cornerI += 1;
      path = findRoadPath(car.x, car.y, target.x, target.y);
      if (path.length === 0) path = [target];
      pathI = 0;
    }
    while (pathI < path.length && dist(car.x, car.y, path[pathI].x, path[pathI].y) < 60) {
      pathI += 1;
    }
    if (pathI >= path.length) return;
    const wp = path[pathI];
    const want = Math.atan2(wp.y - car.y, wp.x - car.x);
    const diff = angDiff(car.angle, want);
    input.keys.add('KeyW');
    if (diff > 0.08) input.keys.add('KeyD');
    else if (diff < -0.08) input.keys.add('KeyA');
    // Brake for hairpins so the car turns instead of grinding walls.
    if (Math.abs(diff) > 1.15 && Math.abs(car.speed) > 210) {
      input.keys.add('KeyS');
    }
  };
}

/** Put the player behind the wheel of a car placed on the road grid. */
function placeInCar(G, x, y, heading) {
  const car = G.cars.find((c) => c.parked) || G.cars[0];
  car.x = x;
  car.y = y;
  car.angle = heading;
  car.speed = 0;
  car.parked = false;
  car.traffic = null;
  car.driver = 'player';
  G.player.car = car;
  G.player.x = x;
  G.player.y = y;
  G.player.angle = heading;
  G.camera.x = x;
  G.camera.y = y;
  return car;
}

function runSteps(G, seconds, steer) {
  const input = stubInput();
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    input.keys.clear();
    input.pressed.clear();
    if (steer) steer(G, input);
    updateGame(G, input, STEP, null);
    if (G.mode !== 'play') break; // busted mid-staging: keep the frame anyway
  }
}

export function stageShot(name, G) {
  G.viewW = 1280;
  G.viewH = 720;
  if (name === 'play') {
    G.mode = 'play';
    G.timeOfDay = 0.34;
    G.objective = 'Pick up the package at the north-west marker.';
    G.marker = { x: 2 * BLOCK, y: 3 * BLOCK, label: 'PICKUP' };
    placeInCar(G, 4 * BLOCK, 4 * BLOCK, 0);
    const drive = makeDriver();
    runSteps(G, PLAY_SECONDS, drive);
    G.mode = 'play';
    return { screen: 'play' };
  }
  if (name === 'chase') {
    G.mode = 'play';
    G.timeOfDay = 0.72; // dusk: headlights and lamp glow show up
    G.wanted = 3;
    G.lastCrimeT = 0;
    G.objective = 'Lose the cops and reach the hideout!';
    G.marker = { x: 7 * BLOCK, y: 1 * BLOCK, label: 'HIDEOUT' };
    placeInCar(G, 4 * BLOCK, 4 * BLOCK, 0);
    const drive = makeDriver();
    runSteps(G, CHASE_SECONDS, drive);
    // Pull two pursuers onto the player's road, just behind the car, so the
    // chase is visible in frame (natural spawns may still be blocks away).
    const car = G.player.car;
    if (car && G.cops.length > 0) {
      const back = car.angle + Math.PI;
      const spots = [
        { d: 290, side: 0, speed: 280 },
        { d: 380, side: 18, speed: 260 },
      ];
      for (let i = 0; i < Math.min(spots.length, G.cops.length); i += 1) {
        const cop = G.cops[i];
        const s = spots[i];
        cop.x = car.x + Math.cos(back) * s.d - Math.sin(back) * s.side;
        cop.y = car.y + Math.sin(back) * s.d + Math.cos(back) * s.side;
        cop.angle = car.angle;
        cop.speed = s.speed;
        cop.path = [];
        cop.pathI = 0;
        cop.repathT = 0;
      }
      runSteps(G, 1.2, drive);
    }
    G.mode = 'play';
    return { screen: 'play' };
  }
  if (name === 'mission') {
    G.mode = 'play';
    G.timeOfDay = 0.36;
    // Mission 2, mid-fight: the player on foot at the alley, gang alerted.
    const alley = { x: 6 * BLOCK + 200, y: 6 * BLOCK + 200 };
    G.player.x = alley.x - 130;
    G.player.y = alley.y + 40;
    G.player.angle = Math.atan2(alley.y - G.player.y, alley.x - G.player.x);
    G.camera.x = G.player.x;
    G.camera.y = G.player.y;
    G.mission.idx = 1;
    G.mission.stage = 'fight';
    G.objective = 'Clear the alley — defeat all 4 gang members!';
    G.marker = { x: alley.x, y: alley.y, label: 'FIGHT' };
    const spots = [
      { dx: -60, dy: -40, kind: 'melee' },
      { dx: 60, dy: -50, kind: 'melee' },
      { dx: -50, dy: 60, kind: 'shooter' },
      { dx: 70, dy: 50, kind: 'shooter' },
    ];
    for (const s of spots) {
      const e = newEnemy(alley.x + s.dx, alley.y + s.dy, s.kind, G.rng);
      e.alerted = true;
      e.mission = true;
      e.cooldown = 0.4;
      G.enemies.push(e);
    }
    runSteps(G, MISSION_SECONDS, null);
    G.mode = 'play';
    return { screen: 'play' };
  }
  // 'start' and anything else: the title screen.
  G.mode = 'title';
  return { screen: 'title' };
}
