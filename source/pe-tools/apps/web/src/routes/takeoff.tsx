import { createFileRoute } from "@tanstack/react-router";

import { VariantSwitcher } from "#/takeoff/proto/switcher";
import { Variant as ZonesVariant } from "#/takeoff/proto/variant-zones";
import { Variant as InboxVariant } from "#/takeoff/proto/variant-inbox";
import { Variant as PeaVariant } from "#/takeoff/proto/variant-pea";
import { Variant as AtlasVariant } from "#/takeoff/proto/variant-atlas";
import { Variant as LedgerVariant } from "#/takeoff/proto/variant-ledger";

/**
 * /takeoff — PROTOTYPE: UX exploration, switchable via ?variant= (src/takeoff/proto/).
 *
 * Round-1 verdict (2026-08-14): three-pane layout wins — zones/filters left, master table
 * middle, granular data right; real geometry is critical; the rhvac grid's cell editing is
 * the canonical table feel. Round 2 explores the remaining tension: plan-dominant ("atlas")
 * vs table-dominant ("ledger") middle pane. The round-1 spec and house variants live on
 * this branch's history (commit 3049bf3); "pea" is sidelined but kept for reference.
 */
const VARIANTS = [
  { key: "atlas", name: "plan-dominant three-pane" },
  { key: "ledger", name: "table-dominant three-pane" },
  { key: "zones", name: "zone-first workbench (r1)" },
  { key: "inbox", name: "decision inbox (r1)" },
  { key: "pea", name: "chat-native (r1, sidelined)" },
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
      {variant === "ledger" && <LedgerVariant />}
      {variant === "zones" && <ZonesVariant />}
      {variant === "inbox" && <InboxVariant />}
      {variant === "pea" && <PeaVariant />}
      <VariantSwitcher variants={VARIANTS} current={variant} />
    </>
  );
}
