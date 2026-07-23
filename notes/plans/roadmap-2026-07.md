# Roadmap — Minecraft Automated Driver (2026-07)

The founding plan. One MCP server that puts **every moving part of Minecraft plugin/mod
development and live testing behind a single tool surface Claude can drive**: building,
testing, launching, attaching, screenshotting, and deep semantic control of live clients
and servers — with a security posture that never exposes anything off-machine.

Target line: **Minecraft 1.21.x (built against 1.21.11), Java 21** — same rationale as the
sibling despawned-items project (largest install base; Mineflayer/`node-minecraft-protocol`
top out at 1.21.11; MockBukkit supports it; Paper forward-compat loads on 26.x). Revisit
when the 26.x tooling catches up.

## The layer model

```
Claude ──stdio──► MCP server (Node/JS, root of this repo)
                    │
     ┌──────────────┼──────────────────┬─────────────────────┐
     ▼              ▼                  ▼                     ▼
 L0 OS/host     L1 Build/test      L2 Protocol bots     L3 In-game agents (Kotlin/JVM)
 window find,   gradle clean/      Mineflayer joins,    Paper agent plugin (server-side)
 OS screenshot, build/test, Paper  moves, chats,        Fabric client agent mod
 spawn/kill,    provision+boot,    inventories — no     — semantic UI + state + input
 crash watch    log streaming      render needed        over a localhost control plane
```

Three ways to drive a client, complementary, all behind the same MCP tools:

| Lane | What it is | When |
|------|-----------|------|
| **Agent mod** (L3) | Kotlin Fabric mod inside a real rendering client; semantic control (widgets by name, keybindings, movement, in-process screenshots, reflection state) | The main lane — live interactive testing |
| **Protocol bot** (L2) | Mineflayer — a headless protocol-level player | Cheap load/behaviour checks, CI smoke (already proven in the sibling repo) |
| **OS level** (L0) | Window discovery + `PrintWindow` screenshots + process open/close | Works on ANY client, vanilla included, no mod required — the "at least connect on a basic OS level" floor |

Two ways a real client comes under control:

| Mode | How | Auth |
|------|-----|------|
| **Instance** | Driver spawns a Gradle/Loom dev client (`runClient` / production run task) with the agent mod and `-Dfairyfox.driver.enable=true`; auto direct-connects to a local `online-mode=false` Paper server | None needed — dev session, no launcher, no MS account |
| **Attach** | Owner's own launcher-installed client has the agent mod installed but **dormant**; a title-screen button ("Automated Testing…") with a confirmation dialog enables the localhost control channel until game close | Owner's normal login, untouched by us |

## Security model (non-negotiable, phase-independent)

- **MCP transport is stdio only.** The MCP server never listens on any socket.
- **Control plane (driver ⇄ agents) is loopback-only**: WebSocket bound to `127.0.0.1`,
  ephemeral port, discovered via a handshake file in the game/run dir; agents hard-reject
  non-loopback binds and connections.
- **Per-session token**: 256-bit random, generated at spawn (passed by flag/env) or at
  attach-enable (written to the handshake file, user-readable only). No token, no channel.
- **Agents ship disabled-by-default.** No flag + no config + no button ⇒ the agent
  registers nothing, listens on nothing, is inert. Self-disable is the *natural* mechanism
  per platform (Fabric: no-op init unless gated in; Paper: `onEnable` checks gate and
  calls `setEnabled(false)`), not a hack.
- **The client is never trusted, and neither is the agent**: the reflection/write gateway
  is allowlist-scoped and off unless explicitly opened per session.
- **Distribution: GitHub releases only.** No Modrinth/Hangar/CurseForge listings — this is
  a development tool, not a product; keeping it off marketplaces keeps the audience and
  the attack surface right.
- Supply chain: pinned deps + lockfiles, SHA-pinned actions, Scorecard ≥ 7.0 floor,
  CodeQL, provenance attestations — same bar as the sibling repo.

## Phases

### Phase 0 — Scaffold & standards (this session)
Repo skeleton, mesh standards carried over from the sibling node, notes system seeded,
this roadmap, minimal-but-real MCP server that answers `driver_status`. Exit: `npm start`
serves MCP over stdio; `node scripts/check-links.mjs` green; committed on `dev`.

### Phase 1 — MCP core + OS/host layer (L0) — DONE (0.2.0)
- Tool registry, config (`driver.config.json`), structured errors, instance registry
  (everything the driver knows it spawned or attached to).
  *(Amended 2026-07-23: the **job model** moved to Phase 2 — its first real consumers
  are the long build/server operations there, and the no-dead-code principle outranks
  the original sketch; see `decisions/architecture.md`.)*
- Windows host helpers (PowerShell/Win32 via child process): enumerate Minecraft windows
  (any client, modded or vanilla), per-window screenshots (`PrintWindow`, works on
  background windows), process open/close, crash detection.
- MCP tools: `instances_list/open/close`, `os_screenshot`, `jobs_*`.
- Exit: with a vanilla client running, Claude can list it, screenshot it, and close it.

### Phase 2 — Build/test orchestration (L1) — DONE (0.3.0)
- **Job model** for long operations (start → job id → poll/log/kill) — lands here with
  its first consumers (moved from Phase 1, amendment 2026-07-23).
