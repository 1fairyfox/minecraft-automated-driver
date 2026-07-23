// Unit + protocol layer tests for the MCP server core.
// Layer map (testing standard): unit → protocol (in-memory client) → e2e (stdio.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, readVersion } from '../src/index.mjs';

// ── Unit: readVersion ────────────────────────────────────────────────────────

test('readVersion returns the trimmed repo VERSION (semver-shaped)', async () => {
  const v = await readVersion();
  assert.match(v, /^\d+\.\d+\.\d+$/, `VERSION should be semver, got: ${v}`);
});

test('readVersion falls back to "unknown" when no VERSION file exists', async () => {
  const v = await readVersion(join(tmpdir(), 'no-such-dir-' + Date.now()));
  assert.equal(v, 'unknown');
});

// ── Unit: construction ───────────────────────────────────────────────────────

test('createServer constructs an MCP server without binding any socket', async () => {
  const server = await createServer();
  assert.ok(server, 'server instance exists');
  await server.close();
});

// ── Protocol layer: real MCP session over an in-memory transport ─────────────

async function connectedClient() {
  const server = await createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

test('server identifies itself as minecraft-automated-driver with the repo version', async () => {
  const { server, client } = await connectedClient();
  const info = client.getServerVersion();
  assert.equal(info.name, 'minecraft-automated-driver');
  assert.equal(info.version, await readVersion());
  await client.close();
  await server.close();
});

test('tools/list exposes exactly the Phase-0 surface: driver_status', async () => {
  const { server, client } = await connectedClient();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), ['driver_status']);
  await client.close();
  await server.close();
});

test('driver_status reports version, phase, stdio-only transport, and all four layers', async () => {
  const { server, client } = await connectedClient();
  const result = await client.callTool({ name: 'driver_status', arguments: {} });
  assert.equal(result.isError ?? false, false);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  const status = JSON.parse(result.content[0].text);
  assert.equal(status.name, 'minecraft-automated-driver');
  assert.equal(status.version, await readVersion());
  assert.equal(status.phase, 0);
  assert.equal(status.transport, 'stdio-only');
  assert.deepEqual(Object.keys(status.layers), ['l0_os', 'l1_build_test', 'l2_protocol_bots', 'l3_agents']);
  for (const v of Object.values(status.layers)) assert.match(v, /^planned \(Phase/);
  await client.close();
  await server.close();
});
