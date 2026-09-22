import { RouteShell, emptyManifest } from "#/route";
import { createFileRoute } from "@tanstack/react-router";

import { VariantE } from "#/param-tables/variants/variant-e";

/** Round-one winner. The search parser remains so existing URLs keep their shape. */
/** Not cut over yet: an empty manifest is a legal manifest and the shell renders one. */
export const manifest = emptyManifest("param-tables", "Param Tables");

function RouteShelledVariantE() {
  return (
    <RouteShell manifest={manifest}>
      <VariantE />
    </RouteShell>
  );
}

export const Route = createFileRoute("/param-tables")({
  validateSearch: (search: Record<string, unknown>) => ({
    variant: typeof search.variant === "string" ? search.variant : "e",
  }),
  component: RouteShelledVariantE,
});
