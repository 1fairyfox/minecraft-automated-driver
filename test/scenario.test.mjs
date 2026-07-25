// Unit tests for the pure multi-target scenario engine (src/scenario.mjs). Every provisioner
// and action is a fake, so these prove the ORCHESTRATION contract — declared-order provisioning,
// short-circuit on failure, guaranteed reverse-order teardown, collected teardown errors — with
// no server/bot/client involved. The real wiring is covered by the protocol suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, validateScenario } from '../src/scenario.mjs';

/** Fake provisioners + actions that record teardown order into a shared array. */
function fakes() {
  const order = [];
  const provisioners = {
    server: async (actor) => ({
      info: { serverId: `srv-${actor.id}` },
      teardown: () => { order.push(`down:${actor.id}`); return { stopped: actor.id }; },
    }),
    bot: async (actor) => ({
      info: { botId: `bot-${actor.id}`, targetId: `bot-${actor.id}` },
      teardown: () => { order.push(`down:${actor.id}`); },
    }),
    note: async (actor) => ({ info: { note: actor.text ?? null } }), // no teardown
    empty: async () => undefined, // no return at all — exercises the `?? {}` guard
    boomProv: async () => { throw new Error('provision exploded'); },
    throwString: async () => { throw 'plain boom'; }, // eslint-disable-line no-throw-literal
    leaky: async (actor) => ({
      info: {},
      teardown: () => { order.push(`down:${actor.id}`); throw new Error(`teardown ${actor.id} failed`); },
    }),
  };
  const actions = {
    ping: async (step) => ({ pong: step.msg ?? null }),
    touch: async (step, ctx) => ctx.actor(step.actor),
    use: async (step, ctx) => ({ target: ctx.targetId(step.actor) }),
    boom: async () => { throw new Error('step exploded'); },
    nap: async (step, ctx) => { await ctx.sleep(step.ms ?? 0); return { napped: true }; },
  };
  return { order, provisioners, actions };
}

test('provisions in order, runs steps, tears down LIFO, ok:true', async () => {
  const { order, provisioners, actions } = fakes();
  const report = await runScenario({
    name: 'demo',
    actors: [
      { id: 'srv', kind: 'server', version: '1.21.11' },
      { id: 'b1', kind: 'bot' },
    ],
    steps: [
      { action: 'ping', msg: 'hi' },
      { action: 'use', actor: 'b1' },
      { action: 'touch', actor: 'srv' },
    ],
  }, { provisioners, actions });

  assert.equal(report.name, 'demo');
  assert.equal(report.ok, true);
  assert.deepEqual(report.provisioned.map((p) => [p.id, p.ok]), [['srv', true], ['b1', true]]);
  assert.equal(report.steps.length, 3);
  assert.equal(report.steps[0].result.pong, 'hi');
  assert.equal(report.steps[1].result.target, 'bot-b1');
  assert.equal(report.steps[2].result.serverId, 'srv-srv');
  // Teardown is the reverse of provisioning.
  assert.deepEqual(order, ['down:b1', 'down:srv']);
  assert.deepEqual(report.teardown.map((t) => [t.id, t.ok]), [['b1', true], ['srv', true]]);
});

test('a provision failure stops provisioning, runs no steps, still tears down what came up', async () => {
  const { order, provisioners, actions } = fakes();
  const report = await runScenario({
    actors: [
      { id: 'srv', kind: 'server', version: 'v' },
      { id: 'bad', kind: 'boomProv' },
      { id: 'b1', kind: 'bot' }, // never reached
    ],
    steps: [{ action: 'ping' }],
  }, { provisioners, actions });

  assert.equal(report.ok, false);
  assert.deepEqual(report.provisioned.map((p) => [p.id, p.ok]), [['srv', true], ['bad', false]]);
  assert.match(report.provisioned[1].error, /provision exploded/);
  assert.equal(report.steps.length, 0); // no steps run when provisioning failed
  assert.deepEqual(order, ['down:srv']); // only what came up is torn down
});

test('a non-Error throw is still reported as a message', async () => {
  const { provisioners, actions } = fakes();
  const report = await runScenario(
    { actors: [{ id: 'x', kind: 'throwString' }] },
    { provisioners, actions },
  );
  assert.equal(report.ok, false);
  assert.equal(report.provisioned[0].error, 'plain boom');
});

