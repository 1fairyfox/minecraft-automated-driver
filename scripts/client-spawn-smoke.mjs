#!/usr/bin/env node
// client-spawn-smoke.mjs — REAL proof of the Phase-5 "instance" mode: the DRIVER spawns a
// real Fabric client (agent enabled) with NO launcher/account, connects to it over the
// loopback control plane, drives it (introspect the title screen + click a button by name),
// disconnects, and kills it. The full spawn → connect → drive → kill loop, driver-owned.
// Headless under XVFB in CI. No mocks.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createJobRegistry } from '../src/jobs.mjs';
import { createClientManager } from '../src/client.mjs';
import { readHandshake, connectAgent } from '../src/agent.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const jobs = createJobRegistry({ logCap: 20_000 });
const clients = createClientManager({ jobs });
const say = (m) => console.log(m);

let failed = false;
let clientId = null;
let conn = null;
try {
  say('1) DRIVER spawns a real Fabric client (agent enabled, no launcher)…');
  const spawned = await clients.spawn({ agentDir: join(ROOT, 'agents', 'fabric'), waitReadyMs: 600_000 });
  clientId = spawned.clientId;
  say(`   up — clientId=${spawned.clientId}, connectDir=${spawned.connectDir}`);

  say('2) read the agent handshake + connect over loopback…');
  const hs = await readHandshake(spawned.connectDir, { kind: 'fabric' });
  if (hs.token.length !== 64) throw new Error('handshake token is not 256-bit');
  conn = await connectAgent({ port: hs.port, token: hs.token });
  say(`   connected — agent=${conn.welcome.agent} caps=${conn.welcome.capabilities.join(',')}`);

  say('3) drive it: wait for the title screen, introspect, click a button by name…');
  // The agent writes its handshake during init — a moment BEFORE the client finishes the
  // "Loading Minecraft" splash (class_424) and swaps in the title screen. And a production
  // client runs on intermediary mappings, so we can't key on a yarn class name like
  // "TitleScreen" (it shows up as class_XXX). Instead poll the semantic widget tree until
  // the title screen's "Options" button is actually present by label — that's exactly what
  // "the title screen is ready to drive" means, obfuscation-independent.
  const titleDeadline = Date.now() + 120_000;
  let screen = await conn.request('screen');
  while (!(screen.tree && screen.tree.includes('"label":"Options"'))) {
    if (Date.now() > titleDeadline) throw new Error(`title screen never became ready: ${JSON.stringify(screen)}`);
    await new Promise((r) => setTimeout(r, 1000));
    screen = await conn.request('screen');
  }
  say('   title screen is up (Options present).');
  const click = await conn.request('click', { name: 'Options' });
  if (!click.clicked) throw new Error(`click-by-name 'Options' failed: ${JSON.stringify(click)}`);
  say('   introspected + clicked "Options" by name.');

  say('4) wrong token refused (security check)…');
  let refused = false;
  try { await connectAgent({ port: hs.port, token: '0'.repeat(64) }); } catch { refused = true; }
  if (!refused) throw new Error('SECURITY: a wrong token was NOT refused');

  conn.close(); conn = null;
  say('5) DRIVER kills the client…');
  clients.kill(clientId); clientId = null;

  say('client-spawn-smoke: PASS — driver spawned → connected → drove (by name) → refused bad token → killed, all real.');
} catch (err) {
  failed = true;
  console.error(`client-spawn-smoke: FAIL — ${err.message}`);
} finally {
  if (conn) try { conn.close(); } catch { /* best-effort */ }
  if (clientId) try { clients.kill(clientId); } catch { /* best-effort */ }
}
process.exit(failed ? 1 : 0);
