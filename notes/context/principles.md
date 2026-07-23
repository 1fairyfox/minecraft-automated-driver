# Principles

1. **Semantic over spatial.** Drive the game by naming things — widgets, screens,
   keybindings, entities — never by pixel coordinates. OS-level pixel work is a floor
   for unmodded clients, not a lane.
2. **Disabled until asked.** Every agent is inert without a flag, a config opt-in, or
   an explicit in-game gesture. Self-disabling uses each platform's natural mechanism —
   nothing hacky or fragile.
3. **Nothing leaves the machine.** Stdio MCP, loopback-only control plane, per-session
   tokens, no telemetry, GitHub-only distribution. The owner's name attaches to no
   remotely reachable surface.
4. **The client is never trusted** — and neither is the agent channel. Server-side
   revalidation; allowlisted reflection; writes need explicit grants.
5. **Reuse proven upstream machinery.** Fabric client gametest API techniques, Loom run
   tasks, Mineflayer, MockBukkit — wrap and extend; don't reinvent what the ecosystem
   already tests for us.
6. **Honest state, always.** Gaps are recorded as gaps (`status.md`), partial adoption
   as partial (`reference/adoption-manifest.md`); nothing rounds up to done.
7. **No dead code, no dead config.** Nothing lands before the phase that uses it.
