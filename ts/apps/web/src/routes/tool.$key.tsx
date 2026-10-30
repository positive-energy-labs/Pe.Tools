import { useState, useSyncExternalStore } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@pe/kit/lang/button";
import { publicRoutes } from "#/route/builtin-routes";
import { usePodRoutes } from "#/route/pod-routes";
import { useRouteThread } from "#/shell/binding";
import { peClient } from "#/host/pe-client";
import { Code } from "@pe/kit/lang/code";
import { PaneErrorBoundary } from "@pe/kit/lang/pane";
import { message } from "@pe/agent-contracts";
import { useRouteSearchSlice } from "#/route/activity";

export const Route = createFileRoute("/tool/$key")({ component: PodTool });
function PodTool() {
  const { key } = Route.useParams();
  const inventory = usePodRoutes();
  const thread = useRouteThread();
  const carry = useRouteSearchSlice(({ target, work }) => ({ target, work }));
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<{ hash: string; content: string } | null>(null);
  useSyncExternalStore(publicRoutes.subscribe, publicRoutes.revision, publicRoutes.revision);
  const row = inventory?.rows.find((entry) => entry.key === key);
  const registration = row?.trusted ? publicRoutes.get(row.workRoute) : null;
  const View = registration?.hosted;
  const alarm = error || inventory?.errors[key] || inventory?.errors.inventory;
  if (row && View)
    return (
      <PaneErrorBoundary what="Pod route" key={`${row.key}:${row.sha256}`}>
        <View thread={thread ?? ""} {...carry} visible />
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
          <p className="face-mono">SHA-256 {row.sha256}</p>
          <p>
            This authored route executes JavaScript with this browser and shell's authority. Trust
            applies only to these exact bytes. Review the Pod's source before trusting it.
          </p>
          <p className="face-mono">
            Source: {row.packageId}/{row.sourcePath}
          </p>
          <Button
            label="Review route source"
            onClick={() => {
              setError(null);
              void peClient
                .call("contributions.read", { query: { key: row.key } })
                .then((captured) => {
                  if (captured.sha256 !== row.sha256 || typeof captured.content !== "string")
                    throw Error("Source hash changed; refresh the route before trusting it.");
                  setSource({ hash: row.sha256, content: captured.content });
                })
                .catch((cause: unknown) => setError(message(cause)));
            }}
          >
            Review source
          </Button>
          {source?.hash === row.sha256 && (
            <Code code={source.content} lang="javascript" title={row.sourcePath} />
          )}
          <Button
            label={`Trust ${row.name} at this SHA-256`}
            refusal={source?.hash !== row.sha256 ? "Review this hash's source first" : undefined}
            busy={inventory?.loading}
            onClick={() => {
              void inventory?.trust(row, true).catch((cause: unknown) => setError(message(cause)));
            }}
          >
            Trust this route hash
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
