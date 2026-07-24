// The backend-agnostic capability layer: executors advertise capabilities and dispatch
// invoke() uniformly; the registry finds targets by capability. Pure logic — fakes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentExecutor, botExecutor, createTargetRegistry } from '../src/executors.mjs';

function fakeConn(capabilities, agent = 'fabric') {
  const calls = [];
  return {
    calls,
    welcome: { agent, capabilities },
    request: async (op, args) => { calls.push({ op, args }); return { ok: true, op, args }; },
  };
}

test('agentExecutor advertises the connection capabilities and dispatches invoke → request', async () => {
  const conn = fakeConn(['screen', 'move']);
  const ex = agentExecutor({ id: 'a1', kind: 'client', connection: conn });
  assert.equal(ex.kind, 'client');
  assert.deepEqual(ex.describe(), { id: 'a1', kind: 'client', capabilities: ['screen', 'move'] });
  assert.equal(ex.has('move'), true);
  assert.equal(ex.has('craft'), false);

  const res = await ex.invoke('move', { direction: 'forward' });
  assert.deepEqual(conn.calls, [{ op: 'move', args: { direction: 'forward' } }]);
  assert.equal(res.op, 'move');
});

test('agentExecutor refuses a capability the target did not advertise', async () => {
  const ex = agentExecutor({ id: 'a1', kind: 'server', connection: fakeConn(['state', 'exec'], 'paper') });
  await assert.rejects(() => ex.invoke('screenshot'), /no capability 'screenshot'/);
});

test('agentExecutor validates its inputs', () => {
  assert.throws(() => agentExecutor({ id: 'a1', kind: 'bogus', connection: fakeConn([]) }), /kind must be client\|server/);
  assert.throws(() => agentExecutor({ id: 'a1', kind: 'client', connection: {} }), /needs a connection with request/);
  assert.throws(() => agentExecutor({ kind: 'client', connection: fakeConn([]) }), /needs an id/);
});

test('botExecutor maps canonical capabilities onto the bot registry', async () => {
  const calls = [];
  const registry = {
    status: (id) => { calls.push(['status', id]); return { id, state: 'spawned' }; },
    chat: (id, message) => { calls.push(['chat', id, message]); return { sent: message }; },
    messages: (id, a) => ({ id, a }),
    inventory: (id) => ({ id, items: [] }),
    moveTo: (id, args) => { calls.push(['moveTo', id, args]); return { arrived: true }; },
  };
  const ex = botExecutor({ id: 'b1', registry });
  assert.equal(ex.kind, 'bot');
  assert.deepEqual([...ex.capabilities].sort(), ['chat', 'inventory', 'messages', 'move', 'status']);

  assert.deepEqual(await ex.invoke('status'), { id: 'b1', state: 'spawned' });
  assert.deepEqual(await ex.invoke('chat', { message: 'hi' }), { sent: 'hi' });
  assert.deepEqual(await ex.invoke('move', { x: 1, y: 2, z: 3 }), { arrived: true });
  assert.deepEqual(calls, [['status', 'b1'], ['chat', 'b1', 'hi'], ['moveTo', 'b1', { x: 1, y: 2, z: 3, timeoutMs: undefined }]]);
});

test('botExecutor refuses an unknown capability and validates inputs', async () => {
  const ex = botExecutor({ id: 'b1', registry: { status: () => ({}) } });
  await assert.rejects(() => ex.invoke('craft'), /no capability 'craft'/);
  assert.throws(() => botExecutor({ id: 'b1', registry: {} }), /needs the bot registry/);
});

test('the target registry adds, finds by capability, and removes', () => {
  const reg = createTargetRegistry();
  reg.add(agentExecutor({ id: 'a1', kind: 'client', connection: fakeConn(['screen', 'move']) }));
  reg.add(botExecutor({ id: 'b1', registry: { status: () => ({}) } }));

  assert.deepEqual(reg.list().map((t) => t.id).sort(), ['a1', 'b1']);
  // Both a client agent and a bot can move → a goal would see two candidates.
  assert.deepEqual(reg.withCapability('move').map((t) => t.id).sort(), ['a1', 'b1']);
  // Only the agent can introspect a screen.
  assert.deepEqual(reg.withCapability('screen').map((t) => t.id), ['a1']);

  assert.equal(reg.has('a1'), true);
  reg.remove('a1');
  assert.equal(reg.has('a1'), false);
  assert.throws(() => reg.get('a1'), /no target a1/);
  assert.throws(() => reg.add({}), /without an id/);
});
