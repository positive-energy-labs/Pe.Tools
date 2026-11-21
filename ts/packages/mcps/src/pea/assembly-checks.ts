import type { LocalOperation } from "@pe/agent-contracts/product";
import type { HostLocalCatalogEntry } from "@pe/host-contracts/operation-types";

/** The catalog rows of one product's local operations: each declaration is its own row. */
export const localCatalog = <K extends string>(
  local: Readonly<Record<K, LocalOperation>>,
): HostLocalCatalogEntry<K>[] =>
  Object.entries<LocalOperation>(local).map(([key, entry]) => ({
    subject: "None",
    touches: "Metadata",
    cardinality: "One",
    origin: "host-local",
    visibility: "DefaultVisible",
    needs: "nothing",
    key: key as K,
    displayName: entry.displayName,
    description: entry.says,
    effect: entry.effect ?? "Read",
    costTier: entry.costTier ?? "Cheap",
    requestTypeName: entry.requestTypeName,
    responseTypeName: entry.responseTypeName,
    searchTerms: entry.searchTerms,
  }));

/** Refuse a duplicate declaration before merging the source records. */
export function assertUniqueProductKeys(
  kind: string,
  definitions: readonly Readonly<Record<string, unknown>>[],
) {
  const keys = new Set<string>();
  for (const definition of definitions) {
    for (const key of Object.keys(definition)) {
      if (keys.has(key)) throw Error(`Duplicate ${kind} declaration '${key}'`);
      keys.add(key);
    }
  }
}
