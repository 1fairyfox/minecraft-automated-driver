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

  say('3) drive it: introspect the screen + click a button by name…');
  const screen = await conn.request('screen');
  if (!screen.tree || !screen.tree.includes('Screen')) throw new Error(`unexpected screen: ${JSON.stringify(screen)}`);
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
