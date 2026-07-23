// Unit layer: Paper provisioning + the live-server manager (fake fetch/process; the
// real boot is scripts/server-smoke.mjs locally and in CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobRegistry } from '../src/jobs.mjs';
import {
  createServerManager, deployPlugin, provisionServer, resolvePaperDownload,
} from '../src/paper.mjs';

const jsonResponse = (body, ok = true, status = 200) => ({
  ok, status, json: async () => body,
});
const bytesResponse = (text) => ({
  ok: true, status: 200,
  body: new Blob([text]).stream(),
});

// ── resolve + provision ──────────────────────────────────────────────────────

test('resolvePaperDownload returns the server:default url/build/channel', async () => {
  const fetchImpl = async (url) => {
    assert.match(String(url), /fill\.papermc\.io\/v3\/projects\/paper\/versions\/1\.21\.11\/builds\/latest/);
    return jsonResponse({ id: 118, channel: 'STABLE', downloads: { 'server:default': { url: 'https://dl/paper.jar' } } });
  };
  assert.deepEqual(await resolvePaperDownload('1.21.11', { fetchImpl }),
    { url: 'https://dl/paper.jar', build: 118, channel: 'STABLE' });
});

test('resolvePaperDownload fails loudly on HTTP errors and missing downloads', async () => {
  await assert.rejects(
    () => resolvePaperDownload('9.9.9', { fetchImpl: async () => jsonResponse({}, false, 404) }),
    /HTTP 404/,
  );
  await assert.rejects(
    () => resolvePaperDownload('1.21.11', { fetchImpl: async () => jsonResponse({ id: 1, downloads: {} }) }),
    /no server:default download/,
  );
});

test('provisionServer downloads the jar and writes a loopback offline config', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'paper-prov-')), 'srv');
  try {
    const fetchImpl = async (url) => (String(url).includes('builds/latest')
      ? jsonResponse({ id: 5, channel: 'STABLE', downloads: { 'server:default': { url: 'https://dl/x.jar' } } })
      : bytesResponse('FAKE-PAPER-JAR'));
    const logs = [];
    const result = await provisionServer({ version: '1.21.11', dir, port: 25599, fetchImpl, log: (l) => logs.push(l) });
    assert.equal(result.build, 5);
    assert.equal(await readFile(result.jarPath, 'utf8'), 'FAKE-PAPER-JAR');
    assert.equal(await readFile(join(dir, 'eula.txt'), 'utf8'), 'eula=true\n');
    const props = await readFile(join(dir, 'server.properties'), 'utf8');
    assert.match(props, /online-mode=false/);
    assert.match(props, /server-port=25599/);
    assert.match(props, /server-ip=127\.0\.0\.1/);
    assert.equal(logs.length >= 2, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('provisionServer surfaces a failed jar download', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'paper-prov-')), 'srv');
  try {
    const fetchImpl = async (url) => (String(url).includes('builds/latest')
      ? jsonResponse({ id: 5, channel: 'STABLE', downloads: { 'server:default': { url: 'https://dl/x.jar' } } })
      : { ok: false, status: 503 });
    await assert.rejects(() => provisionServer({ version: '1.21.11', dir, fetchImpl }), /HTTP 503/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('deployPlugin copies the jar into plugins/', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'paper-dep-')), 'srv');
  try {
    const fetchImpl = async (url) => (String(url).includes('builds/latest')
      ? jsonResponse({ id: 5, channel: 'STABLE', downloads: { 'server:default': { url: 'https://dl/x.jar' } } })
      : bytesResponse('JAR'));
    await provisionServer({ version: '1.21.11', dir, fetchImpl });
    const pluginJar = join(dir, '..', 'myplugin-1.0.jar');
    await writeFile(pluginJar, 'PLUGIN');
    const { deployed } = await deployPlugin({ dir, pluginJar });
    assert.equal(await readFile(deployed, 'utf8'), 'PLUGIN');
    assert.match(deployed, /plugins[\\/]myplugin-1\.0\.jar$/);
  } finally { await rm(join(dir, '..'), { recursive: true, force: true }); }
});

