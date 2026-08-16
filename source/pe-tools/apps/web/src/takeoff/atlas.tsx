/** Atlas — the /takeoffs workspace: plan-dominant three-pane. */
//
// The PLAN is the scope master, the TABLE always answers "everything currently in scope". No zone
// selected = the whole house is in the table; selecting a zone on the plan narrows it. The table
// is never hidden and never collapses into a per-zone detail pane — that is the structural law.
//
// Progress is DERIVED from room facts and rendered with ONE vocabulary on all three surfaces:
// the rail's per-zone segment bar, the plan's room fills, and the table's state column all read
// the same four room states. The zone stage survives only as a filterable text column.
//
// The atlas renders a `World` and calls back through `AtlasActions` — it owns selection and
// optimistic decision state, nothing else. The route owns the world, the overlay, and every
// host call.
import { useEffect, useMemo, useRef, useState } from "react";

import {
  CellSelect,
  NumberCell,
  ReadCell,
  StateDot,
  stateColumn,
  TextCell,
  type StateMeta,
} from "#/components/master-table/cells";
import { MasterTable } from "#/components/master-table/master-table";
import { fmtNum, type Column } from "#/components/master-table/model";
import { Button } from "#/components/ui/button";
import { Live, Seam } from "#/takeoff/seam";
import { ZoneThumb } from "#/takeoff/zone-plan";
import { boundsOf, FLAG_MEANING, mergeBounds, pathD, type Bounds } from "#/takeoff/model";
import {
  SENSIBLE_CAP_BTUH,
  STAGE_ORDER,
  type RoomData,
  type RoomEdit,
  type RoomType,
  type Stage,
  type World,
  type WorldLane,
  type WorldRoom,
  type WorldSystem,
  type WorldZone,
} from "#/takeoff/world";
import { cn } from "#/lib/utils";

export type Verdict = "accept" | "dismiss";

export interface AtlasActions {
  /** Stage a Manual J / naming edit (session overlay; the .r10 takes it at sync). */
  patch: (guid: string, patch: RoomEdit) => void;
  /** Write-through: persist onto the Room Region blob (live) or accept locally (fixture). */
  decide: (room: WorldRoom, flag: string, verb: Verdict) => void;
  openAdopt: () => void;
  openSync: () => void;
  capture: (lane: WorldLane) => void;
  partition: (zone: WorldZone) => void;
  launch: () => void;
  refresh: () => void;
}

export interface AtlasProps {
  world: World;
  /** Real room boundaries loaded (fixture fetch / live regions read finished). */
  geoReady: boolean;
  /** True when talking to a targeted Revit document; false on the explicit fixture adapter. */
  live: boolean;
  /** Label of the operation in flight, or null. One at a time — the host owns one transaction. */
  busy: string | null;
  actions: AtlasActions;
}

// ── Room state — the one progress vocabulary ────────────────────────────────
//
// Derived from the room's own facts, never from its zone's stage label. Four states, one hue
// budget: clay is the only alarm, green the only "done", everything between is quiet.

type RoomState = "call" | "unreviewed" | "data" | "synced";

const ROOM_STATES: RoomState[] = ["call", "unreviewed", "data", "synced"];

const STATE_META: Record<RoomState, { tone: string; label: string; note: string }> = {
  call: {
    tone: "var(--cat-clay)",
    label: "needs a call",
    note: "a human must decide: an open detector flag, or the .r10 no longer matches the model",
  },
  unreviewed: {
    tone: "var(--muted-foreground)",
    label: "no Manual J",
    note: "nothing open, but no Manual J data entered yet — export would refuse this room",
  },
  data: {
    tone: "var(--cat-slate)",
    label: "data entered",
    note: "Manual J data entered against settled geometry, not yet exported",
  },
  synced: {
    tone: "var(--cat-green)",
    label: "in .r10",
    note: "exported and the .r10 still agrees with the model",
  },
};

/** The state as the shared grid speaks it: clay is the only alarm, "no Manual J" the only dim. */
const stateMeta = (state: RoomState): StateMeta => ({
  ...STATE_META[state],
  alarm: state === "call",
  dim: state === "unreviewed",
});

/** The derivation. `open` is the count of undecided detector flags on this room. */
function roomState(room: WorldRoom, open: number): RoomState {
  if (open > 0) return "call";
  if (room.r10 && room.r10.lastSyncedSqft !== room.sqft) return "call"; // drift is a call
  if (room.r10) return "synced";
  if (room.data) return "data";
  return "unreviewed";
}

const STAGE_BLURB: Record<Stage, string> = {
  declared: "adopted, no system tag typed",
  registered: "tag resolved against the registry",
  partitioned: "rooms materialized, decisions open",
  reviewed: "decision queue empty",
  data: "Manual J data entered, not exported",
  synced: ".r10 in sync",
  drifted: "hand-edit drift since last sync",
};

/**
 * Per-zone progress, derived: one equal segment per room, coloured by that room's own state. A
 * zone with no rooms gets a dashed empty bar — "not partitioned" is a real state, not a zero.
 * This replaces the seven-tick zone-stage pip, which said nothing about whether work was needed.
 */
function ZoneStateBar({
  zone,
  states,
  className,
}: {
  zone: WorldZone;
  states: RoomState[];
  className?: string;
}) {
  if (states.length === 0)
    return (
      <span
        className={cn(
          "inline-block h-2.5 w-10 shrink-0 rounded-[1px] border border-dashed border-[var(--line-2)]",
          className,
        )}
        title={`${zone.zone.key} — not partitioned: no rooms have been materialized yet`}
      />
    );
  const census = ROOM_STATES.map((s) => ({ s, n: states.filter((x) => x === s).length })).filter(
    (x) => x.n > 0,
  );
  return (
    <span
      className={cn("flex h-2.5 w-10 shrink-0 items-stretch gap-px", className)}
      title={`${zone.zone.key} — ${states.length} rooms · ${census
        .map((c) => `${c.n} ${STATE_META[c.s].label}`)
        .join(", ")}`}
    >
      {states.map((s, i) => (
        <span
          key={i}
          className="min-w-px flex-1 rounded-[1px]"
          style={{
            background: STATE_META[s].tone,
            opacity: s === "unreviewed" ? 0.3 : 0.9,
          }}
        />
      ))}
    </span>
  );
}

function Swatch({ tone, label, dashed }: { tone: string; label: string; dashed?: boolean }) {
  return (
    <span className="tele inline-flex items-center gap-1 text-muted-foreground">
      <span
        className={cn("inline-block size-2.5 rounded-[1px] border", dashed && "border-dashed")}
        style={{ background: `color-mix(in srgb, ${tone} 16%, transparent)`, borderColor: tone }}
      />
      {label}
    </span>
  );
}

// ── Local decision state (optimistic; the write-through is the authority) ───

const ROOM_TYPES: RoomType[] = [
  "great room",
  "kitchen",
  "dining",
  "primary bedroom",
  "bedroom",
  "full bath",
  "powder",
  "office",
  "laundry",
  "exercise",
  "hall",
  "mechanical",
];

/** The Manual J number columns: one whole-unit field each, all editable, all faded until entered. */
const MANUAL_J: { field: keyof RoomData; label: string; width: string }[] = [
  { field: "people", label: "ppl", width: "w-12" },
  { field: "lightingW", label: "ltg W", width: "w-16" },
  { field: "equipSensible", label: "eq S", width: "w-16" },
  { field: "equipLatent", label: "eq L", width: "w-16" },
  { field: "ventilationCfm", label: "vent", width: "w-16" },
];

