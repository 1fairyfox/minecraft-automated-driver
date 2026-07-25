// Shared boot for the real smoke scripts (bot-smoke, nav-smoke, …): ensure Java 21,
// provision + boot a local offline Paper server, and wait until it is ready. Extracted so
// each smoke expresses only its own scenario, not a copied boot sequence.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureJava } from '../../src/java.mjs';
import { provisionServer } from '../../src/paper.mjs';

/** Ensure Java, provision + boot Paper at `dir`/`port`, wait ready. Returns { serverId, javaPath }. */
export async function bootPaper(servers, { version, port, dir, forceJavaDownload = false, log = () => {} }) {
  const { javaPath } = await ensureJava({
    feature: 21,
    runtimesDir: join(tmpdir(), 'minecraft-automated-driver', 'runtimes'),
    forceProvision: forceJavaDownload,
    log,
  });
  await provisionServer({ version, dir, port, log });
  const { serverId } = servers.start({ dir, javaPath, javaArgs: ['-Xmx2G'] });
  const state = await servers.waitReady(serverId, { timeoutMs: 300_000 });
  if (state !== 'ready') throw new Error(`server not ready (${state})`);
  return { serverId, javaPath };
}
