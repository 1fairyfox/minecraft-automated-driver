<img src="assets/icon.png" alt="Minecraft Automated Driver icon" width="120" align="right">

# Minecraft Automated Driver

**The whole Minecraft dev loop — build, boot, drive, watch — behind one MCP server.**

An MCP (Model Context Protocol) server that lets an AI assistant operate Minecraft
development end to end: clean/build/test plugins and mods, provision and boot local Paper
servers, spawn dev clients or attach to running ones (any known client kind, modded or
vanilla), take OS-level and in-process screenshots, drive protocol bots, and — through
in-game agents — control a **live client or server semantically**: menus and widgets by
*name* (never pixel coordinates), movement, teleports, direct-connects, state queries,
and a gated reflection gateway into live game internals.

> **Status: pre-alpha (Phase 0 — scaffold).** The architecture and phase plan live in
> [`notes/plans/roadmap-2026-07.md`](notes/plans/roadmap-2026-07.md). Nothing below the
> MCP skeleton is implemented yet; this README describes the destination honestly and
> gets updated as phases land.

## The shape of it

| Layer | What it does |
|-------|--------------|
| **MCP server** (Node/JS, this repo's root) | The single tool surface — stdio only, never a network listener |
| **L0 · OS/host** | Find any Minecraft window, screenshot it, open/close instances — works on bare vanilla clients with nothing installed |
| **L1 · Build/test** | Gradle clean/build/test, Paper server download/boot/console, log streaming |
| **L2 · Protocol bots** | Mineflayer players for headless smoke and load work |
| **L3 · In-game agents** (Kotlin) | A Paper plugin and a Fabric client mod exposing semantic control over a loopback-only, token-gated channel |

Two ways a client comes under control:

- **Instance** — the driver spawns a Gradle/Loom dev client (no launcher, no account
  needed) with the agent enabled by launch flag, and direct-connects it to a local
  `online-mode=false` test server.
- **Attach** — your own launcher-installed client carries the agent mod *dormant*; a
  title-screen button ("Automated Testing…") with a confirmation dialog enables the
  control channel until the game closes. Nothing is automated without that gesture.

## Security stance

Designed so there is nothing to attribute a hole to: MCP over **stdio only**; the
driver⇄agent channel is **loopback-only** with a per-session random token; agents are
**disabled by default** on every path (flag, config, or in-game opt-in required);
reflection *writes* need an explicit per-session grant; distribution is **GitHub releases
only** — the agents will never be published to mod marketplaces. Details: [SECURITY.md](SECURITY.md).

## Targets

**Minecraft 1.21.x (built against 1.21.11), Java 21, Node ≥ 20.** First wave: Paper
server + Fabric client. Designed-for (later phases): NeoForge, vanilla-client OS-level
floor, Folia. Why 1.21.11: Mineflayer and MockBukkit both support it; Paper
forward-compat still loads on 26.x servers.

## Run (what exists today)

```sh
npm install
npm start        # MCP server over stdio
npm test         # node --test
node scripts/check-links.mjs
```

Point an MCP client at `node src/index.mjs` (stdio). The only tool so far is
`driver_status`.

## Repo layout

| Path | What |
|------|------|
| `src/` | The MCP server (plain JavaScript, ESM) |
| `agents/` | In-game Kotlin agents, one Gradle build per target (from Phase 3) |
| `scripts/` | Repo tooling (link check, tidy check) |
| `notes/` | Living documentation — start at [`notes/status.md`](notes/status.md) |
| `docs/` | Control-protocol spec (from Phase 3) |

## Contributing

Fork and PR against `dev`. Security issues: see [SECURITY.md](SECURITY.md) — privately,
please.

## License

[Apache 2.0](LICENSE) — do what you like, just credit back.
