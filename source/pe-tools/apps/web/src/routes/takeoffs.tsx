/**
 * /takeoffs — the Atlas workspace, canon.
 *
 * The route owns everything stateful: the target selector (same selector grammar as the chat
 * sentence — `?target=` resolves against the live session list on every render), the raw live
 * reads, the session overlay (partition runs, replay paths, pending Manual J edits), and every
 * host call. The Atlas renders the joined `World` and calls back through `AtlasActions`.
 *
 * `?source=fixture` mounts the project-a fixture adapter — an explicit dev choice, never a
 * fallback: a live read that fails shows its error, it does not quietly become a fixture.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { FactChip } from "#/components/lang/chip";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog";
import { callHostRpc } from "#/host/client";
import { mintSelector, sessionLabel, type SessionFacts } from "#/host/target";
import { useTarget } from "#/host/use-target";
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
} from "#/takeoff/host";
import {
  upsertResolution,
  type CandidateRegion,
  type LiveRegion,
  type ModelStatus,
  type Resolution,
  type ViewFacts,
} from "#/takeoff/model";
import { useFixtureWorld } from "#/takeoff/proto/fixture-world";
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
import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import type { RhvacExtractData, RhvacInsertRoomData } from "@pe/host-contracts/operation-types";

export const Route = createFileRoute("/takeoffs")({
  validateSearch: (search: Record<string, unknown>) => ({
    target: typeof search.target === "string" ? search.target : "",
    source: search.source === "fixture" ? ("fixture" as const) : ("live" as const),
  }),
  component: TakeoffsRoute,
});

interface LiveRaw {
  status: ModelStatus;
  views: ViewFacts[];
  zoneFrs: CandidateRegion[];
  regionsByZone: Record<string, LiveRegion[]>;
}

const EMPTY_WORLD: World = {
  docName: "",
  r10Path: null,
  lanes: [],
  zones: [],
  systems: [],
};

function TakeoffsRoute() {
  const { target, source } = Route.useSearch();
  const navigate = useNavigate({ from: "/takeoffs" });
  const setSearch = (patch: Partial<{ target: string; source: "live" | "fixture" }>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });

  const { resolution, sessions } = useTarget(target);
  const scope: HostSessionScope | null =
    resolution.kind === "resolved" ? { bridgeSessionId: resolution.session.sessionId } : null;

  const fixture = useFixtureWorld();

  const [raw, setRaw] = useState<LiveRaw | null>(null);
  const [overlay, setOverlay] = useState<SessionOverlay>(emptyOverlay);
  const { busy, seconds: busySeconds, error, setError, run } = useVerb();
  const [r10Path, setR10Path] = useState("");
  const [r10, setR10] = useState<RhvacExtractData | null>(null);
  const [panel, setPanel] = useState<"adopt" | "sync" | null>(null);

  const load = useCallback(async (s: HostSessionScope) => {
    setRaw(await readSnapshot(s));
  }, []);

  // First contact with a resolved session loads the world once; refresh is explicit after that.
  const loadedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (source !== "live" || !scope) return;
    if (loadedFor.current === scope.bridgeSessionId) return;
    loadedFor.current = scope.bridgeSessionId;
    void run("reading model", () => load(scope));
  }, [source, scope, run, load]);

  const world: World =
    source === "fixture"
      ? withEdits(fixture.world, overlay)
      : raw
        ? buildLiveWorld({ ...raw, overlay, r10Path: r10Path || null, r10 })
        : { ...EMPTY_WORLD, docName: scope ? "reading…" : "no target" };

  const refresh = useCallback(() => {
    if (scope) void run("reading model", () => load(scope));
  }, [scope, run, load]);

  const actions: AtlasActions = {
    patch: (guid, patch) => {
      const persistOverlay = () =>
        setOverlay((prev) => ({
          ...prev,
          edits: { ...prev.edits, [guid]: { ...prev.edits[guid], ...patch } },
        }));
      if (source === "live" && scope && patch.type) {
        const room = world.zones
          .flatMap((zone) => zone.rooms)
          .find((candidate) => candidate.guid === guid);
        if (room?.elementId !== null && room?.elementId !== undefined) {
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
      if (source !== "live" || !scope) return; // fixture: local only, and says so
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
        setRaw((prev) => (prev ? replaceRegionBlob(prev, room.elementId!, result.blob) : prev));
      });
    },

    openAdopt: () => setPanel("adopt"),
    openSync: () => setPanel("sync"),

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
        setRaw((prev) =>
          prev
            ? {
                ...prev,
                regionsByZone: { ...prev.regionsByZone, [zone.zone.guid]: result.regions },
              }
            : prev,
        );
        setOverlay((prev) => ({ ...prev, runs: { ...prev.runs, [zone.zone.guid]: result } }));
      });
    },

    launch: () => {
      if (!scope || !r10Path) return;
      void run("launching RHVAC", async () => {
        await callHostRpc("rhvac.launch", { path: r10Path }, scope);
      });
    },

    refresh,
  };

  return (
    <div className="relative h-screen">
      {source === "live" && resolution.kind !== "resolved" ? (
        <TargetGate
          sessions={sessions}
          reason={
            resolution.kind === "ambiguous"
              ? "more than one session — pin one"
              : resolution.reason === "no-sessions"
                ? "no Revit session connected"
                : `nothing matches "${target}"`
          }
          onPick={(s) => setSearch({ target: mintSelector(s, sessions) })}
          onFixture={() => setSearch({ source: "fixture" })}
        />
      ) : (
        <Atlas
          world={world}
          geoReady={source === "fixture" ? fixture.geoReady : raw !== null}
          live={source === "live"}
          busy={busy ? `${busy} · ${busySeconds}s queued/running` : null}
          actions={actions}
        />
      )}

      {/* A failed host call is an ERROR, not a seam — the old rendering wore the reserved dashed
          seam chip, which claimed "this is a stand-in" about a real bridge failure. `error` is
          caution, deliberately not the alarm: a busy bridge is not the model disagreeing. */}
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

      {source === "fixture" && (
        <div className="absolute right-2 bottom-2 z-40 flex items-center gap-1.5">
          <FactChip
            dashed
            title="The fixture lane is an explicit URL choice (?source=fixture), never a fallback: a live read that fails shows its error rather than quietly becoming a fixture."
          >
            fixture lane
          </FactChip>
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
          zones={world.zones}
          views={raw?.views ?? []}
          run={run}
          busy={busy}
          onClose={() => setPanel(null)}
          onDone={() => {
            setPanel(null);
            refresh();
          }}
        />
      )}
      {panel === "sync" && scope && raw && (
        <SyncPanel
          scope={scope}
          world={world}
          r10Path={r10Path}
          setR10Path={setR10Path}
          setR10={setR10}
          run={run}
          busy={busy}
          onClose={() => setPanel(null)}
          onDone={() => {
            setPanel(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function replaceRegionBlob(raw: LiveRaw, elementId: number, blob: string): LiveRaw {
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
      {
        assembly: ROOF_ASSEMBLY,
        uValue: 0.024,
        areaSquareFeet: room.sqft,
        areaMultiplier: 1.2,
      },
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

// ── Target gate — the sentence's doc slot, atlas-sized ──────────────────────

function TargetGate({
  sessions,
  reason,
  onPick,
  onFixture,
}: {
  sessions: SessionFacts[];
  reason: string;
  onPick: (s: SessionFacts) => void;
  onFixture: () => void;
}) {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-3 bg-background">
      <h1 className="font-pe-display text-lg font-semibold tracking-tight">Takeoffs</h1>
      <p className="tele text-muted-foreground">{reason}</p>
      <div className="w-96 rounded-[var(--radius)] border border-border">
        {sessions.map((s) => (
          <button
            key={s.sessionId}
            type="button"
            onClick={() => onPick(s)}
            className="flex w-full items-baseline gap-2 border-b border-[var(--r-line)] px-2.5 py-1.5 text-left last:border-b-0 hover:bg-muted"
          >
            <span className="text-xs">{sessionLabel(s)}</span>
            <span className="tele ml-auto text-muted-foreground">
              {s.lane} · pid {s.processId}
            </span>
          </button>
        ))}
        {/* A picker with no options says where options come from (SURFACE-PHILOSOPHY §4). */}
        {sessions.length === 0 && (
          <div className="px-2.5 py-3">
            <p className="tele-label text-muted-foreground">no sessions</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              this list is the live connected-host catalog. Start Revit with the Pe add-in loaded
              and a session appears here — or take the fixture lane below.
            </p>
          </div>
        )}
      </div>
      <Verb
        label="open the project-a fixture instead"
        onClick={onFixture}
        reason="Mounts the project-a fixture adapter — an explicit dev choice, never a fallback. Nothing in it can be written."
      />
    </main>
  );
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
  zones,
  views,
  run,
  busy,
  onClose,
  onDone,
}: {
  scope: HostSessionScope;
  zones: WorldZone[];
  views: ViewFacts[];
  run: (label: string, work: () => Promise<void>) => Promise<void>;
  busy: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [view, setView] = useState<string | null>(null);
  const [rows, setRows] = useState<AdoptRow[] | null>(null);

  const pickView = (name: string) => {
    setView(name);
    void run("reading regions", async () => {
      const regions = await readCandidates(scope, name);
      setRows(
        regions.map((region) => {
          const meta = readZoneMeta(region.blob);
          const stamped = region.role === "zoning-region";
          return {
            region,
            checked: stamped,
            name: meta.name || region.typeName,
            systemTag: meta.systemTag,
          };
        }),
      );
    });
  };

  const patchRow = (elementId: number, patch: Partial<AdoptRow>) =>
    setRows((prev) =>
      prev ? prev.map((r) => (r.region.elementId === elementId ? { ...r, ...patch } : r)) : prev,
    );

  const picked = rows?.filter((r) => r.checked) ?? [];

  const adopt = () => {
    if (!view || picked.length === 0) return;
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
    });
  };

  return (
    <Panel title="adopt zoning regions" onClose={onClose}>
      <p className="tele text-muted-foreground">
        pick the zoning-plan view, then the designer-drawn regions that are zones. adoption stamps
        them in place (role, guid, name, system tag) — re-adopt to edit. legends are ignored.
      </p>
      {!view ? (
        <div className="mt-2 max-h-96 overflow-y-auto rounded-[var(--radius)] border border-border">
          {views.map((v) => (
            <button
              key={v.name}
              type="button"
              onClick={() => pickView(v.name)}
              className="flex w-full items-baseline gap-2 border-b border-[var(--r-line)] px-2 py-1 text-left last:border-b-0 hover:bg-muted"
            >
              <span className="text-xs">{v.name}</span>
              <span className="tele ml-auto shrink-0 text-muted-foreground">
                {v.level || "no level"} · {v.regions} FR
              </span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <p className="mt-2 flex items-center gap-2">
            <Verb
              tone="nav"
              direction="back"
              label="views"
              onClick={() => (setView(null), setRows(null))}
              reason="Back to the view list — nothing picked here has been stamped yet"
            />
            <span className="tele text-muted-foreground">{view}</span>
          </p>
          <div className="mt-1 max-h-96 overflow-y-auto rounded-[var(--radius)] border border-border">
            {(rows ?? []).map((r) => (
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
                  className="tele w-24 shrink-0 truncate text-muted-foreground"
                  title={r.region.typeName}
                >
                  {r.region.typeName}
                </span>
                <span className="tele w-16 shrink-0 text-right tabular-nums text-muted-foreground">
                  {fmtNum(r.region.sqft, 0)} sf
                </span>
                <input
                  value={r.name}
                  placeholder="zone name"
                  onChange={(e) => patchRow(r.region.elementId, { name: e.target.value })}
                  className="tele h-6 min-w-0 flex-1 rounded-[var(--radius)] border border-border bg-transparent px-1.5 outline-none focus:border-ring"
                />
                <input
                  value={r.systemTag}
                  placeholder="system tag"
                  onChange={(e) => patchRow(r.region.elementId, { systemTag: e.target.value })}
                  className="tele h-6 w-24 shrink-0 rounded-[var(--radius)] border border-border bg-transparent px-1.5 outline-none focus:border-ring"
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
            {rows === null && (
              <p className="px-2 py-3">
                <OutcomeLine kind="busy" label="reading regions" says={view} />
              </p>
            )}
            {rows !== null && rows.length === 0 && (
              <div className="px-2 py-3">
                <p className="tele-label text-muted-foreground">no filled regions</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  this view carries no designer-drawn filled regions to adopt. Draw the zones in
                  Revit first, or pick another view.
                </p>
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            {/* Stamping runs a WriteTransaction against the live document — the one filled blue. */}
            <Verb
              tone="commit"
              label={`stamp ${picked.length} as zoning regions`}
              disabled={busy !== null || picked.length === 0}
              reason={
                busy !== null
                  ? `${busy} is in flight — the host runs one transaction at a time`
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
        </>
      )}
    </Panel>
  );
}

// ── Sync panel — insert reviewed rooms into a template .r10 copy ────────────

function SyncPanel({
  scope,
  world,
  r10Path,
  setR10Path,
  setR10,
  run,
  busy,
  onClose,
  onDone,
}: {
  scope: HostSessionScope;
  world: World;
  r10Path: string;
  setR10Path: (p: string) => void;
  setR10: (extract: RhvacExtractData) => void;
  run: (label: string, work: () => Promise<void>) => Promise<void>;
  busy: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  interface InsertRow {
    zone: WorldZone;
    room: WorldRoom;
  }
  const blockedZones = world.zones.filter(
    (zone) =>
      zone.driftSqft > 0 ||
      zone.rooms.some((room) => room.flags.length > 0) ||
      zone.runs.some((item) => item.orphaned > 0 || item.failures > 0),
  );
  const blockedZoneIds = new Set(blockedZones.map((zone) => zone.zone.guid));
  const inserts: InsertRow[] = world.zones.flatMap((zone) =>
    blockedZoneIds.has(zone.zone.guid)
      ? []
      : zone.rooms
          .filter((room) => room.elementId !== null && room.r10 === null && room.data !== null)
          .map((room) => ({ zone, room })),
  );
  const untagged = inserts.filter(({ zone }) => zone.tags.length === 0);
  const tags = [...new Set(inserts.flatMap(({ zone }) => zone.tags))];
  const [report, setReport] = useState<string | null>(null);

  const sync = () => {
    if (!r10Path || inserts.length === 0 || untagged.length > 0) return;
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
          systems: tags.map((tag) => ({
            number: systemNumbers.get(tag)!,
            name: tag,
          })),
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
      const after = await callHostRpc("rhvac.open", { path: r10Path }, scope);
      setR10(after);
      setReport(
        `synced ${result.insertedRooms.length}/${inserts.length} rooms into ${r10Path}` +
          ` (${result.roomsBefore}→${result.roomsAfter} rooms, seed room ${result.seedRoom.action})` +
          (result.backupPath ? ` · backup: ${result.backupPath}` : "") +
          (result.assemblyFallbacks.length > 0
            ? ` · ${result.assemblyFallbacks.length} assembly fallbacks`
            : ""),
      );
      onDone();
    });
  };

  const loadR10 = () => {
    if (!r10Path) return;
    void run("reading .r10", async () => {
      const opened = await callHostRpc("rhvac.open", { path: r10Path }, scope);
      setR10(opened);
      setReport(
        `opened ${opened.sourceFile}: ${opened.rooms.length} rooms, ${opened.systems.length} systems`,
      );
    });
  };

  return (
    <Panel title="sync to .r10" onClose={onClose}>
      <p className="tele text-muted-foreground">
        inserts reviewed rooms (with Manual J data) into the target file — always work on a COPY of
        the project template, never the original. systems are seeded by number + name only;
        everything else is filled in RHVAC.
      </p>
      <label className="tele mt-2 block text-muted-foreground">
        target .r10 (host-visible path)
        <input
          value={r10Path}
          onChange={(e) => setR10Path(e.target.value)}
          placeholder="C:\\...\\ManJ_Architect_Manuella_2026.08.14.r10"
          className="tele mt-0.5 block h-6 w-full rounded-[var(--radius)] border border-border bg-transparent px-1.5 outline-none focus:border-ring"
        />
      </label>

      <p className="section-label mt-2">systems to seed ({tags.length})</p>
      {tags.map((tag) => (
        <p key={tag} className="tele py-0.5">
          {tag}
        </p>
      ))}

      <p className="section-label mt-2">rooms to insert ({inserts.length})</p>
      <div className="max-h-48 overflow-y-auto">
        {inserts.map(({ zone, room }, i) => (
          <p key={room.guid} className="tele flex gap-2 py-px">
            <span className="w-8 shrink-0 text-right text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{room.name}</span>
            <span className="shrink-0 text-muted-foreground">
              {zone.zone.key} · {zone.tags[0] ?? "NO TAG"} · {fmtNum(room.sqft, 0)} sf
            </span>
          </p>
        ))}
        {/* "Nothing eligible" is the route's own story, and it names the three gates. */}
        {inserts.length === 0 && (
          <div className="py-2">
            <p className="tele-label text-muted-foreground">nothing eligible</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              a room syncs once it has a Room Region home, Manual J data entered, and no existing
              .r10 link.
            </p>
          </div>
        )}
      </div>

      {/* Refusals, per option, drawn from the real gate that produced them — not a seam. These
          are advisories: they explain what the sync verb below is already refusing. */}
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
      {report && <OutcomeLine className="mt-1" kind="receipt" label={report} />}

      <div className="mt-2 flex items-center gap-2">
        <Verb
          label="load .r10"
          disabled={busy !== null || !r10Path}
          reason={
            busy !== null
              ? `${busy} is in flight — the host runs one transaction at a time`
              : !r10Path
                ? "type a host-visible path to the target .r10 above"
                : "Opens the .r10 read-only and joins its rooms and systems onto this world"
          }
          onClick={loadR10}
        />
        <Verb
          tone="commit"
          label={`sync ${inserts.length} rooms`}
          disabled={busy !== null || !r10Path || inserts.length === 0 || untagged.length > 0}
          reason={
            busy !== null
              ? `${busy} is in flight — the host runs one transaction at a time`
              : !r10Path
                ? "type a host-visible path to the target .r10 above"
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

/**
 * Both panels are modals, so they are the shared `ui/dialog` — not a hand-rolled overlay. The
 * previous implementation was a click-out `div` with no focus trap, no `role="dialog"`, no Esc,
 * and a fake "esc ×" label for a key it never listened for: a control that lies about what it
 * responds to. `Dialog` supplies all three for real, and its own close button.
 */
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
