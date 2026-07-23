# System Map

```
Claude / any MCP client
        │ stdio
        ▼
┌─ MCP server (src/, Node ESM) ─────────────────────────────┐
│ tool registry · job model · instance registry · config    │
│                                                           │
│  L0 os/        L1 build/       L2 bots/      L3 agents/   │
│  windows,      gradle,         mineflayer    control-plane│
│  screenshots,  paper servers,  players       client (WS   │
│  processes     logs                          127.0.0.1)   │
└───────┬───────────┬───────────────┬──────────────┬────────┘
        │Win32      │child procs    │MC protocol   │loopback WS + token
        ▼           ▼               ▼              ▼
   any MC window  gradle/paper   local Paper   in-game agents (Kotlin)
   (vanilla incl.) processes     server        ├─ agents/paper  (plugin)
                                               └─ agents/fabric (client mod)
                                                  · semantic UI (by name)
                                                  · input/movement
                                                  · reflection gateway
                                                  · flag / button gating
```

Implemented today: the MCP server shell + `driver_status`. Everything else: see
`../plans/roadmap-2026-07.md` phases. This map is updated as layers land.