- Gradle driver: clean/build/test against any configured project checkout (starting with
  the sibling plugin), parsed results, logs as MCP resources.
- Paper provisioning: download by version (fill.papermc.io), create isolated run dirs
  (`run/`, git-ignored), `online-mode=false`, boot/stop/restart, readiness detection,
  plugin-jar deployment, console command execution, log tail.
- MCP tools: `build_run`, `test_run`, `server_provision/start/stop/exec/logs`.
- Exit: Claude can build the sibling plugin, boot a Paper server with it, and see it enable.

### Phase 3 — Control-plane protocol + Paper agent (L3 server side) — DONE (0.4.0)
- **Protocol spec first** (`docs/control-protocol.md`): JSON messages over loopback WS —
  hello/auth, capability discovery, request/response + event streams. One spec, both agents.
- Paper agent plugin (Kotlin, MockBukkit-tested): gated enable; state queries (TPS,
  entities, chunks, players, inventories), command execution as console/player, world
  manipulation, event taps (subscribe to despawns, joins, …).
- MCP tools: `paper_state`, `paper_exec`, `paper_events`, `paper_world_*`.
- Exit: live Paper server answers state queries and streams events into Claude's context.

### Phase 4 — Fabric client agent (L3 client side) — the crown jewel
- Gated enable: launch flag (instanced) **and** the title-screen button + confirmation
  (attach), per the gating design above.
- **Semantic UI driving**: introspect the current screen into a named widget tree
  (screen class, widget labels/ids/bounds); click/press/toggle **by name**, never pixels;
  keybinding invocation by binding id; text entry; screen navigation (title → multiplayer
  → direct connect by address).
- Player control: move/look/jump/sneak/use/attack via input injection; position and
  camera queries; teleport (via server when permitted).
- In-process screenshots (framebuffer grab — clean, exact, works regardless of window
  occlusion) alongside the L0 OS path.
- Prior art to reuse deliberately: the **Fabric client gametest API** (official) already
  does input simulation, screenshots, singleplayer/dedicated-server contexts — the agent
  mod is its *interactive daemon* counterpart and borrows its techniques.
- Exit: Claude can drive a client from title screen into a server, walk somewhere, open a
  chest, and screenshot it — all by name, zero pixel coordinates.

### Phase 5 — Client lifecycle automation
- Instanced spawns: Loom `runClient` / production-run tasks from the driver, agent enabled
  by flag, auto direct-connect; full spawn→drive→kill loop.
- Attach handshake: discover an enabled agent's handshake file, connect, take control.
- Mineflayer lane (L2) as first-class tools: `bot_join/move/chat/inventory` (port the
  sibling's `ingame-smoke.mjs` know-how).
- Exit: `client_spawn` → connected, driven, screenshotted, killed — one Claude conversation.

### Phase 6 — Deep state access (the reflection gateway)
- Read side: query arbitrary game state by path (registries, entity fields, client
  internals) through a reflection/mixin gateway — Java reflection is the right tool here.
- Write side: **allowlisted, off by default, opened per session** — explicit
  capability grant over the control plane.
- Exit: Claude can inspect (and, when opened, poke) live memory/game variables on both
  client and server without a rebuild.

### Phase 7 — CI, release, docs, registration
- GitHub Actions: build all modules, unit + MockBukkit + Fabric client gametests (Loom
  production run + XVFB on Linux runners), scorecard, CodeQL, release workflow with
  provenance — GitHub releases only.
- Themed docs site at `fairyfox.io/minecraft-automated-driver/`; hub registration
  (hub-side commit) — closing the honest gaps recorded in `status.md`.
- Exit: mesh completeness audit rows 1–7 all `done`.

### Phase 8 — Extended targets
- NeoForge client/server agents (same protocol, new loader glue), vanilla clients stay
  OS-level-only (documented floor), Folia-compatible Paper agent, 26.x line adoption when
  Mineflayer/MockBukkit support lands. Each target = same control-protocol spec.

## Key risks & mitigations

| Risk | Mitigation |
|------|-----------|
| MCP JS SDK v2 lands 2026-07-28 (spec day) | Build on stable v1 (1.29.x) now; migration is a bounded refactor, noted in `plans/future.md` |
| Mojang UI internals shift per MC version | Semantic layer isolates mappings behind one introspection module; gametest API tracks upstream |
| Input injection vs GLFW event model | Borrow the client gametest API's input approach (proven upstream) rather than raw GLFW pokes |
| Reflection gateway = foot-gun | Allowlist + read-only default + per-session write grant + loopback+token only |
| Attach mode misuse fear ("security holes to my name") | Dormant by default, explicit user gesture + confirmation, dies with the process, loopback+token, GitHub-only distribution, SECURITY.md states the whole model |

## Success criteria (ultimate goal restated)

Claude, through one MCP server: cleans, builds, tests any target; boots servers; spawns
or attaches to clients of the known kinds (agent-modded or bare-OS-level); drives menus
and gameplay by *naming things*; reads (and with explicit grant, writes) live game state;
screenshots everything; and never opens a port beyond loopback.
