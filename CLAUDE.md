# Minecraft Automated Driver — AI Context

> Naming (keep consistent — never a bare `AutomatedDriver` form): human-facing name is
> **Minecraft Automated Driver**; the repo slug, the npm package, and the built agent
> jars are all **`minecraft-automated-driver`** (renamed from the papermc- form,
> owner call 2026-07-22 — this project isn't Paper-specific); JVM agent packages live
> under `io.fairyfox.minecraft.automateddriver` (Kotlin). The MCP server itself is plain
> JavaScript (Node) at the repo root — **not TypeScript** (owner call, 2026-07-22).

An **MCP server** that puts the whole Minecraft development loop behind one tool surface
Claude can drive: clean/build/test of plugins and mods, launching and killing Paper
servers and Minecraft clients, attaching to already-running clients, OS-level and
in-process screenshots, protocol bots (Mineflayer), and — via in-game Kotlin agents —
deep semantic control of live clients and servers (menus by *name*, movement, teleports,
state queries, a gated reflection gateway). Targets **Minecraft 1.21.x (1.21.11) /
Java 21 / Node ≥ 20**. Built by Fairy Fox (github.com/1fairyfox).

**The founding plan is `notes/plans/roadmap-2026-07.md` — read it before any feature
work.** It carries the layer model (L0 OS → L1 build/test → L2 protocol bots → L3 in-game
agents), the instance-vs-attach design, the gating rules, and the phase list.

## Start Here

Read `notes/status.md` first — current state, what's in flight, what to do next.
The notes system map is `notes/README.md` (shared living-notes standard).

## Security Model — never weaken (a standing instruction)

The owner's hard requirement: **no security holes attributable to them.**

- MCP transport is **stdio only** — the MCP server never listens on a socket.
- The driver⇄agent control plane is **loopback-only** (`127.0.0.1`), ephemeral port,
  per-session 256-bit token; agents hard-reject anything else.
- **Agents ship disabled-by-default**: enabled only by launch flag
  (`-Dfairyfox.driver.enable=true`, instanced runs), explicit config, or the in-game
  title-screen opt-in button + confirmation (attach mode; dies with the process).
  Self-disable uses each platform's *natural* mechanism, never a hack.
- Reflection **writes** are allowlisted and off unless a session explicitly opens them.
- **GitHub releases only** — never publish the agents to mod/plugin marketplaces.

Any change touching these rules updates `SECURITY.md` in the same commit.

## Quality Bar — Enforced, Not Aspirational (a standing instruction)

Carried from the sibling despawned-items node (owner mandate 2026-07-21), adapted:

- **Coverage gate on every testable module.** JVM agents: Kover-gated ≥90% line in
  `check`. Node MCP server: `node --test` + c8 gate once Phase 1 lands. Every feature
  ships WITH tests at every testable layer. No feature lands untested.
- **No parked findings.** No lint baselines, no skipped tests, no TODO/FIXME in source.
  Fixed or narrowly suppressed at the site with a reason — never baselined away.
- **Scorecard kept at the repo's maximum** (≥7.0 floor): actions SHA-pinned, top-level
  `permissions: contents: read`, wrapper validation, CodeQL alive.
- **Full gate before any release:** build + tests + `node scripts/check-links.mjs`
  locally green, then CI green on the release PR. No red-or-pending merges.

## Critical Things Not to Get Wrong

- **Version targets:** MC 1.21.11 / Java 21 — deliberate (Mineflayer tops out at
  1.21.11; MockBukkit supports 1.21; Paper forward-compat covers 26.x). Do not bump to
  the 26.x line until the tooling catches up; rationale in the roadmap.
- **MCP SDK:** `@modelcontextprotocol/sdk` **v1 (1.29.x)**. v2 splits the package on
  2026-07-28 — migrate deliberately (see `notes/plans/future.md`), don't mix.
- **`online-mode=false` is for local test servers only** — never suggest or script it
  for anything public-facing.
- **Semantic, never pixels.** Client driving is by widget/keybinding/screen *name*
  through the agent; OS-level pixel input is the floor for bare vanilla clients only.
- **Prior art lives in the sibling repo** (despawned-items): `scripts/ingame-smoke.mjs`
  (Mineflayer), `scripts/screenshots.mjs` (scene screenshots), `scripts/server-smoke.sh`,
  `scripts/local-playtest.ps1`, and its `client/fabric` mod. Port knowledge from them;
  don't blind-copy code that references that plugin.
- **Reference clone is read-only.** `assets/references/` is git-ignored; never commit
  or edit it.

## Build / Run

> **Tooling (mesh rule):** use **PowerShell** (the `Windows-MCP` PowerShell tool) +
> the file tools (Read/Edit/Write/Glob/Grep). **Never the Cowork bash sandbox** — it
> mis-reports truncated files on this environment. Full rule: the shared
> `agent-tooling` standard.

- **MCP server:** `npm start` (stdio). Inspector: `npx @modelcontextprotocol/inspector node src/index.mjs`.
- **Tests:** `npm test` (`node --test`).
- **Link check:** `node scripts/check-links.mjs`.
- **JVM agents** (from Phase 3/4): each under `agents/<target>/` as its own Gradle build,
  `./gradlew build` inside it. JDK 21 via foojay toolchain resolver.

## Default Workflow — Do These By Default (a standing instruction)

**Plan before you execute.** Non-trivial work gets a short structured plan in
`notes/plans/` first. Full rule: the shared `planning` standard.

**Phase by default — decompose every ask (a standing instruction).** Break **any**
request — owner, fairyfox system, or self-set — into as many phases as it needs. Name
the phases up front (task list + `notes/plans/` entry for anything non-trivial), execute
in order, report against them. Under-phasing is how clauses get lost.

After making changes, run this loop **without being asked**:

1. **Build / check** the change (`npm test` and/or the touched module's gradle `build`).
2. **Test** the affected area; full gate before releasing to `main`. Only proceed on green.
3. **Commit + push on `dev`**, staging specific files (never `git add -A`). Changelog
   entry rides inside the commit (top of `notes/version/YYYY-MM.md`); bump `VERSION` in
   the same commit when warranted (PATCH default).
4. When green, **release `dev → main` the git-flow way** — `--no-ff`, tagged, via PR once
   branch protection is on. Then back-merge. Full rules: `notes/reference/git-workflow.md`.

**What "ship"/"release" includes by default:** drive Scorecard toward max (≥7.0 floor),
remove tech debt instead of parking it, triage every open dependency PR. Same green gate
as the code.

**Hard safety rules:** never `push --force` / rewrite pushed history; never
`reset --hard` / `rebase` / `clean -fd` / delete a long-lived branch without an explicit
request. Inspect `git status` before and after.

## Checklists Are Contracts (a standing instruction)

When work touches a standard carrying a checklist or `## Verify` table: enumerate every
item; record each outcome individually (pass / fixed / N-A-with-reason / gap-with-due).
Never compress a list into one done-mark without the item-by-item record. Copying a
standard into `notes/reference/` is `copied-only`, **not** adoption — only a recorded
Verify pass counts. Per-standard state: `notes/reference/adoption-manifest.md`.

## Owner Mandates Become Ledgers (a standing instruction)

Multi-clause owner directives get a mandate ledger in `notes/plans/` — owner's words
**quoted verbatim**, one row per clause: quote → interpretation → status
(`done` / `blocked-with-evidence` / `awaiting-owner`). Deferral requires falsification
(recorded evidence of an attempt), not plausibility. "As much as you can" means
exhaustion, not a milestone. Re-read the mandate before claiming completion — diff the
final state against the owner's original words, clause by clause.

**Strict reading of latitude (S8):** latitude language defaults to the ambitious
reading unless the owner explicitly descopes. **Disclose the not-done list (S9):** every
completion claim ends with an explicit "NOT done / read leniently / needs the owner's
eyes" section.

## Maintaining the Notes — Your Responsibility

| Trigger | Action |
|---------|--------|
| Did work worth recording this session | Append to today's `notes/sessions/YYYY-MM/YYYY-MM-DD.md` |
| Made a substantive commit | Inline changelog entry atop `notes/version/YYYY-MM.md`, same commit |
| Health / next changed | Update `notes/status.md` |
| Made / rejected a decision | `notes/decisions/architecture.md` / `rejected.md` |
| A change warrants a version | Bump `VERSION`, same commit |
| Changed data practices (storage, network, deps that phone out) | Update `SECURITY.md` (+ legal pages once the docs site exists), same change |

## Cross-project standards & checking the fairyfox system for updates

This project is a **node in the fairyfox system** (the hub mesh): it pulls shared
standards from the system on request — see `notes/reference/cross-project-sync.md`.

> Provenance note (2026-07-22): this node's standards were seeded from the sibling
> **despawned-items** node, whose local modifications had not yet been upstreamed to the
> hub. On the first fairyfox check-for-updates run, expect divergence from the hub
> versions — reconcile deliberately, and flag the divergences in the process report so
> the hub can adopt them upstream.

**When the user asks you to check *the fairyfox system* for updates** — to sync the
standards, get the latest version, or pull a particular standard/runbook — treat it as
the check-for-updates flow. **To invoke it the request must carry the word "fairyfox"**
— normally **"the fairyfox system"**, or a *fairyfox*-prefixed variant ("fairyfox.io",
"fairyfox standards") — *paired with* an update/sync intent (check for updates · what
changed · sync · refresh · pull the latest · get the newest). Generic handles — "the
hub", "the mesh", "the standards", a runbook name, a bare "system", or an update verb
alone — do **not** qualify; the word *fairyfox* must be present, or don't assume this flow.

The default is **check, report, then wait**: refresh the read-only system clone under
`assets/references/`, diff it against what this project has adopted, and **report what
changed + what adopting it would touch — then stop.** Apply nothing until the user
clearly says go ahead; applying is a separate, confirmed act. Full procedure: the shared
`adopting-updates` runbook (in `notes/reference/`).

**Exception — pre-authorized changes.** The system keeps an express-authorization ledger
(`hub/authorizations.yml`). If an active entry there `covers` the change you're adopting,
the user **already gave the go-ahead at the system** — apply it directly, skipping the
"wait" pause. Still reconcile (don't clobber local divergence), still write the process
report, still commit as a reviewable act, and still run **full verification before *and*
after**. If verification can't be completed, **do not auto-apply** — fall back to
check-report-wait.

**Adopting hub standards/templates is the default.** A standing ledger grant
(`adopt-standards-by-default`) covers all of `hub/standards/` and `hub/templates/`, so
pending standard/template changes are pre-authorized: when you run the fairyfox flow,
**adopt them by default** — report *and apply* — rather than reporting and waiting. This
changes nothing about anti-recursion or the safety floor (reconcile-not-clobber,
divergence re-prompt, process report, full verification before and after).

**After running any fairyfox system procedure, write a process report** in
`notes/fairyfox-reports/YYYY-MM-DD-<procedure>.md` (from
`hub/templates/fairyfox-report.md`): what was done, what was rough, and suggestions to
improve the procedure. The hub reads these to improve the system.

**Guardrails (don't break these):** on-request only — never auto-pull or schedule
cross-repo syncs; the reference clone is read-only and git-ignored; never apply changes
or rewrite history without an explicit go-ahead (an active `authorizations.yml` entry
that covers the change *is* that go-ahead); reconcile with local edits, don't clobber.

> Naming: the user calls it **the fairyfox system** in conversation; the public website
> calls it the **hub**. Both name the same fairyfox.io mesh.
