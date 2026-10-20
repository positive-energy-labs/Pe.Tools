import { createFileRoute } from "@tanstack/react-router";
import { Lineup } from "#/prototypes/table-controls/lineup";

/** Dev specimen of the shared table query; the tables are the real TableFrame and Table. */
export const Route = createFileRoute("/design-system_/table-controls")({
  validateSearch: (search: Record<string, unknown>) => ({
    dataset: typeof search.dataset === "string" ? search.dataset : "segments",
  }),
  component: TableControlsSpecimen,
});

function TableControlsSpecimen() {
  const { dataset } = Route.useSearch();
  return import.meta.env.DEV ? (
    <Lineup dataset={dataset} />
  ) : (
    <p className="p-3">Table-controls specimens are available in development.</p>
  );
}
