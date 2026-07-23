# Project Context

## What & why

The sibling despawned-items project accumulated automation piecemeal: a Mineflayer
smoke script, a screenshot harness that boots a real server and poses scenes, a local
playtest bootstrapper, CI jobs that join servers with bots, and a companion Fabric
client mod. Each solves one problem; nothing unifies them, and none of it is reusable
from the next project. **This project is that unification** — the layers brought
together coherently, generalized, and put behind an MCP server so an AI assistant can
drive the entire dev loop for *any* Minecraft project.

It was recognized as its own need mid-way through the despawned-items work
(2026-07-22) and split out rather than bolted on.

## What it must do (owner's goals, condensed)

- Connect to **any open Minecraft client of the known kinds** — with the agent mod if
  present, or at a basic OS level (window discovery, screenshots, open/close) if not.
- Automate **clean, build, test** across the different target kinds.
- **Spawn clients without the launcher** where possible (Gradle/Loom dev clients);
  where not, attach to a manually-started client via an explicit in-game opt-in.
- **Drive the live client semantically** — menus, widgets, features *by name*, never
  pixel coordinates: direct-connect, movement, teleport, container interaction.
- Drive the **live server** the same way (state, commands, world, events).
- **Deep state access** — the "all the memory variables in RAM and game code" goal —
  via a reflection gateway (Java reflection is the deliberate tool of choice).
- Agents **start disabled** unless the scripted/instanced start enables them by flag;
  attach mode is enabled per-session by an in-game button + confirmation.
- **No security holes attributable to the owner**: stdio-only MCP, loopback+token
  control plane, disabled-by-default agents, GitHub-only distribution.

## Relationship to the mesh

A node in the fairyfox system. Standards were seeded from the sibling node (ahead of
the hub); hub registration and the themed docs site are deferred to Phase 7 and
recorded as honest gaps in `status.md`.
