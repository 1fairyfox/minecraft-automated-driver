// Unit layer: the driver-side control-plane client, exercised against a REAL loopback
// NDJSON stub that mimics the agent (docs/control-protocol.md). No mocks of net.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectAgent, readHandshake } from '../src/agent.mjs';

/** A loopback stub speaking the agent protocol; `behavior` tweaks the handshake. */
function stubAgent({ token = 'good-token', rejectAuth = false, emitEventAfterHello = false } = {}) {
  const server = net.createServer((socket) => {
    let buf = '';
    let authed = false;
    socket.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.trim() === '') continue;
        const msg = JSON.parse(line);
        if (!authed) {
          if (rejectAuth || msg.type !== 'hello' || msg.token !== token) { socket.end(); return; }
          authed = true;
          socket.write(`${JSON.stringify({ type: 'welcome', v: 1, agent: 'paper', capabilities: ['state', 'exec'], events: ['player_join'] })}\n`);
          if (emitEventAfterHello) socket.write(`${JSON.stringify({ type: 'event', name: 'player_join', data: { name: 'Bob' } })}\n`);
          continue;
        }
        if (msg.op === 'state') {
          socket.write(`${JSON.stringify({ type: 'res', id: msg.id, ok: true, players: [{ name: 'Alice' }] })}\n`);
        } else if (msg.op === 'exec') {
          socket.write(`${JSON.stringify({ type: 'res', id: msg.id, ok: true, dispatched: true, echo: msg.command })}\n`);
        } else if (msg.op === 'slow') {
          /* deliberately never respond — timeout path */
        } else {
          socket.write(`${JSON.stringify({ type: 'res', id: msg.id, ok: false, error: `unknown op: ${msg.op}` })}\n`);
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('readHandshake reads and validates the discovery file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-hs-'));
  try {
    const pluginDir = join(dir, 'plugins', 'minecraft-automated-driver-agent');
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, 'handshake.json'), JSON.stringify({ v: 1, port: 5, token: 't', agent: 'paper' }));
    const hs = await readHandshake(dir);
    assert.equal(hs.port, 5);
    assert.equal(hs.token, 't');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('readHandshake fails clearly when absent or malformed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-hs-'));
  try {
    await assert.rejects(() => readHandshake(dir), /is the agent enabled/);
    const pluginDir = join(dir, 'plugins', 'minecraft-automated-driver-agent');
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, 'handshake.json'), JSON.stringify({ v: 1 }));
    await assert.rejects(() => readHandshake(dir), /malformed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('connect → welcome, state, exec against a real loopback stub', async () => {
  const { server, port } = await stubAgent();
  try {
    const conn = await connectAgent({ port, token: 'good-token' });
    assert.equal(conn.welcome.agent, 'paper');
    assert.deepEqual((await conn.request('state')).players, [{ name: 'Alice' }]);
    assert.equal((await conn.request('exec', { command: 'help' })).echo, 'help');
    await assert.rejects(() => conn.request('teleport'), /unknown op/);
    conn.close();
  } finally { server.close(); }
});

test('events pushed by the agent are buffered and drainable', async () => {
  const { server, port } = await stubAgent({ emitEventAfterHello: true });
  try {
    const conn = await connectAgent({ port, token: 'good-token' });
    await conn.request('state'); // give the event a beat to arrive
    const events = conn.events();
    assert.equal(events.some((e) => e.name === 'player_join' && e.data.name === 'Bob'), true);
    conn.close();
  } finally { server.close(); }
});

test('a rejected auth surfaces as a connection failure', async () => {
  const { server, port } = await stubAgent({ rejectAuth: true });
  try {
    await assert.rejects(() => connectAgent({ port, token: 'anything' }), /connection (failed|closed)/);
  } finally { server.close(); }
});

test('a wrong token is refused', async () => {
  const { server, port } = await stubAgent({ token: 'right' });
  try {
    await assert.rejects(() => connectAgent({ port, token: 'wrong' }), /connection (failed|closed)/);
  } finally { server.close(); }
});

test('a request that never gets a response times out', async () => {
  const { server, port } = await stubAgent();
  try {
    const conn = await connectAgent({ port, token: 'good-token' });
    await assert.rejects(() => conn.request('slow', {}, { timeoutMs: 100 }), /timed out/);
    conn.close();
  } finally { server.close(); }
});
