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
import { Fragment, useEffect, useMemo, useState } from "react";

import {
  CellSelect,
  NumberCell,
  ReadCell,
  StateDot,
  TextCell,
  VERDICT_INK,
} from "#/components/master-table/cells";
import { AddressingBar } from "#/components/lang/addressing-bar";
import { cellStateLabel, type StateCellProps } from "#/components/lang/cell";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb, VerbGroup } from "#/components/lang/verb";
import { MasterTable } from "#/components/master-table/master-table";
import {
  fmtNum,
  type Column,
  type Verdict as RowVerdict,
  type VerdictTone,
} from "#/components/master-table/model";
import { Pane, PaneSplit, PaneWorkspace } from "#/components/ui/pane";
import { contentViewport, fitFrame, type Bounds2, unionBounds } from "#/lib/affine-frame";
import { ZoneThumb } from "#/takeoff/zone-plan";
import { FLAG_MEANING, loopBounds, pathD } from "#/takeoff/model";
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
// Derived from the room's own facts, never from its zone's stage label. Four states, spent on the
// design language's MEANING BAND (`--r-*`) rather than the viz ladder: the old `--cat-*` spends
// were taxonomy colours carrying state, which is exactly the violation the route passes exist to
// fix. The mapping is an argument, not a convenience:
//   call      → --r-alarm     the one alarm: a person is required, because the model or the
//                             detector disagrees with what is recorded.
//   unreviewed→ --r-ink-mute  the "never checked" rank — nothing has been entered here at all.
//   data      → --r-caution   unsaved: the Manual J numbers exist only in this session's overlay
//                             until a sync moves them into the .r10.
//   synced    → --r-done      it landed.
//
// NOTE: these four are a
// row-level PIPELINE VERDICT, not the cell grammar's state axes — the column rides the table's
// `verdict:` clause, whose tone union is the meaning band by construction.

type RoomState = "call" | "unreviewed" | "data" | "synced";

const ROOM_STATES: RoomState[] = ["call", "unreviewed", "data", "synced"];

const STATE_META: Record<RoomState, { tone: VerdictTone; label: string; note: string }> = {
  call: {
    tone: "alarm",
    label: "needs a call",
    note: "a human must decide: an open detector flag, or the .r10 no longer matches the model",
  },
  unreviewed: {
    tone: "mute",
    label: "no Manual J",
    note: "nothing open, but no Manual J data entered yet — export would refuse this room",
  },
  data: {
    tone: "caution",
    label: "data entered",
    note: "Manual J data entered against settled geometry, not yet exported — unsaved",
  },
  synced: {
    tone: "done",
    label: "in .r10",
    note: "exported and the .r10 still agrees with the model",
  },
};

/** The CSS ink behind a room state — for the SVG plan fills and rail bars, which cannot take
 * a tone name. One derivation, so the three surfaces cannot diverge. */
const stateInk = (state: RoomState): string => VERDICT_INK[STATE_META[state].tone];

