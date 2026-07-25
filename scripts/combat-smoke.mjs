#!/usr/bin/env node
// combat-smoke.mjs — REAL proof of the gather + hunt goals (0.17.0). Boot a local offline Paper
// server, join a REAL Mineflayer bot, register it as an EXECUTOR, and drive it with the
// backend-agnostic GOAL ENGINE: place an oak log and `gather` it (mineflayer-collectblock — path,
// auto-equip, mine, collect), then summon a mob and `hunt` it (mineflayer-pvp — equip, approach,
// attack until dead). Proves goal engine → executor → bot registry → collectblock/pvp → live
// server. No mocks.
//
//   node scripts/combat-smoke.mjs [--version 1.21.11] [--port 25569]
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobRegistry } from '../src/jobs.mjs';
import { createServerManager } from '../src/paper.mjs';
import { createTargetRegistry, botExecutor } from '../src/executors.mjs';
import { gather, hunt } from '../src/goals.mjs';
import { bootPaper } from './lib/paper-smoke.mjs';
import { createSmokeBots } from './lib/smoke-bots.mjs';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const version = flag('version', '1.21.11');
const port = Number(flag('port', '25569'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const jobs = createJobRegistry({ logCap: 10_000 });
const servers = createServerManager({ jobs });
const bots = createSmokeBots();
const targets = createTargetRegistry();
const work = join(tmpdir(), 'minecraft-automated-driver', `combat-smoke-${Date.now()}`);
const say = (m) => console.log(m);

let failed = false;
let serverId = null;
let botId = null;
try {
  say(`1) ensure Java + boot Paper ${version} (offline, loopback)…`);
  ({ serverId } = await bootPaper(servers, {
    version, port, dir: join(work, 'server'),
    forceJavaDownload: args.includes('--force-java-download'),
    log: (l) => say(`   ${l}`),
  }));
  say('   ready.');

  say('2) join a REAL Mineflayer bot (gather+pvp plugins loaded) + register as executor…');
  const joined = await bots.join({ host: '127.0.0.1', port, username: 'ReaperBot', timeoutMs: 60_000 });
  botId = joined.botId;
  const executor = targets.add(botExecutor({ id: botId, registry: bots }));
  if (!executor.has('gather') || !executor.has('hunt')) throw new Error('bot did not advertise gather/hunt');
  await sleep(3000); // let chunks + footing settle
  const p = bots.status(botId).position;
  if (!p) throw new Error('bot has no position after spawn');
  const bx = Math.floor(p.x); const by = Math.floor(p.y); const bz = Math.floor(p.z);
  say(`   at ${JSON.stringify(p)}`);

  say('3) GOAL gather: place an oak_log 3 blocks away and chop it…');
  servers.exec(serverId, `setblock ${bx + 3} ${by} ${bz} minecraft:oak_log`);
  await sleep(1500);
  const g = await gather(executor, { block: 'oak_log', count: 1, maxDistance: 16, timeoutMs: 45_000 });
  say(`   strategy=${g.strategy}, gathered=${g.gathered}`);
  if (g.gathered < 1) throw new Error('gathered nothing — did collectblock run?');
  const inv = bots.inventory(botId);
  if (!inv.items.some((i) => i.name === 'oak_log')) {
    throw new Error(`no oak_log in inventory after gather: ${JSON.stringify(inv.items)}`);
  }
  say(`   inventory: ${inv.items.map((i) => `${i.count}x${i.name}`).join(', ')}`);

  say('4) GOAL hunt: give a sword, summon a chicken, and kill it…');
  servers.exec(serverId, `give ${joined.username} minecraft:iron_sword`);
  await sleep(1000);
  servers.exec(serverId, `summon minecraft:chicken ${bx + 2} ${by} ${bz + 2}`);
  await sleep(1500);
  const h = await hunt(executor, { mob: 'chicken', weapon: 'iron_sword', count: 1, maxDistance: 16, timeoutMs: 30_000 });
  say(`   strategy=${h.strategy}, killed=${h.killed}`);
  if (h.killed < 1) throw new Error('killed nothing — did pvp run / did the mob die?');

  say('5) quit + stop…');
  bots.quit(botId); botId = null;
  await servers.stop(serverId, { timeoutMs: 60_000 }); serverId = null;

  say('combat-smoke: PASS — boot → REAL bot → goal engine → collectblock gather + pvp hunt, all real.');
} catch (err) {
  failed = true;
  console.error(`combat-smoke: FAIL — ${err.message}`);
} finally {
  if (botId) try { bots.quit(botId); } catch { /* best-effort */ }
  if (serverId) await servers.stop(serverId, { timeoutMs: 10_000 }).catch(() => {});
  await rm(work, { recursive: true, force: true }).catch(() => {});
}
process.exit(failed ? 1 : 0);
