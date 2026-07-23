// Unit layer: the process runner — real node child processes, cross-platform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../src/proc.mjs';

const node = (code) => ({ command: process.execPath, args: ['-e', code] });

test('streams stdout and stderr lines with tags and resolves the exit code', async () => {
  const lines = [];
  const { code } = await runProcess({
    ...node('console.log("a\\nb"); console.error("e1"); process.stdout.write("tail-no-newline")'),
    onLine: (line, tag) => lines.push([tag, line]),
  });
  assert.equal(code, 0);
  assert.deepEqual(lines.filter(([t]) => t === 'out').map(([, l]) => l), ['a', 'b', 'tail-no-newline']);
  assert.deepEqual(lines.filter(([t]) => t === 'err').map(([, l]) => l), ['e1']);
});

test('non-zero exits resolve (callers judge the code)', async () => {
  const { code } = await runProcess({ ...node('process.exit(7)') });
  assert.equal(code, 7);
});

test('abort signal kills the child and rejects', async () => {
  const controller = new AbortController();
  const promise = runProcess({
    ...node('setInterval(() => {}, 1000)'),
    signal: controller.signal,
    onSpawn: () => setTimeout(() => controller.abort(), 100),
  });
  await assert.rejects(promise, /killed by abort signal/);
});

test('an already-aborted signal kills immediately', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runProcess({ ...node('setInterval(() => {}, 1000)'), signal: controller.signal }),
    /killed by abort signal/,
  );
});

test('spawn failure rejects with a clear message', async () => {
  await assert.rejects(
    runProcess({ command: 'definitely-not-a-real-exe-xyz' }),
    /could not start/,
  );
});

test('env merges over the parent environment', async () => {
  let seen = '';
  await runProcess({
    ...node('console.log(process.env.FF_PROBE)'),
    env: { FF_PROBE: 'hello' },
    onLine: (line) => { seen += line; },
  });
  assert.equal(seen, 'hello');
});