test('a step failure stops later steps but still tears everything down', async () => {
  const { order, provisioners, actions } = fakes();
  const report = await runScenario({
    actors: [{ id: 'srv', kind: 'server', version: 'v' }, { id: 'b1', kind: 'bot' }],
    steps: [{ action: 'ping' }, { action: 'boom' }, { action: 'ping' }],
  }, { provisioners, actions });

  assert.equal(report.ok, false);
  assert.equal(report.steps.length, 2); // the third never ran
  assert.equal(report.steps[0].ok, true);
  assert.equal(report.steps[1].ok, false);
  assert.match(report.steps[1].error, /step exploded/);
  assert.deepEqual(order, ['down:b1', 'down:srv']); // full teardown regardless
});

test('a teardown failure is collected; the rest still tear down; ok:false', async () => {
  const { order, provisioners, actions } = fakes();
  const report = await runScenario({
    actors: [{ id: 'a', kind: 'leaky' }, { id: 'b', kind: 'bot' }],
    steps: [],
  }, { provisioners, actions });

  assert.equal(report.provisioned.every((p) => p.ok), true); // provisioning was fine
  assert.equal(report.ok, false); // but a teardown threw
  assert.deepEqual(order, ['down:b', 'down:a']); // b (last in) first, then a
  const byId = Object.fromEntries(report.teardown.map((t) => [t.id, t]));
  assert.equal(byId.b.ok, true);
  assert.equal(byId.a.ok, false);
  assert.match(byId.a.error, /teardown a failed/);
});

test('a step targeting a non-controllable actor fails cleanly and is torn down', async () => {
  const { order, provisioners, actions } = fakes();
  const report = await runScenario({
    actors: [{ id: 'srv', kind: 'server', version: 'v' }], // a server has no targetId
    steps: [{ action: 'use', actor: 'srv' }],
  }, { provisioners, actions });

  assert.equal(report.ok, false);
  assert.equal(report.steps[0].ok, false);
  assert.match(report.steps[0].error, /not a controllable target/);
  assert.deepEqual(order, ['down:srv']);
});

test('provisioners with no teardown (or no return) provision cleanly and need no cleanup', async () => {
  const { provisioners, actions } = fakes();
  const report = await runScenario({
    actors: [{ id: 'n', kind: 'note', text: 'hello' }, { id: 'e', kind: 'empty' }],
    steps: [{ action: 'touch', actor: 'n' }, { action: 'touch', actor: 'e' }],
  }, { provisioners, actions });

  assert.equal(report.ok, true);
  assert.equal(report.steps[0].result.note, 'hello');
  assert.deepEqual(report.steps[1].result, { id: 'e', kind: 'empty' }); // empty info → just id+kind
  assert.deepEqual(report.teardown, []); // neither registered a teardown
});

test('the nap action uses the injected sleep', async () => {
  const { provisioners, actions } = fakes();
  const slept = [];
  const report = await runScenario({
    actors: [{ id: 'n', kind: 'note' }],
    steps: [{ action: 'nap', ms: 123 }],
  }, { provisioners, actions, sleep: async (ms) => { slept.push(ms); } });

  assert.equal(report.ok, true);
  assert.deepEqual(slept, [123]);
  assert.equal(report.steps[0].result.napped, true);
});

test('validateScenario rejects structural mistakes before anything is provisioned', () => {
  const { provisioners, actions } = fakes();
  const V = (spec) => validateScenario(spec, { provisioners, actions });
  assert.throws(() => V(null), /must be an object/);
  assert.throws(() => V({}), /non-empty actors/);
  assert.throws(() => V({ actors: [] }), /non-empty actors/);
  assert.throws(() => V({ actors: [{ kind: 'bot' }] }), /every actor needs an id/);
  assert.throws(() => V({ actors: [{ id: 'x', kind: 'bot' }, { id: 'x', kind: 'bot' }] }), /duplicate actor id/);
  assert.throws(() => V({ actors: [{ id: 'x', kind: 'nope' }] }), /unknown kind 'nope'/);
  assert.throws(() => V({ actors: [{ id: 'x', kind: 'bot' }], steps: {} }), /steps must be an array/);
  assert.throws(() => V({ actors: [{ id: 'x', kind: 'bot' }], steps: [{ action: 'nope' }] }), /unknown action 'nope'/);
  assert.throws(() => V({ actors: [{ id: 'x', kind: 'bot' }], steps: [{ action: 'ping', actor: 'zzz' }] }), /references unknown actor 'zzz'/);
  // A valid spec with no steps validates (the `steps ?? []` path) and returns [].
  assert.deepEqual(V({ actors: [{ id: 'x', kind: 'bot' }] }).steps, []);
});
