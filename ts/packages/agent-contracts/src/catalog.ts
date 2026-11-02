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
}
export interface CatalogLink extends CatalogAxes {
  key: string;
  uses: readonly (
    | string
    | { key: string; cardinality: Value<typeof opCardinality>; cap?: number }
  )[];
  derive?: string;
  preview?: string;
}
const weight = { Cheap: 1, Bounded: 10, Expensive: 100, Mutation: 100 };
/** Validate edges only. Execution, derivation and preview remain in named runtime functions. */
export function linkCatalog(entries: readonly CatalogLink[]): string[] {
  const errors: string[] = [];
  const byKey = new Map<string, CatalogLink>();
  for (const entry of entries) {
    if (byKey.has(entry.key)) errors.push(`Duplicate catalog key: ${entry.key}`);
    if (
      entry.touches.includes("Geometry") &&
      entry.cardinality === "Many" &&
      (!entry.cap || !Number.isSafeInteger(entry.cap) || entry.cap < 1)
    )
      errors.push(`${entry.key}: geometry over many subjects requires a cap`);
    byKey.set(entry.key, entry);
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
  entries.forEach(visit);
  return errors;
}
