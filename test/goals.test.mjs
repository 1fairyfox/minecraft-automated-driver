// The goal engine: chooses a strategy from advertised capabilities and composes primitives.
// Fake executors only — pure orchestration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navigate, walkWaypoints, yawTo } from '../src/goals.mjs';

function fakeExecutor(caps, handlers = {}) {
  const invokes = [];
  const set = new Set(caps);
  return {
    id: 'x1',
    invokes,
    has: (c) => set.has(c),
    invoke: async (cap, args) => {
      invokes.push({ cap, args });
      return handlers[cap] ? handlers[cap](args) : { ok: true };
    },
  };
}

test('yawTo points in Minecraft yaw convention', () => {
  assert.equal(Math.round(yawTo({ x: 0, z: 0 }, { x: 0, z: 1 })), 0);    // +Z south (no -0)
  assert.equal(Math.round(yawTo({ x: 0, z: 0 }, { x: 1, z: 0 })), -90);  // +X west-ish
  assert.equal(Math.abs(Math.round(yawTo({ x: 0, z: 0 }, { x: 0, z: -1 }))), 180); // -Z north (±180 same dir)
  assert.equal(Math.round(yawTo({ x: 0, z: 0 }, { x: -1, z: 0 })), 90);
});

test('walkWaypoints issues a look + move per hop', async () => {
  const ex = fakeExecutor(['look', 'move']);
  const res = await walkWaypoints(ex, [{ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 1 }, { x: 0, y: 1, z: 2 }], { stepMs: 200 });
  assert.equal(res.steps, 2);
  assert.deepEqual(ex.invokes.map((i) => i.cap), ['look', 'move', 'look', 'move']);
  assert.equal(ex.invokes[1].args.ms, 200);
});

test('navigate delegates to a native pathfinder when advertised', async () => {
  const ex = fakeExecutor(['navigate', 'position', 'move'], {
    navigate: () => ({ arrived: true, position: { x: 10, y: 64, z: 10 } }),
  });
  const res = await navigate(ex, { x: 10, y: 64, z: 10, range: 1 });
  assert.equal(res.strategy, 'native');
  assert.equal(res.arrived, true);
  assert.equal(ex.invokes[0].cap, 'navigate');
});

test('navigate composes A* + walk when only a world snapshot + primitives exist', async () => {
  const walked = [];
  const ex = fakeExecutor(['world_snapshot', 'position', 'look', 'move'], {
    position: () => ({ inWorld: true, x: 0, y: 1, z: 0 }),
    // A floor strip (solid ground at y=0) so there's something to stand on along the route.
    world_snapshot: () => ({ solids: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }] }),
  });
  // range 0 → must reach the exact goal, so the path is deterministically 0→1→2 (no tie on
  // which within-range cell to stop at).
  const res = await navigate(ex, { x: 2, y: 1, z: 0, range: 0 }, { walk: async (e, wp) => { walked.push(wp); return { steps: wp.length - 1 }; } });
  assert.equal(res.strategy, 'planned');
  assert.equal(res.waypoints, 3);              // 0→1→2
  assert.deepEqual(walked[0][walked[0].length - 1], { x: 2, y: 1, z: 0 });
});

test('navigate (planned) surfaces an unreachable target', async () => {
  const ex = fakeExecutor(['world_snapshot', 'position', 'look', 'move'], {
    position: () => ({ inWorld: true, x: 0, y: 1, z: 0 }),
    world_snapshot: () => ({ solids: [] }),
  });
  await assert.rejects(() => navigate(ex, { x: 5, z: 0, y: 1 }, { planFn: () => null }), /no path/);
});

test('navigate rejects when not in a world, or the target lacks the capabilities', async () => {
  const notInWorld = fakeExecutor(['world_snapshot', 'position', 'look', 'move'], {
    position: () => ({ inWorld: false }),
  });
  await assert.rejects(() => navigate(notInWorld, { x: 1, y: 1, z: 1 }), /not in a world/);

  const cannot = fakeExecutor(['position']); // no navigate, no snapshot+move
  await assert.rejects(() => navigate(cannot, { x: 1, y: 1, z: 1 }), /cannot navigate/);
});
