# Adoption Manifest

Per-standard adoption state for this node. Rule (see CLAUDE.md → Checklists Are
Contracts): a standard copied into `reference/` is **`copied-only`** until its Verify
table has a recorded item-by-item pass — only that counts as `adopted`.

Seeded 2026-07-22 from the sibling despawned-items node's standard set (which is ahead
of the hub — divergences get flagged on the first fairyfox check-for-updates run).

**2026-08-02 — first fairyfox check against hub 1.6.2** (`b87b4d4`): adopted 8 missing
standards + refreshed 7 behind-hub standards; deferred 10 divergent standards for
deliberate hand-merge. Full account: `../fairyfox-reports/2026-08-02-adopting-updates.md`.
Newly `copied-only` standards below inherit that state until their Verify tables get a
recorded item-by-item pass.

| Standard | State | Notes |
|----------|-------|-------|
| notes-system | **adopted** | Full tree created + seeded this session; Verify: structure ✓ status.md real ✓ session log ✓ changelog ✓ |
| ai-context (CLAUDE.md) | **adopted** | Written fresh incl. mesh-awareness block (verified present) |
| versioning | **adopted** | VERSION=0.1.0 (greenfield), SemVer, bump-with-commit rule in CLAUDE.md |
| git-workflow | **partial** | dev/main model initialized locally; no remote, no branch protection yet (needs GitHub repo) |
| agent-tooling | **adopted** | PowerShell+file-tools rule carried into CLAUDE.md |
| planning | **adopted** | roadmap + next-steps/future written before code |
| process-reports | **adopted** | First report written (2026-07-22 onboarding-scaffold) |
| cross-project-sync / adopting-updates | **copied-only** | Flow documented; no sync run yet from this node |
| engineering-quality / testing | **adopted** (0.1.2, extended 0.4.0) | Node: c8 gate ≥90% (all 4 metrics), all layers. JVM agent (0.4.0): Kover ≥90 line gate in `check`, MockBukkit layer. Verify: gate-fails-below-90 ✓ layers ✓ no-skips ✓ no-TODO ✓ |
| supply-chain-hardening | **adopted** (0.1.2) | Lockfile ✓ dependabot ✓ CI ✓ CodeQL ✓ Scorecard workflow ✓ SHA-pinned actions ✓ top-level contents:read ✓ branch protection ✓ private vuln reporting ✓. Gap: SCORECARD_TOKEN secret = owner step |
| repo-hygiene | **adopted** | .gitignore/.gitattributes/.editorconfig in place; no dead config committed |
| dependencies | **copied-only** | |
| deployment | **copied-only** | GitHub-only stance decided; release workflow is Phase 7 |
| docs-lifecycle / self-hosted-assets / badges / coins / compliance / maintenance-sweep / research-capture / working-rhythm | **copied-only** | Docs site + badges are Phase 7. coins refreshed to hub 1.6.2 (2026-08-02) |
| checklists-are-contracts | **copied-only** | Adopted 2026-08-02 (hub 1.6.2). Concept already lived in CLAUDE.md as a standing instruction |
| mandate-ledger | **copied-only** | Adopted 2026-08-02. Concept already in CLAUDE.md ("Owner Mandates Become Ledgers") |
| ci-secrets | **copied-only** | Adopted 2026-08-02. Node already has CODECOV/SONAR/SCORECARD secrets set (owner, 2026-07-23) |
| legal-docs | **copied-only** | Adopted 2026-08-02. Legal pages themselves await the docs-site legal zone (owner-side) |
| docker | **copied-only** | Adopted 2026-08-02. Reference only; no Docker build wired yet |
| farm-operating-model | **N/A** | Adopted doc 2026-08-02 for matrix completeness; this node is a dev tool, **not a farm** |
| new-project-setup / onboarding-existing-project | **copied-only** | Adopted 2026-08-02 (lifecycle runbooks; node already onboarded) |
| **Divergent — deferred (2026-08-02)** | **behind-hub, reconcile pending** | adopting-updates, badges, compliance, cross-project-sync, deployment, planning, process-reports, repo-hygiene, self-hosted-assets, supply-chain-hardening carry sibling-ahead/path-adapted lines — need per-file hand-merge, not overwrite. `readme` standard deferred (Windows `readme.md`/`README.md` collision) |
