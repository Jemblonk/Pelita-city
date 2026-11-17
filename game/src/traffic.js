// Ambient life: traffic cars cruising the road grid, and pedestrians
// wandering the sidewalks who flee gunfire and can be run over.
import { BLOCK, ROAD_W, WORLD } from './config.js';
import { collideCircle, isRoad, nearestNodePos, roadCenterNear } from './city.js';
import { addWanted, burst } from './state.js';
import { clamp, dist, range, turnToward } from './util.js';

const HEADINGS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

/** Snap an angle to the nearest axis heading. */
function axisHeading(a) {
  let best = HEADINGS[0];
  let bestD = Infinity;
  for (const h of HEADINGS) {
    const d = Math.abs(((a - h + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}

function carAhead(G, car, lookAhead) {
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  let nearest = Infinity;
  for (const other of G.cars) {
    if (other === car) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const along = dx * fx + dy * fy;
    if (along < 0 || along > lookAhead) continue;
    const side = Math.abs(-dx * fy + dy * fx);
    if (side < 34 && along < nearest) nearest = along;
  }
  // The player's car counts as an obstacle too.
  const p = G.player;
  if (p.car && p.car !== car) {
    const dx = p.car.x - car.x;
    const dy = p.car.y - car.y;
    const along = dx * fx + dy * fy;
    const side = Math.abs(-dx * fy + dy * fx);
    if (along > 0 && along < lookAhead && side < 34 && along < nearest) nearest = along;
  }
  return nearest;
}

function updateTrafficCar(G, car, dt) {
  const t = car.traffic;
  if (!t) return;
  // At an intersection, maybe pick a new heading (never a U-turn).
  const node = nearestNodePos(car.x, car.y);
  const atNode = dist(car.x, car.y, node.x, node.y) < 26;
  if (atNode && !t.turnedAt) {
    t.turnedAt = node.x + ',' + node.y;
    if (G.rng() < 0.45) {
      const options = HEADINGS.filter((h) => Math.abs(h - t.heading) > 0.01 && Math.abs(Math.abs(h - t.heading) - Math.PI) > 0.01);
      if (options.length > 0) t.heading = options[Math.floor(G.rng() * options.length)];
    }
  } else if (!atNode) {
    t.turnedAt = null;
  }
  // Near a world edge, turn back into the city.
  if (car.x < 130 && Math.cos(t.heading) < -0.5) t.heading = 0;
  if (car.x > WORLD - 130 && Math.cos(t.heading) > 0.5) t.heading = Math.PI;
  if (car.y < 130 && Math.sin(t.heading) < -0.5) t.heading = Math.PI / 2;
  if (car.y > WORLD - 130 && Math.sin(t.heading) > 0.5) t.heading = -Math.PI / 2;

  car.angle = turnToward(car.angle, t.heading, dt * 2.2);
  // Lane keeping: ease toward the road centre line plus a right-side offset.
  const horizontal = Math.abs(Math.cos(t.heading)) > 0.5;
  const laneTarget = horizontal
    ? Math.round(car.y / BLOCK) * BLOCK + (Math.sin(t.heading) >= 0 ? 0 : 0) + (t.heading === 0 ? t.lane : -t.lane)
    : Math.round(car.x / BLOCK) * BLOCK + (t.heading === Math.PI / 2 ? -t.lane : t.lane);
  if (horizontal) car.y += clamp(laneTarget - car.y, -70 * dt, 70 * dt);
  else car.x += clamp(laneTarget - car.x, -70 * dt, 70 * dt);

  // Keep distance from the car ahead.
  const ahead = carAhead(G, car, 110);
  const targetSpeed = ahead < 78 ? 0 : ahead < 120 ? t.cruise * 0.35 : t.cruise;
  car.speed += clamp(targetSpeed - car.speed, -260 * dt, 160 * dt);
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  car.x = clamp(car.x, 30, WORLD - 30);
  car.y = clamp(car.y, 30, WORLD - 30);
  // Never drive through buildings (a collision shove can push a car off the
  // road): slide along the wall and re-aim at the nearest road.
  const fixed = collideCircle(car.x, car.y, 21, G.city.solids);
  if (fixed.x !== car.x || fixed.y !== car.y) {
    car.x = fixed.x;
    car.y = fixed.y;
    car.speed *= 0.5;
    const rc = roadCenterNear(car.x, car.y);
    t.heading = axisHeading(Math.atan2(rc.y - car.y, rc.x - car.x));
  }
}

function collideCars(G, dt, audio) {
  const all = G.cars.slice();
  if (G.player.car && !all.includes(G.player.car)) all.push(G.player.car);
  for (const cop of G.cops) all.push(cop);
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i];
      const b = all[j];
      const d = dist(a.x, a.y, b.x, b.y);
      if (d >= 44 || d < 0.01) continue;
      const nx = (b.x - a.x) / d;
      const ny = (b.y - a.y) / d;
      const push = (44 - d) / 2;
      const aPlayer = a.driver === 'player';
      const bPlayer = b.driver === 'player';
      if (!aPlayer) {
        a.x -= nx * push;
        a.y -= ny * push;
      }
      if (!bPlayer) {
        b.x += nx * push;
        b.y += ny * push;
      }
      const relSpeed = Math.abs(a.speed - b.speed);
      if (relSpeed > 120) {
        const strength = clamp(relSpeed / 500, 0, 1);
        a.hp = Math.max(0, a.hp - strength * 14);
        b.hp = Math.max(0, b.hp - strength * 14);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        burst(G, mx, my, '#e8c85a', 8, 170);
        if (audio) audio.crash(strength);
        G.camera.shake = Math.min(10, G.camera.shake + strength * 6);
        a.speed *= 0.55;
        b.speed *= 0.55;
        if ((aPlayer || bPlayer) && G.wanted < 1 && relSpeed > 200) {
          addWanted(G, 1, 'Crash! A witness called the police.');
        }
      } else {
        // Gentle contact: separate the cars and shove the slower one along
        // instead of averaging speeds (averaging every frame pins both cars
        // to a crawl when nose-to-tail in traffic). A shoved parked car is
        // knocked out of its spot and rolls.
        const pusher = Math.abs(a.speed) >= Math.abs(b.speed) ? a : b;
        const shoved = pusher === a ? b : a;
        if (shoved.parked) {
          shoved.parked = false;
          shoved.traffic = null;
        }
        shoved.speed = pusher.speed * 0.55;
        pusher.speed *= 0.94;
      }
    }
  }
}

function updatePed(G, ped, dt) {
  ped.timer -= dt;
  if (ped.state === 'down') {
    if (ped.timer <= 0) {
      ped.state = 'idle';
      ped.timer = range(G.rng, 0.5, 2);
    }
    return;
  }
  if (ped.state === 'flee') {
    ped.scared -= dt;
    const p = G.player;
    const away = Math.atan2(ped.y - p.y, ped.x - p.x);
    ped.angle = turnToward(ped.angle, away, dt * 6);
    const nx = ped.x + Math.cos(ped.angle) * 190 * dt;
    const ny = ped.y + Math.sin(ped.angle) * 190 * dt;
    const fixed = collideCircle(nx, ny, 13, G.city.solids);
    ped.x = fixed.x;
    ped.y = fixed.y;
    ped.walkPhase += dt * 11;
    if (ped.scared <= 0) {
      ped.state = 'idle';
      ped.timer = range(G.rng, 1, 3);
    }
    return;
  }
  if (ped.state === 'idle') {
    if (ped.timer <= 0) {
      // Pick a nearby sidewalk/block target (not inside a building).
      for (let t = 0; t < 8; t += 1) {
        const tx = ped.x + range(G.rng, -320, 320);
        const ty = ped.y + range(G.rng, -320, 320);
        if (tx < 40 || ty < 40 || tx > WORLD - 40 || ty > WORLD - 40) continue;
        const fixed = collideCircle(tx, ty, 13, G.city.solids);
        if (fixed.x === tx && fixed.y === ty) {
          ped.tx = tx;
          ped.ty = ty;
          ped.state = 'walk';
          break;
        }
      }
      if (ped.state === 'idle') ped.timer = range(G.rng, 1, 2.5);
    }
    return;
  }
  // Walking toward the target.
  const d = dist(ped.x, ped.y, ped.tx, ped.ty);
  if (d < 14) {
    ped.state = 'idle';
    ped.timer = range(G.rng, 1, 4);
    return;
  }
  const want = Math.atan2(ped.ty - ped.y, ped.tx - ped.x);
  ped.angle = turnToward(ped.angle, want, dt * 5);
  const speed = 62;
  const nx = ped.x + Math.cos(ped.angle) * speed * dt;
  const ny = ped.y + Math.sin(ped.angle) * speed * dt;
  const fixed = collideCircle(nx, ny, 13, G.city.solids);
  if (fixed.x === nx && fixed.y === ny) {
    ped.x = nx;
    ped.y = ny;
  } else {
    // Blocked: nudge along the wall instead of walking into it.
    ped.x = fixed.x;
    ped.y = fixed.y;
    ped.tx = ped.x + Math.cos(ped.angle + Math.PI / 2) * 120;
    ped.ty = ped.y + Math.sin(ped.angle + Math.PI / 2) * 120;
  }
  ped.walkPhase += dt * 6;
}

function checkPedRunOver(G, audio) {
  const drivers = [];
  for (const car of G.cars) if (Math.abs(car.speed) > 60) drivers.push(car);
  for (const cop of G.cops) if (Math.abs(cop.speed) > 60) drivers.push(cop);
  for (const ped of G.peds) {
    if (ped.state === 'down') continue;
    for (const car of drivers) {
      if (dist(ped.x, ped.y, car.x, car.y) < 26) {
        ped.state = 'down';
        ped.timer = 4;
        burst(G, ped.x, ped.y, '#c03a3a', 8, 160);
        if (car.driver === 'player') {
          G.stats.pedsHit += 1;
          addWanted(G, 1, 'Pedestrian run over!');
          G.camera.shake = Math.min(10, G.camera.shake + 6);
        }
        break;
      }
    }
  }
}

export function updateTraffic(G, dt, audio) {
  for (const car of G.cars) {
    if (car.traffic && car.driver !== 'player') updateTrafficCar(G, car, dt);
    else if (car.driver !== 'player' && !car.parked) {
      // Abandoned cars roll to a stop.
      car.speed -= car.speed * 2 * dt;
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
    }
  }
  collideCars(G, dt, audio);
  for (const ped of G.peds) updatePed(G, ped, dt);
  checkPedRunOver(G, audio);
}

export { axisHeading, ROAD_W, isRoad };
