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

Completion check: diff final state against the owner's words clause-by-clause before
claiming done (CLAUDE.md → Owner Mandates Become Ledgers).
