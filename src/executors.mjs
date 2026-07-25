// The backend-agnostic capability layer (notes/plans/goal-level-autonomy-2026-07.md).
//
// Every controllable target — a Mineflayer bot, a Fabric client agent, a Paper server agent —
// is exposed as an EXECUTOR: an id, a kind, an advertised capability set, and a single
// uniform `invoke(capability, args)` surface. The orchestrator plans goals over *advertised
// capabilities* and dispatches through `invoke`, so it never hard-codes a target type. The
// capability contract is the anti-hack device: anything a target can't do cleanly is a
// missing capability to add, never glue to paper over.

/** Wrap an in-game agent connection (Fabric client / Paper server) as an executor. */
export function agentExecutor({ id, kind, connection }) {
  if (!id) throw new Error('agentExecutor needs an id');
  if (kind !== 'client' && kind !== 'server') throw new Error(`agent kind must be client|server, got ${kind}`);
  if (!connection || typeof connection.request !== 'function') {
    throw new Error('agentExecutor needs a connection with request()');
  }
  const capabilities = new Set(connection.welcome?.capabilities ?? []);
  return {
    id,
    kind,
    capabilities,
    has: (cap) => capabilities.has(cap),
    async invoke(cap, args = {}) {
      if (!capabilities.has(cap)) {
        throw new Error(`target ${id} (${kind}) has no capability '${cap}'`);
      }
      return connection.request(cap, args);
    },
    describe: () => ({ id, kind, capabilities: [...capabilities] }),
  };
}

// The Mineflayer bot's registry methods, mapped to canonical capability names + argument
// shapes. This is the one place bot-specific method names live; everything above the executor
// speaks capabilities. `navigate` (real A* pathfinding) is added when 0.11.0 lands.
function botCapabilityMap(registry, id) {
  return {
    status: () => registry.status(id),
    chat: ({ message } = {}) => registry.chat(id, message),
    messages: (args = {}) => registry.messages(id, args),
    inventory: () => registry.inventory(id),
    move: ({ x, y, z, timeoutMs } = {}) => registry.moveTo(id, { x, y, z, timeoutMs }),
    // Native A* pathfinding (mineflayer-pathfinder) — the goal engine prefers this.
    navigate: ({ x, y, z, range, timeoutMs } = {}) => registry.navigate(id, { x, y, z, range, timeoutMs }),
    // Native gather/hunt (mineflayer-collectblock / mineflayer-pvp) + equip — the goal engine delegates.
    gather: ({ block, count, maxDistance, timeoutMs } = {}) => registry.gather(id, { block, count, maxDistance, timeoutMs }),
    hunt: ({ mob, count, weapon, maxDistance, timeoutMs } = {}) => registry.hunt(id, { mob, count, weapon, maxDistance, timeoutMs }),
    equip: ({ item, destination } = {}) => registry.equip(id, { item, destination }),
    // Native craft/place/build (core Mineflayer recipesFor/craft/placeBlock).
    craft: ({ item, count } = {}) => registry.craft(id, { item, count }),
    place: ({ block, x, y, z } = {}) => registry.place(id, { block, x, y, z }),
    build: ({ blocks } = {}) => registry.build(id, { blocks }),
  };
}

/** Wrap a Mineflayer bot (by registry id) as an executor with canonical capabilities. */
export function botExecutor({ id, registry }) {
  if (!id) throw new Error('botExecutor needs an id');
  if (!registry || typeof registry.status !== 'function') {
    throw new Error('botExecutor needs the bot registry');
  }
  const ops = botCapabilityMap(registry, id);
  const capabilities = new Set(Object.keys(ops));
  return {
    id,
    kind: 'bot',
    capabilities,
    has: (cap) => capabilities.has(cap),
    async invoke(cap, args = {}) {
      const fn = ops[cap];
      if (!fn) throw new Error(`target ${id} (bot) has no capability '${cap}'`);
      return fn(args);
    },
    describe: () => ({ id, kind: 'bot', capabilities: [...capabilities] }),
  };
}

/**
 * The registry of live executors the orchestrator can address. Ids are unique across kinds
 * (bots are `b*`, agents `a*`), so one flat namespace is safe. `withCapability` is how a goal
 * finds targets that can satisfy it.
 */
export function createTargetRegistry() {
  const targets = new Map();
  return {
    add(executor) {
      if (!executor?.id) throw new Error('cannot register a target without an id');
      targets.set(executor.id, executor);
      return executor;
    },
    get(id) {
      const t = targets.get(id);
      if (!t) throw new Error(`no target ${id}`);
      return t;
    },
    has: (id) => targets.has(id),
    remove: (id) => targets.delete(id),
    list: () => [...targets.values()].map((t) => t.describe()),
    withCapability: (cap) => [...targets.values()].filter((t) => t.has(cap)),
  };
}
