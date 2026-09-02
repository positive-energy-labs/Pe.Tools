import { address, addressSchema } from "@pe/agent-contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "#/components/lang/empty";
import { mintSelector, resolveTarget, type SessionFacts } from "#/host/target";
import { appAtomRegistry } from "#/state/registry";
import { createHostSessionSource, createLiveTakeoffHost } from "#/takeoff/host";
import { createFixtureTakeoffStore } from "#/takeoff/proto/fixture-world";
import { createTakeoffStore } from "#/takeoff/store";
import { useRouteStore } from "#/state/use-route-store";
import { RouteDocument, routeDocumentChoices } from "#/workbench/route-document";
import { usePeInfo } from "#/host/info";
import { TakeoffsPage } from "#/takeoff/route-workspace";
import { useFleet } from "#/host/fleet";
import { documentTrunk, openLocalDocuments } from "#/targeting/world";
import { InstancesCluster } from "#/instances/cluster";
import { RouteHead } from "#/targeting/head";
import { HOST_QUERY_KEY, useHostOp } from "#/host/queries";

export const PANES = [
  { key: "plan", label: "plan image", draws: ["views"] },
  { key: "rooms", label: "room table", draws: ["zones"] },
  { key: "r10", label: ".r10 join", draws: ["r10"] },
] as const;

export const resolvedWorldBinding = (
  resolution: ReturnType<typeof resolveTarget>,
  sessions: readonly SessionFacts[],
) =>
  resolution.kind === "resolved"
    ? mintSelector(resolution.session, sessions)
    : resolution.selector || null;

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
  if (info.data?.capabilities.revit === true) return <LiveTakeoffsDocumentRoute target={target} />;
  return <TakeoffsCapabilityState info={info} />;
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

export function LiveTakeoffsDocumentRoute({ target = "" }: { target?: string }) {
  const fleet = useFleet();
  const queryClient = useQueryClient();
  const resolution = resolveTarget(fleet.sessions, target);
  const session = resolution.kind === "resolved" ? resolution.session : null;
  const documents = useHostOp("revit.context.document-session", undefined, {
    bridgeSessionId: session?.sessionId,
    enabled: session !== null,
  });
  const choices = useMemo(() => {
    if (!session || !documents.data)
      return routeDocumentChoices(session ? [session] : fleet.sessions);
    return openLocalDocuments(documents.data).flatMap((document) => {
      const parsed = addressSchema.safeParse(document.id);
      return parsed.success
        ? [
            {
              at: parsed.data,
              label: `${session.sdkSessionId ?? session.sessionId} · ${document.label}`,
              active: document.active,
            },
          ]
        : [];
    });
  }, [documents.data, fleet.sessions, session]);
  const activate = useCallback(
    async (choice: (typeof choices)[number]) => {
      if (!session) throw Error("no world bound");
      await documentTrunk.activate(session, choice.at);
      await queryClient.invalidateQueries({ queryKey: HOST_QUERY_KEY });
    },
    [queryClient, session],
  );
  return (
    <RouteDocument
      sessions={fleet.sessions}
      choices={choices}
      onActivate={activate}
      empty={() => <TakeoffsClusterFallback target={target} />}
    >
      {(at) => (
        <TakeoffsStoreOwner
          key={liveTakeoffsStoreKey(session?.sessionId ?? target, at)}
          source="live"
          documentAddress={at}
          target={target}
        />
      )}
    </RouteDocument>
  );
}

export const liveTakeoffsStoreKey = (sessionId: string, documentAddress: string) =>
  `live:${sessionId}:${documentAddress}`;

/**
 * No document bound: the portable `InstancesCluster` IS the fallback (kaitpw 2026-09-01), and it
 * opens documents exactly as the Revit UI would — no clone/detach policy (kaitpw ruling
 * 2026-09-01, after the working-copy clone policy stranded `ProjectA1` documentless and refused a
 * cloud model; explicit safe-copy/--detach verbs are owed in the takeoffs ledger). Once a
 * document is active, `RouteDocument` binds it and the takeoff store owns working-copy concerns.
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
      <p className="t-caption face-mono mt-1 text-ink-2">
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
        ? createFixtureTakeoffStore(appAtomRegistry, { documentAddress })
        : createTakeoffStore({
            host: createLiveTakeoffHost(),
            sessions: createHostSessionSource(),
            source,
            registry: appAtomRegistry,
            scope: { documentAddress },
            target,
          });
    for (const dir of readDirs().reverse()) created.actions.rememberDir(dir);
    return created;
  });
  return <TakeoffsPage store={store} />;
}
