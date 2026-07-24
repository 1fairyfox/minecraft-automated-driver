// Driver-side control-plane client (docs/control-protocol.md): read a handshake file,
// connect to the loopback agent, do the hello/auth, correlate req/res, buffer events.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import net from 'node:net';

/** Read + validate an agent handshake.json from a server/client data dir. */
export async function readHandshake(dir, { agentName = 'minecraft-automated-driver-agent' } = {}) {
  const path = join(dir, 'plugins', agentName, 'handshake.json');
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new Error(`no agent handshake at ${path} — is the agent enabled?`);
  }
  const hs = JSON.parse(raw);
  if (hs.v !== 1 || !hs.port || !hs.token) throw new Error('handshake.json is malformed');
  return hs;
}

/**
 * Connect to an agent. Resolves once the welcome is received.
 * @returns a connection with { welcome, request(op, params), events(), close() }.
 */
export function connectAgent({ port, token, host = '127.0.0.1', connectImpl = net.connect } = {}) {
  return new Promise((resolve, reject) => {
    const socket = connectImpl({ port, host });
    const pending = new Map(); // id → {resolve, reject}
    const eventBuffer = [];
    let welcome = null;
    let nextId = 0;
    let buffer = '';

    const fail = (err) => {
      for (const { reject: rej } of pending.values()) rej(err);
      pending.clear();
      socket.destroy(); // release the handle on any failure — no half-open lingering
      if (!welcome) reject(err);
    };

    socket.on('error', (err) => fail(new Error(`agent connection failed: ${err.message}`)));
    socket.on('close', () => fail(new Error('agent connection closed')));

    socket.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.trim() === '') continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === 'welcome') {
          welcome = msg;
          resolve(api);
        } else if (msg.type === 'event') {
          eventBuffer.push({ name: msg.name, data: msg.data, at: new Date().toISOString() });
        } else if (msg.type === 'res') {
          const waiter = pending.get(msg.id);
          if (waiter) {
            pending.delete(msg.id);
            const { type, id, ok, error, ...rest } = msg;
            ok ? waiter.resolve(rest) : waiter.reject(new Error(error || 'agent error'));
          }
        }
      }
    });

    const api = {
      get welcome() { return welcome; },
      request(op, params = {}, { timeoutMs = 15_000 } = {}) {
        const id = ++nextId;
        return new Promise((res, rej) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            rej(new Error(`agent op '${op}' timed out`));
          }, timeoutMs);
          pending.set(id, {
            resolve: (v) => { clearTimeout(timer); res(v); },
            reject: (e) => { clearTimeout(timer); rej(e); },
          });
          socket.write(`${JSON.stringify({ type: 'req', id, op, ...params })}\n`);
        });
      },
      events() { return [...eventBuffer]; },
      close() { socket.destroy(); },
    };

    // Hello must be the first line we send, once the socket is up.
    socket.on('connect', () => socket.write(`${JSON.stringify({ type: 'hello', v: 1, token })}\n`));
  });
}
