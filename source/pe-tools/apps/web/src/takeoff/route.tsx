import { address, addressSchema } from "@pe/agent-contracts";
import type { RecentDocument } from "@pe/host-contracts/pe-revit-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { documentTrunk } from "#/targeting/world";
import { DocGroup, DocRow, extOf } from "#/chat/doc-picker";
import { RouteHead } from "#/targeting/head";
import { routeDocumentTabHref } from "#/workbench/route-document";
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
    return documents.data.openDocuments.flatMap((document) => {
      if (!document.isActive && document.isModelInCloud) return [];
      const parsed = addressSchema.safeParse(document.cloudModelGuid ?? document.path);
      return parsed.success
        ? [
            {
              at: parsed.data,
              label: `${session.sdkSessionId ?? session.sessionId} · ${document.title}`,
              active: document.isActive,
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
      empty={(sessions) => <TakeoffsDocumentOpen sessions={sessions} target={target} />}
    >
      {(at) => (
        <TakeoffsStoreOwner key={`live:${at}`} source="live" documentAddress={at} target={target} />
      )}
    </RouteDocument>
  );
}

export function TakeoffsDocumentOpen({
  sessions,
  target = "",
}: {
  sessions: readonly SessionFacts[];
  target?: string;
}) {
  const router = useRouter();
  const href = useLocation({ select: (location) => location.href });
  const resolved = resolveTarget(sessions, target);
  const [sessionId, setSessionId] = useState(
    resolved.kind === "resolved" ? resolved.session.sessionId : "",
  );
  const [opening, setOpening] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const session =
    sessions.find((candidate) => candidate.sessionId === sessionId) ??
    (resolved.kind === "resolved" ? resolved.session : sessions[0]);
  const recents = useQuery({
    queryKey: ["takeoffs", "document-recents", session?.year],
    queryFn: () => documentTrunk.recents(session?.year),
    enabled: session !== undefined,
  });

  const open = async (recent: RecentDocument) => {
    if (!session) return;
    if (recent.isCloud) return setFailure("cloud Takeoffs working copies are not supported yet");
    const destination = takeoffsWorkingCopyPath(recent.path);
    const at = addressSchema.safeParse(destination);
    if (!at.success) return setFailure(`cannot address ${recent.title}`);
    setOpening(destination);
    setFailure(null);
    try {
      if (destination === recent.path)
        await documentTrunk.pick(session, recent.path, recents.data ?? []);
      else await documentTrunk.clone(session, recent.path, destination);
      await router.navigate({ href: routeDocumentTabHref(href, at.data) });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "document open failed");
    } finally {
      setOpening(null);
    }
  };

  return (
    <main className="min-h-screen px-6 py-4">
      <RouteHead name="Takeoffs" />
      {sessions.length === 0 ? (
        <div className="grid min-h-[70vh] place-items-center">
          <EmptyState story="scope" exit="start Revit from Instances, then return here">
            no world available
          </EmptyState>
        </div>
      ) : (
        <section className="mx-auto mt-16 grid max-w-2xl gap-3">
          <DocGroup label="OPEN A REVIT DOCUMENT" aside={`${recents.data?.length ?? 0} recent`} />
          {sessions.length > 1 ? (
            <select
              aria-label="Revit world"
              value={session?.sessionId}
              onChange={(event) => setSessionId(event.target.value)}
              className="px-2 py-1"
            >
              {sessions.map((candidate) => (
                <option key={candidate.sessionId} value={candidate.sessionId}>
                  {candidate.sdkSessionId ?? `pid ${candidate.processId}`}
                </option>
              ))}
            </select>
          ) : null}
          {recents.isPending ? <p>loading recent documents…</p> : null}
          {recents.error ? <p role="alert">{recents.error.message}</p> : null}
          {failure ? <p role="alert">{failure}</p> : null}
          {recents.data?.map((recent) => {
            const id = recent.modelGuid ?? recent.path;
            const destination = recent.isCloud ? id : takeoffsWorkingCopyPath(recent.path);
            return (
              <DocRow
                key={id}
                ext={extOf(recent.path ?? recent.title)}
                label={recent.title}
                sub={
                  recent.isCloud
                    ? "cloud working copies are not supported yet"
                    : destination === recent.path
                      ? recent.path
                      : `safe copy · ${destination}`
                }
                disabled={opening !== null || !session?.sdkSessionId || recent.isCloud}
                selected={opening === destination}
                onPick={() => void open(recent)}
              />
            );
          })}
        </section>
      )}
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
