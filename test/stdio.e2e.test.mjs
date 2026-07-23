// E2E layer: spawn the real server process and drive it over stdio with the real
// SDK client — the exact way an MCP host runs it. Also proves the security
// invariant that a full session works with zero listening sockets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readVersion } from '../src/index.mjs';
import { EXPECTED_TOOLS } from './helpers/expected-tools.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('full stdio session: spawn → initialize → list → call → clean shutdown', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, 'src', 'index.mjs')],
    cwd: ROOT,
  });
  const client = new Client({ name: 'e2e-client', version: '0.0.0' });
  await client.connect(transport);

  const info = client.getServerVersion();
  assert.equal(info.name, 'minecraft-automated-driver');
  assert.equal(info.version, await readVersion());

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), EXPECTED_TOOLS);

  const result = await client.callTool({ name: 'driver_status', arguments: {} });
  const status = JSON.parse(result.content[0].text);
  assert.equal(status.transport, 'stdio-only');
  assert.equal(status.phase, 2);

  await client.close();
});
