# Standard: AI Context (`CLAUDE.md`)

Every repo gets a root **`CLAUDE.md`** — the entry point for an AI assistant (or
any newcomer) opening the repo cold. It is short, points at the living notes, and
states the standing workflow so an assistant can be productive without being
re-briefed each session. A template is in
[`../templates/CLAUDE.md`](../templates/CLAUDE.md).

## What `CLAUDE.md` must contain

1. **One-line identity** — what the project is, who builds it, its state.
2. **"Start here"** — point at `notes/status.md` first, then the `notes/` map.
3. **Critical things not to get wrong** — the short list of project-specific
   landmines (the stuff that has bitten before).
4. **Build / run** — how to actually build, test, run (and that the assistant
   *can* — name the real tools, e.g. PowerShell, not a sandbox).
5. **Default workflow** — the standing loop done **by default** without asking:
   **plan non-trivial work first** ([planning standard](planning.md)) → build → test →
   commit/push on `dev` → green-gated **release to `main` the git-flow way** (`--no-ff`
   + tag; PATCH direct, MINOR/MAJOR via `release/*`), with the inline-changelog +
   `VERSION` bump riding inside the commit. See the [git-workflow standard](git-workflow.md).
6. **Maintaining the notes** — the trigger→file table (from the notes-system
   standard) so docs stay living.

## Principles

- **It's an index, not a manual.** Depth lives in `notes/`; `CLAUDE.md` routes to
  it. Keep it from rotting into a second copy of the notes.
- **State capabilities honestly.** If the assistant can build/test/commit, say so
  plainly so it doesn't refuse work it can actually do.
- **Encode standing instructions.** Anything meant to happen "by default, without
  being asked" belongs here explicitly.
- **Keep the tooling note current.** Which shell, which CI, which account — the
  practical facts an assistant needs on line one.

## Verify (is it being followed?)

The per-standard slice the [compliance audit](compliance.md) aggregates — report
`done`/`partial`/`missing`:

| Passes only when… | How to check |
|-------------------|--------------|
| A root `CLAUDE.md` exists | `ls CLAUDE.md` |
| It contains all six required pieces (identity · start-here→`status.md` · landmines · build/run · default workflow · notes-maintenance table) | open it and confirm each |
| Its **Default workflow** matches the current [git-workflow standard](git-workflow.md) — no stale `--ff-only`/"fast-forward `main`" wording | grep `CLAUDE.md` for `ff-only`/`fast-forward` |
| Capabilities are stated honestly (build/test/commit named, not denied) | read the Build/run section |
