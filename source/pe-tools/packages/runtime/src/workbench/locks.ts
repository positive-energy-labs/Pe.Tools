export interface RunLease {
  release(): void;
}

export type RunLeaseResult = { ok: true; lease: RunLease } | { ok: false; owner: string };

export function createRunLocks() {
  const activeRuns = new Map<string, string>();

  return {
    acquire(threadId: string, clientId: string): RunLeaseResult {
      const owner = activeRuns.get(threadId);
      if (owner && owner !== clientId) return { ok: false, owner };

      activeRuns.set(threadId, clientId);
      let released = false;
      return {
        ok: true,
        lease: {
          release() {
            if (released) return;
            released = true;
            // ponytail: thread-wide lease matches current web behavior; split by run id if
            // same-tab concurrent sends ever become real.
            if (activeRuns.get(threadId) === clientId) activeRuns.delete(threadId);
          },
        },
      };
    },
  };
}
