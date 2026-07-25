// Semantic convenience verbs (notes/plans/semantic-verbs-2026-07.md).
//
// One verb → the whole multi-step UI/menu/world/settings sequence. The intelligence lives
// here, MCP-side, planned over an executor's ADVERTISED capabilities — never a hard-coded
// backend — the same anti-hack contract as the goal engine. A verb composes the agent's
// documented primitives (docs/control-protocol.md §Fabric): `screen` (named widget tree),
// `click`/`type`/`key` (by name), `close` (Escape), `position` (arrival/exit signal). It runs
// against ANY executor advertising the needed capabilities, not just the Fabric client.
//
// Button labels are overridable inputs with English defaults, so i18n / version label drift is
// a call-site override, never a code change. Every seam (sleep, wait bounds) is injectable, so
// the whole module is unit-testable against fake executors — no live client needed.

/** Default English UI labels; every verb takes a `labels` override so nothing here is magic. */
export const DEFAULT_LABELS = {
  multiplayer: 'Multiplayer',
  direct: 'Direct Connection',
  join: 'Join Server',
  singleplayer: 'Singleplayer',
  createWorld: 'Create New World',
  playSelected: 'Play Selected World',
  gameMode: 'Game Mode',
  options: 'Options',
  done: 'Done',
  quit: 'Save and Quit to Title',
};

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Throw unless the executor advertises every capability the verb needs. */
function requireCaps(executor, caps, verb) {
  const missing = caps.filter((c) => !executor.has(c));
  if (missing.length) {
    throw new Error(`target ${executor.id ?? '?'} cannot ${verb}: missing capability ${missing.join(', ')}`);
  }
}

/** Invoke `screen` and normalise the tree into `{screen, widgets:[{label,type,…}]}`. */
export async function readScreen(executor) {
  const res = await executor.invoke('screen');
  const raw = res?.tree ?? res;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {});
  return { screen: parsed.screen ?? null, widgets: Array.isArray(parsed.widgets) ? parsed.widgets : [] };
}

/**
 * Resolve a widget by label the way the agent's own click does: an exact match wins; else a
 * UNIQUE case-insensitive substring match; ambiguity throws (never guess); absence returns null.
 */
export function findWidget(screen, label, { fuzzy = true } = {}) {
  const widgets = screen.widgets ?? [];
  const exact = widgets.filter((w) => (w.label ?? '') === label);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error(`ambiguous widget '${label}' (${exact.length} exact matches)`);
  if (!fuzzy) return null;
  const needle = label.toLowerCase();
  const subs = widgets.filter((w) => (w.label ?? '').toLowerCase().includes(needle));
  if (subs.length === 1) return subs[0];
  if (subs.length > 1) {
    throw new Error(`ambiguous widget '${label}' (${subs.length} matches: ${subs.map((w) => w.label).join(', ')})`);
  }
  return null;
}

/** True when a widget matching `label` is on the screen (ambiguous ⇒ present). */
function hasWidget(screen, label) {
  try {
    return findWidget(screen, label) !== null;
  } catch {
    return true; // multiple matches → it is present, just not uniquely
  }
}

/** Poll `produce()` until `predicate` holds or `tries` exhaust. `sleep` injected for tests. */
export async function waitFor(produce, predicate, { tries = 20, delayMs = 250, sleep = realSleep } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await produce();
    if (predicate(last)) return last;
    if (i < tries - 1) await sleep(delayMs);
  }
  const err = new Error('condition not met in time');
  err.last = last;
  throw err;
}

/** Wait for a labelled widget to appear, then click it by name (the agent resolves it). */
async function clickWhenPresent(executor, label, waitOpts) {
  await waitFor(() => readScreen(executor), (s) => hasWidget(s, label), waitOpts);
  return executor.invoke('click', { name: label });
}

/**
 * Navigate the menu tree by clicking a sequence of button labels, waiting for each to appear.
 * The universal "open / close / traverse menus by name" primitive; `expect` optionally waits
 * for a landmark widget to confirm arrival. Returns what was clicked + the final screen.
 */
