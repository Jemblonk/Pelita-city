// The master update: advances the clock, runs every system in order, and
// owns the camera, particles, toasts and the busted/respawn flow. Dialog and
// pause freeze the world; everything else ticks only in 'play'.
import { DAY_LEN, WORLD, BLOCK } from './config.js';
import { advanceDialog, startSideJob, updateMissions } from './missions.js';
import { updatePlayer } from './player.js';
import { updateTraffic } from './traffic.js';
import { updatePolice } from './police.js';
import { updateBullets, updateEnemies } from './combat.js';
import { addToast } from './state.js';
import { clamp, lerp } from './util.js';
import { wasPressed } from './input.js';

function updateParticles(G, dt) {
  for (let i = G.particles.length - 1; i >= 0; i -= 1) {
    const pt = G.particles[i];
    pt.life -= dt;
    if (pt.life <= 0) {
      G.particles.splice(i, 1);
      continue;
    }
    const drag = Math.max(0, 1 - pt.drag * dt);
    pt.vx *= drag;
    pt.vy *= drag;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
  }
}

function updateCamera(G, dt) {
  const p = G.player;
  const w = G.viewW || 1280;
  const h = G.viewH || 720;
  // Lead the camera slightly toward the player's motion / facing.
  const lead = p.car ? 46 : 22;
  const tx = p.x + Math.cos(p.angle) * lead;
  const ty = p.y + Math.sin(p.angle) * lead;
  const k = Math.min(1, dt * 4.5);
  G.camera.x = lerp(G.camera.x, tx, k);
  G.camera.y = lerp(G.camera.y, ty, k);
  G.camera.x = clamp(G.camera.x, w / 2 - 160, WORLD - w / 2 + 160);
  G.camera.y = clamp(G.camera.y, h / 2 - 160, WORLD - h / 2 + 160);
  G.camera.shake = Math.max(0, G.camera.shake - dt * 26);
}

export function respawnAfterBusted(G) {
  const p = G.player;
  const fine = Math.min(p.cash, Math.max(25, Math.floor(p.cash * 0.2)));
  p.cash -= fine;
  p.hp = p.maxHp;
  p.ammo = Math.max(p.ammo, 12);
  if (p.car) {
    p.car.driver = null;
    p.car = null;
  }
  // Released at the central station, on foot, on the road.
  p.x = 4 * BLOCK;
  p.y = 4 * BLOCK - 100;
  p.angle = -Math.PI / 2;
  G.wanted = 0;
  G.unseenT = 0;
  G.cops.length = 0;
  G.bullets.length = 0;
  // Reset the active mission leg so it can be retried cleanly.
  const m = G.mission;
  if (m.stage === 'deliver') {
    m.stage = 'pickup';
    G.objective = 'Pick up the package at the north-west marker.';
    G.marker = { x: 800, y: 1200, label: 'PICKUP' };
  } else if (m.stage === 'fight') {
    for (let i = G.enemies.length - 1; i >= 0; i -= 1) {
      if (G.enemies[i].mission) G.enemies.splice(i, 1);
    }
    m.stage = 'goto';
    G.objective = 'Head to the alley in the south-east blocks.';
  } else if (m.stage === 'escape') {
    m.stage = 'steal';
    G.objective = 'Steal the red Comet uptown.';
  }
  G.camera.x = p.x;
  G.camera.y = p.y;
  G.mode = 'play';
  addToast(G, `Released. Fine paid: $${fine}.`);
}

export function updateGame(G, input, dt, audio) {
  // Dialog advance works in dialog mode; the world stays frozen.
  if (G.mode === 'dialog') {
    if (wasPressed(input, 'Space', 'Enter', 'KeyE') || input.mouse.clicked) {
      advanceDialog(G);
    }
    return;
  }
  if (G.mode !== 'play') {
    if (G.mode === 'busted') G.bustedT += dt;
    return;
  }

  G.time += dt;
  G.timeOfDay = (G.timeOfDay + dt / DAY_LEN) % 1;
  G.helpT = Math.max(0, G.helpT - dt);
  G.saveFlash = Math.max(0, G.saveFlash - dt);

  if (wasPressed(input, 'KeyN')) startSideJob(G);
  if (wasPressed(input, 'KeyM') && audio) {
    G.muted = !G.muted;
    audio.setMuted(G.muted);
    addToast(G, G.muted ? 'Sound off.' : 'Sound on.');
  }

  updatePlayer(G, input, dt, audio);
  updateTraffic(G, dt, audio);
  updatePolice(G, dt, audio);
  updateEnemies(G, dt, audio);
  updateBullets(G, dt);
  updateMissions(G, dt, audio);

  // Pickups bob and expire.
  for (let i = G.pickups.length - 1; i >= 0; i -= 1) {
    const pk = G.pickups[i];
    pk.bob += dt * 3;
    pk.ttl -= dt;
    if (pk.ttl <= 0) G.pickups.splice(i, 1);
  }
  // Toasts fade.
  for (let i = G.toasts.length - 1; i >= 0; i -= 1) {
    G.toasts[i].t -= dt;
    if (G.toasts[i].t <= 0) G.toasts.splice(i, 1);
  }
  updateParticles(G, dt);
  updateCamera(G, dt);

  // The player may have been busted mid-update; the mode switch is honoured
  // by the main loop, which stops calling us until respawn.
}
