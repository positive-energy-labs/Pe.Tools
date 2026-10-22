import type { QueryFilter } from "./model";
import { queryWords } from "./view";

/** Default clauses seed caller-owned state once; clearing the query really clears it. */
export const defaultFilterQuery = (filters: readonly QueryFilter[]) =>
  [...new Set(filters.filter((filter) => filter.default).map((filter) => filter.clause))].join(" ");

export const hasQueryFilter = (query: string, filter: QueryFilter) =>
  queryWords(query).includes(filter.clause);

export function setQueryFilter(query: string, filter: QueryFilter, enabled: boolean) {
  const words = queryWords(query).filter((word) => word !== filter.clause);
  return (enabled ? [...words, filter.clause] : words).join(" ");
}

/** Restoring defaults preserves the person's other clauses, sorts, and route-owned scope. */
export const restoreQueryFilters = (query: string, filters: readonly QueryFilter[]) =>
  filters.reduce(
    (next, filter) =>
      filter.default && !hasQueryFilter(next, filter) ? setQueryFilter(next, filter, true) : next,
    query,
  );
