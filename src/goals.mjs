// The backend-agnostic goal engine (notes/plans/goal-level-autonomy-2026-07.md).
//
// A goal is a high-level intent ("navigate to X"); the engine plans it over an executor's
// ADVERTISED capabilities and dispatches — delegating to a native capability when the target
// has one, else composing the goal from primitives. This is where a single intent becomes
// many steps, universally, without knowing the target's type. Pure orchestration: every seam
// is injectable, so it is fully unit-testable against fake executors.

import { plan as planPath } from './pathfind.mjs';

/** Yaw (degrees) that points from `from` toward `to` in Minecraft's coordinate convention. */
export function yawTo(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  // MC yaw: 0 = +Z (south), increasing clockwise; atan2(-dx, dz) gives that convention.
  // `+ 0` normalises the -0 that atan2(-0, +z) yields, so callers never see negative zero.
  return (Math.atan2(-dx, dz) * 180) / Math.PI + 0;
}

/** Walk an executor along a waypoint list using its `look` + `move` primitives. */
export async function walkWaypoints(executor, waypoints, { stepMs = 400 } = {}) {
  for (let i = 1; i < waypoints.length; i++) {
    await executor.invoke('look', { yaw: yawTo(waypoints[i - 1], waypoints[i]) });
    await executor.invoke('move', { direction: 'forward', ms: stepMs });
  }
  return { steps: waypoints.length - 1 };
}

/** Turn a world snapshot ({solids:[{x,y,z}]} or a Set of "x,y,z") into an isSolid(x,y,z). */
function makeIsSolid(snapshot) {
  const set = snapshot instanceof Set
    ? snapshot
    : new Set((snapshot?.solids ?? []).map((b) => `${b.x},${b.y},${b.z}`));
  return (x, y, z) => set.has(`${x},${y},${z}`);
}

/**
 * Navigate an executor to (x,y,z). The strategy is chosen from advertised capabilities:
 *   1. `navigate` (native, e.g. Mineflayer pathfinder) — delegate; best quality.
 *   2. `world_snapshot` + `position` + `look` + `move` — plan an A* path over the snapshot and
 *      walk the waypoints. The universal path: any backend that can describe its surroundings
 *      navigates, not just one with a built-in pathfinder.
 * Seams (`planFn`, `walk`) are injectable for tests.
 */
export async function navigate(executor, { x, y, z, range = 1 }, { planFn = planPath, walk = walkWaypoints } = {}) {
  if (executor.has('navigate')) {
    return { strategy: 'native', ...(await executor.invoke('navigate', { x, y, z, range })) };
  }
  if (executor.has('world_snapshot') && executor.has('position') && executor.has('look') && executor.has('move')) {
    const pos = await executor.invoke('position');
    if (pos.inWorld === false) throw new Error('target is not in a world');
    const snapshot = await executor.invoke('world_snapshot', { around: pos, radius: 48 });
    const waypoints = planFn({ x: pos.x, y: pos.y, z: pos.z }, { x, y, z, range }, makeIsSolid(snapshot));
    if (!waypoints) throw new Error('no path to the target in the known world');
    const walked = await walk(executor, waypoints);
    return { strategy: 'planned', waypoints: waypoints.length, ...walked };
  }
  throw new Error(
    `target ${executor.id} cannot navigate: needs 'navigate', or 'world_snapshot'+position+look+move`,
  );
}
