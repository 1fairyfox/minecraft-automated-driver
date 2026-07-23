// Unit layer: the job model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJobRegistry } from '../src/jobs.mjs';

test('a job runs, logs, succeeds, and exposes its result', async () => {
  const jobs = createJobRegistry();
  const snap = jobs.start('demo', async ({ log }) => {
    log('working');
    return { answer: 42 };
  });
  assert.equal(snap.id, 'j1');
  assert.equal(snap.status, 'running');
  const done = await jobs.wait(snap.id);
  assert.equal(done.status, 'succeeded');
  assert.deepEqual(done.result, { answer: 42 });
  assert.deepEqual(jobs.log(snap.id).lines, ['working']);
  assert.equal(done.endedAt !== null, true);
});

test('a throwing job fails with its message', async () => {
  const jobs = createJobRegistry();
  const snap = jobs.start('boom', async () => { throw new Error('kaput'); });
  const done = await jobs.wait(snap.id);
  assert.equal(done.status, 'failed');
  assert.equal(done.error, 'kaput');
});

test('kill aborts a running job and marks it killed', async () => {
  const jobs = createJobRegistry();
  const snap = jobs.start('long', ({ signal }) => new Promise((resolve, reject) => {
    // Job fns start on a microtask, so handle both orderings: aborted-before-start
    // and abort-while-running (exactly what runProcess does with its signal).
    if (signal.aborted) return reject(new Error('aborted'));
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  jobs.kill(snap.id);
  const done = await jobs.wait(snap.id);
  assert.equal(done.status, 'killed');
});

test('killing a settled job is a no-op; unknown ids are null', async () => {
  const jobs = createJobRegistry();
  const snap = jobs.start('quick', async () => 'ok');
  await jobs.wait(snap.id);
  assert.equal(jobs.kill(snap.id).status, 'succeeded');
  assert.equal(jobs.kill('j99'), null);
  assert.equal(jobs.status('j99'), null);
  assert.equal(jobs.log('j99'), null);
  assert.equal(await jobs.wait('j99'), null);
});

test('the log ring buffer drops oldest lines past the cap and reports the count', async () => {
  const jobs = createJobRegistry({ logCap: 3 });
  const snap = jobs.start('chatty', async ({ log }) => {
    for (let i = 1; i <= 5; i++) log(`line-${i}`);
  });
  await jobs.wait(snap.id);
  const log = jobs.log(snap.id);
  assert.deepEqual(log.lines, ['line-3', 'line-4', 'line-5']);
  assert.equal(log.dropped, 2);
  assert.deepEqual(jobs.log(snap.id, { tail: 1 }).lines, ['line-5']);
});

test('list shows every job with public fields only', async () => {
  const jobs = createJobRegistry();
  jobs.start('a', async () => {});
  jobs.start('b', async () => {});
  const listed = jobs.list();
  assert.equal(listed.length, 2);
  assert.equal('controller' in listed[0], false);
  assert.equal('logs' in listed[0], false);
  assert.equal(typeof listed[0].logLines, 'number');
});

test('wait times out on a genuinely stuck job and reports running', async () => {
  const jobs = createJobRegistry();
  const snap = jobs.start('stuck', () => new Promise(() => {}));
  const still = await jobs.wait(snap.id, { timeoutMs: 80, pollMs: 10 });
  assert.equal(still.status, 'running');
  jobs.kill(snap.id);
});
