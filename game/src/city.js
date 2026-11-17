// Procedural city: a fixed-seed layout of roads, blocks, buildings, parks,
// trees and lamps. Deterministic — the same seed always builds the same city,
// which is what makes staged screenshots reproducible.
import { BLOCK, CITY_SEED, NODES, ROAD_W, WORLD } from './config.js';
import { intRange, mulberry32, pick, range } from './util.js';

const ROOF_TINTS = ['#7d7468', '#6f7a82', '#84705a', '#6b6f7a', '#7a6b5e', '#5f7a6d'];
const WALL_TINTS = ['#8a7f70', '#7d8894', '#96856e', '#7e8196', '#8a7a66', '#74908a'];
const TREE_GREENS = ['#2c5a2e', '#35703a', '#2a4d33', '#3d7a3f'];

/** Distance from `v` to the nearest road centre line (multiples of BLOCK). */
function distToRoadLine(v) {
  const m = ((v % BLOCK) + BLOCK) % BLOCK;
  return Math.min(m, BLOCK - m);
}

export function isRoad(x, y) {
  return distToRoadLine(x) <= ROAD_W / 2 || distToRoadLine(y) <= ROAD_W / 2;
}

/** Nearest point on a road centre line to (x, y): snaps the closer axis. */
export function roadCenterNear(x, y) {
  const cx = Math.round(x / BLOCK) * BLOCK;
  const cy = Math.round(y / BLOCK) * BLOCK;
  if (Math.abs(cx - x) <= Math.abs(cy - y)) return { x: cx, y };
  return { x, y: cy };
}

/** Intersection node (i, j) position, i and j in 0..NODES-1. */
export function nodePos(i, j) {
  return { x: i * BLOCK, y: j * BLOCK };
}

/** Node indices nearest to (x, y), clamped to the grid. */
export function nearestNodeIJ(x, y) {
  const i = Math.max(0, Math.min(NODES - 1, Math.round(x / BLOCK)));
  const j = Math.max(0, Math.min(NODES - 1, Math.round(y / BLOCK)));
  return { i, j };
}

export function nearestNodePos(x, y) {
  const { i, j } = nearestNodeIJ(x, y);
  return nodePos(i, j);
}

/**
 * Push a circle at (x, y) with radius r out of every solid rect in `solids`
 * (and the world bounds). Returns the corrected {x, y}. Pure: no mutation.
 */
export function collideCircle(x, y, r, solids) {
  let cx = Math.max(r, Math.min(WORLD - r, x));
  let cy = Math.max(r, Math.min(WORLD - r, y));
  for (let k = 0; k < solids.length; k += 1) {
    const s = solids[k];
    const nx = Math.max(s.x, Math.min(cx, s.x + s.w));
    const ny = Math.max(s.y, Math.min(cy, s.y + s.h));
    const dx = cx - nx;
    const dy = cy - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      cx = nx + (dx / d) * r;
      cy = ny + (dy / d) * r;
    } else {
      // Centre inside the rect: push out along the smallest penetration.
      const pushL = cx - s.x + r;
      const pushR = s.x + s.w - cx + r;
      const pushT = cy - s.y + r;
      const pushB = s.y + s.h - cy + r;
      const m = Math.min(pushL, pushR, pushT, pushB);
      if (m === pushL) cx = s.x - r;
      else if (m === pushR) cx = s.x + s.w + r;
      else if (m === pushT) cy = s.y - r;
      else cy = s.y + s.h + r;
    }
  }
  return { x: cx, y: cy };
}

/**
 * Build the city. Returns { buildings, trees, lamps, parks, lots, solids }.
 * buildings: {x,y,w,h,roof,wall,floors,winSeed}. trees: {x,y,r,green}.
 * lamps: {x,y} at intersection corners. parks: block rects kept green.
 * lots: parking-lot rects with car slots. solids: collision rects (buildings).
 */
export function generateCity(seed = CITY_SEED) {
  const rng = mulberry32(seed);
  const buildings = [];
  const trees = [];
  const lamps = [];
  const parks = [];
  const lots = [];
  const inset = ROAD_W / 2 + 12; // sidewalk ring inside each block

  for (let bi = 0; bi < NODES - 1; bi += 1) {
    for (let bj = 0; bj < NODES - 1; bj += 1) {
      const bx = bi * BLOCK + inset;
      const by = bj * BLOCK + inset;
      const bw = BLOCK - inset * 2;
      const bh = BLOCK - inset * 2;
      const roll = rng();
      if (roll < 0.16) {
        // Park: grass + scattered trees, no buildings.
        parks.push({ x: bx, y: by, w: bw, h: bh });
        const n = intRange(rng, 5, 9);
        for (let t = 0; t < n; t += 1) {
          trees.push({
            x: bx + range(rng, 30, bw - 30),
            y: by + range(rng, 30, bh - 30),
            r: range(rng, 13, 20),
            green: pick(rng, TREE_GREENS),
          });
        }
      } else if (roll < 0.26) {
        // Parking lot: open asphalt with marked slots along the edges.
        const slots = [];
        const n = intRange(rng, 4, 7);
        for (let s = 0; s < n; s += 1) {
          slots.push({
            x: bx + 24 + s * ((bw - 48) / Math.max(1, n - 1)),
            y: by + 26,
            angle: Math.PI / 2,
          });
        }
        lots.push({ x: bx, y: by, w: bw, h: bh, slots });
        trees.push({ x: bx + 18, y: by + bh - 18, r: 15, green: pick(rng, TREE_GREENS) });
        trees.push({ x: bx + bw - 18, y: by + bh - 18, r: 15, green: pick(rng, TREE_GREENS) });
      } else {
        // Built block: 1 large building, or 2x2 smaller ones.
        const quad = rng() < 0.55;
        const cells = quad ? 2 : 1;
        const gap = 18;
        const cw = (bw - gap * (cells - 1)) / cells;
        const ch = (bh - gap * (cells - 1)) / cells;
        for (let cx = 0; cx < cells; cx += 1) {
          for (let cy = 0; cy < cells; cy += 1) {
            const pad = range(rng, 4, 14);
            buildings.push({
              x: bx + cx * (cw + gap) + pad,
              y: by + cy * (ch + gap) + pad,
              w: cw - pad * 2,
              h: ch - pad * 2,
              roof: pick(rng, ROOF_TINTS),
              wall: pick(rng, WALL_TINTS),
              floors: intRange(rng, 2, 6),
              winSeed: Math.floor(rng() * 1e9),
            });
          }
        }
        // A couple of street trees on the sidewalk corners.
        if (rng() < 0.7) {
          trees.push({ x: bx - 6, y: by - 6, r: 12, green: pick(rng, TREE_GREENS) });
        }
        if (rng() < 0.5) {
          trees.push({ x: bx + bw + 6, y: by + bh + 6, r: 12, green: pick(rng, TREE_GREENS) });
        }
      }
    }
  }

  // Street lamps at every intersection corner (offset onto the sidewalk).
  for (let i = 0; i < NODES; i += 1) {
    for (let j = 0; j < NODES; j += 1) {
      lamps.push({ x: i * BLOCK + ROAD_W / 2 + 6, y: j * BLOCK + ROAD_W / 2 + 6 });
      lamps.push({ x: i * BLOCK - ROAD_W / 2 - 6, y: j * BLOCK - ROAD_W / 2 - 6 });
    }
  }

  const solids = buildings.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
  return { buildings, trees, lamps, parks, lots, solids };
}
