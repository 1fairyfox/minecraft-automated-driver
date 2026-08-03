# New Project Setup — bootstrapping a project into the mesh

How to take a fresh (or unmanaged) repository to **fully set up** inside the
hub mesh: adopting the shared standards, the living-notes system, the git model,
and getting registered so the hub is aware of it.

> Canonical, project-agnostic version (the one other repos copy). The hub itself
> is set up this way too. Companion procedure for *later* changes:
> [`adopting-updates.md`](adopting-updates.md). The model behind both:
> [`cross-project-sync.md`](cross-project-sync.md).

For AI or human. Run the steps in order; each is small and reversible.

> **Greenfield only.** This runbook assumes a blank or new repo. Folding in an
> **established repo** that already has its own history, README, docs, or version
> scheme is a different path — use
> [`onboarding-existing-project.md`](onboarding-existing-project.md) instead.

> **Single app vs. collection (monorepo).** The default shape is **one app per
> repo**, and the steps below read that way. A **collection / monorepo** — many
> self-contained units in one repo (e.g. `fairyfox-games`, with a `games/<slug>/`
> per game) — is an allowed **deliberate exception**, made only when the owner and
> Claude talk it out and agree it's the right call, with the reason recorded in the
> project's `decisions/` notes. In a collection: the unit of quality is the
> **per-sub-unit folder** (its own core, tests, docs, and — if it versions
> independently — version), while `VERSION`, the release flow, and the notes system
> stay **repo-level**; and the repo's site is a **landing index** over the units
> rather than one app's site (see step 6 and the
> [deployment standard](deployment.md)).

## What "fully set up" means

The end state — tick every box before calling a project done:

| Area | Done when |
|------|-----------|
| Repo + branches | The repo exists on GitHub with **`dev`** and **`main`**; work happens on `dev`, and `main` advances only by `--no-ff` **tagged** releases (full git-flow). |
| AI entry point | A filled-in `CLAUDE.md` at the root, pointing at `notes/status.md`. |
| Notes system | A `notes/` tree (from the skeleton), with a real `status.md`. |
| Versioning | A `VERSION` file at the root (usually `0.1.0`). |
| Ignores | `.gitignore` excludes `assets/references/*` and build cruft. |
| Line endings | A root `.gitattributes` (`* text=auto eol=lf` + `.bat`/`.cmd` CRLF, binaries) — [agent-tooling](agent-tooling.md). |
| Security | `SECURITY.md`, least-privilege + SHA-pinned workflows, signed releases, `main` branch-protected (solo config), Dependabot — [supply-chain-hardening](supply-chain-hardening.md). |
| Legal | Self-hosted, code-accurate Privacy/Terms/Cookies — [legal-docs](legal-docs.md). |
| Badges | The README opens with the **full 20-badge set in the canonical order** (swap per-project equivalents; omit only on a recorded user exception) — [badges](badges.md). |
| README cross-links | The README carries the worded mesh links the chrome can't provide off-site — a docs link near the top, a grouped "Get it" section (live app · download · each store/registry · source), and a fairyfox mesh footer near the bottom — [readme](readme.md). |
| Project details | The `_data/projects.yml` row is **filled by default** — blurb/tags/lifecycle/version/activity/links/accent/icon; blanks only on a recorded user exception; social/preview image exempt. |
| Standards adopted | The project follows the hub's git, versioning, notes, AI-context, supply-chain, dependencies, legal-docs, agent-tooling, badges, and readme standards (copied in, not linked). |
| Registered | The project is listed in the hub's [`registry.yml`](../registry.yml) **and** the site's `_data/projects.yml`. |
| Docs site | A documentation site published at `fairyfox.io/<key>/`, built to the [docs-site design system](docs-site/) so it **appears as a page of fairyfox.io** (shared chrome; brand/Home is the way home). For a **static** project the published site can double as the docs site — one surface, not two. |
| Process report | A `notes/fairyfox-reports/` folder exists (from the skeleton) and this setup run is written up in it — see [process-reports](process-reports.md). |

## Before you start

- The repo exists (or you are about to `git init` / `gh repo create` it).
- `git` and the `gh` CLI are installed and authed.
- You know the project's **key** (short slug = the folder name used everywhere,
  e.g. `random-ai-prompt`) and its **default sync branch** (almost always `dev`).

## Steps

### 1. Create the repo and the two branches

```sh
# if it doesn't exist yet
gh repo create 1fairyfox/<project> --private --source=. --remote=origin
git checkout -b dev          # all work lives here
```

`main` is created at the first release (step 9). **Never commit directly to
`main`** — it only advances by a `--no-ff`, **tagged** release from a green `dev`
(see the [git-workflow standard](git-workflow.md)).

### 2. Pull a read-only copy of the hub

The hub is read by **single-branch clone into a git-ignored folder** — never a
submodule, never a dependency. An ordinary clone refreshes by fast-forward every time.

```sh
mkdir -p assets/references
git -C assets/references clone --branch dev --single-branch \
    https://github.com/1fairyfox/1fairyfox.github.io fairyfox.io
```

