// Multi-target scenario orchestration (notes/plans/goal-level-autonomy-2026-07.md §3
// "Scenario orchestration (multi-target)").
//
// A scenario PROVISIONS several targets at once (a Paper server, spawned Fabric client(s), N
// Mineflayer bots), runs a coordinated sequence of STEPS across them, and GUARANTEES teardown
// in reverse order — even when a provision or a step throws, and even when a teardown itself
// throws (errors are collected and cleanup continues). "Server-and-client-and-bot testing at
// the same time" becomes a first-class object with a lifecycle + cleanup, not a hand-wired
// server_start + client_spawn + bot_join per call.
//
// The engine is PURE orchestration: PROVISIONERS (keyed by actor kind) and ACTIONS (keyed by
// step verb) are injected, so it never hard-codes a backend and is fully unit-testable against
// fakes — the same capability-contract, anti-hack discipline as goals.mjs / flows.mjs. The
// concrete provisioners/actions (over the real server/bot/client/agent managers) are wired in
// src/index.mjs; nothing target-specific lives here.

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A friendly one-line message from any thrown value (Errors and non-Errors alike). */
function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Validate a scenario spec against the available provisioners/actions BEFORE anything is
 * provisioned, so a structural mistake (empty/duplicate actors, unknown kind or action, a step
 * referencing a non-existent actor) fails fast with nothing to tear down. Returns the actors +
 * steps arrays; throws on the first problem.
 */
export function validateScenario(spec, { provisioners = {}, actions = {} } = {}) {
  if (!spec || typeof spec !== 'object') throw new Error('scenario spec must be an object');
  const actors = spec.actors;
  if (!Array.isArray(actors) || actors.length === 0) {
    throw new Error('scenario needs a non-empty actors array');
  }
  const ids = new Set();
  for (const actor of actors) {
    if (!actor?.id) throw new Error('every actor needs an id');
    if (ids.has(actor.id)) throw new Error(`duplicate actor id '${actor.id}'`);
    ids.add(actor.id);
    if (!actor.kind || !provisioners[actor.kind]) {
      const known = Object.keys(provisioners).join(', ') || 'none';
      throw new Error(`actor '${actor.id}' has unknown kind '${actor.kind ?? ''}' (known kinds: ${known})`);
    }
  }
  const steps = spec.steps ?? [];
  if (!Array.isArray(steps)) throw new Error('scenario steps must be an array');
  steps.forEach((step, i) => {
    if (!step?.action || !actions[step.action]) {
      const known = Object.keys(actions).join(', ') || 'none';
      throw new Error(`step ${i} has unknown action '${step?.action ?? ''}' (known actions: ${known})`);
    }
    if (step.actor !== undefined && !ids.has(step.actor)) {
      throw new Error(`step ${i} references unknown actor '${step.actor}'`);
    }
  });
  return { actors, steps };
}

/**
 * Run a scenario. Does NOT throw for a provision/step failure — it records the failure,
 * short-circuits the rest (no steps run if provisioning failed; no further steps run after one
 * fails), and ALWAYS tears down what it provisioned (reverse order, collecting teardown errors).
 * Returns a full report: { name, ok, provisioned[], steps[], teardown[] }.
 *
 * A provisioner is `async (actorSpec, ctx) => ({ info?, teardown? })` — `info` is a
 * JSON-serialisable handle (may carry `targetId` when the resource is a controllable executor);
 * `teardown` is an idempotent cleanup. An action is `async (stepSpec, ctx) => result`. `ctx`
 * gives actions `{ handles, sleep, actor(id), targetId(id) }` to resolve provisioned handles.
 */
export async function runScenario(spec, { provisioners = {}, actions = {}, sleep = realSleep } = {}) {
  const { actors, steps } = validateScenario(spec, { provisioners, actions });
  const name = spec.name ?? 'scenario';
  const handles = new Map(); // actorId → { id, kind, ...info }
  const cleanups = []; // { id, teardown } — torn down last-in-first-out
  const provisioned = [];
  const stepResults = [];
  let failed = false;

  // Steps only run once every actor provisioned, and validateScenario guarantees a step's
  // `actor` names a declared actor — so `handles` always holds it here (no re-guarding needed).
  const ctx = {
    handles,
    sleep,
    actor: (id) => handles.get(id),
    targetId: (id) => {
      const info = handles.get(id);
      if (!info?.targetId) throw new Error(`actor '${id}' is not a controllable target`);
      return info.targetId;
    },
  };

  // 1. Provision the actors in declared order. A failure stops provisioning (and thus the steps),
  //    but whatever succeeded before it is still torn down below.
  for (const actor of actors) {
    try {
      const { info = {}, teardown } = (await provisioners[actor.kind](actor, ctx)) ?? {};
      handles.set(actor.id, { id: actor.id, kind: actor.kind, ...info });
      if (typeof teardown === 'function') cleanups.push({ id: actor.id, teardown });
      provisioned.push({ id: actor.id, kind: actor.kind, ok: true, info });
    } catch (err) {
      provisioned.push({ id: actor.id, kind: actor.kind, ok: false, error: messageOf(err) });
      failed = true;
      break;
    }
  }

  // 2. Run the coordinated steps — only if every actor provisioned. A failing step stops the rest.
  if (!failed) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      try {
        const result = await actions[step.action](step, ctx);
        stepResults.push({ index: i, action: step.action, ok: true, result: result ?? null });
      } catch (err) {
        stepResults.push({ index: i, action: step.action, ok: false, error: messageOf(err) });
        failed = true;
        break;
      }
    }
  }

  // 3. Teardown — ALWAYS, reverse order. One teardown throwing must not strand the others, so
  //    errors are collected and cleanup continues.
  const teardown = [];
  for (let i = cleanups.length - 1; i >= 0; i--) {
    const { id, teardown: fn } = cleanups[i];
    try {
      await fn();
      teardown.push({ id, ok: true });
    } catch (err) {
      teardown.push({ id, ok: false, error: messageOf(err) });
    }
  }

  const ok = !failed && teardown.every((t) => t.ok);
  return { name, ok, provisioned, steps: stepResults, teardown };
}
