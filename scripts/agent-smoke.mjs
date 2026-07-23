#!/usr/bin/env node
// agent-smoke.mjs — REAL end-to-end proof of the Phase 3 exit criteria: build the
// Paper agent, provision + boot a Paper server with it enabled
// (-Dfairyfox.driver.enable=true), connect over the loopback control plane, query
// live state, run a console command through it, disconnect, stop. No mocks anywhere.
//
//   node scripts/agent-smoke.mjs [--version 1.21.11] [--port 25601] [--force-java-download]
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createJobRegistry } from '../src/jobs.mjs';
import { startGradleJob, findBuiltJars } from '../src/build.mjs';
import { ensureJava } from '../src/java.mjs';
import { createServerManager, deployPlugin, provisionServer } from '../src/paper.mjs';
import { readHandshake, connectAgent } from '../src/agent.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const version = flag('version', '1.21.11');
const port = Number(flag('port', '25601'));

const jobs = createJobRegistry({ logCap: 10_000 });
const servers = createServerManager({ jobs });
const work = join(tmpdir(), 'minecraft-automated-driver', `agent-smoke-${Date.now()}`);
const say = (m) => console.log(m);

let failed = false;
let serverId = null;
let conn = null;
try {
  const agentDir = join(ROOT, 'agents', 'paper');
  say('0) build the Paper agent…');
  const build = startGradleJob({ jobs, projectDir: agentDir, tasks: ['build'] });
  const built = await jobs.wait(build.id, { timeoutMs: 15 * 60_000, pollMs: 500 });
  if (built.status !== 'succeeded') {
    throw new Error(`agent build ${built.status}: ${built.error}\n${jobs.log(build.id, { tail: 30 }).lines.join('\n')}`);
  }
  const agentJar = (await findBuiltJars(agentDir)).find((j) => !/-(sources|javadoc)\.jar$/.test(j));
  if (!agentJar) throw new Error('no agent jar produced');
  say(`   built ${agentJar.split(/[\\/]/).pop()}`);

  say('1) ensure Java 21…');
  const { javaPath, major, provisioned } = await ensureJava({
    feature: 21,
    runtimesDir: join(tmpdir(), 'minecraft-automated-driver', 'runtimes'),
    forceProvision: args.includes('--force-java-download'),
    log: (l) => say(`   ${l}`),
  });
  say(`   java ${major} (${provisioned ? 'downloaded' : 'host'})`);

  const server = join(work, 'server');
  say(`2) provision Paper ${version} + deploy the agent…`);
  await provisionServer({ version, dir: server, port, log: (l) => say(`   ${l}`) });
  await deployPlugin({ dir: server, pluginJar: agentJar });

  say('3) boot with the agent ENABLED (-Dfairyfox.driver.enable=true)…');
  const started = servers.start({ dir: server, javaPath, javaArgs: ['-Xmx2G', '-Dfairyfox.driver.enable=true'] });
  serverId = started.serverId;
  const state = await servers.waitReady(serverId, { timeoutMs: 300_000 });
  const bootLog = jobs.log(started.jobId).lines;
  if (state !== 'ready') throw new Error(`server not ready (${state})\n${bootLog.slice(-40).join('\n')}`);
  if (!bootLog.some((l) => l.includes('agent ENABLED'))) throw new Error('agent did not report ENABLED');
  say('   agent reports ENABLED.');

  say('4) connect over the loopback control plane…');
  const hs = await readHandshake(server);
  if (hs.token.length !== 64) throw new Error('handshake token is not 256-bit');
  conn = await connectAgent({ port: hs.port, token: hs.token });
  say(`   connected — agent=${conn.welcome.agent} caps=${conn.welcome.capabilities.join(',')}`);

  say('5) query live state…');
  const live = await conn.request('state');
  if (!Array.isArray(live.worlds)) throw new Error(`state.worlds missing: ${JSON.stringify(live)}`);
  say(`   version=${live.version} worlds=${live.worlds.length} players=${live.players.length}`);

  say('6) run a console command THROUGH the agent…');
  const exec = await conn.request('exec', { command: 'say automated-driver agent online' });
  if (!exec.dispatched) throw new Error(`exec not dispatched: ${JSON.stringify(exec)}`);
  await new Promise((r) => setTimeout(r, 1500));
  if (!jobs.log(started.jobId).lines.some((l) => l.includes('automated-driver agent online'))) {
    throw new Error('the say command did not reach the server console');
  }
  say('   command dispatched and echoed in the console.');

  say('7) wrong token is refused (negative check)…');
  let refused = false;
  try { await connectAgent({ port: hs.port, token: '0'.repeat(64) }); } catch { refused = true; }
  if (!refused) throw new Error('SECURITY: a wrong token was NOT refused');
  say('   a wrong token is refused.');

  conn.close(); conn = null;
  say('8) stop…');
  await servers.stop(serverId, { timeoutMs: 60_000 });
  serverId = null;

  say('agent-smoke: PASS — build agent → boot enabled → connect → state → exec → token-refused → stop, all real.');
} catch (err) {
  failed = true;
  console.error(`agent-smoke: FAIL — ${err.message}`);
} finally {
  if (conn) conn.close();
  if (serverId) await servers.stop(serverId, { timeoutMs: 10_000 }).catch(() => {});
  await rm(work, { recursive: true, force: true }).catch(() => {});
}
process.exit(failed ? 1 : 0);
