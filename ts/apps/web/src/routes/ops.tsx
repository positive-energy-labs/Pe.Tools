import { createFileRoute } from "@tanstack/react-router";

import { OpsRoute } from "#/ops/workspace";
import { opsManifest } from "#/ops/manifest";

/** The route, declared once. `ops/workspace.tsx` re-derives it with the selection bound. */
export const manifest = opsManifest();

const str = (value: unknown) => (typeof value === "string" && value ? value : undefined);

export type OpsSearch = { op?: string; target?: string; actionId?: string; thread?: string };

export const opsSearch = (search: Record<string, unknown>): OpsSearch =>
  Object.fromEntries(
    (["op", "target", "actionId", "thread"] as const).flatMap((key) => {
      const value = str(search[key]);
      return value === undefined ? [] : [[key, value]];
    }),
  );

export const Route = createFileRoute("/ops")({
  validateSearch: opsSearch,
  component: OpsFileRoute,
});

function OpsFileRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <OpsRoute
      op={search.op ?? ""}
      actionId={search.actionId ?? null}
      set={(patch) => {
        void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true });
      }}
    />
  );
}
