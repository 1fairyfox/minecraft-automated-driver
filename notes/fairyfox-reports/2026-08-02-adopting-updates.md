---
date: 2026-08-02
procedure: adopting-updates
node: minecraft-automated-driver
outcome: partial
hub_version: 1.6.2
hub_commit: b87b4d4
---

# Process Report — adopting-updates + compliance audit, 2026-08-02

> A full, honest account of running a fairyfox system procedure. The point is to
> improve the system — so say what was rough even if the run succeeded. Voice: direct,
> matter-of-fact, no hype. Standard: `hub/standards/process-reports.md`.

## Outcome in one line

This node's **first-ever** fairyfox check: adopted 8 missing standards + refreshed 7
behind-hub standards (all pre-authorized, zero-clobber); deliberately deferred 10
divergent standards that carry sibling-ahead content; full compliance gate green.

## What was done

**Trigger.** Owner asked to run fairyfox updates + a full compliance check "if you
haven't in the last ~5 days." Last fairyfox report was 2026-07-22 (11 days); last
session note 2026-07-25 (8 days) — both stale, so both ran.

**Refresh (runbook step 1).** The read-only hub mirror did not exist yet
(`assets/references/` held only its README). Clone-not-fetch:
`git clone --branch dev --single-branch https://github.com/1fairyfox/1fairyfox.github.io
fairyfox.io`. Hub landed at **VERSION 1.6.2**, HEAD `b87b4d4` (2026-08-02). Mirror stays
git-ignored; project history untouched.

**Anchor (step 2).** No prior `hub_version` anchor exists — this node was **seeded from
the despawned-items sibling on 2026-07-22, not from the hub** (see the provenance note in
CLAUDE.md), so this is the first reconciliation. Scoped "what changed" from the hub
changelog (`notes/version/2026-07.md`, `2026-08.md`): the only hub-authored standard in
the span was `readme` (README structure & cross-linking, 1.6.0, 2026-07-24); 1.6.1/1.6.2
were maintenance round-ups where the *siblings adopted* existing standards — nothing new
authored. So this node's gap is overwhelmingly **standards that already existed but the
sibling-seed excluded**, not fresh hub work.

**Divergence analysis.** Compared the node's 24 adopted standards against the hub's 35:
- 6 identical (ai-context, docs-lifecycle, maintenance-sweep, research-capture,
  versioning, working-rhythm) — no action.
- 7 cleanly behind, zero node-unique lines (agent-tooling, coins, dependencies,
  engineering-quality, git-workflow, notes-system, testing) — safe to refresh.
- 10 divergent, node carries unique lines (adopting-updates, badges, compliance,
  cross-project-sync, deployment, planning, process-reports, repo-hygiene,
  self-hosted-assets, supply-chain-hardening).
- 8 applicable standards fully missing (checklists-are-contracts, mandate-ledger,
  ci-secrets, legal-docs, docker, farm-operating-model, new-project-setup,
  onboarding-existing-project).

Inspecting the "only-in-node" lines showed they are **almost entirely path-adaptation
noise and diff-alignment artifacts** — e.g. `authorizations.yml` vs the hub's
`../authorizations.yml` — exactly the "intentional local adaptation dominates the diff"
the runbook warns of. A few are genuine sibling-ahead operational notes worth flagging
upstream (see Suggestions).

Confirmed `scripts/check-links.mjs` **deliberately skips `notes/reference/`** (its SKIP
list) because those are verbatim hub copies with dangling hub-relative links "by design."
So adopting standards there is link-gate-safe regardless of relative links.

**Adopted (pre-authorized by `adopt-standards-by-default`, zero-clobber):**
- Added 8 standards to `notes/reference/`: checklists-are-contracts, mandate-ledger,
  ci-secrets, legal-docs, docker, farm-operating-model, new-project-setup,
  onboarding-existing-project.
- Refreshed the 7 cleanly-behind standards to hub-verbatim (nothing node-unique lost).

