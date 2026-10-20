import { expect, test } from "vite-plus/test";
import type { QueryFilter } from "@pe/kit/table/model";
import {
  defaultFilterQuery,
  hasQueryFilter,
  restoreQueryFilters,
  setQueryFilter,
} from "@pe/kit/table/query-filters";

const filters: QueryFilter[] = [
  { clause: "!empty", label: "Has values", description: "Some value exists", default: true },
  {
    clause: '"Family count">=3',
    label: "Common",
    description: "At least three families",
    default: true,
  },
  { clause: "needs-review", label: "Needs review", description: "An unresolved finding" },
];

test("default filters seed the same query and can be removed and restored without dropping authored conditions", () => {
  expect(defaultFilterQuery(filters)).toBe('!empty "Family count">=3');
  const query = 'family~"Air terminal" !empty !empty';
  const cleared = setQueryFilter(query, filters[0]!, false);
  expect(cleared).toBe('family~"Air terminal"');
  expect(hasQueryFilter(cleared, filters[0]!)).toBe(false);
  const restored = restoreQueryFilters(cleared, filters);
  expect(restored).toBe('family~"Air terminal" !empty "Family count">=3');
  expect(restoreQueryFilters(restored, filters)).toBe(restored);
  expect(setQueryFilter(restored, filters[0]!, true).match(/!empty/g)).toHaveLength(1);
  expect(defaultFilterQuery([])).toBe("");
});
