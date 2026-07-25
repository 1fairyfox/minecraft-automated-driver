// L1 Paper server layer — auto-provision (download by version from PaperMC's fill
// API), configure a LOCAL offline test server, boot/console/stop as jobs.
//
// `online-mode=false` is written for these loopback test servers ONLY — a deliberate,
// documented exception (SECURITY.md); never suggest it for anything public-facing.
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { basename, join } from 'node:path';
import { runProcess } from './proc.mjs';

const FILL = 'https://fill.papermc.io/v3/projects/paper';
const UA = 'minecraft-automated-driver (github.com/1fairyfox/minecraft-automated-driver)';

/** Resolve the latest build's server-jar download for a Paper version. */
export async function resolvePaperDownload(version, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${FILL}/versions/${version}/builds/latest`, {
    headers: { 'User-Agent': UA },
  });
  if (!response.ok) throw new Error(`fill.papermc.io: HTTP ${response.status} for Paper ${version}`);
  const build = await response.json();
  const download = build.downloads?.['server:default'];
  const url = download?.url;
  if (!url) throw new Error(`no server:default download in Paper ${version} build ${build.id ?? '?'}`);
  // The fill API publishes a sha256 per artifact — carry it so provisionServer can verify the
  // downloaded bytes (supply-chain integrity). null when a future API omits it (verified skipped).
  return { url, build: build.id ?? null, channel: build.channel ?? null, sha256: download.checksums?.sha256 ?? null };
}

/**
 * Provision a ready-to-boot LOCAL test server dir: paper.jar + eula + offline
 * flat-world properties. Returns { dir, jarPath, build, channel }.
 */
export async function provisionServer({
  version, dir, port = 25565, fetchImpl = fetch, log = () => {},
}) {
  const { url, build, channel, sha256 } = await resolvePaperDownload(version, { fetchImpl });
  log(`paper ${version}: build ${build} (${channel}) → downloading`);
  // Restrictive modes: server dirs default under the shared OS tmpdir, so keep them
  // owner-only on POSIX (CodeQL js/insecure-temporary-file; no-op perms on Windows).
  await mkdir(join(dir, 'plugins'), { recursive: true, mode: 0o700 });
  const jarPath = join(dir, 'paper.jar');
  const response = await fetchImpl(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!response.ok) throw new Error(`paper download failed: HTTP ${response.status}`);
  // Hash the bytes as they stream to disk (single pass), then verify against the publisher's
  // sha256 — a supply-chain integrity gate. A mismatch fails CLOSED: delete the jar and refuse,
  // so a tampered/corrupt download is never booted. (SECURITY.md / notes/security/threat-model.md.)
  const hash = createHash('sha256');
  await pipeline(
    Readable.fromWeb(response.body),
    async function* teeHash(source) { for await (const chunk of source) { hash.update(chunk); yield chunk; } },
    createWriteStream(jarPath, { mode: 0o600 }),
  );
  if (sha256) {
    const digest = hash.digest('hex');
    if (digest !== sha256) {
      await rm(jarPath, { force: true });
      throw new Error(`paper ${version} jar failed its integrity check — refusing it (expected sha256 ${sha256}, got ${digest})`);
    }
    log(`paper ${version}: sha256 verified (${sha256.slice(0, 12)}…)`);
  } else {
    log(`paper ${version}: no published checksum — integrity check skipped`);
  }
  await writeFile(join(dir, 'eula.txt'), 'eula=true\n', { mode: 0o600 });
  await writeFile(join(dir, 'server.properties'), [
    String.raw`level-type=minecraft\:flat`,
    'online-mode=false', // LOCAL loopback test server only — see SECURITY.md
    'spawn-protection=0',
    'view-distance=4',
    `server-port=${port}`,
    'server-ip=127.0.0.1',
    '',
  ].join('\n'), { mode: 0o600 });
  log(`paper ${version}: provisioned at ${dir}`);
  return { dir, jarPath, build, channel };
}

/** Copy a plugin jar into the server's plugins/. */
export async function deployPlugin({ dir, pluginJar }) {
  const target = join(dir, 'plugins', basename(pluginJar));
  await copyFile(pluginJar, target);
  return { deployed: target };
}

/**
 * Live-server manager: boot as a job (readiness = the "Done (" console line),
 * console commands over stdin, graceful stop with forced fallback.
 */
export function createServerManager({ jobs, run = runProcess }) {
  const servers = new Map();
  let counter = 0;

  return {
    start({ dir, javaPath = 'java', javaArgs = ['-Xmx2G'] }) {
      const id = `s${++counter}`;
      const server = {
        id, dir, state: 'starting', child: null, jobId: null,
        startedAt: new Date().toISOString(),
      };
      servers.set(id, server);

      const snapshot = jobs.start(`paper-server ${id} @ ${dir}`, async ({ signal, log }) => {
        try {
          const { code } = await run({
            command: javaPath,
            args: [...javaArgs, '-jar', 'paper.jar', '--nogui'],
            cwd: dir,
            signal,
            onSpawn: (child) => { server.child = child; },
            onLine: (line) => {
              log(line);
              if (server.state === 'starting' && line.includes('Done (')) server.state = 'ready';
            },
          });
          if (code !== 0 && code !== null) throw new Error(`server exited ${code}`);
          return { code };
        } finally {
          server.state = 'stopped'; // whatever the exit path, the process is gone
        }
      });
      server.jobId = snapshot.id;
      return { serverId: id, jobId: snapshot.id };
    },

    get(id) {
      const s = servers.get(id);
      if (!s) return null;
      const { child, ...pub } = s;
      return pub;
    },

    list() {
      return [...servers.keys()].map((id) => this.get(id));
    },

    /** Wait until ready/stopped or timeout; returns the state reached. */
    async waitReady(id, { timeoutMs = 300_000, pollMs = 250 } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const s = servers.get(id);
        if (!s) return null;
        if (s.state !== 'starting') return s.state;
        await new Promise((r) => setTimeout(r, pollMs));
      }
      return servers.get(id)?.state ?? null;
    },

    /** Send a console command (newline appended). */
    exec(id, command) {
      const s = servers.get(id);
      if (!s) throw new Error(`no server ${id}`);
      if (!s.child || s.state === 'stopped') throw new Error(`server ${id} is not running`);
      s.child.stdin.write(`${command}\n`);
      return { sent: command };
    },

    /** Graceful `stop`, then abort the job (which kills the child) after timeoutMs. */
    async stop(id, { timeoutMs = 30_000 } = {}) {
      const s = servers.get(id);
      if (!s) throw new Error(`no server ${id}`);
      if (s.state !== 'stopped' && s.child) {
        try { s.child.stdin.write('stop\n'); } catch { /* already dying */ }
      }
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && s.state !== 'stopped') {
        await new Promise((r) => setTimeout(r, 100));
      }
      let forced = false;
      if (s.state !== 'stopped') {
        jobs.kill(s.jobId);
        forced = true;
        const hardDeadline = Date.now() + 15_000;
        while (s.state !== 'stopped' && Date.now() < hardDeadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
        if (s.state !== 'stopped') throw new Error(`server ${id} survived the kill — check pid manually`);
      }
      return { stopped: true, forced };
    },
  };
}
