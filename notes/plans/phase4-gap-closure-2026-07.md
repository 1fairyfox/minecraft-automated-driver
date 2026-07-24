# Plan — close the deferred Phase 4 client-driving gaps (2026-07-24)

**Directive (owner, verbatim):** *"dont leave gaps everywhere as you pave new road, keeps
things fixed and developed and stuff, proceed normally with everything that is required and
mandated by me in as many phases as needed, ensure this reaches the completion i asked for
in full in as many phases needed."*

Reading: before extending the road (Phase 6 reflection gateway), go back and finish the
road already laid. Phase 4 (`roadmap-2026-07.md`) shipped a *foundation* in 0.5.0 and
**deferred** the rest of its own exit criterion behind an honest S9 note. That deferral is
a gap. Close it — fully, tested, released — so Phase 4's stated exit is genuinely met:

> Exit: Claude can drive a client from title screen into a server, walk somewhere, open a
> container, and screenshot it — all by name, zero pixel coordinates.

## Gaps found (grounded in the code, 2026-07-24)

1. **CodeQL doesn't actually analyze the Fabric Java agent.** The `analyze-kotlin` job uses
   `build-mode: manual` but only traced-compiles `agents/paper` (`compileKotlin`). With
   manual build-mode CodeQL sees only what's compiled during the trace, so the Fabric
   agent's token/handshake/loopback code is unscanned. A green check that covers less than
   it appears to — the worst kind of gap. **(security debt, not a feature)**
2. **No in-process framebuffer screenshot op.** `ClientOps` has `describeScreen`,
   `clickByName`, `pressKey/releaseKey` — no screenshot. The exit says "screenshot it".
3. **No player movement / look / position.** Can't "walk somewhere".
4. **No text entry.** Blocks direct-connect-by-name navigation (type an address).
5. **Container/slot driving is thin.** `clickByName`/`describeScreen` only see
   `ClickableWidget` children; handled screens (inventory/chest) use `Slot`s, not clickable
   widgets — so "open a container" and act on it isn't covered.

## Phases (each: build → test at every layer → gate → release git-flow, no gap left open)

- **0.8.0 — screenshot + honest CodeQL.** (a) Extend `analyze-kotlin` to also traced-compile
  `agents/fabric` main → CodeQL truly covers both agents. (b) Agent `screenshot` op:
  framebuffer → PNG bytes → base64 over the control plane; driver `agent_screenshot` tool.
  Gametest asserts a real non-empty PNG (magic bytes); unit-test the pure size/encoding
  guard; c8 + JaCoCo gates held. One release, two gaps closed.
- **0.9.0 — in-world driving.** Agent ops: `move` (hold movement keybindings for N ticks
  while the world ticks), `look` (set yaw/pitch), `position` (query x/y/z/yaw/pitch/inWorld),
  `type` (set a focused `TextFieldWidget` by name), and container **slot** introspection +
  `clickSlot` for handled screens. Driver tools `agent_move`/`agent_look`/`agent_position`/
  `agent_type` (+ slot support in `agent_screen`/`agent_click`). Gametest boots a
  singleplayer world, reads position, walks, confirms movement, opens the inventory, and
  introspects slots. Gates held.
- **Close-out.** Re-verify Phase 4's exit sentence clause-by-clause against the shipped ops;
  mark the roadmap Phase 4 DONE (full, not just foundation); update `control-protocol.md`'s
  op list, `status.md`, and the ledger. Disclose anything still not done.

## Method note — validate Java locally before burning CI

The heavy client gametest is a 6–15 min CI cycle. This machine's Loom cache is warm from
0.5.0, so every Java change is `compileJava`-checked locally first; only compile-clean code
is pushed. Same discipline the 0.7.0 smoke taught: don't spend a CI cycle to learn a typo.
