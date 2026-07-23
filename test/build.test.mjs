// Unit layer: the gradle driver (fake process runner; real gradle is the local
// sibling-build smoke, outside the unit suite by design).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobRegistry } from '../src/jobs.mjs';
import { findBuiltJars, gradleCommand, startGradleJob } from '../src/build.mjs';

async function gradleProject({ jars = [] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gradle-proj-'));
  await writeFile(join(dir, 'gradlew'), '#!/bin/sh\n');
  await writeFile(join(dir, 'gradlew.bat'), '@echo off\n');
  if (jars.length) {
    await mkdir(join(dir, 'build', 'libs'), { recursive: true });
    for (const jar of jars) await writeFile(join(dir, 'build', 'libs', jar), 'jar');
  }
  return dir;
}

test('gradleCommand picks the right wrapper per platform', () => {
  assert.deepEqual(gradleCommand('/p', ['build'], { platform: 'win32' }),
    { command: 'cmd.exe', args: ['/c', 'gradlew.bat', 'build'], cwd: '/p' });
  assert.deepEqual(gradleCommand('/p', ['clean', 'test'], { platform: 'linux' }),
    { command: 'sh', args: ['gradlew', 'clean', 'test'], cwd: '/p' });
});

test('findBuiltJars lists jars and tolerates absent build dirs', async () => {
  const dir = await gradleProject({ jars: ['a.jar', 'b.jar'] });
  try {
    const jars = await findBuiltJars(dir);
    assert.equal(jars.length, 2);
    assert.deepEqual(await findBuiltJars(join(dir, 'nope')), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a successful build succeeds with outcome + jars', async () => {
  const dir = await gradleProject({ jars: ['thing-1.0.0.jar'] });
  try {
    const jobs = createJobRegistry();
    const snap = startGradleJob({
      jobs, projectDir: dir, tasks: ['build'],
      run: async ({ onLine }) => { onLine('> Task :build'); onLine('BUILD SUCCESSFUL in 2s'); return { code: 0 }; },
    });
    const done = await jobs.wait(snap.id);
    assert.equal(done.status, 'succeeded');
    assert.equal(done.result.outcome, 'SUCCESS');
    assert.equal(done.result.jars.length, 1);
    assert.deepEqual(jobs.log(snap.id).lines, ['> Task :build', 'BUILD SUCCESSFUL in 2s']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a failing build fails the job with the outcome in the error', async () => {
  const dir = await gradleProject();
  try {
    const jobs = createJobRegistry();
    const snap = startGradleJob({
      jobs, projectDir: dir,
      run: async ({ onLine }) => { onLine('BUILD FAILED in 1s'); return { code: 1 }; },
    });
    const done = await jobs.wait(snap.id);
    assert.equal(done.status, 'failed');
    assert.match(done.error, /gradle exited 1 \(FAILED\)/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a zero exit without the banner still counts as success; nonzero without banner fails', async () => {
  const dir = await gradleProject();
  try {
    const jobs = createJobRegistry();
    const ok = startGradleJob({ jobs, projectDir: dir, run: async () => ({ code: 0 }) });
    assert.equal((await jobs.wait(ok.id)).result.outcome, 'SUCCESS');
    const bad = startGradleJob({ jobs, projectDir: dir, run: async () => ({ code: 3 }) });
    assert.match((await jobs.wait(bad.id)).error, /exited 3 \(FAILED\)/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a dir without a wrapper fails fast', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'not-gradle-'));
  try {
    const jobs = createJobRegistry();
    const snap = startGradleJob({ jobs, projectDir: dir, run: async () => ({ code: 0 }) });
    const done = await jobs.wait(snap.id);
    assert.equal(done.status, 'failed');
    assert.match(done.error, /no gradle wrapper/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
