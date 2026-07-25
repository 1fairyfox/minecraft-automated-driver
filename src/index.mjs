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
import {
  navigate as navigateGoal, gather as gatherGoal, hunt as huntGoal,
  craft as craftGoal, place as placeGoal, build as buildGoal,
} from './goals.mjs';
import { menuNavigate, serverConnect, worldCreate, worldEnter, worldLeave, settingsSet, sliderRaw } from './flows.mjs';
import { createClientManager } from './client.mjs';
import { runScenario, validateScenario } from './scenario.mjs';

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
    const { plugin: collectBlock } = await import('mineflayer-collectblock');
    const { plugin: pvp } = await import('mineflayer-pvp');
    return createBotRegistry({
      createBot: (opts) => {
        const bot = mf.default.createBot(opts);
        bot.vec3 = (x, y, z) => new Vec3(x, y, z);
        // Load the plugins the bot's native capabilities delegate to: A* pathfinding (navigate),
        // block collection (gather), and PvP (hunt). collectblock needs pathfinder loaded.
        bot.loadPlugin(pf.pathfinder);
        bot.loadPlugin(collectBlock);
        bot.loadPlugin(pvp);
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
        allowRemote: z.boolean().optional()
          .describe('Opt in to a NON-loopback host. A bot parses that server\'s packets in-process, '
            + 'so only enable for a server you trust (default: loopback-only). See SECURITY.md.'),
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
  botTool('bot_equip', 'Equip an item',
    'Equip an item/tool/weapon by inventory name to a destination (hand/off-hand/head/torso/legs/feet; default hand).',
    { item: z.string().min(1), destination: z.string().optional() },
    (reg, id, { item, destination }) => reg.equip(id, { item, destination }));
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

  // The goal-level tools share one shape: {targetId, …params} → run a goal over that target,
  // returning its result or a clean tool error. A tiny helper keeps each a single registration
  // (mirrors botTool / the agentTools table) rather than near-identical try/catch blocks.
  const goalTool = (name, meta, run) =>
    server.registerTool(
      name,
      {
        title: meta.title,
        description: meta.description,
        inputSchema: { targetId: z.string().describe('A target id from targets_list'), ...meta.schema },
      },
      async ({ targetId, ...rest }) => {
        try {
          return text(await run(targets.get(targetId), rest));
        } catch (err) {
          return failure(err);
        }
      },
    );

  goalTool('goal_navigate', {
    title: 'Navigate a target to a position',
    description:
      'A goal-level intent: get a target (by targetId from targets_list) to (x,y,z) — one call, ' +
      'many steps. The engine picks a strategy from the target\'s advertised capabilities: a native ' +
      'pathfinder (Mineflayer bots) if present, else an MCP-side A* over the target\'s world snapshot ' +
      'walked with its move/look primitives.',
    schema: {
      x: z.number(), y: z.number(), z: z.number(),
      range: z.number().int().min(0).optional().describe('Accept any block within this range (default 1)'),
    },
  }, (target, a) => navigateGoal(target, a));

  goalTool('goal_gather', {
    title: 'Gather blocks by name',
    description:
      'A goal-level intent: have a target gather (mine/chop/collect) blocks by name — find the ' +
      'nearest matching block, path to it, auto-equip the best tool, mine it, and collect the drop, ' +
      '`count` times. Native to the Mineflayer bot lane (mineflayer-collectblock); a target without a ' +
      '`gather` capability is refused with a clear error.',
    schema: {
      block: z.string().min(1).describe('Block name, e.g. oak_log, stone, iron_ore'),
      count: z.number().int().positive().optional().describe('How many to gather (default 1)'),
      maxDistance: z.number().int().positive().optional().describe('Search radius in blocks (default 64)'),
    },
  }, (target, a) => gatherGoal(target, a));

  goalTool('goal_hunt', {
    title: 'Hunt a mob by name',
    description:
      'A goal-level intent: have a target hunt (attack) mobs by name — optionally equip a weapon, ' +
      'target the nearest matching mob in range, attack until it dies or a timeout, `count` times. ' +
      'Native to the Mineflayer bot lane (mineflayer-pvp); a target without a `hunt` capability is ' +
      'refused with a clear error.',
    schema: {
      mob: z.string().min(1).describe('Mob name, e.g. zombie, skeleton, cow'),
      count: z.number().int().positive().optional().describe('How many to kill (default 1)'),
      weapon: z.string().optional().describe('Inventory item name to equip first, e.g. iron_sword'),
      maxDistance: z.number().int().positive().optional().describe('Target search radius in blocks (default 32)'),
    },
  }, (target, a) => huntGoal(target, a));

  goalTool('goal_craft', {
    title: 'Craft an item by name',
    description:
      'A goal-level intent: have a target craft an item by name, `count` times, from its inventory — ' +
      'table-aware (a crafting table in reach unlocks 3x3 recipes, else the 2x2 grid). Native to the ' +
      'Mineflayer bot lane (core recipesFor/craft); a target without a `craft` capability is refused ' +
      'with a clear error.',
    schema: {
      item: z.string().min(1).describe('Item name, e.g. crafting_table, stick, wooden_pickaxe'),
      count: z.number().int().positive().optional().describe('How many to craft (default 1)'),
    },
  }, (target, a) => craftGoal(target, a));

  goalTool('goal_place', {
    title: 'Place a block by name at a position',
    description:
      'A goal-level intent: have a target place a block (by inventory name) at (x,y,z) — equips it and ' +
      'places against the block below the target. Native to the Mineflayer bot lane (core placeBlock); ' +
      'a target without a `place` capability is refused with a clear error.',
    schema: {
      block: z.string().min(1).describe('Block name to place, e.g. oak_planks, stone'),
      x: z.number(), y: z.number(), z: z.number(),
    },
  }, (target, a) => placeGoal(target, a));

  goalTool('goal_build', {
    title: 'Build a small structure',
    description:
      'A goal-level intent: have a target build a small structure by placing a list of blocks in order ' +
      '(each {block,x,y,z}). Composes the `place` capability; a target without `build` is refused with a ' +
      'clear error.',
    schema: {
      blocks: z.array(z.object({
        block: z.string().min(1), x: z.number(), y: z.number(), z: z.number(),
      })).min(1).describe('The blocks to place, in order'),
    },
  }, (target, a) => buildGoal(target, a));

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
        'a NUMERIC value sets an option-backed slider to that exact value (e.g. Difficulty stays a ' +
        'cycler, but FOV=70) via the target\'s `slider` capability. For a raw 0..1 fraction use ' +
        'ui_slider. Needs screen+click (+slider for numeric values).',
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

  server.registerTool(
    'ui_slider',
    {
      title: 'Get or set a slider (raw)',
      description:
        'The raw slider surface on the CURRENT screen (navigate there first, e.g. with ' +
        'ui_menu_navigate): `fraction` (0..1) sets any slider\'s raw progress; `value` sets an ' +
        'option-backed slider\'s typed value (e.g. FOV 70); omit both to just read. Returns ' +
        '{handled,label,fraction,value}. Needs a target advertising the `slider` capability.',
      inputSchema: {
        targetId: z.string(),
        control: z.string().min(1).optional().describe('Slider label (omit to use the sole slider on screen)'),
        fraction: z.number().min(0).max(1).optional().describe('Raw normalised progress 0..1'),
        value: z.number().optional().describe('Typed option value for an option-backed slider'),
      },
    },
    async ({ targetId, control, fraction, value }) => {
      try {
        return text(await sliderRaw(targets.get(targetId), { control, fraction, value }));
      } catch (err) {
        return failure(err);
      }
    },
  );

  // ── Orchestration: multi-target scenarios (notes/plans/goal-level-autonomy-2026-07.md §3) ──
  // A scenario provisions server + client(s) + bot(s) together, runs cross-target steps, and
  // guarantees teardown. The engine (src/scenario.mjs) is pure; these closures are the real
  // provisioners (by actor kind) and actions (by step verb) over the live managers. Each
  // provisioner returns { info, teardown }; `info.targetId` marks a controllable executor so a
  // step can invoke/navigate it, exactly like a bot/agent from targets_list.

  const scenarioProvisioners = {
    // Provision + boot a LOCAL offline Paper server (download → configure → start → wait ready).
    async server(actor) {
      const {
        version: mcVersion, dir, port = 25565, plugins = [],
        javaArgs = ['-Xmx2G'], waitReadyMs = 300_000,
      } = actor;
      if (!mcVersion) throw new Error(`server actor '${actor.id}' needs a version (e.g. 1.21.11)`);
      const target = dir ?? join(cfg.runDir, `scenario-${actor.id}-${mcVersion}-${Date.now()}`);
      await provision({ version: mcVersion, dir: target, port });
      for (const pluginJar of plugins) await deploy({ dir: target, pluginJar });
      const { javaPath } = await java({ feature: 21, runtimesDir: cfg.runtimesDir });
      const started = servers.start({ dir: target, javaPath, javaArgs });
      const state = await servers.waitReady(started.serverId, { timeoutMs: waitReadyMs });
      if (state !== 'ready') throw new Error(`server '${actor.id}' did not reach ready (state: ${state})`);
      return {
        info: { serverId: started.serverId, jobId: started.jobId, dir: target, port, state },
        teardown: () => servers.stop(started.serverId, { timeoutMs: 60_000 }),
      };
    },
    // Join a headless Mineflayer bot and register it as an executor (targetId = its bot id).
    async bot(actor) {
      const registry = await getBots();
      const { host = '127.0.0.1', port = 25565, username, timeoutMs, allowRemote } = actor;
      const joined = await registry.join({
        host, port, ...(username ? { username } : {}), ...(timeoutMs ? { timeoutMs } : {}),
        ...(allowRemote ? { allowRemote } : {}),
      });
      targets.add(botExecutor({ id: joined.botId, registry }));
      return {
        info: { botId: joined.botId, username: joined.username, targetId: joined.botId },
        teardown: () => { const r = registry.quit(joined.botId); targets.remove(joined.botId); return r; },
      };
    },
    // Spawn a real Fabric client and (by default) connect its agent as an executor.
    async client(actor) {
      const { agentDir, waitReadyMs, connect = true } = actor;
      const spawned = await clients.spawn({
        agentDir: agentDir ?? defaultAgentDir, ...(waitReadyMs ? { waitReadyMs } : {}),
      });
      let connection = null;
      let connectionId = null;
      let capabilities = null;
      if (connect) {
        const hs = await agentHandshake(spawned.connectDir, { kind: 'fabric' });
        connection = await agentConnect({ port: hs.port, token: hs.token });
        connectionId = `a${++agentCounter}`;
        agents.set(connectionId, connection);
        targets.add(agentExecutor({ id: connectionId, kind: 'client', connection }));
        capabilities = connection.welcome.capabilities;
      }
      return {
        info: {
          clientId: spawned.clientId, jobId: spawned.jobId, connectDir: spawned.connectDir,
          ...(connectionId ? { connectionId, capabilities, targetId: connectionId } : {}),
        },
        teardown: () => {
          if (connection) { connection.close(); agents.delete(connectionId); targets.remove(connectionId); }
          return clients.kill(spawned.clientId);
        },
      };
    },
    // Attach to an ALREADY-running agent by its data dir, as an executor. `layout` (paper|fabric)
    // is a separate field so it doesn't collide with the actor's own `kind:"agent"`.
    async agent(actor) {
      const { dir, layout, agentName } = actor;
      if (!dir) throw new Error(`agent actor '${actor.id}' needs a dir`);
      const hs = await agentHandshake(dir, { ...(layout ? { kind: layout } : {}), ...(agentName ? { agentName } : {}) });
      const connection = await agentConnect({ port: hs.port, token: hs.token });
      const connectionId = `a${++agentCounter}`;
      agents.set(connectionId, connection);
      const execKind = connection.welcome.agent === 'fabric' ? 'client' : 'server';
      targets.add(agentExecutor({ id: connectionId, kind: execKind, connection }));
      return {
        info: { connectionId, agent: connection.welcome.agent, capabilities: connection.welcome.capabilities, targetId: connectionId },
        teardown: () => { connection.close(); agents.delete(connectionId); targets.remove(connectionId); },
      };
    },
  };

  const scenarioActions = {
    // Let things settle between steps.
    async wait(step, ctx) {
      const ms = step.ms ?? 0;
      await ctx.sleep(ms);
      return { waited: ms };
    },
    // Invoke ANY advertised capability on an actor that is a controllable target (bot/agent) —
    // the backend-agnostic cross-target verb (bot chat/status, agent state/screen, …).
    async invoke(step, ctx) {
      if (!step.actor) throw new Error('invoke step needs an actor');
      if (!step.capability) throw new Error('invoke step needs a capability');
      return targets.get(ctx.targetId(step.actor)).invoke(step.capability, step.args ?? {});
    },
    // Goal-level navigation on a target, through the same engine as goal_navigate.
    async navigate(step, ctx) {
      if (!step.actor) throw new Error('navigate step needs an actor');
      return navigateGoal(targets.get(ctx.targetId(step.actor)), { x: step.x, y: step.y, z: step.z, range: step.range });
    },
    // Send a console command to a server actor (via the server manager, not the target registry).
    async server_exec(step, ctx) {
      if (!step.actor) throw new Error('server_exec step needs an actor');
      if (!step.command) throw new Error('server_exec step needs a command');
      const info = ctx.actor(step.actor);
      if (!info.serverId) throw new Error(`actor '${step.actor}' is not a server`);
      return servers.exec(info.serverId, step.command);
    },
  };

  server.registerTool(
    'scenario_run',
    {
      title: 'Run a multi-target scenario',
      description:
        'Provision and coordinate several targets AT ONCE — a Paper server, spawned Fabric ' +
        'client(s), and/or Mineflayer bot(s) — run a sequence of cross-target steps, and ' +
        'GUARANTEE teardown in reverse order (even on failure). Server-and-client-and-bot ' +
        'testing as ONE lifecycle object, not hand-wired server_start + client_spawn + bot_join. ' +
        'Runs as a job (heavy: boots servers/clients); the job RESULT is the full scenario report ' +
        '{ok, provisioned, steps, teardown}. Pass waitMs to block up to that long and return the ' +
        'finished report inline.\n\n' +
        'actors[]: {id, kind:"server"|"client"|"bot"|"agent", …opts}. ' +
        'server:{version,dir?,port?,plugins?,javaArgs?,waitReadyMs?}; bot:{host?,port?,username?}; ' +
        'client:{agentDir?,waitReadyMs?,connect?}; agent:{dir,layout?,agentName?}. ' +
        'steps[] run in order: {action:"wait"|"invoke"|"navigate"|"server_exec", …}. ' +
        'invoke:{actor,capability,args?} (any advertised capability on a bot/agent); ' +
        'navigate:{actor,x,y,z,range?}; server_exec:{actor,command}; wait:{ms}.',
      inputSchema: {
        name: z.string().optional().describe('A label for the run'),
        actors: z.array(
          z.object({
            id: z.string().min(1),
            kind: z.enum(['server', 'client', 'bot', 'agent']),
          }).passthrough(),
        ).min(1).describe('Targets to provision, in order'),
        steps: z.array(
          z.object({ action: z.enum(['wait', 'invoke', 'navigate', 'server_exec']) }).passthrough(),
        ).optional().describe('Cross-target steps, in order'),
        waitMs: z.number().int().positive().optional()
          .describe('Block up to this long for the scenario to finish, returning the report inline'),
      },
    },
    async ({ name, actors, steps = [], waitMs }) => {
      try {
        const spec = { name, actors, steps };
        // Fail fast on a structural mistake (unknown actor ref, duplicate id) at the tool
        // boundary rather than as a failed job the caller has to poll for.
        validateScenario(spec, { provisioners: scenarioProvisioners, actions: scenarioActions });
        const snap = jobs.start(
          `scenario ${name ?? 'run'}`,
          () => runScenario(spec, { provisioners: scenarioProvisioners, actions: scenarioActions }),
        );
        if (waitMs) return text(await jobs.wait(snap.id, { timeoutMs: waitMs }));
        return text(snap);
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
