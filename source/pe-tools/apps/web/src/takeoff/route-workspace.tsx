import { token } from "#/lib/token";
import { Workspace } from "#/components/anatomy";
import { useMemo, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { Cause } from "effect";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { VerbLane } from "#/components/lang/verb-lane";
import { Verb } from "#/components/lang/verb";
import { fuseFleet, useFleet } from "#/host/fleet";
import { resolveTarget } from "#/host/target";
import { Atlas } from "#/takeoff/atlas";
import { DEFAULT_ARTIFACT_DIR } from "#/takeoff/model";
import { TAKEOFF_SLOTS, type TakeoffSlot, type TakeoffStore } from "#/takeoff/store";
import { TargetingHead } from "#/targeting/head";
import { useBindings, useRunner, type BindingPatch, type BindingState } from "#/targeting/kit";
import { product as defineProduct, type Feeds, type Link } from "#/targeting/model";
import { documentTrunk, openLocalDocuments, worldTrunk } from "#/targeting/world";
import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import {
  DIRS_KEY,
  PANES,
  readDirs,
  resolvedWorldBinding,
  takeoffsWorkingCopyPath,
} from "#/takeoff/route";
import { AdoptPanel, SyncPanel } from "#/takeoff/adopt-panel";
import { addressSchema } from "@pe/agent-contracts";
import { useHostOp } from "#/host/queries";

export function TakeoffsPage({ store }: { store: TakeoffStore }) {
  const navigate = useNavigate({ from: "/takeoffs" });
  const { source, targeting } = useSearch({ from: "/takeoffs" });
  const views = useAtomValue(store.atoms.views);
  const zones = useAtomValue(store.atoms.zones);
  const dir = useAtomValue(store.atoms.dir);
  const r10 = useAtomValue(store.atoms.r10Path);
  const stage = useAtomValue(store.atoms.stage);
  const target = useAtomValue(store.atoms.target);
  const sessionsResult = useAtomValue(store.atoms.sessions);
  const activeDocumentResult = useAtomValue(store.atoms.activeDocument);
  const recentDocumentsResult = useAtomValue(store.atoms.recentDocuments);
  const live = source === "live";
  const fleet = useFleet({ enabled: live });
  const storedSessions = AsyncResult.isSuccess(sessionsResult) ? sessionsResult.value.value : [];
  const fixtureFleet = {
    worlds: fuseFleet([], storedSessions),
    sessions: storedSessions,
    isLoading: AsyncResult.isInitial(sessionsResult),
    stale: AsyncResult.isSuccess(sessionsResult) ? sessionsResult.waiting : false,
    error: AsyncResult.isFailure(sessionsResult)
      ? Error(String(Cause.squash(sessionsResult.cause)))
      : null,
    at: AsyncResult.isSuccess(sessionsResult) ? sessionsResult.value.at : undefined,
    basis: AsyncResult.isSuccess(sessionsResult) ? sessionsResult.value.basis : ["fixture"],
    lane: "fixture" as const,
  };
  const targetingFleet = live ? fleet : fixtureFleet;
  const sessions = targetingFleet.sessions;
  const resolution = resolveTarget(sessions, target);
  const session = resolution.kind === "resolved" ? resolution.session : null;
  const documentSession = useHostOp("revit.context.document-session", undefined, {
    bridgeSessionId: session?.sessionId,
    enabled: live && session !== null,
  });
  const openDocuments = documentSession.data ? openLocalDocuments(documentSession.data) : [];
  const scope: HostSessionScope | null = session ? { bridgeSessionId: session.sessionId } : null;
  const activeDocument =
    AsyncResult.isSuccess(activeDocumentResult) && activeDocumentResult.value.bound
      ? activeDocumentResult.value.value
      : null;

  const world = useAtomValue(store.atoms.world);
  const busyState = useAtomValue(store.atoms.busy);
  const failure = useAtomValue(store.atoms.failure);
  const panel = useAtomValue(store.atoms.panel);
  const targetingOpen = useAtomValue(store.atoms.targetingOpen);
  const targetingLevel = useAtomValue(store.atoms.targetingLevel);
  const targetingQuery = useAtomValue(store.atoms.targetingQuery);
  const busy = busyState?.id ?? null;
  const [documentFailure, setDocumentFailure] = useState<string | null>(null);

  const addDir = (d: string) => {
    const dirs = readDirs();
    const next = [d, ...dirs.filter((x) => x !== d)].slice(0, 8);
    localStorage.setItem(DIRS_KEY, JSON.stringify(next));
    store.actions.rememberDir(d);
    store.actions.setBindings({ bound: { folder: d, r10: null }, multi: {} });
  };
  const r10Result = useAtomValue(store.atoms.r10);

  const feeds: Feeds<TakeoffSlot> = {
    world: worldTrunk.feed(targetingFleet),
    rvt: documentTrunk.feed(
      activeDocumentResult,
      live ? recentDocumentsResult : undefined,
      live ? "live" : "fixture",
      openDocuments,
    ),
    views: useAtomValue(store.feeds.views),
    zones: useAtomValue(store.feeds.zones),
    folder: useAtomValue(store.feeds.folder),
    r10: useAtomValue(store.feeds.r10),
  };
  const state: BindingState<TakeoffSlot> = useMemo(
    () => ({
      bound: {
        world: resolvedWorldBinding(resolution, sessions),
        rvt: activeDocument?.documentId ?? null,
        views: null,
        zones: null,
        folder: dir || null,
        r10: r10 || null,
      },
      multi: { views: new Set(views), zones: new Set(zones) },
      stage,
    }),
    [resolution, sessions, activeDocument?.documentId, views, dir, r10, zones, stage],
  );
  const moveToDocument = (documentId: string) => {
    const at = addressSchema.safeParse(documentId);
    if (at.success)
      void navigate({
        search: (previous) => ({ ...previous, doc: at.data }),
        replace: true,
      });
  };
  const switchDocument = async (documentId: string) => {
    if (openDocuments.some((document) => document.id === documentId)) {
      moveToDocument(documentId);
      return;
    }
    if (!session || !AsyncResult.isSuccess(recentDocumentsResult))
      throw Error("document recents are not ready");
    const recent = recentDocumentsResult.value.value.find(
      (candidate) => (candidate.modelGuid ?? candidate.path) === documentId,
    );
    if (!recent) throw Error(`unknown recent document ${documentId}`);
    if (recent.isCloud) throw Error("cloud Takeoffs working copies are not supported yet");
    const destination = takeoffsWorkingCopyPath(recent.path);
    if (destination === recent.path)
      await documentTrunk.pick(session, recent.path, recentDocumentsResult.value.value);
    else await documentTrunk.clone(session, recent.path, destination);
    moveToDocument(destination);
  };
  const setState = (patch: BindingPatch<TakeoffSlot>) => {
    const nextWorld = patch.bound?.world;
    if (nextWorld && nextWorld !== state.bound.world) {
      void navigate({ search: (previous) => ({ ...previous, target: nextWorld, doc: undefined }) });
      return;
    }
    store.actions.setBindings(patch);
    const nextDocument = patch.bound?.rvt;
    if (live && nextDocument && nextDocument !== state.bound.rvt) {
      setDocumentFailure(null);
      void switchDocument(nextDocument).catch((error) =>
        setDocumentFailure(error instanceof Error ? error.message : "document switch failed"),
      );
    }
  };
  const boundZones = world.zones.filter((z) => zones.includes(z.zone.guid));

  const product = defineProduct(
    "takeoffs",
    "Takeoffs",
    TAKEOFF_SLOTS,
  )({
    feeds,
    panes: PANES,
    stages: [
      {
        key: "adopt",
        label: "adopt",
        verbs: [
          {
            key: "adopt",
            label: "adopt zones",
            demands: ["views"],
            kind: "act",
            run: () => store.actions.openAdopt(),
            refuse: () => null,
            needs: "a zoning view with filled regions",
          },
        ],
      },
      {
        key: "audit",
        label: "audit",
        verbs: [
          {
            key: "capture",
            label: "capture level",
            demands: ["views"],
            kind: live ? "act" : "seam",
            run: live
              ? async () => {
                  for (const view of views) {
                    const lane = world.lanes.find((candidate) => candidate.view === view);
                    if (!lane) throw new Error(`unknown zoning view ${view}`);
                    await store.actions.capture(lane);
                  }
                }
              : async () => {
                  throw Error("a live document — the fixture is already captured");
                },
            refuse: () => null,
            needs: "a live document — the fixture is already captured",
          },
          {
            key: "partition",
            label: `partition ${zones.length || ""} zone${zones.length === 1 ? "" : "s"}`,
            demands: ["zones"],
            kind: live ? "act" : "seam",
            refuse: () => {
              const uncaptured = boundZones.find((zone) => !zone.zone.lane.replayPath);
              return uncaptured
                ? `capture ${uncaptured.zone.lane.label} first — the partition replays its snapshot`
                : null;
            },
            run: live
              ? async () => {
                  for (const zone of boundZones) await store.actions.partition(zone);
                }
              : async () => {
                  throw Error("a live document — the fixture is already partitioned");
                },
            needs: "a live document — the fixture is already partitioned",
          },
          {
            key: "refresh",
            label: "refresh",
            demands: ["rvt"],
            kind: live ? "act" : "seam",
            run: live
              ? () => store.actions.refresh()
              : async () => {
                  throw Error("a live document — the replay is already the whole world");
                },
            refuse: () => null,
            needs: "a live document — the replay is already the whole world",
          },
        ],
      },
      {
        key: "sync",
        label: "sync",
        verbs: [
          {
            key: "sync",
            label: "sync .r10",
            demands: ["r10"],
            kind: live ? "commit" : "seam",
            refuse: () => (AsyncResult.isFailure(r10Result) ? "the .r10 did not open" : null),
            run: live
              ? () => store.actions.openSync()
              : async () => {
                  throw Error("a live document — the fixture has no .r10 to sync into");
                },
            needs: "a live document — the fixture has no .r10 to sync into",
          },
          {
            key: "launch",
            label: "open in RHVAC",
            demands: ["r10"],
            kind: "nav",
            run: async () => void (await store.actions.launchRhvac()),
            refuse: () => null,
            needs: "an .r10 file",
          },
          ...(AsyncResult.isFailure(r10Result)
            ? [
                {
                  key: "retry-r10",
                  label: "retry .r10",
                  demands: ["r10"] as const,
                  kind: "act" as const,
                  run: () => store.actions.retryRhvac(),
                  refuse: () => null,
                  needs: "an .r10 file",
                },
              ]
            : []),
        ],
      },
    ],
  });

  const b = useBindings(
    product,
    state,
    setState,
    targetingOpen,
    (open) => store.actions.setTargetingOpen(open),
    targetingLevel,
    (level) => store.actions.setTargetingLevel(level),
    targetingQuery,
    (query) => store.actions.setTargetingQuery(query),
  );
  const runner = useRunner(product, b, busy);

  const addFolder = (link: Link) =>
    link.key === "folder" ? (
      <form
        className="px-2 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("dir") as HTMLInputElement;
          const d = input.value.trim();
          if (d) addDir(d);
        }}
      >
        <input
          name="dir"
          placeholder={`add a folder — e.g. ${DEFAULT_ARTIFACT_DIR}`}
          className="w-full px-1 py-0.5"
          style={{ borderTop: `1px solid ${token("line-2")}`, color: token("ink") }}
        />
      </form>
    ) : null;

  const headRail = (
    <div>
      <TargetingHead
        product={product}
        b={b}
        runner={runner}
        mode={targeting}
        extra={addFolder}
        fact={
          !live ? (
            <FactChip
              dashed
              title="The fixture lane — the project-a replay, chosen explicitly by ?source=fixture. No document is attached, and nothing here can be written."
            >
              fixture · project-a replay
            </FactChip>
          ) : undefined
        }
        receipt={
          <span className="flex items-center gap-2">
            <VerbLane atoms={store.atoms} />
            {documentFailure ? <span role="alert">{documentFailure}</span> : null}
            {documentFailure ? (
              <Verb
                label="dismiss"
                onClick={() => setDocumentFailure(null)}
                reason="Clears the document switch error. It does not retry."
              />
            ) : null}
            {failure ? (
              <Verb
                label="dismiss"
                onClick={() => store.actions.clearFailure()}
                reason="Clears this error line. It does not retry — re-run the verb that failed."
              />
            ) : null}
            {!live && (
              <Verb
                label="leave fixture → live"
                onClick={() =>
                  void navigate({ search: (previous) => ({ ...previous, source: "live" }) })
                }
                reason="Switches this route back to the live lane, where reads and writes address the targeted Revit document"
              />
            )}
          </span>
        }
      />
    </div>
  );
  // Null, not an empty fragment: the band's container pays inset for whatever it holds, so an
  // absent panel must be absent, not an empty strip (annotation, 2026-08-31).
  const readoutBand =
    scope && panel === "adopt" ? (
      <AdoptPanel store={store} />
    ) : scope && panel === "sync" ? (
      <SyncPanel store={store} />
    ) : null;
  if (live && !session)
    return (
      <Workspace
        headRail={headRail}
        readoutBand={readoutBand}
        table={
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <EmptyState
              story="scope"
              exit={
                resolution.kind === "ambiguous"
                  ? "more than one session — pick a world in the sentence above"
                  : sessions.length === 0
                    ? "start Revit with the Pe add-in loaded and a world appears in the sentence — or take the fixture lane"
                    : `nothing matches "${target}" — pick a world in the sentence above`
              }
            >
              no world bound — the sentence's first slot is the live connected-host catalog
            </EmptyState>
            <Verb
              label="open the project-a fixture instead"
              onClick={() =>
                void navigate({ search: (previous) => ({ ...previous, source: "fixture" }) })
              }
              reason="Mounts the project-a fixture adapter — an explicit dev choice, never a fallback. Nothing in it can be written."
            />
          </div>
        }
      />
    );
  return <Atlas store={store} headRail={headRail} readoutBand={readoutBand} />;
}
