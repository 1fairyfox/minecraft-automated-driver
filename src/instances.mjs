// Instance registry — everything the driver knows it spawned (and, in later phases,
// attached to). Pure in-memory bookkeeping; liveness is the OS layer's business.
export function createInstanceRegistry() {
  const items = new Map();
  let counter = 0;

  return {
    add({ kind, pid, command = null, title = null }) {
      const id = `i${++counter}`;
      const record = { id, kind, pid, command, title, openedAt: new Date().toISOString() };
      items.set(id, record);
      return record;
    },
    get(id) {
      return items.get(id) ?? null;
    },
    remove(id) {
      return items.delete(id);
    },
    list() {
      return [...items.values()];
    },
  };
}
