/** PROTOTYPE — variant "ledger": table-dominant three-pane. */
/**
 * One table. Every room in the house, always.
 *
 * Round 1 said the master table was the thing worth keeping and that "only show what's needed"
 * was also right. This variant draws the boundary between those two philosophies in one place:
 * SEE EVERYTHING lives in the middle — one ledger row per room (and one per zone that has no
 * rooms yet, so the untouched half of the project is never invisible); ONLY WHAT'S NEEDED lives
 * in the right rail, which shows nothing except the cursor row's zone. There is no third detail
 * surface, no modal, no drill-down route.
 *
 * The left rail is a set of filters over that one table — pipeline burn-down, per-zone list,
 * what's-needed buckets, room kinds — and nothing else. Clicking a rail entry narrows the ledger;
 * it never navigates. Active filters restate themselves as dismissible chips above the table so
 * the scope is always readable from the middle.
 *
 * Geometry belongs to Revit: sqft is read-only everywhere, and the only place a shape is drawn is
 * the right rail's zone peek, which uses the real detector polygons from the fixture. Manual J
 * data edits are local session state. Nothing here is live.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";
import { CellSelect, NumberCell, TextCell, fmtNum } from "#/rhvac/cells";
import type { TakeoffResidueShape } from "#/rhvac/types";
import {
  FLAG_MEANING,
  boundsOf,
  mergeBounds,
  pathD,
  type Bounds,
} from "#/takeoff/model";
import { STAGE_ORDER, type MockRoomData, type MockStage, type RoomType } from "#/takeoff/proto/mock";
import { useMockWorldGeo, type GeoRoom, type GeoZone } from "#/takeoff/proto/mock-geo";
import { Live, Seam } from "#/takeoff/seam";
import { ZoneThumb } from "#/takeoff/zone-plan";

// ── Vocabulary ──────────────────────────────────────────────────────────────
//
// Stage color is a calm ramp, not a rainbow: grey while nothing is known, slate once geometry
// exists, lichen once data exists, green when the .r10 agrees, clay when it stopped agreeing.
// One hue per row — the pip's COLOR says where the zone is, its FILL COUNT says how far.

const STAGE_META: Record<MockStage, { text: string; fill: string; blurb: string; next: string }> = {
  declared: {
    text: "text-muted-foreground",
    fill: "bg-muted-foreground/45",
    blurb: "drawn, no System tag typed",
    next: "type a System tag on the Zoning Region",
  },
  registered: {
    text: "text-cat-kiln",
    fill: "bg-cat-kiln",
    blurb: "tag resolved against the registry",
    next: "partition the zone into rooms",
  },
  partitioned: {
    text: "text-cat-slate",
    fill: "bg-cat-slate",
    blurb: "rooms materialized, decisions open",
    next: "answer the open detector flags",
  },
  reviewed: {
    text: "text-cat-slate",
    fill: "bg-cat-slate",
    blurb: "decision queue empty",
    next: "enter Manual J data against settled geometry",
  },
  data: {
    text: "text-cat-lichen",
    fill: "bg-cat-lichen",
    blurb: "Manual J data entered, not exported",
    next: "export the zone into the .r10",
  },
  synced: {
    text: "text-cat-green",
    fill: "bg-cat-green",
    blurb: ".r10 agrees with the model",
    next: "nothing — this zone is closed",
  },
  drifted: {
    text: "text-cat-clay",
    fill: "bg-cat-clay",
    blurb: "hand edits moved against the accepted state",
    next: "reconcile the drift, then re-sync",
  },
};

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

/** The what's-needed buckets — the dispatch axis the inbox variant proved. */
type NeedKey = "flags" | "nodata" | "stale" | "unsynced" | "drift" | "unpartitioned";

const NEED_META: Record<NeedKey, { label: string; note: string }> = {
  flags: { label: "open flags", note: "the detector refused to guess — a human must call it" },
  nodata: { label: "no Manual J", note: "no room data entered; export would refuse this room" },
  stale: { label: ".r10 stale", note: "the .r10 area no longer matches the model" },
  unsynced: { label: "never exported", note: "no .r10 identifier — this room has never been sent" },
  drift: { label: "drift", note: "hand edits since the last accepted state" },
  unpartitioned: { label: "no rooms yet", note: "the zone exists but has never been partitioned" },
};

const NEED_KEYS: NeedKey[] = ["flags", "nodata", "stale", "unsynced", "drift", "unpartitioned"];

const SESSION_RUN = "web-20260814-1147";
const SESSION_AT = "2026-08-14 11:47";

// ── Rows ────────────────────────────────────────────────────────────────────

/**
 * One ledger row. A zone with no rooms yet still gets a row — "see everything" means the
 * untouched half of the project is counted, not merely absent.
 */
