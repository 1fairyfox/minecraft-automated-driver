// Unit layer: the L2 Mineflayer bot registry, driven by a fake bot (EventEmitter) so the
// logic is testable without a real server. The real join is scripts/bot-smoke.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createBotRegistry, isLoopbackHost } from '../src/bot.mjs';

/** A fake mineflayer bot: emits spawn on next tick, records chat/control, fakes movement. */
function fakeBot(opts) {
  const bot = new EventEmitter();
  bot.username = opts.username;
  bot.chatSent = [];
  bot.controls = {};
  bot.entity = { position: { x: 0, y: 64, z: 0 } };
  bot.health = 20;
  bot.food = 20;
  bot.inventory = { items: () => [{ name: 'cobblestone', count: 3, slot: 9 }] };
  bot.vec3 = (x, y, z) => ({ x, y, z });
  bot.chat = (m) => bot.chatSent.push(m);
  bot.setControlState = (k, v) => { bot.controls[k] = v; if (k === 'forward' && v) bot.entity.position = { x: 5, y: 64, z: 5 }; };
  bot.lookAt = async () => {};
  bot.quit = () => { bot.quitCalled = true; };
  bot._opts = opts;
  return bot;
}

function reg(overrides = {}) {
  const created = [];
  const registry = createBotRegistry({
    createBot: (opts) => { const b = (overrides.make ?? fakeBot)(opts); created.push(b); return b; },
    ...overrides,
  });
  return { registry, created };
}

test('createBotRegistry requires a mineflayer factory', () => {
  assert.throws(() => createBotRegistry({}), /needs a .* factory/);
});

test('join resolves on spawn and uses offline auth on a loopback default', async () => {
  const { registry, created } = reg();
  const p = registry.join({ username: 'Smoke' });
  created[0].emit('spawn');
  const { botId, username } = await p;
  assert.equal(botId, 'b1');
  assert.equal(username, 'Smoke');
  assert.equal(created[0]._opts.auth, 'offline');
  assert.equal(created[0]._opts.host, '127.0.0.1');
});

test('join refuses a non-loopback host unless allowRemote is set', async () => {
  const { registry, created } = reg();
  await assert.rejects(() => registry.join({ host: 'play.example.com' }), /refusing to join non-loopback/);
  assert.equal(created.length, 0); // a refused host never even creates a bot

  // Explicit opt-in connects — the in-process-parser risk is the caller's to accept knowingly.
  const p = registry.join({ host: 'play.example.com', username: 'Remote', allowRemote: true });
  created[0].emit('spawn');
  const { botId } = await p;
  assert.equal(botId, 'b1');
  assert.equal(created[0]._opts.host, 'play.example.com');
});

test('isLoopbackHost recognises loopback forms and rejects remotes', () => {
  for (const h of ['127.0.0.1', 'localhost', 'LOCALHOST', ' ::1 ', '127.5.5.5', '::ffff:127.0.0.1']) {
    assert.equal(isLoopbackHost(h), true, `${h} should be loopback`);
  }
  for (const h of ['play.example.com', '10.0.0.5', '192.168.1.4', '8.8.8.8', '0.0.0.0']) {
    assert.equal(isLoopbackHost(h), false, `${h} should be remote`);
  }
});

test('join rejects on kick, on error, and on timeout', async () => {
  const { registry, created } = reg();
  const kick = registry.join({ username: 'A' });
  created[0].emit('kicked', 'banned');
  await assert.rejects(kick, /kicked: banned/);

  const err = registry.join({ username: 'B' });
  created[1].emit('error', new Error('econn'));
  await assert.rejects(err, /econn/);

  await assert.rejects(registry.join({ username: 'C', timeoutMs: 40 }), /timed out/);
});

test('status, chat, messages, inventory, list reflect the bot', async () => {
  const { registry, created } = reg();
  const p = registry.join({ username: 'S' });
  created[0].emit('spawn');
  const { botId } = await p;

  const status = registry.status(botId);
  assert.equal(status.state, 'spawned');
  assert.deepEqual(status.position, { x: 0, y: 64, z: 0 });
  assert.equal(status.health, 20);

  assert.deepEqual(registry.chat(botId, '/hi'), { sent: '/hi' });
  created[0].emit('message', 'hello there');
  assert.deepEqual(registry.messages(botId).lines.map((l) => l.text), ['hello there']);

  assert.deepEqual(registry.inventory(botId).items, [{ name: 'cobblestone', count: 3, slot: 9 }]);
  assert.equal(registry.list()[0].username, 'S');
});