// ── server manager ───────────────────────────────────────────────────────────

/** Job fns start on a microtask — wait for the fake child to be spawned. */
const spawned = (handles, n = 1) => new Promise((resolve) => {
  const poll = () => (handles.length >= n ? resolve() : setImmediate(poll));
  poll();
});

/** A scriptable fake server process driven through the manager's run seam. */
function fakeServerRun() {
  const handles = [];
  const run = ({ signal, onSpawn, onLine }) => new Promise((resolve, reject) => {
    const child = { stdin: { written: [], write(s) { this.written.push(s); } } };
    const handle = {
      child,
      emitLine: onLine,
      finish: (code) => resolve({ code }),
      onStop: null,
    };
    child.stdin.write = (s) => {
      handle.child.stdin.written.push(s);
      if (s === 'stop\n' && handle.onStop) handle.onStop();
    };
    signal?.addEventListener('abort', () => reject(new Error('killed by abort signal')), { once: true });
    handles.push(handle);
    onSpawn(child);
  });
  return { run, handles };
}

test('start → ready-line flips state; exec writes stdin; graceful stop', async () => {
  const jobs = createJobRegistry();
  const { run, handles } = fakeServerRun();
  const servers = createServerManager({ jobs, run });
  const { serverId, jobId } = servers.start({ dir: '/srv', javaPath: 'java' });
  assert.equal(servers.get(serverId).state, 'starting');
  await spawned(handles);

  handles[0].emitLine('[Server] Loading libraries…');
  handles[0].emitLine('[Server thread/INFO]: Done (3.2s)! For help, type "help"');
  assert.equal(await servers.waitReady(serverId, { timeoutMs: 1000, pollMs: 5 }), 'ready');

  assert.deepEqual(servers.exec(serverId, 'list'), { sent: 'list' });
  assert.equal(handles[0].child.stdin.written.at(-1), 'list\n');

  handles[0].onStop = () => handles[0].finish(0);
  const stopped = await servers.stop(serverId, { timeoutMs: 5000 });
  assert.deepEqual(stopped, { stopped: true, forced: false });
  assert.equal(servers.get(serverId).state, 'stopped');
  assert.equal((await jobs.wait(jobId)).status, 'succeeded');
  assert.equal(servers.list().length, 1);
});

test('a stubborn server gets force-killed via the job abort', async () => {
  const jobs = createJobRegistry();
  const { run, handles } = fakeServerRun();
  const servers = createServerManager({ jobs, run });
  const { serverId, jobId } = servers.start({ dir: '/srv' });
  await spawned(handles);
  handles[0].emitLine('Done (1s)!');
  const stopped = await servers.stop(serverId, { timeoutMs: 150 });
  assert.deepEqual(stopped, { stopped: true, forced: true });
  assert.equal((await jobs.wait(jobId)).status, 'killed');
});

test('a crashing server fails its job and reads stopped', async () => {
  const jobs = createJobRegistry();
  const { run, handles } = fakeServerRun();
  const servers = createServerManager({ jobs, run });
  const { serverId, jobId } = servers.start({ dir: '/srv' });
  await spawned(handles);
  handles[0].finish(1);
  const done = await jobs.wait(jobId);
  assert.equal(done.status, 'failed');
  assert.match(done.error, /server exited 1/);
  assert.equal(await servers.waitReady(serverId, { timeoutMs: 500, pollMs: 5 }), 'stopped');
  await assert.rejects(async () => servers.exec(serverId, 'list'), /not running/);
});

test('unknown ids are rejected/absent across the manager surface', async () => {
  const servers = createServerManager({ jobs: createJobRegistry(), run: async () => ({ code: 0 }) });
  assert.equal(servers.get('s9'), null);
  assert.equal(await servers.waitReady('s9'), null);
  assert.throws(() => servers.exec('s9', 'x'), /no server s9/);
  await assert.rejects(() => servers.stop('s9'), /no server s9/);
});
