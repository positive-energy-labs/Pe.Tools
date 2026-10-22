import { FAMILIES_DEFAULT_QUERY } from "@pe/agent-contracts";
import type { QueryFilter } from "@pe/kit/table/model";

/** A clause is on by default when the contract's default query (`FAMILIES_DEFAULT_QUERY`) names it. */
const on = (clause: string) => FAMILIES_DEFAULT_QUERY.split(" ").includes(clause);

/** The clauses' presentation; the pivot owns their domain meaning, the contract their default. */
export const FAMILIES_FILTERS: readonly QueryFilter[] = [
  {
    clause: "!empty",
    label: "Has values",
    description:
      "Keep parameters with a nonblank value in at least one shown type. Zero and No count as values.",
    default: on("!empty"),
  },
  {
    clause: "!absent",
    label: "Present in scope",
    description:
      "Keep parameters defined on at least one shown family. Recounts when the family scope changes.",
    default: on("!absent"),
  },
];