test('moveTo faces the target, holds forward until close, then releases', async () => {
  const { registry, created } = reg();
  const p = registry.join({ username: 'M' });
  created[0].emit('spawn');
  const { botId } = await p;
  const result = await registry.moveTo(botId, { x: 5, y: 64, z: 5, timeoutMs: 2000 });
  assert.equal(result.arrived, true);
  assert.equal(created[0].controls.forward, false); // released at the end
});

test('navigate delegates to pathfinder.goto (native A*) and reports arrival', async () => {
  const goals = [];
  const { registry, created } = reg({
    goalNear: (x, y, z, r) => ({ x, y, z, r }),
    make: (opts) => {
      const b = fakeBot(opts);
      b.pathfinder = { goto: async (goal) => { goals.push(goal); b.entity.position = { x: goal.x, y: goal.y, z: goal.z }; } };
      return b;
    },
  });
  const p = registry.join({ username: 'Nav' });
  created[0].emit('spawn');
  const { botId } = await p;

  const res = await registry.navigate(botId, { x: 10, y: 64, z: -3, range: 2 });
  assert.equal(res.arrived, true);
  assert.deepEqual(goals[0], { x: 10, y: 64, z: -3, r: 2 });
  assert.deepEqual(res.position, { x: 10, y: 64, z: -3 });
});

test('navigate errors clearly without pathfinder, and surfaces a goto rejection', async () => {
  const { registry, created } = reg(); // fakeBot has no pathfinder
  const p = registry.join({ username: 'X' });
  created[0].emit('spawn');
  const { botId } = await p;
  await assert.rejects(() => registry.navigate(botId, { x: 1, y: 1, z: 1 }), /pathfinder is not loaded/);

  const { registry: r2, created: c2 } = reg({
    goalNear: (x, y, z, r) => ({ x, y, z, r }),
    make: (opts) => { const b = fakeBot(opts); b.pathfinder = { goto: () => Promise.reject(new Error('NoPath')) }; return b; },
  });
  const p2 = r2.join({ username: 'Y' });
  c2[0].emit('spawn');
  await p2;
  await assert.rejects(() => r2.navigate('b1', { x: 1, y: 1, z: 1 }), /NoPath/);
});

// ── gather / hunt / equip (native mineflayer-collectblock / -pvp) ──────────────

test('gather collects the nearest matching block, count times, reporting what it got', async () => {
  const collected = [];
  const { registry, created } = reg({
    make: (opts) => {
      const b = fakeBot(opts);
      let remaining = 2; // two logs available, then none
      b.registry = { blocksByName: { oak_log: { id: 17 } } };
      b.findBlock = () => (remaining > 0 ? { position: { x: remaining, y: 64, z: 0 } } : null);
      b.collectBlock = { collect: async (blk) => { collected.push(blk.position.x); remaining -= 1; } };
      return b;
    },
  });
  const p = registry.join({ username: 'G' });
  created[0].emit('spawn');
  const { botId } = await p;

  const res = await registry.gather(botId, { block: 'oak_log', count: 3 });
  assert.equal(res.requested, 3);
  assert.equal(res.gathered, 2); // only two were in range
  assert.deepEqual(collected, [2, 1]);
});

test('gather errors without the plugin, on an unknown block, and on a missing name', async () => {
  const { registry, created } = reg(); // fakeBot has no collectBlock
  const p = registry.join({ username: 'G2' }); created[0].emit('spawn'); const { botId } = await p;
  await assert.rejects(() => registry.gather(botId, { block: 'oak_log' }), /collectBlock plugin is not loaded/);

  const { registry: r2, created: c2 } = reg({
    make: (o) => { const b = fakeBot(o); b.collectBlock = { collect: async () => {} }; b.registry = { blocksByName: {} }; return b; },
  });
  const p2 = r2.join({ username: 'G3' }); c2[0].emit('spawn'); await p2;
  await assert.rejects(() => r2.gather('b1', { block: 'nope' }), /unknown block/);
  await assert.rejects(() => r2.gather('b1', {}), /needs a block name/);
});

