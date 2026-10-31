import type { AppliedFilter } from "@pe/agent-contracts";

const PLACEMENT_LABELS = {
  AllLoaded: "all loaded",
  PlacedOnly: "placed only",
  UnplacedOnly: "unplaced only",
} as const;
export const filterWords = (scope: AppliedFilter) =>
  `${scope.categoryNames.join(", ") || "every category"} · ${scope.familyNames.join(", ") || "every family"} · ${PLACEMENT_LABELS[scope.placementScope]}`;
