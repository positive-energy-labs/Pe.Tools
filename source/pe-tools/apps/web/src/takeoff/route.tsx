import { address } from "@pe/agent-contracts";
import { useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { EmptyState } from "#/components/lang/empty";
import { appAtomRegistry } from "#/state/registry";
import { createHostSessionSource, createLiveTakeoffHost } from "#/takeoff/host";
import { createFixtureTakeoffStore } from "#/takeoff/proto/fixture-world";
import { createTakeoffStore } from "#/takeoff/store";
import { useRouteStore } from "#/state/use-route-store";
import { pageScope } from "#/state/route-store";
import { usePeInfo } from "#/host/info";
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
  return mounted ? <MountedLiveTakeoffsRoute target={target} /> : null;
}

function MountedLiveTakeoffsRoute({ target }: { target: string }) {
  const info = usePeInfo();
  // The capability gate stays OUTSIDE the Scope read: no router wire opens before Revit is real.
  if (info.data?.capabilities.revit !== true) return <TakeoffsCapabilityState info={info} />;
  return <ScopedLiveTakeoffsRoute target={target} />;
}

function ScopedLiveTakeoffsRoute({ target }: { target: string }) {
  const scope = useRouteScope();
  if (!scope) return <TakeoffsClusterFallback target={target} />;
  return (
    <TakeoffsStoreOwner
      key={liveTakeoffsStoreKey(target, scope.scope.document)}
      source="live"
      documentAddress={scope.scope.document}
      target={target}
    />
  );
}

function TakeoffsCapabilityState({ info }: { info?: ReturnType<typeof usePeInfo> }) {
  return (
    <div className="flex h-screen items-center justify-center">
      <EmptyState
        story="scope"
        exit={
          info?.error
            ? "restore the host connection, or take the fixture lane with ?source=fixture"
            : info?.data
              ? "start Revit with the Pe add-in loaded, or take the fixture lane with ?source=fixture"
              : "checking host capabilities"
        }
      >
        {info?.error
          ? "host capabilities unavailable"
          : info?.data
            ? "Revit unavailable"
            : "checking host capabilities"}
      </EmptyState>
    </div>
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
function TakeoffsClusterFallback({ target = "" }: { target?: string }) {
  const fleet = useFleet({ all: true });
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
      <p className="t-small face-mono mt-1 text-ink-2">
        no document bound — pick a session and stage a document below
      </p>
      <div className="mx-auto mt-5 max-w-6xl">
        <InstancesCluster fleet={fleet} target={target} setTarget={setTarget} />
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
  const store = useRouteStore(() => {
    const created =
      source === "fixture"
        ? createFixtureTakeoffStore(appAtomRegistry, pageScope(documentAddress, target))
        : createTakeoffStore({
            host: createLiveTakeoffHost(),
            sessions: createHostSessionSource(),
            source,
            registry: appAtomRegistry,
            scope: pageScope(documentAddress, target),
            target,
          });
    for (const dir of readDirs().reverse()) created.actions.rememberDir(dir);
    return created;
  });
  useEffect(() => {
    if (source === "live") void store.actions.reconcileWorld();
  }, [source, store]);
  return <TakeoffsPage store={store} />;
}
