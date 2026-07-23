# Future / Someday

- **MCP SDK v2 migration** — v2 stable lands with the 2026-07-28 spec
  (`@modelcontextprotocol/server` + `client` split). Migrate after it settles;
  bounded refactor of `src/index.mjs` + transports.
- **26.x line adoption** — when Mineflayer + MockBukkit support it; re-verify
  forward-compat claims then.
- **NeoForge agents** (client + server) on the same control-protocol spec.
- **Folia-compatible Paper agent** (region-threaded schedulers).
- **Linux/macOS host layer** — L0 is Windows-first; abstract when a second OS matters.
- **Golden-image screenshot assertions** — the Fabric client gametest API supports
  compare-against-golden; expose as an MCP verification tool.
- **Server-side driving of *production* servers** — owner flagged "may be unnecessary";
  keep scoped to local test servers unless a real need appears.
- **Multi-client scenarios** — several driven clients on one server (PvP/interaction
  testing) once single-client lifecycle is solid.
