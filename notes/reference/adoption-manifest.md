# Adoption Manifest

Per-standard adoption state for this node. Rule (see CLAUDE.md → Checklists Are
Contracts): a standard copied into `reference/` is **`copied-only`** until its Verify
table has a recorded item-by-item pass — only that counts as `adopted`.

Seeded 2026-07-22 from the sibling despawned-items node's standard set (which is ahead
of the hub — divergences get flagged on the first fairyfox check-for-updates run).

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
| engineering-quality / testing | **partial** | Bar written into CLAUDE.md; c8 gate not yet wired (Phase 1) |
| supply-chain-hardening | **partial** | Lockfile committed, dependabot configured; no CI/scorecard/CodeQL yet (Phase 7) |
| repo-hygiene | **adopted** | .gitignore/.gitattributes/.editorconfig in place; no dead config committed |
| dependencies | **copied-only** | |
| deployment | **copied-only** | GitHub-only stance decided; release workflow is Phase 7 |
| docs-lifecycle / self-hosted-assets / badges / coins / compliance / maintenance-sweep / research-capture / working-rhythm | **copied-only** | Docs site + badges are Phase 7 |
