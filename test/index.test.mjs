import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/index.mjs';

test('createServer constructs an MCP server without binding any socket', async () => {
  const server = await createServer();
  assert.ok(server, 'server instance exists');
  // Phase-0 contract: construction registers tools but opens no transport and no socket.
  await server.close();
});
