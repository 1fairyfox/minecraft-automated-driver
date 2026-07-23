#!/usr/bin/env node
/**
 * Minecraft Automated Driver — MCP server entry point (stdio transport ONLY).
 *
 * Security invariants (see SECURITY.md — do not weaken):
 *  - This process never binds a network socket for MCP; it speaks stdio to its client.
 *  - Any future driver⇄agent control plane binds 127.0.0.1 only, ephemeral port,
 *    per-session token. That code does not exist yet (Phase 3+).
 *
 * Phase 1 surface (roadmap L0): OS window enumeration + screenshots, instance
 * open/close/list, driver_status. Later layers add their own modules and tools.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { loadConfig } from './config.mjs';
import { createInstanceRegistry } from './instances.mjs';
import { createWindowsBackend } from './os/windows.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Read the repo VERSION file; 'unknown' when absent (root injectable for tests). */
export async function readVersion(root = ROOT) {
  try {
    return (await readFile(join(root, 'VERSION'), 'utf8')).trim();
  } catch {
    return 'unknown';
  }
}

const text = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});
const failure = (err) => ({
  isError: true,
  content: [{ type: 'text', text: `Error: ${err.message}` }],
});

export async function createServer({ root = ROOT, backend, registry, config } = {}) {
  const cfg = config ?? (await loadConfig(root));
  const os = backend ?? createWindowsBackend();
  const instances = registry ?? createInstanceRegistry();
  const version = await readVersion(root);

  const server = new McpServer({ name: 'minecraft-automated-driver', version });

  server.registerTool(
    'driver_status',
    {
      title: 'Driver status',
      description:
        'Report the driver version, implemented phase, and which capability layers ' +
        '(L0 os, L1 build/test, L2 protocol bots, L3 in-game agents) are available.',
      inputSchema: {},
    },
    async () => text({
      name: 'minecraft-automated-driver',
      version,
      phase: 1,
      layers: {
        l0_os: 'available — windows list/screenshot, instance open/close (Windows host)',
        l1_build_test: 'planned (Phase 2)',
        l2_protocol_bots: 'planned (Phase 5)',
        l3_agents: 'planned (Phases 3-4)',
      },
      transport: 'stdio-only',
    }),
  );

  server.registerTool(
    'os_windows_list',
    {
      title: 'List OS windows',
      description:
        'Enumerate every top-level window on the host (any app — vanilla Minecraft ' +
        'clients included, nothing installed in-game). Returns pid, process name, ' +
        'title, and hwnd for use with os_screenshot / instance_close.',
      inputSchema: {},
    },
    async () => {
      try {
        return text(await os.listWindows());
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'os_screenshot',
    {
      title: 'Screenshot a window',
      description:
        'Capture one window as PNG (works on background windows). Identify it by ' +
        'hwnd, pid, or an exact/substring title match. method "printwindow" ' +
        '(default) rasterizes via the compositor; "screen" copies the screen region ' +
        '(window must be visible) — the fallback for GL surfaces that come out black.',
      inputSchema: {
        hwnd: z.number().int().positive().optional().describe('Window handle from os_windows_list'),
        pid: z.number().int().positive().optional().describe('Process id — first window of this process'),
        title: z.string().min(1).optional().describe('Exact or substring window-title match'),
        method: z.enum(['printwindow', 'screen']).optional(),
      },
    },
    async ({ hwnd, pid, title, method = 'printwindow' }) => {
      try {
        let target = hwnd;
        if (target === undefined) {
          const windows = await os.listWindows();
          const match = windows.find((w) =>
            (pid !== undefined && w.pid === pid) ||
            (title !== undefined && (w.title === title || w.title.includes(title))));
          if (!match) throw new Error(`no window matched ${JSON.stringify({ pid, title })}`);
          target = match.hwnd;
        }
        await mkdir(cfg.screenshotDir, { recursive: true });
        const outPath = join(cfg.screenshotDir, `${Date.now()}-${target}.png`);
        const shot = await os.screenshotWindow({ hwnd: target, outPath, method });
        const png = await readFile(shot.path);
        return {
          content: [
            { type: 'text', text: JSON.stringify(shot) },
            { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
          ],
        };
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'instance_open',
    {
      title: 'Open an instance',
      description:
        'Spawn a detached process on the host (e.g. a game client or server ' +
        'executable) and track it in the instance registry. Returns the registry ' +
        'record including its id for instance_close.',
      inputSchema: {
        command: z.string().min(1).describe('Executable to run'),
        args: z.array(z.string()).optional(),
        cwd: z.string().optional(),
        title: z.string().optional().describe('Friendly label for the registry'),
      },
    },
    async ({ command, args = [], cwd, title }) => {
      try {
        const { pid } = os.openProcess({ command, args, cwd });
        return text(instances.add({ kind: 'spawned', pid, command, title: title ?? null }));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'instance_close',
    {
      title: 'Close an instance',
      description:
        'Close a process by registry id or raw pid — graceful window-close first, ' +
        'then (with force) a hard kill after the timeout.',
      inputSchema: {
        id: z.string().optional().describe('Instance registry id from instance_open / instances_list'),
        pid: z.number().int().positive().optional(),
        force: z.boolean().optional(),
        timeoutMs: z.number().int().positive().optional(),
      },
    },
    async ({ id, pid, force = false, timeoutMs = 5000 }) => {
      try {
        let target = pid;
        if (id !== undefined) {
          const record = instances.get(id);
          if (!record) throw new Error(`no instance with id ${id}`);
          target = record.pid;
        }
        if (target === undefined) throw new Error('provide id or pid');
        const result = await os.closeProcess({ pid: target, force, timeoutMs });
        if (id !== undefined && result.closed) instances.remove(id);
        return text(result);
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'instances_list',
    {
      title: 'List instances',
      description:
        'Everything the driver spawned (the registry) plus every live top-level ' +
        'window on the host, so attach candidates are visible next to owned instances.',
      inputSchema: {},
    },
    async () => {
      let windows;
      try {
        windows = await os.listWindows();
      } catch (err) {
        windows = { unavailable: err.message };
      }
      return text({ spawned: instances.list(), windows });
    },
  );

  return server;
}

// Only start the transport when run directly (keeps createServer importable in tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = await createServer();
  await server.connect(new StdioServerTransport());
}
