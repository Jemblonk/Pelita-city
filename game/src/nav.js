// Road-graph navigation: BFS over the 9x9 intersection grid, and line-of-sight
// tests against building rects. Police use both: BFS waypoints to stay on
// roads, line of sight to decide when a direct chase is possible.
import { NODES, BLOCK } from './config.js';
import { nearestNodeIJ, nodePos } from './city.js';
import { segmentsCross } from './util.js';

/**
 * Shortest path of intersection points from the node nearest (sx, sy) to the
 * node nearest (tx, ty). Returns an array of {x, y} waypoints including the
 * destination node, or [] when already at the target node.
 */
export function findRoadPath(sx, sy, tx, ty) {
  const start = nearestNodeIJ(sx, sy);
  const goal = nearestNodeIJ(tx, ty);
  if (start.i === goal.i && start.j === goal.j) return [];
  const prev = new Map();
  const queue = [[start.i, start.j]];
  prev.set(start.i + ',' + start.j, null);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (queue.length > 0) {
    const [i, j] = queue.shift();
    if (i === goal.i && j === goal.j) break;
    for (const [di, dj] of dirs) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || ni >= NODES || nj < 0 || nj >= NODES) continue;
      const key = ni + ',' + nj;
      if (prev.has(key)) continue;
      prev.set(key, [i, j]);
      queue.push([ni, nj]);
    }
  }
  const goalKey = goal.i + ',' + goal.j;
  if (!prev.has(goalKey)) return [];
  const path = [];
  let cur = [goal.i, goal.j];
  while (cur !== null) {
    path.push(nodePos(cur[0], cur[1]));
    cur = prev.get(cur[0] + ',' + cur[1]);
  }
  path.reverse();
  path.shift(); // drop the start node: the caller is already heading from it
  return path;
}

/** True when the straight segment between two points crosses no building. */
export function losClear(x1, y1, x2, y2, solids) {
  for (let k = 0; k < solids.length; k += 1) {
    const s = solids[k];
    // Fast reject: segment bounding box vs rect.
    if (Math.max(x1, x2) < s.x || Math.min(x1, x2) > s.x + s.w) continue;
    if (Math.max(y1, y2) < s.y || Math.min(y1, y2) > s.y + s.h) continue;
    // Either endpoint inside the rect blocks sight.
    if (pointInRect(x1, y1, s) || pointInRect(x2, y2, s)) return false;
    // Or the segment crosses any of the four edges.
    if (
      segmentsCross(x1, y1, x2, y2, s.x, s.y, s.x + s.w, s.y) ||
      segmentsCross(x1, y1, x2, y2, s.x + s.w, s.y, s.x + s.w, s.y + s.h) ||
      segmentsCross(x1, y1, x2, y2, s.x + s.w, s.y + s.h, s.x, s.y + s.h) ||
      segmentsCross(x1, y1, x2, y2, s.x, s.y + s.h, s.x, s.y)
    ) {
      return false;
    }
  }
  return true;
}

function pointInRect(x, y, s) {
  return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
}

/** Heading (radians) from a car at (x, y) toward the next waypoint, with a
 *  small lane offset so pursuit cars do not all stack on the centre line. */
export function waypointHeading(x, y, wp, laneOffset) {
  const tx = wp.x + (laneOffset || 0);
  const ty = wp.y;
  return Math.atan2(ty - y, tx - x);
}

export { BLOCK };
