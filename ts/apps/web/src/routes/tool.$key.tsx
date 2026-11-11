import { useState, useSyncExternalStore } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@pe/kit/lang/button";
import { publicRoutes } from "#/route/route-discovery";

import { TypedShell } from "#/shell/typed-shell";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { usePodRoutes } from "#/route/pod-routes";
import { PaneErrorBoundary } from "@pe/kit/lang/pane";
import { readableRefusal } from "#/route/readable-refusal";

export const Route = createFileRoute("/tool/$key")({ component: PodTool });
function PodTool() {
  const { key } = Route.useParams();
  const inventory = usePodRoutes();

  const [error, setError] = useState<string | null>(null);
  useSyncExternalStore(publicRoutes.subscribe, publicRoutes.revision, publicRoutes.revision);
  const row = inventory?.rows.find((entry) => entry.key === key);
  const route = row?.trusted ? publicRoutes.typed(row.workRoute) : null;
  const caution = error || inventory?.errors[key] || inventory?.errors.inventory;
  if (row && route)
    return (
      <PaneErrorBoundary what="Pod route" key={`${row.key}:${row.fingerprint}`}>
        <TypedShell module={route} fingerprint={workFingerprintSchema.parse(row.fingerprint)} />
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
              void inventory?.trust(row, true).catch((cause: unknown) => setError(readableRefusal(cause, "Pod trust refused: the artifact does not match its typed route contract. Rebuild this Pod and inspect its current bytes.")));
            }}
          >
            Trust this fingerprint
          </Button>
        </>
      )}
      {caution && (
        <p role="alert" data-tone="caution">
          {caution}
        </p>
      )}
    </main>
  );
}
