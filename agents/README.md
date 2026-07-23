# agents/ — in-game agents (Kotlin/JVM)

Each target gets its own self-contained Gradle build here, created **in its phase**
(nothing scaffolded ahead of use — see `notes/context/principles.md` #7):

| Dir (planned) | What | Phase |
|---------------|------|-------|
| `paper/` | Paper server agent plugin — state queries, command exec, world ops, event taps, reflection gateway | 3 |
| `fabric/` | Fabric client agent mod — semantic UI driving, input/movement, direct-connect, in-process screenshots, title-screen opt-in for attach mode | 4 |
| `neoforge/` | NeoForge counterparts | 8 |

All agents: package `io.fairyfox.minecraft.automateddriver.<target>`, disabled-by-default
gating, one shared control-protocol spec (`docs/control-protocol.md`, written in
Phase 3). Design: `notes/plans/roadmap-2026-07.md`.
