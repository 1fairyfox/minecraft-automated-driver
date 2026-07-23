# Decisions

Newest on top. Each: decision → why → revisit-when.

## 2026-07-22 — Docs site assembled by a Node script, not Gradle
The sibling renders its site from Gradle because its build is Gradle; here the repo
root is Node, so `scripts/build-docs.mjs` (+ `marked`, pinned) fills the same
`_shell.html` placeholder contract and renders the changelog live from
`notes/version/`. No `/api/` boundaried zone until a real doc generator exists for
the JS server (JSDoc/TypeDoc later; Dokka per-agent when agents land). Revisit: when
the first generator produces reference worth wrapping.

## 2026-07-22 — Rename: Minecraft Automated Driver (drops the papermc- prefix)
Owner call the same day as founding: the tool drives clients, servers, and mods across
platforms — it was never Paper-specific. Slug/npm `minecraft-automated-driver`, JVM
packages `io.fairyfox.minecraft.automateddriver`, GitHub repo + docs URL follow.
(The owner is renaming the hub group "PaperMC Plugins" → "Minecraft Plugins" and will
rename the sibling project separately.) Revisit: never — renames get exponentially
costlier post-publication; this one landed pre-push precisely to avoid that.

## 2026-07-22 — Host language: plain JavaScript (Node ESM), not TypeScript
Owner call ("I don't like TypeScript"). MCP SDK works fine from JS; JSDoc types where
they pay. Revisit: never, absent owner reversal.

## 2026-07-22 — MCP SDK v1 (1.29.x) now; migrate to v2 deliberately
v2 (split `@modelcontextprotocol/server`/`client`) goes stable with the 2026-07-28
spec. Building on beta days before stable = churn. Revisit: after v2 stable + first
patch settles (tracked in `plans/future.md`).

## 2026-07-22 — Target MC 1.21.x (1.21.11), Java 21 — mirror the sibling node
Same rationale chain: Mineflayer/`node-minecraft-protocol` ceiling is 1.21.11 (the L2
lane needs it), MockBukkit supports 1.21 (Paper agent tests need it), Paper
forward-compat still loads on 26.x. Revisit: when Mineflayer + MockBukkit both support
the 26.x line.

## 2026-07-22 — Dual control modes: instance AND attach, both first-class
Instance = Loom `runClient`/production-run dev clients (no launcher, no MS account,
joins local `online-mode=false` servers) for full spawn→drive→kill automation.
Attach = owner's real client, agent dormant until the title-screen button +
confirmation. Owner explicitly wanted both ("could we support both?").

## 2026-07-22 — Gating: launch flag for scripted starts, in-game opt-in for manual
`-Dfairyfox.driver.enable=true` enables agents on instanced launches (config can flip
defaults); absent flag ⇒ agent self-disables via the platform's natural mechanism
(Fabric no-op init / Paper `setEnabled(false)` in `onEnable`). Attach enablement is a
per-session UI gesture, auto-expiring at game close. Matches the owner's spec verbatim.

## 2026-07-22 — Security: stdio-only MCP; loopback+token control plane; GitHub-only
No listening MCP socket ever; agent channel binds 127.0.0.1, ephemeral port, 256-bit
per-session token, handshake-file discovery; agents never published to marketplaces.
Driven by the owner's "no security holes to my name" requirement.

## 2026-07-22 — Semantic UI driving via agent mod, modeled on Fabric's client gametest API
The official API already proves input simulation, screenshots, and server-connect
contexts in-process; our agent is its interactive-daemon counterpart reusing those
techniques. Batch gametests (CI) and live driving (MCP) share the semantic helpers.

## 2026-07-22 — Deep state access via Java reflection gateway
Owner's explicit preference — reflection is Java's strength and avoids per-field
patching. Allowlisted paths; reads session-gated; writes per-session grant.

## 2026-07-22 — Standards seeded from the sibling node, not the hub
The sibling's locally-modified standards are ahead of the hub and the owner wants them
carried wholesale; upstreaming happens later at the hub. Divergences get flagged in the
first fairyfox check-for-updates report.
