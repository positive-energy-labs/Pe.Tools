import { createFileRoute } from "@tanstack/react-router";
import { address } from "@pe/agent-contracts";
import { EmptyState } from "#/components/lang/empty";
import { mintSelector, resolveTarget, type SessionFacts } from "#/host/target";
import { appAtomRegistry } from "#/state/registry";
import { createHostSessionSource, createLiveTakeoffHost } from "#/takeoff/host";
import {
  createFixtureSessionSource,
  createFixtureTakeoffHost,
} from "#/takeoff/proto/fixture-world";
import { createTakeoffStore } from "#/takeoff/store";
import { useRouteStore } from "#/state/use-route-store";
import { RouteDocument } from "#/workbench/route-document";
import { usePeInfo } from "#/host/info";
import { TakeoffsPage } from "#/takeoff/route-workspace";

export const PANES = [
  { key: "plan", label: "plan image", draws: ["views"] },
  { key: "rooms", label: "room table", draws: ["zones"] },
  { key: "r10", label: ".r10 join", draws: ["r10"] },
] as const;

export const str = (v: unknown) => (typeof v === "string" ? v : "");

export const resolvedWorldBinding = (
  resolution: ReturnType<typeof resolveTarget>,
  sessions: readonly SessionFacts[],
) =>
  resolution.kind === "resolved"
    ? mintSelector(resolution.session, sessions)
    : resolution.selector || null;

export const Route = createFileRoute("/takeoffs")({
  validateSearch: (search: Record<string, unknown>) => ({
    source: search.source === "fixture" ? ("fixture" as const) : ("live" as const),
    thread: str(search.thread) || undefined,
    targeting: search.targeting === "flow" ? ("flow" as const) : undefined,
  }),
  component: TakeoffsRoute,
});

export type Search = ReturnType<(typeof Route)["useSearch"]>;

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

export function TakeoffsRoute() {
  const { source } = Route.useSearch();
  const fixtureAddress = address("C:\\Fixtures\\project-a Residence.rvt");
  return source === "fixture" ? (
    <TakeoffsStoreOwner source="fixture" documentAddress={fixtureAddress} />
  ) : (
    <LiveTakeoffsRoute />
  );
}

export function LiveTakeoffsRoute() {
  const info = usePeInfo();
  if (info.data?.capabilities.revit === true) return <LiveTakeoffsDocumentRoute />;
  return (
    <div className="flex h-screen items-center justify-center">
      <EmptyState
        story="scope"
        exit={
          info.error
            ? "restore the host connection, or take the fixture lane with ?source=fixture"
            : info.data
              ? "start Revit with the Pe add-in loaded, or take the fixture lane with ?source=fixture"
              : "checking host capabilities"
        }
      >
        {info.error
          ? "host capabilities unavailable"
          : info.data
            ? "Revit unavailable"
            : "checking host capabilities"}
      </EmptyState>
    </div>
  );
}

export function LiveTakeoffsDocumentRoute() {
  return (
    <RouteDocument>
      {(at) => <TakeoffsStoreOwner key={`live:${at}`} source="live" documentAddress={at} />}
    </RouteDocument>
  );
}

export function TakeoffsStoreOwner({
  source,
  documentAddress,
}: {
  source: Search["source"];
  documentAddress: import("@pe/agent-contracts").Address;
}) {
  const store = useRouteStore(() => {
    const created = createTakeoffStore({
      host: source === "fixture" ? createFixtureTakeoffHost() : createLiveTakeoffHost(),
      sessions: source === "fixture" ? createFixtureSessionSource() : createHostSessionSource(),
      source,
      registry: appAtomRegistry,
      scope: { documentAddress },
    });
    for (const dir of readDirs().reverse()) created.actions.rememberDir(dir);
    return created;
  });
  return <TakeoffsPage store={store} />;
}
