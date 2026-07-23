#!/usr/bin/env node
// os-smoke.mjs — REAL-machine proof of the Phase 1 exit criteria (roadmap L0):
// spawn a windowed app, find its window, screenshot it, close it. Runs locally on the
// dev box and in the windows-latest CI job. No mocks anywhere.
//
//   node scripts/os-smoke.mjs
import { stat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWindowsBackend } from '../src/os/windows.mjs';

if (process.platform !== 'win32') {
  console.error('os-smoke: Windows-only (the L0 backend targets win32); nothing to prove here.');
  process.exit(1);
}

const backend = createWindowsBackend();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollFor(desc, fn, { tries = 30, delayMs = 500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const value = await fn();
    if (value) return value;
    await sleep(delayMs);
  }
  throw new Error(`timed out waiting for ${desc}`);
}

const findNotepad = async () =>
  (await backend.listWindows()).find((w) => w.process.toLowerCase() === 'notepad');

let failed = false;
const dir = await mkdtemp(join(tmpdir(), 'os-smoke-'));
try {
  console.log('1) spawn notepad (detached)…');
  backend.openProcess({ command: 'notepad.exe' });

  // On Win11 the store Notepad re-launches under its own process, so match the
  // window's owning process by name rather than trusting the spawned pid.
  console.log('2) wait for its window…');
  const win = await pollFor('a notepad window', findNotepad);
  console.log(`   found: pid=${win.pid} hwnd=${win.hwnd} title=${JSON.stringify(win.title)}`);

  console.log('3) screenshot it…');
  const outPath = join(dir, 'notepad.png');
  const shot = await backend.screenshotWindow({ hwnd: win.hwnd, outPath });
  const { size } = await stat(shot.path);
  if (size < 1000) throw new Error(`screenshot suspiciously small (${size} bytes)`);
  console.log(`   ${shot.width}x${shot.height}, ${size} bytes`);

  console.log('4) close it (graceful, then forced)…');
  const closed = await backend.closeProcess({ pid: win.pid, force: true, timeoutMs: 3000 });
  if (!closed.closed) throw new Error('process did not close');
  await pollFor('the notepad window to disappear', async () => !(await findNotepad()));

  console.log('os-smoke: PASS — spawn → list → screenshot → close, all real.');
} catch (err) {
  failed = true;
  console.error(`os-smoke: FAIL — ${err.message}`);
} finally {
  await rm(dir, { recursive: true, force: true });
  // Belt-and-braces: never leave a stray notepad behind.
  const leftover = await findNotepad().catch(() => null);
  if (leftover) await backend.closeProcess({ pid: leftover.pid, force: true, timeoutMs: 1000 }).catch(() => {});
}
process.exit(failed ? 1 : 0);
