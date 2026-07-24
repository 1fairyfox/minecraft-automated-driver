// Instanced client spawns (roadmap Phase 5, "instance" mode): the DRIVER boots a real
// Fabric client with the agent enabled — no launcher, no MS account — via the agent's Loom
// `runProductionClient` task, waits for the agent's loopback handshake to appear in the run
// dir, and hands back a dir the existing agent_connect(kind:'fabric') attaches to. Killing
// the job kills the client. The whole spawn → connect → drive → kill loop, driver-owned.
import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runProcess } from './proc.mjs';
import { gradleCommand } from './build.mjs';

const AGENT_DIR = 'minecraft-automated-driver-agent';

export function createClientManager({
  jobs,
  run = runProcess,
  platform = process.platform,
  exists = async (p) => { try { await access(p); return true; } catch { return false; } },
} = {}) {
  const clients = new Map();
  let counter = 0;

  function get(id) {
    const c = clients.get(id);
    if (!c) throw new Error(`no client ${id}`);
    return c;
  }

  return {
    /**
     * Spawn a client. Starts the Loom production-client run as a job and resolves once the
     * agent's handshake file appears (or rejects if the run dies first / times out).
     * @returns { clientId, jobId, runDir, connectDir }
     *   connectDir is what agent_connect uses with kind:'fabric'.
     */
    async spawn({ agentDir, runSubdir = join('run', 'prodClient'), waitReadyMs = 420_000, pollMs = 1000 } = {}) {
      if (!agentDir) throw new Error('spawn needs the fabric agent dir (agents/fabric)');
      const connectDir = join(agentDir, runSubdir);
      const handshakePath = join(connectDir, 'config', AGENT_DIR, 'handshake.json');
      // A stale handshake from a prior run would fool the poll; clear it first.
      await rm(handshakePath, { force: true }).catch(() => {});

      const id = `c${++counter}`;
      const { command, args, cwd } = gradleCommand(agentDir, ['runProductionClient'], { platform });
      const snapshot = jobs.start(`prod-client ${id} @ ${agentDir}`, ({ signal, log }) =>
        run({ command, args, cwd, signal, onLine: (line) => log(line) }));
      const record = { id, jobId: snapshot.id, agentDir, connectDir, runDir: connectDir, state: 'spawning' };
      clients.set(id, record);

      const deadline = Date.now() + waitReadyMs;
      while (Date.now() < deadline) {
        if (await exists(handshakePath)) {
          record.state = 'ready';
          return { clientId: id, jobId: snapshot.id, runDir: connectDir, connectDir };
        }
        const job = jobs.status(snapshot.id);
        if (job && job.status !== 'running') {
          record.state = 'failed';
          const tail = jobs.log(snapshot.id, { tail: 30 })?.lines?.join('\n') ?? '';
          throw new Error(`client ${id} exited before its agent came up (${job.status})\n${tail}`);
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
      record.state = 'timeout';
      throw new Error(`client ${id} handshake never appeared within ${waitReadyMs}ms`);
    },

    list() {
      return [...clients.values()].map((c) => ({ id: c.id, jobId: c.jobId, state: c.state, connectDir: c.connectDir }));
    },

    /** Kill the client: abort its job (which kills the gradle+client process tree). */
    kill(id) {
      const c = get(id);
      jobs.kill(c.jobId);
      c.state = 'killed';
      clients.delete(id);
      return { killed: id };
    },
  };
}
