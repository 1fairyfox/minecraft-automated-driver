#!/usr/bin/env node
// scenario-smoke.mjs — REAL proof of multi-target scenario orchestration (scenario_run):
// through the ACTUAL MCP tool, provision a local online-mode=false Paper server AND a real
// Mineflayer bot together in ONE scenario, run cross-target steps (server console + bot chat +
// bot status), and let the engine GUARANTEE teardown. Proves the whole stack — MCP tool →
// scenario engine → real provisioners → live server + live bot — with no mocks. Driven over an
// in-memory MCP client so it exercises exactly what a caller would.
//
//   node scripts/scenario-smoke.mjs [--version 1.21.11] [--port 25568]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/index.mjs';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const version = flag('version', '1.21.11');
const port = Number(flag('port', '25568'));
const say = (m) => console.log(m);

let failed = false;
let close = async () => {};
try {
  say('1) start the REAL MCP server (all backends real: Paper provisioner + Mineflayer bot)…');
  const server = await createServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'scenario-smoke', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  close = async () => { await client.close(); await server.close(); };

  say(`2) scenario_run: boot Paper ${version} + join a REAL bot in ONE scenario, coordinate, then guaranteed teardown…`);
  // Start the scenario as a job (no waitMs) and poll job_status — a boot outlasts a single MCP
  // request's timeout, so the job model is the right pattern (short polls, not one long call).
  const start = await client.callTool({
    name: 'scenario_run',
    arguments: {
      name: 'server+bot',
      actors: [
        { id: 'srv', kind: 'server', version, port, waitReadyMs: 300_000 },
        { id: 'bot', kind: 'bot', port, username: 'ScenarioBot', timeoutMs: 60_000 },
      ],
      steps: [
        { action: 'wait', ms: 3000 }, // let the world settle after the bot spawns
        { action: 'server_exec', actor: 'srv', command: 'say scenario online' },
        { action: 'invoke', actor: 'bot', capability: 'chat', args: { message: '/help' } },
        { action: 'wait', ms: 2000 },
        { action: 'invoke', actor: 'bot', capability: 'messages' },
        { action: 'invoke', actor: 'bot', capability: 'status' },
      ],
    },
  });
  if (start.isError) throw new Error(start.content[0].text);
  const job = JSON.parse(start.content[0].text);
  say(`   scenario job ${job.id} started; polling…`);

  const deadline = Date.now() + 600_000;
  let snap = job;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    snap = JSON.parse((await client.callTool({ name: 'job_status', arguments: { id: job.id } })).content[0].text);
    if (snap.status !== 'running') break;
  }
  if (snap.status === 'running') throw new Error('scenario did not finish within 10 minutes');
  if (snap.status !== 'succeeded') {
    const log = JSON.parse((await client.callTool({ name: 'job_log', arguments: { id: job.id, tail: 20 } })).content[0].text);
    throw new Error(`scenario job ${snap.status}: ${snap.error ?? ''}\n${log.lines.join('\n')}`);
  }
  const report = snap.result;
  if (!report) throw new Error('scenario finished but produced no report');
  say(`   report: ${JSON.stringify({
    ok: report.ok,
    provisioned: report.provisioned.map((p) => [p.id, p.ok]),
    steps: report.steps.map((s) => [s.action, s.ok]),
    teardown: report.teardown.map((t) => [t.id, t.ok]),
  })}`);

  // The whole scenario must be green: both targets provisioned, every step passed, both torn down.
  if (!report.ok) throw new Error(`scenario not ok: ${JSON.stringify(report)}`);
  if (report.provisioned.length !== 2 || !report.provisioned.every((p) => p.ok)) {
    throw new Error('both targets should provision');
  }
  if (!report.steps.every((s) => s.ok)) throw new Error('a coordinated step failed');
  const statusStep = report.steps.at(-1); // the final step is the bot `status` invoke
  if (!statusStep.result?.position) throw new Error('the bot had no in-world position — did it really join?');
  if (report.teardown.length !== 2 || !report.teardown.every((t) => t.ok)) {
    throw new Error('the engine must tear down both targets');
  }
  say(`   bot spawned at ${JSON.stringify(statusStep.result.position)}; server + bot both torn down.`);

  say('scenario-smoke: PASS — one scenario_run booted a REAL server + REAL bot, coordinated them, and guaranteed teardown.');
} catch (err) {
  failed = true;
  console.error(`scenario-smoke: FAIL — ${err.message}`);
} finally {
  await close().catch(() => {});
}
process.exit(failed ? 1 : 0);
