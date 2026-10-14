import { Component, useState, useSyncExternalStore, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@pe/kit/lang/button";
import { publicRoutes } from "#/route/builtin-routes";
import { usePodRoutes } from "#/route/pod-routes";
import { useRouteThread } from "#/route/shell";
import { peClient } from "#/host/pe-client";
import { Code } from "@pe/kit/lang/code";

export const Route = createFileRoute("/tool/$key")({ component: PodTool });
class PodBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  render() {
    return this.state.error ? (
      <p role="alert" data-tone="alarm" className="p-3">
        This Pod route stopped: {this.state.error}
      </p>
    ) : (
      this.props.children
    );
  }
}
function PodTool() {
  const { key } = Route.useParams();
  const inventory = usePodRoutes();
  const thread = useRouteThread();
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<{ hash: string; content: string } | null>(null);
  useSyncExternalStore(publicRoutes.subscribe, publicRoutes.revision, publicRoutes.revision);
  const row = inventory?.rows.find((entry) => entry.key === key);
  const registration = row?.trusted ? publicRoutes.get(row.workRoute) : null;
  const View = registration?.hosted;
  if (row && View)
    return (
      <PodBoundary key={`${row.key}:${row.sha256}`}>
        <View thread={thread} visible />
      </PodBoundary>
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
                .catch((cause: unknown) => setError(String(cause)));
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
              void inventory
                ?.trust(row, true)
                .catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : String(cause)),
                );
            }}
          >
            Trust this route hash
          </Button>
        </>
      )}
      {(error || inventory?.errors[key] || inventory?.errors.inventory) && (
        <p role="alert" data-tone="alarm">
          {error || inventory?.errors[key] || inventory?.errors.inventory}
        </p>
      )}
    </main>
  );
}
