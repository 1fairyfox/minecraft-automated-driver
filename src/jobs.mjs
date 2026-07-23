// Job model — long operations return an id immediately; poll status, tail the log,
// kill via AbortController. First consumers: the L1 gradle/server operations.
const LOG_CAP = 2000; // ring buffer — enough context, bounded memory

export function createJobRegistry({ logCap = LOG_CAP } = {}) {
  const jobs = new Map();
  let counter = 0;

  return {
    /**
     * Start a job. fn receives { signal, log } and its resolution settles the job.
     * Returns the public record immediately (status 'running').
     */
    start(name, fn) {
      const id = `j${++counter}`;
      const controller = new AbortController();
      const job = {
        id,
        name,
        status: 'running',
        startedAt: new Date().toISOString(),
        endedAt: null,
        result: null,
        error: null,
        logs: [],
        dropped: 0,
        controller,
      };
      jobs.set(id, job);

      const log = (line) => {
        job.logs.push(String(line));
        if (job.logs.length > logCap) {
          job.logs.shift();
          job.dropped += 1;
        }
      };

      Promise.resolve()
        .then(() => fn({ signal: controller.signal, log }))
        .then((result) => {
          job.status = controller.signal.aborted ? 'killed' : 'succeeded';
          job.result = result ?? null;
        })
        .catch((err) => {
          job.status = controller.signal.aborted ? 'killed' : 'failed';
          job.error = err.message;
        })
        .finally(() => {
          job.endedAt = new Date().toISOString();
        });

      return this.status(id);
    },

    /** Public snapshot (no controller, no full log). */
    status(id) {
      const job = jobs.get(id);
      if (!job) return null;
      const { controller, logs, ...pub } = job;
      return { ...pub, logLines: logs.length };
    },

    list() {
      return [...jobs.keys()].map((id) => this.status(id));
    },

    /** Tail of the log (most recent `tail` lines; whole buffer by default). */
    log(id, { tail } = {}) {
      const job = jobs.get(id);
      if (!job) return null;
      const lines = tail ? job.logs.slice(-tail) : [...job.logs];
      return { id, dropped: job.dropped, lines };
    },

    /** Signal abort; the job's fn decides how to die (process kill etc.). */
    kill(id) {
      const job = jobs.get(id);
      if (!job) return null;
      if (job.status === 'running') job.controller.abort();
      return this.status(id);
    },

    /** Await settlement — for tests and for tools that want to block briefly. */
    async wait(id, { timeoutMs = 30_000, pollMs = 25 } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const snap = this.status(id);
        if (!snap) return null;
        if (snap.status !== 'running') return snap;
        await new Promise((r) => setTimeout(r, pollMs));
      }
      return this.status(id);
    },
  };
}
