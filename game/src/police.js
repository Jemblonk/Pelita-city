// Police: spawned in proportion to the wanted level, they pursue along the
// road grid (BFS waypoints), switch to a direct chase when close with a
// clear line of sight, wait at the nearest intersection when the player
// hides inside a block, and recover to the road when knocked off it.
import { BLOCK, COP_ACCEL, COP_TOP_SPEED, DECAY_PERIOD, DECAY_UNSEEN, MAX_WANTED, WORLD } from './config.js';
import { collideCircle, isRoad, nearestNodePos, roadCenterNear } from './city.js';
import { findRoadPath, losClear } from './nav.js';
import { addToast, burst, newCar } from './state.js';
import { clamp, dist, range, turnToward } from './util.js';
import { damagePlayer } from './combat.js';

function newCop(x, y, angle) {
  const cop = newCar(x, y, angle, { color: '#1c2430', body: 'police' });
  cop.driver = 'cop';
  cop.path = [];
  cop.pathI = 0;
  cop.repathT = 0;
  cop.stuckT = 0;
  cop.reverseT = 0;
  cop.holdT = 0;
  cop.bustT = 0;
  cop.sirenPhase = (cop.id % 10) / 10; // deterministic: same cop, same flash phase
  cop.lastTargetNode = '';
  return cop;
}