export async function menuNavigate(executor, { path, expect } = {}, opts = {}) {
  requireCaps(executor, ['screen', 'click'], 'navigate menus');
  if (!Array.isArray(path) || path.length === 0) {
    throw new Error('menuNavigate needs a non-empty path of button labels');
  }
  const waitOpts = opts.wait ?? {};
  const clicked = [];
  for (const label of path) {
    await clickWhenPresent(executor, label, waitOpts);
    clicked.push(label);
  }
  let screen = await readScreen(executor);
  if (expect) screen = await waitFor(() => readScreen(executor), (s) => hasWidget(s, expect), waitOpts);
  return { clicked, screen: screen.screen, widgets: screen.widgets.map((w) => w.label) };
}

/** The value part of a "Label: Value" cycler button (or the whole label when there's no ':'). */
function controlValue(label) {
  const idx = label.lastIndexOf(':');
  return (idx >= 0 ? label.slice(idx + 1) : label).trim();
}

/**
 * Click a toggle/cycler control (resolved by the stable `control` substring, since its value —
 * and thus full label — changes each click) until its value matches `desired`, bounded by
 * `maxClicks`. Numeric targets are sliders — a clean missing-capability boundary, not glue.
 */
export async function cycleControlTo(executor, control, desired, { maxClicks = 8 } = {}) {
  if (typeof desired === 'number') {
    throw new Error(`control '${control}' target ${desired} is numeric — sliders need the agent slider op (0.13.0); this verb sets toggle/cycler controls by label`);
  }
  const want = String(desired).toLowerCase();
  let last = null;
  for (let i = 0; i <= maxClicks; i++) {
    const s = await readScreen(executor);
    const w = findWidget(s, control);
    if (!w) throw new Error(`no control '${control}' on screen ${s.screen}`);
    last = w.label;
    const have = controlValue(w.label).toLowerCase();
    if (have === want || have.includes(want)) return { control: w.label, clicks: i };
    if (i === maxClicks) break;
    await executor.invoke('click', { name: control });
  }
  throw new Error(`could not set '${control}' to '${desired}' within ${maxClicks} clicks (last: ${last})`);
}

/**
 * Connect to a server by address: Multiplayer → Direct Connection → type the address →
 * Join Server, then wait until the player is actually in the world. One call, many steps.
 */
export async function serverConnect(executor, { address, labels = {} } = {}, opts = {}) {
  requireCaps(executor, ['screen', 'click', 'type', 'position'], 'connect to a server');
  if (!address) throw new Error('serverConnect needs an address');
  const L = { ...DEFAULT_LABELS, ...labels };
  await menuNavigate(executor, { path: [L.multiplayer, L.direct] }, opts);
  await executor.invoke('type', { text: address, ...(labels.addressField ? { name: labels.addressField } : {}) });
  await clickWhenPresent(executor, L.join, opts.wait ?? {});
  const position = await waitFor(
    () => executor.invoke('position'), (p) => p?.inWorld === true,
    { tries: 40, delayMs: 500, ...(opts.arriveWait ?? {}) },
  );
  return { connected: true, address, position };
}

/**
 * Create a fresh singleplayer world and enter it: Singleplayer → Create New World → type the
 * name → (optionally) cycle the game mode → Create New World, then wait until in-world.
 */
export async function worldCreate(executor, { name, gameMode, labels = {} } = {}, opts = {}) {
  requireCaps(executor, ['screen', 'click', 'type', 'position'], 'create a world');
  if (!name) throw new Error('worldCreate needs a world name');
  const L = { ...DEFAULT_LABELS, ...labels };
  await menuNavigate(executor, { path: [L.singleplayer, L.createWorld] }, opts);
  await executor.invoke('type', { text: name, ...(labels.nameField ? { name: labels.nameField } : {}) });
  if (gameMode) await cycleControlTo(executor, L.gameMode, gameMode, opts.cycle ?? {});
  await clickWhenPresent(executor, L.createWorld, opts.wait ?? {});
  const position = await waitFor(
    () => executor.invoke('position'), (p) => p?.inWorld === true,
    { tries: 60, delayMs: 500, ...(opts.arriveWait ?? {}) },
  );
  return { created: true, name, gameMode: gameMode ?? null, position };
}

