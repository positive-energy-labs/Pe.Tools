/** Worker-only comparison; the interaction thread copies only containers with changed children. */
export type PricingDelta =
  | { kind: "replace"; value: unknown }
  | {
      kind: "map" | "array" | "object";
      edits: [string | number, PricingDelta][];
      removed: (string | number)[];
    };

const entries = (value: object): [string | number, unknown][] =>
  value instanceof Map ? [...value.entries()] : Object.entries(value);

export function pricingDelta(before: unknown, after: unknown): PricingDelta | undefined {
  if (Object.is(before, after)) return undefined;
  if (!before || !after || typeof before !== "object" || typeof after !== "object")
    return { kind: "replace", value: after };
  const kind = (v: object) =>
    v instanceof Map
      ? "map"
      : Array.isArray(v)
        ? "array"
        : Object.getPrototypeOf(v) === Object.prototype
          ? "object"
          : "replace";
  const type = kind(after);
  if (
    type === "replace" ||
    kind(before) !== type ||
    (Array.isArray(after) && after.length !== (before as unknown[]).length)
  )
    return { kind: "replace", value: after };
  const old = new Map(entries(before));
  const edits: [string | number, PricingDelta][] = [];
  for (const [key, value] of entries(after)) {
    const delta = old.has(key)
      ? pricingDelta(old.get(key), value)
      : { kind: "replace" as const, value };
    if (delta) edits.push([key, delta]);
    old.delete(key);
  }
  return edits.length || old.size ? { kind: type, edits, removed: [...old.keys()] } : undefined;
}

export function applyPricingDelta(before: unknown, delta: PricingDelta): unknown {
  if (delta.kind === "replace") return delta.value;
  if (delta.kind === "map") {
    const result = new Map(before as Map<string | number, unknown>);
    for (const key of delta.removed) result.delete(key);
    for (const [key, child] of delta.edits)
      result.set(key, applyPricingDelta(result.get(key), child));
    return result;
  }
  const result = (
    delta.kind === "array" ? [...(before as unknown[])] : { ...(before as object) }
  ) as Record<string | number, unknown>;
  for (const key of delta.removed) delete result[key];
  for (const [key, child] of delta.edits)
    Object.defineProperty(result, key, {
      value: applyPricingDelta(result[key], child),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  return result;
}
