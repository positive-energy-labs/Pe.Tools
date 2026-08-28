import { token } from "#/lib/token";
import { useMemo } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { Cause } from "effect";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { address } from "@pe/agent-contracts";

import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { VerbLane } from "#/components/verb-lane";
import { Verb } from "#/components/lang/verb";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog";
import { fuseFleet, useFleet } from "#/host/fleet";
import { mintSelector, resolveTarget, type SessionFacts } from "#/host/target";
import { appAtomRegistry } from "#/state/registry";
import { fmtNum } from "#/components/master-table/model";
import { Atlas } from "#/takeoff/atlas";
import { createHostSessionSource, createLiveTakeoffHost } from "#/takeoff/host";
import { DEFAULT_ARTIFACT_DIR, type CandidateRegion } from "#/takeoff/model";
import {
  createFixtureSessionSource,
  createFixtureTakeoffHost,
} from "#/takeoff/proto/fixture-world";
import {
  createTakeoffStore,
  TAKEOFF_SLOTS,
  type TakeoffSlot,
  type TakeoffStore,
} from "#/takeoff/store";
import { useRouteStore } from "#/state/use-route-store";
import { TargetingHead } from "#/targeting/head";
import { RouteDocument } from "#/workbench/route-document";
import { useBindings, useRunner, type BindingPatch, type BindingState } from "#/targeting/kit";
import { product as defineProduct, type Feeds, type Link } from "#/targeting/model";
import { documentTrunk, worldTrunk } from "#/targeting/world";
import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import { usePeInfo } from "#/host/info";

const PANES = [
  { key: "plan", label: "plan image", draws: ["views"] },
  { key: "rooms", label: "room table", draws: ["zones"] },
  { key: "r10", label: ".r10 join", draws: ["r10"] },
] as const;

const str = (v: unknown) => (typeof v === "string" ? v : "");

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

type Search = ReturnType<(typeof Route)["useSearch"]>;

/** Per-browser recents — the legal-options source for the folder root. ponytail: a disk browse
 *  op would replace this; recents are enough while one firm has one takeoff folder. */