/**
 * Enter an EXISTING world by name. A world-list entry is not a plain labelled button, so this
 * needs the agent's `world_select` capability (which resolves the entry by name and enters it).
 * The world list loads asynchronously, so we retry `world_select` until it matches, then wait
 * for the world. Without the capability, a clear error points to worldCreate (create + enter).
 */
export async function worldEnter(executor, { name, labels = {} } = {}, opts = {}) {
  requireCaps(executor, ['screen', 'click', 'position'], 'enter a world');
  if (!name) throw new Error('worldEnter needs a world name');
  const L = { ...DEFAULT_LABELS, ...labels };
  await menuNavigate(executor, { path: [L.singleplayer] }, opts);
  if (!executor.has('world_select')) {
    throw new Error("entering a saved world by name needs the agent 'world_select' capability (list entries aren't plain buttons) — use worldCreate to make + enter a fresh world");
  }
  await waitFor(
    () => executor.invoke('world_select', { name }), (r) => r?.selected === true,
    { tries: 20, delayMs: 250, ...(opts.wait ?? {}) },
  );
  const position = await waitFor(
    () => executor.invoke('position'), (p) => p?.inWorld === true,
    { tries: 60, delayMs: 500, ...(opts.arriveWait ?? {}) },
  );
  return { entered: true, name, position };
}

/**
 * Leave the current world: Escape to the pause menu → Save and Quit to Title, then wait until
 * no longer in-world. In vanilla singleplayer that button always saves; `save` records intent
 * and picks the label (override `labels.quit` for multiplayer's "Disconnect").
 */
export async function worldLeave(executor, { labels = {}, save = true } = {}, opts = {}) {
  requireCaps(executor, ['screen', 'click', 'close', 'position'], 'leave a world');
  const L = { ...DEFAULT_LABELS, ...labels };
  const pos = await executor.invoke('position');
  if (pos?.inWorld !== true) throw new Error('target is not in a world');
  await executor.invoke('close'); // Escape → pause menu
  await clickWhenPresent(executor, L.quit, opts.wait ?? {});
  const position = await waitFor(
    () => executor.invoke('position'), (p) => p?.inWorld === false,
    { tries: 40, delayMs: 500, ...(opts.arriveWait ?? {}) },
  );
  return { left: true, saved: save, position };
}

/**
 * Change a setting: open Options → traverse sub-screens by `path` → set a control by label →
 * optionally click Done. Toggle/cycler controls (booleans → ON/OFF, strings cycle) are driven by
 * clicking the label. A NUMERIC value is a slider: dispatched to the executor's `slider`
 * capability when advertised, else refused with a clear pointer — the same forward-dispatch as
 * worldEnter/world_select, so the verb is complete the moment the agent grows the op.
 */
export async function settingsSet(executor, { path = [], control, value, labels = {}, back = false } = {}, opts = {}) {
  requireCaps(executor, ['screen', 'click'], 'change settings');
  if (!control) throw new Error('settingsSet needs a control label');
  if (value === undefined) throw new Error('settingsSet needs a value');
  const numeric = typeof value === 'number';
  if (numeric && !executor.has('slider')) {
    throw new Error(`settingsSet drives toggle/cycler controls by label; '${control}'=${value} is numeric — a slider needs the agent 'slider' capability (arrives with the Fabric slider op)`);
  }
  const L = { ...DEFAULT_LABELS, ...labels };
  await menuNavigate(executor, { path: [L.options, ...path] }, opts);
  let result;
  if (numeric) {
    const r = await executor.invoke('slider', { name: control, value });
    result = { control: r?.control ?? control, value: r?.value ?? value };
  } else {
    const desired = typeof value === 'boolean' ? (value ? 'ON' : 'OFF') : value;
    result = await cycleControlTo(executor, control, desired, opts.cycle ?? {});
  }
  if (back) await clickWhenPresent(executor, L.done, opts.wait ?? {});
  return { set: control, to: value, ...result };
}