/** The one alarm is `call` (tone carries it); `unreviewed` is the one dim. */
const stateMeta = (state: RoomState): RowVerdict => ({
  word: STATE_META[state].label,
  tone: STATE_META[state].tone,
  note: STATE_META[state].note,
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
 * SELECTION AND FOCUS ARE A FILL, NEVER A HUE. The plan used `--primary` (= `--r-commit`, the one
 * filled blue, reserved for writes that leave the page) as its cursor mark, which spent the commit
 * colour on "where am I". The legal fill — `--r-select` — is a page-adjacent ground and disappears
 * as an SVG stroke over the designer's own zone colours, so the cursor is drawn in NEUTRAL INK
 * instead: no hue bought, and still the highest-contrast mark on the plan.
 */
const CURSOR_INK = "var(--r-ink)";

/** Held residue and the "no boundary" fallback both mean "nothing real is here". */
const ABSENT_INK = "var(--r-ink-mute)";

/**
 * Per-zone progress, derived: one equal segment per room, coloured by that room's own state. A
 * zone with no rooms gets an empty outlined bar — "not partitioned" is a real state, not a zero.
 * This replaces the seven-tick zone-stage pip, which said nothing about whether work was needed.
 *
 * The empty bar used a DASHED edge, which the language reserves for SEAM (a fixture/stand-in). An
 * unpartitioned zone is not a stand-in — it is a genuine empty — so it takes the firm hairline.
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
          "inline-block h-2.5 w-10 shrink-0 rounded-[1px] border border-[var(--r-line-2)]",
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
            background: stateInk(s),
            opacity: s === "unreviewed" ? 0.3 : 0.9,
          }}
        />
      ))}
    </span>
  );
}

/**
 * A plan legend entry. `seam` is the ONLY reason a dashed edge may be drawn (design-lang.css: the
 * border style IS that meaning) — it marks a mark that stands in for geometry that does not exist.
 */
function Swatch({ tone, label, seam }: { tone: string; label: string; seam?: boolean }) {
  return (
    <span className="face-mono t-value inline-flex items-center gap-1 text-muted-foreground">
      <span
        className={cn(
          "inline-block size-2.5 rounded-[1px] border",
          seam === true && "border-dashed",
        )}
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

/** The Manual J number columns: one whole-unit field each, all editable, all on the never rung
 *  (muted ink, R2) until the room has data. */
const MANUAL_J: { field: keyof RoomData; label: string; width: string }[] = [
  { field: "people", label: "ppl", width: "w-12" },
  { field: "lightingW", label: "ltg W", width: "w-16" },
  { field: "equipSensible", label: "eq S", width: "w-16" },
  { field: "equipLatent", label: "eq L", width: "w-16" },
  { field: "ventilationCfm", label: "vent", width: "w-16" },
];

const flagKey = (guid: string, flag: string) => `${guid}::${flag}`;

/** Why a verdict verb will (or will not) act, stated where a newcomer reads it. */
const decideReason = (live: boolean, room: WorldRoom, verb: Verdict): string =>
  !live
    ? `Marks this call ${verb === "accept" ? "accepted" : "dismissed"} for this session only (fixture)`
    : room.elementId === null
      ? "no Room Region home yet — partition must materialize this room before a verdict can be written"
      : `Writes the ${verb} onto this room's Room Region provenance blob in the live model`;

/**
 * `Verb.reason` is a REQUIRED constructor argument (SURFACE-PHILOSOPHY §3 — "make the explanation
 * a required constructor argument"). RULED 2026-08-16: the reason is TITLE-BORNE — it renders as
 * the verb's title, not on the surface; the one exception is a DISABLED `commit` verb, which
 * renders its reason visibly (a concurrent canon change carries that rendering).
 *
 * `onFixture` is per-verb ON PURPOSE. The whole host lane refuses for one reason at once, and the
 * language has no lane-level refusal — a shared sentence therefore renders four times across one
 * header row and reads as a rendering fault (AUDIT #10). Short, verb-specific lines are the only
 * fix available without changing the primitive.
 *
 * The one-transaction honesty stamp lives in ONE home — the head rail's busy advisory — so the
 * per-verb busy reason stays short instead of repeating the same sentence on every verb.
 */
const hostReason = (live: boolean, busy: string | null, does: string, onFixture: string): string =>
  !live ? onFixture : busy !== null ? `${busy} is in flight` : does;

/** THE Manual J editor for one field — the table column and the room panel render this same
 *  element, so fallback, constraints, never-muting, and patch construction exist once.
 *
 *  A room with no Manual J data is the NEVER rung (R2): nothing was ever entered, so the value
 *  sits in `--r-ink-mute` — the grammar's own treatment, replacing the route-invented
 *  `opacity-50`. JUDGED during the adoption pass: the column STAYS on `NumberCell` rather than
 *  the editable `StateCell`, because `onCommit(text: string)` would re-implement the numeric
 *  contract (`parseCell`'s integer/min refusal, `inputMode="decimal"`, the right-aligned fmt)
 *  per column for no mark the grammar would add. */
function ManualJField({
  room,
  field,
  onPatch,
}: {
  room: WorldRoom;
  field: keyof RoomData;
  onPatch: (patch: RoomEdit) => void;
}) {
  return (
    <NumberCell
      value={room.data?.[field] ?? 0}
      digits={0}
      integer
      min={0}
      className={room.data === null ? "text-[var(--r-ink-mute)]" : undefined}
      onCommit={(v) => onPatch({ [field]: v })}
    />
  );
}

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

/**
 * The .r10 column's cell-state derivation — one function, so the column's marks and its facet
 * word are read from the same facts. AUDIT #3 → RULED R2 (2026-08-16): `fresh: "never"` is the
 * epistemic ladder's bottom rung — nothing was ever attempted here. It draws NO squiggle
 * (nothing exists to distrust) and mutes the value; the borrowed `unverified` rung goes back.
 */
function r10State(row: Row): StateCellProps {
  const r10 = row.room.r10;
  if (!r10) return { value: "not exported", fresh: "never" };
  const drift = row.room.sqft - r10.lastSyncedSqft;
  return drift === 0
    ? { value: `#${r10.identifier}`, agree: "agree", fresh: "fresh" }
    : {
        value: `#${r10.identifier}`,
        agree: "drift",
        // The struck ghost token: what the .r10 still holds, at zero row-height cost.
        modelValue: `${fmtNum(r10.lastSyncedSqft, 0)} sf`,
      };
}

// ── Variant ─────────────────────────────────────────────────────────────────

const PLAN_MIN_PX = 140;
const PLAN_MAX_PX = 720;
const PLAN_DEFAULT_PX = 340;
const PLAN_CHROME_PX = 34;

export function Atlas({ world, geoReady, live, busy, actions }: AtlasProps) {
  const [stageFilter, setStageFilter] = useState<Stage | null>(null);
  const [level, setLevel] = useState<string>("");
  const [zoneKey, setZoneKey] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, Verdict>>({});
  /** Where the per-room Manual J fields live: inline table columns (dense, whole-scope entry)
   *  or the room panel (narrow table, one room in focus). One home at a time, never both. */
  const [fieldsMode, setFieldsMode] = useState<"columns" | "panel">("columns");
  /** The row order the user is actually looking at — MasterTable owns filter/sort/search, and
   *  reports the result here so j/k walks the SAME order rather than the pre-filter scope. */
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);

  // First lane to arrive names the initial level tab (lanes are live data, not a constant).
  useEffect(() => {
    if (!level && world.lanes.length > 0) setLevel(world.lanes[0]!.label);
  }, [level, world.lanes]);

  // Plan geometry: controlled collapse; PaneWorkspace owns and persists its resized height.
  const [planOpen, setPlanOpen] = useState(true);
  const [statsOpen, setStatsOpen] = useState(false);

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
        key: "state",
        label: "state",
        title:
          "this ROOM's derived state — the same vocabulary the rail bars and the plan fills use",
        verdict: (row) => stateMeta(row.state),
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
          <span className="face-mono t-value block truncate px-1.5">
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
      // The Manual J block (+ ceiling): same shape, same law — the never rung (muted ink, R2)
      // until the room has data, and any number entered CREATES that data (the room's state
      // moves to "data entered").
      // In panel mode these fields move to the room panel; the table narrows to identity+status.
      ...(fieldsMode === "columns"
        ? [
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
            } satisfies Column<Row>,
            ...MANUAL_J.map(
              (mj): Column<Row> => ({
                key: mj.field,
                label: mj.label,
                right: true,
                width: mj.width,
                sort: (row) => row.room.data?.[mj.field] ?? 0,
                cell: (row) => (
                  <ManualJField
                    room={row.room}
                    field={mj.field}
                    onPatch={(patch) => actions.patch(row.room.guid, patch)}
                  />
                ),
              }),
            ),
          ]
        : []),
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
        // The owed COUNT and the alarm ink now live in the table's gutter (the owed marker,
        // ruled 2026-08-16) — this column keeps only the FILTER job, so its cell is trimmed to
        // the filterable words themselves: the open flag names, plain ink, no double mark.
        cell: (row) =>
          row.open.length > 0 ? (
            <span
              className="face-mono t-value block truncate px-1.5 text-muted-foreground"
              title={row.open.join(", ")}
            >
              {row.open.join(", ")}
            </span>
          ) : row.room.decisions.length > 0 ? (
            <span className="face-mono t-value block truncate px-1.5 text-muted-foreground">
              {row.room.decisions.length} decided
            </span>
          ) : null,
      },
      {
        // THE CELL-STATE CLAUSE, consumer #2. This column is a DIFF — what the .r10 holds against
        // what the model holds — which is exactly what the grammar's `agree` axis is for. The
        // column declares what it draws; MasterTable renders `StateCell`, and facet/sort fall
        // through to the grammar's own vocabulary and attention order. The old hand-rolled
        // `sort: identifier` is deliberately dropped: drift now sorts to the top, which is the
        // order the work happens in (SURFACE-PHILOSOPHY §1).
        key: "r10",
        label: ".r10",
        width: "w-28",
        title:
          "this room's line in the .r10, and whether it still agrees with the model. Read-only: the identifier is assigned by sync, never typed.",
        state: r10State,
        // The domain word for the never rung (`StateColumn.word`, ruled with #1 and R2): the
        // universal "never" is true but the route's fact is sharper — nothing of this room was
        // ever exported. The marks stay universal; every other row keeps the grammar's word.
        word: (row) => (row.room.r10 ? cellStateLabel(r10State(row)) : "not exported"),
      },
    ],
    [actions, flagVocabulary, fieldsMode],
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

  return (
    <main className="flex h-screen min-h-0 flex-col bg-background">
      {/* ── ONE head rail (lang AddressingBar — families #11's five-slot rule, adopted).
             `sync .r10` is THE page-blast verb: it is where reviewed work leaves this page.
             `adopt zones` and `refresh` act on the world the zones pane indexes, so they live
             in that pane's action strip; `open in RHVAC` acts on the joined .r10, so it lives
             in the sync panel beside the join it launches. ── */}
      <AddressingBar
        name="takeoffs"
        sentence={
          <span
            className="face-mono t-value text-[var(--r-ink)]"
            title={
              live
                ? "The targeted Revit document. Every read and every write on this page addresses it."
                : // The nothing-can-be-written stamp lives on the seam chip (its one home).
                  "The project-a replay fixture — chosen explicitly by ?source=fixture."
            }
          >
            <span className="text-[var(--r-ink-2)]">auditing </span>
            {world.docName || "…"}
          </span>
        }
        facts={
          world.r10Path && (
            <FactChip title="The .r10 this document is joined against — the Manual J file rooms sync into.">
              {world.r10Path}
            </FactChip>
          )
        }
        verb={
          <Verb
            label="sync .r10"
            onClick={actions.openSync}
            disabled={!live || busy !== null}
            reason={hostReason(
              live,
              busy,
              "Opens the sync panel: insert reviewed rooms with Manual J data into the target .r10",
              "fixture · no .r10 to sync into",
            )}
          />
        }
        advisory={
          busy ? (
            <OutcomeLine kind="busy" label={busy} says="the host runs one transaction at a time" />
          ) : !geoReady ? (
            <OutcomeLine
              kind="busy"
              label="loading room geometry"
              says="rooms draw as position dots until their boundaries land"
            />
          ) : undefined
        }
        seam={
          !live ? (
            <FactChip
              dashed
              title="The fixture lane — the project-a replay, chosen explicitly by ?source=fixture. No document is attached, and nothing here can be written."
            >
              fixture · project-a replay
            </FactChip>
          ) : undefined
        }
      />

      <PaneWorkspace
        className="min-h-0 flex-1"
        resize={{
          visual: {
            defaultSize: PLAN_DEFAULT_PX + PLAN_CHROME_PX,
            minSize: PLAN_MIN_PX + PLAN_CHROME_PX,
            maxSize: PLAN_MAX_PX + PLAN_CHROME_PX,
            minOtherSize: 220,
            persist: "pe.takeoffs.plan-height",
            collapse: {
              collapsed: !planOpen,
              onCollapsedChange: (collapsed) => setPlanOpen(!collapsed),
              collapsedSize: PLAN_CHROME_PX,
              collapseBelow: PLAN_MIN_PX + 6,
            },
          },
        }}
        navigation={
          <Pane
            kind="navigation"
            title="zones"
            meta={`${world.zones.length} declared`}
            /* The pane's own action strip: both verbs act on the world this pane indexes —
               adoption fills the zone list, refresh re-reads it (families #11's standing rule;
               they left the head when it became the five-slot rail). */
            actions={
              <>
                <Verb
                  label="adopt zones"
                  onClick={actions.openAdopt}
                  disabled={!live || busy !== null}
                  reason={hostReason(
                    live,
                    busy,
                    "Opens the adoption panel: stamp designer-drawn regions in a zoning view as Zoning Regions",
                    "fixture · no document to stamp into",
                  )}
                />
                <Verb
                  label="refresh"
                  onClick={actions.refresh}
                  disabled={!live || busy !== null}
                  reason={hostReason(
                    live,
                    busy,
                    "Re-reads the model: zones, materialized regions, decisions, and the .r10 join",
                    "fixture · the replay is already the whole world",
                  )}
                />
              </>
            }
          >
            <div className="shrink-0 border-b border-border px-2 py-1.5">
              <div className="t-caption t-upper mb-1 text-muted-foreground">
                room states — one per room
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {ROOM_STATES.map((s) => (
                  <span
                    key={s}
                    title={STATE_META[s].note}
                    className="face-mono t-value inline-flex items-center gap-1 text-muted-foreground"
                  >
                    <StateDot tone={STATE_META[s].tone} dim={s === "unreviewed"} />
                    {STATE_META[s].label}
                  </span>
                ))}
              </div>
            </div>

            <div className="shrink-0 border-b border-border px-2 py-2">
              <div className="t-caption t-upper mb-1 text-muted-foreground">
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
                      // Selection is a FILL, never a hue: `bg-accent` resolves to `--r-select`,
                      // the ground ladder's fourth rung. The old `bg-primary/[0.08]` spent the
                      // one filled blue — reserved for writes that leave the page — on "what is lit".
                      className={cn(
                        "flex items-baseline gap-1.5 rounded-[var(--radius)] px-1 py-0.5 text-left hover:bg-muted",
                        on && "bg-accent",
                      )}
                    >
                      <span className="face-mono t-value w-3 shrink-0 text-muted-foreground">
                        {i + 1}
                      </span>
                      <span
                        className={cn(
                          "face-mono t-value flex-1 truncate",
                          !on && "text-muted-foreground",
                        )}
                      >
                        {stage}
                      </span>
                      <span className="face-mono t-value tabular-nums text-muted-foreground">
                        {n}
                      </span>
                    </button>
                  );
                })}
              </div>
              {stageFilter && (
                <button
                  type="button"
                  className="t-caption mt-1 text-muted-foreground hover:text-foreground"
                  onClick={() => setStageFilter(null)}
                >
                  clear filter — show all {world.zones.length}
                </button>
              )}
            </div>

            {/* Group by level only so the list stays consistent — level is never the organizer. */}
            <div>
              {world.lanes.map((lane) => {
                const zs = filteredZones.filter((z) => z.zone.lane.label === lane.label);
                if (zs.length === 0) return null;
                return (
                  <div key={lane.label}>
                    <div className="t-caption t-upper sticky top-0 z-10 border-y border-[var(--r-line)] bg-muted px-2 py-0.5 text-muted-foreground">
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
                                "flex w-full items-center gap-1.5 border-b border-[var(--r-line)] px-2 py-1 text-left hover:bg-muted",
                                on && "bg-accent",
                                off && "opacity-55",
                              )}
                            >
                              <ZoneThumb zone={z.zone} className="size-5" />
                              <span className="face-mono t-value shrink-0">{z.zone.key}</span>
                              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                                {off ? "off-plan scribble" : z.name}
                              </span>
                              {calls > 0 && (
                                <FactChip
                                  tone="alarm"
                                  className="shrink-0"
                                  title={`${calls} room${calls === 1 ? "" : "s"} in this zone need a human call — an open detector flag or .r10 drift`}
                                >
                                  {calls} call{calls === 1 ? "" : "s"}
                                </FactChip>
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
          </Pane>
        }
        visual={
          <Pane
            kind="visual"
            toolbar={
              <>
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
                        "face-mono t-value rounded-[var(--radius)] border px-2 py-0.5",
                        lane.label === level
                          ? "border-[var(--r-line-2)] bg-accent"
                          : "border-transparent text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {lane.label}
                      <span className="ml-1 opacity-60">{zs.length}</span>
                      {calls > 0 && <span className="ml-1 text-[var(--r-alarm)]">·{calls}</span>}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setStatsOpen((v) => !v)}
                  title="level-wide totals — the whole-building dashboard was noise; the level is the unit you actually work in"
                  className={cn(
                    "face-mono t-value ml-2 rounded-[var(--radius)] border border-[var(--r-line-2)] px-1.5 py-0.5",
                    statsOpen ? "bg-accent" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  level stats
                </button>
                <button
                  type="button"
                  onClick={() => setPlanOpen((v) => !v)}
                  title={
                    planOpen
                      ? "collapse the plan — give the table the full height"
                      : "show the plan"
                  }
                  className="face-mono t-value rounded-[var(--radius)] border border-[var(--r-line-2)] px-1.5 py-0.5 text-muted-foreground hover:bg-muted"
                >
                  {planOpen ? "▴ hide plan" : "▾ show plan"}
                </button>

                <span className="face-mono t-value ml-auto text-muted-foreground">
                  {selected ? `scoped to ${selected.zone.key}` : "whole house in scope"} — Esc
                  clears
                </span>
              </>
            }
          >
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
            {/* Zone info lives ON the plan, where the zone is — not in a far-away rail. */}
            {selected && (
              <ZoneCard
                zone={selected}
                cursorRoom={cursorRow?.room ?? null}
                geoReady={geoReady}
                live={live}
                busy={busy}
                actions={actions}
                stateOf={stateOf}
                systems={world.systems}
                onClose={() => selectZone(null)}
              />
            )}
          </Pane>
        }
        content={
          <Pane kind="content" scroll="clip">
            {/* Room data sits BESIDE the rooms it describes. The panel exists exactly when a
                room is under the cursor; Esc clears both. The table never unmounts (its filter
                state must survive the cursor coming and going). */}
            <PaneSplit
              axis="horizontal"
              resize={{
                target: "end",
                defaultSize: 320,
                minSize: 240,
                maxSize: 520,
                minOtherSize: 360,
                persist: "pe.takeoffs.room-panel-width",
                collapse: { collapsed: cursorRow == null, collapsedSize: 0 },
              }}
              start={
                <MasterTable
                  rows={rows}
                  columns={columns}
                  rowKey={(row) => row.room.guid}
                  // THE OWED MARKER (fit reviews, ruled 2026-08-16): open detector calls owe a
                  // human verdict — the gutter locates them with the count in the one alarm.
                  // The flags column keeps the FILTER job; its cell dropped the duplicate
                  // alarm count when this landed.
                  gutter={(row) =>
                    row.open.length > 0
                      ? {
                          count: row.open.length,
                          tone: "alarm" as const,
                          title: `${row.open.length} open detector call${row.open.length === 1 ? "" : "s"} owe a verdict — ${row.open.join(", ")} (a/d accepts or dismisses the first)`,
                        }
                      : null
                  }
                  scopeLabel="rooms in scope"
                  searchPlaceholder="name / type / zone…"
                  chips={chips}
                  summary={
                    <>
                      {visibleRows.length} rooms · {fmtNum(scopeSqft, 0)} sf
                      {scopeCalls > 0 && (
                        <span className="text-[var(--r-alarm)]">
                          {" "}
                          · {scopeCalls} needing a call
                        </span>
                      )}
                      <span className="ml-2 opacity-70">j/k cursor · a/d accept/dismiss</span>
                      {/* The fields-mode control lives HERE, not in the room panel — the panel
                          vanishes with the cursor, and a mode's off-switch must not vanish
                          with it. */}
                      <button
                        type="button"
                        onClick={() =>
                          setFieldsMode((mode) => (mode === "panel" ? "columns" : "panel"))
                        }
                        title={
                          fieldsMode === "panel"
                            ? "Manual J fields are edited in the room panel for the cursor row; the table stays narrow. Click to move them back into the table as columns."
                            : "Manual J fields are table columns. Click to edit them in the room panel instead and narrow the table."
                        }
                        className="ml-2 rounded-[var(--radius)] border border-[var(--r-line-2)] px-1.5 py-px text-muted-foreground hover:bg-muted"
                      >
                        fields: {fieldsMode}
                      </button>
                    </>
                  }
                  empty={
                    // §4's two kinds, derived: the table's own narrowing (its filters, or the
                    // rail/plan scope) hid rooms that exist — or the world genuinely has none.
                    rows.length > 0 ? (
                      <EmptyState story="filter" exit="clear a column filter or the search">
                        the narrowing hid all {rows.length} rooms in scope
                      </EmptyState>
                    ) : world.zones.some((z) => z.rooms.length > 0) ? (
                      <EmptyState story="filter" exit="widen the rail filter or press Esc">
                        no rooms in this scope — the rail filter or the plan selection narrowed past
                        every partitioned zone
                      </EmptyState>
                    ) : (
                      <EmptyState
                        story="scope"
                        exit="capture a level, then partition a zone — rooms are materialized by partition"
                      >
                        no rooms anywhere yet — zones before partitioned have no rooms
                      </EmptyState>
                    )
                  }
                  activeKey={cursor}
                  onRowClick={(row) => {
                    setCursor(row.room.guid);
                    if (!selected) setLevel(row.zone.zone.lane.label);
                  }}
                  onVisibleChange={(keys) =>
                    setVisibleKeys((prev) =>
                      prev.length === keys.length && prev.every((k, i) => k === keys[i])
                        ? prev
                        : keys,
                    )
                  }
                />
              }
              end={
                cursorRow && (
                  <RoomPanel
                    row={cursorRow}
                    decided={decided}
                    live={live}
                    fieldsMode={fieldsMode}
                    onDecide={decide}
                    onPatch={(patch) => actions.patch(cursorRow.room.guid, patch)}
                    url={proposedUrl}
                  />
                )
              }
            />
          </Pane>
        }
      />
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

  const bounds = useMemo<Bounds2 | null>(() => {
    if (drawn.length === 0) return null;
    let b: Bounds2 = drawn[0]!.zone.bounds;
    for (const z of drawn) {
      b = unionBounds(b, z.zone.bounds);
      for (const r of z.rooms) if (r.outer) b = unionBounds(b, loopBounds([r.outer]));
      for (const s of z.residues) b = unionBounds(b, loopBounds([s.outer]));
    }
    return b;
  }, [drawn]);

  // A labelled empty, not an absence (lang EmptyState, R9). §4's two kinds, told apart: zones
  // that exist but are excluded by the plan's own sub-60 sf gate are the FILTER story; a level
  // nothing was ever adopted on is the SCOPE story. Different exits.
  if (!bounds)
    return (
      <div className="flex size-full items-center justify-center px-4 text-center">
        {zones.length > 0 ? (
          <EmptyState story="filter" exit="see the rail — they stay listed there, marked">
            all {zones.length} zone{zones.length === 1 ? "" : "s"} on this level are sub-
            {PLAN_MIN_SQFT} sf scribbles, drawn far from the cluster
          </EmptyState>
        ) : (
          <EmptyState
            story="scope"
            exit="adopt zones from a zoning-plan view, or pick another level above"
          >
            nothing has been adopted on this level yet
          </EmptyState>
        )}
      </div>
    );

  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1e-6);
  const font = span / 95;
  const { viewport, padding } = contentViewport(bounds, 0.03);
  const frame = fitFrame(bounds, viewport, { padding, yAxis: "up" });

  return (
    <div className="size-full">
      <svg
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="size-full"
      >
        <title>Level plan — declared zones, detected rooms, held residue</title>
        {/* Clicking nothing returns instantly to the whole house. */}
        <rect
          x={0}
          y={0}
          width={viewport.width}
          height={viewport.height}
          fill="transparent"
          onClick={onClear}
        />

        {drawn.map((z) => {
          const dimmed = stageFilter !== null && z.stage !== stageFilter;
          const on = z.zone.key === selectedKey;
          const rgb = `rgb(${z.zone.color})`;
          const [zoneLabelX, zoneLabelY] = frame.toViewport([
            (z.zone.bounds.minX + z.zone.bounds.maxX) / 2,
            (z.zone.bounds.minY + z.zone.bounds.maxY) / 2,
          ]);
          return (
            <g key={z.zone.key} opacity={dimmed ? 0.15 : 1}>
              <path
                d={pathD(z.zone.loops, frame)}
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

              {/* Held residue — abstention stays visible; a held area beats a guessed one. The
                  dash is the SEAM reading and is legal here: a residue is declared area with NO
                  element behind it, which is precisely what the reserved style means. */}
              {z.residues.map((s) => (
                <path
                  key={s.id}
                  d={pathD([s.outer, ...s.holes], frame)}
                  fillRule="evenodd"
                  fill={`color-mix(in srgb, ${ABSENT_INK} 12%, transparent)`}
                  stroke={ABSENT_INK}
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
                const tone = isCursor ? CURSOR_INK : stateInk(state);
                const [labelX, labelY] = frame.toViewport(room.label);
                const click = (e: React.MouseEvent) => {
                  e.stopPropagation();
                  if (!dimmed) onCursor(z, room.guid);
                };
                // Zones the fixture doesn't cover have no polygon — a dot at the label point
                // is the honest fallback: position is known, boundary is not. It carries the
                // reserved DASH, because that is what "a mark standing in for geometry that does
                // not exist" means in this language.
                if (!room.outer)
                  return (
                    <circle
                      key={room.guid}
                      cx={labelX}
                      cy={labelY}
                      r={span / 260}
                      fill={`color-mix(in srgb, ${tone} 45%, transparent)`}
                      stroke={tone}
                      strokeWidth={isCursor ? 2 : 1}
                      strokeDasharray="3 2"
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
                      d={pathD([room.outer, ...room.holes], frame)}
                      fillRule="evenodd"
                      fill={`color-mix(in srgb, ${tone} ${isCursor ? 34 : state === "unreviewed" ? 7 : 13}%, transparent)`}
                      stroke={tone}
                      strokeOpacity={0.85}
                      // A room needing a call used to be DASHED, which collided with the seam
                      // reading (a room with an open flag is emphatically real). It separates on
                      // the alarm hue plus stroke weight instead — the one alarm, doing its job.
                      strokeWidth={isCursor ? 2.5 : state === "call" ? 1.75 : 1}
                      vectorEffect="non-scaling-stroke"
                    >
                      <title>{`${room.name} — ${room.sqft} sf · ${STATE_META[state].label}`}</title>
                    </path>
                    {on && room.sqft > 40 && (
                      <text
                        x={labelX}
                        y={labelY}
                        textAnchor="middle"
                        fontSize={font}
                        fill="var(--foreground)"
                        className="pointer-events-none select-none"
                      >
                        <tspan x={labelX} fontWeight={600}>
                          {room.name}
                        </tspan>
                        <tspan x={labelX} dy={font * 1.15} fillOpacity={0.65}>
                          {room.sqft} sf
                        </tspan>
                      </text>
                    )}
                  </g>
                );
              })}

              {!on && (
                <text
                  x={zoneLabelX}
                  y={zoneLabelY}
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
          <Swatch key={s} tone={stateInk(s)} label={STATE_META[s].label} />
        ))}
        <Swatch tone={ABSENT_INK} label="held residue" seam />
        <Swatch tone={CURSOR_INK} label="cursor" />
        {skipped > 0 && (
          <span className="face-mono t-value text-muted-foreground">
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
        <span className="t-label t-upper text-muted-foreground">{level} — level totals</span>
        <button
          type="button"
          onClick={onClose}
          className="face-mono t-value ml-auto text-muted-foreground hover:text-foreground"
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
                background: stateInk(s),
                opacity: s === "unreviewed" ? 0.35 : 0.9,
              }}
            />
          ) : null,
        )}
        {/* "Not partitioned" is a genuine empty, not a stand-in: firm hairline, never the
            reserved dash. */}
        {unpartitionedSqft > 0 && (
          <span
            title={`not partitioned — ${fmtNum(unpartitionedSqft, 0)} sf declared, no rooms yet`}
            className="border border-[var(--r-line-2)]"
            style={{ width: `${(unpartitionedSqft / Math.max(totalArea, 1)) * 100}%` }}
          />
        )}
      </div>
      <p className="face-mono t-value mt-0.5 text-muted-foreground">
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
          tone={calls > 0 ? "text-[var(--r-alarm)]" : "text-[var(--r-done)]"}
        />
        <StatLine label="held" value={`${fmtNum(held, 0)} sf residue`} />
        <StatLine
          label="closure"
          value={
            Math.abs(residual) < 1
              ? "closed — every declared foot accounted"
              : `${fmtNum(residual, 0)} sf unaccounted`
          }
          tone={Math.abs(residual) < 1 ? "text-[var(--r-done)]" : "text-[var(--r-alarm)]"}
        />
      </div>
    </div>
  );
}

function StatLine({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <p className="face-mono t-value flex gap-1.5">
      <span className="w-16 shrink-0 text-right text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1 truncate", tone)}>{value}</span>
    </p>
  );
}

