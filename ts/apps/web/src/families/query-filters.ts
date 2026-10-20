import type { QueryFilter } from "@pe/kit/table/model";
import { defaultFilterQuery } from "@pe/kit/table/query-filters";

/** Presentation and initial state share these clauses; the pivot owns their domain meaning. */
export const FAMILIES_FILTERS: readonly QueryFilter[] = [
  {
    clause: "!empty",
    label: "Has values",
    description:
      "Keep parameters with a nonblank value in at least one shown type. Zero and No count as values.",
    default: true,
  },
  {
    clause: "!absent",
    label: "Present in scope",
    description:
      "Keep parameters defined on at least one shown family. Recounts when the family scope changes.",
    default: true,
  },
];

export const DEFAULT_FAMILIES_QUERY = defaultFilterQuery(FAMILIES_FILTERS);
