import { useMemo, useState, useSyncExternalStore } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Button } from "@pe/kit/lang/button";
import { publicRoutes } from "#/route/builtin-routes";
import { admittedRouterAddress } from "#/shell/admitted-pane";
import { applicationRouteShell as ApplicationRouteShell } from "#/shell/application-route-shell";
import { usePodRoutes } from "#/route/pod-routes";
import { PaneErrorBoundary } from "@pe/kit/lang/pane";
import { message } from "@pe/agent-contracts";

export const Route = createFileRoute("/tool/$key")({ component: PodTool });
function PodTool() {
  const { key } = Route.useParams();
  const inventory = usePodRoutes();
  const router = useRouter();
  const address = useMemo(() => admittedRouterAddress(router.history), [router]);
  const [error, setError] = useState<string | null>(null);
  useSyncExternalStore(publicRoutes.subscribe, publicRoutes.revision, publicRoutes.revision);
  const row = inventory?.rows.find((entry) => entry.key === key);
  const route = row?.trusted ? publicRoutes.admitted(row.workRoute) : null;
  const alarm = error || inventory?.errors[key] || inventory?.errors.inventory;
  if (row && route)
    return (
      <PaneErrorBoundary what="Pod route" key={`${row.key}:${row.fingerprint}`}>
        <ApplicationRouteShell
          route={route}
          address={address}
        />
      </PaneErrorBoundary>
    );
  return (
    <main className="flex flex-col gap-3 p-5">
      <h1 className="t-title">{row?.name ?? "Pod route"}</h1>
      <p>{row?.description}</p>
      {!row ? (
        <p>
          {inventory?.loading
            ? "Reading Pod routes…"
            : "This Pod route is unavailable. Enable its package and refresh the directory."}
        </p>
      ) : (
        <>
          <p className="face-mono">{row.key}</p>
          <p className="face-mono">Fingerprint {row.fingerprint}</p>
          <p>
            This authored route executes JavaScript with this browser and shell's authority. Trust
            applies only to these exact bytes. Inspect the package artifact before trusting it.
          </p>
          <p className="face-mono">
            Source: {row.packageId}/{row.artifact}
          </p>
          <Button
            label={`Trust ${row.name} at this fingerprint`}
            busy={inventory?.loading}
            onClick={() => {
              void inventory?.trust(row, true).catch((cause: unknown) => setError(message(cause)));
            }}
          >
            Trust this fingerprint
          </Button>
        </>
      )}
      {alarm && (
        <p role="alert" data-tone="alarm">
          {alarm}
        </p>
      )}
    </main>
  );
}
