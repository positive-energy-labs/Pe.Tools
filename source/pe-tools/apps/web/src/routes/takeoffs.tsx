/**
 * /takeoffs — the Atlas workspace, canon. First route on the targeting manifest.
 *
 * The route declares ONE manifest (`PRODUCT`): what it reaches (world › rvt › view · zones;
 * folder › r10), the stages and verbs, and the panes. Everything live comes in as a `Feed` per
 * link. Bindings live in the URL search, so a reload or a shared link addresses the same thing.
 *
 * MULTI-SOURCE SYNC — every source is a query whose key carries its BASIS:
 *   world  · bridge.sessions.list — pushed (SSE invalidation at the root), always live
 *   rvt    · the bound session's active document — live with the world
 *   view · zones · rooms — one `readSnapshot` keyed [session, docTitle]; a doc change re-reads,
 *            a write verb invalidates (adopt, partition, decide, sync-link)
 *   folder · a per-browser recents list (the legal-options source for a disk root)
 *   r10    · `rhvac.list` keyed [dir]; the join is `rhvac.open` keyed [path], invalidated by sync
 *   overlay· this tab's ephemeral state (replays, partition runs, pending Manual J edits)
 *
 * `?source=fixture` mounts the project-a fixture adapter — an explicit dev choice, never a
 * fallback: a live read that fails shows its error, it does not quietly become a fixture.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog";
import { callHostRpc } from "#/host/client";
import { HOST_QUERY_KEY, useHostOp } from "#/host/queries";
import { mintSelector, resolveTarget } from "#/host/target";
import { useVerb } from "#/lib/use-verb";
import { fmtNum } from "#/components/master-table/model";
import { Atlas, type AtlasActions } from "#/takeoff/atlas";
import {
  adoptZones,
  detectCapture,
  linkRhvacBatch,
  partitionZone,
  prepareCapture,
  readCandidates,
  readSnapshot,
  writeDecisions,
  writeRoomType,
  createHostSessionSource,
  createLiveTakeoffHost,
  type LiveSnapshot,
} from "#/takeoff/host";
import {
  DEFAULT_ARTIFACT_DIR,
  upsertResolution,
  type CandidateRegion,
  type Resolution,
} from "#/takeoff/model";
import {
  createFixtureSessionSource,
  createFixtureTakeoffHost,
  useFixtureWorld,
} from "#/takeoff/proto/fixture-world";
import { createTakeoffStore, type TakeoffStore } from "#/takeoff/store";
import {
  applyEdit,
  buildLiveWorld,
  emptyOverlay,
  readZoneMeta,
  type SessionOverlay,
  type World,
  type WorldRoom,
  type WorldZone,
} from "#/takeoff/world";
import { TargetingHead } from "#/targeting/head";
import { useBindings, useRunner, type BindingState } from "#/targeting/kit";
import type { Feeds, Link, Product } from "#/targeting/model";
import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import type { RhvacInsertRoomData } from "@pe/host-contracts/operation-types";

// ── The manifest ─────────────────────────────────────────────────────────────

const LINKS: Link[] = [
  {
    key: "world",
    joiner: "in",
    placeholder: "pick a world",
    needs: "a live world — start Revit with the Pe add-in, or start one from /instances",
    liveness: "attached",
  },
  {
    key: "rvt",
    parent: "world",
    joiner: "",
    placeholder: "no document",
    needs: "the document arrives with the bound world",
  },
  {
    key: "view",
    parent: "rvt",
    joiner: "from",
    placeholder: "pick a zoning plan",
    needs: "plan views with filled regions come from the bound model",
    dir: "read",
  },
  {
    key: "zones",
    parent: "rvt",
    joiner: "into",
    placeholder: "pick zones",
    multi: true,
    needs: "zones come from adoption — stamp designer regions first",
    dir: "write",
  },
  {
    key: "folder",
    joiner: "beside",
    placeholder: "pick a folder",
    needs: "a host-visible folder holding .r10 files — add one below",
  },
  {
    key: "r10",
    parent: "folder",
    joiner: "syncing",
    placeholder: "pick a .r10",
    needs: ".r10 files come from the bound folder",
    dir: "sync",
    liveness: "detached",
  },
];

const PANES: Product["panes"] = [
  { key: "plan", label: "plan image", draws: ["view"] },
  { key: "rooms", label: "room table", draws: ["zones"] },
  { key: "r10", label: ".r10 join", draws: ["r10"] },
];

const STAGES = ["adopt", "audit", "sync"] as const;

// ── Search: the bindings' home ──────────────────────────────────────────────

// the router round-trips arrays as JSON; a hand-typed URL may still carry a comma list
const csv = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : typeof v === "string" && v
      ? v.split(",").filter(Boolean)
      : [];
const str = (v: unknown) => (typeof v === "string" ? v : "");

export const Route = createFileRoute("/takeoffs")({
  validateSearch: (search: Record<string, unknown>) => ({
    target: str(search.target),
    source: search.source === "fixture" ? ("fixture" as const) : ("live" as const),
    view: str(search.view),
    zones: csv(search.zones),
    dir: str(search.dir),
    r10: str(search.r10),
    stage: STAGES.find((s) => s === search.stage) ?? "adopt",
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

const EMPTY_WORLD: World = { docName: "", r10Path: null, lanes: [], zones: [], systems: [] };

function TakeoffsRoute() {
  const { source } = Route.useSearch();
  return <TakeoffsStoreOwner key={source} source={source} />;
}

function TakeoffsStoreOwner({ source }: { source: Search["source"] }) {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/takeoffs" });
  const storeRef = useRef<TakeoffStore | null>(null);
  const disposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createTakeoffStore({
      host: source === "fixture" ? createFixtureTakeoffHost() : createLiveTakeoffHost(),
      sessions: source === "fixture" ? createFixtureSessionSource() : createHostSessionSource(),
      search: {
        patch: (patch) =>
          void navigate({
            search: (previous) => ({
              ...previous,
              ...patch,
              zones: patch.zones ? [...patch.zones] : previous.zones,
            }),
          }),
      },
    });
    for (const dir of readDirs().reverse()) storeRef.current.actions.rememberDir(dir);
  }
  const store = storeRef.current;
  useEffect(() => {
    if (disposeTimer.current) clearTimeout(disposeTimer.current);
    return () => {
      disposeTimer.current = setTimeout(() => store.dispose(), 0);
    };
  }, [store]);
  useEffect(() => store.actions.setSearch(search), [search, store]);
  return (
    <RegistryContext.Provider value={store.atoms.registry}>
      <TakeoffsPage store={store} />
    </RegistryContext.Provider>
  );
}

function TakeoffsPage({ store }: { store: TakeoffStore }) {
  const search = Route.useSearch();
  const { target, source, view, zones, dir, r10, stage } = search;
  const navigate = useNavigate({ from: "/takeoffs" });
  const setSearch = useCallback(
    (patch: Partial<Search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }) }),
    [navigate],
  );
  const qc = useQueryClient();

  // ── sources ──
  const sessionsResult = useAtomValue(store.atoms.sessions);
  const sessions = AsyncResult.isSuccess(sessionsResult) ? sessionsResult.value.value : [];
  const resolution = resolveTarget(sessions, target);
  const session = resolution.kind === "resolved" ? resolution.session : null;
  const scope: HostSessionScope | null = session ? { bridgeSessionId: session.sessionId } : null;
  const docTitle = session?.activeDocumentTitle ?? null;

  const fixture = useFixtureWorld();
  const live = source === "live";

  const snapshotKey = ["takeoff-snapshot", scope?.bridgeSessionId ?? "", docTitle ?? ""] as const;
  const snapshot = useQuery({
    queryKey: snapshotKey,
    queryFn: () => readSnapshot(scope!),
    enabled: live && scope !== null,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  const raw = snapshot.data ?? null;

  const [dirs, setDirs] = useState(readDirs);
  const addDir = (d: string) => {
    const next = [d, ...dirs.filter((x) => x !== d)].slice(0, 8);
    localStorage.setItem(DIRS_KEY, JSON.stringify(next));
    setDirs(next);
    store.actions.rememberDir(d);
    setSearch({ dir: d, r10: "" });
  };
  const r10Query = useHostOp(
    "rhvac.open",
    { path: r10 },
    { enabled: live && r10 !== "", staleTime: Number.POSITIVE_INFINITY },
  );

  const [overlay, setOverlay] = useState<SessionOverlay>(emptyOverlay);
  const { busy, seconds: busySeconds, error, setError, receipt, run } = useVerb();
  const [panel, setPanel] = useState<"adopt" | "sync" | null>(null);

  const world: World = live
    ? raw
      ? buildLiveWorld({ ...raw, overlay, r10Path: r10 || null, r10: r10Query.data ?? null })
      : { ...EMPTY_WORLD, docName: scope ? "reading…" : "no target" }
    : withEdits(fixture.world, overlay);

  // ── feeds: one per link, each a projection of a query's state ──
  const projectedFeeds: Feeds = {
    world: useAtomValue(store.feeds.world),
    rvt: useAtomValue(store.feeds.rvt),
    view: useAtomValue(store.feeds.view),
    zones: useAtomValue(store.feeds.zones),
    folder: useAtomValue(store.feeds.folder),
    r10: useAtomValue(store.feeds.r10),
  };
  const feeds = projectedFeeds;

  // ── bindings: URL ⇄ manifest ──
  const state: BindingState = useMemo(
    () => ({
      bound: {
        world: live ? (session ? mintSelector(session, sessions) : null) : "fixture",
        rvt: live ? docTitle : "fixture",
        view: view || null,
        folder: dir || null,
        r10: r10 || null,
      },
      multi: { zones: new Set(zones) },
      stage,
    }),
    [live, session, sessions, docTitle, view, dir, r10, zones, stage],
  );
  const setState = useCallback(
    (patch: Partial<BindingState>) => {
      const next: Partial<Search> = {};
      if (patch.stage) next.stage = patch.stage as Search["stage"];
      if (patch.bound) {
        const b = patch.bound;
        if (live && b.world !== state.bound.world) next.target = b.world ?? "";
        next.view = b.view ?? "";
        next.dir = b.folder ?? "";
        next.r10 = b.r10 ?? "";
      }
      if (patch.multi) next.zones = [...(patch.multi.zones ?? [])];
      setSearch(next);
    },
    [live, state.bound.world, setSearch],
  );

  // ── verbs ──
  const invalidateSnapshot = () => qc.invalidateQueries({ queryKey: snapshotKey });
  const patchSnapshot = (fn: (prev: LiveSnapshot) => LiveSnapshot) =>
    qc.setQueryData<LiveSnapshot>(snapshotKey, (prev) => (prev ? fn(prev) : prev));
  const boundZones = world.zones.filter((z) => zones.includes(z.zone.guid));

  const product: Product = {
    key: "takeoffs",
    name: "takeoffs",
    links: LINKS,
    panes: PANES,
    stages: [
      {
        key: "adopt",
        label: "adopt",
        verbs: [
          {
            key: "adopt",
            label: "adopt zones",
            demands: ["view"],
            run: live ? async () => setPanel("adopt") : null,
            needs: "a live document — the fixture cannot be stamped",
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
            demands: ["view"],
            run: live
              ? async () => {
                  const prepared = await prepareCapture(scope!, view);
                  const detected = await detectCapture(scope!, prepared.level);
                  setOverlay((prev) => ({
                    ...prev,
                    replays: { ...prev.replays, [prepared.level]: detected.replayPath },
                  }));
                  return `captured ${prepared.level}: ${detected.rooms} rooms · ${fmtNum(detected.totalSqft, 0)} sf`;
                }
              : null,
            needs: "a live document — the fixture is already captured",
          },
          {
            key: "partition",
            label: `partition ${zones.length || ""} zone${zones.length === 1 ? "" : "s"}`,
            demands: ["zones"],
            refuse: () => {
              const uncaptured = boundZones.find((z) => !overlay.replays[z.zone.lane.label]);
              return uncaptured
                ? `capture ${uncaptured.zone.lane.label} first — the partition replays its snapshot`
                : null;
            },
            run: live
              ? async () => {
                  for (const zone of boundZones) {
                    const result = await partitionZone(scope!, {
                      replayPath: overlay.replays[zone.zone.lane.label]!,
                      view: zone.zone.lane.view,
                      levelFragment: zone.zone.lane.label,
                      zoneName: zone.name,
                      zoneGuid: zone.zone.guid,
                      runId: `run-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`,
                      loops: zone.zone.loops,
                    });
                    patchSnapshot((prev) => ({
                      ...prev,
                      regionsByZone: { ...prev.regionsByZone, [zone.zone.guid]: result.regions },
                    }));
                    setOverlay((prev) => ({
                      ...prev,
                      runs: { ...prev.runs, [zone.zone.guid]: result },
                    }));
                  }
                  return `partitioned ${boundZones.map((z) => z.zone.key).join(", ")}`;
                }
              : null,
            needs: "a live document — the fixture is already partitioned",
          },
          {
            key: "refresh",
            label: "refresh",
            demands: ["rvt"],
            run: live ? async () => void (await snapshot.refetch()) : null,
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
            refuse: () =>
              r10Query.isError ? `the .r10 did not open — ${r10Query.error?.message}` : null,
            run: live ? async () => setPanel("sync") : null,
            needs: "a live document — the fixture has no .r10 to sync into",
          },
          {
            key: "launch",
            label: "open in RHVAC",
            nav: true,
            demands: ["r10"],
            run: async () => {
              await callHostRpc("rhvac.launch", { path: r10 }, scope ?? undefined);
            },
          },
        ],
      },
    ],
  };

  const b = useBindings(product, feeds, state, setState);
  const runner = useRunner(product, b, run, busy);

  const actions: AtlasActions = {
    patch: (guid, patch) => {
      const persistOverlay = () =>
        setOverlay((prev) => ({
          ...prev,
          edits: { ...prev.edits, [guid]: { ...prev.edits[guid], ...patch } },
        }));
      if (live && scope && patch.type) {
        const room = world.zones.flatMap((z) => z.rooms).find((c) => c.guid === guid);
        if (room?.elementId != null) {
          void run("writing room type", async () => {
            await writeRoomType(scope, room.elementId!, patch.type!);
            persistOverlay();
          });
          return;
        }
      }
      persistOverlay();
    },
    decide: (room, flag, verb) => {
      if (!live || !scope) return; // fixture: local only, and says so
      if (room.elementId === null) {
        setError(`room ${room.name}: no Room Region home to write the decision to`);
        return;
      }
      const next: Resolution = {
        subject: room.provenance.sourceRoomId,
        flag,
        verb,
        at: new Date().toISOString(),
        runId: room.provenance.runId,
      };
      void run(`writing ${verb}`, async () => {
        const result = await writeDecisions(
          scope,
          room.elementId!,
          upsertResolution(room.decisions, next),
        );
        patchSnapshot((prev) => replaceRegionBlob(prev, room.elementId!, result.blob));
      });
    },
    capture: (lane) => {
      if (!scope) return;
      void run(`capturing ${lane.label}`, async () => {
        const prepared = await prepareCapture(scope, lane.view);
        const detected = await detectCapture(scope, prepared.level);
        setOverlay((prev) => ({
          ...prev,
          replays: { ...prev.replays, [lane.label]: detected.replayPath },
        }));
      });
    },
    partition: (zone) => {
      if (!scope) return;
      const replayPath = overlay.replays[zone.zone.lane.label];
      if (!replayPath) {
        setError(`capture ${zone.zone.lane.label} first — the partition replays its snapshot`);
        return;
      }
      void run(`partitioning ${zone.zone.key}`, async () => {
        const result = await partitionZone(scope, {
          replayPath,
          view: zone.zone.lane.view,
          levelFragment: zone.zone.lane.label,
          zoneName: zone.name,
          zoneGuid: zone.zone.guid,
          runId: `run-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`,
          loops: zone.zone.loops,
        });
        patchSnapshot((prev) => ({
          ...prev,
          regionsByZone: { ...prev.regionsByZone, [zone.zone.guid]: result.regions },
        }));
        setOverlay((prev) => ({ ...prev, runs: { ...prev.runs, [zone.zone.guid]: result } }));
      });
    },
    refresh: () => void snapshot.refetch(),
  };

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
          style={{ borderTop: "1px solid var(--r-line-2)", color: "var(--r-ink)" }}
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
            busy ? (
              <OutcomeLine
                kind="busy"
                label={`${busy} · ${busySeconds}s`}
                says="the host runs one transaction at a time"
              />
            ) : receipt ? (
              <OutcomeLine kind="receipt" label={receipt.text} />
            ) : undefined
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
              onClick={() => setSearch({ source: "fixture" })}
              reason="Mounts the project-a fixture adapter — an explicit dev choice, never a fallback. Nothing in it can be written."
            />
          </div>
        ) : (
          <Atlas
            world={world}
            geoReady={live ? raw !== null : fixture.geoReady}
            live={live}
            busy={busy ? `${busy} · ${busySeconds}s queued/running` : null}
            actions={actions}
          />
        )}
      </div>

      {/* A failed host call is an ERROR, not a seam — caution, deliberately not the alarm. */}
      {error && (
        <div className="absolute bottom-2 left-1/2 z-40 max-w-2xl -translate-x-1/2 bg-background px-2 py-1 shadow-md">
          <OutcomeLine kind="error" label={error} />
          <Verb
            label="dismiss"
            onClick={() => setError(null)}
            reason="Clears this error line. It does not retry — re-run the verb that failed."
          />
        </div>
      )}

      {!live && (
        <div className="absolute right-2 bottom-2 z-40">
          <Verb
            label="leave fixture → live"
            onClick={() => setSearch({ source: "live" })}
            reason="Switches this route back to the live lane, where reads and writes address the targeted Revit document"
          />
        </div>
      )}

      {panel === "adopt" && scope && (
        <AdoptPanel
          scope={scope}
          view={view}
          zones={world.zones}
          run={run}
          busy={busy}
          onClose={() => setPanel(null)}
          onDone={() => {
            setPanel(null);
            void invalidateSnapshot();
          }}
        />
      )}
      {panel === "sync" && scope && raw && (
        <SyncPanel
          scope={scope}
          world={world}
          zoneGuids={zones}
          r10Path={r10}
          run={run}
          busy={busy}
          onClose={() => setPanel(null)}
          onDone={() => {
            setPanel(null);
            void invalidateSnapshot();
            void qc.invalidateQueries({
              predicate: (q) =>
                q.queryKey[0] === HOST_QUERY_KEY[0] && q.queryKey[2] === "rhvac.open",
            });
          }}
        />
      )}
    </div>
  );
}

