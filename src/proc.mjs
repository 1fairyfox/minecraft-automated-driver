// Child-process runner for jobs: line-streamed output, abort-signal kill, and an
// onSpawn hook so callers (the Paper server manager) can keep the child handle
// for stdin control.
import { spawn } from 'node:child_process';

/**
 * Run a process to completion.
 * @returns {Promise<{code: number|null}>} resolves on exit (any code); rejects only
 *   on spawn failure. Callers judge the exit code.
 */
export function runProcess({
  command, args = [], cwd, env,
  signal, onLine = () => {}, onSpawn = () => {},
  spawnImpl = spawn,
}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    onSpawn(child);

    let killed = false;
    const kill = () => {
      killed = true;
      child.kill();
    };
    if (signal) {
      if (signal.aborted) kill();
      else signal.addEventListener('abort', kill, { once: true });
    }

    const buffers = { out: '', err: '' };
    const feed = (key, tag) => (chunk) => {
      buffers[key] += chunk;
      let idx;
      while ((idx = buffers[key].indexOf('\n')) !== -1) {
        onLine(buffers[key].slice(0, idx).replace(/\r$/, ''), tag);
        buffers[key] = buffers[key].slice(idx + 1);
      }
    };
    child.stdout.on('data', feed('out', 'out'));
    child.stderr.on('data', feed('err', 'err'));

    child.on('error', (err) => reject(new Error(`could not start ${command}: ${err.message}`)));
    child.on('close', (code) => {
      for (const [key, tag] of [['out', 'out'], ['err', 'err']]) {
        if (buffers[key] !== '') onLine(buffers[key].replace(/\r$/, ''), tag);
      }
      if (signal) signal.removeEventListener('abort', kill);
      if (killed) reject(new Error(`${command} killed by abort signal`));
      else resolve({ code });
    });
  });
}
