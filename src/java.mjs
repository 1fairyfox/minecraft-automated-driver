// Java runtime resolution — auto-provision by default (owner directive 2026-07-23):
// use a suitable host Java if one exists, otherwise download a Temurin JRE from the
// Adoptium API into a managed, disposable runtime dir. Never touches system installs.
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { runProcess } from './proc.mjs';

/** Parse the major version out of `java -version` stderr/stdout text. */
export function parseJavaMajor(text) {
  const m = text.match(/version "(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const major = Number(m[1]);
  return major === 1 ? Number(m[2]) : major; // "1.8.0" era vs modern "21.0.3"
}

/** Probe one java executable; returns its major version or null. */
export async function probeJava(javaPath, { run = runProcess } = {}) {
  let text = '';
  try {
    const { code } = await run({
      command: javaPath,
      args: ['-version'],
      onLine: (line) => { text += `${line}\n`; },
    });
    if (code !== 0) return null;
  } catch {
    return null;
  }
  return parseJavaMajor(text);
}

function adoptiumUrl({ feature, platform, arch }) {
  const os = { win32: 'windows', linux: 'linux', darwin: 'mac' }[platform];
  const cpu = { x64: 'x64', arm64: 'aarch64' }[arch];
  if (!os || !cpu) throw new Error(`no Temurin JRE mapping for ${platform}/${arch}`);
  return `https://api.adoptium.net/v3/binary/latest/${feature}/ga/${os}/${cpu}/jre/hotspot/normal/eclipse`;
}

/** Find bin/java under an extracted runtime dir (archive roots vary). */
export async function findJavaBinary(dir, { platform = process.platform } = {}) {
  const exe = platform === 'win32' ? 'java.exe' : 'java';
  const entries = await readdir(dir);
  for (const entry of entries) {
    const candidate = join(dir, entry, 'bin', exe);
    try {
      await stat(candidate);
      return candidate;
    } catch { /* keep looking */ }
  }
  throw new Error(`no ${exe} found under ${dir}`);
}

/**
 * Ensure a Java >= feature exists; returns { javaPath, major, provisioned }.
 * Order: explicit configured path → JAVA_HOME → PATH → managed runtime dir →
 * download+extract a Temurin JRE (bsdtar handles both .zip and .tar.gz).
 */
export async function ensureJava({
  feature = 21,
  runtimesDir,
  configuredPath = null,
  envJavaHome = process.env.JAVA_HOME,
  platform = process.platform,
  arch = process.arch,
  fetchImpl = fetch,
  run = runProcess,
  log = () => {},
  forceProvision = false, // skip host candidates — CI uses this to prove the download
}) {
  const exe = platform === 'win32' ? 'java.exe' : 'java';
  const candidates = forceProvision ? [] : [
    configuredPath,
    envJavaHome ? join(envJavaHome, 'bin', exe) : null,
    'java',
  ].filter(Boolean);

  for (const candidate of candidates) {
    const major = await probeJava(candidate, { run });
    if (major !== null && major >= feature) {
      log(`java: using ${candidate} (major ${major})`);
      return { javaPath: candidate, major, provisioned: false };
    }
  }

  // Managed runtime from a previous provision?
  const managedDir = join(runtimesDir, `temurin-${feature}-jre`);
  try {
    const managed = await findJavaBinary(managedDir, { platform });
    const major = await probeJava(managed, { run });
    if (major !== null && major >= feature) {
      log(`java: using managed runtime ${managed}`);
      return { javaPath: managed, major, provisioned: false };
    }
  } catch { /* not provisioned yet */ }

  // Download + extract into the managed dir.
  const url = adoptiumUrl({ feature, platform, arch });
  log(`java: no suitable host Java — downloading Temurin ${feature} JRE from Adoptium…`);
  const response = await fetchImpl(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Adoptium download failed: HTTP ${response.status}`);
  // Owner-only modes: the runtimes dir defaults under the shared OS tmpdir
  // (CodeQL js/insecure-temporary-file; no-op perms on Windows).
  await mkdir(managedDir, { recursive: true, mode: 0o700 });
  const archivePath = join(managedDir, platform === 'win32' ? 'jre.zip' : 'jre.tar.gz');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath, { mode: 0o600 }));
  log('java: extracting…');
  const { code } = await run({
    command: 'tar',
    args: ['-xf', archivePath, '-C', managedDir],
    onLine: (line) => log(`tar: ${line}`),
  });
  if (code !== 0) throw new Error(`archive extraction failed (tar exit ${code})`);
  const javaPath = await findJavaBinary(managedDir, { platform });
  const major = await probeJava(javaPath, { run });
  if (major === null || major < feature) throw new Error('provisioned runtime failed its own probe');
  log(`java: provisioned ${javaPath} (major ${major})`);
  return { javaPath, major, provisioned: true };
}
