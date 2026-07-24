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

import { EXPECTED_TOOLS } from './helpers/expected-tools.mjs';

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

async function connected({ backend = fakeBackend(), config, jobs, servers, l1 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'driver-shots-'));
  const server = await createServer({
    backend,
    jobs,
    servers,
    l1,
    config: config ?? { screenshotDir: dir, runDir: dir, runtimesDir: dir },
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

test('driver_status reports phase 3 with L0, L1, and the server agent available', async () => {
  const { client, close } = await connected();
  const result = await client.callTool({ name: 'driver_status', arguments: {} });
  const status = JSON.parse(result.content[0].text);
  assert.equal(status.phase, 3);
  assert.match(status.layers.l0_os, /^available/);
  assert.match(status.layers.l1_build_test, /^available/);
  assert.match(status.layers.l3_agents, /^available/);
  assert.equal(status.transport, 'stdio-only');
  await close();
});

// ── protocol: L3 agent tools (fake handshake + fake connection) ──────────────

function fakeAgentConn() {
  const closed = { value: false };
  return {
    conn: {
      welcome: { agent: 'paper', capabilities: ['state', 'exec'], events: ['player_join'] },
      request: async (op, params) => {
        if (op === 'state') return { players: [{ name: 'Alice' }], worlds: [], version: 'MockPaper' };
        if (op === 'exec') return { dispatched: true, detail: null, echo: params.command };
        throw new Error(`unknown op ${op}`);
      },
      events: () => [{ name: 'player_join', data: { name: 'Bob' }, at: 'now' }],
      close: () => { closed.value = true; },
    },
    closed,
  };
}

test('agent lifecycle: connect → state → exec → events → disconnect', async () => {
  const { conn, closed } = fakeAgentConn();
  let handshakeDir = null;
  const { client, close } = await connected({
    l1: {
      agentHandshake: async (dir) => { handshakeDir = dir; return { v: 1, port: 5000, token: 'tok' }; },
      agentConnect: async ({ port, token }) => { assert.equal(port, 5000); assert.equal(token, 'tok'); return conn; },
    },
  });
  const c = JSON.parse((await client.callTool({ name: 'agent_connect', arguments: { dir: 'C:/srv' } })).content[0].text);
  assert.equal(handshakeDir, 'C:/srv');
  assert.equal(c.agent, 'paper');
  assert.deepEqual(c.capabilities, ['state', 'exec']);

  const state = JSON.parse((await client.callTool({ name: 'agent_state', arguments: { connectionId: c.connectionId } })).content[0].text);
  assert.equal(state.players[0].name, 'Alice');

  const exec = JSON.parse((await client.callTool({ name: 'agent_exec', arguments: { connectionId: c.connectionId, command: 'say hi' } })).content[0].text);
  assert.equal(exec.dispatched, true);
  assert.equal(exec.echo, 'say hi');

  const events = JSON.parse((await client.callTool({ name: 'agent_events', arguments: { connectionId: c.connectionId } })).content[0].text);
  assert.equal(events[0].name, 'player_join');

  const dc = JSON.parse((await client.callTool({ name: 'agent_disconnect', arguments: { connectionId: c.connectionId } })).content[0].text);
  assert.equal(dc.disconnected, c.connectionId);
  assert.equal(closed.value, true);
  await close();
});

test('agent_connect surfaces a missing handshake, and ops reject unknown connections', async () => {
  const { client, close } = await connected({
    l1: { agentHandshake: async () => { throw new Error('no agent handshake — is the agent enabled?'); } },
  });
  const missing = await client.callTool({ name: 'agent_connect', arguments: { dir: 'C:/srv' } });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /is the agent enabled/);

  for (const name of ['agent_state', 'agent_exec', 'agent_events', 'agent_disconnect']) {
    const args = name === 'agent_exec' ? { connectionId: 'a99', command: 'x' } : { connectionId: 'a99' };
    const res = await client.callTool({ name, arguments: args });
    assert.equal(res.isError, true, `${name} should reject unknown connection`);
  }
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

// ── protocol: L1 jobs + build + servers (module logic unit-tested elsewhere;
//    these prove the tool wiring, arg plumbing, and error surfacing) ──────────

import { createJobRegistry } from '../src/jobs.mjs';

function fakeServers() {
  const calls = [];
  return {
    calls,
    start(opts) { calls.push(['start', opts]); return { serverId: 's1', jobId: 'j1' }; },
    get() { return null; },
    list() { return [{ id: 's1', state: 'ready' }]; },
    async waitReady() { return 'ready'; },
    exec(id, command) { calls.push(['exec', id, command]); if (id === 's9') throw new Error(`no server ${id}`); return { sent: command }; },
    async stop(id) { calls.push(['stop', id]); if (id === 's9') throw new Error(`no server ${id}`); return { stopped: true, forced: false }; },
  };
}

test('build_gradle starts a job and the jobs_* tools drive its lifecycle', async () => {
  const jobs = createJobRegistry();
  const { client, close } = await connected({
    jobs,
    l1: {
      gradle: ({ jobs: j, projectDir, tasks }) => j.start(`gradle ${tasks.join(' ')} @ ${projectDir}`, async ({ log }) => {
        log('BUILD SUCCESSFUL');
        return { code: 0, outcome: 'SUCCESS', jars: ['a.jar'] };
      }),
    },
  });
  const snap = JSON.parse(
    (await client.callTool({ name: 'build_gradle', arguments: { projectDir: 'C:/proj', tasks: ['clean', 'build'] } })).content[0].text,
  );
  assert.equal(snap.status, 'running');
  await jobs.wait(snap.id);

  const status = JSON.parse((await client.callTool({ name: 'job_status', arguments: { id: snap.id } })).content[0].text);
  assert.equal(status.status, 'succeeded');
  assert.deepEqual(status.result.jars, ['a.jar']);

  const log = JSON.parse((await client.callTool({ name: 'job_log', arguments: { id: snap.id, tail: 1 } })).content[0].text);
  assert.deepEqual(log.lines, ['BUILD SUCCESSFUL']);

  const list = JSON.parse((await client.callTool({ name: 'jobs_list', arguments: {} })).content[0].text);
  assert.equal(list.length, 1);

  const killed = JSON.parse((await client.callTool({ name: 'job_kill', arguments: { id: snap.id } })).content[0].text);
  assert.equal(killed.status, 'succeeded'); // settled jobs stay settled

  for (const name of ['job_status', 'job_log', 'job_kill']) {
    const missing = await client.callTool({ name, arguments: { id: 'j404' } });
    assert.equal(missing.isError, true, `${name} should error on unknown id`);
  }
  await close();
});

test('server_provision runs provision+deploy inside a job', async () => {
  const jobs = createJobRegistry();
  const deployed = [];
  const { client, close } = await connected({
    jobs,
    l1: {
      provision: async ({ version, dir, port }) => ({ dir, jarPath: `${dir}/paper.jar`, build: 9, channel: 'STABLE', version, port }),
      deploy: async ({ pluginJar }) => { deployed.push(pluginJar); return { deployed: pluginJar }; },
    },
  });
  const snap = JSON.parse(
    (await client.callTool({
      name: 'server_provision',
      arguments: { version: '1.21.11', dir: 'C:/srv', port: 25599, plugins: ['x.jar', 'y.jar'] },
    })).content[0].text,
  );
  const done = await jobs.wait(snap.id);
  assert.equal(done.status, 'succeeded');
  assert.equal(done.result.build, 9);
  assert.equal(done.result.pluginsDeployed, 2);
  assert.deepEqual(deployed, ['x.jar', 'y.jar']);
  await close();
});

test('server_start resolves java, starts, and can block for readiness', async () => {
  const servers = fakeServers();
  const javaCalls = [];
  const { client, close } = await connected({
    servers,
    l1: { java: async (opts) => { javaCalls.push(opts); return { javaPath: '/managed/java', major: 21, provisioned: true }; } },
  });
  const started = JSON.parse(
    (await client.callTool({ name: 'server_start', arguments: { dir: 'C:/srv', waitReadyMs: 500 } })).content[0].text,
  );
  assert.deepEqual(started, { serverId: 's1', jobId: 'j1', state: 'ready' });
  assert.equal(javaCalls[0].feature, 21);
  assert.equal(servers.calls[0][1].javaPath, '/managed/java');

  const immediate = JSON.parse(
    (await client.callTool({ name: 'server_start', arguments: { dir: 'C:/srv' } })).content[0].text,
  );
  assert.equal(immediate.state, 'starting');
  await close();
});

test('server_start surfaces java-resolution failures', async () => {
  const { client, close } = await connected({
    servers: fakeServers(),
    l1: { java: async () => { throw new Error('no Temurin JRE mapping for sunos/x64'); } },
  });
  const result = await client.callTool({ name: 'server_start', arguments: { dir: 'C:/srv' } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Temurin/);
  await close();
});

test('server_exec / server_stop / servers_list plumb through and surface errors', async () => {
  const servers = fakeServers();
  const { client, close } = await connected({ servers });
  assert.deepEqual(
    JSON.parse((await client.callTool({ name: 'server_exec', arguments: { serverId: 's1', command: 'list' } })).content[0].text),
    { sent: 'list' },
  );
  assert.deepEqual(
    JSON.parse((await client.callTool({ name: 'server_stop', arguments: { serverId: 's1' } })).content[0].text),
    { stopped: true, forced: false },
  );
  assert.equal(
    JSON.parse((await client.callTool({ name: 'servers_list', arguments: {} })).content[0].text)[0].id,
    's1',
  );
  for (const [name, args] of [
    ['server_exec', { serverId: 's9', command: 'x' }],
    ['server_stop', { serverId: 's9' }],
  ]) {
    const missing = await client.callTool({ name, arguments: args });
    assert.equal(missing.isError, true, `${name} should error on unknown server`);
  }
  await close();
});
