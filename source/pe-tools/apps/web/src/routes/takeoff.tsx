import { createFileRoute } from "@tanstack/react-router";

import { VariantSwitcher } from "#/takeoff/proto/switcher";
import { Variant as AtlasVariant } from "#/takeoff/proto/variant-atlas";
import { Variant as PeaVariant } from "#/takeoff/proto/variant-pea";

/**
 * /takeoff — PROTOTYPE converging on canon: "atlas" (plan-dominant three-pane) won rounds 1–2
 * and carries the merged verdicts (collapsible/resizable plan, ledger's minimal right rail +
 * zone poly peek, level-stats popover, filterable columns, derived room-state progress).
 * "pea" (chat-native) is sidelined but kept for its route-state thinking. Retired variants
 * live in this branch's history: spec/house at 3049bf3, zones/inbox/ledger at feebcb6.
 */
const VARIANTS = [
  { key: "atlas", name: "atlas (canon-track)" },
  { key: "pea", name: "chat-native (sidelined)" },
];

export const Route = createFileRoute("/takeoff")({
  validateSearch: (search: Record<string, unknown>) => ({
    variant: VARIANTS.some((v) => v.key === search.variant) ? (search.variant as string) : "atlas",
  }),
  component: VariantGate,
});

function VariantGate() {
  const { variant } = Route.useSearch();
  return (
    <>
      {variant === "atlas" && <AtlasVariant />}
      {variant === "pea" && <PeaVariant />}
      <VariantSwitcher variants={VARIANTS} current={variant} />
    </>
  );
}
