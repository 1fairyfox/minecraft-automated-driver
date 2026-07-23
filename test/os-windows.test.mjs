// Unit layer: the Windows OS backend — logic fully covered cross-platform via
// injected runners/spawners; the real thing is proven by scripts/os-smoke.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWindowsBackend, defaultRunPs, normalizeJsonList, psQuote,
} from '../src/os/windows.mjs';

const win = (deps) => createWindowsBackend({ platform: 'win32', ...deps });

// ── helpers ──────────────────────────────────────────────────────────────────

test('psQuote single-quotes and escapes embedded quotes', () => {
  assert.equal(psQuote('plain'), "'plain'");
  assert.equal(psQuote("o'brien.png"), "'o''brien.png'");
});

test('normalizeJsonList handles empty, single-object, and array output', () => {
  assert.deepEqual(normalizeJsonList('  \n'), []);
  assert.deepEqual(normalizeJsonList('{"a":1}'), [{ a: 1 }]);
  assert.deepEqual(normalizeJsonList('[{"a":1},{"a":2}]'), [{ a: 1 }, { a: 2 }]);
});

// ── listWindows ──────────────────────────────────────────────────────────────

test('listWindows maps PowerShell rows to the public shape', async () => {
  const backend = win({
    runPs: async () => '[{"Id":7,"ProcessName":"javaw","MainWindowTitle":"Minecraft 1.21.11","Hwnd":123456}]',
  });
  assert.deepEqual(await backend.listWindows(), [
    { pid: 7, process: 'javaw', title: 'Minecraft 1.21.11', hwnd: 123456 },
  ]);
});

// ── screenshotWindow ─────────────────────────────────────────────────────────

test('screenshotWindow validates hwnd and method', async () => {
  const backend = win({ runPs: async () => { throw new Error('should not run'); } });
  await assert.rejects(() => backend.screenshotWindow({ hwnd: 0, outPath: 'x.png' }), /invalid hwnd/);
  await assert.rejects(() => backend.screenshotWindow({ hwnd: NaN, outPath: 'x.png' }), /invalid hwnd/);
  await assert.rejects(
    () => backend.screenshotWindow({ hwnd: 5, outPath: 'x.png', method: 'magic' }),
    /unknown method/,
  );
});

test('screenshotWindow builds a PrintWindow script by default, screen-copy on request', async () => {
  const scripts = [];
  const backend = win({
    runPs: async (s) => { scripts.push(s); return '{"path":"out.png","width":10,"height":20}'; },
  });
  const result = await backend.screenshotWindow({ hwnd: 42, outPath: 'out.png' });
  assert.deepEqual(result, { path: 'out.png', width: 10, height: 20 });
  assert.match(scripts[0], /PrintWindow/);
  assert.match(scripts[0], /\[IntPtr\]42/);

  await backend.screenshotWindow({ hwnd: 42, outPath: "o'brien.png", method: 'screen' });
  assert.match(scripts[1], /CopyFromScreen/);
  assert.match(scripts[1], /'o''brien\.png'/); // path safely quoted
});

// ── closeProcess ─────────────────────────────────────────────────────────────

test('closeProcess validates pid and parses the result', async () => {
  const scripts = [];
  const backend = win({
    runPs: async (s) => { scripts.push(s); return '{"closed":true,"forced":false,"reason":null}'; },
  });
  await assert.rejects(() => backend.closeProcess({ pid: -1 }), /invalid pid/);
  await assert.rejects(() => backend.closeProcess({ pid: 1.5 }), /invalid pid/);
  const result = await backend.closeProcess({ pid: 314, timeoutMs: 250 });
  assert.deepEqual(result, { closed: true, forced: false, reason: null });
  assert.match(scripts[0], /-Id 314/);
  assert.match(scripts[0], /WaitForExit\(250\)/);
  assert.match(scripts[0], /\$false/); // force not requested

  await backend.closeProcess({ pid: 314, force: true });
  assert.match(scripts[1], /Stop-Process -Id 314 -Force/);
});

// ── openProcess ──────────────────────────────────────────────────────────────

test('openProcess spawns detached and returns the pid', () => {
  let seen;
  const backend = win({
    spawnImpl: (command, args, opts) => {
      seen = { command, args, opts };
      return { pid: 777, unref() { seen.unrefed = true; } };
    },
  });
  const result = backend.openProcess({ command: 'notepad.exe', args: ['a.txt'], cwd: 'C:/tmp' });
  assert.deepEqual(result, { pid: 777 });
  assert.equal(seen.command, 'notepad.exe');
  assert.deepEqual(seen.args, ['a.txt']);
  assert.equal(seen.opts.detached, true);
  assert.equal(seen.opts.cwd, 'C:/tmp');
  assert.equal(seen.unrefed, true);
});

// ── platform guard ───────────────────────────────────────────────────────────

test('non-Windows hosts get a clear error from every OS-touching call', async () => {
  const backend = createWindowsBackend({ platform: 'linux', runPs: async () => '' });
  await assert.rejects(() => backend.listWindows(), /Windows OS layer.*linux/);
  await assert.rejects(() => backend.screenshotWindow({ hwnd: 1, outPath: 'x' }), /Windows OS layer/);
  await assert.rejects(() => backend.closeProcess({ pid: 1 }), /Windows OS layer/);
});

// ── defaultRunPs (cross-platform via injectable executable) ──────────────────

test('defaultRunPs resolves stdout on exit 0', async () => {
  const out = await defaultRunPs('console.log("hello from fake ps")', {
    exe: process.execPath, flagArgs: ['-e'],
  });
  assert.equal(out.trim(), 'hello from fake ps');
});

test('defaultRunPs rejects with stderr on non-zero exit', async () => {
  await assert.rejects(
    () => defaultRunPs('console.error("boom"); process.exit(3)', { exe: process.execPath, flagArgs: ['-e'] }),
    /exited 3: boom/,
  );
});

test('defaultRunPs rejects when the executable cannot start', async () => {
  await assert.rejects(
    () => defaultRunPs('x', { exe: 'definitely-not-a-real-exe-xyz' }),
    /could not start/,
  );
});