const flagKey = (guid: string, flag: string) => `${guid}::${flag}`;

const shortId = (guid: string) => guid.slice(guid.lastIndexOf("-") + 1);

/**
 * Zones smaller than this are stray scribbles in the fixture (Lower#01 at 42 sf sits ~100 ft from
 * the real cluster). Drawing them blew the plan's viewBox out and rendered the actual house as
 * specks. They are excluded from the plan and from its bounds fit — but never deleted from the
 * rail, where they stay visible and marked, because silently dropping declared geometry is worse
 * than an ugly plan.
 */
const PLAN_MIN_SQFT = 60;
const onPlan = (z: WorldZone) => z.zone.declaredSqft >= PLAN_MIN_SQFT;

// ── Row model ───────────────────────────────────────────────────────────────

interface Row {
  zone: WorldZone;
  room: WorldRoom;
  state: RoomState;
  open: string[];
}

// ── Variant ─────────────────────────────────────────────────────────────────

const PLAN_MIN_PX = 140;
const PLAN_MAX_PX = 720;
const PLAN_DEFAULT_PX = 340;

export function Atlas({ world, geoReady, live, busy, actions }: AtlasProps) {
  const [stageFilter, setStageFilter] = useState<Stage | null>(null);
  const [level, setLevel] = useState<string>("");
  const [zoneKey, setZoneKey] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, Verdict>>({});
  /** The row order the user is actually looking at — MasterTable owns filter/sort/search, and
   *  reports the result here so j/k walks the SAME order rather than the pre-filter scope. */
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);

  // First lane to arrive names the initial level tab (lanes are live data, not a constant).
  useEffect(() => {
    if (!level && world.lanes.length > 0) setLevel(world.lanes[0]!.label);
  }, [level, world.lanes]);

  // Plan geometry: collapsible + draggable, remembered for the session.
  const [planOpen, setPlanOpen] = useState(true);
  const [planH, setPlanH] = useState(PLAN_DEFAULT_PX);
  const [statsOpen, setStatsOpen] = useState(false);
  const drag = useRef<{ y: number; h: number } | null>(null);

  // Edits live in the route's session overlay (they must survive into the sync payload); the
  // world arrives with them already applied. The atlas only forwards patches.
  const openFlags = (room: WorldRoom) => room.flags.filter((f) => !decided[flagKey(room.guid, f)]);

  const stateOf = (room: WorldRoom) => roomState(room, openFlags(room).length);
  const zoneStates = (z: WorldZone) => z.rooms.map((r) => stateOf(r));
  const zoneCalls = (z: WorldZone) => zoneStates(z).filter((s) => s === "call").length;

  // ── Scope derivation ──────────────────────────────────────────────────────
  // Rail pipeline filter narrows the world; the plan selects within it; the table shows the result.

  const filteredZones = useMemo(
    () => world.zones.filter((z) => stageFilter === null || z.stage === stageFilter),
    [world, stageFilter],
  );

  const selected = zoneKey ? (world.zones.find((z) => z.zone.key === zoneKey) ?? null) : null;
  const levelZones = world.zones.filter((z) => z.zone.lane.label === level);

  // Scope only — plan selection and the rail's pipeline filter. Every other narrowing (stage,
  // state, type, flags, free text) is the table's own, and shows as a chip in its strip.
  const scopeZones = useMemo(
    () => (selected ? [selected] : filteredZones),
    [selected, filteredZones],
  );
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const zone of scopeZones) {
      for (const room of zone.rooms) {
        const open = openFlags(room);
        out.push({ zone, room, state: roomState(room, open.length), open });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeZones, decided]);

  // What the table is actually showing, in its order.
  const visibleRows = useMemo(() => {
    const byGuid = new Map(rows.map((r) => [r.room.guid, r]));
    return visibleKeys.map((key) => byGuid.get(key)).filter((r): r is Row => r !== undefined);
  }, [rows, visibleKeys]);

  const cursorRow = rows.find((r) => r.room.guid === cursor) ?? null;

  const flagVocabulary = useMemo(() => {
    const set = new Set<string>();
    for (const z of world.zones) for (const r of z.rooms) for (const f of r.flags) set.add(f);
    return [...set].sort();
  }, [world]);

  // ── Keyboard: j/k cursor, a/d verbs, Esc clears scope (←/→ belong to the switcher) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "Escape") {
        setZoneKey(null);
        setCursor(null);
        return;
      }
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        if (visibleRows.length === 0) return;
        const i = visibleRows.findIndex((r) => r.room.guid === cursor);
        const next = e.key === "j" ? Math.min(visibleRows.length - 1, i + 1) : Math.max(0, i - 1);
        setCursor(visibleRows[i === -1 ? 0 : next]!.room.guid);
        return;
      }
      if ((e.key === "a" || e.key === "d") && cursorRow) {
        if (cursorRow.open.length === 0) return;
        e.preventDefault();
        decide(cursorRow.room, cursorRow.open[0]!, e.key === "a" ? "accept" : "dismiss");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Optimistic: mark locally, then write through. The route re-reads on demand; a failed
  // write surfaces through the route's error lane, never as a silently-kept decision.
  const decide = (room: WorldRoom, flag: string, verb: Verdict) => {
    setDecided((prev) => ({ ...prev, [flagKey(room.guid, flag)]: verb }));
    actions.decide(room, flag, verb);
  };

  const selectZone = (z: WorldZone | null) => {
    setZoneKey(z ? z.zone.key : null);
    setCursor(null);
    if (z) setLevel(z.zone.lane.label);
  };

  // ── The table's columns. One descriptor per column; MasterTable owns filter/sort/search. ──
  const columns = useMemo<Column<Row>[]>(
    () => [
      {
        key: "stage",
        label: "stage",
        title: "the ZONE's pipeline label — not a claim about this room",
        width: "w-28",
        sort: (row) => STAGE_ORDER.indexOf(row.zone.stage),
        facet: (row) => row.zone.stage,
        options: STAGE_ORDER.map((s) => ({ value: s, label: s })),
        cell: (row) => (
          <ReadCell
            value={`${STAGE_ORDER.indexOf(row.zone.stage) + 1} ${row.zone.stage}`}
            reason={`zone ${row.zone.zone.key} is at "${row.zone.stage}" — ${STAGE_BLURB[row.zone.stage]}. This is a ZONE label; the room's own state is the next column.`}
            className="text-muted-foreground"
          />
        ),
      },
      {
        ...stateColumn<Row>({
          label: "state",
          title:
            "this ROOM's derived state — the same vocabulary the rail bars and the plan fills use",
          of: (row) => stateMeta(row.state),
        }),
        // Pipeline order, not alphabetical: "needs a call" sorts before "in .r10" because that
        // is the order the work happens in.
        sort: (row) => ROOM_STATES.indexOf(row.state),
        options: ROOM_STATES.map((s) => ({
          value: STATE_META[s].label,
          label: STATE_META[s].label,
        })),
      },
      {
        key: "zone",
        label: "zone",
        width: "w-24",
        sort: (row) => row.zone.zone.key,
        search: (row) => row.zone.zone.key,
        cell: (row) => (
          <span className="tele block truncate px-1.5">
            <span
              className="mr-1 inline-block size-2 rounded-[1px] align-middle"
              style={{ background: `rgb(${row.zone.zone.color})` }}
            />
            {row.zone.zone.key}
          </span>
        ),
      },
      {
        key: "name",
        label: "name",
        width: "min-w-40",
        sort: (row) => row.room.name,
        search: (row) => row.room.name,
        cell: (row) => (
          <TextCell
            value={row.room.name}
            onCommit={(v) => actions.patch(row.room.guid, { name: v })}
            className="text-left"
          />
        ),
      },
      {
        key: "type",
        label: "type",
        width: "w-32",
        sort: (row) => row.room.type,
        search: (row) => row.room.type,
        facet: (row) => row.room.type,
        options: ROOM_TYPES.map((t) => ({ value: t, label: t })),
        cell: (row) => (
          <CellSelect
            value={row.room.type}
            onChange={(v) => actions.patch(row.room.guid, { type: v as RoomType })}
          >
            {ROOM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </CellSelect>
        ),
      },
      {
        key: "sqft",
        label: "sf",
        title: "detected area — geometry is edited in Revit",
        right: true,
        width: "w-16",
        sort: (row) => row.room.sqft,
        cell: (row) => (
          <ReadCell
            value={row.room.sqft}
            reason={`detected area — source ${row.room.provenance.sourceSqft} sf, run ${row.room.provenance.runId}. Geometry is edited in Revit, never here.`}
          />
        ),
      },
      {
        key: "ceil",
        label: "ceil",
        right: true,
        width: "w-14",
        sort: (row) => row.room.ceilingFt,
        cell: (row) => (
          <NumberCell
            value={row.room.ceilingFt}
            digits={1}
            min={0}
            onCommit={(v) => actions.patch(row.room.guid, { ceilingFt: v })}
          />
        ),
      },
      // The Manual J block: same shape, same law — faded until the room has data, and any
      // number entered CREATES that data (the room's state moves to "data entered").
      ...MANUAL_J.map(
        (mj): Column<Row> => ({
          key: mj.field,
          label: mj.label,
          right: true,
          width: mj.width,
          sort: (row) => row.room.data?.[mj.field] ?? 0,
          cell: (row) => (
            <NumberCell
              value={row.room.data?.[mj.field] ?? 0}
              digits={0}
              integer
              min={0}
              className={row.room.data === null ? "opacity-50" : undefined}
              onCommit={(v) => actions.patch(row.room.guid, { [mj.field]: v })}
            />
          ),
        }),
      ),
      {
        key: "flags",
        label: "flags",
        width: "w-24",
        title: "undecided detector calls on this room — a/d accept or dismiss the first one",
        sort: (row) => row.open.length,
        // Multi-valued: a room carries a SET of flags, so the vocabulary is "any open" /
        // "none open" / one named flag rather than a single cell value.
        match: (row, value) =>
          value === "any"
            ? row.open.length > 0
            : value === "none"
              ? row.open.length === 0
              : row.open.includes(value),
        options: [
          { value: "any", label: "any open" },
          { value: "none", label: "none open" },
          ...flagVocabulary.map((f) => ({ value: f, label: f })),
        ],
        cell: (row) =>
          row.open.length > 0 ? (
            <span className="tele block truncate px-1.5 text-cat-clay" title={row.open.join(", ")}>
              {row.open.length} open
            </span>
          ) : row.room.decisions.length > 0 ? (
            <span className="tele block truncate px-1.5 text-muted-foreground">
              {row.room.decisions.length} decided
            </span>
          ) : null,
      },
      {
        key: "r10",
        label: ".r10",
        width: "w-28",
        title: "this room's line in the .r10 — or the drift that must be reconciled before re-sync",
        sort: (row) => row.room.r10?.identifier ?? "",
        cell: (row) => {
          const r10 = row.room.r10;
          if (!r10) return <span className="tele block px-1.5 text-muted-foreground/50">—</span>;
          const drift = row.room.sqft - r10.lastSyncedSqft;
          return drift !== 0 ? (
            <span className="tele block truncate px-1.5 text-cat-clay">
              drift {drift > 0 ? "+" : ""}
              {drift} sf
            </span>
          ) : (
            <span className="tele block truncate px-1.5 text-cat-green">#{r10.identifier}</span>
          );
        },
      },
    ],
    [actions, flagVocabulary],
  );

  // Chips the ROUTE owns. The table's own column filters chip themselves.
  const chips = useMemo(() => {
    const list: { label: string; onClear: () => void }[] = [];
    if (selected)
      list.push({ label: `plan scope: ${selected.zone.key}`, onClear: () => selectZone(null) });
    if (stageFilter)
      list.push({ label: `rail: ${stageFilter}`, onClear: () => setStageFilter(null) });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, stageFilter]);

  // ── Plan resize: pointer events only, no library. Below the min cap the plan hides. ──
  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: planOpen ? planH : PLAN_MIN_PX };
  };
  const onHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const next = d.h + (e.clientY - d.y);
    if (next < PLAN_MIN_PX - 28) {
      setPlanOpen(false);
      return;
    }
    setPlanOpen(true);
    setPlanH(Math.min(PLAN_MAX_PX, Math.max(PLAN_MIN_PX, next)));
  };
  const onHandleUp = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // ── Census ────────────────────────────────────────────────────────────────
  const stageCounts = STAGE_ORDER.map((s) => ({
    stage: s,
    n: world.zones.filter((z) => z.stage === s).length,
  }));
  const scopeCalls = visibleRows.filter((r) => r.state === "call").length;
  const scopeSqft = visibleRows.reduce((s, r) => s + r.room.sqft, 0);

  const proposedUrl =
    `/takeoffs?level=${level}` +
    (selected ? `&zone=${encodeURIComponent(selected.zone.key)}` : "") +
    (cursorRow ? `&room=${shortId(cursorRow.room.guid)}` : "");

  const peekZone = cursorRow?.zone ?? selected ?? null;

  return (
    <main className="flex h-screen min-h-0 flex-col bg-background">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5">
        <h1 className="font-pe-display text-lg font-semibold tracking-tight">Takeoffs</h1>
        <span className="tele text-muted-foreground">
          the plan is the index; the table is the truth
        </span>
        {live ? (
          <Live>{world.docName}</Live>
        ) : (
          <Seam>fixture world — project-a replay, no document attached</Seam>
        )}
        {world.r10Path && <span className="tele text-muted-foreground">{world.r10Path}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {busy ? (
            <span className="tele text-cat-clay">{busy}…</span>
          ) : (
            !geoReady && <span className="tele text-cat-clay">loading room geometry…</span>
          )}
          <Button
            size="xs"
            variant="outline"
            disabled={!live || busy !== null}
            onClick={actions.openAdopt}
          >
            adopt zones
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={!live || busy !== null}
            onClick={actions.openSync}
          >
            sync .r10
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={!live || !world.r10Path}
            onClick={actions.launch}
          >
            open in RHVAC
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={!live || busy !== null}
            onClick={actions.refresh}
          >
            refresh
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── LEFT: pipeline filter + zone list, progress derived from rooms ── */}
        <aside className="flex w-72 min-w-72 shrink-0 flex-col border-r border-border bg-background">
          <div className="shrink-0 border-b border-border px-2 py-1.5">
            <div className="tele-label mb-1 text-muted-foreground">room states — one per room</div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {ROOM_STATES.map((s) => (
                <span
                  key={s}
                  title={STATE_META[s].note}
                  className="tele inline-flex items-center gap-1 text-muted-foreground"
                >
                  <StateDot {...stateMeta(s)} />
                  {STATE_META[s].label}
                </span>
              ))}
            </div>
          </div>

          <div className="shrink-0 border-b border-border px-2 py-2">
            <div className="tele-label mb-1 text-muted-foreground">
              zone pipeline — global filter
            </div>
            <div className="flex flex-col">
              {stageCounts.map(({ stage, n }, i) => {
                const on = stageFilter === stage;
                return (
                  <button
                    key={stage}
                    type="button"
                    title={STAGE_BLURB[stage]}
                    onClick={() => {
                      setStageFilter(on ? null : stage);
                      setZoneKey(null);
                      setCursor(null);
                    }}
                    className={cn(
                      "flex items-baseline gap-1.5 rounded-[var(--radius)] px-1 py-0.5 text-left hover:bg-muted",
                      on && "bg-primary/[0.08]",
                    )}
                  >
                    <span className="tele w-3 shrink-0 text-muted-foreground">{i + 1}</span>
                    <span className={cn("tele flex-1 truncate", !on && "text-muted-foreground")}>
                      {stage}
                    </span>
                    <span className="tele tabular-nums text-muted-foreground">{n}</span>
                  </button>
                );
              })}
            </div>
            {stageFilter && (
              <button
                type="button"
                className="tele-label mt-1 text-muted-foreground hover:text-foreground"
                onClick={() => setStageFilter(null)}
              >
                clear filter — show all {world.zones.length}
              </button>
            )}
          </div>

          {/* Zone list, grouped by level only so the list stays consistent — level is never the
              organizer, the room states are. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {world.lanes.map((lane) => {
              const zs = filteredZones.filter((z) => z.zone.lane.label === lane.label);
              if (zs.length === 0) return null;
              return (
                <div key={lane.label}>
                  <div className="tele-label sticky top-0 z-10 border-y border-[var(--line-soft)] bg-muted px-2 py-0.5 text-muted-foreground">
                    {lane.label} · {zs.length}
                  </div>
                  <ul>
                    {zs.map((z) => {
                      const states = zoneStates(z);
                      const calls = states.filter((s) => s === "call").length;
                      const on = z.zone.key === zoneKey;
                      const off = !onPlan(z);
                      return (
                        <li key={z.zone.key}>
                          <button
                            type="button"
                            onClick={() => selectZone(on ? null : z)}
                            title={
                              off
                                ? `off-plan scribble — ${fmtNum(z.zone.declaredSqft, 0)} sf, drawn far from the level cluster; kept in the list, excluded from the plan`
                                : `${z.name} · ${z.zone.lane.label} · ${fmtNum(z.zone.declaredSqft, 0)} sf declared`
                            }
                            className={cn(
                              "flex w-full items-center gap-1.5 border-b border-[var(--line-soft)] px-2 py-1 text-left hover:bg-muted",
                              on && "bg-primary/[0.08]",
                              off && "opacity-55",
                            )}
                          >
                            {/* Real zone outline, not a colour square — shape is identity. */}
                            <ZoneThumb zone={z.zone} className="size-5" />
                            <span className="tele shrink-0">{z.zone.key}</span>
                            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                              {off ? "off-plan scribble" : z.name}
                            </span>
                            {calls > 0 && (
                              <span
                                className="tele shrink-0 rounded-[var(--radius)] bg-cat-clay/15 px-1 text-cat-clay"
                                title={`${calls} room${calls === 1 ? "" : "s"} in this zone need a human call — an open detector flag or .r10 drift`}
                              >
                                {calls} call{calls === 1 ? "" : "s"}
                              </span>
                            )}
                            <ZoneStateBar zone={z} states={states} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── MIDDLE: the plan (collapsible) + the master table (never hidden) ── */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1">
            {world.lanes.map((lane) => {
              const zs = world.zones.filter((z) => z.zone.lane.label === lane.label);
              const calls = zs.reduce((n, z) => n + zoneCalls(z), 0);
              return (
                <button
                  key={lane.label}
                  type="button"
                  onClick={() => setLevel(lane.label)}
                  title={`${lane.view}${lane.replayPath ? " · captured this session" : " · not captured yet"}`}
                  className={cn(
                    "tele rounded-[var(--radius)] border px-2 py-0.5",
                    lane.label === level
                      ? "border-primary/40 bg-primary/[0.08]"
                      : "border-transparent text-muted-foreground hover:bg-muted",
                  )}
                >
                  {lane.label}
                  <span className="ml-1 opacity-60">{zs.length}</span>
                  {calls > 0 && <span className="ml-1 text-cat-clay">·{calls}</span>}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setStatsOpen((v) => !v)}
              title="level-wide totals — the whole-building dashboard was noise; the level is the unit you actually work in"
              className={cn(
                "tele ml-2 rounded-[var(--radius)] border px-1.5 py-0.5",
                statsOpen
                  ? "border-primary/40 bg-primary/[0.08]"
                  : "border-[var(--line-2)] text-muted-foreground hover:bg-muted",
              )}
            >
              level stats
            </button>
            <button
              type="button"
              onClick={() => setPlanOpen((v) => !v)}
              title={
                planOpen ? "collapse the plan — give the table the full height" : "show the plan"
              }
              className="tele rounded-[var(--radius)] border border-[var(--line-2)] px-1.5 py-0.5 text-muted-foreground hover:bg-muted"
            >
              {planOpen ? "▴ hide plan" : "▾ show plan"}
            </button>

            <span className="tele ml-auto text-muted-foreground">
              {selected ? `scoped to ${selected.zone.key}` : "whole house in scope"} — Esc clears
            </span>
          </div>

          {planOpen && (
            <div className="relative shrink-0 overflow-hidden bg-card" style={{ height: planH }}>
              <LevelPlan
                zones={levelZones}
                stageFilter={stageFilter}
                selectedKey={zoneKey}
                cursor={cursor}
                stateOf={stateOf}
                onSelectZone={selectZone}
                onCursor={(z, guid) => {
                  setZoneKey(z.zone.key);
                  setLevel(z.zone.lane.label);
                  setCursor(guid);
                }}
                onClear={() => {
                  setZoneKey(null);
                  setCursor(null);
                }}
              />
              {statsOpen && (
                <LevelStats
                  level={level}
                  zones={levelZones}
                  stateOf={stateOf}
                  onClose={() => setStatsOpen(false)}
                />
              )}
            </div>
          )}

          {/* The grabbable boundary. Drag past the min cap and the plan hides itself. */}
          <div
            role="separator"
            aria-orientation="horizontal"
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
            onDoubleClick={() => {
              setPlanOpen(true);
              setPlanH(PLAN_DEFAULT_PX);
            }}
            title={
              planOpen
                ? "drag to resize the plan · drag past the minimum to hide it · double-click to reset"
                : "drag down to bring the plan back · double-click to reset"
            }
            className={cn(
              "group flex h-2 shrink-0 cursor-row-resize items-center justify-center border-y border-border bg-muted/50 hover:bg-primary/15",
              !planOpen && "bg-muted",
            )}
          >
            <span className="h-px w-8 bg-[var(--line-2)] group-hover:bg-primary/60" />
          </div>

          {/* The master table. Scoped, never hidden, never a per-zone detail pane. */}
          <MasterTable
            rows={rows}
            columns={columns}
            rowKey={(row) => row.room.guid}
            scopeLabel="rooms in scope"
            searchPlaceholder="name / type / zone…"
            chips={chips}
            summary={
              <>
                {visibleRows.length} rooms · {fmtNum(scopeSqft, 0)} sf
                {scopeCalls > 0 && (
                  <span className="text-cat-clay"> · {scopeCalls} needing a call</span>
                )}
                <span className="ml-2 opacity-70">j/k cursor · a/d accept/dismiss</span>
              </>
            }
            empty={
              <>
                No rooms in scope. Zones before <span className="tele">partitioned</span> have no
                rooms yet — widen the rail filter or press <span className="tele">Esc</span>.
              </>
            }
            activeKey={cursor}
            onRowClick={(row) => {
              setCursor(row.room.guid);
              // Clicking a row of the whole-house scope follows the room to its level; when a
              // zone is already picked on the plan the level is the user's choice, not the row's.
              if (!selected) setLevel(row.zone.zone.lane.label);
            }}
            onVisibleChange={(keys) =>
              setVisibleKeys((prev) =>
                prev.length === keys.length && prev.every((k, i) => k === keys[i]) ? prev : keys,
              )
            }
          />
        </section>

        {/* ── RIGHT: sparse peek at exactly one zone. Opaque on purpose. ────── */}
        <aside className="flex w-80 min-w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-background">
          <Peek
            zone={peekZone}
            room={cursorRow?.room ?? null}
            open={cursorRow?.open ?? []}
            state={cursorRow?.state ?? null}
            decided={decided}
            geoReady={geoReady}
            live={live}
            busy={busy}
            actions={actions}
            stateOf={stateOf}
            world={world}
            onDecide={decide}
            url={proposedUrl}
          />
        </aside>
      </div>
    </main>
  );
}

// ── The plan ────────────────────────────────────────────────────────────────

function LevelPlan({
  zones,
  stageFilter,
  selectedKey,
  cursor,
  stateOf,
  onSelectZone,
  onCursor,
  onClear,
}: {
  zones: WorldZone[];
  stageFilter: Stage | null;
  selectedKey: string | null;
  cursor: string | null;
  stateOf: (room: WorldRoom) => RoomState;
  onSelectZone: (z: WorldZone) => void;
  onCursor: (z: WorldZone, guid: string) => void;
  onClear: () => void;
}) {
  // Stray sub-60 sf zones are excluded from the frame fit AND the render — one of them sitting
  // 100 ft off the cluster was the reason the real house drew as specks near the legend.
  const drawn = useMemo(() => zones.filter(onPlan), [zones]);
  const skipped = zones.length - drawn.length;

  const bounds = useMemo<Bounds | null>(() => {
    if (drawn.length === 0) return null;
    let b: Bounds = drawn[0]!.zone.bounds;
    for (const z of drawn) {
      b = mergeBounds(b, z.zone.bounds);
      for (const r of z.rooms) if (r.outer) b = mergeBounds(b, boundsOf([r.outer]));
      for (const s of z.residues) b = mergeBounds(b, boundsOf([s.outer]));
    }
    return b;
  }, [drawn]);

  if (!bounds)
    return (
      <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
        no zones on this level
      </div>
    );

  const w = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const h = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const pad = Math.max(w, h) * 0.03;
  const span = Math.max(w, h);
  const font = span / 95;
  const flipY = (y: number) => bounds.minY + bounds.maxY - y;

  return (
    <div className="size-full">
      <svg
        viewBox={`${bounds.minX - pad} ${bounds.minY - pad} ${w + pad * 2} ${h + pad * 2}`}
        preserveAspectRatio="xMidYMid meet"
        className="size-full"
      >
        <title>Level plan — declared zones, detected rooms, held residue</title>
        {/* Clicking nothing returns instantly to the whole house. */}
        <rect
          x={bounds.minX - pad}
          y={bounds.minY - pad}
          width={w + pad * 2}
          height={h + pad * 2}
          fill="transparent"
          onClick={onClear}
        />

        {drawn.map((z) => {
          const dimmed = stageFilter !== null && z.stage !== stageFilter;
          const on = z.zone.key === selectedKey;
          const rgb = `rgb(${z.zone.color})`;
          return (
            <g key={z.zone.key} opacity={dimmed ? 0.15 : 1}>
              <path
                d={pathD(z.zone.loops, bounds)}
                fillRule="evenodd"
                fill={`color-mix(in srgb, ${rgb} ${on ? 16 : 8}%, transparent)`}
                stroke={rgb}
                strokeWidth={on ? 2.5 : 1}
                strokeOpacity={on ? 1 : 0.55}
                vectorEffect="non-scaling-stroke"
                className={dimmed ? undefined : "cursor-pointer"}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!dimmed) onSelectZone(z);
                }}
              />

              {/* Held residue — abstention stays visible; a held area beats a guessed one. */}
              {z.residues.map((s) => (
                <path
                  key={s.id}
                  d={pathD([s.outer, ...s.holes], bounds)}
                  fillRule="evenodd"
                  fill="color-mix(in srgb, var(--muted-foreground) 12%, transparent)"
                  stroke="var(--muted-foreground)"
                  strokeOpacity={0.35}
                  strokeDasharray="3 2"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  className="pointer-events-none"
                />
              ))}

              {z.rooms.map((room) => {
                const state = stateOf(room);
                const isCursor = room.guid === cursor;
                const tone = isCursor ? "var(--primary)" : STATE_META[state].tone;
                const click = (e: React.MouseEvent) => {
                  e.stopPropagation();
                  if (!dimmed) onCursor(z, room.guid);
                };
                // Zones the fixture doesn't cover have no polygon — a dot at the label point
                // is the honest fallback: position is known, boundary is not.
                if (!room.outer)
                  return (
                    <circle
                      key={room.guid}
                      cx={room.label[0]}
                      cy={flipY(room.label[1])}
                      r={span / 260}
                      fill={`color-mix(in srgb, ${tone} 45%, transparent)`}
                      stroke={tone}
                      strokeWidth={isCursor ? 2 : 1}
                      vectorEffect="non-scaling-stroke"
                      className="cursor-pointer"
                      onClick={click}
                    >
                      <title>{`${room.name} — ${room.sqft} sf · ${STATE_META[state].label} (no detected boundary)`}</title>
                    </circle>
                  );
                return (
                  <g key={room.guid} className="cursor-pointer" onClick={click}>
                    <path
                      d={pathD([room.outer, ...room.holes], bounds)}
                      fillRule="evenodd"
                      fill={`color-mix(in srgb, ${tone} ${isCursor ? 34 : state === "unreviewed" ? 7 : 13}%, transparent)`}
                      stroke={tone}
                      strokeOpacity={0.85}
                      strokeWidth={isCursor ? 2.5 : state === "call" ? 1.5 : 1}
                      strokeDasharray={state === "call" && !isCursor ? "4 2.5" : undefined}
                      vectorEffect="non-scaling-stroke"
                    >
                      <title>{`${room.name} — ${room.sqft} sf · ${STATE_META[state].label}`}</title>
                    </path>
                    {on && room.sqft > 40 && (
                      <text
                        x={room.label[0]}
                        y={flipY(room.label[1])}
                        textAnchor="middle"
                        fontSize={font}
                        fill="var(--foreground)"
                        className="pointer-events-none select-none"
                      >
                        <tspan x={room.label[0]} fontWeight={600}>
                          {room.name}
                        </tspan>
                        <tspan x={room.label[0]} dy={font * 1.15} fillOpacity={0.65}>
                          {room.sqft} sf
                        </tspan>
                      </text>
                    )}
                  </g>
                );
              })}

              {!on && (
                <text
                  x={(z.zone.bounds.minX + z.zone.bounds.maxX) / 2}
                  y={flipY((z.zone.bounds.minY + z.zone.bounds.maxY) / 2)}
                  textAnchor="middle"
                  fontSize={font * 0.95}
                  fill="var(--foreground)"
                  fillOpacity={0.55}
                  className="pointer-events-none select-none"
                >
                  {z.zone.key}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="pointer-events-none absolute bottom-1 left-2 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {ROOM_STATES.map((s) => (
          <Swatch
            key={s}
            tone={STATE_META[s].tone}
            label={STATE_META[s].label}
            dashed={s === "call"}
          />
        ))}
        <Swatch tone="var(--muted-foreground)" label="held residue" dashed />
        <Swatch tone="var(--primary)" label="cursor" />
        {skipped > 0 && (
          <span className="tele text-muted-foreground">
            {skipped} sub-{PLAN_MIN_SQFT} sf scribble{skipped === 1 ? "" : "s"} off-plan — see the
            rail
          </span>
        )}
      </div>
    </div>
  );
}

// ── Level-wide stats: the surviving piece of the round-1 dashboard ──────────

function LevelStats({
  level,
  zones,
  stateOf,
  onClose,
}: {
  level: string;
  zones: WorldZone[];
  stateOf: (room: WorldRoom) => RoomState;
  onClose: () => void;
}) {
  const rooms = zones.flatMap((z) => z.rooms);
  const area: Record<RoomState, number> = { call: 0, unreviewed: 0, data: 0, synced: 0 };
  let calls = 0;
  for (const r of rooms) {
    const s = stateOf(r);
    area[s] += r.sqft;
    if (s === "call") calls += 1;
  }
  const unpartitioned = zones.filter((z) => z.rooms.length === 0);
  const unpartitionedSqft = unpartitioned.reduce((s, z) => s + z.zone.declaredSqft, 0);
  const totalArea = ROOM_STATES.reduce((s, k) => s + area[k], 0) + unpartitionedSqft;

  const partitioned = zones.length - unpartitioned.length;
  const reviewed = zones.filter(
    (z) => z.rooms.length > 0 && z.rooms.every((r) => stateOf(r) !== "call"),
  ).length;
  const synced = zones.filter(
    (z) => z.rooms.length > 0 && z.rooms.every((r) => stateOf(r) === "synced"),
  ).length;

  const held = zones.reduce((s, z) => s + z.heldSqft, 0);
  let residual = 0;
  for (const z of zones) {
    const run = z.runs[z.runs.length - 1];
    if (!run) continue;
    residual +=
      run.declaredSqft - (run.roomSqft + run.claimedWallSqft + z.heldSqft + run.excludedSqft);
  }

  const pct = (n: number) => (zones.length === 0 ? 0 : Math.round((n / zones.length) * 100));

  return (
    <div className="absolute top-2 right-2 z-20 w-64 rounded-[var(--radius)] border border-border bg-background/95 px-2 py-1.5 shadow-sm backdrop-blur">
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="section-label">{level} — level totals</span>
        <button
          type="button"
          onClick={onClose}
          className="tele ml-auto text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>

      <div className="flex h-2 w-full items-stretch gap-px overflow-hidden rounded-[1px]">
        {ROOM_STATES.map((s) =>
          area[s] > 0 ? (
            <span
              key={s}
              title={`${STATE_META[s].label} — ${fmtNum(area[s], 0)} sf`}
              style={{
                width: `${(area[s] / Math.max(totalArea, 1)) * 100}%`,
                background: STATE_META[s].tone,
                opacity: s === "unreviewed" ? 0.35 : 0.9,
              }}
            />
          ) : null,
        )}
        {unpartitionedSqft > 0 && (
          <span
            title={`not partitioned — ${fmtNum(unpartitionedSqft, 0)} sf declared, no rooms yet`}
            className="border border-dashed border-[var(--line-2)]"
            style={{ width: `${(unpartitionedSqft / Math.max(totalArea, 1)) * 100}%` }}
          />
        )}
      </div>
      <p className="tele mt-0.5 text-muted-foreground">
        {fmtNum(totalArea, 0)} sf declared on this level, by room state
      </p>

      <div className="mt-1.5 space-y-px">
        <StatLine
          label="partitioned"
          value={`${pct(partitioned)}% · ${partitioned}/${zones.length} zones`}
        />
        <StatLine label="reviewed" value={`${pct(reviewed)}% · no open calls`} />
        <StatLine label="synced" value={`${pct(synced)}% · every room in the .r10`} />
        <StatLine
          label="calls"
          value={calls === 0 ? "none open" : `${calls} rooms need a human`}
          tone={calls > 0 ? "text-cat-clay" : "text-cat-green"}
        />
        <StatLine label="held" value={`${fmtNum(held, 0)} sf residue`} />
        <StatLine
          label="closure"
          value={
            Math.abs(residual) < 1
              ? "closed — every declared foot accounted"
              : `${fmtNum(residual, 0)} sf unaccounted`
          }
          tone={Math.abs(residual) < 1 ? "text-cat-green" : "text-cat-clay"}
        />
      </div>
    </div>
  );
}

function StatLine({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <p className="tele flex gap-1.5">
      <span className="w-16 shrink-0 text-right text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1 truncate", tone)}>{value}</span>
    </p>
  );
}

