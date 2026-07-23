# Rejected — don't repeat these

## TypeScript for the MCP host (2026-07-22)
Owner preference is firm. Plain JS + JSDoc.

## Automating the official/third-party launcher (2026-07-22)
Fragile, account-touching, and unnecessary: Loom dev clients cover instanced
automation; attach mode covers real clients. Launcher stays a human concern.
Revisit only if a target exists that neither mode reaches.

## Publishing agents to Modrinth/Hangar/CurseForge (2026-07-22)
Dev tooling on player marketplaces = wrong audience + reputational security surface.
GitHub releases only — owner requirement.

## Pixel-coordinate UI driving as the primary lane (2026-07-22)
Brittle across resolutions/scales/versions; the owner explicitly wants naming, not
coordinates. Pixels remain only as the L0 floor for unmodded clients.

## Any non-loopback control channel, ever (2026-07-22)
No "convenience" remote mode, no LAN mode, no config to widen the bind address.
If remote control is ever truly needed, it's a new design conversation, not a flag.

## Hacky self-disable mechanisms (2026-07-22)
No reflection tricks to unload ourselves, no fragile lifecycle abuse. Fabric agent:
gate at init (no-op unless enabled). Paper agent: `setEnabled(false)` in `onEnable`.
Both are the platforms' natural, supported paths.

## Starting on the MC 26.x line (2026-07-22)
Mineflayer and MockBukkit don't support it yet; 1.21.11 is the deliberate ceiling-
matching target. Forward-compat covers 26.x servers meanwhile.
