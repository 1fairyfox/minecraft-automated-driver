# Status — Minecraft Automated Driver

**Updated:** 2026-07-23 · **Version:** 0.4.0 · **Phase:** 3 (L3 server agent) — complete, released (v0.4.0 on `main`)

## What this is

An MCP server putting the whole Minecraft dev loop (build/test, server + client
lifecycle, screenshots, protocol bots, semantic in-game control via Kotlin agents)
behind one tool surface. **Founding plan: `plans/roadmap-2026-07.md` — read it first.**

## Current state

- Repo scaffolded on the mesh standards, seeded from the sibling **despawned-items**
  node (whose local standard modifications are ahead of the hub — see the provenance
  note in `CLAUDE.md` and `fairyfox-reports/2026-07-22-onboarding-scaffold.md`).
- **Phase 3 / L3 server agent is live**: `docs/control-protocol.md` (NDJSON over
  loopback TCP, token-gated) + the Kotlin **Paper agent** (`agents/paper/`) —
  disabled-by-default, self-disabling without the flag/config, 256-bit per-session
  token, handshake-file discovery, main-thread-marshalled state/exec, join/quit
  events. Driver tools: `agent_connect`/`agent_state`/`agent_exec`/`agent_events`/
  `agent_disconnect`. **Full real smoke passed** (driver builds agent → boots Paper
  enabled → connects loopback → live state → console command through agent → wrong
  token refused → stop), local + CI.
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

1. **Phase 4** per the roadmap — the Fabric client agent (semantic UI driving by
   name, player control, in-process screenshots, the title-screen opt-in for attach
   mode). Same control-protocol spec, new loader.
2. Owner: finish hub registration flags (docs site is live) + the "Minecraft
   Plugins" group rename + sibling rename.
3. Watch: single-port `server_provision` default (concurrent servers collide);
   `os_screenshot` vs GL surfaces (verify a real MC window in Phase 5); the
   reflection gateway (Phase 6) must land its read/write session grants — flagged in
   `docs/control-protocol.md`.
