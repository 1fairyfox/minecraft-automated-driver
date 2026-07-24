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

  say('3) drive it through first-run to the title screen, click a button by name…');
  // The agent writes its handshake during init — a moment BEFORE the client finishes the
  // "Loading Minecraft" splash (class_424). And a production client runs on intermediary
  // mappings, so we can't key on a yarn class name like "TitleScreen" (it shows as
  // class_XXX). So poll the SEMANTIC widget tree by label until the title screen's "Options"
  // button is present — obfuscation-independent — while driving through whatever first-run
  // screens Minecraft shows first. On a fresh run dir 1.21 opens the "Welcome to Minecraft!"
  // accessibility onboarding (class_8032) with a "Continue" button before the title screen;
  // a real driver must click through it (which also exercises another click-by-name).
  const titleDeadline = Date.now() + 180_000;
  let clickedContinue = false;
  const hasLabel = (s, label) => s.tree && s.tree.includes(`"label":"${label}"`);
  let screen = await conn.request('screen');
  while (!hasLabel(screen, 'Options')) {
    if (Date.now() > titleDeadline) throw new Error(`title screen never became ready: ${JSON.stringify(screen)}`);
    if (!clickedContinue && hasLabel(screen, 'Continue')) {
      const cont = await conn.request('click', { name: 'Continue' });
      if (cont.clicked) { clickedContinue = true; say('   drove through the first-run accessibility onboarding (clicked "Continue" by name).'); }
    }
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
