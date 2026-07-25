#!/usr/bin/env node
// nav-smoke.mjs — REAL proof of the universal navigation goal (0.11.0). Auto-provision + boot
// a local online-mode=false Paper server, join a REAL Mineflayer bot, register it as an
// EXECUTOR, and drive it with the backend-agnostic GOAL ENGINE (goals.navigate) — which, for a
// bot, delegates to native A* pathfinding (mineflayer-pathfinder) with real walk/jump. Proves
// the whole stack: goal engine → executor → bot registry → pathfinder → live server. No mocks.
//
//   node scripts/nav-smoke.mjs [--version 1.21.11] [--port 25567] [--force-java-download]
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mineflayer from 'mineflayer';
import { Vec3 } from 'vec3';
import { pathfinder, Movements, goals } from 'mineflayer-pathfinder';
import { createJobRegistry } from '../src/jobs.mjs';
import { ensureJava } from '../src/java.mjs';
import { createServerManager, provisionServer } from '../src/paper.mjs';
import { createBotRegistry } from '../src/bot.mjs';
import { createTargetRegistry, botExecutor } from '../src/executors.mjs';
import { navigate } from '../src/goals.mjs';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const version = flag('version', '1.21.11');
const port = Number(flag('port', '25567'));

const jobs = createJobRegistry({ logCap: 10_000 });
const servers = createServerManager({ jobs });
const bots = createBotRegistry({
  createBot: (opts) => {
    const b = mineflayer.createBot(opts);
    b.vec3 = (x, y, z) => new Vec3(x, y, z);
    b.loadPlugin(pathfinder);
    b.once('spawn', () => b.pathfinder.setMovements(new Movements(b)));
    return b;
  },
  goalNear: (x, y, z, range) => new goals.GoalNear(x, y, z, range),
});
const targets = createTargetRegistry();
const work = join(tmpdir(), 'minecraft-automated-driver', `nav-smoke-${Date.now()}`);
const say = (m) => console.log(m);

let failed = false;
let serverId = null;
let botId = null;
try {
  say('1) ensure Java 21…');
  const { javaPath } = await ensureJava({
    feature: 21,
    runtimesDir: join(tmpdir(), 'minecraft-automated-driver', 'runtimes'),
    forceProvision: args.includes('--force-java-download'),
    log: (l) => say(`   ${l}`),
  });

  say(`2) provision + boot Paper ${version} (offline, loopback)…`);
  const dir = join(work, 'server');
  await provisionServer({ version, dir, port, log: (l) => say(`   ${l}`) });
  serverId = servers.start({ dir, javaPath, javaArgs: ['-Xmx2G'] }).serverId;
  const state = await servers.waitReady(serverId, { timeoutMs: 300_000 });
  if (state !== 'ready') throw new Error(`server not ready (${state})`);
  say('   ready.');

  say('3) join a REAL Mineflayer bot + register it as an executor…');
  const joined = await bots.join({ host: '127.0.0.1', port, username: 'NavBot', timeoutMs: 60_000 });
  botId = joined.botId;
  const executor = targets.add(botExecutor({ id: botId, registry: bots }));
  if (!executor.has('navigate')) throw new Error('bot executor did not advertise navigate');
  say(`   spawned as ${joined.username}; targets_list = ${JSON.stringify(targets.list())}`);

  // Let the world settle so the bot has a footing + loaded chunks to path over.
  await new Promise((r) => setTimeout(r, 3000));
  const start = bots.status(botId).position;
  if (!start) throw new Error('bot has no position after spawn');
  say(`   at ${JSON.stringify(start)}`);

  say('4) GOAL: navigate ~6 blocks away via the backend-agnostic engine (native A*)…');
  const target = { x: Math.round(start.x) + 6, y: Math.round(start.y), z: Math.round(start.z) + 6, range: 2 };
  const result = await navigate(executor, target);
  say(`   strategy=${result.strategy}, arrived at ${JSON.stringify(result.position)}`);
  if (result.strategy !== 'native') throw new Error(`expected the native pathfinder strategy, got ${result.strategy}`);

  const end = bots.status(botId).position;
  const moved = Math.hypot(end.x - start.x, end.z - start.z);
  if (moved < 2) throw new Error(`bot barely moved (${moved.toFixed(2)} blocks) — did pathfinding run?`);
  say(`   moved ${moved.toFixed(2)} blocks horizontally.`);

  say('5) quit + stop…');
  bots.quit(botId); botId = null;
  await servers.stop(serverId, { timeoutMs: 60_000 }); serverId = null;

  say('nav-smoke: PASS — boot → REAL bot → executor → goal engine → native A* pathfind → arrived, all real.');
} catch (err) {
  failed = true;
  console.error(`nav-smoke: FAIL — ${err.message}`);
} finally {
  if (botId) try { bots.quit(botId); } catch { /* best-effort */ }
  if (serverId) await servers.stop(serverId, { timeoutMs: 10_000 }).catch(() => {});
  await rm(work, { recursive: true, force: true }).catch(() => {});
}
process.exit(failed ? 1 : 0);
