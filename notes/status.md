# Status — Minecraft Automated Driver

**Updated:** 2026-07-23 · **Version:** 0.3.0 · **Phase:** 2 (L1 build/test) — complete, released (v0.3.0 on `main`)

## What this is

An MCP server putting the whole Minecraft dev loop (build/test, server + client
lifecycle, screenshots, protocol bots, semantic in-game control via Kotlin agents)
behind one tool surface. **Founding plan: `plans/roadmap-2026-07.md` — read it first.**

## Current state

- Repo scaffolded on the mesh standards, seeded from the sibling **despawned-items**
  node (whose local standard modifications are ahead of the hub — see the provenance
  note in `CLAUDE.md` and `fairyfox-reports/2026-07-22-onboarding-scaffold.md`).
- **Phase 2 / L1 is live**: `build_gradle` + the job model (`jobs_list`/`job_status`/
  `job_log`/`job_kill`), `server_provision` (Paper auto-download, offline loopback
  config, plugin deploy), `server_start`/`server_exec`/`server_stop`/`servers_list`
  with auto-provisioned Java (Temurin via Adoptium when the host lacks 21+). Exit
  criteria proven for real: the driver gradle-built the sibling plugin, booted Paper
  1.21.11 with it, saw it enable cleanly, drove the console, stopped it. CI adds a
  real ubuntu server-smoke (forced JRE auto-download).
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

1. **Phase 3** per the roadmap — the control-plane protocol spec
   (`docs/control-protocol.md`) + the Paper agent plugin (Kotlin, MockBukkit-tested,
   gated enable, loopback+token).
2. Owner: finish hub registration flags (docs site is live) + the "Minecraft
   Plugins" group rename + sibling rename.
3. Watch: `os_screenshot` "printwindow" vs GL surfaces — verify against a real
   Minecraft window in Phase 5; server_provision port collisions if servers run
   concurrently (single-port default today).
