#!/usr/bin/env node
/**
 * Minecraft Automated Driver — MCP server entry point (stdio transport ONLY).
 *
 * Security invariants (see SECURITY.md — do not weaken):
 *  - This process never binds a network socket for MCP; it speaks stdio to its client.
 *  - Any future driver⇄agent control plane binds 127.0.0.1 only, ephemeral port,
 *    per-session token. That code does not exist yet (Phase 3+).
 *
 * Phase 0: registers the single `driver_status` tool so the server is real,
 * inspectable, and testable from day one. The tool registry grows per
 * notes/plans/roadmap-2026-07.md — one module per layer (L0 os, L1 build, L2 bots,
 * L3 agents), each registering its own tools.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Read the repo VERSION file; 'unknown' when absent (root injectable for tests). */
export async function readVersion(root = ROOT) {
  try {
    return (await readFile(join(root, 'VERSION'), 'utf8')).trim();
  } catch {
    return 'unknown';
  }
}

export async function createServer() {
  const server = new McpServer({
    name: 'minecraft-automated-driver',
    version: await readVersion(),
  });

  server.registerTool(
    'driver_status',
    {
      title: 'Driver status',
      description:
        'Report the driver version, implemented phase, and which capability layers ' +
        '(L0 os, L1 build/test, L2 protocol bots, L3 in-game agents) are available.',
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              name: 'minecraft-automated-driver',
              version: await readVersion(),
              phase: 0,
              layers: {
                l0_os: 'planned (Phase 1)',
                l1_build_test: 'planned (Phase 2)',
                l2_protocol_bots: 'planned (Phase 5)',
                l3_agents: 'planned (Phases 3-4)',
              },
              transport: 'stdio-only',
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  return server;
}

// Only start the transport when run directly (keeps createServer importable in tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = await createServer();
  await server.connect(new StdioServerTransport());
}
