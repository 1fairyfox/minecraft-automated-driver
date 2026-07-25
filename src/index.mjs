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
import { createBotRegistry } from './bot.mjs';
import { createTargetRegistry, agentExecutor, botExecutor } from './executors.mjs';
import { navigate as navigateGoal } from './goals.mjs';
import { menuNavigate, serverConnect, worldCreate, worldEnter, worldLeave, settingsSet } from './flows.mjs';
import { createClientManager } from './client.mjs';

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
  // L2 protocol-bot lane. The mineflayer factory is injected for tests; the default is the
  // real one, imported lazily so the driver starts even where mineflayer isn't installed.
  const botsFactory = l1.bots ?? (async () => {
    const mf = await import('mineflayer');
    const { Vec3 } = await import('vec3');
    const pf = (await import('mineflayer-pathfinder')).default; // CommonJS default = module.exports
    return createBotRegistry({
      createBot: (opts) => {
        const bot = mf.default.createBot(opts);
        bot.vec3 = (x, y, z) => new Vec3(x, y, z);
        // Load the A* pathfinder so the bot's native `navigate` capability works.
        bot.loadPlugin(pf.pathfinder);
        bot.once('spawn', () => bot.pathfinder.setMovements(new pf.Movements(bot)));
        return bot;
      },
      goalNear: (x, y, z, range) => new pf.goals.GoalNear(x, y, z, range),
    });
  });
  let bots = l1.botRegistry ?? null;
  const getBots = async () => (bots ??= await botsFactory());
  // Instanced client spawns (Loom production client). The default agent dir is this repo's
  // agents/fabric; overridable per call.
  const clients = l1.clientManager ?? createClientManager({ jobs });
  // The backend-agnostic capability layer: every connected bot/agent is registered here as an
  // executor, so goal-level orchestration (later phases) plans over advertised capabilities
  // without knowing the target type. See notes/plans/goal-level-autonomy-2026-07.md.
  const targets = l1.targets ?? createTargetRegistry();
  const defaultAgentDir = join(root, 'agents', 'fabric');
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
      phase: 5,
      layers: {
        l0_os: 'available — windows list/screenshot, instance open/close (Windows host)',
        l1_build_test: 'available — gradle jobs, paper provision/boot/console, auto-provisioned java',
        l2_protocol_bots: 'available — Mineflayer bots: join/move/chat/inventory/messages',
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
        // Register as an executor. A fabric agent drives a client; a paper agent, a server.
        targets.add(agentExecutor({ id, kind: conn.welcome.agent === 'fabric' ? 'client' : 'server', connection: conn }));
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

  // The client-agent tools are all the same shape: take a connectionId (+ maybe a few params),
  // forward ONE control-plane op, return its result or a tool error. Defined as a table so each
  // is a single row rather than a repeated try/withAgent/request/catch block — the repetition a
  // duplication check rightly flags. `params` maps the tool input to the op's params.
  const agentTools = [
    {
      name: 'agent_screen', op: 'screen', title: 'Introspect the client screen',
      description: 'Ask a connected client agent for the current screen as a named widget tree '
        + '(the "drive by name, never pixels" surface). Fabric agents.',
    },
    {
      name: 'agent_click', op: 'click', title: 'Click a widget by name',
      description: 'Click a widget on the client\'s current screen BY NAME (exact or unique '
        + 'substring; ambiguous names are refused, never guessed). Fabric agents.',
      inputSchema: { name: z.string().min(1) },
      params: ({ name }) => ({ name }),
    },
    {
      name: 'agent_key', op: 'key', title: 'Press/release a keybinding',
      description: 'Set a keybinding pressed or released by its id (e.g. "key.inventory"); a press '
        + 'also edge-fires so inventory/chat open by intent, not just held keys. Fabric agents.',
      inputSchema: {
        key: z.string().min(1).describe('Keybinding translation id, e.g. key.forward'),
        down: z.boolean().optional().describe('true=press (default), false=release'),
      },
      params: ({ key, down = true }) => ({ key, down }),
    },
    {
      name: 'agent_screenshot', op: 'screenshot', title: 'Screenshot the client (in-process)',
      description: 'Grab the client\'s rendered frame straight off its GPU framebuffer — clean and '
        + 'exact, unaffected by window occlusion, unlike the OS-level os_screenshot. Returns a '
        + 'base64 PNG plus width/height. Fabric agents.',
    },
    {
      name: 'agent_position', op: 'position', title: 'Read the player position',
      description: 'Report the client player\'s position and camera: {inWorld,x,y,z,yaw,pitch}. '
        + '`inWorld:false` when at a menu/not in a world. Fabric agents.',
    },
    {
      name: 'agent_move', op: 'move', title: 'Walk by holding a movement key',
      description: 'Walk the client player by holding a movement direction for a duration, across '
        + 'real game ticks — returns the from/to position and the horizontal distance travelled. '
        + 'Requires being in a world. Fabric agents.',
      inputSchema: {
        direction: z.enum(['forward', 'back', 'left', 'right', 'jump', 'sneak']),
        ms: z.number().int().positive().max(5000).optional().describe('How long to hold (default 400ms, capped 5s)'),
      },
      params: ({ direction, ms }) => ({ direction, ms }),
    },
    {
      name: 'agent_look', op: 'look', title: 'Point the camera',
      description: 'Set the client player\'s yaw and/or pitch (degrees) — aim by value, never a '
        + 'mouse delta. Requires being in a world. Fabric agents.',
      inputSchema: { yaw: z.number().optional(), pitch: z.number().optional() },
      params: ({ yaw, pitch }) => ({ yaw, pitch }),
    },
    {
      name: 'agent_type', op: 'type', title: 'Type into a text field',
      description: 'Type text into a field on the current screen — the focused field, else the '
        + 'sole field, else one whose label contains `name`. Fabric agents.',
      inputSchema: {
        text: z.string(),
        name: z.string().optional().describe('Optional label to disambiguate among multiple fields'),
      },
      params: ({ text: value, name }) => ({ name, text: value }),
    },
    {
      name: 'agent_slots', op: 'slots', title: 'Read a container\'s slots',
      description: 'List the slots of the open container/handled screen by index (item name + '
        + 'count), or {handled:false} if the current screen is not a container. Fabric agents.',
    },
    {
      name: 'agent_close_screen', op: 'close', title: 'Close the current screen',
      description: 'Dismiss the open screen (the Escape equivalent) — drive menus shut by intent. Fabric agents.',
    },
  ];
  for (const tool of agentTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: { connectionId: z.string(), ...(tool.inputSchema ?? {}) },
      },
      async (input) => {
        try {
          const params = tool.params ? tool.params(input) : undefined;
          return text(await withAgent(input.connectionId).request(tool.op, params));
        } catch (err) {
          return failure(err);
        }
      },
    );
  }

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
        targets.remove(connectionId);
        return text({ disconnected: connectionId });
      } catch (err) {
        return failure(err);
      }
    },
  );

  // ── L2: Mineflayer protocol bots ────────────────────────────────────────────

  server.registerTool(
    'bot_join',
    {
      title: 'Join a server with a bot',
      description:
        'Connect a headless Mineflayer bot (protocol-level, no render) to a LOCAL ' +
        'online-mode=false test server. Resolves once spawned. Returns a botId.',
      inputSchema: {
        host: z.string().optional().describe('Default 127.0.0.1'),
        port: z.number().int().positive().optional().describe('Default 25565'),
        username: z.string().optional().describe('Default DriverBot'),
        timeoutMs: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      try {
        const registry = await getBots();
        const joined = await registry.join(args);
        targets.add(botExecutor({ id: joined.botId, registry }));
        return text(joined);
      } catch (err) {
        return failure(err);
      }
    },
  );

  const botTool = (name, title, description, extra, run) =>
    server.registerTool(name, { title, description, inputSchema: { botId: z.string(), ...extra } },
      async ({ botId, ...rest }) => {
        try {
          return text(await run(await getBots(), botId, rest));
        } catch (err) {
          return failure(err);
        }
      });

  botTool('bot_status', 'Bot status', 'Position + vitals of a connected bot.', {},
    (reg, id) => reg.status(id));
  botTool('bot_chat', 'Bot chat/command', 'Send a chat line or command as the bot.',
    { message: z.string().min(1) }, (reg, id, { message }) => reg.chat(id, message));
  botTool('bot_messages', 'Bot messages', 'Chat the bot has received (buffered).',
    { tail: z.number().int().positive().optional() }, (reg, id, { tail }) => reg.messages(id, { tail }));
  botTool('bot_move', 'Move a bot', 'Walk the bot toward an absolute block position (by facing + forward).',
    { x: z.number(), y: z.number(), z: z.number(), timeoutMs: z.number().int().positive().optional() },
    (reg, id, args) => reg.moveTo(id, args));
  botTool('bot_inventory', 'Bot inventory', 'List the items in the bot\'s inventory.', {},
    (reg, id) => reg.inventory(id));
  botTool('bot_quit', 'Disconnect a bot', 'Disconnect and forget a bot.', {},
    (reg, id) => { const r = reg.quit(id); targets.remove(id); return r; });

  server.registerTool(
    'bots_list',
    { title: 'List bots', description: 'Every Mineflayer bot the driver is running.', inputSchema: {} },
    async () => {
      try {
        return text((await getBots()).list());
      } catch (err) {
        return failure(err);
      }
    },
  );

  // ── Orchestration: the backend-agnostic target registry ────────────────────

  server.registerTool(
    'targets_list',
    {
      title: 'List controllable targets',
      description:
        'Every connected target (Mineflayer bot, Fabric client agent, Paper server agent) as ' +
        'a uniform executor: {id, kind, capabilities}. Goal-level orchestration plans over ' +
        'these advertised capabilities rather than a specific backend.',
      inputSchema: {},
    },
    async () => {
      try {
        return text(targets.list());
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'goal_navigate',
    {
      title: 'Navigate a target to a position',
      description:
        'A goal-level intent: get a target (by targetId from targets_list) to (x,y,z) — one ' +
        'call, many steps. The engine picks a strategy from the target\'s advertised ' +
        'capabilities: a native pathfinder (Mineflayer bots) if present, else an MCP-side A* ' +
        'over the target\'s world snapshot walked with its move/look primitives.',
      inputSchema: {
        targetId: z.string().describe('A target id from targets_list'),
        x: z.number(), y: z.number(), z: z.number(),
        range: z.number().int().min(0).optional().describe('Accept any block within this range (default 1)'),
      },
    },
    async ({ targetId, x, y, z, range }) => {
      try {
        return text(await navigateGoal(targets.get(targetId), { x, y, z, range }));
      } catch (err) {
        return failure(err);
      }
    },
  );

  // ── Orchestration: semantic convenience verbs (notes/plans/semantic-verbs-2026-07.md) ──
  // Each is one high-level intent that the flow engine expands into the many UI steps, planned
  // over the target's ADVERTISED capabilities (screen/click/type/key/close/position) — so it
  // works against any executor that advertises them, never a hard-coded backend.

  const labelsSchema = z.record(z.string()).optional()
    .describe('Override UI button labels (e.g. {"join":"Join Server"}) for i18n / version drift');

  server.registerTool(
    'ui_menu_navigate',
    {
      title: 'Navigate menus by name',
      description:
        'Open/close/traverse a target\'s menus by clicking a sequence of button labels — one ' +
        'call for a whole menu path. Waits for each button to appear; `expect` optionally waits ' +
        'for a landmark widget to confirm arrival. Any target advertising screen+click.',
      inputSchema: {
        targetId: z.string().describe('A target id from targets_list'),
        path: z.array(z.string().min(1)).min(1).describe('Button labels to click, in order'),
        expect: z.string().optional().describe('A landmark widget label to confirm the destination'),
      },
    },
    async ({ targetId, path, expect }) => {
      try {
        return text(await menuNavigate(targets.get(targetId), { path, expect }));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'ui_server_connect',
    {
      title: 'Connect to a server by address',
      description:
        'One intent → Multiplayer → Direct Connection → type the address → Join Server, then ' +
        'wait until the player is actually in the world. Any target advertising ' +
        'screen+click+type+position (e.g. a Fabric client agent).',
      inputSchema: {
        targetId: z.string(),
        address: z.string().min(1).describe('Server address, e.g. 127.0.0.1 or host:port'),
        labels: labelsSchema,
      },
    },
    async ({ targetId, address, labels }) => {
      try {
        return text(await serverConnect(targets.get(targetId), { address, labels: labels ?? {} }));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'ui_world_create',
    {
      title: 'Create and enter a world',
      description:
        'One intent → Singleplayer → Create New World → name it → (optional) set game mode → ' +
        'Create New World, then wait until in-world. Any target advertising ' +
        'screen+click+type+position.',
      inputSchema: {
        targetId: z.string(),
        name: z.string().min(1).describe('World name'),
        gameMode: z.string().optional().describe('e.g. Survival / Creative — cycles the button to match'),
        labels: labelsSchema,
      },
    },
    async ({ targetId, name, gameMode, labels }) => {
      try {
        return text(await worldCreate(targets.get(targetId), { name, gameMode, labels: labels ?? {} }));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'ui_world_enter',
    {
      title: 'Enter an existing world by name',
      description:
        'Open a saved singleplayer world by name → Singleplayer → resolve the world-list entry ' +
        'by name and enter it (via the agent `world_select` capability), then wait until in-world. ' +
        'Needs a target advertising screen+click+position+world_select (the Fabric client agent).',
      inputSchema: {
        targetId: z.string(),
        name: z.string().min(1),
        labels: labelsSchema,
      },
    },
    async ({ targetId, name, labels }) => {
      try {
        return text(await worldEnter(targets.get(targetId), { name, labels: labels ?? {} }));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'ui_world_leave',
    {
      title: 'Save and leave the world',
      description:
        'One intent → Escape to the pause menu → Save and Quit to Title, then wait until no ' +
        'longer in-world. Override labels.quit with "Disconnect" for a multiplayer session. ' +
        'Any target advertising screen+click+close+position.',
      inputSchema: {
        targetId: z.string(),
        save: z.boolean().optional().describe('Records intent; vanilla singleplayer always saves (default true)'),
        labels: labelsSchema,
      },
    },
    async ({ targetId, save = true, labels }) => {
      try {
        return text(await worldLeave(targets.get(targetId), { save, labels: labels ?? {} }));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'ui_settings_set',
    {
      title: 'Change a setting by name',
      description:
        'One intent → Options → (traverse sub-screens by `path`) → set a control to `value` → ' +
        'optional Done. Booleans map to ON/OFF and cyclers are clicked until they show the value; ' +
        'a NUMERIC value is a slider, dispatched to the target\'s `slider` capability when it has ' +
        'one (else a clear error). Needs screen+click (+slider for numeric values).',
      inputSchema: {
        targetId: z.string(),
        control: z.string().min(1).describe('The control\'s stable label, e.g. "Difficulty"'),
        value: z.union([z.string(), z.boolean(), z.number()]).describe('Target value (bool→ON/OFF; string cycles)'),
        path: z.array(z.string().min(1)).optional().describe('Options sub-screens to open first, e.g. ["Controls"]'),
        back: z.boolean().optional().describe('Click Done after setting (default false)'),
        labels: labelsSchema,
      },
    },
    async ({ targetId, control, value, path = [], back = false, labels }) => {
      try {
        return text(await settingsSet(targets.get(targetId), { control, value, path, back, labels: labels ?? {} }));
      } catch (err) {
        return failure(err);
      }
    },
  );

  // ── Instanced client spawns (roadmap Phase 5, "instance" mode) ──────────────

  server.registerTool(
    'client_spawn',
    {
      title: 'Spawn a real Fabric client',
      description:
        'Boot a REAL Fabric client with the agent enabled — no launcher, no MS account — ' +
        'via the agent\'s Loom production-client run. Resolves once the agent\'s loopback ' +
        'handshake appears. Returns a connectDir to pass to agent_connect with kind:"fabric", ' +
        'and the clientId/jobId. Heavy (boots a rendering client); headless under XVFB on Linux.',
      inputSchema: {
        agentDir: z.string().optional().describe('The Fabric agent build dir (default: this repo\'s agents/fabric)'),
        waitReadyMs: z.number().int().positive().optional().describe('How long to wait for the client to come up'),
      },
    },
    async ({ agentDir, waitReadyMs }) => {
      try {
        return text(await clients.spawn({ agentDir: agentDir ?? defaultAgentDir, ...(waitReadyMs ? { waitReadyMs } : {}) }));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'clients_list',
    { title: 'List spawned clients', description: 'Every client the driver spawned, with state + connectDir.', inputSchema: {} },
    async () => text(clients.list()),
  );

  server.registerTool(
    'client_kill',
    {
      title: 'Kill a spawned client',
      description: 'Stop a spawned client (aborts its job, killing the client process tree).',
      inputSchema: { clientId: z.string() },
    },
    async ({ clientId }) => {
      try {
        return text(clients.kill(clientId));
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
