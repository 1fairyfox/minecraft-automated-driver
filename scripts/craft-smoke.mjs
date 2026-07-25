#!/usr/bin/env node
// craft-smoke.mjs — REAL proof of the craft + place + build goals (0.18.0): boot a local offline
// Paper server, join a REAL Mineflayer bot, and drive it with the backend-agnostic GOAL ENGINE —
// give it planks and `craft` a crafting_table (core recipesFor/craft), then `place` a block and
// `build` a small stack (core placeBlock), asserting the inventory changes prove real crafting +
// placing. No mocks. Boot/join/teardown scaffolding: scripts/lib/smoke-bots.mjs (withBootedBot).
//
//   node scripts/craft-smoke.mjs [--version 1.21.11] [--port 25570] [--force-java-download]
import { craft, place, build } from '../src/goals.mjs';
import { withBootedBot } from './lib/smoke-bots.mjs';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const version = flag('version', '1.21.11');
const port = Number(flag('port', '25570'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const code = await withBootedBot(
  { version, port, name: 'craft-smoke', username: 'CrafterBot', forceJavaDownload: args.includes('--force-java-download') },
  async ({ executor, bots, servers, serverId, botId, joined, say }) => {
    for (const cap of ['craft', 'place', 'build']) {
      if (!executor.has(cap)) throw new Error(`bot did not advertise ${cap}`);
    }
    await sleep(3000); // let chunks + footing settle
    const count = (name) => (bots.inventory(botId).items.find((i) => i.name === name)?.count ?? 0);

    say('3) GOAL craft: give planks, craft a crafting_table (2x2, no table needed)…');
    servers.exec(serverId, `give ${joined.username} minecraft:oak_planks 16`);
    await sleep(1500);
    if (count('oak_planks') < 8) throw new Error(`expected planks in inventory, got ${count('oak_planks')}`);
    say(`   crafting… (${count('oak_planks')}x oak_planks in hand)`);
    const cr = await craft(executor, { item: 'crafting_table', count: 1 });
    await sleep(500);
    say(`   ${JSON.stringify(cr)}; now ${count('crafting_table')}x crafting_table, ${count('oak_planks')}x oak_planks`);
    if (count('crafting_table') < 1) throw new Error('no crafting_table in inventory after craft');

    say('4) GOAL place: place an oak_planks block beside the bot…');
    const p = bots.status(botId).position;
    const bx = Math.floor(p.x); const by = Math.floor(p.y); const bz = Math.floor(p.z);
    const beforePlace = count('oak_planks');
    const pl = await place(executor, { block: 'oak_planks', x: bx + 1, y: by, z: bz });
    await sleep(600);
    say(`   placed at ${JSON.stringify(pl.position)}; oak_planks ${beforePlace} → ${count('oak_planks')}`);
    if (count('oak_planks') >= beforePlace) throw new Error('placing did not consume a plank — did it place?');

    say('5) GOAL build: stack two more oak_planks on top…');
    const beforeBuild = count('oak_planks');
    const bd = await build(executor, {
      blocks: [
        { block: 'oak_planks', x: bx + 1, y: by + 1, z: bz },
        { block: 'oak_planks', x: bx + 1, y: by + 2, z: bz },
      ],
    });
    await sleep(600);
    say(`   built ${bd.placed} blocks; oak_planks ${beforeBuild} → ${count('oak_planks')}`);
    if (bd.placed !== 2) throw new Error(`build placed ${bd.placed}, expected 2`);
    if (count('oak_planks') > beforeBuild - 2) throw new Error('build did not consume two planks');
  },
);
process.exit(code);
