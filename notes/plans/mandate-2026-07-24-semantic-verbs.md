# Mandate ledger — 2026-07-24 — Library-preference + semantic convenience verbs

Owner's words quoted verbatim; one row per clause. Statuses:
`done` / `in-progress` / `blocked-with-evidence` / `awaiting-owner`.

Per the CLAUDE.md standing instruction (Owner Mandates Become Ledgers): deferral
requires falsification, latitude reads ambitiously (S8), and every completion claim
ends with the NOT-done disclosure (S9). Re-read this before claiming completion.

| # | Owner's words (verbatim) | Interpretation | Status |
|---|--------------------------|----------------|--------|
| 1 | "its very silly to have no dependencies and make something from scratch i think you did something like that, its fine to make something from scratch but often i find something already made out there can do everything i wanted and more and way better than what i would make but if theres reasons for not doing that its fine there needs to be a good reason." | Standing design directive: **prefer an existing, mature library over a from-scratch build unless there is a recorded good reason.** Applies going forward AND to the existing custom A\* (`src/pathfind.mjs`). Reconciliation below. | done — see Reconciliation |
| 2 | "A pathfinding on MCP and the ability to do things like enter and save and close worlds, make online connections, navigate and open and close menus, change settings, all just by asking it to do that allowing to to do the steps nesesary with the ui or menus or setting/options whichever." | Raise the client-control ceiling to **semantic convenience verbs**: navigation (shipped 0.11.0 `goal_navigate`), world lifecycle (create/enter/save/close), online connection (direct connect by address), menu navigation (open/close/traverse by name), settings changes — each one call that performs the multi-step UI/menu/options sequence. | done (0.12.0) for pathfinding + connect + world create/leave + menu nav + toggle/cycler settings; **blocked-with-evidence** for enter-a-*saved*-world + slider settings (need new agent ops `world_select`/slider — 0.13.0; see S9) |
| 3 | "Like the MCP server needs to make it legitimately easy to with few semantic wording/commands/verbs whichever do tasks that might involve multiple steps and stuff easily, simply, quickly, efficiently." | The intelligence lives MCP-side (backend-agnostic), so ONE verb expands into the many UI steps. Same principle as the goal engine (Esc. 12): plan over advertised capabilities, never a hard-coded backend. Clean interfaces, tested at every layer, no hacks. | done — `src/flows.mjs` + six `ui_*` tools, unit + protocol tested, gate held |
| 4 | "proceed normally with everything that is required and mandated by me in as many phases as needed, ensure this reaches the completion i asked for in full in as many phases needed" | Run the default workflow end-to-end, phased: plan → build → tests at every testable layer → full green gate (c8 ≥90 all four metrics + link check) → changelog/VERSION/status → commit on `dev` → git-flow release when a slice is complete. "As many phases as needed" + S8 = the ambitious reading; exhaustion, not a milestone. | in-progress — 0.12.0 slice committed on `dev`; 0.13.0 (agent ops) + real smoke + release remain |

## Reconciliation — the library-preference directive vs. the existing custom A\* (clause 1)

The directive's own escape hatch — *"if theres reasons for not doing that its fine there
needs to be a good reason"* — is satisfied by the current design, which already prefers
libraries where one exists:

- **Where a library exists, we already use it.** The `navigate` goal (`src/goals.mjs`)
  delegates to a target's **native** pathfinding capability first; the Mineflayer bot
  satisfies that via **`mineflayer-pathfinder@2.4.5`** (a mature, proven library —
  real walk/jump/parkour). We did NOT hand-roll bot pathfinding.
- **The custom A\* (`src/pathfind.mjs`) only runs where no library exists.** It is the
  *composition* fallback for a backend that exposes only primitives + a world snapshot —
  concretely the **Fabric client agent**, a real rendering client for which there is no
  drop-in JS pathfinding library (Mineflayer's pathfinder is bound to Mineflayer's own
  bot/world model, not a rendering client under semantic UI control). Making navigation
  *universal* across any executor — not a Mineflayer-only trick — is the recorded good
  reason (roadmap Esc. 12; `goal-level-autonomy-2026-07.md`).
- **Decision:** keep the custom A\* (shipped, tested, justified); do NOT rip out working
  code. Recorded in `notes/decisions/architecture.md`. The directive is adopted as a
  standing rule for all *new* work: reach for a library first; record a reason before
  building from scratch.

**Applying clause 1 to this stream's new verbs:** the world-lifecycle / menu / settings
verbs have **no off-the-shelf library** — they are inherently semantic driving of a
specific client's own UI, which only the agent's `screen`/`click`/`type`/`key`/`close`
primitives can express. Composing those primitives MCP-side is therefore the correct
clean approach (it *reuses* the agent's real UI rather than reinventing one), not a
from-scratch-for-its-own-sake build. Recorded reason: no library covers "drive this
client's menus by name."

## NOT done / needs the owner's eyes (S9)

Falsification, not plausibility — each deferral below has a recorded reason it can't land cleanly now:

1. **Enter an *existing/saved* world by name** (`ui_world_enter` / `worldEnter`). A world-list
   entry is not a plain labelled button, so the `screen`/`click` primitives can't select it
   cleanly. The verb ships today with a clear forward error and dispatches through a
   `world_select` capability the moment the agent advertises it. **Blocked on a new Fabric agent
   op** (`world_select`) — 0.13.0. (Create+enter a *fresh* world works now via `ui_world_create`.)
2. **Slider settings** (volume, sensitivity, render distance, FOV). `settingsSet` drives
   toggle/cycler controls by label; a slider needs a value-set op the click primitive can't
   express. Refused today with a clear message. **Blocked on a new Fabric agent slider op** —
   0.13.0.
3. **Real-client validation of the English UI labels.** The verbs assume the default English
   button labels the `screen` op reports on a production client (labels are overridable inputs, so
   this is robustness not fragility). Confirming them on a *real* rendering client is a
   `flows-smoke` (XVFB, CI) extending the existing client gametest — queued with 0.13.0, per the
   client-agent discipline (validate before burning CI). Until then the verbs are proven at the
   unit + protocol layers only.
4. **git-flow release `dev → main`.** This slice is committed on `dev` and fully green locally;
   the tagged `--no-ff` release + back-merge happens when the owner wants the cut (the default
   workflow's release step), or bundled with 0.13.0.
5. **Scenario orchestration** (the founding roadmap's original 0.12.0) is intentionally
   **reprioritised behind** this owner-requested slice; unchanged and queued.

