# Status — Minecraft Automated Driver

**Updated:** 2026-07-25 · **Version:** 0.15.0 · **Phase:** goal-level autonomy — capability seam (0.10.0) + navigation (0.11.0) + convenience verbs (0.12.0) + world_list/world_select (0.13.0) + slider/typed-option ops (0.14.0) + multi-target scenarios (0.15.0) shipped; next: gather/combat goals, then craft/build

## What this is

An MCP server putting the whole Minecraft dev loop (build/test, server + client
lifecycle, screenshots, protocol bots, semantic in-game control via Kotlin agents)
behind one tool surface. **Founding plan: `plans/roadmap-2026-07.md` — read it first.**

## Current state

- Repo scaffolded on the mesh standards, seeded from the sibling **despawned-items**
  node (whose local standard modifications are ahead of the hub — see the provenance
  note in `CLAUDE.md` and `fairyfox-reports/2026-07-22-onboarding-scaffold.md`).
- **Phase 5 instanced client spawn is live** (v0.7.0): the driver boots a real Fabric
  client with the agent enabled — no launcher, no account — via the Loom
  `runProductionClient` task, and owns its lifecycle. `src/client.mjs` +
  `client_spawn`/`clients_list`/`client_kill`: spawn runs the task as a job, waits for the
  agent's real loopback handshake in the run dir (returns a `connectDir` for
  `agent_connect kind:"fabric"`), fails fast if the client dies first; kill aborts the job
  → kills the process tree. Unit-tested (run + fs faked) + protocol tests, c8 gate held;
  **real CI smoke** `client-spawn-smoke` (XVFB): driver spawns → handshake → connect →
  introspect title screen → click "Options" by name → wrong-token refused → kill.
- **Phase 5 / L2 Mineflayer lane is live**: `src/bot.mjs` + `bot_join`/`bot_status`/
  `bot_chat`/`bot_messages`/`bot_move`/`bot_inventory`/`bots_list`/`bot_quit`. Unit-tested
  against a fake bot; **real smoke** (local + CI `bot-smoke`) boots offline Paper and
  joins with a real Mineflayer bot → state → chat → inventory → move → quit.
- **Phase 4 / L3 Fabric client agent is live**: `agents/fabric/` (Java + Loom) — the
  title-screen "Automated Testing…" opt-in + flag gating, loopback+token control plane,
  semantic **screen introspection + click/key by name**, and (0.8.0) an **in-process
  framebuffer screenshot** (`agent_screenshot` → base64 PNG off the GPU). Driver tools
  `agent_screen`/`agent_click`/`agent_key`/`agent_screenshot`; `agent_connect` handles both
  handshake layouts. Pure logic JUnit + JaCoCo ≥90 (now honest — measured uncached); a
  **real headless client gametest** (XVFB, on PRs into main) boots a rendering client and
  drives it over loopback (title screen → click by name → real PNG screenshot → wrong-token
  refused), timeout-capped. **Still deferred to 0.9.0** (the rest of the Phase-4 exit):
  in-world movement/look/position, text entry, container-slot driving. CodeQL now truly
  analyzes the Fabric Java agent (was scanning only Paper).
- **Phase 4 in-world driving is live (0.9.0)**: agent ops `position`/`look`/`move`/`type`/
  `slots`/`close` (+ `key` now edge-triggers so inventory/chat open by intent); driver tools
  `agent_position`/`agent_move`/`agent_look`/`agent_type`/`agent_slots`/`agent_close_screen`.
  The client gametest now creates a real singleplayer world and drives it: position in-world,
  walk (asserting the player actually moved), aim, type into chat, open the inventory and read
  its slots, screenshot. **Phase 4 exit met in full.**
- **Goal-level autonomy — the capability seam is live (0.10.0)**: `src/executors.mjs` wraps
  every bot/agent as an executor (advertised capabilities + a uniform `invoke`); a target
  registry finds executors *by capability*; `targets_list` shows them all. This is the
  **MCP-side, backend-agnostic** foundation the owner directed (Esc. 12) — goals plan over
  capabilities, never a hard-coded backend.
- **Universal navigation goal is live (0.11.0)**: `src/pathfind.mjs` (pure A\*), `src/goals.mjs`
  (goal engine: native-or-planned), native bot pathfinding (mineflayer-pathfinder), the
  `goal_navigate` tool, and a real `nav-smoke` (goal engine → executor → pathfinder → live
  server). `goal_navigate` works for any target advertising `navigate`, or `world_snapshot`+
  position+look+move — the planned/A\* path awaits a real `world_snapshot` provider (a later
  executor capability; already unit-tested).
- **Semantic convenience verbs are live (0.12.0)**: `src/flows.mjs` — an MCP-side flow engine
  (sibling to `goals.mjs`) composing the client agent's `screen`/`click`/`type`/`key`/`close`/
  `position` primitives into few-word intents: `ui_menu_navigate`, `ui_server_connect`,
  `ui_world_create`, `ui_world_enter`, `ui_world_leave`, `ui_settings_set`. Backend-agnostic
  (plans over advertised capabilities), unit-tested against fake widget trees + a protocol test
  over the in-memory MCP client. Owner mandate 2026-07-24; plan `plans/semantic-verbs-2026-07.md`.
- **World enter-by-name is live (0.13.0)**: Fabric agent ops `world_list` + `world_select`
  (public 1.21.11 API — `WorldEntry.getLevelDisplayName()`/`play()`, verified via `javap`, locally
  compiled), wiring `ui_world_enter` (retries `world_select` while the async list loads, then the
  op enters directly). Numeric `ui_settings_set` now forward-dispatches to a `slider` capability.
  Client gametest gains a third phase (Singleplayer → `world_list` → refuse-unknown `world_select`).
