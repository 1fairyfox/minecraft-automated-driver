// Unit layer: the instanced-client manager. The gradle run + filesystem poll are faked so
// the spawn/kill logic is testable without booting a real client (that's the CI smoke).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createJobRegistry } from '../src/jobs.mjs';
import { createClientManager } from '../src/client.mjs';

/** A run seam that never resolves (the client stays up) until its signal aborts. */
function stayUpRun() {
  const started = [];
  const run = ({ command, args, cwd, signal }) => new Promise((resolve, reject) => {
    started.push({ command, args, cwd });
    if (signal.aborted) return reject(new Error('killed by abort signal'));
    signal.addEventListener('abort', () => reject(new Error('killed by abort signal')), { once: true });
  });
  return { run, started };
}

test('spawn requires an agent dir', async () => {
  const mgr = createClientManager({ jobs: createJobRegistry(), run: async () => ({ code: 0 }) });
  await assert.rejects(() => mgr.spawn({}), /needs the fabric agent dir/);
});

test('spawn runs the gradle prod-client task and resolves when the handshake appears', async () => {
  const jobs = createJobRegistry();
  const { run, started } = stayUpRun();
  let looks = 0;
  const mgr = createClientManager({
    jobs, run, platform: 'linux',
    exists: async () => (++looks >= 3), // appears on the 3rd poll
  });
  const res = await mgr.spawn({ agentDir: '/repo/agents/fabric', pollMs: 5 });
  assert.match(res.clientId, /^c\d+$/);
  assert.equal(res.connectDir, join('/repo/agents/fabric', 'run', 'prodClient'));
  // Linux gradleCommand: `sh gradlew runProductionClient`.
  assert.equal(started[0].command, 'sh');
  assert.deepEqual(started[0].args, ['gradlew', 'runProductionClient']);
  assert.equal(started[0].cwd, '/repo/agents/fabric');
  assert.equal(mgr.list()[0].state, 'ready');
});

test('spawn fails fast if the client run dies before the handshake', async () => {
  const jobs = createJobRegistry();
  // A run that exits (code 1) immediately → job fails → spawn must surface it.
  const mgr = createClientManager({
    jobs, platform: 'linux',
    run: async ({ onLine }) => { onLine('crash: mixin apply failed'); return { code: 1 }; },
    exists: async () => false,
  });
  await assert.rejects(
    () => mgr.spawn({ agentDir: '/a', pollMs: 5, waitReadyMs: 5000 }),
    /exited before its agent came up/,
  );
});

test('spawn times out if the handshake never shows and the run keeps going', async () => {
  const jobs = createJobRegistry();
  const { run } = stayUpRun();
  const mgr = createClientManager({ jobs, run, platform: 'linux', exists: async () => false });
  await assert.rejects(
    () => mgr.spawn({ agentDir: '/a', pollMs: 5, waitReadyMs: 60 }),
    /handshake never appeared/,
  );
});

test('kill aborts the job and forgets the client; unknown ids throw', async () => {
  const jobs = createJobRegistry();
  const { run } = stayUpRun();
  const mgr = createClientManager({ jobs, run, platform: 'win32', exists: async () => true });
  const res = await mgr.spawn({ agentDir: 'C:/a', pollMs: 5 });
  const killed = mgr.kill(res.clientId);
  assert.deepEqual(killed, { killed: res.clientId });
  const done = await jobs.wait(res.jobId);
  assert.equal(done.status, 'killed');
  assert.equal(mgr.list().length, 0);
  assert.throws(() => mgr.kill('c99'), /no client/);
});