**Deliberately deferred (report, don't autopilot):**
- The 10 divergent standards. Blind-overwrite would drop sibling-ahead content the owner
  chose to carry forward pending hub upstream (CLAUDE.md provenance note). These need a
  per-file hand-merge — the "reconcile deliberately" that note mandates.
- `readme` standard (1.6.0): **Windows filename collision** — the hub's `readme.md`
  cannot coexist with the node's existing `README.md` folder index on a case-insensitive
  filesystem. Needs a naming decision before adoption.
- `VERIFY-INDEX.md` + `build-verify-index.mjs`: hub tooling / a generated index over
  *hub* standards. Not adopted — the node runs its compliance audit from `compliance.md`
  directly.

**Compliance audit (full green gate + standards matrix):**
- Link gate: `check-links: 31 files OK`.
- Test gate: **193/193 pass**; c8 coverage **99.02% stmts / 91.56% branch / 96.56% funcs
  / 99.02% lines** — all four above the 90% gate. (status.md still said "80 tests"; the
  suite has grown to 193 — status.md is behind.)
- Versioning: VERSION 0.18.0 = latest tag v0.18.0. ✓
- git-workflow: `dev` contains `main`, `dev` == `origin/dev` (0/0). ✓
- Hygiene: SECURITY.md, .gitattributes, .github/dependabot.yml, CLAUDE.md, LICENSE all
  present; **no TODO/FIXME in `src/`** (no parked findings). ✓
- Known partials (unchanged, per status.md): Scorecard **6.9** (0.1 under floor, entirely
  time-gated — recovers as the repo ages past 90 days); hub-registration flags await the
  live site (owner-side). JVM agent gates (Kover/JaCoCo ≥90) unaffected — no agent code
  touched this run, so gradle builds were not re-run.

## What went well

- The link checker skipping `notes/reference/` removed all link-gate risk from standards
  adoption — clean by design.
- The `onlyHub`/`onlyNode` line-count sweep across all shared standards was a fast, cheap
  way to bucket 23 files into identical / cleanly-behind / divergent and target effort.
- Both express-authorizations are standing (`expires: null`); `adopt-standards-by-default`
  made the additive adoptions unambiguous.
- Node green gate passed first try on top of the adoption.

## What went wrong / friction

- **No anchor on a sibling-seeded node.** The runbook anchors "what changed" on the
  `hub_version` of the newest adopting-updates report, but a sibling-seeded node's first
  report (onboarding-scaffold) records no `hub_version`. Had to reconstruct the span from
  the hub changelog cold. This report now sets the anchor (1.6.2) for next time.
- **Divergence is genuinely ambiguous on a sibling-seed.** "Only-in-node" lines mix
  path-adaptation noise with real sibling-ahead improvements the owner wanted carried.
  Distinguishing them is per-line judgement — not automatable — so 10 standards had to be
  deferred rather than safely auto-adopted.
- **`readme.md` vs `README.md` case collision** is a real, unaddressed problem for any
  node that keeps its verbatim standards in the same directory as a `README.md` index on
  Windows. No runbook guidance covers it.
- The **adoption-manifest was stale** (still said VERSION 0.1.0, git-workflow "no remote")
  — it hadn't been maintained since ~0.1.x, so it was an unreliable picture of adoption
  state on arrival.

## Suggestions / feedback

1. **Sibling-seed variant of the runbook** (reiterating the 2026-07-22 report's ask):
   spell out that the first check has no `hub_version` anchor and must scope from the
   changelog, and that "only-in-node" lines need a keep/flag/merge triage rather than a
   blanket overwrite.
2. **Case-insensitive filename guidance for `readme.md`.** The README structure standard
   ships as `hub/standards/readme.md`; a node holding verbatim standards beside a
   `README.md` index can't adopt it as-is on Windows. Suggest the standard note a
   node-side target name (e.g. `readme-standard.md`) for this case.
3. **Candidate node→hub upstreams** (sibling-ahead content the hub's current versions
   lack), per the provenance mandate to flag divergences:
   - `supply-chain-hardening`: a PowerShell gotcha — `gh api --input -` (stdin) fails from
     PowerShell (UTF-16 stdin → JSON parse error); always use a UTF-8 file `--input
     <file>`. Directly relevant to every Windows/PowerShell node.
   - `self-hosted-assets`: a worded "known exception (to remediate)" block describing the
     hub's own Google-Fonts/cdnjs hot-linking.
   These live only in this node's (sibling-inherited) copies; the hub's 1.6.2 versions
   don't have them.

## Environment

Node MCP server (plain JS, not TS) + two JVM in-game agents (Kotlin Paper, Java Fabric).
Windows + PowerShell (the node's mesh rule mandates PowerShell + file tools, never the
bash sandbox — followed). Branch model on arrival: `dev` checked out, clean, in sync with
origin, `main` behind by the normal release gap. Repo seeded 2026-07-22 from the
despawned-items sibling; this is its first fairyfox check-for-updates run.
