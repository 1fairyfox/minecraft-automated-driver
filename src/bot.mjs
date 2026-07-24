// L2 protocol-bot lane — Mineflayer players (headless, protocol-level; no render). Cheap
// behaviour/load checks and CI smoke against local online-mode=false test servers.
//
// The mineflayer factory is injected so the registry logic is unit-testable without a real
// server; the real thing is exercised by scripts/bot-smoke.mjs (local + CI).

/** A recent-message ring buffer + the live bot handle, keyed by a registry id. */
export function createBotRegistry({ createBot, logCap = 200 } = {}) {
  if (typeof createBot !== 'function') {
    throw new Error('createBotRegistry needs a { createBot } mineflayer factory');
  }
  const bots = new Map();
  let counter = 0;

  function record(id) {
    const b = bots.get(id);
    if (!b) throw new Error(`no bot ${id}`);
    return b;
  }

  return {
    /**
     * Join a server. Resolves once the bot has spawned (or rejects on kick/error/timeout).
     * @returns { botId, username }
     */
    async join({ host = '127.0.0.1', port = 25565, username = 'DriverBot', timeoutMs = 30_000 } = {}) {
      const id = `b${++counter}`;
      const bot = createBot({ host, port, username, auth: 'offline' });
      const messages = [];
      bot.on('message', (msg) => {
        messages.push({ text: msg?.toString?.() ?? String(msg), at: new Date().toISOString() });
        if (messages.length > logCap) messages.shift();
      });
      const entry = { id, bot, username, host, port, messages, state: 'joining' };
      bots.set(id, entry);

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`bot ${username} join timed out`)), timeoutMs);
        const settle = (fn) => { clearTimeout(timer); fn(); };
        bot.once('spawn', () => settle(() => { entry.state = 'spawned'; resolve(); }));
        bot.once('kicked', (reason) => settle(() => reject(new Error(`kicked: ${reason}`))));
        bot.once('error', (err) => settle(() => reject(new Error(err.message ?? String(err)))));
      });
      return { botId: id, username };
    },

    /** Current position + a few vitals. */
    status(id) {
      const b = record(id);
      const pos = b.bot.entity?.position ?? null;
      return {
        id: b.id,
        username: b.username,
        state: b.state,
        position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
        health: b.bot.health ?? null,
        food: b.bot.food ?? null,
      };
    },

    /** Send a chat line / command. */
    chat(id, message) {
      record(id).bot.chat(message);
      return { sent: message };
    },

    /** Drain buffered chat the bot has received. */
    messages(id, { tail } = {}) {
      const b = record(id);
      const lines = tail ? b.messages.slice(-tail) : [...b.messages];
      return { id, lines };
    },

    /** Walk to an absolute block position by holding the forward keybinding while facing it. */
    async moveTo(id, { x, y, z, timeoutMs = 15_000 }) {
      const b = record(id);
      const target = b.bot.vec3 ? b.bot.vec3(x, y, z) : { x, y, z };
      await b.bot.lookAt(target, true);
      b.bot.setControlState('forward', true);
      const deadline = Date.now() + timeoutMs;
      try {
        while (Date.now() < deadline) {
          const p = b.bot.entity?.position;
          if (p && Math.hypot(p.x - x, p.z - z) < 1.0) break;
          await new Promise((r) => setTimeout(r, 100));
        }
      } finally {
        b.bot.setControlState('forward', false);
      }
      const p = b.bot.entity?.position ?? null;
      return { arrived: p ? Math.hypot(p.x - x, p.z - z) < 1.5 : false, position: p ? { x: p.x, y: p.y, z: p.z } : null };
    },

    /** Inventory item list. */
    inventory(id) {
      const b = record(id);
      const items = (b.bot.inventory?.items?.() ?? []).map((it) => ({ name: it.name, count: it.count, slot: it.slot }));
      return { id, items };
    },

    list() {
      return [...bots.values()].map((b) => ({ id: b.id, username: b.username, state: b.state, host: b.host, port: b.port }));
    },

    /** Disconnect + forget a bot. */
    quit(id) {
      const b = record(id);
      try { b.bot.quit(); } catch { /* already gone */ }
      bots.delete(id);
      return { quit: id };
    },
  };
}
