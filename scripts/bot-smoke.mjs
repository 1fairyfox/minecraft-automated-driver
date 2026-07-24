#!/usr/bin/env node
// bot-smoke.mjs — REAL end-to-end proof of the Phase 5 L2 lane: auto-provision + boot a
// local online-mode=false Paper server, join it with a REAL Mineflayer bot (a Minecraft
// client on the wire), read state, chat a command, walk, read inventory, quit, stop. No
// mocks — mineflayer really connects.
//
//   node scripts/bot-smoke.mjs [--version 1.21.11] [--port 25566] [--force-java-download]
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mineflayer from 'mineflayer';
import { Vec3 } from 'vec3';
import { createJobRegistry } from '../src/jobs.mjs';
import { ensureJava } from '../src/java.mjs';
import { createServerManager, provisionServer } from '../src/paper.mjs';
import { createBotRegistry } from '../src/bot.mjs';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const version = flag('version', '1.21.11');
const port = Number(flag('port', '25566'));

const jobs = createJobRegistry({ logCap: 10_000 });
const servers = createServerManager({ jobs });
const bots = createBotRegistry({
  createBot: (opts) => { const b = mineflayer.createBot(opts); b.vec3 = (x, y, z) => new Vec3(x, y, z); return b; },
});
const work = join(tmpdir(), 'minecraft-automated-driver', `bot-smoke-${Date.now()}`);
const say = (m) => console.log(m);

let failed = false;
let serverId = null;
let botId = null;
try {
  say(`1) ensure Java 21…`);
  const { javaPath } = await ensureJava({
    feature: 21,
    runtimesDir: join(tmpdir(), 'minecraft-automated-driver', 'runtimes'),
    forceProvision: args.includes('--force-java-download'),
    log: (l) => say(`   ${l}`),
  });

  say(`2) provision + boot Paper ${version} (offline, loopback)…`);
  const dir = join(work, 'server');
  await provisionServer({ version, dir, port, log: (l) => say(`   ${l}`) });
  const started = servers.start({ dir, javaPath, javaArgs: ['-Xmx2G'] });
  serverId = started.serverId;
  const state = await servers.waitReady(serverId, { timeoutMs: 300_000 });
  if (state !== 'ready') throw new Error(`server not ready (${state})`);
  say('   ready.');

  say('3) join with a REAL Mineflayer bot…');
  const joined = await bots.join({ host: '127.0.0.1', port, username: 'DriverBot', timeoutMs: 60_000 });
  botId = joined.botId;
  say(`   spawned as ${joined.username} (${botId}).`);

  say('4) read state…');
  const status = bots.status(botId);
  if (!status.position) throw new Error('bot has no position after spawn');
  say(`   at ${JSON.stringify(status.position)} health=${status.health}`);

  say('5) chat a command + read the reply…');
  bots.chat(botId, '/help');
  await new Promise((r) => setTimeout(r, 2500));
  if (bots.messages(botId).lines.length === 0) throw new Error('no chat received after /help');
  say(`   ${bots.messages(botId).lines.length} chat line(s) received.`);

  say('6) give an item + read inventory…');
  servers.exec(serverId, 'give DriverBot minecraft:dirt 5');
  await new Promise((r) => setTimeout(r, 2500));
  const inv = bots.inventory(botId);
  if (!inv.items.some((i) => i.name === 'dirt')) throw new Error(`dirt not in inventory: ${JSON.stringify(inv.items)}`);
  say(`   inventory: ${inv.items.map((i) => `${i.count}x${i.name}`).join(', ')}`);

  say('7) walk a few blocks…');
  const p = bots.status(botId).position;
  const move = await bots.moveTo(botId, { x: p.x + 3, y: p.y, z: p.z, timeoutMs: 10_000 });
  say(`   moved to ${JSON.stringify(move.position)}`);

  say('8) quit + stop…');
  bots.quit(botId); botId = null;
  await servers.stop(serverId, { timeoutMs: 60_000 }); serverId = null;

  say('bot-smoke: PASS — provision → boot → REAL bot join → state → chat → inventory → move → quit → stop.');
} catch (err) {
  failed = true;
  console.error(`bot-smoke: FAIL — ${err.message}`);
} finally {
  if (botId) try { bots.quit(botId); } catch { /* best-effort */ }
  if (serverId) await servers.stop(serverId, { timeoutMs: 10_000 }).catch(() => {});
  await rm(work, { recursive: true, force: true }).catch(() => {});
}
process.exit(failed ? 1 : 0);
