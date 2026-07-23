# Next Steps

1. **Owner:** create `1fairyfox/papermc-automated-driver` on GitHub; push `dev` +
   `main`; enable private vulnerability reporting; branch-protect `main` when CI exists.
2. **Phase 1 — MCP core + OS layer** (`roadmap-2026-07.md` § Phase 1):
   job model, instance registry, config file, window enumeration + `PrintWindow`
   screenshots + open/close via PowerShell helpers; c8 coverage gate wired into
   `npm test`.
3. **Phase 2 — build/test orchestration**: gradle driver + Paper provisioning
   (port know-how from the sibling's `server-smoke.sh` / `local-playtest.ps1`).
4. Then Phases 3–4 (control protocol, Paper agent, Fabric client agent) per roadmap.

Deferred honestly (recorded in `status.md`): CI workflows, docs site, hub
registration — Phase 7 unless pulled earlier.
