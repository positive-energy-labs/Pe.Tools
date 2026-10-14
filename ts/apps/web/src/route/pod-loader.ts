import type { PodRouteDescriptor } from "@pe/agent-contracts";
export type { PodRouteDescriptor } from "@pe/agent-contracts";

/** Verify the authenticated response before evaluating any module code. */
export async function verifyBundle(bytes: Uint8Array, hash: string) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  const actual = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (actual !== hash)
    throw Error("Pod route bytes changed; trust the current hash before loading.");
}

/** Removal invalidates an in-flight import as well as a mounted registration. */
export function createPodRouteLoader(load: (row: PodRouteDescriptor) => Promise<() => void>) {
  const active = new Map<string, { hash: string; dispose?: () => void; pending?: Promise<void> }>();
  const remove = (key: string) => {
    const entry = active.get(key);
    active.delete(key);
    entry?.dispose?.();
  };
  return {
    async sync(rows: readonly PodRouteDescriptor[]) {
      const trusted = new Map(rows.filter((row) => row.trusted).map((row) => [row.key, row]));
      for (const [key, entry] of active) if (trusted.get(key)?.sha256 !== entry.hash) remove(key);
      const pending: Promise<void>[] = [];
      for (const row of trusted.values()) {
        const present = active.get(row.key);
        if (present) {
          if (present.pending) pending.push(present.pending);
          continue;
        }
        const entry: { hash: string; dispose?: () => void; pending?: Promise<void> } = {
          hash: row.sha256,
        };
        active.set(row.key, entry);
        entry.pending = load(row)
          .then((dispose) => {
            if (active.get(row.key) === entry) entry.dispose = dispose;
            else dispose();
          })
          .catch((error: unknown) => {
            if (active.get(row.key) === entry) active.delete(row.key);
            throw error;
          });
        pending.push(entry.pending);
      }
      return Promise.allSettled(pending);
    },
    dispose() {
      for (const key of active.keys()) remove(key);
    },
  };
}
