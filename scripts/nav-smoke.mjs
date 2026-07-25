#!/usr/bin/env node
// nav-smoke.mjs — REAL proof of the universal navigation goal (0.11.0): boot a local offline Paper
// server, join a REAL Mineflayer bot, register it as an executor, and drive it with the
// backend-agnostic GOAL ENGINE (navigate → native A* via mineflayer-pathfinder). No mocks. The
// boot/join/teardown scaffolding lives in scripts/lib/smoke-bots.mjs (withBootedBot).
//
//   node scripts/nav-smoke.mjs [--version 1.21.11] [--port 25567] [--force-java-download]
import { navigate } from '../src/goals.mjs';
import { withBootedBot } from './lib/smoke-bots.mjs';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const version = flag('version', '1.21.11');
const port = Number(flag('port', '25567'));

const code = await withBootedBot(
  { version, port, name: 'nav-smoke', username: 'NavBot', forceJavaDownload: args.includes('--force-java-download') },
  async ({ executor, bots, botId, say }) => {
    await new Promise((r) => setTimeout(r, 3000)); // let the world settle: footing + loaded chunks
    const start = bots.status(botId).position;
    if (!start) throw new Error('bot has no position after spawn');
    say(`   at ${JSON.stringify(start)}`);

    say('3) GOAL: navigate ~6 blocks away via the backend-agnostic engine (native A*)…');
    const target = { x: Math.round(start.x) + 6, y: Math.round(start.y), z: Math.round(start.z) + 6, range: 2 };
    const result = await navigate(executor, target);
    say(`   strategy=${result.strategy}, arrived at ${JSON.stringify(result.position)}`);
    if (result.strategy !== 'native') throw new Error(`expected the native pathfinder strategy, got ${result.strategy}`);

    const end = bots.status(botId).position;
    const moved = Math.hypot(end.x - start.x, end.z - start.z);
    if (moved < 2) throw new Error(`bot barely moved (${moved.toFixed(2)} blocks) — did pathfinding run?`);
    say(`   moved ${moved.toFixed(2)} blocks horizontally.`);
  },
);
process.exit(code);
