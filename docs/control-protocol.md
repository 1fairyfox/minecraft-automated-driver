# Control-plane protocol — driver ⇄ in-game agents (v1)

One spec for every agent (Paper plugin, Fabric client mod, later NeoForge). The
security invariants here are load-bearing — see `SECURITY.md` and the CLAUDE.md
standing instruction; do not weaken them in any implementation.

## Transport

**Newline-delimited JSON (NDJSON) over a TCP socket bound to `127.0.0.1` only**, on
an **ephemeral port** chosen by the agent at enable time.

> Amendment (2026-07-23): the roadmap sketch said WebSocket. NDJSON/TCP was chosen at
> implementation time because both sides get it with **zero dependencies**
> (`java.net.ServerSocket` / node `net.Socket`) — no WS library shaded into agent
> jars, no extra attack surface — and the security posture is identical: same
> loopback-only bind, same token. Recorded in `notes/decisions/architecture.md`.

- One JSON object per line (`\n`-terminated, UTF-8). No pretty-printing on the wire.
- The agent **hard-rejects** any bind address other than the loopback; there is no
  configuration to widen it, by design.

## Discovery — the handshake file

When (and only when) an agent is enabled, it writes a handshake file inside its own
data directory:

```
<server>/plugins/<agent-name>/handshake.json     (Paper)
<client>/config/<agent-name>/handshake.json      (Fabric, Phase 4)
```

```json
{ "v": 1, "port": 54321, "token": "<64 hex chars>", "pid": 12345, "agent": "paper" }
```

- `token` is **256 bits from a CSPRNG**, minted fresh per enable; never logged.
- The file is deleted on clean disable/shutdown. A stale file (crash) simply points
  at a dead port — connecting fails, nothing is exposed.
- The driver locates the file via the server/client directory it already manages.

## Session

1. **Hello.** First line from the client MUST be
   `{"type":"hello","v":1,"token":"…"}`.
   Wrong/missing token, malformed JSON, or any other first message → the agent
   closes the connection immediately (no error detail — nothing to probe).
2. **Welcome.** Agent replies
   `{"type":"welcome","v":1,"agent":"paper","capabilities":["state","exec"],"events":["player_join","player_quit"]}`.
3. **Requests.** `{"type":"req","id":<int>,"op":"<capability>", …params}` →
   exactly one `{"type":"res","id":<same>,"ok":true, …result}` or
   `{"type":"res","id":<same>,"ok":false,"error":"…"}`. Ids are chosen by the
   client; responses may arrive out of order.
4. **Events.** The agent may interleave `{"type":"event","name":"…","data":{…}}`
   lines at any time after welcome.
5. **Goodbye.** Either side just closes the socket. The agent keeps serving new
   connections until disabled.

## v1 capabilities (Paper agent)

| op | params | result |
|----|--------|--------|
| `state` | — | `{"tps":[…] or null,"players":[{name,uuid}],"worlds":[{name,entities,loadedChunks}],"version":"…"}` (fields degrade to null where a platform can't answer) |
| `exec` | `{"command":"say hi"}` | `{"dispatched":true/false}` — dispatched as console, on the main thread |

Additions (teleports, inventory, world edits, the reflection gateway with its
read/write grants) arrive in later phases as new `op`s + capability strings; the
envelope above does not change. **Reflection writes will require an explicit
per-session grant op** — recorded here so no implementation forgets it.

## Threading rules (agent side)

Socket I/O runs on daemon threads; anything touching game state is marshalled to
the main thread (Bukkit scheduler / client executor) and awaited with a timeout, so
a stuck request can never wedge the game loop.