function replaceRegionBlob(raw: LiveSnapshot, elementId: number, blob: string): LiveSnapshot {
  return {
    ...raw,
    regionsByZone: Object.fromEntries(
      Object.entries(raw.regionsByZone).map(([zoneGuid, regions]) => [
        zoneGuid,
        regions.map((region) => (region.elementId === elementId ? { ...region, blob } : region)),
      ]),
    ),
  };
}

const WALL_ASSEMBLY =
  "R-3 insulated sheathing, R-13 closed cell sprayfoam in a 2x6 wood stud cavity, R-15 Fiberglass batt";
const ROOF_ASSEMBLY = "R49 closed cell sprayfoam in 2x14 joist cavity";
const FLOOR_ASSEMBLY =
  "R-19 open cell 1/2 lb. spray foam insulation, 5 inches in 2 x 10 joist cavity, any cover";

/** Minimal honest Attic payload: polygon edges become walls; room area becomes floor and roof. */
function buildRhvacInsert(
  room: WorldRoom,
  number: number,
  systemNumber: number,
): RhvacInsertRoomData {
  const height = room.ceilingFt || 8;
  const outer = room.outer ?? [];
  const walls = outer.map(([x1, y1], i) => {
    const [x2, y2] = outer[(i + 1) % outer.length]!;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const octant = ((Math.round((angle + Math.PI / 2) / (Math.PI / 4)) % 8) + 8) % 8;
    return {
      index1: i + 1,
      assembly: WALL_ASSEMBLY,
      uValue: 0.036,
      lengthFeet: Math.hypot(x2 - x1, y2 - y1),
      heightFeet: height,
      direction: octant + 1,
    };
  });
  return {
    number,
    name: room.name,
    systemNumber,
    zoneNumber: 1,
    areaSquareFeet: room.sqft,
    ceilingHeightFeet: height,
    people: room.data!.people,
    lightingWatts: room.data!.lightingW,
    equipmentSensibleBtuh: room.data!.equipSensible,
    equipmentLatentBtuh: room.data!.equipLatent,
    ventilationCfm: room.data!.ventilationCfm,
    floors: [
      {
        assembly: FLOOR_ASSEMBLY,
        uValue: 0.051,
        areaSquareFeet: room.sqft,
        exposedPerimeterFeet: walls.reduce((sum, wall) => sum + wall.lengthFeet, 0),
      },
    ],
    roofs: [
      { assembly: ROOF_ASSEMBLY, uValue: 0.024, areaSquareFeet: room.sqft, areaMultiplier: 1.2 },
    ],
    walls,
    glass: [],
    doors: [],
  };
}

