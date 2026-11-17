// Combat: the player's punch and gun, enemy bullets, and the two enemy
// behaviours — melee thugs who close in and swing, and shooters who hold
// range, strafe, and fire only with a clear line of sight.
import {
  BULLET_SPEED, ENEMY_BULLET_SPEED, ENEMY_SHOT_DMG, MELEE_DMG, PUNCH_DMG,
  PUNCH_RANGE, SHOT_DMG, WORLD,
} from './config.js';
import { collideCircle } from './city.js';
import { losClear } from './nav.js';
import { addToast, addWanted, burst, spawnParticle } from './state.js';
import { angDiff, dist, range, turnToward } from './util.js';

function alertNearby(G, x, y, radius) {
  for (const e of G.enemies) {
    if (!e.dead && dist(e.x, e.y, x, y) < radius) e.alerted = true;
  }
  for (const ped of G.peds) {
    if (dist(ped.x, ped.y, x, y) < radius) {
      ped.state = 'flee';
      ped.scared = 4;
      ped.timer = 0.1;
    }
  }
}

export function doPunch(G, audio) {
  const p = G.player;
  p.punchT = 0.42;
  p.punchAnim = 0.22;
  const reachX = p.x + Math.cos(p.angle) * PUNCH_RANGE * 0.7;
  const reachY = p.y + Math.sin(p.angle) * PUNCH_RANGE * 0.7;
  let hitSomething = false;
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (dist(reachX, reachY, e.x, e.y) < PUNCH_RANGE * 0.75 + 14) {
      damageEnemy(G, e, PUNCH_DMG, p.angle, audio);
      hitSomething = true;
    }
  }
  if (!hitSomething) {
    for (const ped of G.peds) {
      if (ped.state === 'down') continue;
      if (dist(reachX, reachY, ped.x, ped.y) < PUNCH_RANGE * 0.7 + 12) {
        ped.state = 'down';
        ped.timer = 3;
        addWanted(G, 1, 'Pedestrian punched! Police called.');
        hitSomething = true;
        burst(G, ped.x, ped.y, '#e8b98a', 6, 120);
      }
    }
  }
  if (audio) audio.punch();
  alertNearby(G, p.x, p.y, 220);
}

export function doShoot(G, tx, ty, audio) {
  const p = G.player;
  if (p.ammo <= 0) {
    p.shootT = 0.3;
    addToast(G, 'Out of ammo! Find an ammo box.');
    return;
  }
  p.ammo -= 1;
  p.shootT = 0.16;
  G.stats.shotsFired += 1;
  const a = Math.atan2(ty - p.y, tx - p.x);
  const spread = (G.rng() - 0.5) * 0.05;
  G.bullets.push({
    x: p.x + Math.cos(a) * 22,
    y: p.y + Math.sin(a) * 22,
    vx: Math.cos(a + spread) * BULLET_SPEED,
    vy: Math.sin(a + spread) * BULLET_SPEED,
    from: 'player',
    life: 1.1,
    dmg: SHOT_DMG,
  });
  p.angle = a;
  spawnParticle(G, p.x + Math.cos(a) * 26, p.y + Math.sin(a) * 26, {
    vx: Math.cos(a) * 60,
    vy: Math.sin(a) * 60,
    color: '#ffd75a',
    life: 0.08,
    size: 5,
  });
  if (audio) audio.shoot();
  alertNearby(G, p.x, p.y, 520);
  // Firing near a cop draws attention.
  for (const cop of G.cops) {
    if (dist(cop.x, cop.y, p.x, p.y) < 420 && losClear(cop.x, cop.y, p.x, p.y, G.city.solids)) {
      if (G.wanted < 1) addWanted(G, 1, 'Shots heard by police!');
      G.unseenT = 0;
    }
  }
}

export function damageEnemy(G, e, dmg, fromAngle, audio) {
  if (e.dead) return;
  e.hp -= dmg;
  e.hurtT = 0.25;
  e.alerted = true;
  burst(G, e.x, e.y, '#c03a3a', 6, 150);
  if (e.hp <= 0) {
    e.dead = true;
    G.stats.kills += 1;
    burst(G, e.x, e.y, '#c03a3a', 18, 220);
    burst(G, e.x, e.y, '#e8c85a', 8, 160);
    // Cash drop.
    const amount = e.kind === 'shooter' ? 55 : 35;
    G.pickups.push({ x: e.x, y: e.y, kind: 'cash', amount, ttl: 45, bob: 0 });
    if (G.rng() < 0.4) {
      G.pickups.push({ x: e.x + 18, y: e.y + 10, kind: 'ammo', amount: 10, ttl: 45, bob: 0 });
    }
    addToast(G, `Enemy down! +$${amount}`);
  }
}

export function damagePlayer(G, dmg, fromX, fromY) {
  const p = G.player;
  if (p.hurtT > 0.15) return; // brief invulnerability window
  p.hp -= dmg;
  p.hurtT = 0.5;
  G.camera.shake = Math.min(12, G.camera.shake + 5);
  burst(G, p.x, p.y, '#c03a3a', 7, 170);
  if (p.hp <= 0) {
    p.hp = 0;
    G.mode = 'busted';
    G.bustedT = 0;
  }
}

function bulletHitsSolid(G, x, y) {
  for (const s of G.city.solids) {
    if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return true;
  }
  return x < 0 || y < 0 || x > WORLD || y > WORLD;
}

