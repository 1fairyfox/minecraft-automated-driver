// Unit + protocol layer tests for the MCP server core and the Phase 1 tool surface.
// Layer map (testing standard): unit → protocol (in-memory client) → e2e (stdio.e2e).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, readVersion } from '../src/index.mjs';

export const EXPECTED_TOOLS = [
  'driver_status', 'instance_close', 'instance_open', 'instances_list',
  'os_screenshot', 'os_windows_list',
];

const WINDOWS = [
  { pid: 7, process: 'javaw', title: 'Minecraft 1.21.11 - Multiplayer', hwnd: 111 },
  { pid: 9, process: 'notepad', title: 'notes.txt - Notepad', hwnd: 222 },
];

/** Fake L0 backend: happy-path by default, overridable per test. */
function fakeBackend(overrides = {}) {
  return {
    listWindows: async () => WINDOWS,
    screenshotWindow: async ({ hwnd, outPath }) => {
      await writeFile(outPath, Buffer.from(`png-of-${hwnd}`));
      return { path: outPath, width: 640, height: 480 };
    },
    closeProcess: async ({ pid, force }) => ({ closed: true, forced: force, reason: null, pid }),
    openProcess: ({ command }) => ({ pid: command === 'boom.exe' ? undefined : 4242 }),
    ...overrides,
  };
}

async function connected({ backend = fakeBackend(), config } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'driver-shots-'));
  const server = await createServer({
    backend,
    config: config ?? { screenshotDir: dir },
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const close = async () => { await client.close(); await server.close(); await rm(dir, { recursive: true, force: true }); };
  return { client, close };
}

// ── unit: version handling ───────────────────────────────────────────────────

test('readVersion returns the trimmed repo VERSION (semver-shaped)', async () => {
  assert.match(await readVersion(), /^\d+\.\d+\.\d+$/);
});

test('readVersion falls back to "unknown" when no VERSION file exists', async () => {
  assert.equal(await readVersion(join(tmpdir(), 'no-such-dir-' + Date.now())), 'unknown');
});

// ── protocol: identity + surface ─────────────────────────────────────────────

test('server identifies itself with the repo version', async () => {
  const { client, close } = await connected();
  const info = client.getServerVersion();
  assert.equal(info.name, 'minecraft-automated-driver');
  assert.equal(info.version, await readVersion());
  await close();
});

test('tools/list exposes exactly the Phase-1 surface', async () => {
  const { client, close } = await connected();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), EXPECTED_TOOLS);
  await close();
});

test('driver_status reports phase 1 with the L0 layer available', async () => {
  const { client, close } = await connected();
  const result = await client.callTool({ name: 'driver_status', arguments: {} });
  const status = JSON.parse(result.content[0].text);
  assert.equal(status.phase, 1);
  assert.match(status.layers.l0_os, /^available/);
  assert.equal(status.transport, 'stdio-only');
  await close();
});

// ── protocol: os_windows_list ────────────────────────────────────────────────

test('os_windows_list returns the window table', async () => {
  const { client, close } = await connected();
  const result = await client.callTool({ name: 'os_windows_list', arguments: {} });
  assert.deepEqual(JSON.parse(result.content[0].text), WINDOWS);
  await close();
});

test('os_windows_list surfaces backend errors as tool errors', async () => {
  const { client, close } = await connected({
    backend: fakeBackend({ listWindows: async () => { throw new Error('listWindows needs the Windows OS layer'); } }),
  });
  const result = await client.callTool({ name: 'os_windows_list', arguments: {} });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Windows OS layer/);
  await close();
});

// ── protocol: os_screenshot ──────────────────────────────────────────────────

test('os_screenshot by hwnd returns metadata text + PNG image content', async () => {
  const { client, close } = await connected();
  const result = await client.callTool({ name: 'os_screenshot', arguments: { hwnd: 111 } });
  assert.equal(result.isError ?? false, false);
  const meta = JSON.parse(result.content[0].text);
  assert.equal(meta.width, 640);
  const image = result.content[1];
  assert.equal(image.type, 'image');
  assert.equal(image.mimeType, 'image/png');
  assert.equal(Buffer.from(image.data, 'base64').toString(), 'png-of-111');
  await close();
});