test('gather surfaces a collect that hangs (timeout)', async () => {
  const { registry, created } = reg({
    make: (o) => {
      const b = fakeBot(o);
      b.registry = { blocksByName: { stone: { id: 1 } } };
      b.findBlock = () => ({ position: { x: 1, y: 64, z: 0 } });
      b.collectBlock = { collect: () => new Promise(() => {}) }; // never resolves
      return b;
    },
  });
  const p = registry.join({ username: 'GT' }); created[0].emit('spawn'); const { botId } = await p;
  await assert.rejects(() => registry.gather(botId, { block: 'stone', timeoutMs: 20 }), /timed out/);
});

test('hunt equips a weapon, attacks the nearest matching mob, and resolves when it dies', async () => {
  const events = [];
  const { registry, created } = reg({
    make: (opts) => {
      const b = fakeBot(opts);
      b.entity = { position: { x: 0, y: 64, z: 0, distanceTo: () => 3 } };
      b.inventory = { items: () => [{ name: 'iron_sword', count: 1, slot: 0 }] };
      b.equip = async (item, dest) => events.push(['equip', item.name, dest]);
      b.nearestEntity = (match) => {
        const e = { id: 42, name: 'zombie', position: { distanceTo: () => 3 } };
        return match(e) ? e : null;
      };
      b.pvp = { attack: async (e) => events.push(['attack', e.id]), stop: () => events.push(['stop']) };
      return b;
    },
  });
  const p = registry.join({ username: 'H' }); created[0].emit('spawn'); const { botId } = await p;

  const huntP = registry.hunt(botId, { mob: 'zombie', weapon: 'iron_sword' });
  await new Promise((r) => setTimeout(r, 5));
  created[0].emit('entityGone', { id: 99 }); // some other entity — ignored
  created[0].emit('entityGone', { id: 42 }); // the target dies
  const res = await huntP;
  assert.equal(res.killed, 1);
  assert.deepEqual(events, [['equip', 'iron_sword', 'hand'], ['attack', 42], ['stop']]);
});

test('hunt reports 0 kills when none in range, times out if the mob never dies, and needs pvp', async () => {
  const { registry, created } = reg({
    make: (o) => {
      const b = fakeBot(o);
      b.entity = { position: { x: 0, y: 64, z: 0, distanceTo: () => 0 } };
      b.inventory = { items: () => [] };
      b.nearestEntity = () => null;
      b.pvp = { attack: async () => {}, stop: () => {} };
      return b;
    },
  });
  const p = registry.join({ username: 'H0' }); created[0].emit('spawn'); const { botId } = await p;
  assert.deepEqual(await registry.hunt(botId, { mob: 'zombie' }), { mob: 'zombie', requested: 1, killed: 0 });

  const stops = [];
  const { registry: rt, created: ct } = reg({
    make: (o) => {
      const b = fakeBot(o);
      b.entity = { position: { distanceTo: () => 1 } };
      b.nearestEntity = (m) => { const e = { id: 7, name: 'zombie', position: { distanceTo: () => 1 } }; return m(e) ? e : null; };
      b.pvp = { attack: async () => {}, stop: () => stops.push('stop') };
      return b;
    },
  });
  const pt = rt.join({ username: 'HT' }); ct[0].emit('spawn'); await pt;
  await assert.rejects(() => rt.hunt('b1', { mob: 'zombie', timeoutMs: 20 }), /timed out/);
  assert.deepEqual(stops, ['stop']); // pvp is stopped on the way out

  const { registry: r2, created: c2 } = reg(); // fakeBot has no pvp
  const p2 = r2.join({ username: 'H1' }); c2[0].emit('spawn'); await p2;
  await assert.rejects(() => r2.hunt('b1', { mob: 'zombie' }), /pvp plugin is not loaded/);
  await assert.rejects(() => r2.hunt('b1', {}), /needs a mob name/);
});

test('hunt surfaces a pvp.attack rejection (and stops pvp)', async () => {
  const stops = [];
  const { registry, created } = reg({
    make: (o) => {
      const b = fakeBot(o);
      b.entity = { position: { distanceTo: () => 1 } };
      b.nearestEntity = (m) => { const e = { id: 5, name: 'zombie', position: { distanceTo: () => 1 } }; return m(e) ? e : null; };
      b.pvp = { attack: async () => { throw new Error('cannot reach'); }, stop: () => stops.push('stop') };
      return b;
    },
  });
  const p = registry.join({ username: 'HR' }); created[0].emit('spawn'); const { botId } = await p;
  await assert.rejects(() => registry.hunt(botId, { mob: 'zombie' }), /cannot reach/);
  assert.deepEqual(stops, ['stop']);
});

