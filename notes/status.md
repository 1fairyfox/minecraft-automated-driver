# Status — Minecraft Automated Driver

**Updated:** 2026-07-22 · **Version:** 0.1.2 · **Phase:** 0 (scaffold + gates) — complete, released (v0.1.2 on `main`)

## What this is

An MCP server putting the whole Minecraft dev loop (build/test, server + client
lifecycle, screenshots, protocol bots, semantic in-game control via Kotlin agents)
behind one tool surface. **Founding plan: `plans/roadmap-2026-07.md` — read it first.**

## Current state

- Repo scaffolded on the mesh standards, seeded from the sibling **despawned-items**
  node (whose local standard modifications are ahead of the hub — see the provenance
  note in `CLAUDE.md` and `fairyfox-reports/2026-07-22-onboarding-scaffold.md`).
- Working MCP skeleton: `npm start` serves stdio, one tool (`driver_status`).
  **Quality gates live:** 7 tests across three layers (unit / in-memory protocol /
  spawned-stdio e2e), c8 gate ≥90% on all four metrics wired into `npm test`
  (currently 100%), CI + CodeQL + Scorecard workflows (SHA-pinned, least-privilege),
  `main` branch-protected, private vulnerability reporting on.
- Key decisions recorded in `decisions/architecture.md` (JS-not-TS host, MC 1.21.11
  target, instance+attach dual mode, loopback+token security, GitHub-only distribution).

## Honest gaps (mesh completeness — this node is *partial*)

| Dimension | State |
|-----------|-------|
| Working tree / versioning / branch model / notes system / CLAUDE.md mesh block | done |
| GitHub repo | done — `1fairyfox/minecraft-automated-driver`, `dev`/`main` + tags pushed |
| **Hub registration** (registry.yml, projects.yml — hub-side commits) | **missing** — owner doing the hub paperwork (incl. renaming the group to "Minecraft Plugins") |
| **Themed docs site** at fairyfox.io/minecraft-automated-driver/ | **missing** — planned Phase 7 |
| CI / CodeQL / Scorecard workflows | done — live since 0.1.2 (owner mandate pulled them forward from Phase 7) |
| Scorecard **score** | awaiting first scheduled/main-push scan; all solo levers pulled. Owner step for full marks: `gh secret set SCORECARD_TOKEN` (fine-grained PAT, Administration:read) so Branch-Protection can score |
| Adoption manifest verify passes | see `reference/adoption-manifest.md` — supply-chain + testing rows upgraded 0.1.2 |

## Next

1. Owner: hub registration (repo now exists) + the "Minecraft Plugins" group rename.
2. Phase 1 (MCP core + OS layer) per the roadmap — job model, instance registry,
   window discovery + OS screenshots.
3. Docs site + CI ride Phase 7 unless the owner wants them earlier.
