import type { PodRouteDescriptor } from "@pe/agent-contracts";

/** Removal invalidates an in-flight import as well as a mounted registration. */
export function createPodRouteLoader(
  load: (row: PodRouteDescriptor, current: () => boolean) => Promise<() => void>,
) {
  const active = new Map<string, { hash: string; dispose?: () => void; pending?: Promise<void> }>();
  const remove = (key: string) => {
    const entry = active.get(key);
    active.delete(key);
    entry?.dispose?.();
  };
  return {
    async sync(rows: readonly PodRouteDescriptor[]) {
      const trusted = new Map(rows.filter((row) => row.trusted).map((row) => [row.key, row]));
      for (const [key, entry] of active)
        if (trusted.get(key)?.fingerprint !== entry.hash) remove(key);
      for (const row of trusted.values()) {
        if (active.has(row.key)) continue;
        const entry: { hash: string; dispose?: () => void; pending?: Promise<void> } = {
          hash: row.fingerprint,
        };
        active.set(row.key, entry);
        entry.pending = load(row, () => active.get(row.key) === entry)
          .then((dispose) => {
            if (active.get(row.key) === entry) entry.dispose = dispose;
            else dispose();
          })
          .catch((error: unknown) => {
            if (active.get(row.key) === entry) active.delete(row.key);
            throw error;
          });
      }
      return Promise.allSettled(
        [...active.values()].flatMap((entry) => (entry.pending ? [entry.pending] : [])),
      );
    },
    dispose() {
      for (const key of active.keys()) remove(key);
    },
  };
}