### 3. Copy the templates into the project

Copy — don't link. The templates become part of *this* repo.

```sh
H=assets/references/fairyfox.io/hub/templates
cp    $H/CLAUDE.md              ./CLAUDE.md
cp    $H/VERSION                ./VERSION
cat   $H/project.gitignore     >> ./.gitignore
cp    $H/project.gitattributes  ./.gitattributes   # LF normalization — agent-tooling standard
cp -r $H/notes-skeleton         ./notes
cp    $H/SECURITY.md            ./SECURITY.md       # supply-chain-hardening
mkdir -p .github/workflows
cp    $H/dependabot.yml         .github/dependabot.yml            # dependencies + supply-chain
cp    $H/branch-sync.yml        .github/workflows/branch-sync.yml # git-workflow back-merge guard
cp -r $H/legal                  ./public/legal       # legal-docs — place per the app's origin
# README badges: paste the FULL ordered block from $H/README-badges.md (all 20, swap equivalents; badges standard)
# README cross-links: add the worded links from $H/README-links.md (docs link near top, "Get it" section, mesh footer; readme standard)
```

Then, still part of setup: enable **branch protection** on `main` (solo config) and wire
**signed releases** per [supply-chain-hardening](supply-chain-hardening.md); the release
flow is the **PR-based** path in [git-workflow](git-workflow.md#releasing-when-main-is-branch-protected-pr-based).
**Populate `main`'s required-status-check contexts with the full CI suite by job name** —
branch protection existing is not enough; empty contexts make "full CI before `main`"
documentation without teeth (a merge slips through while a smoke job is red). Set them per
this repo's actual job names ([git-workflow → Full CI before `main`](git-workflow.md#full-ci-before-main--platform-enforced-every-job)).
For a **JVM/Gradle or other non-web** project, translate the npm-shaped template defaults
(Gradle ecosystem in `dependabot.yml`, `github/v/tag` version badge, Dokka/Javadoc docs, a
`.jar` + Hangar/Modrinth as the "deploy" — see the aside in
[onboarding-existing-project.md](onboarding-existing-project.md#jvm--gradle-and-other-non-web-projects)).

### 4. Fill in the templates for this project

The copies are generic — make them this project's own:

- **`CLAUDE.md`** — project identity, the "critical things not to get wrong"
  (landmines), build/run commands, and any project-specific standing
  instructions. Keep it pointing at `notes/status.md`.
- **`VERSION`** — set the starting number (usually `0.1.0`).
- **`notes/status.md`** — a real current-state snapshot, even if short.
- **`notes/context/`** — `project.md`, `architecture.md`, `principles.md`:
  what this is, how it's built, the voice/principles it holds to.

### 5. Confirm the standards are adopted

The skeleton's `notes/reference/` mirrors the hub standards as *this project's
copy*. Confirm each shared standard is present and reconciled with how the
project actually works — git workflow, versioning, the notes system, AI context,
and cross-project sync. Adopting a standard is a **copy committed locally**, not
a live link; re-pull later to see what changed (see
[`adopting-updates.md`](adopting-updates.md)).

### 6. Build the project's docs site so it's a page of fairyfox

A project isn't fully set up until it has a documentation site that **appears as a
page of fairyfox.io** — same chrome, same nav, no sense of having left. Follow the
[docs-site design system](docs-site/) standard:

- Wear the shared chrome (header, primary nav + submenu, footer) — copy the reference
  markup in [`docs-site/reference/`](docs-site/reference/) rather than reverse-
  engineering it; exact values in
  [`docs-site/11-measurements-reference.md`](docs-site/11-measurements-reference.md)
  and [`docs-site/reference/main.css`](docs-site/reference/). **If the docs are
  generator-produced** (JSDoc, Doxygen, …), theme the generator itself — replace its
  stylesheet, don't override
  ([`docs-site/06`](docs-site/06-content-and-organization.md#generated-docs-doxygen-jsdoc-typedoc-sphinx-)).
- The **brand/Home link is the way home** to `fairyfox.io/` — there is **no separate
  "back to Fairy Fox" button** (you never left). Project-forward branding is fine — the
  shared chrome is the tie
  ([`docs-site/05-navigation-and-cross-linking.md`](docs-site/05-navigation-and-cross-linking.md)).
- Publish on the **shared domain** at **`fairyfox.io/<key>/`** so it's truly same-origin
  ([`docs-site/10-domain-and-publishing.md`](docs-site/10-domain-and-publishing.md) and
  the [deployment standard](deployment.md)) — enable Pages, set the base path to
  `/<key>`, no project CNAME. **Built/runnable apps deploy to Netlify instead** (see
  [deployment](deployment.md)); they wear the same chrome but live on their own host.
- For a **static** project the published site can double as the docs site — don't build
  two overlapping surfaces.
- Verify against [`docs-site/08-compliance-checklist.md`](docs-site/08-compliance-checklist.md).

### 7. Register the project with the hub *(hub-side change)*

So the hub knows the project exists and can read it for round-ups. This is a
commit **in the hub repo**, not the project:

- Add an entry to [`hub/registry.yml`](../registry.yml) — `key`, `repo`,
  `branch`, `adopts_hub`, `notes_system`, `last_seen: null`.
- Add the human-facing companion entry to the site's `_data/projects.yml`
  (keep the two registries in step), **with its project details filled in by default** —
  `name`, `blurb`, `tags`, `lifecycle`, `version`, `activity`, `updated`, `color`, `icon`,
  `docs`, `notes`, per the schema at the top of that file. Complete-by-default: a field is
  left blank only on a **user-granted** exception (recorded), never the AI's own call; the
  **social/preview image is the one automatic exemption**.

### 8. Write the setup process report

Setting a project up is a fairyfox system interaction, so it ends with a process
report in `notes/fairyfox-reports/YYYY-MM-DD-setup.md` (from
[`templates/fairyfox-report.md`](../templates/fairyfox-report.md)): how the bootstrap
went, which steps were ambiguous or didn't fit a fresh repo, and any suggestion for
the runbook. This is the feedback the hub uses to improve setup — see the
[process-reports standard](process-reports.md). It's committed with the rest below.

### 9. First commit, push, release to `main`

Inside the project, on `dev`:

```sh
git add CLAUDE.md VERSION .gitignore notes        # incl. notes/fairyfox-reports/; specific files, never -A
git commit -m "chore: adopt hub standards and notes system"
git push origin dev

# release dev → main the git-flow way (PATCH: direct, --no-ff, tagged):
git checkout main && git merge --no-ff dev
git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin main --tags
git checkout dev && git merge --ff-only main && git push origin dev   # back-merge — dev must contain main
```

(A MINOR/MAJOR milestone goes through a `release/*` branch instead — see the
[git-workflow standard](git-workflow.md#cutting-a-release). Once `main` is
branch-protected, the direct push is blocked — release via the
[PR-based path](git-workflow.md#releasing-when-main-is-branch-protected-pr-based).)

Stage the **reference clone out** — `assets/references/*` is git-ignored and must
never be committed (committing it nests repos and bloats history).

## Verify

- `git status` is clean; `assets/references/` is untracked/ignored.
- `CLAUDE.md` opens to a real `notes/status.md`, **and actually contains the
  "Cross-project standards & checking the fairyfox system for updates" standing
  instruction** (confirm the text is present, not just that the file exists).
- `VERSION` reads a sane starting number.
- The project resolves in **both** registries (`hub/registry.yml` and
  `_data/projects.yml`) with matching `key` and `branch`, and the `_data/projects.yml` row
  has its **project details filled by default** (blurb/tags/lifecycle/version/activity/links/
  accent/icon) — blanks only on a recorded user exception; social/preview image exempt.
- The README opens with the **full 20-badge set in the canonical order** ([badges](badges.md)),
  each slot the right per-project source; omissions only on a recorded user exception.
- The README carries the worded mesh cross-links ([readme](readme.md)) — a docs link near the
  top, a grouped "Get it" section covering every real publish/deploy destination, and a
  fairyfox mesh footer near the bottom; the always-required docs link + footer present.
- The docs site loads at `fairyfox.io/<key>/`, **wears the shared fairyfox chrome**
  (header, nav + submenu, footer) so it reads as a page of the site, with the
  **brand/Home link as the way home** and **no separate back-button** — **look at the
  served page**; default-theme JSDoc/Doxygen output, **any stack's default theme with only
  cosmetic changes (a couple colours + a footer mention)**, or a merely-resolving `docs:` URL
  is a miss. The coin + reader buttons are present, the subnav is not bare, and the tool's own
  default chrome (footer/header/sidebar/CSS) is removed, not left alongside. If the docs are
  generator-produced, theme the generator itself
  ([`docs-site/06`](docs-site/06-content-and-organization.md#generated-docs-doxygen-jsdoc-typedoc-sphinx-)).
  Bar: [`docs-site/08-compliance-checklist.md`](docs-site/08-compliance-checklist.md).
- The deploy target matches the project's kind (static → Pages on the shared domain;
  built app → Netlify) per the [deployment standard](deployment.md).
- If the project builds/serves, it builds green.
- `notes/fairyfox-reports/` exists and holds this run's setup report, committed —
  [process-reports standard](process-reports.md).

Don't report the project as fully set up unless every item above actually holds —
name any that don't rather than rounding up.

## Gotchas

- **References are read-only and git-ignored.** Pulling the hub never produces a
  commit, so it can't trigger anything downstream.
- **Branch defaults.** New projects track `dev` (work) and release to `main`
  (tagged); **`master` is never used in the mesh.** Onboarding a *legacy* repo still
  on `master` renames it to `main` — mandatory, not optional (see
  [onboarding](onboarding-existing-project.md) and the
  [git-workflow standard](git-workflow.md#master--main-is-mandatory)). The registry's
  `branch` field records the **work** branch (`dev`).
- **One source of truth per fact.** Version → `VERSION`; project list →
  the registries; shared rules → the hub. Don't duplicate; link.
- **Never bump MAJOR** (`→ 1.0.0`) — Fairy Fox's call only.
