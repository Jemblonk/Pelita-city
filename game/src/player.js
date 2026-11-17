// The player: walking, driving, stealing cars, picking things up. Combat
// triggers (punch / shoot) live here; the damage itself lives in combat.js.
import {
  CAR_ACCEL, CAR_BRAKE, CAR_GRIP, CAR_MAX_SPEED, CAR_REVERSE_MAX, CAR_TURN,
  PLAYER_R, RUN_SPEED, WALK_SPEED,
} from './config.js';
import { collideCircle } from './city.js';
import { addToast, addWanted, burst, spawnParticle } from './state.js';
import { clamp, dist } from './util.js';
import { doPunch, doShoot } from './combat.js';
import { moveAxis, wasPressed } from './input.js';

export function nearestCar(G, x, y, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const car of G.cars) {
    if (car.driver === 'cop') continue;
    const d = dist(x, y, car.x, car.y);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

/** Screen mouse -> world coordinates, using the camera and view size. */
export function mouseWorld(G, input) {
  const w = G.viewW || 1280;
  const h = G.viewH || 720;
  return {
    x: G.camera.x + (input.mouse.x - w / 2),
    y: G.camera.y + (input.mouse.y - h / 2),
  };
}

function enterCar(G, car, audio) {
  const p = G.player;
  if (car.driver === 'cop') return;
  const stealing = car.parked || car.traffic !== null;
  car.driver = 'player';
  car.parked = false;
  car.traffic = null;
  p.car = car;
  p.x = car.x;
  p.y = car.y;
  if (stealing && !car.stolen) {
    car.stolen = true;
    G.stats.carsStolen += 1;
    addWanted(G, 1, 'Car stolen! The police are after you.');
    addToast(G, 'Stolen car — 1 star.');
  } else {
    addToast(G, 'In the car. W/S throttle & brake, A/D steer.');
  }
  if (audio) audio.door();
}

function exitCar(G, audio) {
  const p = G.player;
  const car = p.car;
  if (!car) return;
  car.driver = null;
  // Step out on the left side of the car.
  const side = car.angle - Math.PI / 2;
  const spot = collideCircle(
    car.x + Math.cos(side) * 30,
    car.y + Math.sin(side) * 30,
    PLAYER_R,
    G.city.solids,
  );
  p.x = spot.x;
  p.y = spot.y;
  p.angle = car.angle;
  p.car = null;
  if (audio) audio.door();
}

function driveCar(G, car, input, dt, audio) {
  const axis = moveAxis(input);
  const forward = -axis.y; // W = +1
  const steerInput = axis.x;
  // Steering: full lock at low speed, gentler at speed.
  const speedNorm = clamp(Math.abs(car.speed) / CAR_MAX_SPEED, 0, 1);
  const steerAuthority = CAR_TURN * (1 - speedNorm * 0.55);
  car.steer += (steerInput - car.steer) * Math.min(1, dt * 8);
  if (Math.abs(car.speed) > 4) {
    car.angle += car.steer * steerAuthority * dt * (car.speed >= 0 ? 1 : -1);
  }
  if (forward > 0) {
    car.speed += CAR_ACCEL * forward * dt;
  } else if (forward < 0) {
    if (car.speed > 5) car.speed -= CAR_BRAKE * dt; // brake
    else car.speed += CAR_ACCEL * 0.6 * forward * dt; // reverse
  } else {
    // Rolling drag.
    car.speed -= car.speed * 0.7 * dt;
    if (Math.abs(car.speed) < 3) car.speed = 0;
  }
  car.speed = clamp(car.speed, -CAR_REVERSE_MAX, CAR_MAX_SPEED);
  car.brakeLight = forward < 0 && car.speed > 5 ? 1 : Math.max(0, car.brakeLight - dt * 4);

  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  const fixed = collideCircle(nx, ny, 21, G.city.solids);
  const hitWall = fixed.x !== nx || fixed.y !== ny;
  if (hitWall && Math.abs(car.speed) > 90) {
    const strength = Math.abs(car.speed) / CAR_MAX_SPEED;
    car.hp -= strength * 22;
    car.smoke = Math.min(1, car.smoke + strength * 0.5);
    G.camera.shake = Math.min(14, G.camera.shake + strength * 10);
    burst(G, fixed.x, fixed.y, '#e8c85a', 10, 190);
    burst(G, fixed.x, fixed.y, '#9aa0a8', 8, 130);
    if (audio) audio.crash(strength);
    if (car.hp <= 0) {
      car.hp = 0;
      addToast(G, 'Car badly damaged!');
    }
  }
  if (hitWall) car.speed *= 0.35;
  car.x = fixed.x;
  car.y = fixed.y;

  // Tire smoke when cornering hard at speed.
  if (Math.abs(car.steer) > 0.7 && Math.abs(car.speed) > 260 && G.rng() < 0.5) {
    spawnParticle(G, car.x - Math.cos(car.angle) * 18, car.y - Math.sin(car.angle) * 18, {
      vx: -Math.cos(car.angle) * 30 + (G.rng() - 0.5) * 40,
      vy: -Math.sin(car.angle) * 30 + (G.rng() - 0.5) * 40,
      color: '#c8c8c8',
      life: 0.5,
      size: 4,
    });
  }
  // Engine smoke when damaged.
  if (car.smoke > 0.35 && G.rng() < car.smoke * 0.4) {
    spawnParticle(G, car.x + Math.cos(car.angle) * 20, car.y + Math.sin(car.angle) * 20, {
      vx: (G.rng() - 0.5) * 30,
      vy: -40 - G.rng() * 30,
      color: '#555550',
      life: 0.8,
      size: 5,
    });
  }
  if (audio) audio.engine(clamp(Math.abs(car.speed) / CAR_MAX_SPEED, 0, 1));
}

function walkPlayer(G, input, dt) {
  const p = G.player;
  const axis = moveAxis(input);
  const running = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
  const speed = running ? RUN_SPEED : WALK_SPEED;
  const nx = p.x + axis.x * speed * dt;
  const ny = p.y + axis.y * speed * dt;
  const fixed = collideCircle(nx, ny, PLAYER_R, G.city.solids);
  p.x = fixed.x;
  p.y = fixed.y;
  p.speed = Math.hypot(fixed.x - (p.px ?? p.x), fixed.y - (p.py ?? p.y)) / Math.max(dt, 1e-4);
  p.px = p.x;
  p.py = p.y;
  if (axis.x !== 0 || axis.y !== 0) {
    p.angle = Math.atan2(axis.y, axis.x);
    p.walkPhase += dt * (running ? 11 : 8);
  }
}

function checkPickups(G, audio) {
  const p = G.player;
  for (let i = G.pickups.length - 1; i >= 0; i -= 1) {
    const pk = G.pickups[i];
    if (dist(p.x, p.y, pk.x, pk.y) > 30) continue;
    if (pk.kind === 'cash') {
      p.cash += pk.amount;
      addToast(G, `+$${pk.amount}`);
      if (audio) audio.cash();
    } else if (pk.kind === 'ammo') {
      p.ammo += pk.amount;
      addToast(G, `+${pk.amount} ammo`);
      if (audio) audio.pickup();
    } else if (pk.kind === 'health') {
      p.hp = Math.min(p.maxHp, p.hp + pk.amount);
      addToast(G, `+${pk.amount} HP`);
      if (audio) audio.pickup();
    }
    burst(G, pk.x, pk.y, pk.kind === 'cash' ? '#e8c85a' : pk.kind === 'ammo' ? '#c98a4a' : '#5ac86a', 8, 120);
    G.pickups.splice(i, 1);
  }
}

export function updatePlayer(G, input, dt, audio) {
  const p = G.player;
  p.punchT = Math.max(0, p.punchT - dt);
  p.shootT = Math.max(0, p.shootT - dt);
  p.punchAnim = Math.max(0, p.punchAnim - dt);
  p.hurtT = Math.max(0, p.hurtT - dt);

  if (p.car) {
    driveCar(G, p.car, input, dt, audio);
    p.x = p.car.x;
    p.y = p.car.y;
    p.angle = p.car.angle;
    if (wasPressed(input, 'KeyE')) exitCar(G, audio);
    if (wasPressed(input, 'KeyH') && audio) audio.horn();
  } else {
    walkPlayer(G, input, dt);
    if (audio) audio.stopEngine();
    if (wasPressed(input, 'KeyE')) {
      const car = nearestCar(G, p.x, p.y, 56);
      if (car) enterCar(G, car, audio);
    }
    // Aim on foot follows the mouse.
    const mw = mouseWorld(G, input);
    if (input.mouse.down || dist(p.x, p.y, mw.x, mw.y) > 30) {
      const aim = Math.atan2(mw.y - p.y, mw.x - p.x);
      if (input.mouse.down) p.angle = aim;
    }
  }

  // Combat triggers (both on foot and drive-by).
  if (wasPressed(input, 'KeyF') && p.punchT <= 0 && !p.car) {
    doPunch(G, audio);
  }
  if (input.mouse.down && p.shootT <= 0) {
    const mw = mouseWorld(G, input);
    doShoot(G, mw.x, mw.y, audio);
  }

  checkPickups(G, audio);
}
