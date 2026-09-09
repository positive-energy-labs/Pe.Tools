import { address } from "@pe/agent-contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { appAtomRegistry } from "#/state/registry";
import { createHostSessionSource, createLiveTakeoffHost } from "#/takeoff/host";
import { createFixtureTakeoffStore } from "#/takeoff/proto/fixture-world";
import { createTakeoffStore } from "#/takeoff/store";
import { useRouteStore } from "#/state/use-route-store";
import { pageScope } from "#/state/route-store";
import { routeTarget } from "#/host/route-target";
import { useRouteScope } from "#/workbench/route-scope";
import { TakeoffsPage } from "#/takeoff/route-workspace";
import { useFleet } from "#/host/fleet";
import { InstancesCluster } from "#/instances/cluster";
import { RouteHead } from "#/targeting/head";

export const PANES = [
  { key: "plan", label: "plan image", draws: ["views"] },
  { key: "rooms", label: "room table", draws: ["zones"] },
  { key: "r10", label: ".r10 join", draws: ["r10"] },
] as const;

export type TakeoffSource = "fixture" | "live";

/** Per-browser recents — the legal-options source for the folder root. ponytail: a disk browse
 *  op would replace this; recents are enough while one firm has one takeoff folder. */
export const DIRS_KEY = "pe.takeoffs.r10-dirs";

export const readDirs = (): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(DIRS_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((d) => typeof d === "string") : [];
  } catch {
    return [];
  }
};

export const takeoffsWorkingCopyPath = (path: string) =>
  path.toLowerCase().endsWith(".petakeoffs.rvt")
    ? path
    : path.toLowerCase().endsWith(".rvt")
      ? `${path.slice(0, -4)}.PeTakeoffs.rvt`
      : `${path}.PeTakeoffs.rvt`;

export function TakeoffsRoute({ source, target = "" }: { source: TakeoffSource; target?: string }) {
  const fixtureAddress = address("C:\\Fixtures\\project-a Residence.rvt");
  return source === "fixture" ? (
    <TakeoffsStoreOwner source="fixture" documentAddress={fixtureAddress} />
  ) : (
    <LiveTakeoffsRoute target={target} />
  );
}

export function LiveTakeoffsRoute({ target = "" }: { target?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <ScopedLiveTakeoffsRoute target={target} /> : null;
}

function ScopedLiveTakeoffsRoute({ target }: { target: string }) {
  const scope = useRouteScope();
  const fleet = useFleet({ all: true });
  const resolved = routeTarget(scope?.scope, fleet);
  const router = useRouter();
  const href = useLocation({ select: (location) => location.href });
  const canonicalTarget =
    resolved.kind === "gone" ? "" : resolved.kind === "ready" ? resolved.session.sessionId : target;
  useEffect(() => {
    if (canonicalTarget === target) return;
    const url = new URL(href, "http://takeoffs.local");
    if (canonicalTarget) url.searchParams.set("target", canonicalTarget);
    else url.searchParams.delete("target");
    void router.navigate({ href: url.pathname + url.search, replace: true });
  }, [canonicalTarget, target, href, router]);
  if (!scope || resolved.kind !== "ready")
    return (
      <TakeoffsClusterFallback
        target={canonicalTarget}
        fleet={fleet}
        requestedDocument={scope?.scope.document}
        reason={resolved.kind === "ready" ? "Pick a document." : resolved.reason}
      />
    );
  return (
    <TakeoffsStoreOwner
      key={liveTakeoffsStoreKey(canonicalTarget, scope.scope.document)}
      source="live"
      documentAddress={scope.scope.document}
      target={canonicalTarget}
    />
  );
}

export const liveTakeoffsStoreKey = (sessionId: string, documentAddress: string) =>
  `live:${sessionId}:${documentAddress}`;

/**
 * No document bound: the portable `InstancesCluster` IS the fallback (kaitpw 2026-09-01), and it
 * opens documents exactly as the Revit UI would — no clone/detach policy (kaitpw ruling
 * 2026-09-01, after the working-copy clone policy stranded `ProjectA1` documentless and refused a
 * cloud model; explicit safe-copy/--detach verbs are owed in the takeoffs ledger). Once a
 * document is named, `RouteScope` binds it and the takeoff store owns working-copy concerns.
 */
function TakeoffsClusterFallback({
  target,
  fleet,
  requestedDocument,
  reason,
}: {
  target: string;
  fleet: ReturnType<typeof useFleet>;
  requestedDocument?: string;
  reason: string;
}) {
  const router = useRouter();
  const href = useLocation({ select: (location) => location.href });
  const setTarget = (next: string) => {
    const url = new URL(href, "http://takeoffs.local");
    if (next) url.searchParams.set("target", next);
    else url.searchParams.delete("target");
    void router.navigate({ href: url.pathname + url.search, replace: true });
  };
  return (
    <main className="min-h-screen px-6 py-4">
      <RouteHead name="Takeoffs" />
      <p className="t-small face-mono mt-1 text-ink-2">{reason}</p>
      {requestedDocument && <p className="face-mono mt-1">Recover document: {requestedDocument}</p>}
      <div className="mx-auto mt-5 max-w-6xl">
        <InstancesCluster
          fleet={fleet}
          requestedDocument={requestedDocument}
          target={target}
          setTarget={setTarget}
          onDocument={(scope) => {
            const url = new URL(href, "http://takeoffs.local");
            url.searchParams.set("doc", scope.document);
            if (scope.pin) url.searchParams.set("target", scope.pin);
            else url.searchParams.delete("target");
            void router.navigate({ href: url.pathname + url.search, replace: true });
          }}
        />
      </div>
    </main>
  );
}

export function TakeoffsStoreOwner({
  source,
  documentAddress,
  target = "",
}: {
  source: TakeoffSource;
  documentAddress: import("@pe/agent-contracts").Address;
  target?: string;
}) {
  const queryClient = useQueryClient();
  const store = useRouteStore(() => {
    const created =
      source === "fixture"
        ? createFixtureTakeoffStore(appAtomRegistry, pageScope(documentAddress, target))
        : createTakeoffStore({
            host: createLiveTakeoffHost(),
            sessions: createHostSessionSource(queryClient),
            source,
            registry: appAtomRegistry,
            scope: pageScope(documentAddress, target),
            target,
          });
    for (const dir of readDirs().reverse()) created.actions.rememberDir(dir);
    return created;
  });
  return <TakeoffsPage store={store} />;
}
