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
 *   staged · registry-owned `{base,next}` room edits, replays, panel state, and verb receipts
 *
 * `?source=fixture` mounts the project-a fixture adapter — an explicit dev choice, never a
 * fallback: a live read that fails shows its error, it does not quietly become a fixture.
 */
import { useEffect, useMemo } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog";
import { mintSelector, resolveTarget } from "#/host/target";
import { appAtomRegistry } from "#/state/registry";
import { fmtNum } from "#/components/master-table/model";
import { Atlas } from "#/takeoff/atlas";
import { createHostSessionSource, createLiveTakeoffHost } from "#/takeoff/host";
import { DEFAULT_ARTIFACT_DIR, type CandidateRegion } from "#/takeoff/model";
import {
  createFixtureSessionSource,
  createFixtureTakeoffHost,
} from "#/takeoff/proto/fixture-world";
import { createTakeoffStore, TAKEOFF_LINKS, type TakeoffStore } from "#/takeoff/store";
import { useRouteStore } from "#/state/use-route-store";
import { TargetingHead } from "#/targeting/head";
import { useBindings, useRunner, type BindingState } from "#/targeting/kit";
import type { Feeds, Link, Product } from "#/targeting/model";
import type { HostSessionScope } from "@pe/host-contracts/operation-types";

// ── The manifest ─────────────────────────────────────────────────────────────

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
    thread: str(search.thread) || undefined,
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

function TakeoffsRoute() {
  const { source, thread } = Route.useSearch();
  return <TakeoffsStoreOwner key={`${source}:${thread ?? ""}`} source={source} thread={thread} />;
}

function TakeoffsStoreOwner({
  source,
  thread,
}: {
  source: Search["source"];
  thread?: string;
}) {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/takeoffs" });
  const store = useRouteStore(() => {
    const created = createTakeoffStore({
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
      registry: appAtomRegistry,
      ...(thread ? { scope: { threadId: thread } } : {}),
    });
    for (const dir of readDirs().reverse()) created.actions.rememberDir(dir);
    return created;
  });
  useEffect(() => store.actions.setSearch(search), [search, store]);
  return <TakeoffsPage store={store} />;
}