interface Row {
  key: string;
  zone: GeoZone;
  /** Null on a zone-placeholder row. */
  room: GeoRoom | null;
  /** Display name, uniquified within the zone so the peek and the ledger agree. */
  id: string;
  sqft: number;
  needs: NeedKey[];
  /** The one open call this row can answer, if any — first open flag, else the sync/drift call. */
  call: { id: string; kind: string; why: string; accept: string; dismiss: string; home: string } | null;
}

interface Receipt {
  verb: "accept" | "dismiss";
  label: string;
  at: string;
  runId: string;
}

function buildRows(world: { zones: GeoZone[] }): Row[] {
  const rows: Row[] = [];
  for (const zone of world.zones) {
    const stageIdx = STAGE_ORDER.indexOf(zone.stage);

    if (zone.rooms.length === 0) {
      rows.push({
        key: `zone:${zone.zone.key}`,
        zone,
        room: null,
        id: zone.name,
        sqft: zone.zone.declaredSqft,
        needs: ["unpartitioned"],
        call: null,
      });
      continue;
    }

    const seen = new Map<string, number>();
    zone.rooms.forEach((room) => {
      const n = (seen.get(room.name) ?? 0) + 1;
      seen.set(room.name, n);
      const id = n === 1 ? room.name : `${room.name} ${n}`;

      // mock.ts can emit an out-of-range FLAG_POOL index, so a flag is not guaranteed to be a
      // string. A nameless flag is not a decidable call — filtered, not rendered. Reported, not
      // fixed here (the fix belongs in mock.ts).
      const named = room.flags.filter((f): f is string => typeof f === "string");
      const open = named.filter((f) => !room.decisions.some((d) => d.flag === f));
      const stale = room.r10 !== null && room.r10.lastSyncedSqft !== room.sqft;
      const drift = zone.stage === "drifted";

      const needs: NeedKey[] = [];
      if (open.length > 0) needs.push("flags");
      if (room.data === null && stageIdx >= 3) needs.push("nodata");
      if (stale) needs.push("stale");
      if (room.r10 === null && stageIdx >= 4) needs.push("unsynced");
      if (drift) needs.push("drift");

      const flag = open[0];
      const call: Row["call"] = flag
        ? {
            id: flag,
            kind: flag,
            why: FLAG_MEANING[flag] ?? flag,
            accept: "accept the partition",
            dismiss: "keep the designer's",
            home: `Room Region blob · ${room.guid.slice(0, 8)}`,
          }
        : stale && room.r10
          ? {
              id: "sync-stale",
              kind: "sync stale",
              why: `the .r10 still holds ${fmtNum(room.r10.lastSyncedSqft, 0)} sf; the model says ${fmtNum(room.sqft, 0)} sf`,
              accept: "stage the new area",
              dismiss: "keep the .r10 value",
              home: `.r10 · room ${room.r10.identifier}`,
            }
          : drift
            ? {
                id: "drift",
                kind: "drift",
                why: `hand edits moved ${fmtNum(zone.driftSqft, 0)} sf against the accepted state`,
                accept: "take the model's shape",
                dismiss: "keep the accepted state",
                home: `Room Region blob · ${room.guid.slice(0, 8)}`,
              }
            : null;

      rows.push({
        key: `${zone.zone.key}/${room.guid}`,
        zone,
        room,
        id,
        sqft: room.sqft,
        needs,
        call,
      });
    });
  }
  return rows;
}

// ── Page ────────────────────────────────────────────────────────────────────

type GroupMode = "none" | "zone" | "level" | "stage";