test('equip finds the item by name and equips it; errors when absent or unnamed', async () => {
  const equips = [];
  const { registry, created } = reg({
    make: (o) => { const b = fakeBot(o); b.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, slot: 0 }] }; b.equip = async (item, dest) => equips.push([item.name, dest]); return b; },
  });
  const p = registry.join({ username: 'E' }); created[0].emit('spawn'); const { botId } = await p;
  assert.deepEqual(await registry.equip(botId, { item: 'iron_pickaxe' }), { equipped: 'iron_pickaxe', destination: 'hand' });
  assert.deepEqual(equips, [['iron_pickaxe', 'hand']]);
  await assert.rejects(() => registry.equip(botId, { item: 'diamond_sword' }), /no 'diamond_sword' in inventory/);
  await assert.rejects(() => registry.equip(botId, {}), /needs an item name/);
});

// ── craft / place / build (core mineflayer recipesFor/craft/placeBlock) ────────

test('craft resolves a recipe table-aware and crafts count times', async () => {
  const calls = [];
  const { registry, created } = reg({
    make: (o) => {
      const b = fakeBot(o);
      b.registry = { itemsByName: { crafting_table: { id: 182 } }, blocksByName: { crafting_table: { id: 182 } } };
      b.findBlock = ({ matching }) => (matching === 182 ? { position: { x: 1, y: 64, z: 1 } } : null); // a table in reach
      b.recipesFor = (itemId, meta, min, table) => { calls.push(['recipesFor', itemId, Boolean(table)]); return [{ id: 'r1' }]; };
      b.craft = async (recipe, count, table) => { calls.push(['craft', recipe.id, count, Boolean(table)]); };
      return b;
    },
  });
  const p = registry.join({ username: 'C' }); created[0].emit('spawn'); const { botId } = await p;
  assert.deepEqual(await registry.craft(botId, { item: 'crafting_table', count: 2 }), { crafted: 'crafting_table', count: 2, usedTable: true });
  assert.deepEqual(calls, [['recipesFor', 182, true], ['craft', 'r1', 2, true]]);
});

test('craft works with no table in reach, and errors on unknown item / no recipe / no name', async () => {
  const { registry, created } = reg({
    make: (o) => {
      const b = fakeBot(o);
      b.registry = { itemsByName: { stick: { id: 280 }, mystery: { id: 999 } }, blocksByName: { crafting_table: { id: 182 } } };
      b.findBlock = () => null; // no table in reach
      b.recipesFor = (itemId) => (itemId === 280 ? [{ id: 'stickRecipe' }] : []);
      b.craft = async () => {};
      return b;
    },
  });
  const p = registry.join({ username: 'C2' }); created[0].emit('spawn'); const { botId } = await p;
  const res = await registry.craft(botId, { item: 'stick' });
  assert.equal(res.usedTable, false);
  assert.equal(res.crafted, 'stick');
  await assert.rejects(() => registry.craft(botId, { item: 'nope' }), /unknown item/);
  await assert.rejects(() => registry.craft(botId, { item: 'mystery' }), /no craftable recipe/);
  await assert.rejects(() => registry.craft(botId, {}), /needs an item name/);
});

test('place equips the block and places it against the block below the target', async () => {
  const acts = [];
  const { registry, created } = reg({
    make: (o) => {
      const b = fakeBot(o);
      b.inventory = { items: () => [{ name: 'oak_planks', count: 4, slot: 0 }] };
      b.equip = async (item, dest) => acts.push(['equip', item.name, dest]);
      b.vec3 = (x, y, z) => ({ x, y, z });
      b.blockAt = (v) => { acts.push(['blockAt', v.x, v.y, v.z]); return { name: 'grass_block', position: v }; };
      b.placeBlock = async (ref, face) => acts.push(['placeBlock', ref.name, face.y]);
      return b;
    },
  });
  const p = registry.join({ username: 'P' }); created[0].emit('spawn'); const { botId } = await p;
  assert.deepEqual(await registry.place(botId, { block: 'oak_planks', x: 5, y: 64, z: 5 }), { placed: 'oak_planks', position: { x: 5, y: 64, z: 5 } });
  assert.deepEqual(acts, [['equip', 'oak_planks', 'hand'], ['blockAt', 5, 63, 5], ['placeBlock', 'grass_block', 1]]);
});

