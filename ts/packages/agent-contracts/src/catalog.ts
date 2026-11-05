import {
  opSubject,
  opTouches,
  opEffect,
  opCardinality,
  opCost,
} from "@pe/host-contracts/generated";
export { opSubject, opTouches, opEffect, opCardinality, opCost };
type Value<T> = T[keyof T];
export interface CatalogAxes {
  subject: Value<typeof opSubject>;
  touches: readonly Value<typeof opTouches>[];
  effect: Value<typeof opEffect>;
  cost: Value<typeof opCost>;
  cardinality: Value<typeof opCardinality>;
  cap?: number;
  internal?: boolean;
  /** TransactRead's declaration that every transaction it opens is rolled back (ADR 0028). */
  rollsBack?: boolean;
}
export interface CatalogLink extends CatalogAxes {
  key: string;
  uses: readonly (
    | string
    | { key: string; cardinality: Value<typeof opCardinality>; cap?: number }
  )[];
  /** A ModelWrite's seal-at-preview entry: TransactRead, rolled back, same Touches. */
  previewBy?: string;
  derive?: NonNullable<import("./command.ts").Command["derivation"]>["derive"];
  preview?: NonNullable<import("./command.ts").Command["derivation"]>["preview"];
}
const weight = { Cheap: 1, Bounded: 10, Expensive: 100, Mutation: 100 };
/** Validate edges only. Execution, derivation and preview remain in named runtime functions. */
export function linkCatalog(entries: readonly CatalogLink[]): string[] {
  const errors: string[] = [];
  const byKey = new Map<string, CatalogLink>();
  for (const entry of entries) {
    for (const [axis, values] of Object.entries({
      subject: opSubject,
      effect: opEffect,
      cost: opCost,
      cardinality: opCardinality,
    }))
      if (
        (entry as unknown as Record<string, string>)[axis] === "Unset" ||
        !(Object.values(values) as readonly string[]).includes(
          (entry as unknown as Record<string, string>)[axis]!,
        )
      )
        errors.push(`${entry.key}: missing or invalid ${axis}`);
    if (
      !Array.isArray(entry.touches) ||
      !entry.touches.length ||
      entry.touches.some((value) => value === "Unset" || !Object.values(opTouches).includes(value))
    ) {
      errors.push(`${entry.key}: missing or invalid touches`);
      continue;
    }
    if (!Array.isArray(entry.uses)) {
      errors.push(`${entry.key}: missing uses`);
      continue;
    }
    if (
      entry.key.startsWith("command:") &&
      entry.effect === "ModelWrite" &&
      (typeof entry.derive !== "function" || typeof entry.preview !== "function")
    )
      errors.push(`${entry.key}: missing executable derive/preview binding`);
    if (entry.effect === "TransactRead" && entry.rollsBack !== true)
      errors.push(`${entry.key}: TransactRead must declare rollback`);
    if (entry.key.startsWith("command:") && entry.effect === "ModelWrite" && !entry.previewBy)
      errors.push(`${entry.key}: ModelWrite has no preview binding`);
    if (byKey.has(entry.key)) errors.push(`Duplicate catalog key: ${entry.key}`);
    if (
      entry.touches.includes("Geometry") &&
      entry.cardinality === "Many" &&
      (!entry.cap || !Number.isSafeInteger(entry.cap) || entry.cap < 1)
    )
      errors.push(`${entry.key}: geometry over many subjects requires a cap`);
    byKey.set(entry.key, entry);
  }
  // The seal binds at the plan (ADR 0030 rule 4): a Read with an empty footprint, or a TransactRead
  // rehearsal that rolls back (the rollback check above). Recheck at apply binds to the write.
  for (const entry of byKey.values()) {
    if (!entry.previewBy) continue;
    const preview = byKey.get(entry.previewBy);
    if (!preview) errors.push(`${entry.key}: unknown preview ${entry.previewBy}`);
    else if (preview.effect !== "Read" && preview.effect !== "TransactRead")
      errors.push(`${entry.key}: plan ${preview.key} is ${preview.effect}, not Read or TransactRead`);
    else if ([...preview.touches].sort().join() !== [...entry.touches].sort().join())
      errors.push(`${entry.key}: preview ${preview.key} touches differ`);
  }
  const visited = new Set<string>(),
    active = new Set<string>();
  function visit(entry: CatalogLink) {
    if (active.has(entry.key)) {
      errors.push(`Catalog cycle: ${[...active, entry.key].join(" -> ")}`);
      return;
    }
    if (visited.has(entry.key)) return;
    active.add(entry.key);
    for (const use of entry.uses) {
      const edge = typeof use === "string" ? { key: use, cardinality: "One" as const } : use;
      const child = byKey.get(edge.key);
      if (!child) {
        errors.push(`${entry.key}: unknown dependency ${edge.key}`);
        continue;
      }
      visit(child);
      const multiplier = edge.cardinality === "Many" ? (edge.cap ?? Infinity) : 1;
      const budget =
        weight[entry.cost] * (entry.cardinality === "Many" ? (entry.cap ?? Infinity) : 1);
      if (
        budget <
        weight[child.cost] *
          (child.cardinality === "Many" ? (child.cap ?? Infinity) : 1) *
          multiplier
      )
        errors.push(`${entry.key}: cost understates ${child.key}`);
    }
    active.delete(entry.key);
    visited.add(entry.key);
  }
  byKey.forEach(visit);
  return errors;
}

/** Runtime trust boundary: boot and dynamic admission use the same linker. */
export function requireLinkedCatalog(entries: readonly CatalogLink[]): void {
  const errors = linkCatalog(entries);
  if (errors.length) throw Error(`Catalog refused:\n${errors.join("\n")}`);
}

/**
 * Step 5 seam: the one linked export. Every axis, edge, plan binding and cost is checked once
 * (`linkCatalog`); host boot, route admission, trusted Pod admission and Pea read this, never a flat
 * array they relink. Callers still on `linkCatalog`/`requireLinkedCatalog` move here in the fill.
 */
export interface LinkedCatalog<E extends CatalogLink = CatalogLink> {
  readonly entries: ReadonlyMap<string, Readonly<E>>;
  /** Dependency order: each key after every key it uses. */
  readonly order: readonly string[];
  /** Link a route module's or trusted Pod's entries against this catalog, as one new export. */
  extend<X extends CatalogLink>(more: readonly X[]): LinkResult<E | X>;
}
export type LinkResult<E extends CatalogLink = CatalogLink> =
  | { readonly ok: true; readonly catalog: LinkedCatalog<E> }
  | { readonly ok: false; readonly errors: readonly string[] };

export function link<E extends CatalogLink>(entries: readonly E[]): LinkResult<E> {
  const errors = linkCatalog(entries);
  if (errors.length) return { ok: false, errors: Object.freeze(errors) };
  const byKey = new Map(entries.map((entry) => [entry.key, Object.freeze({ ...entry })]));
  const order = new Set<string>();
  const visit = (key: string) => {
    if (order.has(key)) return;
    for (const use of byKey.get(key)!.uses) visit(typeof use === "string" ? use : use.key);
    order.add(key);
  };
  byKey.forEach((_, key) => visit(key));
  const catalog: LinkedCatalog<E> = Object.freeze({
    entries: byKey,
    order: Object.freeze([...order]),
    extend: <X extends CatalogLink>(more: readonly X[]) => link<E | X>([...entries, ...more]),
  });
  return { ok: true, catalog };
}
