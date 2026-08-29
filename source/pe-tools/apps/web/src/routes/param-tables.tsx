import { createFileRoute } from "@tanstack/react-router";

import { VariantE } from "#/param-tables/variants/variant-e";

/** Round-one winner. The search parser remains so existing URLs keep their shape. */
export const Route = createFileRoute("/param-tables")({
  validateSearch: (search: Record<string, unknown>) => ({
    variant: typeof search.variant === "string" ? search.variant : "e",
  }),
  component: VariantE,
});
