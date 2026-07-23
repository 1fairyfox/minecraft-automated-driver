# Status — Minecraft Automated Driver

**Updated:** 2026-07-23 · **Version:** 0.2.0 · **Phase:** 1 (L0 OS layer) — complete, released (v0.2.0 on `main`)

## What this is

An MCP server putting the whole Minecraft dev loop (build/test, server + client
lifecycle, screenshots, protocol bots, semantic in-game control via Kotlin agents)
behind one tool surface. **Founding plan: `plans/roadmap-2026-07.md` — read it first.**

## Current state

- Repo scaffolded on the mesh standards, seeded from the sibling **despawned-items**
  node (whose local standard modifications are ahead of the hub — see the provenance
  note in `CLAUDE.md` and `fairyfox-reports/2026-07-22-onboarding-scaffold.md`).
- **Phase 1 / L0 is live**: `os_windows_list`, `os_screenshot` (PrintWindow +
  screen fallback, real image content), `instance_open`/`instance_close`/
  `instances_list` over an injectable PowerShell/Win32 backend. Exit criteria proven
  with a no-mocks smoke (spawn → enumerate → screenshot → close) locally and in a
  `windows-latest` CI job.
- **Quality gates:** 54 tests across all layers, c8 gate ≥90% on all four metrics
  (at ~100%), CI + CodeQL + Scorecard + Codecov + Sonar (SHA-pinned,
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

1. **Phase 2** per the roadmap — job model (first consumers), Gradle build/test
   driver, Paper server provisioning/boot/console/logs.
2. Owner: finish hub registration flags (docs site is live) + the "Minecraft
   Plugins" group rename + sibling rename.
3. Watch: `os_screenshot` "printwindow" vs GL surfaces — the "screen" fallback
   exists; verify against a real Minecraft window in Phase 5 and default per-target.
