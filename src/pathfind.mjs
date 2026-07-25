// Universal, dependency-free A* path planner (notes/plans/goal-level-autonomy-2026-07.md).
//
// This is the *backend-agnostic* navigation intelligence: it plans over a plain world
// snapshot — `isSolid(x,y,z) → boolean` — so it works for ANY executor that can describe its
// surroundings (a Mineflayer bot, the Fabric client agent, a server agent), not just one with
// a native pathfinder. The goal engine uses it to compose navigation from primitives when a
// target has no native `navigate` capability. Pure and fully unit-testable.
//
// Model: a walkable cell is a block position (x,y,z) an entity can stand in — air at (x,y,z)
// and (x,y+1,z) (head room), solid at (x,y-1,z) (ground). Steps go N/S/E/W and may step up by
// one (a jump) or down by up to `maxDrop`. Cost is 1 per step (+ a small jump surcharge);
// the heuristic is octile-ish (admissible) so A* stays optimal.

const HORIZONTAL = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

function key(x, y, z) {
  return `${x},${y},${z}`;
}

function standable(isSolid, x, y, z) {
  return !isSolid(x, y, z) && !isSolid(x, y + 1, z) && isSolid(x, y - 1, z);
}

/** Where can you go from (x,y,z) in one step? Considers flat, step-up (jump), and step-down. */
function neighbors(isSolid, x, y, z, maxDrop) {
  const out = [];
  for (const [dx, dz] of HORIZONTAL) {
    const nx = x + dx;
    const nz = z + dz;
    // Flat.
    if (standable(isSolid, nx, y, nz)) {
      out.push([nx, y, nz, 1]);
      continue;
    }
    // Step up one (jump) — needs clearance above the current head, too.
    if (!isSolid(x, y + 2, z) && standable(isSolid, nx, y + 1, nz)) {
      out.push([nx, y + 1, nz, 1.5]);
      continue;
    }
    // Step down (fall) up to maxDrop.
    for (let d = 1; d <= maxDrop; d++) {
      if (standable(isSolid, nx, y - d, nz)) {
        out.push([nx, y - d, nz, 1 + d * 0.5]);
        break;
      }
      if (isSolid(nx, y - d, nz)) break; // blocked below — no further drop
    }
  }
  return out;
}

function heuristic(x, y, z, gx, gy, gz) {
  return Math.abs(x - gx) + Math.abs(y - gy) + Math.abs(z - gz);
}

/**
 * Plan a path of block waypoints from `start` to `goal` over a world snapshot.
 * @param {{x,y,z}} start   the standing position to plan from
 * @param {{x,y,z,range?}} goal  target; `range` (default 0) accepts any cell within it
 * @param {(x,y,z)=>boolean} isSolid  world snapshot: is this block collidable?
 * @param {{maxDrop?:number, maxExpansions?:number}} [opts]
 * @returns {Array<{x,y,z}>|null}  waypoints INCLUDING start and the reached cell, or null
 */
export function plan(start, goal, isSolid, { maxDrop = 3, maxExpansions = 20_000 } = {}) {
  const sx = Math.floor(start.x);
  const sy = Math.floor(start.y);
  const sz = Math.floor(start.z);
  const gx = Math.floor(goal.x);
  const gy = Math.floor(goal.y);
  const gz = Math.floor(goal.z);
  const range = goal.range ?? 0;

  const reached = (x, y, z) => Math.abs(x - gx) + Math.abs(y - gy) + Math.abs(z - gz) <= range
    || (range === 0 && x === gx && y === gy && z === gz);

  const startK = key(sx, sy, sz);
  const open = new Map([[startK, { x: sx, y: sy, z: sz, g: 0, f: heuristic(sx, sy, sz, gx, gy, gz) }]]);
  const cameFrom = new Map();
  const gScore = new Map([[startK, 0]]);
  const closed = new Set();
  let expansions = 0;

  while (open.size > 0) {
    if (++expansions > maxExpansions) return null; // bounded — never spin forever

    // Pop the lowest-f open node (small maps — linear scan is fine and dependency-free).
    let bestK = null;
    let best = null;
    for (const [k, n] of open) {
      if (!best || n.f < best.f) { best = n; bestK = k; }
    }
    open.delete(bestK);
    closed.add(bestK);

    if (reached(best.x, best.y, best.z)) {
      const path = [];
      let ck = bestK;
      let cur = best;
      while (cur) {
        path.push({ x: cur.x, y: cur.y, z: cur.z });
        ck = cameFrom.get(ck);
        cur = ck ? nodeFromKey(ck) : null;
      }
      return path.reverse();
    }

    for (const [nx, ny, nz, cost] of neighbors(isSolid, best.x, best.y, best.z, maxDrop)) {
      const nk = key(nx, ny, nz);
      if (closed.has(nk)) continue;
      const tentative = best.g + cost;
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, bestK);
        gScore.set(nk, tentative);
        open.set(nk, { x: nx, y: ny, z: nz, g: tentative, f: tentative + heuristic(nx, ny, nz, gx, gy, gz) });
      }
    }
  }
  return null; // exhausted — no path
}

function nodeFromKey(k) {
  const [x, y, z] = k.split(',').map(Number);
  return { x, y, z };
}