export function updateBullets(G, dt) {
  for (let i = G.bullets.length - 1; i >= 0; i -= 1) {
    const b = G.bullets[i];
    b.life -= dt;
    const steps = 3; // substep so fast bullets cannot tunnel through people
    let dead = b.life <= 0;
    for (let s = 0; s < steps && !dead; s += 1) {
      b.x += (b.vx * dt) / steps;
      b.y += (b.vy * dt) / steps;
      if (bulletHitsSolid(G, b.x, b.y)) {
        burst(G, b.x, b.y, '#d8c88a', 3, 90);
        dead = true;
        break;
      }
      if (b.from === 'player') {
        for (const e of G.enemies) {
          if (e.dead) continue;
          if (dist(b.x, b.y, e.x, e.y) < 17) {
            damageEnemy(G, e, b.dmg, Math.atan2(b.vy, b.vx), null);
            dead = true;
            break;
          }
        }
        if (!dead) {
          for (const ped of G.peds) {
            if (ped.state === 'down') continue;
            if (dist(b.x, b.y, ped.x, ped.y) < 15) {
              ped.state = 'down';
              ped.timer = 4;
              addWanted(G, 1, 'Pedestrian shot!');
              dead = true;
              break;
            }
          }
        }
      } else if (dist(b.x, b.y, G.player.x, G.player.y) < 16) {
        damagePlayer(G, b.dmg, b.x, b.y);
        dead = true;
      }
    }
    if (dead) G.bullets.splice(i, 1);
  }
}

function enemyShootAt(G, e, audio) {
  const p = G.player;
  const a = Math.atan2(p.y - e.y, p.x - e.x);
  const spread = (G.rng() - 0.5) * 0.14;
  G.bullets.push({
    x: e.x + Math.cos(a) * 20,
    y: e.y + Math.sin(a) * 20,
    vx: Math.cos(a + spread) * ENEMY_BULLET_SPEED,
    vy: Math.sin(a + spread) * ENEMY_BULLET_SPEED,
    from: 'enemy',
    life: 1.4,
    dmg: ENEMY_SHOT_DMG,
  });
  if (audio) audio.enemyShoot();
}

export function updateEnemies(G, dt, audio) {
  const p = G.player;
  for (const e of G.enemies) {
    if (e.dead) continue;
    e.hurtT = Math.max(0, e.hurtT - dt);
    e.cooldown -= dt;
    const d = dist(e.x, e.y, p.x, p.y);
    const sees = d < 560 && losClear(e.x, e.y, p.x, p.y, G.city.solids);
    if (sees) e.alerted = true;
    if (!e.alerted) {
      // Idle patrol: slow wander near the spawn point.
      e.strafeT -= dt;
      if (e.strafeT <= 0) {
        e.strafeT = range(G.rng, 1.5, 3.5);
        e.angle = range(G.rng, 0, Math.PI * 2);
      }
      const nx = e.x + Math.cos(e.angle) * 26 * dt;
      const ny = e.y + Math.sin(e.angle) * 26 * dt;
      const fixed = collideCircle(nx, ny, 14, G.city.solids);
      e.x = fixed.x;
      e.y = fixed.y;
      e.walkPhase += dt * 4;
      continue;
    }
    const aim = Math.atan2(p.y - e.y, p.x - e.x);
    if (e.kind === 'melee') {
      e.angle = turnToward(e.angle, aim, dt * 5);
      if (d > 34) {
        const speed = 150;
        const nx = e.x + Math.cos(e.angle) * speed * dt;
        const ny = e.y + Math.sin(e.angle) * speed * dt;
        const fixed = collideCircle(nx, ny, 14, G.city.solids);
        e.x = fixed.x;
        e.y = fixed.y;
        e.walkPhase += dt * 9;
      } else if (e.cooldown <= 0) {
        e.cooldown = 0.85;
        damagePlayer(G, MELEE_DMG, e.x, e.y);
        burst(G, p.x, p.y, '#e8b98a', 4, 110);
        if (audio) audio.punch();
      }
    } else {
      // Shooter: hold 170–280 range, strafe sideways, fire with clear sight.
      e.strafeT -= dt;
      if (e.strafeT <= 0) {
        e.strafeT = range(G.rng, 0.9, 2.2);
        e.strafeDir *= -1;
      }
      let mx = 0;
      let my = 0;
      if (d > 280) {
        mx = Math.cos(aim);
        my = Math.sin(aim);
      } else if (d < 160) {
        mx = -Math.cos(aim);
        my = -Math.sin(aim);
      }
      mx += Math.cos(aim + Math.PI / 2) * e.strafeDir * 0.8;
      my += Math.sin(aim + Math.PI / 2) * e.strafeDir * 0.8;
      const mLen = Math.hypot(mx, my) || 1;
      const speed = 105;
      const nx = e.x + (mx / mLen) * speed * dt;
      const ny = e.y + (my / mLen) * speed * dt;
      const fixed = collideCircle(nx, ny, 14, G.city.solids);
      e.x = fixed.x;
      e.y = fixed.y;
      e.walkPhase += dt * 7;
      e.angle = turnToward(e.angle, aim, dt * 6);
      if (e.cooldown <= 0 && sees && Math.abs(angDiff(e.angle, aim)) < 0.3) {
        e.cooldown = range(G.rng, 1.1, 1.9);
        enemyShootAt(G, e, audio);
      }
    }
  }
  // Remove the long-dead so arrays stay small (render skips dead anyway).
  for (let i = G.enemies.length - 1; i >= 0; i -= 1) {
    if (G.enemies[i].dead) G.enemies.splice(i, 1);
  }
}
