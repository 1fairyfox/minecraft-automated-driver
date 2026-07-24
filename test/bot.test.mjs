// Unit layer: the L2 Mineflayer bot registry, driven by a fake bot (EventEmitter) so the
// logic is testable without a real server. The real join is scripts/bot-smoke.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createBotRegistry } from '../src/bot.mjs';

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
