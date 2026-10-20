import { createFileRoute } from "@tanstack/react-router";
import { Lineup } from "#/prototypes/control-surface/lineup";

/** Retained exploration is a dev specimen, never a second Machine implementation. */
export const Route = createFileRoute("/design-system_/control-surface")({
  validateSearch: (search: Record<string, unknown>) => ({
    variant: typeof search.variant === "string" ? search.variant : "2e",
  }),
  component: ControlSurfaceSpecimen,
});

function ControlSurfaceSpecimen() {
  const { variant } = Route.useSearch();
  return import.meta.env.DEV ? (
    <Lineup variant={variant} />
  ) : (
    <p className="p-3">Control-surface specimens are available in development.</p>
  );
}
