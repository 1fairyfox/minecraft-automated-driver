# assets/references/ — read-only cross-project clones

This folder holds **read-only, git-ignored** single-branch clones of *other* fairyfox
repos (chiefly the `fairyfox.io` hub) pulled on demand to read shared standards.

- Everything here except this file is git-ignored (see the root `.gitignore`) and must
  **never** be committed — committing a clone nests repos and bloats history.
- These clones are **read-only inputs**. Never edit them; edit the project's own copies
  under `notes/reference/` instead.
- Refresh with a plain `git -C assets/references/<name> pull` — see
  `notes/reference/cross-project-sync.md`.