- **Sliders + typed option values are live (0.14.0)**: first agent **mixins** (`SliderWidgetAccessor`
  `@Invoker(setValue)`/`@Accessor(value)`; `OptionSliderWidgetImplAccessor` `@Accessor(option)`), a
  `slider` op (raw 0..1 fraction on any slider + TYPED per-option value via `SimpleOption.setValue`),
  `ui_settings_set` numeric → typed set, new `ui_slider` raw tool, `flows.sliderRaw`. Real gametest
  drives the OptionsScreen FOV slider (fraction + typed 90). The client-control API now covers every
  option kind — no residual gap.
- **Multi-target scenarios are live (0.15.0)**: `src/scenario.mjs` — a PURE, backend-agnostic
  orchestration engine (`runScenario`) that provisions server + client(s) + bot(s) together, runs
  coordinated cross-target steps, and GUARANTEES reverse-order teardown (even on a provision/step/
  teardown failure — errors collected, cleanup continues). Provisioners (by actor kind) + actions
  (by step verb) are injected; the `scenario_run` tool wires them over the live managers and runs as
  a job (report = `{ok, provisioned, steps, teardown}`). Real `scenario-smoke` (+ CI job): one
  `scenario_run` boots a REAL Paper server + REAL Mineflayer bot together, coordinates them, tears
  both down — driven through the actual MCP tool, no mocks. Owner Esc. 12 ("server + client testing
  at the same time … no fragile glue") satisfied MCP-side.
- **Next — gather/combat goals** (`plans/goal-level-autonomy-2026-07.md`): `gather`/`chop`,
  `hunt`/`attack`, tool/weapon equip — delegating to Mineflayer's collectblock/pvp/tool where
  present, composed from primitives otherwise; then `craft` + `build`/`place`.
- **Phase 3 / L3 Paper agent live** since 0.4.0: control-protocol spec + Kotlin Paper
  agent (state/exec/events), disabled-by-default, real e2e smoke.
- **Phase 2 / L1 live** since 0.3.0: gradle driver, job model, Paper provision/boot/
  console, auto-provisioned Java.
- **Phase 1 / L0 live** since 0.2.0: window list/screenshot (PrintWindow + screen
  fallback), instance open/close, windows-latest CI smoke.
- **Quality gates:** 80 tests across all layers, c8 gate ≥90% on all four metrics
  (99%+ lines), CI + CodeQL + Scorecard + Codecov + Sonar (SHA-pinned,
  least-privilege), `main` branch-protected, private vulnerability reporting on.
- Key decisions recorded in `decisions/architecture.md` (JS-not-TS host, MC 1.21.11
  target, instance+attach dual mode, loopback+token security, GitHub-only distribution).

## Honest gaps (mesh completeness — this node is *partial*)

| Dimension | State |
|-----------|-------|
| Working tree / versioning / branch model / notes system / CLAUDE.md mesh block | done |
| GitHub repo | done — `1fairyfox/minecraft-automated-driver`, `dev`/`main` + tags pushed |
| **Hub registration** (registry.yml, projects.yml — hub-side commits) | **partial** — owner registered it 2026-07-22; docs-library entry/flags await the live site (owner) |
| Themed docs site at fairyfox.io/minecraft-automated-driver/ | done — live since 0.1.3, visually verified; no /api/ zone yet (no generator exists — added when one does) |
| CI / CodeQL / Scorecard workflows | done — live since 0.1.2 (owner mandate pulled them forward from Phase 7) |
| Scorecard **score** | **6.9** (2026-07-23, published) — 0.1 under the 7.0 floor, entirely time-gated: Maintained scores 0 for repos <90 days old, Code-Review 0 is solo-structural. Every actionable lever is at max (Pinned-Deps 10, Token-Perms 10, SAST 10, Dangerous-Workflow 10, Vulns 10, CI-Tests 10, Security-Policy 10, License 10, Dep-Update 10). Recovers past 7.0 as the repo ages; Signed-Releases starts scoring when the Phase-7 release workflow ships artifacts+provenance |
| Repo secrets + integrations | done (2026-07-23) — CODECOV_TOKEN/SONAR_TOKEN/SCORECARD_TOKEN set by owner; Codecov upload accepted, SonarCloud ANALYSIS SUCCESSFUL (dashboard live), Scorecard publishing with Branch-Protection readable |
| Adoption manifest verify passes | see `reference/adoption-manifest.md` — supply-chain + testing rows upgraded 0.1.2 |

## Next

1. **Phase 6** per the roadmap — the reflection gateway: read arbitrary live game state
   by path through a reflection/mixin gateway (reads session-gated), writes allowlisted +
   opened per session. Plus the deferred Phase-5 tail: driver-orchestrated instanced
   `client_spawn` (Loom production client) + the attach-handshake flow end to end.
2. Owner: finish hub registration flags (docs site is live) + the "Minecraft
   Plugins" group rename + sibling rename.
3. Watch / deferred honestly:
   - Fabric client-agent **in-process framebuffer screenshot** op — Phase-5 follow-up.
   - Fabric agent Java **not yet in CodeQL** (paper Kotlin + JS are) — add when warm.
   - Player move/look and teleport ops beyond keybindings — Phase 5/6.
   - single-port `server_provision`; `os_screenshot` vs GL surfaces; the reflection
     gateway's read/write grants (Phase 6, flagged in `docs/control-protocol.md`).
