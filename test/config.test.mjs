// Unit layer: driver configuration loading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS, loadConfig } from '../src/config.mjs';

async function inTmp(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'driver-config-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('absent driver.config.json yields pure defaults', async () => {
  await inTmp(async (dir) => {
    const cfg = await loadConfig(dir);
    assert.deepEqual(cfg, { ...DEFAULTS });
  });
});

test('present config merges over defaults', async () => {
  await inTmp(async (dir) => {
    await writeFile(join(dir, 'driver.config.json'), JSON.stringify({ screenshotDir: 'X:/shots', extra: 1 }));
    const cfg = await loadConfig(dir);
    assert.equal(cfg.screenshotDir, 'X:/shots');
    assert.equal(cfg.extra, 1);
  });
});

test('invalid JSON fails loudly', async () => {
  await inTmp(async (dir) => {
    await writeFile(join(dir, 'driver.config.json'), '{ not json');
    await assert.rejects(() => loadConfig(dir), /not valid JSON/);
  });
});

test('unreadable config (non-ENOENT) fails loudly', async () => {
  await inTmp(async (dir) => {
    await mkdir(join(dir, 'driver.config.json')); // a directory: read fails, not ENOENT
    await assert.rejects(() => loadConfig(dir), /unreadable/);
  });
});
