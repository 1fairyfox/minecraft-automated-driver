# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue for a
suspected vulnerability.

- Use GitHub's **private vulnerability reporting** for this repo:
  **Security → Report a vulnerability**.
- Or email **junehanabi@gmail.com** with details and, if possible, a reproduction.

You'll get an acknowledgement as soon as it's seen. Please allow a reasonable window
for a fix before any public disclosure.

## Supported versions

Only the latest released version of **Minecraft Automated Driver** is supported. Fixes
ship in a new release rather than as back-ports.

## Scope & threat model

This is a **local development tool**: an MCP server plus optional in-game agents (a
Paper plugin and client mods) intended to run only on a developer's own machine against
local test servers. Its security posture, by design:

- **No network listener for MCP.** The MCP server speaks stdio to its client and never
  binds a socket for that purpose.
- **Loopback-only control plane.** The driver⇄agent channel binds `127.0.0.1`
  exclusively, on an ephemeral port, authenticated with a per-session 256-bit random
  token. Agents reject non-loopback binds and unauthenticated peers.
- **Agents are disabled by default.** With no launch flag, no config opt-in, and no
  in-game opt-in gesture, an installed agent registers no listener and exposes nothing.
  The in-game opt-in (title-screen button + confirmation) lasts at most until the game
  process exits.
- **Reflection writes are gated.** Reading live game state requires an authenticated
  session; *writing* additionally requires an explicit per-session capability grant.
- **No telemetry.** Nothing phones home; no data leaves the machine. Outbound network
  use is limited to explicitly requested provisioning (e.g. downloading a Paper server
  jar from PaperMC's API) and package/dependency installation.
- **Distribution is GitHub releases only.** The agents are deliberately not published
  to mod/plugin marketplaces; they are development tooling, not player-facing products.
- `online-mode=false` is used **only** for locally provisioned, loopback test servers;
  this project never configures or recommends it for anything reachable from outside.

The relevant trust boundary is the operator of the machine: anyone who can already run
processes as you can already do everything this tool can. The design goal is that the
tool adds **no remotely reachable surface and no silently enabled surface**.

### Inbound / untrusted content

The points above answer *"can something off-machine reach in?"* — no. A second boundary
matters too: **content the tool processes from a server, client, or download it connects to
or fetches.** A hostile Minecraft server, a malicious plugin/mod, or a tampered artifact can
hand crafted input to code we run, so connecting *out* is a trust decision, not a free action.
The full surface-by-surface analysis is [`notes/security/threat-model.md`](notes/security/threat-model.md);
the load-bearing points:

- **A protocol bot parses the server's packets in the driver's own process.** So `bot_join`
  (and the scenario `bot` actor) **refuse a non-loopback host by default** — reaching a remote
  server takes an explicit `allowRemote: true`, for a server you trust. The in-process parser is
  never aimed at an untrusted remote by accident.
- **Downloaded Paper server jars are SHA-256 verified** against PaperMC's published checksum as
  they stream to disk; a mismatch **fails closed** (the jar is deleted, provisioning throws), so a
  tampered or corrupt jar is never booted.
- **Do not run the agent-enabled client against untrusted servers**, and **only load the agent
  beside plugins/mods you trust** — co-resident code in the same JVM can read the loopback token.
  The agent stays disabled by default and reflection writes stay off + per-session-granted.
- **`build_gradle` runs the target checkout's build code as you** (that is what a build tool does)
  — only point it at repositories you trust. Likewise, **deploy only plugin jars you trust.**

The operator's short "brace list" lives at the end of the threat-model document.
