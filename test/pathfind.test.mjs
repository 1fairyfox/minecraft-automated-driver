// The universal A* planner: synthetic worlds, no dependencies. A cell (x,y,z) is standable
// with air at y and y+1 and solid at y-1; we build worlds as a floor at y=0 plus a set of
// extra solid blocks, and stand entities at y=1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/pathfind.mjs';

/** World: solid floor at y<=0, plus any blocks in `solids` (a Set of "x,y,z"). */
function world(solids = []) {
  const set = new Set(solids);
  return (x, y, z) => y <= 0 || set.has(`${x},${y},${z}`);
}

const at = (x, y, z) => ({ x, y, z });

test('flat plane: straight manhattan route, start and end included', () => {
  const path = plan(at(0, 1, 0), at(3, 1, 0), world());
  assert.ok(path);
  assert.deepEqual(path[0], { x: 0, y: 1, z: 0 });
  assert.deepEqual(path[path.length - 1], { x: 3, y: 1, z: 0 });
  assert.equal(path.length, 4); // 0→1→2→3
});

test('routes around a wall', () => {
  // A one-block wall directly between start and goal forces a detour.
  const path = plan(at(0, 1, 0), at(2, 1, 0), world(['1,1,0']));
  assert.ok(path);
  assert.deepEqual(path[path.length - 1], { x: 2, y: 1, z: 0 });
  // The blocked cell must never appear in the path.
  assert.ok(!path.some((p) => p.x === 1 && p.y === 1 && p.z === 0));
});

test('steps up a one-block ledge (jump)', () => {
  // A block at (1,1,0) makes (1,2,0) a standable ledge one higher than start.
  const path = plan(at(0, 1, 0), at(1, 2, 0), world(['1,1,0']));
  assert.ok(path);
  assert.deepEqual(path, [{ x: 0, y: 1, z: 0 }, { x: 1, y: 2, z: 0 }]);
});

test('drops down a ledge', () => {
  // Start on a pillar at y=2 (block at (0,1,0)); goal is on the floor one over.
  const path = plan(at(0, 2, 0), at(1, 1, 0), world(['0,1,0']));
  assert.ok(path);
  assert.deepEqual(path[path.length - 1], { x: 1, y: 1, z: 0 });
});

test('returns null when there is no path', () => {
  // Only (0,0,0) is solid → the start is a one-cell island with no reachable neighbours.
  const isSolid = (x, y, z) => (x === 0 && y === 0 && z === 0) || (x === 0 && y <= 0 && z === 0)
    ? true : false;
  assert.equal(plan(at(0, 1, 0), at(3, 1, 0), isSolid), null);
});

test('honours a goal range when the exact block is unreachable', () => {
  // The exact goal (3,1,0) is walled solid; range 1 lets it settle on (2,1,0).
  const path = plan(at(0, 1, 0), { x: 3, y: 1, z: 0, range: 1 }, world(['3,1,0']));
  assert.ok(path);
  const end = path[path.length - 1];
  assert.ok(Math.abs(end.x - 3) + Math.abs(end.y - 1) + Math.abs(end.z - 0) <= 1);
});

test('is bounded by maxExpansions (never spins forever)', () => {
  // Wide-open world, unreachable-in-budget goal, tiny expansion cap → null, fast.
  assert.equal(plan(at(0, 1, 0), at(9999, 1, 0), world(), { maxExpansions: 50 }), null);
});

test('start already within range returns just the start', () => {
  const path = plan(at(5, 1, 5), { x: 5, y: 1, z: 5, range: 2 }, world());
  assert.deepEqual(path, [{ x: 5, y: 1, z: 5 }]);
});