// ── Right rail: sparse labelled lines, ledger idiom ─────────────────────────

function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <p className="face-mono t-value flex gap-1.5">
      <span className="w-16 shrink-0 text-right text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1 break-words", muted && "text-muted-foreground")}>
        {value}
      </span>
    </p>
  );
}

/**
 * The selected zone, ON the plan — locality over the sidebar cliché. Identity, the mini zone
 * plan, the aggregate room-state bar (which replaced the prose "next action"), accounting
 * closure, and the zone verbs, floating where the zone itself is drawn. Deselecting (× / Esc /
 * click-out) removes it, so collapsing the plan hides only plan-local information.
 */
function ZoneCard({
  zone,
  cursorRoom,
  geoReady,
  live,
  busy,
  actions,
  stateOf,
  systems,
  onClose,
}: {
  zone: WorldZone;
  cursorRoom: WorldRoom | null;
  geoReady: boolean;
  live: boolean;
  busy: string | null;
  actions: AtlasActions;
  stateOf: (room: WorldRoom) => RoomState;
  systems: WorldSystem[];
  onClose: () => void;
}) {
  const states = zone.rooms.map(stateOf);
  const run = zone.runs[zone.runs.length - 1] ?? null;
  const closure = run
    ? run.declaredSqft - (run.roomSqft + run.claimedWallSqft + zone.heldSqft + run.excludedSqft)
    : null;
  const zoneSystems = systems.filter((s) => s.zoneKeys.includes(zone.zone.key));

  return (
    // Capped to the plan body and scrolling internally — at the default plan height the verbs
    // at the bottom must stay reachable without enlarging the plan first.
    <div className="absolute top-2 left-2 z-20 max-h-[calc(100%-1rem)] w-64 overflow-y-auto rounded-[var(--radius)] border border-border bg-background/95 shadow-sm backdrop-blur">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <ZoneThumb zone={zone.zone} className="size-5" />
        <span className="face-mono t-value">{zone.zone.key}</span>
        <span className="face-mono t-value min-w-0 truncate text-muted-foreground">
          {zone.name}
        </span>
        <button
          type="button"
          onClick={onClose}
          title="deselect this zone (Esc) — the table widens back to the whole house"
          className="face-mono t-value ml-auto text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>

      <ZonePeek zone={zone} cursorRoom={cursorRoom} geoReady={geoReady} stateOf={stateOf} />

      <div className="space-y-1 px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <ZoneStateBar zone={zone} states={states} className="w-16" />
          <span className="face-mono t-value text-muted-foreground" title={STAGE_BLURB[zone.stage]}>
            {zone.rooms.length} rooms · {fmtNum(zone.zone.declaredSqft, 0)} sf · {zone.stage}
          </span>
        </div>
        {run && (
          // Accounting closure is a machine-measured FACT about the run, so it is a chip, not
          // prose: `done` when every declared foot is accounted for, `alarm` when it is not —
          // unaccounted area IS the model disagreeing with the designer's declared scope.
          <FactChip
            tone={closure !== null && Math.abs(closure) < 1 ? "done" : "alarm"}
            title="Declared area minus rooms, claimed walls, held residue and exclusions. Anything left over is area this run neither claimed nor abstained from."
          >
            {closure !== null && Math.abs(closure) < 1
              ? "closed — every declared foot accounted"
              : `${fmtNum(closure ?? 0, 0)} sf unaccounted`}
          </FactChip>
        )}
        {zoneSystems.map((s) => (
          <p key={s.tag} className="face-mono t-value text-muted-foreground">
            {s.tag} · {fmtNum(s.sensibleBtuh, 0)} Btu/h
            {s.overCap ? ` — over the ${SENSIBLE_CAP_BTUH.toLocaleString()} cap` : ""}
          </p>
        ))}
        {/* Both zone verbs run WriteTransaction scripts against the live document — capture
            stamps cropped seed views, partition materializes Room Region elements — so both wear
            `commit`, the language's one filled blue for writes that leave the page. Blast radius
            is not a tone; it groups the lane, which is what the group head below says. */}
        {live && (
          <VerbGroup className="pt-0.5" title="zone verbs" radius="document · model">
            <Verb
              tone="commit"
              label={zone.zone.lane.replayPath ? "re-capture level" : "capture level"}
              disabled={busy !== null}
              reason={hostReason(
                live,
                busy,
                `Prepares cropped seed views on ${zone.zone.lane.label}, exports ink, and detects rooms — writes replay_<level>.bin and touches the document`,
                "fixture · nothing to capture",
              )}
              onClick={() => actions.capture(zone.zone.lane)}
            />
            <Verb
              tone="commit"
              label="partition zone"
              disabled={busy !== null || !zone.zone.lane.replayPath}
              reason={
                zone.zone.lane.replayPath == null
                  ? "capture the level first — the partition replays that snapshot, it cannot invent one"
                  : hostReason(
                      live,
                      busy,
                      "Replays the capture masked to this zone and materializes Room Regions in the model (a rerun never overwrites)",
                      "fixture · nothing to partition",
                    )
              }
              onClick={() => actions.partition(zone)}
            />
          </VerbGroup>
        )}
      </div>
    </div>
  );
}

