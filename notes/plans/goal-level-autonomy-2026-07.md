# Plan — goal-level autonomy (2026-07-24, revised)

**Directives (owner, verbatim, ledger Escalation 11 + 12):**
1. *"include A path navigation with moving, jumping, allow giving requests to 'chop down a
   tree' or 'hunt down zombies' and have it be able to use weapons and tools and A-path
   navigation"*
2. *"Or give it a recipe to do and have it make the recipe, or ask it to build/make and/or
   place something, would be nice not to have to spell everything out command by command for
   tiny steps"*
3. *"shouldnt some of the stuff like high level goals or navigation be on the MCP side to be
   able to universally handle any client or plugin or server rather than just a particular
   target and shoukdnt it be able to handle server and client testing at the same time if
   needed … i dont want it to be fragile or hacky or have any low quality hacks/code"*

**Reading:** raise the ceiling from primitive commands to **goal-level intents**, but put the
intelligence in the **MCP orchestrator** so it works against *any* target (bot, client agent,
server agent) via advertised capabilities — never hard-wired to one backend — and can drive
**multiple targets together** (a server + a client + bots) in one coordinated scenario.
Explicitly: no fragile glue, no target-specific hacks; clean interfaces, tested at every layer.

## Architecture — orchestration is MCP-side and backend-agnostic

Three layers, cleanly separated:

1. **Capability model (the contract).** Every backend already advertises a `capabilities`
   list on connect (Paper: `state`/`exec`; Fabric client: `screen`/`click`/`move`/`look`/
   `position`/`slots`/…; Mineflayer bot: movement/chat/inventory). Formalise this into a
   small typed capability registry the MCP owns: each connected target (server agent, client
   agent, bot) is an **executor** with a declared capability set + a uniform `invoke(cap,
   args)` surface. The orchestrator queries capabilities; it never assumes a target type.
2. **Goal engine (the intelligence, universal).** Goals — `navigate(to)`, `gather(what,
   count)`, `hunt(mob)`, `craft(item,count)`, `build(spec)` — are planned MCP-side into the
   capabilities the chosen executor advertises:
   - If an executor exposes a **native high-level capability** (e.g. a Mineflayer bot's
     pathfinder, PvP, collect-block), the goal delegates to it — reusing mature, proven code.
   - If it only exposes **primitives** (e.g. the Fabric client's `move`/`look`/`position` +
     a world snapshot), the goal engine composes them — including a shared MCP-side **A\***
     that plans over a backend-provided world/nav snapshot, so navigation is universal rather
     than a Mineflayer-only trick.
   The same goal thus runs against a bot OR the user's real client under test, whichever the
   scenario points at. Planning is a pure, unit-testable function (world snapshot + goal →
   step list); execution dispatches steps to the executor.
3. **Scenario orchestration (multi-target).** A `scenario` provisions and coordinates several
   targets at once — e.g. boot a Paper server, spawn a client that joins it, attach N bots —
   runs a coordinated test across them, collects results, and guarantees teardown. Replaces
   hand-wiring `server_start` + `client_spawn` + `bot_join` per call. Server-and-client (and
   bot) testing "at the same time" is a first-class object with lifecycle + cleanup.

The L2 Mineflayer lane and the L3 agents remain **executors** under this; none of the goal
logic lives inside a single backend. Mineflayer is the *first* executor to wire up (its
ecosystem — pathfinder/pvp/collectblock/tool — makes it the fastest path to a working goal),
but it is one implementation of the capability contract, not the home of the goals.

## Phases (each: build → tests at every layer → real smoke → release; gate ≥90 held)

- **0.10.0 — the capability + executor abstraction.** Define the executor interface and
  capability registry MCP-side; make the existing Mineflayer bot and the agent connections
  implement it (adapters, no behaviour change to the underlying ops). Unit tests for the
  registry + planning scaffold. No new user-facing behaviour yet beyond a `targets_list`
  view — this is the seam everything else hangs off, built first so nothing later is a hack.
- **0.11.0 — navigation goal (universal).** Goal `navigate` with a pure A\* planner over a
  world-snapshot capability; the Mineflayer executor satisfies it via `mineflayer-pathfinder`
  natively, and the composition path is proven against the client-agent primitives. Tool
  `goal_navigate`. Real smoke: boot a server, navigate a bot to a target; assert arrival.
- **0.12.0 — scenario orchestration.** `scenario_run` — provision server + client + bot(s)
  together, coordinate a cross-target check, tear down. Real smoke exercises a real server +
  a real bot in one scenario.
- **0.13.0 — gather + combat goals.** `gather`/`chop`, `hunt`/`attack`, tool/weapon equip —
  delegating to Mineflayer's collectblock/pvp/tool where present, composed from primitives
  otherwise. Real smoke: chop a log, attack a mob.
- **0.14.0 — craft + build goals.** `craft` (recipe by name/count, table-aware), `build`/
  `place`. Real smoke: craft an item, place/build a small structure, verify the world changed.

## Guardrails (unchanged, and reinforced by this directive)

- **No hacks / no fragility:** the capability contract is the anti-hack device — goals talk to
  advertised capabilities, never to a hard-coded target. Anything that can't be done cleanly
  through a capability is a missing capability to add, not glue to paper over.
- Same security model: stdio-only MCP, loopback-only control plane, agents disabled by default,
  `online-mode=false` for local test servers only.
- Coverage gate ≥90 on `src/` at every step; every feature ships WITH tests at every testable
  layer (pure planner unit tests → real smoke) and a CI job for the smoke.
- Validate library/API assumptions before burning CI (the client-agent discipline).
