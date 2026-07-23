# Mandate ledger — 2026-07-22 — Rename + proceed to completion

Owner's words quoted verbatim; one row per clause. Statuses:
`done` / `blocked-with-evidence` / `awaiting-owner`.

| # | Owner's words (verbatim) | Interpretation | Status |
|---|--------------------------|----------------|--------|
| 1 | "i was going to name it papermc-automated-driver you guessed correctly but this isnt paper … so i was thinking minecraft-automated-driver instead" | Rename project: human name **Minecraft Automated Driver**; slug/npm/jars `minecraft-automated-driver`; JVM packages `io.fairyfox.minecraft.automateddriver`; docs URL and GitHub repo follow the slug. Platform references to Paper/PaperMC (the server software) are unaffected. | done |
| 2 | "ill name the other project later" | Sibling rename is the owner's own task; nothing for this repo. | awaiting-owner |
| 3 | "this does give me some thing to do on the hub regarding this naming the group Minecraft Plugins instead of PaperMC Plugins" | Hub-side group rename is the owner's own task. | awaiting-owner |
| 4 | "i havent registered this in the hub yet i need a github repo to do that" | Create `1fairyfox/minecraft-automated-driver` on GitHub via `gh` and push `dev`/`main` + tags, unblocking the owner's hub registration. | done — repo created + pushed (see session log) |
| 5 | "proceed normally with everything that is required and mandated by me in as many phases as needed, ensure this reaches the completion i asked for in full" | Run the default workflow end-to-end on the rename: phases named, edits, notes/changelog/VERSION, full local gate, commit on `dev`, git-flow release `dev → main` (`--no-ff`, tagged), back-merge. | done |
| 6 | "if you alreadfy copied everything i did and implemented those procedures or in the process of then theres not really anything extra to do beforehand in the hub" | Confirmation of the Phase-0 approach (procedures implemented project-side; hub paperwork owner-side, at their leisure). No action. | done (no-op) |

## Escalation — mandate repeated (same day)

Owner: "if theres more to do, proceed normally with everything that is required and
mandated by me in as many phases as needed, ensure this reaches the completion i asked
for in full in as many phases needed" — and, mid-execution: "this needs thorough
testing by the way following all the testing quality guidelines and layers ive spoken
about a lot, code coverage needs to be >= 90% scorecard needs to be preferably in the
7.x range . Yea all those things you said, alright then you got this, make sure
everything is done in full like i said earlier"

Per the repetition rule, previously-disclosed NOT-done items that are executable
escalate to do-now:

| # | Clause | Interpretation | Status |
|---|--------|----------------|--------|
| 7 | "thorough testing … all the testing quality guidelines and layers … code coverage needs to be >= 90%" | The c8 ≥90% gate moves from "Phase 1" to NOW; tests at every testable layer of the current code: unit (version handling), protocol (in-memory MCP client round-trip), e2e (spawned stdio server, real JSON-RPC session). Gate wired into `npm test` so builds FAIL below 90. | done |
| 8 | "scorecard needs to be preferably in the 7.x range" | Every solo-fixable Scorecard lever pulled: SHA-pinned actions, top-level `contents: read`, CodeQL, Scorecard workflow, dependabot, lockfile, SECURITY.md, license, 0 vulns, branch protection on `main` w/ required checks. The number itself is computed by OpenSSF after the workflow runs on `main`; solo-unfixable checks (Code-Review, Contributors, CII, Fuzzing) noted, not chased. SCORECARD_TOKEN PAT is an owner step for the Branch-Protection check to score. | done (levers) / awaiting-first-scan (number) |
| 9 | Private vulnerability reporting (disclosed NOT-done last round, repeated without descoping) | Enable via API. | done |
| 10 | CI (disclosed NOT-done; real code now exists to test) | ci.yml (npm ci/test+coverage-gate/audit/link-check), codeql.yml (javascript), scorecard.yml — all SHA-pinned, least-privilege. | done |
| 11 | Branch protection ("when CI exists" — CI now exists) | Protect `main`: required status checks from the release PR's observed check names; release 0.1.2 lands via PR with all checks green. | done |
| 12 | Hub registration / group rename / sibling rename | Explicitly owner-claimed ("ill do the paperwork", "gives me some thing to do on the hub", "ill name the other project later") — NOT escalated; overriding an explicit owner reservation isn't latitude. | awaiting-owner |

## Escalation 2 — "you need to finish onboarding" (docs site)

Owner: "i registered you on the hub but we still need a docs site before i can do that
forgot about that you need to finish onboarding, proceed normally with everything that
is required and mandated by me …"

| # | Clause | Interpretation | Status |
|---|--------|----------------|--------|
| 13 | "we still need a docs site … finish onboarding" | Build + deploy the themed docs site (the last project-side onboarding row). Compliance, item-by-item: shared theme tokens/chrome ✓ (vendored, `docs-theme/chrome/`, version-marked) · header/footer shell ✓ · canonical three-zone subnav ✓ · two-way links to fairyfox.io ✓ (test-asserted on every page) · published at `fairyfox.io/minecraft-automated-driver/` ✓ (Pages project site, no CNAME) · legal pages matching real data practices ✓ · boundaried generated-API zone **N-A-with-reason** (no doc generator exists for the JS server yet; added when one does) · live page visually verified ✓ (fetched and inspected, not just resolved). | done |
| 14 | (carried) hub-side docs-library entry + registry flag flip | Owner-side once the site is live. | awaiting-owner |

Completion check: diff final state against the owner's words clause-by-clause before
claiming done (CLAUDE.md → Owner Mandates Become Ledgers).
