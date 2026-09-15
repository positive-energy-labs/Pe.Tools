import { createFileRoute } from "@tanstack/react-router";
import { opsPageSeedSchema } from "#/ops/store";
import { OpsRoute } from "#/ops/route-workspace";
import { opsManifest } from "#/ops/manifest";

/** The route, declared once. `ops/route-workspace.tsx` re-derives it with the selection bound. */
export const manifest = opsManifest();

const str = (value: unknown) => (typeof value === "string" ? value : "");

export const opsSearch = (search: Record<string, unknown>) => ({
  view: opsPageSeedSchema.partial().safeParse(search.view).data,
  thread: str(search.thread) || undefined,
});

export const Route = createFileRoute("/ops")({
  validateSearch: opsSearch,
  component: OpsFileRoute,
});

function OpsFileRoute() {
  const { view } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <OpsRoute
      initial={view}
      onSeed={(seed) => {
        void navigate({ search: (previous) => ({ ...previous, view: seed }), replace: true });
      }}
    />
  );
}
