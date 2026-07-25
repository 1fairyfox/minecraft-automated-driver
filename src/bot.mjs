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

/** Best-effort entity type name across mineflayer versions (mobs expose `name`, e.g. "zombie"). */
function entityName(e) {
  return e?.name ?? e?.mobType ?? e?.displayName ?? null;
}

/** Race a promise against a timeout that rejects with a labelled error; clears the timer either way. */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([Promise.resolve(promise).finally(() => clearTimeout(timer)), timeout]);
}

/** Attack one entity until it's gone (killed) or a timeout; always stops pvp on the way out. */
function huntOne(bot, target, timeoutMs) {
  return new Promise((resolve, reject) => {
    const targetId = target.id;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      bot.removeListener('entityGone', onGone);
      try { bot.pvp?.stop(); } catch { /* already stopped */ }
    };
    const onGone = (e) => {
      if (settled || e?.id !== targetId) return;
      settled = true; cleanup(); resolve();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true; cleanup(); reject(new Error(`hunt of entity ${targetId} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    bot.on('entityGone', onGone);
    Promise.resolve(bot.pvp.attack(target)).catch((err) => {
      if (settled) return;
      settled = true; cleanup(); reject(new Error(err?.message ?? String(err)));
    });
  });
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

    /**
     * Gather (mine/chop/collect) blocks by name via mineflayer-collectblock — find the nearest
     * matching block, path to it, auto-equip the best tool, mine, and collect the drop, `count`
     * times. The bot's NATIVE `gather` capability; the goal engine delegates here.
     */
    async gather(id, { block, count = 1, maxDistance = 64, timeoutMs = 60_000 } = {}) {
      const b = record(id);
      if (!block) throw new Error('gather needs a block name');
      if (!b.bot.collectBlock) throw new Error('collectBlock plugin is not loaded on this bot');
      const type = b.bot.registry?.blocksByName?.[block];
      if (!type) throw new Error(`unknown block '${block}'`);
      const positions = [];
      for (let i = 0; i < count; i++) {
        const target = b.bot.findBlock({ matching: type.id, maxDistance });
        if (!target) break; // no more of that block in range — report what we got
        await withTimeout(b.bot.collectBlock.collect(target), timeoutMs, `gather ${block}`);
        const p = target.position;
        positions.push({ x: p.x, y: p.y, z: p.z });
      }
      return { block, requested: count, gathered: positions.length, positions };
    },

    /**
     * Hunt (attack) mobs by name via mineflayer-pvp — optionally equip a weapon first, target the
     * nearest matching entity within range, attack until it's gone (killed) or a timeout, then
     * stop; `count` times. The bot's NATIVE `hunt` capability.
     */
    async hunt(id, { mob, count = 1, weapon = null, maxDistance = 32, timeoutMs = 30_000 } = {}) {
      const b = record(id);
      if (!mob) throw new Error('hunt needs a mob name');
      if (!b.bot.pvp) throw new Error('pvp plugin is not loaded on this bot');
      if (weapon) await this.equip(id, { item: weapon });
      let killed = 0;
      for (let i = 0; i < count; i++) {
        const self = b.bot.entity?.position;
        const target = b.bot.nearestEntity((e) => entityName(e) === mob
          && (!self || !e.position || e.position.distanceTo(self) <= maxDistance));
        if (!target) break; // none of that mob in range — report the kills so far
        await huntOne(b.bot, target, timeoutMs);
        killed += 1;
      }
      return { mob, requested: count, killed };
    },

    /** Equip an item/tool/weapon (by inventory name) to a destination (default the main hand). */
    async equip(id, { item, destination = 'hand' } = {}) {
      const b = record(id);
      if (!item) throw new Error('equip needs an item name');
      const found = (b.bot.inventory?.items?.() ?? []).find((it) => it.name === item);
      if (!found) throw new Error(`no '${item}' in inventory to equip`);
      await b.bot.equip(found, destination);
      return { equipped: item, destination };
    },

    /**
     * Craft an item by name, `count` times, from the bot's inventory — table-aware: a crafting
     * table in reach unlocks 3x3 recipes, else only the 2x2 inventory grid. Core Mineflayer
     * (`recipesFor`/`craft`); the bot's NATIVE `craft` capability.
     */
    async craft(id, { item, count = 1 } = {}) {
      const b = record(id);
      if (!item) throw new Error('craft needs an item name');
      const itemType = b.bot.registry?.itemsByName?.[item];
      if (!itemType) throw new Error(`unknown item '${item}'`);
      const tableType = b.bot.registry?.blocksByName?.crafting_table;
      const table = tableType ? b.bot.findBlock({ matching: tableType.id, maxDistance: 4 }) : null;
      const recipes = b.bot.recipesFor(itemType.id, null, 1, table) ?? [];
      if (recipes.length === 0) {
        throw new Error(`no craftable recipe for '${item}'${table ? '' : ' (a crafting table may be needed — none in reach)'} — missing ingredients?`);
      }
      await b.bot.craft(recipes[0], count, table);
      return { crafted: item, count, usedTable: Boolean(table) };
    },

    /**
     * Place a block (by inventory name) at (x,y,z) — equip it, then place against the block below
     * the target (top face). Core Mineflayer (`placeBlock`); the bot's NATIVE `place` capability.
     */
    async place(id, { block, x, y, z } = {}) {
      const b = record(id);
      if (!block) throw new Error('place needs a block name');
      if ([x, y, z].some((n) => typeof n !== 'number')) throw new Error('place needs numeric x, y, z');
      const item = (b.bot.inventory?.items?.() ?? []).find((it) => it.name === block);
      if (!item) throw new Error(`no '${block}' in inventory to place`);
      await b.bot.equip(item, 'hand');
      const below = b.bot.blockAt(b.bot.vec3(x, y - 1, z));
      if (!below || below.name === 'air') throw new Error(`nothing to place against below (${x},${y - 1},${z})`);
      await b.bot.placeBlock(below, b.bot.vec3(0, 1, 0));
      return { placed: block, position: { x, y, z } };
    },

    /** Build a small structure — place a list of `{block,x,y,z}` in order. Composes `place`. */
    async build(id, { blocks = [] } = {}) {
      record(id); // validate the bot exists up front
      if (!Array.isArray(blocks) || blocks.length === 0) throw new Error('build needs a non-empty blocks list');
      const placed = [];
      for (const spec of blocks) {
        await this.place(id, spec);
        placed.push({ block: spec.block, x: spec.x, y: spec.y, z: spec.z });
      }
      return { placed: placed.length, blocks: placed };
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