// ── Right rail: sparse labelled lines, ledger idiom ─────────────────────────

function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <p className="tele flex gap-1.5">
      <span className="w-16 shrink-0 text-right text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1 break-words", muted && "text-muted-foreground")}>
        {value}
      </span>
    </p>
  );
}

function nextAction(zone: WorldZone, calls: number): string {
  if (calls > 0) return `clear ${calls} open call${calls === 1 ? "" : "s"} on this zone`;
  switch (zone.stage) {
    case "declared":
      return "assign a system tag (adopt zones, re-adopt to edit)";
    case "registered":
      return zone.zone.lane.replayPath
        ? "run the partition to materialize rooms"
        : "capture this level, then run the partition";
    case "partitioned":
    case "reviewed":
      return "enter Manual J data against settled geometry";
    case "data":
      return "sync this zone into the .r10";
    case "synced":
      return "nothing pending — this zone is closed";
    case "drifted":
      return `reconcile ${fmtNum(zone.driftSqft, 0)} sf of hand-edit drift, then re-sync`;
  }
}

function Peek({
  zone,
  room,
  open,
  state,
  decided,
  geoReady,
  live,
  busy,
  actions,
  stateOf,
  world,
  onDecide,
  url,
}: {
  zone: WorldZone | null;
  room: WorldRoom | null;
  open: string[];
  state: RoomState | null;
  decided: Record<string, Verdict>;
  geoReady: boolean;
  live: boolean;
  busy: string | null;
  actions: AtlasActions;
  stateOf: (room: WorldRoom) => RoomState;
  world: { systems: WorldSystem[] };
  onDecide: (room: WorldRoom, flag: string, verb: Verdict) => void;
  url: string;
}) {
  if (!zone)
    return (
      <div className="space-y-1 p-3">
        <p className="tele text-muted-foreground">
          nothing under the cursor. Click a zone on the plan to scope, or a room to peek.
        </p>
        <p className="tele text-muted-foreground">
          j/k move the cursor · a/d accept or dismiss the first open call · Esc widens back to the
          whole house.
        </p>
      </div>
    );

  const calls = zone.rooms.filter((r) => stateOf(r) === "call").length;
  const run = zone.runs[zone.runs.length - 1] ?? null;
  const closure = run
    ? run.declaredSqft - (run.roomSqft + run.claimedWallSqft + zone.heldSqft + run.excludedSqft)
    : null;
  const systems = world.systems.filter((s) => s.zoneKeys.includes(zone.zone.key));
  const localDecisions = room
    ? room.flags
        .map((f) => ({ flag: f, verb: decided[flagKey(room.guid, f)] }))
        .filter((x): x is { flag: string; verb: Verdict } => x.verb !== undefined)
    : [];

  return (
    <div className="divide-y divide-[var(--line)]">
      <div className="px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <ZoneThumb zone={zone.zone} className="size-5" />
          <span className="tele">{zone.zone.key}</span>
          <span className="tele truncate text-muted-foreground">
            {zone.name} · {zone.zone.lane.label}
          </span>
        </div>
        <h2 className="mt-1 font-pe-display text-base leading-tight font-semibold tracking-tight">
          {room ? room.name : zone.name}
        </h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5">
          {room && state ? (
            <>
              <StateDot {...stateMeta(state)} />
              <span className={cn("tele", state === "call" ? "text-cat-clay" : undefined)}>
                {STATE_META[state].label}
              </span>
              <span className="tele text-muted-foreground">
                {room.sqft} sf · {fmtNum(room.ceilingFt, 1)} ft clg · {room.type}
              </span>
            </>
          ) : (
            <span className="tele text-muted-foreground">
              {zone.rooms.length} rooms · {fmtNum(zone.zone.declaredSqft, 0)} sf declared · zone at{" "}
              {zone.stage}
            </span>
          )}
        </p>
      </div>

      <ZonePeek zone={zone} cursorRoom={room} geoReady={geoReady} stateOf={stateOf} />

      {open.length > 0 && room && (
        <div className="px-2.5 py-2">
          <p className="section-label mb-1">open calls — {open.length}</p>
          <ul className="space-y-1">
            {open.map((flag) => (
              <li key={flag}>
                <p className="tele text-cat-clay">{flag}</p>
                <p className="tele text-muted-foreground">{FLAG_MEANING[flag] ?? "no blurb"}</p>
                <span className="mt-0.5 flex gap-1">
                  <Button size="xs" variant="ghost" onClick={() => onDecide(room, flag, "accept")}>
                    accept <span className="ml-1 opacity-50">a</span>
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => onDecide(room, flag, "dismiss")}>
                    dismiss <span className="ml-1 opacity-50">d</span>
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          {!live ? (
            <Seam className="mt-1.5">fixture: verbs stay local, nothing is written</Seam>
          ) : room.elementId === null ? (
            <Seam className="mt-1.5">
              no Room Region home yet — partition must materialize this room before a decision can
              be written
            </Seam>
          ) : (
            <Live className="mt-1.5">verbs write through to the Room Region provenance blob</Live>
          )}
        </div>
      )}

      <div className="space-y-1 px-2.5 py-2">
        <p className="section-label">next action for this zone</p>
        <p className="text-xs leading-relaxed">{nextAction(zone, calls)}</p>
        {live && (
          <span className="flex flex-wrap gap-1 pt-0.5">
            <Button
              size="xs"
              variant="outline"
              disabled={busy !== null}
              title={`capture ${zone.zone.lane.label}: prepare seed views, export ink, detect — writes replay_<level>.bin`}
              onClick={() => actions.capture(zone.zone.lane)}
            >
              {zone.zone.lane.replayPath ? "re-capture level" : "capture level"}
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={busy !== null || !zone.zone.lane.replayPath}
              title={
                zone.zone.lane.replayPath
                  ? "replay the capture masked to this zone; materialize Room Regions (rerun never overwrites)"
                  : "capture the level first — the partition replays its snapshot"
              }
              onClick={() => actions.partition(zone)}
            >
              partition zone
            </Button>
          </span>
        )}
      </div>

      <div className="px-2.5 py-2">
        <p className="section-label mb-1">provenance</p>
        {room ? (
          <>
            <Line label="run" value={room.provenance.runId} />
            <Line
              label="source sf"
              value={
                room.sqft === room.provenance.sourceSqft
                  ? `${fmtNum(room.provenance.sourceSqft, 0)} sf — unchanged since detection`
                  : `${fmtNum(room.provenance.sourceSqft, 0)} sf detected, now ${room.sqft} sf`
              }
            />
            <Line
              label="boundary"
              value={room.outer ? `${room.outer.length} pts detected` : "no polygon — dot only"}
            />
            <Line label="guid" value={room.guid} />
            <Line
              label=".r10"
              value={
                room.r10
                  ? `#${room.r10.identifier} · synced ${room.r10.syncedAt.slice(0, 10)} at ${fmtNum(room.r10.lastSyncedSqft, 0)} sf`
                  : "never exported"
              }
            />
            {room.decisions.length === 0 && localDecisions.length === 0 ? (
              <Line label="decisions" value="none written on this room" muted />
            ) : (
              <>
                {room.decisions.map((d, i) => (
                  <Line
                    key={`w${i}`}
                    label={i === 0 ? "decisions" : ""}
                    value={`${d.verb} ${d.flag} · ${d.at.slice(0, 10)} · ${d.runId}`}
                  />
                ))}
                {localDecisions.map((d) => (
                  <Line key={`l${d.flag}`} label="" value={`${d.verb} ${d.flag} · this session`} />
                ))}
              </>
            )}
          </>
        ) : (
          <>
            <Line label="zone guid" value={zone.zone.guid} />
            <Line
              label="tags"
              value={zone.tags.length > 0 ? zone.tags.join(", ") : "none typed yet"}
            />
            <Line label="declared" value={`${fmtNum(zone.zone.declaredSqft, 0)} sf`} />
            <Line
              label="run"
              value={run ? run.runId : "no partition run against this zone"}
              muted={!run}
            />
          </>
        )}
      </div>

      {systems.length > 0 && (
        <div className="px-2.5 py-2">
          <p className="section-label mb-1">systems</p>
          {systems.map((s) => (
            <Line
              key={s.tag}
              label={s.tag}
              value={`${fmtNum(s.sensibleBtuh, 0)} Btu/h sensible${
                s.overCap ? ` — over the ${SENSIBLE_CAP_BTUH.toLocaleString()} cap` : ""
              }`}
            />
          ))}
        </div>
      )}

      <div className="px-2.5 py-2">
        <p className="section-label mb-1">accounting closure</p>
        {run ? (
          <>
            <Line label="declared" value={`${fmtNum(run.declaredSqft, 0)} sf`} />
            <Line label="rooms" value={`${fmtNum(run.roomSqft, 0)} sf · ${run.created} created`} />
            <Line label="walls" value={`${fmtNum(run.claimedWallSqft, 0)} sf claimed`} />
            <Line label="held" value={`${fmtNum(zone.heldSqft, 0)} sf · ${run.held} residue`} />
            <Line label="excluded" value={`${fmtNum(run.excludedSqft, 0)} sf`} />
            <p
              className={cn(
                "tele mt-1 rounded-[var(--radius)] border px-1.5 py-0.5",
                closure !== null && Math.abs(closure) < 1
                  ? "border-cat-green/25 bg-cat-green/[0.08] text-cat-green"
                  : "border-cat-clay/30 bg-cat-clay/[0.08] text-cat-clay",
              )}
            >
              {closure !== null && Math.abs(closure) < 1
                ? "closed — every declared foot is accounted for"
                : `${fmtNum(closure ?? 0, 0)} sf unaccounted`}
            </p>
          </>
        ) : (
          <p className="tele text-muted-foreground">
            no run yet — nothing has been claimed against this zone's declared area.
          </p>
        )}
      </div>

      <div className="space-y-1 px-2.5 py-2">
        <p className="section-label">addressable</p>
        <p className="tele rounded-[var(--radius)] border border-[var(--line)] bg-muted/60 px-1.5 py-1 break-all text-muted-foreground">
          {url}
        </p>
      </div>
    </div>
  );
}

/**
 * The zone under the cursor, drawn from the real detector polygons: zone outline, held residues,
 * sibling rooms dim, the cursor room emphasized. Same Y-flipped frame as the level plan, so a
 * room's position here is its position in the model. Rooms the fixture does not cover fall back to
 * label dots, and say so. Ported from the ledger variant — the plan answers "where in the house",
 * this answers "where in the zone", and the second question survived the merge.
 */
function ZonePeek({
  zone,
  cursorRoom,
  geoReady,
  stateOf,
}: {
  zone: WorldZone;
  cursorRoom: WorldRoom | null;
  geoReady: boolean;
  stateOf: (room: WorldRoom) => RoomState;
}) {
  const withGeometry = zone.rooms.filter((r) => r.outer !== null);
  const bounds = useMemo<Bounds>(() => {
    let b: Bounds = zone.zone.bounds;
    for (const room of zone.rooms) if (room.outer) b = mergeBounds(b, boundsOf([room.outer]));
    for (const residue of zone.residues) b = mergeBounds(b, boundsOf([residue.outer]));
    return b;
  }, [zone]);

  const w = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const h = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const pad = Math.max(w, h) * 0.06;
  const font = Math.max(w, h) / 26;
  const flipY = (y: number) => bounds.minY + bounds.maxY - y;

  return (
    <div>
      <div className="h-52 border-b border-[var(--line)] bg-card">
        <svg
          viewBox={`${bounds.minX - pad} ${bounds.minY - pad} ${w + pad * 2} ${h + pad * 2}`}
          preserveAspectRatio="xMidYMid meet"
          className="size-full"
        >
          <title>{`${zone.zone.key} — declared zone, its rooms, and the cursor room`}</title>

          {/* The designer's declared scope. Nothing may be claimed outside it. */}
          <path
            d={pathD(zone.zone.loops, bounds)}
            fillRule="evenodd"
            fill={`color-mix(in srgb, rgb(${zone.zone.color}) 8%, transparent)`}
            stroke={`rgb(${zone.zone.color})`}
            strokeWidth={1.5}
            strokeOpacity={0.85}
            vectorEffect="non-scaling-stroke"
          />

          {/* Held residue: abstention stays visible; a held area beats a guessed one. */}
          {zone.residues.map((residue) => (
            <path
              key={residue.id}
              d={pathD([residue.outer, ...residue.holes], bounds)}
              fillRule="evenodd"
              fill="color-mix(in srgb, var(--muted-foreground) 12%, transparent)"
              stroke="var(--muted-foreground)"
              strokeOpacity={0.4}
              strokeDasharray="4 3"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            >
              <title>{`held residue · ${residue.reason} · ${fmtNum(residue.rawSqft, 0)} sf`}</title>
            </path>
          ))}

          {zone.rooms.map((room) => {
            const on = cursorRoom?.guid === room.guid;
            const state = stateOf(room);
            const accent = on ? "var(--primary)" : STATE_META[state].tone;
            if (!room.outer) {
              const r = Math.max(Math.sqrt(Math.max(room.sqft, 20)) / 3.2, Math.max(w, h) / 90);
              return (
                <circle
                  key={room.guid}
                  cx={room.label[0]}
                  cy={flipY(room.label[1])}
                  r={r}
                  fill={`color-mix(in srgb, ${accent} ${on ? 45 : 18}%, transparent)`}
                  stroke={accent}
                  strokeWidth={on ? 2 : 1}
                  strokeDasharray="3 2"
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{`${room.name} · ${fmtNum(room.sqft, 0)} sf · position only, no boundary`}</title>
                </circle>
              );
            }
            return (
              <path
                key={room.guid}
                d={pathD([room.outer, ...room.holes], bounds)}
                fillRule="evenodd"
                fill={`color-mix(in srgb, ${accent} ${on ? 32 : 10}%, transparent)`}
                stroke={accent}
                strokeOpacity={on ? 0.95 : 0.55}
                strokeWidth={on ? 2 : 1}
                strokeDasharray={state === "call" && !on ? "5 3" : undefined}
                vectorEffect="non-scaling-stroke"
              >
                <title>{`${room.name} · ${fmtNum(room.sqft, 0)} sf · ${STATE_META[state].label}`}</title>
              </path>
            );
          })}

          {cursorRoom && (
            <text
              x={cursorRoom.label[0]}
              y={flipY(cursorRoom.label[1])}
              textAnchor="middle"
              fontSize={font}
              className="pointer-events-none select-none"
              fill="var(--foreground)"
            >
              <tspan x={cursorRoom.label[0]} fontWeight={600}>
                {cursorRoom.name}
              </tspan>
              <tspan x={cursorRoom.label[0]} dy={font * 1.15} fillOpacity={0.7}>
                {fmtNum(cursorRoom.sqft, 0)} sf
              </tspan>
            </text>
          )}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-2.5 py-1">
        <Swatch tone="var(--primary)" label="cursor room" />
        <Swatch tone={STATE_META.call.tone} label="needs a call" dashed />
        {zone.residues.length > 0 && (
          <Swatch tone="var(--muted-foreground)" label={`held ×${zone.residues.length}`} dashed />
        )}
        <span className="tele text-muted-foreground">
          {withGeometry.length}/{zone.rooms.length} with real boundaries
        </span>
      </div>

      {(!geoReady || withGeometry.length < zone.rooms.length) && (
        <p className="px-2.5 pb-1.5">
          <Seam>
            {!geoReady
              ? "the detector fixture has not loaded yet — rooms are position dots until it does"
              : "this zone is outside the replayed capture, so its rooms carry label points and areas but no boundary"}
          </Seam>
        </p>
      )}
    </div>
  );
}