/** Per-room data, living beside the rooms it narrates. Exists exactly while a row is under the
 *  cursor. In "panel" fields mode the Manual J fields render here and leave the table narrow;
 *  in "columns" mode they stay inline and this panel carries calls + provenance only. */
function RoomPanel({
  row,
  decided,
  live,
  fieldsMode,
  onDecide,
  onPatch,
  url,
}: {
  row: Row;
  decided: Record<string, Verdict>;
  live: boolean;
  fieldsMode: "columns" | "panel";
  onDecide: (room: WorldRoom, flag: string, verb: Verdict) => void;
  onPatch: (patch: RoomEdit) => void;
  url: string;
}) {
  const { room, zone, state, open } = row;
  const localDecisions = room.flags
    .map((f) => ({ flag: f, verb: decided[flagKey(room.guid, f)] }))
    .filter((x): x is { flag: string; verb: Verdict } => x.verb !== undefined);

  return (
    <Pane
      kind="inspector"
      title="room"
      meta={`${zone.zone.key} · ${zone.zone.lane.label}`}
      bodyClassName="p-0"
    >
      <div className="divide-y divide-[var(--r-line)]">
        <div className="px-2.5 py-2">
          <h2 className="font-pe-display text-base leading-tight font-semibold tracking-tight">
            {room.name}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5">
            <StateDot {...stateMeta(state)} />
            <span
              className={cn(
                "face-mono t-value",
                state === "call" ? "text-[var(--r-alarm)]" : undefined,
              )}
              title={STATE_META[state].note}
            >
              {STATE_META[state].label}
            </span>
            <span className="face-mono t-value text-muted-foreground">
              {room.sqft} sf · {fmtNum(room.ceilingFt, 1)} ft clg · {room.type}
            </span>
          </p>
        </div>

        {fieldsMode === "panel" && (
          <div className="px-2.5 py-2">
            <p className="t-label t-upper mb-1 text-muted-foreground">manual j — this room</p>
            <div className="grid grid-cols-[4rem_1fr] items-center gap-y-1">
              <span className="face-mono t-value pr-1.5 text-right text-muted-foreground">
                ceil ft
              </span>
              <span className="rounded-[1px] border border-[var(--r-line)]">
                <NumberCell
                  value={room.ceilingFt}
                  digits={1}
                  min={0}
                  onCommit={(v) => onPatch({ ceilingFt: v })}
                />
              </span>
              {MANUAL_J.map((mj) => (
                <Fragment key={mj.field}>
                  <span className="face-mono t-value pr-1.5 text-right text-muted-foreground">
                    {mj.label}
                  </span>
                  <span className="rounded-[1px] border border-[var(--r-line)]">
                    <ManualJField room={room} field={mj.field} onPatch={onPatch} />
                  </span>
                </Fragment>
              ))}
            </div>
          </div>
        )}

        {open.length > 0 && (
          <div className="px-2.5 py-2">
            <p className="t-label t-upper mb-1 text-muted-foreground">open calls — {open.length}</p>
            <ul className="space-y-2">
              {open.map((flag) => (
                <li key={flag}>
                  <p className="face-mono t-value text-[var(--r-alarm)]">{flag}</p>
                  <p className="face-mono t-value text-muted-foreground">
                    {FLAG_MEANING[flag] ?? "no blurb"}
                  </p>
                  {/* The verdict's TONE is derived from the lane, not maintained: on the live
                      lane it writes onto the Room Region provenance blob (a write beyond the
                      page — `commit`), on the fixture it only marks locally (`act`). The route
                      used to REFUSE SILENTLY when a room had no Room Region home; that refusal
                      is now the verb's own visible reason. */}
                  <span className="mt-0.5 flex gap-1">
                    <Verb
                      tone={live ? "commit" : "act"}
                      label="accept · a"
                      disabled={live && room.elementId === null}
                      reason={decideReason(live, room, "accept")}
                      onClick={() => onDecide(room, flag, "accept")}
                    />
                    <Verb
                      tone={live ? "commit" : "act"}
                      label="dismiss · d"
                      disabled={live && room.elementId === null}
                      reason={decideReason(live, room, "dismiss")}
                      onClick={() => onDecide(room, flag, "dismiss")}
                    />
                  </span>
                </li>
              ))}
            </ul>
            {!live ? (
              <FactChip
                dashed
                className="mt-1.5"
                title="The fixture lane has no document. Verdicts mark this session only and are lost when the tab closes."
              >
                fixture · verdicts stay local
              </FactChip>
            ) : room.elementId === null ? (
              <FactChip
                dashed
                className="mt-1.5"
                title="This room was detected but never materialized, so there is no element to write a verdict onto. Partition the zone first."
              >
                no Room Region home
              </FactChip>
            ) : (
              <FactChip
                tone="done"
                className="mt-1.5"
                title="Verdicts are persisted onto this room's Room Region provenance blob before the UI shows them as decided."
              >
                writes through to the blob
              </FactChip>
            )}
          </div>
        )}

        <div className="px-2.5 py-2">
          <p className="t-label t-upper mb-1 text-muted-foreground">provenance</p>
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
        </div>

        <div className="space-y-1 px-2.5 py-2">
          <p className="t-label t-upper text-muted-foreground">addressable</p>
          <p className="face-mono t-value rounded-[var(--radius)] border border-[var(--r-line)] bg-muted/60 px-1.5 py-1 break-all text-muted-foreground">
            {url}
          </p>
        </div>
      </div>
    </Pane>
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
  const bounds = useMemo<Bounds2>(() => {
    let b: Bounds2 = zone.zone.bounds;
    for (const room of zone.rooms) if (room.outer) b = unionBounds(b, loopBounds([room.outer]));
    for (const residue of zone.residues) b = unionBounds(b, loopBounds([residue.outer]));
    return b;
  }, [zone]);

  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1e-6);
  const font = span / 26;
  const { viewport, padding } = contentViewport(bounds, 0.06);
  const frame = fitFrame(bounds, viewport, { padding, yAxis: "up" });
  const [cursorX, cursorY] = cursorRoom ? frame.toViewport(cursorRoom.label) : [0, 0];

  return (
    <div>
      <div className="h-52 border-b border-[var(--r-line)] bg-card">
        <svg
          viewBox={`0 0 ${viewport.width} ${viewport.height}`}
          preserveAspectRatio="xMidYMid meet"
          className="size-full"
        >
          <title>{`${zone.zone.key} — declared zone, its rooms, and the cursor room`}</title>

          {/* The designer's declared scope. Nothing may be claimed outside it. */}
          <path
            d={pathD(zone.zone.loops, frame)}
            fillRule="evenodd"
            fill={`color-mix(in srgb, rgb(${zone.zone.color}) 8%, transparent)`}
            stroke={`rgb(${zone.zone.color})`}
            strokeWidth={1.5}
            strokeOpacity={0.85}
            vectorEffect="non-scaling-stroke"
          />

          {/* Held residue: abstention stays visible; a held area beats a guessed one. Dashed is
              legal — declared area with no element behind it is exactly the seam reading. */}
          {zone.residues.map((residue) => (
            <path
              key={residue.id}
              d={pathD([residue.outer, ...residue.holes], frame)}
              fillRule="evenodd"
              fill={`color-mix(in srgb, ${ABSENT_INK} 12%, transparent)`}
              stroke={ABSENT_INK}
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
            // `stateInk`, not the tone NAME — the tone is a token key ("alarm"), and feeding it
            // to color-mix silently produced an invalid colour (found during the adoption pass).
            const accent = on ? CURSOR_INK : stateInk(state);
            const [labelX, labelY] = frame.toViewport(room.label);
            if (!room.outer) {
              const r = Math.max(Math.sqrt(Math.max(room.sqft, 20)) / 3.2, span / 90);
              return (
                <circle
                  key={room.guid}
                  cx={labelX}
                  cy={labelY}
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
                d={pathD([room.outer, ...room.holes], frame)}
                fillRule="evenodd"
                fill={`color-mix(in srgb, ${accent} ${on ? 32 : 10}%, transparent)`}
                stroke={accent}
                strokeOpacity={on ? 0.95 : 0.55}
                // Not dashed: the reserved style means "no element behind this". A room needing
                // a call is real — it separates on the alarm hue and stroke weight.
                strokeWidth={on ? 2 : state === "call" ? 1.75 : 1}
                vectorEffect="non-scaling-stroke"
              >
                <title>{`${room.name} · ${fmtNum(room.sqft, 0)} sf · ${STATE_META[state].label}`}</title>
              </path>
            );
          })}

          {cursorRoom && (
            <text
              x={cursorX}
              y={cursorY}
              textAnchor="middle"
              fontSize={font}
              className="pointer-events-none select-none"
              fill="var(--foreground)"
            >
              <tspan x={cursorX} fontWeight={600}>
                {cursorRoom.name}
              </tspan>
              <tspan x={cursorX} dy={font * 1.15} fillOpacity={0.7}>
                {fmtNum(cursorRoom.sqft, 0)} sf
              </tspan>
            </text>
          )}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-2.5 py-1">
        <Swatch tone={CURSOR_INK} label="cursor room" />
        <Swatch tone={stateInk("call")} label="needs a call" />
        {zone.residues.length > 0 && (
          <Swatch tone={ABSENT_INK} label={`held ×${zone.residues.length}`} seam />
        )}
        <span className="face-mono t-value text-muted-foreground">
          {withGeometry.length}/{zone.rooms.length} with real boundaries
        </span>
      </div>

      {(!geoReady || withGeometry.length < zone.rooms.length) && (
        <p className="px-2.5 pb-1.5">
          <FactChip
            dashed
            title="Some rooms here are drawn as position dots rather than boundaries. A dot says the position is known and the shape is not — it is a stand-in, never a measurement."
          >
            {!geoReady
              ? "detector fixture still loading · rooms are position dots"
              : "outside the replayed capture · label points, no boundaries"}
          </FactChip>
        </p>
      )}
    </div>
  );
}