test('place errors on missing item, non-numeric coords, nothing-below, and no name', async () => {
  const { registry, created } = reg({
    make: (o) => {
      const b = fakeBot(o);
      b.inventory = { items: () => [{ name: 'oak_planks', count: 4, slot: 0 }] };
      b.equip = async () => {};
      b.vec3 = (x, y, z) => ({ x, y, z });
      b.blockAt = () => ({ name: 'air' });
      b.placeBlock = async () => {};
      return b;
    },
  });
  const p = registry.join({ username: 'P2' }); created[0].emit('spawn'); const { botId } = await p;
  await assert.rejects(() => registry.place(botId, { block: 'stone', x: 1, y: 1, z: 1 }), /no 'stone' in inventory/);
  await assert.rejects(() => registry.place(botId, { block: 'oak_planks', x: 1, y: 1 }), /numeric x, y, z/);
  await assert.rejects(() => registry.place(botId, { block: 'oak_planks', x: 1, y: 1, z: 1 }), /nothing to place against/);
  await assert.rejects(() => registry.place(botId, {}), /needs a block name/);
});

test('build places each block in order; errors on an empty list and an unknown bot', async () => {
  const { registry, created } = reg({
    make: (o) => {
      const b = fakeBot(o);
      b.inventory = { items: () => [{ name: 'oak_planks', count: 8, slot: 0 }] };
      b.equip = async () => {};
      b.vec3 = (x, y, z) => ({ x, y, z });
      b.blockAt = (v) => ({ name: 'grass_block', position: v });
      b.placeBlock = async () => {};
      return b;
    },
  });
  const p = registry.join({ username: 'B' }); created[0].emit('spawn'); const { botId } = await p;
  const res = await registry.build(botId, { blocks: [{ block: 'oak_planks', x: 1, y: 64, z: 1 }, { block: 'oak_planks', x: 1, y: 65, z: 1 }] });
  assert.equal(res.placed, 2);
  assert.equal(res.blocks.length, 2);
  await assert.rejects(() => registry.build(botId, { blocks: [] }), /non-empty blocks list/);
  await assert.rejects(() => registry.build('b99', { blocks: [{ block: 'x', x: 0, y: 0, z: 0 }] }), /no bot/);
});

test('the message ring buffer is bounded', async () => {
  const { registry, created } = reg({ logCap: 3 });
  const p = registry.join({ username: 'R' });
  created[0].emit('spawn');
  const { botId } = await p;
  for (let i = 1; i <= 5; i++) created[0].emit('message', `m${i}`);
  assert.deepEqual(registry.messages(botId).lines.map((l) => l.text), ['m3', 'm4', 'm5']);
  assert.deepEqual(registry.messages(botId, { tail: 1 }).lines.map((l) => l.text), ['m5']);
});

test('degrades gracefully when the bot lacks vec3/entity/inventory', async () => {
  const bare = (opts) => {
    const b = new EventEmitter();
    b.username = opts.username;
    b.chat = () => {};
    b.setControlState = () => {};
    b.lookAt = async () => {};
    b.quit = () => {};
    // no vec3, no entity, no inventory, no health/food
    return b;
  };
  const { registry, created } = reg({ make: bare });
  const p = registry.join({ username: 'Bare' });
  created[0].emit('spawn');
  const { botId } = await p;

  const status = registry.status(botId);
  assert.equal(status.position, null); // no entity → null, not a crash
  assert.equal(status.health, null);
  assert.deepEqual(registry.inventory(botId).items, []); // no inventory → empty
  // moveTo with no vec3 uses a plain {x,y,z} target and no entity → arrived:false, no crash
  const moved = await registry.moveTo(botId, { x: 9, y: 64, z: 9, timeoutMs: 200 });
  assert.equal(moved.arrived, false);
  assert.equal(moved.position, null);
});

test('quit disconnects and forgets; unknown ids throw', async () => {
  const { registry, created } = reg();
  const p = registry.join({ username: 'Q' });
  created[0].emit('spawn');
  const { botId } = await p;
  assert.deepEqual(registry.quit(botId), { quit: botId });
  assert.equal(created[0].quitCalled, true);
  assert.throws(() => registry.status(botId), /no bot/);
  assert.throws(() => registry.chat('b99', 'x'), /no bot/);
});
