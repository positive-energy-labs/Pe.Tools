/** Resident result bytes are disposable; receipt ids remain recoverable from the durable journal. */
export function createAdmittedRetention<V>(limits: { entries: number; bytes: number }) {
  const rows = new Map<string, { value: V; bytes: number }>();
  let bytes = 0;
  const remove = (id: string) => {
    const prior = rows.get(id);
    if (prior) bytes -= prior.bytes;
    rows.delete(id);
  };
  return {
    get: (id: string) => rows.get(id)?.value,
    values: () => [...rows.values()].map(row => row.value),
    entries: () => [...rows].map(([id, row]): [string, V] => [id, row.value]),
    delete: remove,
    set(id: string, value: V) {
      const size = new TextEncoder().encode(JSON.stringify(value)).byteLength;
      const prior = rows.get(id)?.bytes ?? 0;
      if (rows.size + (rows.has(id) ? 0 : 1) > limits.entries || bytes - prior + size > limits.bytes)
        return { kind: "overload", entries: limits.entries, bytes: limits.bytes } satisfies {kind: "overload" | "stored"; entries?: number; bytes?: number};
      remove(id);
      rows.set(id, {value, bytes: size});
      bytes += size;
      return {kind: "stored"} satisfies {kind: "overload" | "stored"; entries?: number; bytes?: number};
    },
    clear() {rows.clear(); bytes = 0;},
  };
}
export class InvocationOverload extends Error {
  readonly kind = "overload";
  constructor(readonly collection: "preparing" | "landings") {
    super(`Invocation ${collection} retention limit exceeded`);
  }
}
