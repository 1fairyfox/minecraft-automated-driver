# Plan — semantic convenience verbs (2026-07-24)

**Source:** owner mandate `mandate-2026-07-24-semantic-verbs.md` (clauses 2 + 3): "few
semantic verbs" that each perform the multi-step UI/menu/options sequence — world
lifecycle (enter/save/close), online connection, menu navigation, settings changes —
"easily, simply, quickly, efficiently."

**Reading:** the navigation goal (0.11.0) proved the pattern — intelligence MCP-side,
planned over *advertised capabilities*, one intent → many steps, backend-agnostic. This
stream extends that pattern from movement to **UI/menu/world/settings** driving, reusing
the Fabric client agent's existing primitives. No new agent rebuild for the core verbs.

## Architecture — a flow engine beside the goal engine

`src/flows.mjs` — pure MCP-side orchestration, the `goals.mjs` sibling. Every seam
injectable ⇒ fully unit-testable against fake executors. It composes the agent's
documented capabilities (`docs/control-protocol.md` §Fabric):

- `screen` → the current screen as a named widget tree `{screen, widgets:[{label,type,…}]}`
- `click {name}` → press a widget by exact/unique-substring label (ambiguity refused)
- `type {text,name?}` → set a text field
- `key {key,down}` → keybinding by id (edge-fires opens)
- `close` → dismiss the current screen (Escape)
- `position` → `{inWorld,…}` (the arrival/exit signal)

**Shared internals (unit-tested):**
- `readScreen(executor)` — invoke `screen`, JSON-parse the tree, normalise widgets.
- `findWidget(screen, label, {fuzzy})` — exact-or-unique-substring match; ambiguity throws
  (mirrors the agent's own click contract — never guess).
- `waitFor(executor, predicate, {tries, delayMs, sleep})` — poll `screen` (or `position`)
  until a predicate holds or tries exhaust; `sleep` injected for tests.
- `clickByLabel` / `typeInto` — thin wrappers with progress verification.

**Verbs (each: one call → the whole sequence; label defaults are English + overridable,
so i18n / label drift never means a code change — non-hacky):**

| Verb (MCP tool) | Sequence composed | Arrival check |
|-----------------|-------------------|---------------|
| `menuNavigate` (`ui_menu_navigate`) | click a list of button labels in order, verifying each expected next widget appears; the universal open/close/traverse-menus-by-name primitive | final screen returned |
| `serverConnect` (`ui_server_connect`) | title → `Multiplayer` → `Direct Connection` → `type` address → `Join Server` | poll `position.inWorld` |
| `worldCreate` (`ui_world_create`) | title → `Singleplayer` → `Create New World` → `type` name → (optional) cycle game-mode button to target → `Create New World` | poll `position.inWorld` |
| `worldLeave` (`ui_world_leave`) | in-world → `close` (pause) → `Save and Quit to Title` | poll `position.inWorld===false` |
| `settingsSet` (`ui_settings_set`) | open `Options` (from title or pause) → traverse sub-screens by path → toggle/cycle a control by label to the target value → `Done` | control label reflects value |

Each MCP tool resolves an executor by `targetId` from the target registry (the
`goal_navigate` pattern) and dispatches to the flow engine. It works against **any**
executor advertising the needed capabilities, not just Fabric.

## Phases (each: build → tests every layer → gate ≥90 → changelog/VERSION → commit on dev)

- **0.12.0 — the flow engine + the four fully-composable verbs.** `flows.mjs`
  (`readScreen`/`findWidget`/`waitFor` + `menuNavigate`/`serverConnect`/`worldCreate`/
  `worldLeave`) and their MCP tools. Thorough unit tests against fake widget trees +
  position transitions. **This slice.** `settingsSet` for button/toggle/cycler controls
  lands here; slider controls flagged (need a new agent op — next phase).
- **0.13.0 — agent ops the remaining verbs need.** World-**list select by name** (choose a
  world from the Singleplayer list — the list entries aren't plain labelled buttons) and a
  **slider set** op, added to the Fabric agent (Java) + capability strings, then wired into
  `worldEnter` + slider `settingsSet`. Ships with the client gametest extended to prove them.
- **Real-client validation.** A `flows-smoke` (extends the existing client gametest, XVFB in
  CI) drives a real client through: connect-by-address to a booted Paper server, create +
  enter a world, change a setting, save-and-quit — asserting each via `position`/`screen`.
  This is where the English label assumptions are *confirmed on a production client*
  (client-agent discipline: validate before burning CI).

## Guardrails (unchanged)
- No hacks: verbs talk only to advertised capabilities; anything not cleanly expressible is
  a **missing agent op to add** (0.13.0), never MCP-side glue.
- Label defaults are overridable inputs, not magic constants — robust to i18n/version drift.
- Security model untouched (stdio-only, loopback+token, agents off by default).
- c8 ≥90 on `src/` all four metrics at every step; real smoke in CI.

## Ordering note (roadmap reconciliation)
The founding roadmap's next item was 0.12.0 *scenario orchestration*. The owner's 2026-07-24
ask reprioritises the **client convenience verbs** ahead of it; scenario orchestration stays
queued (`goal-level-autonomy-2026-07.md`) and is unaffected — both are executors/verbs over
the same capability seam. Recorded so the roadmap order is a deliberate change, not drift.
