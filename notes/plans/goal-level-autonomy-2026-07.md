# Plan — goal-level autonomy (2026-07-24)

**Directive (owner, verbatim, ledger Escalation 11):**
1. *"include A path navigation with moving, jumping, allow giving requests to 'chop down a
   tree' or 'hunt down zombies' and have it be able to use weapons and tools and A-path
   navigation"*
2. *"Or give it a recipe to do and have it make the recipe, or ask it to build/make and/or
   place something, would be nice not to have to spell everything out command by command for
   tiny steps"*

**Reading:** raise the ceiling from primitive commands ("press key.forward for 400ms") to
**goal-level intents** ("chop a tree", "hunt zombies", "craft 4 sticks", "place a block"),
where the driver decomposes the goal into steps itself.

## Where it lives — the L2 Mineflayer lane (`src/bot.mjs`)

Mineflayer already carries a mature, battle-tested ecosystem for exactly this. Reinventing
A\* + combat + gathering inside the Java client agent would be strictly worse and far more
code to keep correct. The L3 Fabric client agent stays the *semantic UI + player-input*
surface (0.9.0); goal-level autonomy is L2.

| Capability | Library | Tool(s) |
|------------|---------|---------|
| A\* navigation (walk, jump, parkour, safe) | `mineflayer-pathfinder` | `bot_goto` (to x/y/z or nearest block type) |
| Chop / gather blocks (auto-equips the right tool) | `mineflayer-collectblock` (+ `mineflayer-tool`) | `bot_collect` / `bot_chop` |
| Hunt / combat with a weapon | `mineflayer-pvp` (+ tool for weapon equip) | `bot_hunt` (by mob type) / `bot_attack` (nearest/entity) |
| Craft a recipe (uses a table when needed) | core `bot.craft` + `bot.recipesFor` | `bot_craft` (item name + count) |
| Build / place blocks | core `bot.placeBlock` / `bot.equip` | `bot_place` (a block at/against a position), `bot_build` (a small spec of placements) |
| Equip a tool/weapon/armor by intent | `mineflayer-tool` + core `bot.equip` | `bot_equip` (best tool for a block, or a named item) |

## Phases (each: build → tests at every layer → real smoke on a booted server → release)

- **0.10.0 — Navigation.** `mineflayer-pathfinder` integrated; `bot_goto` (coordinates or
  nearest block-by-name, with movement config allowing jump/parkour). Unit-tested against a
  fake bot; **real smoke**: boot an offline Paper server, join, pathfind to a target, assert
  arrival. Pin the plugin versions the sibling uses where applicable.
- **0.11.0 — Gather + combat.** `bot_collect`/`bot_chop` (collectblock + tool auto-equip),
  `bot_hunt`/`bot_attack` (pvp + weapon equip), `bot_equip`. Real smoke on a server with a
  placed tree / spawned mob (or a superflat + given items): chop a log, attack a mob.
- **0.12.0 — Craft + build.** `bot_craft` (recipe by name/count, crafting-table aware),
  `bot_place`/`bot_build`. Real smoke: give materials, craft an item, place/build a small
  structure, verify the world changed.

## Guardrails (unchanged)

- Same security model: stdio-only MCP, loopback-only control plane, agents disabled by
  default. The bots connect as normal Minecraft clients to a server the user runs.
- `online-mode=false` is for local test servers only — never scripted for anything public.
- Coverage gate ≥90 on `src/` held at every step; every feature ships WITH tests at every
  testable layer (unit → real smoke) and a CI job for the smoke.
- Validate library/API assumptions before burning CI, same discipline as the client agent.
