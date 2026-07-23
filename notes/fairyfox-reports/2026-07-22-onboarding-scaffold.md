# Process report — 2026-07-22 — Greenfield scaffold (seeded from a sibling node)

**Procedure:** new-project setup, but deliberately unorthodox: standards were seeded
from the **despawned-items sibling node** rather than the hub, at the owner's explicit
direction — that node's local modifications are ahead of the hub and the owner chose
to carry them forward now and reconcile at the hub later.

## What was done

- Copied verbatim: `.editorconfig`, `.gitattributes`, `LICENSE`, generic scripts
  (`check-links.mjs`, `check-tidy.mjs`), `notes/reference/*` standards (excluding the
  sibling's project-specific MockBukkit lore and its adoption manifest), notes-system
  READMEs, dependabot skeleton.
- Written fresh for this project: CLAUDE.md (mesh-awareness block present — verified),
  README, SECURITY (new threat model), .gitignore, VERSION (0.1.0 greenfield),
  package.json + MCP skeleton + test, full notes seed, founding roadmap.
- Not done (honest gaps, in `status.md`): GitHub repo/push, hub registration
  (registry.yml + projects.yml — hub-side commits), themed docs site, CI workflows.

## What was rough / for the hub to consider

1. **No runbook covers "seed from a sibling node".** onboarding-existing-project.md
   and new-project-setup.md both assume the hub is the source. A short "sibling-seed"
   variant would help: what to copy verbatim, what must be rewritten (manifest, status,
   CLAUDE.md identity), and the requirement to flag divergence-from-hub in the first
   check-for-updates report.
2. **The sibling's standards are ahead of the hub.** Until upstreamed, every new node
   seeded this way widens the drift. Suggest the hub adopt the sibling's modified
   standards soon, or record the divergence in `hub/authorizations.yml`-adjacent form.
3. The adoption-manifest template would benefit from a `copied-only` seeding example —
   writing honest initial rows by hand was judgment-heavy.