export function Variant() {
  const { world, geoReady } = useMockWorldGeo();
  const rows = useMemo(() => buildRows(world), [world]);

  // ── Session state ────────────────────────────────────────────────────────
  const [receipts, setReceipts] = useState<Record<string, Receipt>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [types, setTypes] = useState<Record<string, RoomType>>({});
  const [data, setData] = useState<Record<string, Partial<MockRoomData>>>({});

  // ── Filters ──────────────────────────────────────────────────────────────
  const [stageFilter, setStageFilter] = useState<MockStage | null>(null);
  const [zoneFilter, setZoneFilter] = useState<string | null>(null);
  const [needFilter, setNeedFilter] = useState<NeedKey | null>(null);
  const [typeFilter, setTypeFilter] = useState<RoomType | null>(null);
  const [group, setGroup] = useState<GroupMode>("none");
  const [cursor, setCursor] = useState(0);

  const clearAll = () => {
    setStageFilter(null);
    setZoneFilter(null);
    setNeedFilter(null);
    setTypeFilter(null);
  };
  const anyFilter =
    stageFilter !== null || zoneFilter !== null || needFilter !== null || typeFilter !== null;

  /** A need is "open" only while its call is unanswered — the burn-downs move as you work. */
  const openNeeds = useMemo(() => {
    const map = new Map<string, NeedKey[]>();
    for (const row of rows) {
      const answered = row.call !== null && receipts[`${row.key}#${row.call.id}`] !== undefined;
      map.set(
        row.key,
        answered ? row.needs.filter((n) => n !== "flags" && n !== "stale" && n !== "drift") : row.needs,
      );
    }
    return map;
  }, [rows, receipts]);

  const visible = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (stageFilter && row.zone.stage !== stageFilter) return false;
      if (zoneFilter && row.zone.zone.key !== zoneFilter) return false;
      if (typeFilter && row.room?.type !== typeFilter) return false;
      if (needFilter && !(openNeeds.get(row.key) ?? []).includes(needFilter)) return false;
      return true;
    });
    if (group === "none") return filtered;
    const key = (r: Row) => groupLabel(r, group);
    const order = new Map<string, number>();
    for (const r of filtered) if (!order.has(key(r))) order.set(key(r), order.size);
    return [...filtered].sort((a, b) => order.get(key(a))! - order.get(key(b))!);
  }, [rows, stageFilter, zoneFilter, typeFilter, needFilter, openNeeds, group]);

  const cursorRow = visible[Math.min(cursor, visible.length - 1)] ?? null;
  useEffect(() => {
    if (cursor > visible.length - 1) setCursor(Math.max(0, visible.length - 1));
  }, [cursor, visible.length]);

  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  useEffect(() => {
    if (cursorRow) rowRefs.current.get(cursorRow.key)?.scrollIntoView({ block: "nearest" });
  }, [cursorRow]);

  const resolve = (row: Row, verb: "accept" | "dismiss") => {
    if (!row.call) return;
    const label = verb === "accept" ? row.call.accept : row.call.dismiss;
    setReceipts((prev) => ({
      ...prev,
      [`${row.key}#${row.call!.id}`]: { verb, label, at: SESSION_AT, runId: SESSION_RUN },
    }));
  };

  // Keyboard: the ledger is driven from the home row. ArrowLeft/Right belong to the variant
  // switcher, so the cursor lives on j/k only.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        return setCursor((c) => Math.min(visible.length - 1, c + 1));
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        return setCursor((c) => Math.max(0, c - 1));
      }
      if (e.key === "Escape") return clearAll();
      if (!cursorRow) return;
      if (e.key === "a") resolve(cursorRow, "accept");
      else if (e.key === "d") resolve(cursorRow, "dismiss");
      else if (e.key === "e") {
        e.preventDefault();
        rowRefs.current.get(cursorRow.key)?.querySelector("input")?.focus();
      } else if (e.key === "u")
        setReceipts((prev) => {
          if (!cursorRow.call) return prev;
          const next = { ...prev };
          delete next[`${cursorRow.key}#${cursorRow.call.id}`];
          return next;
        });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── Rail censuses ────────────────────────────────────────────────────────

  const stageRows = useMemo(
    () =>
      STAGE_ORDER.map((stage) => ({
        stage,
        zones: world.zones.filter((z) => z.stage === stage).length,
        reached: world.zones.filter((z) => STAGE_ORDER.indexOf(z.stage) >= STAGE_ORDER.indexOf(stage))
          .length,
        total: world.zones.length,
      })),
    [world.zones],
  );

  const zoneRows = useMemo(
    () =>
      world.zones.map((z) => ({
        zone: z,
        open: rows
          .filter((r) => r.zone.zone.key === z.zone.key)
          .reduce((n, r) => n + (openNeeds.get(r.key) ?? []).length, 0),
        rooms: z.rooms.length,
      })),
    [world.zones, rows, openNeeds],
  );

  const needRows = useMemo(
    () =>
      NEED_KEYS.map((need) => ({
        need,
        open: rows.filter((r) => (openNeeds.get(r.key) ?? []).includes(need)).length,
        total: rows.filter((r) => r.needs.includes(need)).length,
      })),
    [rows, openNeeds],
  );

  const typeRows = useMemo(() => {
    const counts = new Map<RoomType, number>();
    for (const r of rows) if (r.room) counts.set(r.room.type, (counts.get(r.room.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const totalOpen = rows.reduce((n, r) => n + (openNeeds.get(r.key) ?? []).length, 0);

  const proposedUrl = `/takeoff?f=${
    [
      stageFilter ? `stage:${stageFilter}` : null,
      zoneFilter ? `zone:${encodeURIComponent(zoneFilter)}` : null,
      needFilter ? `need:${needFilter}` : null,
      typeFilter ? `kind:${encodeURIComponent(typeFilter)}` : null,
    ]
      .filter(Boolean)
      .join("+") || "all"
  }&row=${encodeURIComponent(cursorRow?.id ?? "")}`;

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5">
        <h1 className="font-pe-display text-lg leading-none font-semibold tracking-tight">Ledger</h1>
        <span className="tele text-muted-foreground">every room in the house, in one table</span>
        <Live>{world.docName}</Live>
        <span className="tele text-muted-foreground">{world.r10Path}</span>
        <div className="ml-auto flex items-center gap-2.5">
          <span className="tele text-muted-foreground">
            <span className="text-foreground">{rows.length}</span> rows ·{" "}
            <span className="text-foreground">{world.zones.length}</span> zones
          </span>
          <span className="tele text-muted-foreground">
            <span className={cn(totalOpen === 0 ? "text-cat-green" : "text-cat-clay")}>
              {totalOpen}
            </span>{" "}
            needing something
          </span>
          <span className="tele text-muted-foreground">
            {Object.keys(receipts).length} decided this session
          </span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)_24rem] divide-x divide-[var(--line)]">
        {/* ── Rail: filters over the one table. Never navigation. ─────────── */}
        <aside className="min-h-0 overflow-y-auto px-2 py-2">
          <p className="section-label mb-1">pipeline · zones reaching each step</p>
          <ul className="mb-3 space-y-1">
            {stageRows.map((row, i) => (
              <li key={row.stage}>
                <button
                  type="button"
                  onClick={() => setStageFilter(stageFilter === row.stage ? null : row.stage)}
                  className={cn(
                    "w-full rounded-[var(--radius)] px-1 py-0.5 text-left hover:bg-muted",
                    stageFilter === row.stage && "bg-primary/10",
                  )}
                  title={STAGE_META[row.stage].blurb}
                >
                  <span className="tele flex items-baseline gap-1">
                    <span className="w-3 shrink-0 text-muted-foreground">{i + 1}</span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate normal-case",
                        STAGE_META[row.stage].text,
                      )}
                    >
                      {row.stage}
                    </span>
                    <span className={cn(row.zones === 0 ? "text-muted-foreground" : "text-foreground")}>
                      {row.zones}
                    </span>
                  </span>
                  <ProgressBar
                    filled={row.reached}
                    total={row.total}
                    fill={STAGE_META[row.stage].fill}
                  />
                </button>
              </li>
            ))}
          </ul>

          <p className="section-label mb-1">
            what's needed
            <span className="tele ml-1.5 normal-case text-muted-foreground">{totalOpen} open</span>
          </p>
          <ul className="mb-3 space-y-px">
            {needRows.map((row) => (
              <li key={row.need}>
                <button
                  type="button"
                  onClick={() => setNeedFilter(needFilter === row.need ? null : row.need)}
                  className={cn(
                    "tele flex w-full items-baseline gap-1.5 rounded-[var(--radius)] px-1 py-px text-left hover:bg-muted",
                    needFilter === row.need && "bg-primary/10",
                  )}
                  title={NEED_META[row.need].note}
                >
                  <span className="min-w-0 flex-1 truncate normal-case">
                    {NEED_META[row.need].label}
                  </span>
                  <span className={cn(row.open === 0 ? "text-cat-green" : "text-foreground")}>
                    {row.open === 0 ? "clear" : row.open}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <p className="section-label mb-1">zones</p>
          <ul className="mb-3 space-y-px">
            {zoneRows.map((row) => (
              <li key={row.zone.zone.key}>
                <button
                  type="button"
                  onClick={() =>
                    setZoneFilter(zoneFilter === row.zone.zone.key ? null : row.zone.zone.key)
                  }
                  className={cn(
                    "flex w-full items-center gap-1 rounded-[var(--radius)] px-1 py-px text-left hover:bg-muted",
                    zoneFilter === row.zone.zone.key && "bg-primary/10",
                  )}
                  title={`${row.zone.name} · ${row.zone.stage} · ${row.rooms} rooms`}
                >
                  <ZoneThumb zone={row.zone.zone} className="size-4" />
                  <span className="tele w-14 shrink-0 truncate">{row.zone.zone.key}</span>
                  <StagePip stage={row.zone.stage} />
                  <span
                    className={cn(
                      "tele ml-auto",
                      row.open === 0 ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {row.open === 0 ? "·" : row.open}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <p className="section-label mb-1">room kinds</p>
          <ul className="space-y-px">
            {typeRows.map(([type, n]) => (
              <li key={type}>
                <button
                  type="button"
                  onClick={() => setTypeFilter(typeFilter === type ? null : type)}
                  className={cn(
                    "tele flex w-full items-baseline gap-1.5 rounded-[var(--radius)] px-1 py-px text-left hover:bg-muted",
                    typeFilter === type && "bg-primary/10",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate normal-case">{type}</span>
                  <span className="text-muted-foreground">{n}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* ── The ledger ──────────────────────────────────────────────────── */}
        <section className="flex min-h-0 min-w-0 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--line)] px-2 py-1">
            <span className="tele text-muted-foreground">
              <span className="text-foreground">{visible.length}</span> of {rows.length} rows
            </span>
            {anyFilter ? (
              <>
                <FilterChip
                  label={stageFilter ? `stage: ${stageFilter}` : null}
                  onClear={() => setStageFilter(null)}
                />
                <FilterChip
                  label={zoneFilter ? `zone: ${zoneFilter}` : null}
                  onClear={() => setZoneFilter(null)}
                />
                <FilterChip
                  label={needFilter ? `needs: ${NEED_META[needFilter].label}` : null}
                  onClear={() => setNeedFilter(null)}
                />
                <FilterChip
                  label={typeFilter ? `kind: ${typeFilter}` : null}
                  onClear={() => setTypeFilter(null)}
                />
                <button
                  type="button"
                  onClick={clearAll}
                  className="tele rounded-[var(--radius)] px-1 text-muted-foreground hover:bg-muted"
                >
                  clear all (esc)
                </button>
              </>
            ) : (
              <span className="tele text-muted-foreground">
                unfiltered — the whole house. rail entries narrow this table; they never navigate.
              </span>
            )}
            <span className="ml-auto flex items-center gap-1">
              <span className="tele-label text-muted-foreground">group</span>
              {(["none", "zone", "level", "stage"] as GroupMode[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroup(g)}
                  className={cn(
                    "tele rounded-[var(--radius)] border px-1 py-px",
                    group === g
                      ? "border-foreground/25 bg-foreground/10"
                      : "border-transparent text-muted-foreground hover:bg-muted",
                  )}
                >
                  {g}
                </button>
              ))}
            </span>
            <span className="tele w-full text-muted-foreground">
              <Kbd>j</Kbd>
              <Kbd>k</Kbd> cursor · <Kbd>a</Kbd> accept · <Kbd>d</Kbd> dismiss · <Kbd>e</Kbd> edit ·{" "}
              <Kbd>u</Kbd> undo — sqft is read-only everywhere: geometry is edited in Revit
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-max border-separate border-spacing-0 text-left">
              <thead>
                <tr>
                  <Th label="" w="w-4" />
                  <Th label="pipeline" w="w-[4.25rem]" title="where this room's zone sits in the seven steps" />
                  <Th label="zone" w="w-[4.5rem]" />
                  <Th label="room" w="w-44" />
                  <Th label="type" w="w-32" />
                  <Th label="sqft" w="w-16" right title="measured by the detector — read-only here" />
                  <Th label="clg ft" w="w-14" right />
                  <Th label="ppl" w="w-12" right />
                  <Th label="ltg W" w="w-16" right />
                  <Th label="eq sens" w="w-16" right />
                  <Th label="eq lat" w="w-16" right />
                  <Th label="OA cfm" w="w-16" right />
                  <Th label="call" w="w-[19rem]" />
                  <Th label=".r10" w="w-32" />
                </tr>
              </thead>
              <tbody>
                {visible.map((row, i) => {
                  const prev = visible[i - 1];
                  const header =
                    group !== "none" &&
                    (!prev || groupLabel(prev, group) !== groupLabel(row, group));
                  return (
                    <LedgerRow
                      key={row.key}
                      row={row}
                      focused={cursorRow?.key === row.key}
                      groupHeader={header ? groupLabel(row, group) : null}
                      receipt={row.call ? receipts[`${row.key}#${row.call.id}`] : undefined}
                      name={row.room ? (names[row.room.guid] ?? row.id) : row.id}
                      type={row.room ? (types[row.room.guid] ?? row.room.type) : null}
                      data={row.room?.data ?? null}
                      edits={row.room ? data[row.room.guid] : undefined}
                      register={(el) => {
                        if (el) rowRefs.current.set(row.key, el);
                        else rowRefs.current.delete(row.key);
                      }}
                      onFocus={() => setCursor(i)}
                      onName={(v) =>
                        row.room && setNames((p) => ({ ...p, [row.room!.guid]: v }))
                      }
                      onType={(v) =>
                        row.room && setTypes((p) => ({ ...p, [row.room!.guid]: v }))
                      }
                      onData={(patch) =>
                        row.room &&
                        setData((p) => ({
                          ...p,
                          [row.room!.guid]: { ...p[row.room!.guid], ...patch },
                        }))
                      }
                      onResolve={(verb) => {
                        setCursor(i);
                        resolve(row, verb);
                      }}
                      onUndo={() =>
                        row.call &&
                        setReceipts((p) => {
                          const next = { ...p };
                          delete next[`${row.key}#${row.call!.id}`];
                          return next;
                        })
                      }
                    />
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-3 py-6">
                      <p className="section-label mb-1 text-cat-green">nothing in scope</p>
                      <p className="text-xs text-muted-foreground">
                        Every row matching these filters is answered. Press <Kbd>esc</Kbd> to widen
                        back to the whole house.
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Peek: only what's needed, for exactly one row. Opaque on purpose. ── */}
        <aside className="min-h-0 overflow-y-auto bg-background">
          <Peek row={cursorRow} geoReady={geoReady} url={proposedUrl} receipts={receipts} />
        </aside>
      </div>
    </main>
  );
}

function groupLabel(row: Row, mode: GroupMode): string {
  if (mode === "zone") return `${row.zone.zone.key} · ${row.zone.name}`;
  if (mode === "level") return row.zone.zone.lane.label;
  return row.zone.stage;
}

// ── Table pieces ────────────────────────────────────────────────────────────

function Th({
  label,
  w,
  right,
  title,
}: {
  label: string;
  w: string;
  right?: boolean;
  title?: string;
}) {
  return (
    <th
      title={title}
      className={cn(
        "sticky top-0 z-10 whitespace-nowrap border-b border-l border-[var(--line)] bg-muted px-1.5 py-1 first:border-l-0",
        w,
        right && "text-right",
      )}
    >
      <span className="tele-label text-muted-foreground">{label}</span>
    </th>
  );
}

const TD = "border-b border-l border-[var(--line-soft)] px-1.5 align-middle first:border-l-0";

function LedgerRow({
  row,
  focused,
  groupHeader,
  receipt,
  name,
  type,
  data,
  edits,
  register,
  onFocus,
  onName,
  onType,
  onData,
  onResolve,
  onUndo,
}: {
  row: Row;
  focused: boolean;
  groupHeader: string | null;
  receipt: Receipt | undefined;
  name: string;
  type: RoomType | null;
  data: MockRoomData | null;
  edits: Partial<MockRoomData> | undefined;
  register: (el: HTMLTableRowElement | null) => void;
  onFocus: () => void;
  onName: (value: string) => void;
  onType: (value: RoomType) => void;
  onData: (patch: Partial<MockRoomData>) => void;
  onResolve: (verb: "accept" | "dismiss") => void;
  onUndo: () => void;
}) {
  const room = row.room;
  const d = data ? { ...data, ...edits } : null;
  const stale = room?.r10 != null && room.r10.lastSyncedSqft !== room.sqft;

  return (
    <>
      {groupHeader && (
        <tr>
          <td colSpan={14} className="border-y border-[var(--line)] bg-muted/50 px-2 py-0.5">
            <span className="section-label">{groupHeader}</span>
          </td>
        </tr>
      )}
      <tr
        ref={register}
        onMouseDown={onFocus}
        onFocus={onFocus}
        className={cn(
          "scroll-mt-8",
          focused && "bg-primary/[0.07]",
          !room && "bg-muted/40",
          receipt && "opacity-70",
        )}
      >
        <td className={cn(TD, "text-center")}>
          <span className={cn("tele", focused ? "text-primary" : "text-transparent")}>›</span>
        </td>

        <td className={TD} title={`${row.zone.zone.key} is at "${row.zone.stage}" — ${STAGE_META[row.zone.stage].blurb}`}>
          <span className="flex items-center gap-1">
            <StagePip stage={row.zone.stage} />
            <span className="tele text-muted-foreground">
              {STAGE_ORDER.indexOf(row.zone.stage) + 1}
            </span>
          </span>
        </td>

        <td className={cn(TD, "tele text-muted-foreground")}>{row.zone.zone.key}</td>

        <td className={cn(TD, "p-0")}>
          {room ? (
            <TextCell value={name} onCommit={onName} title="room name — written to the Room Region" />
          ) : (
            <span className="tele block px-1.5 text-muted-foreground italic">
              {row.zone.name} — zone, not yet partitioned
            </span>
          )}
        </td>

        <td className={cn(TD, "p-0")}>
          {room && type ? (
            <CellSelect value={type} onChange={(v) => onType(v as RoomType)} title="room type">
              {ROOM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </CellSelect>
          ) : (
            <span className="tele block px-1.5 text-muted-foreground">—</span>
          )}
        </td>

        <td
          className={cn(TD, "tele text-right")}
          title={
            room
              ? `detector measured ${fmtNum(room.provenance.sourceSqft, 0)} sf on ${room.provenance.runId} — geometry is edited in Revit`
              : "declared Zoning Region area"
          }
        >
          {fmtNum(row.sqft, 0)}
        </td>
        <td className={cn(TD, "tele text-right text-muted-foreground")}>
          {room ? fmtNum(room.ceilingFt, 1) : "—"}
        </td>

        {d ? (
          <>
            <td className={cn(TD, "p-0")}>
              <NumberCell value={d.people} integer min={0} onCommit={(v) => onData({ people: v })} />
            </td>
            <td className={cn(TD, "p-0")}>
              <NumberCell
                value={d.lightingW}
                integer
                min={0}
                onCommit={(v) => onData({ lightingW: v })}
              />
            </td>
            <td className={cn(TD, "p-0")}>
              <NumberCell
                value={d.equipSensible}
                integer
                min={0}
                onCommit={(v) => onData({ equipSensible: v })}
              />
            </td>
            <td className={cn(TD, "p-0")}>
              <NumberCell
                value={d.equipLatent}
                integer
                min={0}
                onCommit={(v) => onData({ equipLatent: v })}
              />
            </td>
            <td className={cn(TD, "p-0")}>
              <NumberCell
                value={d.ventilationCfm}
                integer
                min={0}
                onCommit={(v) => onData({ ventilationCfm: v })}
              />
            </td>
          </>
        ) : (
          <td className={cn(TD, "tele text-muted-foreground")} colSpan={5}>
            {room ? "no Manual J data yet" : ""}
          </td>
        )}

        <td className={TD}>
          {receipt ? (
            <span className="tele flex items-baseline gap-1">
              <span className="text-cat-green">{receipt.label}</span>
              <span className="text-muted-foreground">{receipt.runId}</span>
              <Button size="xs" variant="ghost" onClick={onUndo}>
                undo
              </Button>
            </span>
          ) : row.call ? (
            <span className="flex items-baseline gap-1">
              <span
                className="tele shrink-0 rounded-[var(--radius)] border border-cat-clay/30 bg-cat-clay/[0.10] px-1 text-cat-clay"
                title={row.call.why}
              >
                {row.call.kind}
              </span>
              <span className="tele min-w-0 flex-1 truncate text-muted-foreground" title={row.call.why}>
                {row.call.why}
              </span>
              <Button size="xs" variant="ghost" title={row.call.accept} onClick={() => onResolve("accept")}>
                accept
              </Button>
              <Button size="xs" variant="ghost" title={row.call.dismiss} onClick={() => onResolve("dismiss")}>
                dismiss
              </Button>
            </span>
          ) : (
            <span className="tele text-muted-foreground">
              {row.needs.includes("unpartitioned")
                ? STAGE_META[row.zone.stage].next
                : row.needs.includes("nodata")
                  ? "waiting on Manual J data"
                  : "nothing open"}
            </span>
          )}
        </td>

        <td className={cn(TD, "tele")}>
          {room?.r10 ? (
            <span className={stale ? "text-cat-clay" : "text-cat-green"}>
              #{room.r10.identifier}
              <span className="ml-1 text-muted-foreground">
                {stale ? `stale ${fmtNum(room.sqft - room.r10.lastSyncedSqft, 0)} sf` : "in sync"}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">not exported</span>
          )}
        </td>
      </tr>
    </>
  );
}

// ── Rail primitives ─────────────────────────────────────────────────────────

/** Seven segments — the pipeline position of this row's zone, carried on every row. */
function StagePip({ stage }: { stage: MockStage }) {
  const idx = STAGE_ORDER.indexOf(stage);
  return (
    <span className="flex shrink-0 items-center gap-px" aria-hidden>
      {STAGE_ORDER.map((s, i) => (
        <span
          key={s}
          className={cn(
            "h-2.5 w-[3px] rounded-[1px]",
            i <= idx ? STAGE_META[stage].fill : "bg-[var(--line-soft)]",
          )}
        />
      ))}
    </span>
  );
}

function ProgressBar({ filled, total, fill }: { filled: number; total: number; fill: string }) {
  if (total === 0) return <div className="mt-0.5 h-[3px] bg-[var(--line-soft)]" />;
  if (total > 40)
    return (
      <div className="mt-0.5 h-[3px] bg-[var(--line-soft)]">
        <div className={cn("h-full", fill)} style={{ width: `${(filled / total) * 100}%` }} />
      </div>
    );
  return (
    <div className="mt-0.5 flex h-[3px] gap-px">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className={cn("h-full flex-1", i < filled ? fill : "bg-[var(--line-soft)]")} />
      ))}
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string | null; onClear: () => void }) {
  if (!label) return null;
  return (
    <button
      type="button"
      onClick={onClear}
      className="tele inline-flex items-center gap-1 rounded-[var(--radius)] border border-[var(--line-2)] bg-muted px-1.5 py-px hover:border-destructive/40 hover:text-destructive"
      title="remove this filter"
    >
      <span className="normal-case">{label}</span>
      <span className="opacity-60">×</span>
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="tele mx-px rounded-[var(--radius)] border border-[var(--line-2)] px-1 text-foreground">
      {children}
    </span>
  );
}

// ── Peek: the cursor row's zone, in real geometry ───────────────────────────

function Peek({
  row,
  geoReady,
  url,
  receipts,
}: {
  row: Row | null;
  geoReady: boolean;
  url: string;
  receipts: Record<string, Receipt>;
}) {
  if (!row)
    return (
      <div className="p-3">
        <p className="tele text-muted-foreground">
          no row under the cursor — press <Kbd>j</Kbd> to enter the ledger.
        </p>
      </div>
    );

  const zone = row.zone;
  const room = row.room;
  const meta = STAGE_META[zone.stage];
  const run = zone.runs[zone.runs.length - 1] ?? null;
  const receipt = row.call ? receipts[`${row.key}#${row.call.id}`] : undefined;
  const closure = run
    ? run.declaredSqft - (run.roomSqft + run.claimedWallSqft + zone.heldSqft + run.excludedSqft)
    : null;

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
          {room ? row.id : `${zone.name} — no rooms yet`}
        </h2>
        <p className="mt-1 flex items-center gap-1.5">
          <StagePip stage={zone.stage} />
          <span className={cn("tele", meta.text)}>{zone.stage}</span>
          <span className="tele text-muted-foreground">
            step {STAGE_ORDER.indexOf(zone.stage) + 1} of 7 · {meta.blurb}
          </span>
        </p>
      </div>

      <ZonePeek zone={zone} cursorRoom={room} geoReady={geoReady} />

      <div className="space-y-1 px-2.5 py-2">
        <p className="section-label">next action for this zone</p>
        <p className="text-xs leading-relaxed">{meta.next}</p>
        {zone.driftSqft > 0 && (
          <p className="tele text-cat-clay">
            {fmtNum(zone.driftSqft, 0)} sf of hand-edit drift against the accepted state
          </p>
        )}
      </div>

      <div className="px-2.5 py-2">
        <p className="section-label mb-1">provenance</p>
        {room ? (
          <>
            <Line label="run" value={room.provenance.runId} />
            <Line label="source sf" value={`${fmtNum(room.provenance.sourceSqft, 0)} sf as detected`} />
            <Line
              label="now"
              value={
                room.sqft === room.provenance.sourceSqft
                  ? "unchanged since detection"
                  : `${fmtNum(room.sqft, 0)} sf — changed since detection`
              }
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
            {room.decisions.length === 0 ? (
              <Line label="decisions" value="none written on this room" muted />
            ) : (
              room.decisions.map((dec, i) => (
                <Line
                  key={i}
                  label={i === 0 ? "decisions" : ""}
                  value={`${dec.verb} ${dec.flag} · ${dec.at.slice(0, 10)} · ${dec.runId}`}
                />
              ))
            )}
            {receipt && (
              <p className="tele mt-1 rounded-[var(--radius)] border border-cat-green/25 bg-cat-green/[0.08] px-1.5 py-1 text-cat-green">
                {receipt.label} · {receipt.at} · {receipt.runId}
                <span className="mt-0.5 block normal-case text-muted-foreground">
                  written straight into {row.call?.home} — no batch commit, no sidecar
                </span>
              </p>
            )}
          </>
        ) : (
          <>
            <Line label="zone guid" value={zone.zone.guid} />
            <Line label="tags" value={zone.tags.length > 0 ? zone.tags.join(", ") : "none typed yet"} />
            <Line label="declared" value={`${fmtNum(zone.zone.declaredSqft, 0)} sf`} />
            <Line label="runs" value="no partition run against this zone" muted />
          </>
        )}
      </div>

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
        <Seam>
          filters and cursor live in React state here — the real page would carry them in the query
          string so a scoped ledger and a row are linkable in review
        </Seam>
      </div>
    </div>
  );
}

function Line({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <p className="tele flex gap-1.5">
      <span className="w-16 shrink-0 text-right text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1 break-words", muted && "text-muted-foreground")}>
        {value}
      </span>
    </p>
  );
}

/**
 * The zone under the cursor, drawn from the real detector polygons: zone outline, held residues,
 * sibling rooms dim, the cursor room emphasized. Same Y-flipped frame as the /takeoff plan pane,
 * so a room's position on screen is its position in the model. Rooms the fixture does not cover
 * fall back to label dots, and say so.
 */
function ZonePeek({
  zone,
  cursorRoom,
  geoReady,
}: {
  zone: GeoZone;
  cursorRoom: GeoRoom | null;
  geoReady: boolean;
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
      <div className="h-60 border-b border-[var(--line)] bg-card">
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
          {zone.residues.map((residue: TakeoffResidueShape) => (
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
            const flagged = room.flags.filter((f) => typeof f === "string").length > 0;
            const accent = on ? "var(--primary)" : flagged ? "var(--cat-clay)" : "var(--cat-slate)";
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
                strokeDasharray={flagged && !on ? "5 3" : undefined}
                vectorEffect="non-scaling-stroke"
              >
                <title>{`${room.name} · ${fmtNum(room.sqft, 0)} sf`}</title>
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
        <Swatch color="var(--primary)" label="cursor room" />
        <Swatch color="var(--cat-slate)" label="sibling" />
        <Swatch color="var(--cat-clay)" label="flagged" dashed />
        {zone.residues.length > 0 && (
          <Swatch color="var(--muted-foreground)" label={`held ×${zone.residues.length}`} dashed />
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

function Swatch({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="tele inline-flex items-center gap-1 text-muted-foreground">
      <span
        className={cn("inline-block size-2.5 rounded-[1px] border", dashed && "border-dashed")}
        style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, borderColor: color }}
      />
      {label}
    </span>
  );
}
