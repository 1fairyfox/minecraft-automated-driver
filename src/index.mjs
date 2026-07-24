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
import { createJobRegistry } from './jobs.mjs';
import { startGradleJob } from './build.mjs';
import { deployPlugin, provisionServer, createServerManager } from './paper.mjs';
import { ensureJava } from './java.mjs';
import { readHandshake, connectAgent } from './agent.mjs';

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

export async function createServer({
  root = ROOT, backend, registry, config, jobs: jobsIn, servers: serversIn, l1 = {},
} = {}) {
  const cfg = config ?? (await loadConfig(root));
  const os = backend ?? createWindowsBackend();
  const instances = registry ?? createInstanceRegistry();
  const jobs = jobsIn ?? createJobRegistry();
  const servers = serversIn ?? createServerManager({ jobs });
  // L1 seams, injectable for the protocol tests.
  const gradle = l1.gradle ?? startGradleJob;
  const provision = l1.provision ?? provisionServer;
  const deploy = l1.deploy ?? deployPlugin;
  const java = l1.java ?? ensureJava;
  // L3 seams (control-plane client), injectable for the protocol tests.
  const agentHandshake = l1.agentHandshake ?? readHandshake;
  const agentConnect = l1.agentConnect ?? connectAgent;
  const agents = new Map(); // connectionId → live agent connection
  let agentCounter = 0;
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
      phase: 4,
      layers: {
        l0_os: 'available — windows list/screenshot, instance open/close (Windows host)',
        l1_build_test: 'available — gradle jobs, paper provision/boot/console, auto-provisioned java',
        l2_protocol_bots: 'planned (Phase 5)',
        l3_agents: 'available — Paper agent (state/exec/events) + Fabric client agent (screen/click/key by name)',
      },
      transport: 'stdio-only',
    }),
  );

  // ── L1: jobs ───────────────────────────────────────────────────────────────

  server.registerTool(
    'jobs_list',
    {
      title: 'List jobs',
      description: 'All long-running operations the driver has started, with statuses.',
      inputSchema: {},
    },
    async () => text(jobs.list()),
  );

  server.registerTool(
    'job_status',
    {
      title: 'Job status',
      description: 'Status snapshot of one job (running / succeeded / failed / killed).',
      inputSchema: { id: z.string().describe('Job id, e.g. j1') },
    },
    async ({ id }) => {
      const snap = jobs.status(id);
      return snap ? text(snap) : failure(new Error(`no job ${id}`));
    },
  );

  server.registerTool(
    'job_log',
    {
      title: 'Job log',
      description: 'Tail a job\'s captured output (ring-buffered).',
      inputSchema: {
        id: z.string(),
        tail: z.number().int().positive().optional().describe('Last N lines (default: all buffered)'),
      },
    },
    async ({ id, tail }) => {
      const log = jobs.log(id, { tail });
      return log ? text(log) : failure(new Error(`no job ${id}`));
    },
  );

  server.registerTool(
    'job_kill',
    {
      title: 'Kill a job',
      description: 'Abort a running job; its underlying process (if any) is killed.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const snap = jobs.kill(id);
      return snap ? text(snap) : failure(new Error(`no job ${id}`));
    },
  );

  // ── L1: build ──────────────────────────────────────────────────────────────

  server.registerTool(
    'build_gradle',
    {
      title: 'Run gradle tasks',
      description:
        'Run gradle wrapper tasks (clean/build/test/…) in a project checkout as a ' +
        'job. Returns the job id immediately — poll job_status, tail job_log. The ' +
        'job result lists any jars under build/libs.',
      inputSchema: {
        projectDir: z.string().min(1).describe('Absolute path of the gradle project'),
        tasks: z.array(z.string().min(1)).optional().describe('Default: ["build"]'),
      },
    },
    async ({ projectDir, tasks = ['build'] }) => {
      try {
        return text(gradle({ jobs, projectDir, tasks }));
      } catch (err) {
        return failure(err);
      }
    },
  );

  // ── L1: paper servers ──────────────────────────────────────────────────────

  server.registerTool(
    'server_provision',
    {
      title: 'Provision a Paper test server',
      description:
        'Auto-download Paper by Minecraft version (fill.papermc.io, latest build) ' +
        'into a directory and configure it as a LOCAL loopback test server ' +
        '(eula accepted, flat world, online-mode=false — local testing only, see ' +
        'SECURITY.md). Runs as a job. Optionally deploys plugin jars.',
      inputSchema: {
        version: z.string().min(1).describe('Minecraft version, e.g. 1.21.11'),
        dir: z.string().optional().describe('Target dir (default: managed run dir)'),
        port: z.number().int().positive().optional(),
        plugins: z.array(z.string()).optional().describe('Plugin jar paths to deploy'),
      },
    },
    async ({ version: mcVersion, dir, port = 25565, plugins = [] }) => {
      const target = dir ?? join(cfg.runDir, `paper-${mcVersion}-${Date.now()}`);
      const snap = jobs.start(`provision paper ${mcVersion} @ ${target}`, async ({ log }) => {
        const result = await provision({ version: mcVersion, dir: target, port, log });
        for (const pluginJar of plugins) {
          log(`deploying ${pluginJar}`);
          await deploy({ dir: target, pluginJar });
        }
        return { ...result, pluginsDeployed: plugins.length };
      });
      return text(snap);
    },
  );

  server.registerTool(
    'server_start',
    {
      title: 'Start a provisioned server',
      description:
        'Boot a provisioned Paper dir as a job. Java is auto-resolved — a suitable ' +
        'host JDK/JRE if present, otherwise a Temurin JRE is downloaded into the ' +
        'managed runtimes dir (auto-provision by default). Poll server_status via ' +
        'servers_list; readiness is the console "Done" line.',
      inputSchema: {
        dir: z.string().min(1).describe('The provisioned server directory'),
        javaArgs: z.array(z.string()).optional().describe('Default: ["-Xmx2G"]'),
        waitReadyMs: z.number().int().positive().optional()
          .describe('Block up to this long for readiness before returning (default: return immediately)'),
      },
    },
    async ({ dir, javaArgs = ['-Xmx2G'], waitReadyMs }) => {
      try {
        const { javaPath } = await java({ feature: 21, runtimesDir: cfg.runtimesDir });
        const started = servers.start({ dir, javaPath, javaArgs });
        if (waitReadyMs) {
          const state = await servers.waitReady(started.serverId, { timeoutMs: waitReadyMs });
          return text({ ...started, state });
        }
        return text({ ...started, state: 'starting' });
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'server_exec',
    {
      title: 'Run a console command',
      description: 'Send a command to a running server\'s console (stdin).',
      inputSchema: {
        serverId: z.string().describe('From server_start / servers_list'),
        command: z.string().min(1),
      },
    },
    async ({ serverId, command }) => {
      try {
        return text(servers.exec(serverId, command));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'server_stop',
    {
      title: 'Stop a server',
      description: 'Graceful console `stop`, then a forced kill after the timeout.',
      inputSchema: {
        serverId: z.string(),
        timeoutMs: z.number().int().positive().optional(),
      },
    },
    async ({ serverId, timeoutMs = 30_000 }) => {
      try {
        return text(await servers.stop(serverId, { timeoutMs }));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'servers_list',
    {
      title: 'List servers',
      description: 'Every Paper server the driver manages, with state and job id.',
      inputSchema: {},
    },
    async () => text(servers.list()),
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

  // ── L3: in-game agent control plane (docs/control-protocol.md) ──────────────

  server.registerTool(
    'agent_connect',
    {
      title: 'Connect to an in-game agent',
      description:
        'Read a running agent\'s loopback handshake (from its server/client data dir) ' +
        'and open an authenticated control-plane session. The agent must have been ' +
        'enabled (launch flag / config / in-game opt-in). Returns a connectionId and ' +
        'the agent\'s advertised capabilities.',
      inputSchema: {
        dir: z.string().min(1).describe('The server/client directory whose agent to connect to'),
        kind: z.enum(['paper', 'fabric']).optional().describe('Agent layout (default: paper)'),
        agentName: z.string().optional().describe('Plugin/mod folder name (default: the shared agent id)'),
      },
    },
    async ({ dir, kind, agentName }) => {
      try {
        const opts = {};
        if (kind) opts.kind = kind;
        if (agentName) opts.agentName = agentName;
        const hs = await agentHandshake(dir, opts);
        const conn = await agentConnect({ port: hs.port, token: hs.token });
        const id = `a${++agentCounter}`;
        agents.set(id, conn);
        return text({ connectionId: id, agent: conn.welcome.agent, capabilities: conn.welcome.capabilities, events: conn.welcome.events });
      } catch (err) {
        return failure(err);
      }
    },
  );

  const withAgent = (id) => {
    const conn = agents.get(id);
    if (!conn) throw new Error(`no agent connection ${id}`);
    return conn;
  };

  server.registerTool(
    'agent_state',
    {
      title: 'Query live game state',
      description: 'Ask a connected agent for TPS, players, worlds, and version.',
      inputSchema: { connectionId: z.string() },
    },
    async ({ connectionId }) => {
      try {
        return text(await withAgent(connectionId).request('state'));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'agent_exec',
    {
      title: 'Run a command via the agent',
      description: 'Dispatch a console command through a connected agent (main-thread, gated). Paper agents.',
      inputSchema: { connectionId: z.string(), command: z.string().min(1) },
    },
    async ({ connectionId, command }) => {
      try {
        return text(await withAgent(connectionId).request('exec', { command }));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'agent_screen',
    {
      title: 'Introspect the client screen',
      description:
        'Ask a connected client agent for the current screen as a named widget tree ' +
        '(the "drive by name, never pixels" surface). Fabric agents.',
      inputSchema: { connectionId: z.string() },
    },
    async ({ connectionId }) => {
      try {
        return text(await withAgent(connectionId).request('screen'));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'agent_click',
    {
      title: 'Click a widget by name',
      description:
        'Click a widget on the client\'s current screen BY NAME (exact or unique ' +
        'substring; ambiguous names are refused, never guessed). Fabric agents.',
      inputSchema: { connectionId: z.string(), name: z.string().min(1) },
    },
    async ({ connectionId, name }) => {
      try {
        return text(await withAgent(connectionId).request('click', { name }));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'agent_key',
    {
      title: 'Press/release a keybinding',
      description:
        'Set a keybinding pressed or released by its id (e.g. "key.jump"). Fabric agents.',
      inputSchema: {
        connectionId: z.string(),
        key: z.string().min(1).describe('Keybinding translation id, e.g. key.forward'),
        down: z.boolean().optional().describe('true=press (default), false=release'),
      },
    },
    async ({ connectionId, key, down = true }) => {
      try {
        return text(await withAgent(connectionId).request('key', { key, down }));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'agent_events',
    {
      title: 'Drain buffered agent events',
      description: 'Return the events (player joins/quits, …) the agent has pushed since connect.',
      inputSchema: { connectionId: z.string() },
    },
    async ({ connectionId }) => {
      try {
        return text(withAgent(connectionId).events());
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'agent_disconnect',
    {
      title: 'Disconnect from an agent',
      description: 'Close a control-plane session. The agent keeps serving others until disabled.',
      inputSchema: { connectionId: z.string() },
    },
    async ({ connectionId }) => {
      try {
        withAgent(connectionId).close();
        agents.delete(connectionId);
        return text({ disconnected: connectionId });
      } catch (err) {
        return failure(err);
      }
    },
  );

  return server;
}

// Only start the transport when run directly (keeps createServer importable in tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = await createServer();
  await server.connect(new StdioServerTransport());
  // Exit when the client goes away (stdin closes) — the natural "parent disconnected"
  // signal for a stdio MCP server. Without this the process can linger after the
  // client closes (host-dependent), which also hung the e2e test's runner on Linux.
  process.stdin.on('close', () => process.exit(0));
}