function spawnCop(G) {
  const p = G.player;
  // Pick a road node 550–800 px away, preferring ones off the player's view.
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < 9; i += 1) {
    for (let j = 0; j < 9; j += 1) {
      const x = i * BLOCK;
      const y = j * BLOCK;
      const d = dist(x, y, p.x, p.y);
      if (d < 480 || d > 950) continue;
      const score = d + G.rng() * 260;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  if (!best) best = { x: clamp(p.x + 600, 60, WORLD - 60), y: clamp(p.y, 60, WORLD - 60) };
  const road = roadCenterNear(best.x, best.y);
  const cop = newCop(road.x, road.y, Math.atan2(p.y - road.y, p.x - road.x));
  cop.speed = 120;
  G.cops.push(cop);
}

function driveToward(G, cop, heading, targetSpeed, dt, audio) {
  const speedNorm = clamp(Math.abs(cop.speed) / COP_TOP_SPEED, 0, 1);
  const authority = 2.9 * (1 - speedNorm * 0.5);
  cop.angle = turnToward(cop.angle, heading, authority * dt);
  if (cop.reverseT > 0) {
    cop.reverseT -= dt;
    cop.speed = Math.max(-140, cop.speed - COP_ACCEL * dt);
  } else if (cop.speed < targetSpeed) {
    cop.speed = Math.min(targetSpeed, cop.speed + COP_ACCEL * dt);
  } else {
    cop.speed = Math.max(targetSpeed, cop.speed - COP_ACCEL * 1.4 * dt);
  }
  const nx = cop.x + Math.cos(cop.angle) * cop.speed * dt;
  const ny = cop.y + Math.sin(cop.angle) * cop.speed * dt;
  const fixed = collideCircle(nx, ny, 21, G.city.solids);
  const hit = fixed.x !== nx || fixed.y !== ny;
  if (hit) {
    if (Math.abs(cop.speed) > 130) {
      burst(G, fixed.x, fixed.y, '#e8c85a', 6, 150);
      if (audio) audio.crash(0.3);
      cop.hp = Math.max(0, cop.hp - 8);
    }
    cop.speed *= 0.3;
    cop.stuckT += dt;
  } else {
    cop.stuckT = Math.max(0, cop.stuckT - dt * 2);
  }
  cop.x = fixed.x;
  cop.y = fixed.y;
  // Stuck: back up briefly, then re-aim at the road.
  if (cop.stuckT > 1.1) {
    cop.stuckT = 0;
    cop.reverseT = 0.7;
    cop.path = [];
    cop.repathT = 0;
  }
}

function updateCop(G, cop, dt, audio) {
  const p = G.player;
  cop.sirenPhase += dt * 3;
  cop.repathT -= dt;
  const d = dist(cop.x, cop.y, p.x, p.y);
  const sees = d < 520 && losClear(cop.x, cop.y, p.x, p.y, G.city.solids);
  if (sees) {
    G.unseenT = 0;
    G.lastSeenX = p.x;
    G.lastSeenY = p.y;
  }
  // Navigation target: the player's live position while recently seen, else
  // the last place any cop saw them (so hiding inside a block works).
  const hidden = G.unseenT > 3 && G.lastSeenX !== undefined;
  const tX = hidden ? G.lastSeenX : p.x;
  const tY = hidden ? G.lastSeenY : p.y;

  const playerNode = nearestNodePos(tX, tY);
  const targetKey = playerNode.x + ',' + playerNode.y;
  if (cop.repathT <= 0 || targetKey !== cop.lastTargetNode) {
    cop.repathT = 0.8;
    cop.lastTargetNode = targetKey;
    cop.path = findRoadPath(cop.x, cop.y, tX, tY);
    cop.pathI = 0;
  }

  const playerOnRoad = isRoad(p.x, p.y);
  const direct = sees && d < 210;
  if (direct) {
    // Close + visible: forget the grid, drive straight at the player.
    const heading = Math.atan2(p.y - cop.y, p.x - cop.x);
    driveToward(G, cop, heading, COP_TOP_SPEED, dt, audio);
    cop.holdT = 0;
  } else if (!playerOnRoad && !sees) {
    // Player hiding inside a block: hold at the nearest intersection.
    const hold = nearestNodePos(tX, tY);
    const hd = dist(cop.x, cop.y, hold.x, hold.y);
    if (hd > 50) {
      const heading = Math.atan2(hold.y - cop.y, hold.x - cop.x);
      driveToward(G, cop, heading, COP_TOP_SPEED * 0.7, dt, audio);
    } else {
      cop.speed = Math.max(0, cop.speed - COP_ACCEL * dt);
      cop.holdT += dt;
      // Creep toward the player's side of the block edge occasionally.
      if (cop.holdT > 4) {
        cop.holdT = 0;
        cop.repathT = 0;
      }
    }
  } else {
    // Follow BFS waypoints along the roads.
    while (cop.pathI < cop.path.length && dist(cop.x, cop.y, cop.path[cop.pathI].x, cop.path[cop.pathI].y) < 46) {
      cop.pathI += 1;
    }
    let heading;
    let targetSpeed = COP_TOP_SPEED;
    if (cop.pathI < cop.path.length) {
      const wp = cop.path[cop.pathI];
      heading = Math.atan2(wp.y - cop.y, wp.x - cop.x);
      // Slow for sharp turns so the pursuit looks like driving, not sliding.
      const turn = Math.abs(((heading - cop.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (turn > 0.9) targetSpeed = COP_TOP_SPEED * 0.45;
      else if (turn > 0.45) targetSpeed = COP_TOP_SPEED * 0.7;
    } else {
      // End of path: head for the target's road position.
      const rc = roadCenterNear(tX, tY);
      heading = Math.atan2(rc.y - cop.y, rc.x - cop.x);
      if (d < 120) targetSpeed = COP_TOP_SPEED * 0.6;
    }
    // Off-road recovery: if knocked into a block, steer back to the road.
    if (!isRoad(cop.x, cop.y) && !sees) {
      const rc = roadCenterNear(cop.x, cop.y);
      heading = Math.atan2(rc.y - cop.y, rc.x - cop.x);
      targetSpeed = COP_TOP_SPEED * 0.55;
    }
    driveToward(G, cop, heading, targetSpeed, dt, audio);
  }

  // Contact with the player.
  if (p.car) {
    // Car contact is resolved by collideCars; cops just keep pushing.
  } else if (d < 34) {
    if (Math.abs(cop.speed) > 140) {
      damagePlayer(G, 14, cop.x, cop.y);
      p.x += Math.cos(cop.angle) * 26;
      p.y += Math.sin(cop.angle) * 26;
      cop.speed *= 0.4;
    } else {
      cop.bustT += dt;
      if (cop.bustT > 1.4 && G.wanted > 0) {
        G.mode = 'busted';
        G.bustedT = 0;
        if (audio) audio.busted();
      }
    }
  } else {
    cop.bustT = Math.max(0, cop.bustT - dt * 2);
  }
}

export function updatePolice(G, dt, audio) {
  const wanted = clamp(G.wanted, 0, MAX_WANTED);
  const desired = wanted === 0 ? 0 : Math.min(6, wanted + 1);
  // Does any cop currently see the player? Shared by spawning + decay.
  let anySees = false;
  for (const cop of G.cops) {
    if (dist(cop.x, cop.y, G.player.x, G.player.y) < 520 && losClear(cop.x, cop.y, G.player.x, G.player.y, G.city.solids)) {
      anySees = true;
      break;
    }
  }
  if (anySees) {
    G.unseenT = 0;
    G.lastSeenX = G.player.x;
    G.lastSeenY = G.player.y;
  } else {
    G.unseenT += dt;
  }
  // Spawn up to the desired count (staggered: at most one per 0.8 s), but
  // only while the trail is warm — once the player has hidden long enough,
  // no fresh cops arrive and the stars can decay.
  G._spawnT = (G._spawnT || 0) - dt;
  if (G.cops.length < desired && G._spawnT <= 0 && G.unseenT < DECAY_UNSEEN) {
    G._spawnT = 0.8;
    spawnCop(G);
  }
  // When the heat is off, cops give up and drive away (despawn when far).
  if (wanted === 0) {
    for (let i = G.cops.length - 1; i >= 0; i -= 1) {
      const cop = G.cops[i];
      cop.speed = Math.max(0, cop.speed - 60 * dt);
      if (dist(cop.x, cop.y, G.player.x, G.player.y) > 700 || G.time - G.lastCrimeT > 30) {
        G.cops.splice(i, 1);
      }
    }
  }
  for (const cop of G.cops) updateCop(G, cop, dt, audio);

  // Wanted decay: unseen for a while, then one star per period.
  if (wanted > 0) {
    if (anySees) {
      G._decayT = 0;
    } else if (G.unseenT > DECAY_UNSEEN) {
      G._decayT = (G._decayT || 0) + dt;
      if (G._decayT >= DECAY_PERIOD) {
        G._decayT = 0;
        G.wanted -= 1;
        addToast(G, G.wanted === 0 ? 'The police lost your trail.' : `Heat dropping: ${G.wanted} stars.`);
      }
    }
  } else {
    G._decayT = 0;
  }

  // Siren while any cop is actively pursuing.
  if (audio) audio.siren(G.cops.length > 0 && wanted > 0, dt);
}

export { MAX_WANTED };
