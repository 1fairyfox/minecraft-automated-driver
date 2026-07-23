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
