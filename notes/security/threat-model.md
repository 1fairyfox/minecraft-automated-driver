# Threat model — inbound / untrusted content

The [`SECURITY.md`](../../SECURITY.md) posture covers one trust boundary well: the **listener /
enablement surface** — the driver opens no MCP socket, the control plane is loopback-only + token,
agents are disabled by default. That boundary answers *"can something off-machine reach in?"*

This document covers the **other** boundary the owner flagged (2026-07-25): **inbound untrusted
content** — data the driver, a bot, or an agent-enabled client *processes from a server, client, or
artifact it connects to or downloads*. Minecraft's surface here is real: one hostile server, one
malicious plugin/mod, or one tampered download can hand crafted input to code we run. "Can't reach
in" is not "safe to connect out."

The governing rule stays [`CLAUDE.md`](../../CLAUDE.md)'s standing instruction — **no security holes
attributable to the owner** — read here as: the tool must never *silently* feed untrusted input to a
trusted process, and every place where it *can* (by the operator's explicit choice) is documented and
fails safe.

## Surfaces, blast radius, and stance

### 1. Untrusted server → the in-process packet parser (L2 Mineflayer bot) — the sharpest one

A Mineflayer bot (`bot_join`, and the scenario `bot` actor) speaks the Minecraft protocol via
`node-minecraft-protocol`, which parses **every packet the server sends inside the MCP server's own
Node process** — the trusted process with filesystem access. A malicious or compromised server could
try to exploit a parser bug (RCE / DoS / memory blow-up). Blast radius: **the driver process itself.**

- **Mitigation (0.16.0):** the bot registry **refuses a non-loopback host by default**
  (`isLoopbackHost`); reaching a remote server requires an explicit `allowRemote: true`. So you can
  never *accidentally* point the in-process parser at an untrusted remote — it's a deliberate,
  per-call act for a server you trust.
- **Standing mitigation:** the dependency-audit gate (`npm audit --audit-level=low` in CI, fail on
  any advisory) keeps the parser patched; ring buffers bound memory from a chatty peer.
- **Residual / future:** even with `allowRemote`, a trusted-but-compromised server is a risk. Defence
  in depth would run bots in a **separate child process** (crash/exploit isolation) — noted, not yet
  built. Until then: only `allowRemote` to servers you control.

### 2. Untrusted server → an agent-enabled real client (L3 Fabric) + control-plane amplification

A hostile server sends crafted packets and resource packs to a **real Minecraft client**. That
parsing is the *vanilla client's own* attack surface — our agent adds none of it. What our agent
*does* add is a loopback control plane and (Phase 6) a reflection gateway; a client-side compromise
could try to **ride those** to reach the driver or poke memory.

- **Mitigation:** agents are **disabled by default** — no flag / config / in-game opt-in ⇒ no
  listener, nothing to ride. The in-game opt-in dies with the process. Reflection **writes** stay off
  and per-session-granted (mandated; Phase 6).
- **Guidance:** do not run the **agent-enabled** client against servers you don't trust. Instanced
  spawns (`client_spawn`) connect only to the local test server; that's the safe default.

### 3. Co-resident malicious plugin / mod → steals the handshake token, drives the control plane

The token that authenticates the control plane lives in a handshake file in the agent's data dir. Any
process running **as the same OS user** — notably **another plugin on the same Paper server or another
mod in the same client** — can read that file and connect to the loopback port.

- **Mitigation:** the handshake file is written **owner-only (`0600`)** on POSIX; the loopback bind
  refuses non-local peers; the control plane exposes only the agent's gated ops (reflection writes
  off). So a co-resident attacker is still bounded by what the agent itself can do.
- **Residual:** on a single-user machine, same-user isolation is inherently soft (this is the
  `SECURITY.md` "the operator is the trust boundary" line), and Windows ACLs differ from POSIX modes.
- **Guidance:** only run the agent **alongside plugins/mods you trust**; treat the agent-enabled JVM
  as only as trustworthy as everything else loaded into it.

### 4. Supply chain of downloaded / deployed artifacts

- **Paper server jar (`server_provision`)** is downloaded from PaperMC's fill API.
  - **Mitigation (0.16.0):** the download is **SHA-256 verified** against the publisher's checksum as
    it streams to disk; a mismatch **fails closed** (the jar is deleted and provisioning throws), so a
    tampered or corrupted jar is never booted. If a future API omits the checksum, verification is
    skipped with a log line (never silently claimed).
- **Deployed plugin jars (`plugins`, `deployPlugin`)** are the developer's own files; the tool can't
  meaningfully attest arbitrary jars. **Guidance:** deploy only jars you built or trust.

### 5. `build_gradle` / Gradle = arbitrary code execution *by design*

Running a Gradle build **executes whatever `build.gradle(.kts)`, plugins, and tasks are in the target
checkout** — that's what a build tool does. Pointing the driver at an untrusted checkout runs
untrusted code **as you**. There is no mitigation that keeps this a build tool; the boundary is
**trust of the checkout**.

- **Guidance:** only run `build_gradle` against **repositories you trust** (yours, or reviewed). This
  is the same trust you extend when you `./gradlew build` by hand.

### 6. Console / command authority (`server_exec`, agent `exec`, scenario `server_exec`)

These send strings to a server console, which runs with operator authority on that server. Not a *new*
surface (it's the intended capability), but scenario steps compose them — so a scenario is only as
safe as the commands it carries and the server it targets. **Guidance:** treat scenario specs like
scripts you run.

### 7. Denial of service via unbounded input

A chatty or hostile peer could flood chat / events / logs. **Mitigation:** every buffer is a bounded
ring — bot messages (`logCap` 200), job logs (2000), the agent event buffer — and game-thread ops are
timeout-capped so a stuck request can't wedge the loop. **Status: handled.**

## What changed in 0.16.0 (this pass)

| Change | Surface | Effect |
|--------|---------|--------|
| Bot **loopback-by-default** (`allowRemote` to opt in) | #1 | The in-process packet parser can't be aimed at an untrusted remote by accident. |
| Paper jar **SHA-256 verification** (fail closed) | #4 | A tampered/corrupt server jar is deleted, never booted. |
| This document + [`SECURITY.md`](../../SECURITY.md) "inbound content" section | all | The threats are named and each has a recorded stance. |

## Brace list — the operator's standing guidance

1. **Bots only reach servers you trust** — leave the loopback default on; use `allowRemote` knowingly.
2. **Never run the agent-enabled client against an untrusted server.**
3. **Only load the agent beside plugins/mods you trust** (co-resident code shares the token surface).
4. **Only `build_gradle` checkouts you trust** — it runs their code as you.
5. **Deploy only plugin jars you trust**; the Paper jar is integrity-verified for you.
6. **Treat scenario specs like scripts** — they carry console commands and target real servers.

## Not yet done (tracked)

- Child-process isolation for the L2 bot lane (exploit/crash containment for surface #1).
- Reflection gateway read/write grants (Phase 6) — writes must require an explicit per-session grant
  op ([`docs/control-protocol.md`](../../docs/control-protocol.md) records this).
- Windows ACL hardening of the handshake file (POSIX `0600` today; Windows differs).
