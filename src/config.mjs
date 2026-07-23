// Driver configuration — optional `driver.config.json` at the repo root, folded over
// defaults. Absent file = pure defaults; a present-but-broken file fails loudly
// (silently ignoring a config the user wrote is worse than an error).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const DEFAULTS = Object.freeze({
  // Where os_screenshot writes PNGs. Kept out of the repo tree by default.
  screenshotDir: join(tmpdir(), 'minecraft-automated-driver', 'screenshots'),
});

export async function loadConfig(root) {
  let raw;
  try {
    raw = await readFile(join(root, 'driver.config.json'), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULTS };
    throw new Error(`driver.config.json is unreadable: ${err.message}`);
  }
  try {
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (err) {
    throw new Error(`driver.config.json is not valid JSON: ${err.message}`);
  }
}
