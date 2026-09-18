/** /design-system/compact — SATELLITE; the lineup lives in `design-system/compact-lineup.tsx`. */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { CompactLineup, VARIANTS } from "#/design-system/compact-lineup";

export const Route = createFileRoute("/design-system_/compact")({
  validateSearch: z.object({ variant: z.enum(VARIANTS).catch("today").optional() }),
  component: CompactRoute,
});

function CompactRoute() {
  const { variant = "today" } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <CompactLineup
      variant={variant}
      onVariant={(next) => void navigate({ search: { variant: next }, replace: true })}
    />
  );
}
