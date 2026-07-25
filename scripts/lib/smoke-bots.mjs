// Shared harness for the bot-driven real smoke scripts (nav-smoke, combat-smoke): it loads the
// Mineflayer plugins (pathfinder → navigate, collectblock → gather, pvp → hunt), boots a local
// offline Paper server, joins a real bot, registers it as an executor, and GUARANTEES teardown —
// so each smoke expresses only its own scenario, and the boot/cleanup scaffolding lives in exactly
// one place (no duplication across the standalone smoke entrypoints).
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mineflayer from 'mineflayer';
import { Vec3 } from 'vec3';
import pathfinderPkg from 'mineflayer-pathfinder'; // CommonJS — import the default, then destructure
import { plugin as collectBlock } from 'mineflayer-collectblock';
import { plugin as pvp } from 'mineflayer-pvp';
import { createBotRegistry } from '../../src/bot.mjs';
import { createJobRegistry } from '../../src/jobs.mjs';
import { createServerManager } from '../../src/paper.mjs';
import { createTargetRegistry, botExecutor } from '../../src/executors.mjs';
import { bootPaper } from './paper-smoke.mjs';

const { pathfinder, Movements, goals } = pathfinderPkg;

/** A bot registry whose bots have pathfinder + collectblock + pvp loaded (navigate/gather/hunt). */
export function createSmokeBots() {
  return createBotRegistry({
    createBot: (opts) => {
      const b = mineflayer.createBot(opts);
      b.vec3 = (x, y, z) => new Vec3(x, y, z);
      b.loadPlugin(pathfinder);
      b.loadPlugin(collectBlock);
      b.loadPlugin(pvp);
      b.once('spawn', () => b.pathfinder.setMovements(new Movements(b)));
      return b;
    },
    goalNear: (x, y, z, range) => new goals.GoalNear(x, y, z, range),
  });
}

/**
 * Boot a local offline Paper server, join a real bot, register it as an executor, hand all of that
 * to `scenario`, and GUARANTEE teardown (quit the bot, stop the server, remove the run dir) — even
 * on failure. Returns the process exit code (0 pass / 1 fail). `scenario({executor, bots, servers,
 * targets, serverId, botId, joined, say})` runs only its own steps and may throw to fail the smoke.
 */
export async function withBootedBot({ version = '1.21.11', port, name, username, forceJavaDownload = false }, scenario) {
  const say = (m) => console.log(m);
  const jobs = createJobRegistry({ logCap: 10_000 });
  const servers = createServerManager({ jobs });
  const bots = createSmokeBots();
  const targets = createTargetRegistry();
  const work = join(tmpdir(), 'minecraft-automated-driver', `${name}-${Date.now()}`);
  let failed = false;
  let serverId = null;
  let botId = null;
  try {
    say(`1) ensure Java + boot Paper ${version} (offline, loopback)…`);
    ({ serverId } = await bootPaper(servers, { version, port, dir: join(work, 'server'), forceJavaDownload, log: (l) => say(`   ${l}`) }));
    say('   ready.');
    say(`2) join a REAL Mineflayer bot (${username}) + register as executor…`);
    const joined = await bots.join({ host: '127.0.0.1', port, username, timeoutMs: 60_000 });
    botId = joined.botId;
    const executor = targets.add(botExecutor({ id: botId, registry: bots }));
    await scenario({ executor, bots, servers, targets, serverId, botId, joined, say });
    say('   quit + stop…');
    bots.quit(botId); botId = null;
    await servers.stop(serverId, { timeoutMs: 60_000 }); serverId = null;
    say(`${name}: PASS`);
  } catch (err) {
    failed = true;
    console.error(`${name}: FAIL — ${err.message}`);
  } finally {
    if (botId) try { bots.quit(botId); } catch { /* best-effort */ }
    if (serverId) await servers.stop(serverId, { timeoutMs: 10_000 }).catch(() => {});
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
  return failed ? 1 : 0;
}
