// Unit layer: Java resolution + auto-provision (fake fetch/runner; the real
// download is proven by the CI server-smoke job, which runs with no preinstalled
// Java selection on purpose).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureJava, findJavaBinary, parseJavaMajor, probeJava } from '../src/java.mjs';

test('parseJavaMajor handles modern, legacy, and garbage version strings', () => {
  assert.equal(parseJavaMajor('openjdk version "21.0.3" 2024-04-16'), 21);
  assert.equal(parseJavaMajor('java version "1.8.0_401"'), 8);
  assert.equal(parseJavaMajor('no version here'), null);
});

test('probeJava returns the major, or null on failure/unrunnable', async () => {
  assert.equal(await probeJava('java', {
    run: async ({ onLine }) => { onLine('openjdk version "21.0.3"'); return { code: 0 }; },
  }), 21);
  assert.equal(await probeJava('java', { run: async () => ({ code: 1 }) }), null);
  assert.equal(await probeJava('java', { run: async () => { throw new Error('ENOENT'); } }), null);
});

test('findJavaBinary locates bin/java under an extracted archive root', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jre-'));
  try {
    await mkdir(join(dir, 'jdk-21.0.3+9-jre', 'bin'), { recursive: true });
    await writeFile(join(dir, 'jdk-21.0.3+9-jre', 'bin', 'java'), '');
    const found = await findJavaBinary(dir, { platform: 'linux' });
    assert.match(found, /bin[\\/]java$/);
    await assert.rejects(() => findJavaBinary(dir, { platform: 'win32' }), /no java\.exe found/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ensureJava short-circuits on a suitable configured/host java', async () => {
  const result = await ensureJava({
    feature: 21,
    runtimesDir: '/unused',
    configuredPath: 'C:/my/java.exe',
    run: async ({ command, onLine }) => {
      assert.equal(command, 'C:/my/java.exe');
      onLine('openjdk version "22.0.1"');
      return { code: 0 };
    },
  });
  assert.deepEqual(result, { javaPath: 'C:/my/java.exe', major: 22, provisioned: false });
});

test('ensureJava skips too-old candidates and falls through to provisioning', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtimes-'));
  try {
    const probed = [];
    const ran = [];
    const fetchImpl = async (url) => {
      assert.equal(String(url), 'https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jre/hotspot/normal/eclipse');
      return { ok: true, status: 200, body: new Blob(['ARCHIVE']).stream() };
    };
    const run = async ({ command, args, onLine }) => {
      if (command === 'tar') {
        ran.push(args);
        // simulate extraction: create the runtime layout
        const rootDir = join(dir, 'temurin-21-jre', 'jdk-21+35-jre', 'bin');
        await mkdir(rootDir, { recursive: true });
        await writeFile(join(rootDir, 'java'), '');
        return { code: 0 };
      }
      probed.push(command);
      // host java too old; provisioned java is 21
      onLine(command === 'java' ? 'openjdk version "17.0.2"' : 'openjdk version "21.0.3"');
      return { code: 0 };
    };
    const logs = [];
    const result = await ensureJava({
      feature: 21, runtimesDir: dir, platform: 'linux', arch: 'x64',
      envJavaHome: null, fetchImpl, run, log: (l) => logs.push(l),
    });
    assert.equal(result.provisioned, true);
    assert.match(result.javaPath, /temurin-21-jre/);
    assert.equal(result.major, 21);
    assert.equal(ran.length, 1); // tar ran once
    assert.equal(logs.some((l) => /downloading Temurin/.test(l)), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('forceProvision skips host candidates entirely', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtimes-'));
  try {
    const managedBin = join(dir, 'temurin-21-jre', 'jdk-21+35-jre', 'bin');
    await mkdir(managedBin, { recursive: true });
    await writeFile(join(managedBin, 'java'), '');
    const probes = [];
    const result = await ensureJava({
      feature: 21, runtimesDir: dir, platform: 'linux', forceProvision: true,
      configuredPath: '/host/java-that-must-not-be-probed',
      fetchImpl: async () => { throw new Error('managed runtime exists — no download'); },
      run: async ({ command, onLine }) => {
        probes.push(command);
        onLine('openjdk version "21.0.1"');
        return { code: 0 };
      },
    });
    assert.equal(result.provisioned, false); // reused managed, host never probed
    assert.equal(probes.includes('/host/java-that-must-not-be-probed'), false);
    assert.match(result.javaPath, /temurin-21-jre/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ensureJava reuses an already-provisioned managed runtime', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtimes-'));
  try {
    const managedBin = join(dir, 'temurin-21-jre', 'jdk-21+35-jre', 'bin');
    await mkdir(managedBin, { recursive: true });
    await writeFile(join(managedBin, 'java'), '');
    const result = await ensureJava({
      feature: 21, runtimesDir: dir, platform: 'linux', envJavaHome: null,
      fetchImpl: async () => { throw new Error('must not download'); },
      run: async ({ command, onLine }) => {
        onLine(command === 'java' ? 'nope' : 'openjdk version "21.0.1"');
        return { code: 0 };
      },
    });
    assert.equal(result.provisioned, false);
    assert.match(result.javaPath, /temurin-21-jre/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ensureJava fails loudly on unmappable platforms, HTTP errors, and bad extractions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtimes-'));
  try {
    const never = async ({ command, onLine }) => { onLine('nope'); return { code: 1 }; };
    await assert.rejects(
      () => ensureJava({ feature: 21, runtimesDir: dir, platform: 'sunos', arch: 'x64', envJavaHome: null, run: never }),
      /no Temurin JRE mapping/,
    );
    await assert.rejects(
      () => ensureJava({
        feature: 21, runtimesDir: dir, platform: 'linux', arch: 'x64', envJavaHome: null,
        run: never, fetchImpl: async () => ({ ok: false, status: 500 }),
      }),
      /HTTP 500/,
    );
    await assert.rejects(
      () => ensureJava({
        feature: 21, runtimesDir: dir, platform: 'linux', arch: 'x64', envJavaHome: null,
        fetchImpl: async () => ({ ok: true, status: 200, body: new Blob(['x']).stream() }),
        run: async ({ command, onLine }) => {
          if (command === 'tar') return { code: 2 };
          onLine('nope'); return { code: 1 };
        },
      }),
      /tar exit 2/,
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});
