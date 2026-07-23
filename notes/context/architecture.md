# Architecture

Canonical detail lives in `../plans/roadmap-2026-07.md` (§ layer model, § security
model). Summary for orientation:

- **Host:** Node/JS MCP server, stdio transport, repo root. One module per layer, each
  registering its tools; long operations return job ids (job model, Phase 1).
- **L0 OS/host:** PowerShell/Win32 helpers as child processes — window enumeration,
  `PrintWindow` screenshots (background-window capable), process spawn/kill. Windows
  first; other OSes when needed.
- **L1 Build/test:** Gradle invocation per target checkout; Paper provisioning
  (download → isolated `run/` dir → `online-mode=false` → boot/console/logs).
- **L2 Protocol bots:** Mineflayer (1.21.11 ceiling — part of why that's the target).
- **L3 Agents (Kotlin/JVM):** Paper plugin + Fabric client mod speaking one
  control-protocol spec (`docs/control-protocol.md`, Phase 3) over loopback WS with a
  per-session token. Semantic UI layer on the client (widget tree by name, keybinding
  invocation, input injection) modeled on the official Fabric client gametest API's
  techniques; reflection gateway for deep state (reads gated by session, writes by
  explicit grant).
- **Instance vs attach:** dev clients spawned via Loom `runClient`/production run tasks
  with `-Dfairyfox.driver.enable=true`; real clients attach only after the title-screen
  opt-in gesture.

## Naming

Human name **Minecraft Automated Driver**; slug/npm/jars `minecraft-automated-driver`
(renamed from the papermc- form 2026-07-22 — not Paper-specific); JVM packages
`io.fairyfox.minecraft.automateddriver.<agent>`.
