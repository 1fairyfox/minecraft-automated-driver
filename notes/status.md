# Status — Minecraft Automated Driver

**Updated:** 2026-07-22 · **Version:** 0.1.1 · **Phase:** 0 (scaffold) — complete, released (v0.1.1 on `main`)

## What this is

An MCP server putting the whole Minecraft dev loop (build/test, server + client
lifecycle, screenshots, protocol bots, semantic in-game control via Kotlin agents)
behind one tool surface. **Founding plan: `plans/roadmap-2026-07.md` — read it first.**

## Current state

- Repo scaffolded on the mesh standards, seeded from the sibling **despawned-items**
  node (whose local standard modifications are ahead of the hub — see the provenance
  note in `CLAUDE.md` and `fairyfox-reports/2026-07-22-onboarding-scaffold.md`).
- Working MCP skeleton: `npm start` serves stdio, one tool (`driver_status`),
  `npm test` green (1 test).
- Key decisions recorded in `decisions/architecture.md` (JS-not-TS host, MC 1.21.11
  target, instance+attach dual mode, loopback+token security, GitHub-only distribution).

## Honest gaps (mesh completeness — this node is *partial*)

| Dimension | State |
|-----------|-------|
| Working tree / versioning / branch model / notes system / CLAUDE.md mesh block | done |
| GitHub repo | done — `1fairyfox/minecraft-automated-driver`, `dev`/`main` + tags pushed |
| **Hub registration** (registry.yml, projects.yml — hub-side commits) | **missing** — owner doing the hub paperwork (incl. renaming the group to "Minecraft Plugins") |
| **Themed docs site** at fairyfox.io/minecraft-automated-driver/ | **missing** — planned Phase 7 |
| CI workflows | **missing** — planned Phase 7 (skeleton deliberately not committed; no dead config) |
| Adoption manifest verify passes | `copied-only` for most standards — see `reference/adoption-manifest.md` |

## Next

1. Owner: hub registration (repo now exists) + the "Minecraft Plugins" group rename.
2. Phase 1 (MCP core + OS layer) per the roadmap — job model, instance registry,
   window discovery + OS screenshots.
3. Docs site + CI ride Phase 7 unless the owner wants them earlier.
