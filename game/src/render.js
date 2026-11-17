// All drawing: the city, entities, lighting, HUD, minimap, dialog and the
// menu screens. Rendering reads state and never writes game state; the only
// thing draw() returns is the list of on-screen buttons for click handling.
import { BLOCK, COLORS, NODES, ROAD_W, WORLD } from './config.js';
import { daylight } from './state.js';
import { clamp, dist, mulberry32 } from './util.js';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let viewW = 1280;
  let viewH = 720;
  let mapCache = null;
  let mapCacheKey = '';

  function resize(w, h) {
    viewW = w;
    viewH = h;
    canvas.width = w;
    canvas.height = h;
  }

  function worldToScreen(x, y, cam, shakeX, shakeY) {
    return { x: x - cam.x + viewW / 2 + shakeX, y: y - cam.y + viewH / 2 + shakeY };
  }

  // ---------- World ----------

  function drawWorld(G, cam, sx, sy, light) {
    const x0 = cam.x - viewW / 2 - 80;
    const y0 = cam.y - viewH / 2 - 80;
    const x1 = cam.x + viewW / 2 + 80;
    const y1 = cam.y + viewH / 2 + 80;
    // Grass base.
    ctx.fillStyle = COLORS.grass;
    ctx.fillRect(0, 0, viewW, viewH);
    // Subtle checker mowing pattern per block.
    ctx.fillStyle = COLORS.grassDark;
    for (let i = 0; i < NODES - 1; i += 1) {
      for (let j = 0; j < NODES - 1; j += 1) {
        if ((i + j) % 2 !== 0) continue;
        const bx = i * BLOCK + ROAD_W / 2;
        const by = j * BLOCK + ROAD_W / 2;
        if (bx > x1 || by > y1 || bx + BLOCK - ROAD_W < x0 || by + BLOCK - ROAD_W < y0) continue;
        const s = worldToScreen(bx, by, cam, sx, sy);
        ctx.fillRect(s.x, s.y, BLOCK - ROAD_W, BLOCK - ROAD_W);
      }
    }
    // Sidewalk rings + parks + lots.
    for (const park of G.city.parks) {
      if (park.x > x1 || park.y > y1 || park.x + park.w < x0 || park.y + park.h < y0) continue;
      const s = worldToScreen(park.x, park.y, cam, sx, sy);
      ctx.fillStyle = COLORS.park;
      ctx.fillRect(s.x, s.y, park.w, park.h);
    }
    for (const lot of G.city.lots) {
      if (lot.x > x1 || lot.y > y1 || lot.x + lot.w < x0 || lot.y + lot.h < y0) continue;
      const s = worldToScreen(lot.x, lot.y, cam, sx, sy);
      ctx.fillStyle = '#43464c';
      ctx.fillRect(s.x, s.y, lot.w, lot.h);
      ctx.strokeStyle = '#8a8f96';
      ctx.lineWidth = 2;
      for (const slot of lot.slots) {
        const p = worldToScreen(slot.x, slot.y, cam, sx, sy);
        ctx.strokeRect(p.x - 13, p.y - 24, 26, 48);
      }
    }
    // Roads: full-width bands, then markings.
    ctx.fillStyle = COLORS.road;
    for (let i = 0; i < NODES; i += 1) {
      const c = i * BLOCK;
      if (c + ROAD_W / 2 >= x0 && c - ROAD_W / 2 <= x1) {
        const s = worldToScreen(c - ROAD_W / 2, Math.max(0, y0), cam, sx, sy);
        ctx.fillRect(s.x, s.y, ROAD_W, Math.min(WORLD, y1) - Math.max(0, y0));
      }
      if (c + ROAD_W / 2 >= y0 && c - ROAD_W / 2 <= y1) {
        const s = worldToScreen(Math.max(0, x0), c - ROAD_W / 2, cam, sx, sy);
        ctx.fillRect(s.x, s.y, Math.min(WORLD, x1) - Math.max(0, x0), ROAD_W);
      }
    }
    // Centre dashes.
    ctx.fillStyle = COLORS.marking;
    const dash = 34;
    const gap = 30;
    for (let i = 0; i < NODES; i += 1) {
      const c = i * BLOCK;
      for (let d = 0; d < WORLD; d += dash + gap) {
        const mid = d + dash / 2;
        if (Math.abs(mid - Math.round(mid / BLOCK) * BLOCK) < ROAD_W / 2 + 10) continue; // skip intersections
        if (c >= x0 && c <= x1 && mid >= y0 && mid <= y1) {
          const s = worldToScreen(c, mid, cam, sx, sy);
          ctx.fillRect(s.x - 2.5, s.y - dash / 2, 5, dash);
        }
        if (c >= y0 && c <= y1 && mid >= x0 && mid <= x1) {
          const s = worldToScreen(mid, c, cam, sx, sy);
          ctx.fillRect(s.x - dash / 2, s.y - 2.5, dash, 5);
        }
      }
    }
    // Crosswalks at intersections.
    ctx.fillStyle = COLORS.crosswalk;
    for (let i = 0; i < NODES; i += 1) {
      for (let j = 0; j < NODES; j += 1) {
        const cx = i * BLOCK;
        const cy = j * BLOCK;
        if (cx < x0 - 60 || cx > x1 + 60 || cy < y0 - 60 || cy > y1 + 60) continue;
        for (let k = -2; k <= 2; k += 1) {
          const s1 = worldToScreen(cx + k * 12 - 4, cy - ROAD_W / 2 + 4, cam, sx, sy);
          ctx.fillRect(s1.x, s1.y, 8, 14);
          const s2 = worldToScreen(cx + k * 12 - 4, cy + ROAD_W / 2 - 18, cam, sx, sy);
          ctx.fillRect(s2.x, s2.y, 8, 14);
        }
      }
    }
    // Buildings: shadow, walls, roof, windows.
    for (const b of G.city.buildings) {
      if (b.x > x1 || b.y > y1 || b.x + b.w < x0 || b.y + b.h < y0) continue;
      const s = worldToScreen(b.x, b.y, cam, sx, sy);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(s.x + 8, s.y + 9, b.w, b.h);
      ctx.fillStyle = b.wall;
      ctx.fillRect(s.x, s.y, b.w, b.h);
      ctx.fillStyle = b.roof;
      ctx.fillRect(s.x + 5, s.y + 5, b.w - 10, b.h - 10);
      // Windows: deterministic per building, lit at night.
      const cols = Math.max(2, Math.floor(b.w / 26));
      const rows = Math.max(2, Math.floor(b.h / 26));
      const wrng = mulberry32(b.winSeed);
      const night = 1 - light;
      for (let wx = 0; wx < cols; wx += 1) {
        for (let wy = 0; wy < rows; wy += 1) {
          const lit = wrng() < 0.25 + night * 0.5;
          ctx.fillStyle = lit ? (night > 0.4 ? '#ffd76a' : '#c8d8e8') : '#3a3f46';
          ctx.fillRect(s.x + 10 + wx * ((b.w - 20) / cols), s.y + 10 + wy * ((b.h - 20) / rows), 9, 11);
        }
      }
    }
    // Trees.
    for (const t of G.city.trees) {
      if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1) continue;
      const s = worldToScreen(t.x, t.y, cam, sx, sy);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(s.x + 4, s.y + 5, t.r, t.r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5a4030';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = t.green;
      ctx.beginPath();
      ctx.arc(s.x, s.y, t.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(s.x - t.r * 0.3, s.y - t.r * 0.3, t.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    // Lamp posts.
    ctx.fillStyle = '#22252a';
    for (const lamp of G.city.lamps) {
      if (lamp.x < x0 || lamp.x > x1 || lamp.y < y0 || lamp.y > y1) continue;
      const s = worldToScreen(lamp.x, lamp.y, cam, sx, sy);
      ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
      ctx.fillStyle = 1 - light > 0.4 ? '#ffe89a' : '#8a8f96';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#22252a';
    }
  }

  // ---------- Entities ----------

  function drawCar(G, car, cam, sx, sy, light) {
    const s = worldToScreen(car.x, car.y, cam, sx, sy);
    if (s.x < -70 || s.x > viewW + 70 || s.y < -70 || s.y > viewH + 70) return;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(car.angle);
    const len = car.body === 'van' ? 56 : 46;
    const wid = car.body === 'van' ? 26 : 22;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(ctx, -len / 2 + 3, -wid / 2 + 4, len, wid, 7);
    ctx.fill();
    // Wheels (front pair steers).
    ctx.fillStyle = '#14161a';
    const wy = wid / 2 - 2;
    const wx = len / 2 - 11;
    ctx.fillRect(wx - 5, -wy - 3, 10, 5);
    ctx.fillRect(wx - 5, wy - 2, 10, 5);
    ctx.save();
    ctx.translate(-wx, 0);
    ctx.rotate(car.steer * 0.4 || 0);
    ctx.fillRect(-5, -wy - 3, 10, 5);
    ctx.fillRect(-5, wy - 2, 10, 5);
    ctx.restore();
    // Body.
    ctx.fillStyle = car.color;
    roundRect(ctx, -len / 2, -wid / 2, len, wid, 7);
    ctx.fill();
    if (car.body === 'police') {
      ctx.fillStyle = '#dfe3e8';
      roundRect(ctx, -len / 2 + 8, -wid / 2 + 1, len * 0.42, wid - 2, 5);
      ctx.fill();
      ctx.fillStyle = '#1c2430';
      roundRect(ctx, -len / 2, -wid / 2, 8, wid, 5);
      ctx.fill();
    } else if (car.body === 'taxi') {
      ctx.fillStyle = '#e8c85a';
      roundRect(ctx, -len / 2, -wid / 2, len, wid, 7);
      ctx.fill();
      ctx.fillStyle = '#1c2430';
      ctx.fillRect(-4, -3, 8, 6);
    }
    // Cabin / windshield.
    ctx.fillStyle = 'rgba(180,210,235,0.85)';
    roundRect(ctx, -6, -wid / 2 + 4, 14, wid - 8, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(30,34,40,0.55)';
    roundRect(ctx, -len / 2 + 7, -wid / 2 + 4, 8, wid - 8, 3);
    ctx.fill();
    // Lights.
    const night = 1 - light > 0.35;
    ctx.fillStyle = night ? '#fff8d8' : '#e8e4c8';
    ctx.fillRect(len / 2 - 3, -wid / 2 + 3, 3, 5);
    ctx.fillRect(len / 2 - 3, wid / 2 - 8, 3, 5);
    ctx.fillStyle = car.brakeLight > 0 ? '#ff4a3a' : '#a03028';
    ctx.fillRect(-len / 2, -wid / 2 + 3, 3, 5);
    ctx.fillRect(-len / 2, wid / 2 - 8, 3, 5);
    // Police light bar.
    if (car.body === 'police') {
      const phase = Math.floor((car.sirenPhase || 0) * 2) % 2 === 0;
      ctx.fillStyle = phase ? '#ff3b30' : '#3b82ff';
      ctx.fillRect(-4, -wid / 2 - 1, 8, 5);
      ctx.fillStyle = phase ? '#3b82ff' : '#ff3b30';
      ctx.fillRect(-4, wid / 2 - 4, 8, 5);
    }
    // Damage: cracked look when hp is low.
    if (car.hp < 45) {
      ctx.strokeStyle = 'rgba(20,20,20,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-len / 2 + 4, -wid / 2 + 4);
      ctx.lineTo(0, 0);
      ctx.lineTo(len / 2 - 8, wid / 2 - 5);
      ctx.stroke();
    }
    ctx.restore();
    // Target marker for the mission car.
    if (car.target) {
      const bob = Math.sin(G.time * 4) * 4;
      ctx.fillStyle = '#ffd75a';
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - 34 + bob);
      ctx.lineTo(s.x - 8, s.y - 48 + bob);
      ctx.lineTo(s.x + 8, s.y - 48 + bob);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawPerson(G, x, y, angle, shirt, skin, walkPhase, cam, sx, sy, opts = {}) {
    const s = worldToScreen(x, y, cam, sx, sy);
    if (s.x < -40 || s.x > viewW + 40 || s.y < -40 || s.y > viewH + 40) return;
    const bob = Math.sin(walkPhase) * 1.6;
    ctx.save();
    ctx.translate(s.x, s.y + bob * 0.4);
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 9, 11, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(angle);
    // Legs (walk swing).
    const swing = Math.sin(walkPhase) * 5;
    ctx.strokeStyle = '#2c3440';
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-2, -4);
    ctx.lineTo(-2 - swing, -9);
    ctx.moveTo(-2, 4);
    ctx.lineTo(-2 + swing, 9);
    ctx.stroke();
    // Body.
    ctx.fillStyle = opts.hurt ? '#e8e8e8' : shirt;
    roundRect(ctx, -8, -8, 17, 16, 6);
    ctx.fill();
    // Arms: one reaches forward when punching.
    ctx.strokeStyle = skin;
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (opts.punching) {
      ctx.moveTo(6, -5);
      ctx.lineTo(17, -2);
      ctx.moveTo(6, 5);
      ctx.lineTo(12, 8);
    } else {
      ctx.moveTo(4, -7);
      ctx.lineTo(9, -10 + swing * 0.4);
      ctx.moveTo(4, 7);
      ctx.lineTo(9, 10 - swing * 0.4);
    }
    ctx.stroke();
    // Gun in hand when aiming.
    if (opts.aiming) {
      ctx.fillStyle = '#22252a';
      ctx.fillRect(9, -2, 10, 3.5);
    }
    // Head.
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(6, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = opts.hair || '#2a2018';
    ctx.beginPath();
    ctx.arc(4, 0, 7, Math.PI * 0.6, Math.PI * 1.4);
    ctx.fill();
    ctx.restore();
    // Enemy health bar.
    if (opts.hpBar) {
      const w = 30;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(s.x - w / 2, s.y - 26, w, 5);
      ctx.fillStyle = '#e84a3a';
      ctx.fillRect(s.x - w / 2 + 1, s.y - 25, (w - 2) * clamp(opts.hpBar, 0, 1), 3);
    }
    if (opts.label) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(opts.label, s.x, s.y - 30);
    }
  }

  function drawEntities(G, cam, sx, sy, light, input) {
    // Pickups.
    for (const pk of G.pickups) {
      const s = worldToScreen(pk.x, pk.y, cam, sx, sy);
      if (s.x < -30 || s.x > viewW + 30 || s.y < -30 || s.y > viewH + 30) continue;
      const bob = Math.sin(pk.bob) * 3;
      ctx.save();
      ctx.translate(s.x, s.y + bob);
      if (pk.kind === 'cash') {
        ctx.fillStyle = '#e8c85a';
        roundRect(ctx, -9, -6, 18, 12, 2);
        ctx.fill();
        ctx.fillStyle = '#7a6410';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('$', 0, 4);
      } else if (pk.kind === 'ammo') {
        ctx.fillStyle = '#8a6a3a';
        roundRect(ctx, -9, -6, 18, 12, 2);
        ctx.fill();
        ctx.fillStyle = '#ffd75a';
        ctx.fillRect(-6, -3, 3, 6);
        ctx.fillRect(-1, -3, 3, 6);
        ctx.fillRect(4, -3, 3, 6);
      } else {
        ctx.fillStyle = '#e8e8e8';
        roundRect(ctx, -9, -9, 18, 18, 3);
        ctx.fill();
        ctx.fillStyle = '#d83a3a';
        ctx.fillRect(-2.5, -6, 5, 12);
        ctx.fillRect(-6, -2.5, 12, 5);
      }
      ctx.restore();
    }
    // Cars (parked + traffic + driven).
    for (const car of G.cars) drawCar(G, car, cam, sx, sy, light);
    for (const cop of G.cops) drawCar(G, cop, cam, sx, sy, light);
    // Pedestrians.
    for (const ped of G.peds) {
      if (ped.state === 'down') {
        const s = worldToScreen(ped.x, ped.y, cam, sx, sy);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(ped.angle);
        ctx.fillStyle = ped.shirt;
        roundRect(ctx, -13, -6, 26, 12, 5);
        ctx.fill();
        ctx.fillStyle = ped.skin;
        ctx.beginPath();
        ctx.arc(13, 0, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        drawPerson(G, ped.x, ped.y, ped.angle, ped.shirt, ped.skin, ped.walkPhase, cam, sx, sy, {
          label: ped.sideJob ? '!' : null,
        });
      }
    }
    // Enemies.
    for (const e of G.enemies) {
      if (e.dead) continue;
      drawPerson(G, e.x, e.y, e.angle, e.shirt, '#c98d5e', e.walkPhase, cam, sx, sy, {
        hurt: e.hurtT > 0,
        aiming: e.kind === 'shooter' && e.alerted,
        hpBar: e.hp / e.maxHp,
        hair: '#1a1a1a',
      });
    }
    // Player (on foot only — while driving, the car is the body).
    const p = G.player;
    if (!p.car) {
      drawPerson(G, p.x, p.y, p.angle, '#2e7ad8', '#e8b98a', p.walkPhase, cam, sx, sy, {
        hurt: p.hurtT > 0,
        punching: p.punchAnim > 0,
        aiming: !!(input && input.mouse.down),
        hair: '#20242c',
      });
    }
    // Bullets as tracers.
    ctx.lineCap = 'round';
    for (const b of G.bullets) {
      const s = worldToScreen(b.x, b.y, cam, sx, sy);
      const len = 12;
      const m = Math.hypot(b.vx, b.vy) || 1;
      ctx.strokeStyle = b.from === 'player' ? '#ffe89a' : '#ff9a7a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(s.x - (b.vx / m) * len, s.y - (b.vy / m) * len);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }
    // Particles.
    for (const pt of G.particles) {
      const s = worldToScreen(pt.x, pt.y, cam, sx, sy);
      ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Marker, lighting ----------

  function drawMarker(G, cam, sx, sy) {
    const m = G.marker;
    if (!m) return;
    const s = worldToScreen(m.x, m.y, cam, sx, sy);
    const onScreen = s.x > 30 && s.x < viewW - 30 && s.y > 30 && s.y < viewH - 30;
    if (onScreen) {
      const pulse = 1 + Math.sin(G.time * 4) * 0.12;
      const grad = ctx.createRadialGradient(s.x, s.y, 4, s.x, s.y, 46 * pulse);
      grad.addColorStop(0, 'rgba(255,215,90,0.55)');
      grad.addColorStop(1, 'rgba(255,215,90,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 46 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd75a';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1c2430';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('★', s.x, s.y + 4);
      if (m.label) {
        ctx.fillStyle = '#ffd75a';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(m.label, s.x, s.y - 52);
      }
      // Light pillar.
      ctx.fillStyle = 'rgba(255,215,90,0.16)';
      ctx.fillRect(s.x - 7, s.y - 190, 14, 190);
    } else {
      // Edge arrow pointing at the off-screen marker.
      const cx = viewW / 2;
      const cy = viewH / 2;
      const ang = Math.atan2(s.y - cy, s.x - cx);
      const ex = cx + Math.cos(ang) * (Math.min(viewW, viewH) / 2 - 46);
      const ey = cy + Math.sin(ang) * (Math.min(viewW, viewH) / 2 - 46);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(ang);
      ctx.fillStyle = '#ffd75a';
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-8, -11);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-8, 11);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      const d = Math.round(dist(G.player.x, G.player.y, m.x, m.y));
      ctx.fillStyle = '#ffd75a';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(d + 'm', ex, ey + 26);
    }
  }

  function drawLighting(G, cam, sx, sy, light) {
    const night = 1 - light;
    if (night < 0.08) return;
    ctx.fillStyle = `rgba(8,12,38,${night * 0.5})`;
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Lamp glows.
    for (const lamp of G.city.lamps) {
      const s = worldToScreen(lamp.x, lamp.y, cam, sx, sy);
      if (s.x < -90 || s.x > viewW + 90 || s.y < -90 || s.y > viewH + 90) continue;
      const grad = ctx.createRadialGradient(s.x, s.y, 2, s.x, s.y, 85);
      grad.addColorStop(0, `rgba(255,220,130,${0.34 * night})`);
      grad.addColorStop(1, 'rgba(255,220,130,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 85, 0, Math.PI * 2);
      ctx.fill();
    }
    // Headlight cones for moving cars.
    const cars = G.cars.concat(G.cops);
    for (const car of cars) {
      if (Math.abs(car.speed) < 8 && car.driver !== 'player') continue;
      const s = worldToScreen(car.x, car.y, cam, sx, sy);
      if (s.x < -160 || s.x > viewW + 160 || s.y < -160 || s.y > viewH + 160) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(car.angle);
      const grad = ctx.createLinearGradient(20, 0, 170, 0);
      grad.addColorStop(0, `rgba(255,244,200,${0.30 * night})`);
      grad.addColorStop(1, 'rgba(255,244,200,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(20, -9);
      ctx.lineTo(170, -52);
      ctx.lineTo(170, 52);
      ctx.lineTo(20, 9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ---------- HUD ----------

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(10,14,20,0.62)';
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawHUD(G) {
    const p = G.player;
    // Status panel (top-left).
    panel(14, 14, 218, 86);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('RIAN', 26, 36);
    // HP bar.
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    roundRect(ctx, 26, 44, 150, 10, 5);
    ctx.fill();
    const hpFrac = clamp(p.hp / p.maxHp, 0, 1);
    ctx.fillStyle = hpFrac > 0.5 ? '#5ac86a' : hpFrac > 0.25 ? '#e8c85a' : '#e84a3a';
    if (hpFrac > 0) {
      roundRect(ctx, 26, 44, 150 * hpFrac, 10, 5);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = '13px sans-serif';
    ctx.fillText(`$${p.cash}`, 26, 74);
    ctx.fillText(`Ammo ${p.ammo}`, 110, 74);
    // Wanted stars (top-right).
    if (G.wanted > 0) {
      panel(viewW - 196, 14, 182, 40);
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'left';
      for (let i = 0; i < 5; i += 1) {
        ctx.fillStyle = i < G.wanted ? '#ffd75a' : 'rgba(255,255,255,0.25)';
        ctx.fillText('★', viewW - 182 + i * 34, 42);
      }
    }
    // Objective bar (bottom-centre).
    ctx.font = 'bold 14px sans-serif';
    const ow = Math.min(viewW - 40, ctx.measureText(G.objective).width + 36);
    panel(viewW / 2 - ow / 2, viewH - 52, ow, 34);
    ctx.fillStyle = '#ffd75a';
    ctx.textAlign = 'center';
    ctx.fillText(G.objective, viewW / 2, viewH - 30);
    // Toasts above the objective.
    ctx.font = '13px sans-serif';
    G.toasts.forEach((t, i) => {
      ctx.globalAlpha = clamp(t.t, 0, 1);
      const y = viewH - 66 - (G.toasts.length - 1 - i) * 22;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(t.text, viewW / 2, y);
    });
    ctx.globalAlpha = 1;
    // Speedometer while driving.
    if (p.car) {
      const kmh = Math.round(Math.abs(p.car.speed) * 0.32);
      panel(viewW - 128, viewH - 52, 114, 34);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${kmh} km/h`, viewW - 71, viewH - 30);
    }
    // Controls hint (fades).
    if (G.helpT > 0) {
      ctx.globalAlpha = clamp(G.helpT / 3, 0, 0.85);
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('WASD move/drive · E enter car · F punch · Click shoot · H horn · N side job · P pause', 16, viewH - 66);
      ctx.globalAlpha = 1;
    }
    // Save flash.
    if (G.saveFlash > 0) {
      ctx.globalAlpha = clamp(G.saveFlash, 0, 1);
      ctx.fillStyle = '#5ac86a';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✓ Progress saved', viewW / 2, 30);
      ctx.globalAlpha = 1;
    }
    // Damage vignette.
    if (p.hurtT > 0) {
      const a = clamp(p.hurtT * 0.9, 0, 0.5);
      const grad = ctx.createRadialGradient(viewW / 2, viewH / 2, Math.min(viewW, viewH) * 0.32, viewW / 2, viewH / 2, Math.max(viewW, viewH) * 0.7);
      grad.addColorStop(0, 'rgba(200,30,30,0)');
      grad.addColorStop(1, `rgba(200,30,30,${a})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, viewW, viewH);
    }
    // Clock: day/night indicator.
    const hours = Math.floor(G.timeOfDay * 24);
    const mins = Math.floor((G.timeOfDay * 24 - hours) * 60);
    panel(viewW - 108, 66, 94, 30);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`, viewW - 61, 86);
  }

  function drawMinimap(G) {
    const size = 172;
    const mx = viewW - size - 14;
    const my = viewH - size - 14;
    const key = `${G.city.buildings.length}`;
    if (!mapCache || mapCacheKey !== key) {
      mapCache = document.createElement('canvas');
      mapCache.width = size;
      mapCache.height = size;
      const mctx = mapCache.getContext('2d');
      const sc = size / WORLD;
      mctx.fillStyle = '#243024';
      mctx.fillRect(0, 0, size, size);
      mctx.fillStyle = '#4a4d48';
      for (let i = 0; i < NODES; i += 1) {
        const c = i * BLOCK * sc;
        mctx.fillRect(c - (ROAD_W * sc) / 2, 0, ROAD_W * sc, size);
        mctx.fillRect(0, c - (ROAD_W * sc) / 2, size, ROAD_W * sc);
      }
      mctx.fillStyle = '#5d5a52';
      for (const b of G.city.buildings) {
        mctx.fillRect(b.x * sc, b.y * sc, Math.max(1.5, b.w * sc), Math.max(1.5, b.h * sc));
      }
      mapCacheKey = key;
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(mx + size / 2, my + size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(mapCache, mx, my);
    const sc = size / WORLD;
    const blip = (x, y, color, r) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(mx + x * sc, my + y * sc, r, 0, Math.PI * 2);
      ctx.fill();
    };
    if (G.marker) blip(G.marker.x, G.marker.y, '#ffd75a', 5);
    for (const e of G.enemies) if (!e.dead) blip(e.x, e.y, '#e84a3a', 3);
    for (const cop of G.cops) blip(cop.x, cop.y, '#5a9ae8', 3.5);
    blip(G.player.x, G.player.y, '#ffffff', 4.5);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mx + size / 2, my + size / 2, size / 2, 0, Math.PI * 2);
    ctx.stroke();
    // North tick.
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', mx + size / 2, my + 14);
  }

  // ---------- Dialog ----------

  function drawDialog(G) {
    const d = G.dialog;
    if (!d) return;
    const line = d.lines[d.i];
    const w = Math.min(viewW - 80, 760);
    const h = 118;
    const x = (viewW - w) / 2;
    const y = viewH - h - 24;
    panel(x, y, w, h);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffd75a';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(line.who, x + 24, y + 30);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px sans-serif';
    const lines = wrapText(ctx, line.text, w - 48);
    lines.forEach((ln, i) => ctx.fillText(ln, x + 24, y + 58 + i * 22));
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`Space ▸  ${d.i + 1}/${d.lines.length}`, x + w - 20, y + h - 14);
  }

  // ---------- Screens ----------

  function drawButton(b, hover) {
    ctx.fillStyle = hover ? '#e8b93c' : 'rgba(20,26,36,0.85)';
    roundRect(ctx, b.x, b.y, b.w, b.h, 10);
    ctx.fill();
    ctx.strokeStyle = hover ? '#ffd75a' : 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = hover ? '#1c2430' : '#ffffff';
    ctx.font = 'bold 17px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 6);
  }

  function skyline(seed, w, h, horizonY) {
    const rng = mulberry32(seed);
    const grad = ctx.createLinearGradient(0, 0, 0, horizonY);
    grad.addColorStop(0, '#1a2340');
    grad.addColorStop(0.6, '#4a3560');
    grad.addColorStop(1, '#c96a4a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, horizonY + 2);
    // Sun glow.
    const sg = ctx.createRadialGradient(w * 0.68, horizonY - 60, 10, w * 0.68, horizonY - 60, 190);
    sg.addColorStop(0, 'rgba(255,200,120,0.8)');
    sg.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, w, horizonY);
    // Far + near building silhouettes.
    for (let layer = 0; layer < 2; layer += 1) {
      ctx.fillStyle = layer === 0 ? '#232c44' : '#141a2c';
      let x = -20;
      while (x < w + 20) {
        const bw = 40 + rng() * 90;
        const bh = (layer === 0 ? 90 : 150) + rng() * (layer === 0 ? 130 : 190);
        ctx.fillRect(x, horizonY - bh, bw, bh + 4);
        if (layer === 1 && rng() < 0.5) {
          ctx.fillRect(x + bw * 0.4, horizonY - bh - 16, 5, 16);
        }
        x += bw + 6 + rng() * 20;
      }
    }
    // Lit windows on the near layer.
    ctx.fillStyle = 'rgba(255,215,110,0.75)';
    const wrng = mulberry32(seed + 7);
    for (let i = 0; i < 130; i += 1) {
      const wx = wrng() * w;
      const wy = horizonY - 30 - wrng() * 260;
      if (wy > 20) ctx.fillRect(wx, wy, 4, 6);
    }
    // Street.
    ctx.fillStyle = '#0d1017';
    ctx.fillRect(0, horizonY, w, h - horizonY);
    ctx.fillStyle = '#c9c46a';
    for (let x = 20; x < w; x += 90) ctx.fillRect(x, horizonY + 34, 42, 4);
  }

  function titleScreen(G, ui) {
    skyline(7, viewW, viewH, viewH * 0.62);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd75a';
    ctx.font = 'bold 74px sans-serif';
    ctx.fillText('PELITA CITY', viewW / 2, viewH * 0.3);
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px sans-serif';
    ctx.fillText('An open-world crime story — drive, hustle, and stay ahead of the law.', viewW / 2, viewH * 0.3 + 38);
    const buttons = [];
    const bw = 300;
    const bh = 50;
    const bx = viewW / 2 - bw / 2;
    let by = viewH * 0.62 + 20;
    buttons.push({ id: 'new', label: '▶  New Game', x: bx, y: by, w: bw, h: bh });
    by += bh + 14;
    if (ui.hasSave) {
      buttons.push({ id: 'continue', label: '↻  Continue', x: bx, y: by, w: bw, h: bh });
      by += bh + 14;
    }
    buttons.push({ id: 'help', label: '?  How to Play', x: bx, y: by, w: bw, h: bh });
    for (const b of buttons) drawButton(b, ui.hover === b.id);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '12px sans-serif';
    ctx.fillText('Built for the make.fun “Make GTA 6” bounty · keyboard + mouse · no downloads', viewW / 2, viewH - 18);
    return buttons;
  }

  function pauseScreen(G, ui) {
    ctx.fillStyle = 'rgba(5,8,14,0.66)';
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 52px sans-serif';
    ctx.fillText('PAUSED', viewW / 2, viewH * 0.3);
    ctx.font = '15px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(`Cash $${G.player.cash} · Missions ${G.stats.missionsDone}/3 · Cars stolen ${G.stats.carsStolen}`, viewW / 2, viewH * 0.3 + 34);
    const buttons = [];
    const bw = 280;
    const bh = 48;
    const bx = viewW / 2 - bw / 2;
    let by = viewH * 0.42;
    buttons.push({ id: 'resume', label: 'Resume', x: bx, y: by, w: bw, h: bh });
    by += bh + 12;
    buttons.push({ id: 'save', label: 'Save Game', x: bx, y: by, w: bw, h: bh });
    by += bh + 12;
    buttons.push({ id: 'quit', label: 'Quit to Title', x: bx, y: by, w: bw, h: bh });
    for (const b of buttons) drawButton(b, ui.hover === b.id);
    return buttons;
  }

  function bustedScreen(G, ui) {
    ctx.fillStyle = 'rgba(10,6,8,0.72)';
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e84a3a';
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText('BUSTED', viewW / 2, viewH * 0.36);
    ctx.fillStyle = '#ffffff';
    ctx.font = '17px sans-serif';
    ctx.fillText('The Pelita City police caught up with you.', viewW / 2, viewH * 0.36 + 40);
    ctx.fillText('You pay a fine and walk free — the city is still yours to take.', viewW / 2, viewH * 0.36 + 66);
    const buttons = [];
    const bw = 300;
    const bh = 50;
    buttons.push({ id: 'respawn', label: 'Back to the Streets', x: viewW / 2 - bw / 2, y: viewH * 0.52, w: bw, h: bh });
    for (const b of buttons) drawButton(b, ui.hover === b.id);
    return buttons;
  }

  function helpScreen(G, ui) {
    ctx.fillStyle = 'rgba(5,8,14,0.9)';
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd75a';
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText('HOW TO PLAY', viewW / 2, 90);
    const lines = [
      ['W A S D / Arrows', 'Walk, or drive when in a car (W gas, S brake/reverse)'],
      ['Shift', 'Run on foot'],
      ['E', 'Enter / exit the nearest car (stealing one earns a wanted star)'],
      ['Mouse + Click', 'Aim and shoot (costs ammo — grab the yellow boxes)'],
      ['F', 'Punch'],
      ['H', 'Horn'],
      ['N', 'Take a side job (taxi fare / cash collection)'],
      ['Space / Enter', 'Advance dialog'],
      ['P or Esc', 'Pause'],
      ['M', 'Mute sound'],
      ['', ''],
      ['GOAL', 'Finish all 3 missions for Bos Darma and Sari. Stars mean the'],
      ['', 'police are hunting you — break line of sight to cool down.'],
    ];
    ctx.font = '16px sans-serif';
    let y = 140;
    for (const [key, desc] of lines) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffd75a';
      ctx.fillText(key, viewW / 2 - 20, y);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(desc, viewW / 2 + 20, y);
      y += 30;
    }
    const buttons = [{ id: 'back', label: 'Back', x: viewW / 2 - 130, y: y + 16, w: 260, h: 48 }];
    for (const b of buttons) drawButton(b, ui.hover === b.id);
    return buttons;
  }

  // ---------- Entry point ----------

  function draw(G, ui, input) {
    const buttons = [];
    const light = daylight(G.timeOfDay);
    if (G.mode === 'title') {
      return titleScreen(G, ui);
    }
    if (G.mode === 'help') {
      return helpScreen(G, ui);
    }
    // World screens (play / pause / dialog / busted share the world view).
    const shakeX = G.camera.shake > 0 ? (Math.random() - 0.5) * G.camera.shake : 0;
    const shakeY = G.camera.shake > 0 ? (Math.random() - 0.5) * G.camera.shake : 0;
    drawWorld(G, G.camera, shakeX, shakeY, light);
    drawEntities(G, G.camera, shakeX, shakeY, light, input);
    drawMarker(G, G.camera, shakeX, shakeY);
    drawLighting(G, G.camera, shakeX, shakeY, light);
    drawHUD(G);
    drawMinimap(G);
    if (G.mode === 'dialog') drawDialog(G);
    if (G.mode === 'pause') return pauseScreen(G, ui);
    if (G.mode === 'busted') return bustedScreen(G, ui);
    return buttons;
  }

  return { resize, draw, get viewW() { return viewW; }, get viewH() { return viewH; } };
}
