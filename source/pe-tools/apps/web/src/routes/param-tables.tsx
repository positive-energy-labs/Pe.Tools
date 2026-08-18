import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { VariantSwitcher } from "#/param-tables/proto/switcher";
import { VariantA } from "#/param-tables/proto/variant-a";
import { VariantB } from "#/param-tables/proto/variant-b";
import { VariantC } from "#/param-tables/proto/variant-c";
import { VariantD } from "#/param-tables/proto/variant-d";
import { VariantE } from "#/param-tables/proto/variant-e";

/**
 * PROTOTYPE ROUTE — find-the-product round 1 for "param tables":
 * arbitrary engineering tables (Basis of Design, Figures of Merit) whose
 * cells link to parameters on model elements. Hybrid of /parameter-links
 * (linkage profile, evaluation, apply) and /data-tables (authored tables).
 *
 * Five structurally different answers to "what is this page", switchable via
 * ?variant=a..e. Shared fixture: real project-a M001/FOM/fan-coil data
 * (param-tables/proto/fixture.ts). No persistence, no host calls — every
 * apply is a mock that renders its receipt.
 *
 * Throwaway: this whole folder dies at round close (prototype skill rules).
 */
export const Route = createFileRoute("/param-tables")({
  validateSearch: (search: Record<string, unknown>) => ({
    variant: typeof search.variant === "string" ? search.variant : "a",
  }),
  component: ParamTablesProto,
});

const VARIANTS = [
  { key: "a", name: "Live sheet (grid editor)" },
  { key: "b", name: "Binding ledger" },
  { key: "c", name: "Document (exhibit-first)" },
  { key: "d", name: "Design facts (dataflow)" },
  { key: "e", name: "One table, three lenses" },
];

function ParamTablesProto() {
  const { variant } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <>
      {variant === "a" && <VariantA />}
      {variant === "b" && <VariantB />}
      {variant === "c" && <VariantC />}
      {variant === "d" && <VariantD />}
      {variant === "e" && <VariantE />}
      <VariantSwitcher
        variants={VARIANTS}
        current={variant}
        onSelect={(key) => navigate({ search: { variant: key }, replace: true })}
      />
    </>
  );
}
