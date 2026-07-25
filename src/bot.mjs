// L2 protocol-bot lane — Mineflayer players (headless, protocol-level; no render). Cheap
// behaviour/load checks and CI smoke against local online-mode=false test servers.
//
// The mineflayer factory is injected so the registry logic is unit-testable without a real
// server; the real thing is exercised by scripts/bot-smoke.mjs (local + CI).

/**
 * Loopback hosts a bot may connect to without an explicit remote opt-in. A Mineflayer bot
 * parses the server's packets IN THIS (trusted) process, so connecting to an untrusted server
 * means processing hostile input in-process — see SECURITY.md / notes/security/threat-model.md.
 */
export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().trim();
  return h === 'localhost' || h === '::1' || h === '::ffff:127.0.0.1' || h === '127.0.0.1' || h.startsWith('127.');
}

/**
 * A recent-message ring buffer + the live bot handle, keyed by a registry id.
 * @param {object} deps
 * @param {(opts)=>object} deps.createBot  mineflayer factory (injected for tests)
 * @param {(x,y,z,range)=>object} [deps.goalNear]  builds a pathfinder GoalNear (injected)
 */
export function createBotRegistry({ createBot, goalNear, logCap = 200 } = {}) {
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
    async join({ host = '127.0.0.1', port = 25565, username = 'DriverBot', timeoutMs = 30_000, allowRemote = false } = {}) {
      // A bot parses the server's packets IN THIS PROCESS, so a hostile/compromised server gets
      // to feed untrusted input to the trusted driver. Refuse a non-loopback host unless the
      // caller explicitly opts in for a server it trusts (SECURITY.md / threat-model).
      if (!allowRemote && !isLoopbackHost(host)) {
        throw new Error(
          `refusing to join non-loopback host '${host}': a bot parses that server's packets in-process, `
          + 'so an untrusted server could attack the driver. Pass allowRemote:true to connect to a server you trust.',
        );
      }
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

    /**
     * A*-navigate to a block via mineflayer-pathfinder (real walk/jump/parkour). This is the
     * bot's NATIVE `navigate` capability; the goal engine delegates to it. Resolves on arrival,
     * rejects on no-path/timeout.
     */
    async navigate(id, { x, y, z, range = 1, timeoutMs = 60_000 }) {
      const b = record(id);
      if (!b.bot.pathfinder) throw new Error('pathfinder is not loaded on this bot');
      if (typeof goalNear !== 'function') throw new Error('bot registry has no goalNear factory');
      const goto = b.bot.pathfinder.goto(goalNear(x, y, z, range));
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`navigate to ${x},${y},${z} timed out`)), timeoutMs);
        goto.then(() => { clearTimeout(timer); resolve(); }, (err) => { clearTimeout(timer); reject(new Error(err?.message ?? String(err))); });
      });
      const p = b.bot.entity?.position ?? null;
      return { arrived: true, position: p ? { x: p.x, y: p.y, z: p.z } : null };
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