function TakeoffsPage({ store }: { store: TakeoffStore }) {
  const search = Route.useSearch();
  const { target, source, view, zones, dir, r10, stage } = search;
  // ── sources ──
  const sessionsResult = useAtomValue(store.atoms.sessions);
  const sessions = AsyncResult.isSuccess(sessionsResult) ? sessionsResult.value.value : [];
  const resolution = resolveTarget(sessions, target);
  const session = resolution.kind === "resolved" ? resolution.session : null;
  const scope: HostSessionScope | null = session ? { bridgeSessionId: session.sessionId } : null;
  const docTitle = session?.activeDocumentTitle ?? null;

  const live = source === "live";
  const world = useAtomValue(store.atoms.world);
  const busyState = useAtomValue(store.atoms.busy);
  const failure = useAtomValue(store.atoms.failure);
  const receipt = useAtomValue(store.atoms.receipt);
  const panel = useAtomValue(store.atoms.panel);
  const targetingOpen = useAtomValue(store.atoms.targetingOpen);
  const targetingLevel = useAtomValue(store.atoms.targetingLevel);
  const targetingQuery = useAtomValue(store.atoms.targetingQuery);
  const busy = busyState?.id ?? null;
  const busySeconds = busyState?.seconds ?? 0;

  const addDir = (d: string) => {
    const dirs = readDirs();
    const next = [d, ...dirs.filter((x) => x !== d)].slice(0, 8);
    localStorage.setItem(DIRS_KEY, JSON.stringify(next));
    store.actions.rememberDir(d);
    store.actions.patchSearch({ dir: d, r10: "" });
  };
  const r10Result = useAtomValue(store.atoms.r10);

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
  const setState = (patch: Partial<BindingState>) => store.actions.setBindings(patch);

  // ── verbs ──
  const boundZones = world.zones.filter((z) => zones.includes(z.zone.guid));

  const product: Product = {
    key: "takeoffs",
    name: "takeoffs",
    links: TAKEOFF_LINKS,
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
            run: () => store.actions.openAdopt(),
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
            demands: ["view"],
            run: live
              ? async () => {
                  const lane = world.lanes.find((candidate) => candidate.view === view);
                  if (!lane) throw new Error(`unknown zoning view ${view}`);
                  await store.actions.capture(lane);
                }
              : null,
            needs: "a live document — the fixture is already captured",
          },
          {
            key: "partition",
            label: `partition ${zones.length || ""} zone${zones.length === 1 ? "" : "s"}`,
            demands: ["zones"],
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
              : null,
            needs: "a live document — the fixture is already partitioned",
          },
          {
            key: "refresh",
            label: "refresh",
            demands: ["rvt"],
            run: live ? () => store.actions.refresh() : null,
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
            refuse: () => (AsyncResult.isFailure(r10Result) ? "the .r10 did not open" : null),
            run: live ? () => store.actions.openSync() : null,
            needs: "a live document — the fixture has no .r10 to sync into",
          },
          {
            key: "launch",
            label: "open in RHVAC",
            nav: true,
            demands: ["r10"],
            run: async () => void (await store.actions.launchRhvac()),
          },
          ...(AsyncResult.isFailure(r10Result)
            ? [
                {
                  key: "retry-r10",
                  label: "retry .r10",
                  demands: ["r10"],
                  run: () => store.actions.retryRhvac(),
                },
              ]
            : []),
        ],
      },
    ],
  };

  const b = useBindings(
    product,
    feeds,
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
              onClick={() => store.actions.patchSearch({ source: "fixture" })}
              reason="Mounts the project-a fixture adapter — an explicit dev choice, never a fallback. Nothing in it can be written."
            />
          </div>
        ) : (
          <Atlas store={store} />
        )}
      </div>

      {/* A failed host call is an ERROR, not a seam — caution, deliberately not the alarm. */}
      {failure && (
        <div className="absolute bottom-2 left-1/2 z-40 max-w-2xl -translate-x-1/2 bg-background px-2 py-1 shadow-md">
          <OutcomeLine kind="error" label={failure.message} />
          <Verb
            label="dismiss"
            onClick={() => store.actions.clearFailure()}
            reason="Clears this error line. It does not retry — re-run the verb that failed."
          />
        </div>
      )}

      {!live && (
        <div className="absolute right-2 bottom-2 z-40">
          <Verb
            label="leave fixture → live"
            onClick={() => store.actions.patchSearch({ source: "live" })}
            reason="Switches this route back to the live lane, where reads and writes address the targeted Revit document"
          />
        </div>
      )}

      {panel === "adopt" && scope && <AdoptPanel store={store} />}
      {panel === "sync" && scope && <SyncPanel store={store} />}
    </div>
  );
}

// ── Adopt panel — stamp designer FRs in place as Zoning Regions ─────────────

interface AdoptRow {
  region: CandidateRegion;
  checked: boolean;
  name: string;
  systemTag: string;
}

function AdoptPanel({ store }: { store: TakeoffStore }) {
  const view = useAtomValue(store.atoms.view);
  const zones = useAtomValue(store.atoms.world).zones;
  const listed = useAtomValue(store.atoms.adoptRows);
  const candidates = useAtomValue(store.atoms.candidates);
  const busy = useAtomValue(store.atoms.busy)?.id ?? null;

  const patchRow = (elementId: number, patch: Partial<AdoptRow>) =>
    store.actions.patchAdopt(elementId, patch);

  const picked = listed?.filter((r) => r.checked) ?? [];

  const adopt = () => {
    if (picked.length === 0) return;
    void store.actions.adoptSelected().catch(() => undefined);
  };

  return (
    <Panel title={`adopt zoning regions — ${view}`} onClose={() => store.actions.openPanel(null)}>
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
          <div className="px-2 py-3">
            {AsyncResult.isFailure(candidates) ? (
              <OutcomeLine kind="error" label="reading regions failed" />
            ) : (
              <OutcomeLine kind="busy" label="reading regions" says={view} />
            )}
          </div>
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

// ── Sync panel — insert reviewed rooms into a template .r10 copy ────────────

function SyncPanel({ store }: { store: TakeoffStore }) {
  const { zones: zoneGuids, r10: r10Path } = useAtomValue(store.atoms.search);
  const { inScope, blockedZones, inserts, untagged, tags } = useAtomValue(store.atoms.syncPlan);
  const busy = useAtomValue(store.atoms.busy)?.id ?? null;
  const sync = () => void store.actions.syncRhvac().catch(() => undefined);

  return (
    <Panel title={`sync to ${r10Path}`} onClose={() => store.actions.openPanel(null)}>
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
