#!/usr/bin/env node
// server-smoke.mjs — REAL end-to-end proof of the Phase 2 exit criteria: (optionally)
// gradle-build a plugin, auto-provision Java + a Paper server, boot it, see it (and
// the plugin) come up clean, drive the console, stop it. No mocks anywhere.
//
//   node scripts/server-smoke.mjs [--version 1.21.11] [--port 25599]
//                                 [--build <gradleProjectDir>] [--plugin <jar|auto>]
//                                 [--plugin-name <idForEnableAssertion>]
//
// CI runs it bare (provision+boot+console+stop, Java auto-downloaded — no setup-java
// on purpose). Locally it can also build a real plugin and prove it enables.
import { rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobRegistry } from '../src/jobs.mjs';
import { startGradleJob } from '../src/build.mjs';
import { ensureJava } from '../src/java.mjs';
import { createServerManager, deployPlugin, provisionServer } from '../src/paper.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const version = flag('version', '1.21.11');
const port = Number(flag('port', '25599'));
const buildDir = flag('build');
const pluginArg = flag('plugin');
const pluginName = flag('plugin-name');

const jobs = createJobRegistry({ logCap: 10_000 });
const servers = createServerManager({ jobs });
const work = join(tmpdir(), 'minecraft-automated-driver', `smoke-${Date.now()}`);
const say = (msg) => console.log(msg);

let failed = false;
let serverId = null;
try {
  let plugins = [];
  if (buildDir) {
    say(`0) gradle build @ ${buildDir}…`);
    const snap = startGradleJob({ jobs, projectDir: buildDir, tasks: ['build'] });
    const done = await jobs.wait(snap.id, { timeoutMs: 15 * 60_000, pollMs: 500 });
    if (done.status !== 'succeeded') {
      throw new Error(`gradle build ${done.status}: ${done.error}\n${jobs.log(snap.id, { tail: 30 }).lines.join('\n')}`);
    }
    say(`   ${done.result.outcome}; jars: ${done.result.jars.map((j) => j.split(/[\\/]/).pop()).join(', ')}`);
    if (pluginArg === 'auto') {
      // A long-lived checkout accumulates historical jars in build/libs — deploying
      // more than one of the same plugin trips Bukkit's duplicate-name refusal.
      // Take the single freshest non-sources/-javadoc/-jmh jar (this build's output).
      const candidates = done.result.jars.filter((j) => !/-(sources|javadoc|jmh)\.jar$/.test(j));
      const dated = await Promise.all(candidates.map(async (j) => [j, (await stat(j)).mtimeMs]));
      dated.sort((a, b) => b[1] - a[1]);
      plugins = dated.slice(0, 1).map(([j]) => j);
    }
  }
  if (pluginArg && pluginArg !== 'auto') plugins = [pluginArg];

  say(`1) ensure Java 21 (auto-provision if the host lacks it)…`);
  const { javaPath, major, provisioned } = await ensureJava({
    feature: 21,
    runtimesDir: join(tmpdir(), 'minecraft-automated-driver', 'runtimes'),
    forceProvision: args.includes('--force-java-download'),
    log: (l) => say(`   ${l}`),
  });
  say(`   java ${major} @ ${javaPath} (${provisioned ? 'downloaded by the driver' : 'host'})`);

  say(`2) provision Paper ${version} @ ${work}…`);
  const server = join(work, 'server');
  await provisionServer({ version, dir: server, port, log: (l) => say(`   ${l}`) });
  for (const jar of plugins) {
    say(`   deploy ${jar.split(/[\\/]/).pop()}`);
    await deployPlugin({ dir: server, pluginJar: jar });
  }

  say('3) boot…');
  const started = servers.start({ dir: server, javaPath });
  serverId = started.serverId;
  const state = await servers.waitReady(serverId, { timeoutMs: 300_000 });
  const bootLog = jobs.log(started.jobId).lines;
  if (state !== 'ready') {
    throw new Error(`server never became ready (state ${state})\n${bootLog.slice(-40).join('\n')}`);
  }
  say('   ready (Done line seen).');

  if (pluginName) {
    if (!bootLog.some((l) => l.includes(`Enabling ${pluginName}`))) throw new Error(`plugin ${pluginName} never enabled`);
    if (bootLog.some((l) => /Could not load plugin|Error occurred while enabling/i.test(l))) {
      throw new Error('plugin errored during enable');
    }
    if (bootLog.some((l) => l.includes(`Disabling ${pluginName}`))) throw new Error('plugin self-disabled');
    say(`   plugin ${pluginName} enabled cleanly.`);
  }

  say('4) console: list…');
  servers.exec(serverId, 'list');
  await new Promise((r) => setTimeout(r, 3000));
  const tail = jobs.log(started.jobId, { tail: 10 }).lines;
  if (!tail.some((l) => /players online/i.test(l))) throw new Error(`console command produced no response\n${tail.join('\n')}`);
  say('   console responds.');

  say('5) stop…');
  const stopped = await servers.stop(serverId, { timeoutMs: 60_000 });
  say(`   stopped (forced=${stopped.forced}).`);
  serverId = null;

  say(`server-smoke: PASS — ${buildDir ? 'build → ' : ''}java → provision → boot${pluginName ? ' → plugin enabled' : ''} → console → stop, all real.`);
} catch (err) {
  failed = true;
  console.error(`server-smoke: FAIL — ${err.message}`);
} finally {
  if (serverId) await servers.stop(serverId, { timeoutMs: 10_000 }).catch(() => {});
  await rm(work, { recursive: true, force: true }).catch(() => {});
}
process.exit(failed ? 1 : 0);