const DIRS_KEY = "pe.takeoffs.r10-dirs";
const readDirs = (): string[] => {
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

function LiveTakeoffsDocumentRoute() {
  return (
    <RouteDocument>
      {(at) => <TakeoffsStoreOwner key={`live:${at}`} source="live" documentAddress={at} />}
    </RouteDocument>
  );
}

function TakeoffsStoreOwner({
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

function TakeoffsPage({ store }: { store: TakeoffStore }) {
  const navigate = useNavigate({ from: "/takeoffs" });
  const { source, targeting } = Route.useSearch();
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
  const setState = (patch: BindingPatch<TakeoffSlot>) => store.actions.setBindings(patch);
  const boundZones = world.zones.filter((z) => zones.includes(z.zone.guid));

  const product = defineProduct(
    "takeoffs",
    "takeoffs",
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
    store.actions.setTargetingOpen,
    targetingLevel,
    store.actions.setTargetingLevel,
    targetingQuery,
    store.actions.setTargetingQuery,
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
          className="face-mono t-caption w-full bg-transparent px-1 py-0.5 outline-none"
          style={{ borderTop: `1px solid ${token("line-2")}`, color: token("ink") }}
        />
      </form>
    ) : null;

  return (
    <div className="relative flex h-screen flex-col">
      <div className="px-2 pt-2">
        <TargetingHead
          product={product}
          b={b}
          runner={runner}
          mode={targeting}
          extra={addFolder}
          aside={
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
              {failure ? (
                <Verb
                  label="dismiss"
                  onClick={() => store.actions.clearFailure()}
                  reason="Clears this error line. It does not retry — re-run the verb that failed."
                />
              ) : null}
            </span>
          }
        />
      </div>
      <div className="relative min-h-0 flex-1">
        {live && !session ? (
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
        ) : (
          <Atlas store={store} />
        )}
      </div>

      {!live && (
        <div className="absolute right-2 bottom-2 z-popup">
          <Verb
            label="leave fixture → live"
            onClick={() =>
              void navigate({ search: (previous) => ({ ...previous, source: "live" }) })
            }
            reason="Switches this route back to the live lane, where reads and writes address the targeted Revit document"
          />
        </div>
      )}

      {panel === "adopt" && scope && <AdoptPanel store={store} />}
      {panel === "sync" && scope && <SyncPanel store={store} />}
    </div>
  );
}

interface AdoptRow {
  region: CandidateRegion;
  view: string;
  checked: boolean;
  name: string;
  systemTag: string;
}

function AdoptPanel({ store }: { store: TakeoffStore }) {
  const views = useAtomValue(store.atoms.views);
  const zones = useAtomValue(store.atoms.world).zones;
  const listed = useAtomValue(store.atoms.adoptRows);
  const candidates = useAtomValue(store.atoms.candidates);
  const busy = useAtomValue(store.atoms.busy)?.id ?? null;

  const patchRow = (view: string, elementId: number, patch: Partial<AdoptRow>) =>
    store.actions.patchAdopt(view, elementId, patch);

  const picked = listed?.filter((r) => r.checked) ?? [];

  const adopt = () => {
    if (picked.length === 0) return;
    void store.actions.adoptSelected().catch(() => undefined);
  };

  return (
    <Panel
      title={`adopt zoning regions — ${views.length} view${views.length === 1 ? "" : "s"}`}
      onClose={() => store.actions.openPanel(null)}
    >
      <p className="face-mono t-value text-ink-2">
        tick the designer-drawn regions that are zones. adoption stamps them in place (role, guid,
        name, system tag) — re-adopt to edit. legends are ignored.
      </p>
      <div className="mt-2 max-h-96 overflow-y-auto rounded-sm border border-line">
        {(listed ?? []).map((r) => (
          <div
            key={`${r.view}:${r.region.elementId}`}
            className="flex items-center gap-2 border-b border-line px-2 py-1 last:border-b-0"
          >
            <input
              type="checkbox"
              checked={r.checked}
              onChange={(e) => patchRow(r.view, r.region.elementId, { checked: e.target.checked })}
            />
            <span className="face-mono t-value w-28 shrink-0 truncate text-ink-2" title={r.view}>
              {r.view}
            </span>
            <span
              className="inline-block size-2.5 shrink-0 rounded-[1px]"
              style={{ backgroundColor: `rgb(${r.region.color})` }}
            />
            <span
              className="face-mono t-value w-24 shrink-0 truncate text-ink-2"
              title={r.region.typeName}
            >
              {r.region.typeName}
            </span>
            <span className="face-mono t-value w-16 shrink-0 text-right tabular-nums text-ink-2">
              {fmtNum(r.region.sqft, 0)} sf
            </span>
            <input
              value={r.name}
              placeholder="zone name"
              onChange={(e) => patchRow(r.view, r.region.elementId, { name: e.target.value })}
              className="face-mono t-value h-6 min-w-0 flex-1 rounded-sm border border-line bg-transparent px-1.5 outline-none focus:border-line-2"
            />
            <input
              value={r.systemTag}
              placeholder="system tag"
              onChange={(e) => patchRow(r.view, r.region.elementId, { systemTag: e.target.value })}
              className="face-mono t-value h-6 w-24 shrink-0 rounded-sm border border-line bg-transparent px-1.5 outline-none focus:border-line-2"
            />
            {r.region.role === "zoning-region" && (
              <FactChip
                tone="done"
                className="shrink-0"
                title="This region is already stamped as a Zoning Region. Re-adopting edits its name and system tag in place."
              >
                stamped
              </FactChip>
            )}
          </div>
        ))}
        {listed === null && (
          <div className="px-2 py-3">
            {AsyncResult.isFailure(candidates) ? (
              <OutcomeLine
                kind="error"
                label="reading regions failed"
                says={String(Cause.squash(candidates.cause))}
              />
            ) : (
              <OutcomeLine kind="busy" label="reading regions" says={views.join(", ")} />
            )}
          </div>
        )}
        {listed !== null && listed.length === 0 && (
          <div className="px-2 py-3">
            <EmptyState story="scope" exit="draw the zones in Revit first, or bind other views">
              no filled regions — these views carry no designer-drawn regions to adopt
            </EmptyState>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Verb
          tone="commit"
          label={`stamp ${picked.length} as zoning regions`}
          disabled={busy !== null || picked.length === 0}
          reason={
            busy !== null
              ? `${busy} is in flight`
              : picked.length === 0
                ? "tick at least one region — adoption stamps exactly what is ticked, never 'whatever is selected'"
                : `Writes role, guid, name and system tag onto ${picked.length} filled region${picked.length === 1 ? "" : "s"} across ${new Set(picked.map((row) => row.view)).size} views. Idempotent: re-adopting edits in place.`
          }
          onClick={adopt}
        />
        <FactChip title="Zoning Regions already stamped anywhere in this document.">
          {zones.length} already adopted
        </FactChip>
      </div>
    </Panel>
  );
}

function SyncPanel({ store }: { store: TakeoffStore }) {
  const { zones: zoneGuids, r10: r10Path } = useAtomValue(store.atoms.selection);
  const { inScope, blockedZones, inserts, untagged, tags } = useAtomValue(store.atoms.syncPlan);
  const busy = useAtomValue(store.atoms.busy)?.id ?? null;
  const sync = () => void store.actions.syncRhvac().catch(() => undefined);

  return (
    <Panel title={`sync to ${r10Path}`} onClose={() => store.actions.openPanel(null)}>
      <p className="face-mono t-value text-ink-2">
        inserts reviewed rooms (with Manual J data) into the bound .r10 — always work on a COPY of
        the project template, never the original. systems are seeded by number + name only;
        everything else is filled in RHVAC.
      </p>

      <p className="t-label t-upper mt-2 text-ink-2">systems to seed ({tags.length})</p>
      {tags.map((tag) => (
        <p key={tag} className="face-mono t-value py-0.5">
          {tag}
        </p>
      ))}

      <p className="t-label t-upper mt-2 text-ink-2">
        rooms to insert ({inserts.length}
        {zoneGuids.length > 0
          ? ` · ${inScope.length} bound zone${inScope.length === 1 ? "" : "s"}`
          : ""}
        )
      </p>
      <div className="max-h-48 overflow-y-auto">
        {inserts.map(({ zone, room }, i) => (
          <p key={room.guid} className="face-mono t-value flex gap-2 py-px">
            <span className="w-8 shrink-0 text-right text-ink-2">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{room.name}</span>
            <span className="shrink-0 text-ink-2">
              {zone.zone.key} · {zone.tags[0] ?? "NO TAG"} · {fmtNum(room.sqft, 0)} sf
            </span>
          </p>
        ))}
        {inserts.length === 0 && (
          <div className="py-2">
            <EmptyState
              story="filter"
              exit="a room becomes eligible once it has a Room Region home, Manual J data entered, and no existing .r10 link"
            >
              nothing eligible to insert
            </EmptyState>
          </div>
        )}
      </div>

      {untagged > 0 && (
        <OutcomeLine
          className="mt-1"
          kind="advisory"
          label={`${untagged} room(s) in untagged zones`}
          says="re-adopt those zones with a system tag first — a room cannot land in a .r10 system that has no name"
        />
      )}
      {blockedZones.length > 0 && (
        <OutcomeLine
          className="mt-1"
          kind="advisory"
          label={`${blockedZones.length} zone(s) excluded`}
          says="resolve room flags, orphaned regions, materialization failures, or post-sync area drift first"
        />
      )}

      <div className="mt-2 flex items-center gap-2">
        <Verb
          tone="commit"
          label={`sync ${inserts.length} rooms`}
          disabled={busy !== null || inserts.length === 0 || untagged > 0}
          reason={
            busy !== null
              ? `${busy} is in flight`
              : inserts.length === 0
                ? "no room is eligible — a room needs a Room Region home, Manual J data, and no existing .r10 link"
                : untagged > 0
                  ? `${untagged} eligible room(s) sit in zones with no system tag — tag those zones first`
                  : `Inserts ${inserts.length} rooms into ${r10Path} and writes the {file, room} link back onto each Room Region. Work on a COPY of the template.`
          }
          onClick={sync}
        />
      </div>
    </Panel>
  );
}

function Panel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100vh-4rem)] w-[44rem] overflow-y-auto sm:max-w-[44rem]">
        <DialogHeader>
          <DialogTitle className="face-display">{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