test('os_screenshot resolves a window by pid and by title substring', async () => {
  const { client, close } = await connected();
  const byPid = await client.callTool({ name: 'os_screenshot', arguments: { pid: 9 } });
  assert.equal(Buffer.from(byPid.content[1].data, 'base64').toString(), 'png-of-222');
  const byTitle = await client.callTool({ name: 'os_screenshot', arguments: { title: 'Minecraft' } });
  assert.equal(Buffer.from(byTitle.content[1].data, 'base64').toString(), 'png-of-111');
  await close();
});

test('os_screenshot with no matching window is a tool error', async () => {
  const { client, close } = await connected();
  const result = await client.callTool({ name: 'os_screenshot', arguments: { title: 'no such window' } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /no window matched/);
  await close();
});

// ── protocol: instance lifecycle ─────────────────────────────────────────────

test('instance_open registers and instance_close by id removes on success', async () => {
  const { client, close } = await connected();
  const opened = JSON.parse(
    (await client.callTool({ name: 'instance_open', arguments: { command: 'paper.exe', title: 'server' } })).content[0].text,
  );
  assert.equal(opened.pid, 4242);
  assert.equal(opened.kind, 'spawned');

  let listed = JSON.parse((await client.callTool({ name: 'instances_list', arguments: {} })).content[0].text);
  assert.equal(listed.spawned.length, 1);
  assert.deepEqual(listed.windows, WINDOWS);

  const closed = JSON.parse(
    (await client.callTool({ name: 'instance_close', arguments: { id: opened.id, force: true } })).content[0].text,
  );
  assert.equal(closed.closed, true);
  assert.equal(closed.forced, true);
  assert.equal(closed.pid, 4242);

  listed = JSON.parse((await client.callTool({ name: 'instances_list', arguments: {} })).content[0].text);
  assert.equal(listed.spawned.length, 0);
  await close();
});

test('instance_close by raw pid works without a registry entry', async () => {
  const { client, close } = await connected();
  const closed = JSON.parse(
    (await client.callTool({ name: 'instance_close', arguments: { pid: 999 } })).content[0].text,
  );
  assert.equal(closed.pid, 999);
  await close();
});

test('instance_close with unknown id / no target is a tool error', async () => {
  const { client, close } = await connected();
  const unknown = await client.callTool({ name: 'instance_close', arguments: { id: 'i99' } });
  assert.equal(unknown.isError, true);
  assert.match(unknown.content[0].text, /no instance with id/);
  const neither = await client.callTool({ name: 'instance_close', arguments: {} });
  assert.equal(neither.isError, true);
  assert.match(neither.content[0].text, /provide id or pid/);
  await close();
});

test('a not-closed result keeps the registry entry', async () => {
  const { client, close } = await connected({
    backend: fakeBackend({ closeProcess: async () => ({ closed: false, forced: false, reason: 'stubborn' }) }),
  });
  const opened = JSON.parse(
    (await client.callTool({ name: 'instance_open', arguments: { command: 'x.exe' } })).content[0].text,
  );
  await client.callTool({ name: 'instance_close', arguments: { id: opened.id } });
  const listed = JSON.parse((await client.callTool({ name: 'instances_list', arguments: {} })).content[0].text);
  assert.equal(listed.spawned.length, 1);
  await close();
});

test('instance_open surfaces spawn failures as tool errors', async () => {
  const { client, close } = await connected({
    backend: fakeBackend({ openProcess: () => { throw new Error('spawn ENOENT'); } }),
  });
  const result = await client.callTool({ name: 'instance_open', arguments: { command: 'ghost.exe' } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /ENOENT/);
  await close();
});

// ── protocol: instances_list degrades when the OS layer is unavailable ───────

test('instances_list reports windows as unavailable rather than failing wholesale', async () => {
  const { client, close } = await connected({
    backend: fakeBackend({ listWindows: async () => { throw new Error('no windows here'); } }),
  });
  const listed = JSON.parse((await client.callTool({ name: 'instances_list', arguments: {} })).content[0].text);
  assert.deepEqual(listed.spawned, []);
  assert.match(listed.windows.unavailable, /no windows here/);
  await close();
});