/** Apply the session overlay's pending edits to a fixture world (the live builder does this
 *  itself), so cell edits behave identically on both sources. */
function withEdits(world: World, overlay: SessionOverlay): World {
  if (Object.keys(overlay.edits).length === 0) return world;
  return {
    ...world,
    zones: world.zones.map((z) => ({
      ...z,
      rooms: z.rooms.map((r) => applyEdit(r, overlay.edits[r.guid])),
    })),
  };
}

// ── Adopt panel — stamp designer FRs in place as Zoning Regions ─────────────

interface AdoptRow {
  region: CandidateRegion;
  checked: boolean;
  name: string;
  systemTag: string;
}

function AdoptPanel({
  scope,
  view,
  zones,
  run,
  busy,
  onClose,
  onDone,
}: {
  scope: HostSessionScope;
  /** The bound zoning view — the sentence picked it; the panel only lists its regions. */
  view: string;
  zones: WorldZone[];
  run: (label: string, work: () => Promise<string | void>) => Promise<void>;
  busy: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<AdoptRow[] | null>(null);
  const candidates = useQuery({
    queryKey: ["takeoff-candidates", scope.bridgeSessionId, view],
    queryFn: () => readCandidates(scope, view),
    staleTime: 0,
  });
  const listed = rows ?? candidates.data?.map(toRow) ?? null;

  const patchRow = (elementId: number, patch: Partial<AdoptRow>) =>
    setRows((prev) =>
      (prev ?? listed ?? []).map((r) =>
        r.region.elementId === elementId ? { ...r, ...patch } : r,
      ),
    );

  const picked = listed?.filter((r) => r.checked) ?? [];

  const adopt = () => {
    if (picked.length === 0) return;
    void run(`stamping ${picked.length} zones`, async () => {
      await adoptZones(
        scope,
        view,
        picked.map((r) => ({
          elementId: r.region.elementId,
          name: r.name,
          systemTag: r.systemTag,
        })),
      );
      onDone();
      return `stamped ${picked.length} zoning region${picked.length === 1 ? "" : "s"} in ${view}`;
    });
  };

  return (
    <Panel title={`adopt zoning regions — ${view}`} onClose={onClose}>
      <p className="face-mono t-value text-muted-foreground">
        tick the designer-drawn regions that are zones. adoption stamps them in place (role, guid,
        name, system tag) — re-adopt to edit. legends are ignored.
      </p>
      <div className="mt-2 max-h-96 overflow-y-auto rounded-[var(--radius)] border border-border">
        {(listed ?? []).map((r) => (
          <div
            key={r.region.elementId}
            className="flex items-center gap-2 border-b border-[var(--r-line)] px-2 py-1 last:border-b-0"
          >
            <input
              type="checkbox"
              checked={r.checked}
              onChange={(e) => patchRow(r.region.elementId, { checked: e.target.checked })}
            />
            <span
              className="inline-block size-2.5 shrink-0 rounded-[1px]"
              style={{ background: `rgb(${r.region.color})` }}
            />
            <span
              className="face-mono t-value w-24 shrink-0 truncate text-muted-foreground"
              title={r.region.typeName}
            >
              {r.region.typeName}
            </span>
            <span className="face-mono t-value w-16 shrink-0 text-right tabular-nums text-muted-foreground">
              {fmtNum(r.region.sqft, 0)} sf
            </span>
            <input
              value={r.name}
              placeholder="zone name"
              onChange={(e) => patchRow(r.region.elementId, { name: e.target.value })}
              className="face-mono t-value h-6 min-w-0 flex-1 rounded-[var(--radius)] border border-border bg-transparent px-1.5 outline-none focus:border-ring"
            />
            <input
              value={r.systemTag}
              placeholder="system tag"
              onChange={(e) => patchRow(r.region.elementId, { systemTag: e.target.value })}
              className="face-mono t-value h-6 w-24 shrink-0 rounded-[var(--radius)] border border-border bg-transparent px-1.5 outline-none focus:border-ring"
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
          <p className="px-2 py-3">
            {candidates.isError ? (
              <OutcomeLine
                kind="error"
                label={`reading regions failed — ${candidates.error.message}`}
              />
            ) : (
              <OutcomeLine kind="busy" label="reading regions" says={view} />
            )}
          </p>
        )}
        {listed !== null && listed.length === 0 && (
          <div className="px-2 py-3">
            <EmptyState story="scope" exit="draw the zones in Revit first, or bind another view">
              no filled regions — this view carries no designer-drawn regions to adopt
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
                : `Writes role, guid, name and system tag onto ${picked.length} filled region${picked.length === 1 ? "" : "s"} in ${view}. Idempotent: re-adopting edits in place.`
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

function toRow(region: CandidateRegion): AdoptRow {
  const meta = readZoneMeta(region.blob);
  return {
    region,
    checked: region.role === "zoning-region",
    name: meta.name || region.typeName,
    systemTag: meta.systemTag,
  };
}

// ── Sync panel — insert reviewed rooms into a template .r10 copy ────────────

function SyncPanel({
  scope,
  world,
  zoneGuids,
  r10Path,
  run,
  busy,
  onClose,
  onDone,
}: {
  scope: HostSessionScope;
  world: World;
  /** Bound zones narrow the insert set; none bound = every eligible zone. */
  zoneGuids: string[];
  r10Path: string;
  run: (label: string, work: () => Promise<string | void>) => Promise<void>;
  busy: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  interface InsertRow {
    zone: WorldZone;
    room: WorldRoom;
  }
  const inScope = world.zones.filter(
    (z) => zoneGuids.length === 0 || zoneGuids.includes(z.zone.guid),
  );
  const blockedZones = inScope.filter(
    (zone) =>
      zone.driftSqft > 0 ||
      zone.rooms.some((room) => room.flags.length > 0) ||
      zone.runs.some((item) => item.orphaned > 0 || item.failures > 0),
  );
  const blockedZoneIds = new Set(blockedZones.map((zone) => zone.zone.guid));
  const inserts: InsertRow[] = inScope.flatMap((zone) =>
    blockedZoneIds.has(zone.zone.guid)
      ? []
      : zone.rooms
          .filter((room) => room.elementId !== null && room.r10 === null && room.data !== null)
          .map((room) => ({ zone, room })),
  );
  const untagged = inserts.filter(({ zone }) => zone.tags.length === 0);
  const tags = [...new Set(inserts.flatMap(({ zone }) => zone.tags))];

  const sync = () => {
    if (inserts.length === 0 || untagged.length > 0) return;
    void run(`syncing ${inserts.length} rooms`, async () => {
      const before = await callHostRpc("rhvac.open", { path: r10Path }, scope);
      const firstRoomNumber = Math.max(0, ...before.rooms.map((room) => room.number)) + 1;
      const bySystemName = new Map(
        before.systems
          .filter((system) => system.name.trim().length > 0)
          .map((system) => [system.name.trim().toLocaleLowerCase(), system.number]),
      );
      const firstRun =
        before.rooms.length === 1 &&
        before.rooms[0]!.number === 1 &&
        before.rooms[0]!.name.trim().length === 0 &&
        before.rooms[0]!.areaSquareFeet === 0;
      let nextSystemNumber = Math.max(0, ...before.systems.map((system) => system.number)) + 1;
      const systemNumbers = new Map<string, number>();
      for (const tag of tags) {
        const existing = bySystemName.get(tag.trim().toLocaleLowerCase());
        if (existing !== undefined) systemNumbers.set(tag, existing);
        else if (firstRun) systemNumbers.set(tag, nextSystemNumber++);
        else
          throw new Error(
            `system '${tag}' does not exist in this non-first-run .r10; create/tag it in RHVAC first`,
          );
      }
      const result = await callHostRpc(
        "rhvac.sync",
        {
          targetPath: r10Path,
          updates: [],
          inserts: inserts.map(({ zone, room }, i) =>
            buildRhvacInsert(room, firstRoomNumber + i, systemNumbers.get(zone.tags[0]!)!),
          ),
          systems: tags.map((tag) => ({ number: systemNumbers.get(tag)!, name: tag })),
          deleteUntouchedSeedRoom: true,
        },
        scope,
      );

      // Write the {file identity, room Identifier} linkage home onto each Room Region blob.
      // fileIdentity is deliberately weak (.r10 has no GUID) — fileName + title-hash stamp.
      const fileIdentity = `${result.fileIdentity.fileName}#${result.fileIdentity.stamp}`;
      const byNumber = new Map(result.insertedRooms.map((r) => [r.number, r.identifier]));
      const now = new Date().toISOString();
      const links = inserts.map(({ room }, i) => {
        const number = firstRoomNumber + i;
        const identifier = byNumber.get(number);
        if (identifier === undefined)
          throw new Error(`.r10 sync omitted the receipt for inserted room number ${number}`);
        return {
          elementId: room.elementId!,
          link: { identifier, fileIdentity, syncedAt: now, lastSyncedSqft: room.sqft },
        };
      });
      if (byNumber.size !== links.length)
        throw new Error(
          `.r10 sync returned ${byNumber.size} insert receipts for ${links.length} rooms`,
        );
      await linkRhvacBatch(scope, links);
      onDone();
      return (
        `synced ${result.insertedRooms.length}/${inserts.length} rooms into ${r10Path}` +
        ` (${result.roomsBefore}→${result.roomsAfter} rooms, seed room ${result.seedRoom.action})` +
        (result.backupPath ? ` · backup: ${result.backupPath}` : "") +
        (result.assemblyFallbacks.length > 0
          ? ` · ${result.assemblyFallbacks.length} assembly fallbacks`
          : "")
      );
    });
  };

  return (
    <Panel title={`sync to ${r10Path}`} onClose={onClose}>
      <p className="face-mono t-value text-muted-foreground">
        inserts reviewed rooms (with Manual J data) into the bound .r10 — always work on a COPY of
        the project template, never the original. systems are seeded by number + name only;
        everything else is filled in RHVAC.
      </p>

      <p className="t-label t-upper mt-2 text-muted-foreground">systems to seed ({tags.length})</p>
      {tags.map((tag) => (
        <p key={tag} className="face-mono t-value py-0.5">
          {tag}
        </p>
      ))}

      <p className="t-label t-upper mt-2 text-muted-foreground">
        rooms to insert ({inserts.length}
        {zoneGuids.length > 0
          ? ` · ${inScope.length} bound zone${inScope.length === 1 ? "" : "s"}`
          : ""}
        )
      </p>
      <div className="max-h-48 overflow-y-auto">
        {inserts.map(({ zone, room }, i) => (
          <p key={room.guid} className="face-mono t-value flex gap-2 py-px">
            <span className="w-8 shrink-0 text-right text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{room.name}</span>
            <span className="shrink-0 text-muted-foreground">
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

      {untagged.length > 0 && (
        <OutcomeLine
          className="mt-1"
          kind="advisory"
          label={`${untagged.length} room(s) in untagged zones`}
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
          disabled={busy !== null || inserts.length === 0 || untagged.length > 0}
          reason={
            busy !== null
              ? `${busy} is in flight`
              : inserts.length === 0
                ? "no room is eligible — a room needs a Room Region home, Manual J data, and no existing .r10 link"
                : untagged.length > 0
                  ? `${untagged.length} eligible room(s) sit in zones with no system tag — tag those zones first`
                  : `Inserts ${inserts.length} rooms into ${r10Path} and writes the {file, room} link back onto each Room Region. Work on a COPY of the template.`
          }
          onClick={sync}
        />
      </div>
    </Panel>
  );
}

// ── Shared panel chrome ─────────────────────────────────────────────────────

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
          <DialogTitle className="font-pe-display text-sm font-semibold tracking-tight">
            {title}
          </DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
