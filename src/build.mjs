// L1 Gradle driver — run wrapper tasks against any project checkout as a job.
import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runProcess } from './proc.mjs';

/** The wrapper invocation for the host platform. */
export function gradleCommand(projectDir, tasks, { platform = process.platform } = {}) {
  return platform === 'win32'
    ? { command: 'cmd.exe', args: ['/c', 'gradlew.bat', ...tasks], cwd: projectDir }
    : { command: 'sh', args: ['gradlew', ...tasks], cwd: projectDir };
}

/** Built jars, if the build produced any. */
export async function findBuiltJars(projectDir) {
  try {
    const dir = join(projectDir, 'build', 'libs');
    return (await readdir(dir)).filter((f) => f.endsWith('.jar')).map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Start a gradle job. Returns the job snapshot immediately; the job result is
 * { code, outcome, jars }.
 */
export function startGradleJob({
  jobs, projectDir, tasks = ['build'],
  platform = process.platform, run = runProcess,
}) {
  return jobs.start(`gradle ${tasks.join(' ')} @ ${projectDir}`, async ({ signal, log }) => {
    await access(join(projectDir, platform === 'win32' ? 'gradlew.bat' : 'gradlew'))
      .catch(() => { throw new Error(`${projectDir} has no gradle wrapper`); });
    let outcome = 'UNKNOWN';
    const { command, args, cwd } = gradleCommand(projectDir, tasks, { platform });
    const { code } = await run({
      command,
      args,
      cwd,
      signal,
      onLine: (line) => {
        if (line.includes('BUILD SUCCESSFUL')) outcome = 'SUCCESS';
        if (line.includes('BUILD FAILED')) outcome = 'FAILED';
        log(line);
      },
    });
    if (code !== 0 && outcome !== 'FAILED') outcome = 'FAILED';
    if (code === 0 && outcome === 'UNKNOWN') outcome = 'SUCCESS';
    const jars = await findBuiltJars(projectDir);
    if (outcome !== 'SUCCESS') throw new Error(`gradle exited ${code} (${outcome})`);
    return { code, outcome, jars };
  });
}
