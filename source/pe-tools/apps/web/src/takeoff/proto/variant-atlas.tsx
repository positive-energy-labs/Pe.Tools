/** PROTOTYPE — variant "atlas": plan-dominant three-pane. */
//
// Round-2 boundary experiment: the PLAN is the scope master, the TABLE always answers
// "everything currently in scope". No zone selected = the whole house is in the table, so the
// round-1 inbox's "see everything at once" survives; selecting a zone on the plan narrows it,
// so the round-1 zones variant's "only show what's needed" survives too. The table is never
// hidden and never collapses into a per-zone detail pane — that is the structural law here.
//
// Read-only mock. Every edit, decision and selection lives in local state; nothing is written.
import { useEffect, useMemo, useRef, useState } from "react";

import { CellSelect, fmtNum, NumberCell, TextCell } from "#/rhvac/cells";
import { Live, Seam } from "#/takeoff/seam";
import {
  boundsOf,
  LEVEL_LANES,
  mergeBounds,
  pathD,
  type Bounds,
} from "#/takeoff/model";
import { cn } from "#/lib/utils";

import { SENSIBLE_CAP_BTUH, STAGE_ORDER, type MockStage, type RoomType } from "./mock";
import { useMockWorldGeo, type GeoRoom, type GeoZone } from "./mock-geo";

// ── Stage vocabulary ────────────────────────────────────────────────────────
//
// Round-1 con: the stage palette read as a rainbow. Restrained ramp instead — progress is a
// neutral opacity ramp, and only two states earn a hue: "needs a human" (clay) and "landed in
// the .r10" (blue). Everything between is quiet on purpose.

const STAGE_BLURB: Record<MockStage, string> = {
  declared: "drawn, no system tag typed",
  registered: "tag resolved against the registry",
  partitioned: "rooms materialized, decisions open",
  reviewed: "decision queue empty",
  data: "Manual J data entered, not exported",
  synced: ".r10 in sync",
  drifted: "hand-edit drift since last sync",
};

const stageTone = (stage: MockStage): string =>
  stage === "drifted" || stage === "partitioned"
    ? "var(--cat-clay)"
    : stage === "synced"
      ? "var(--cat-blue)"
      : "var(--foreground)";

const stageDim = (stage: MockStage): number =>
  stage === "drifted" || stage === "partitioned" || stage === "synced"
    ? 1
    : 0.25 + STAGE_ORDER.indexOf(stage) * 0.12;

/** The pipeline-position chip: seven ticks, filled to this zone's stage. Round-1 con answered —
 *  every room row carries its zone's position, so "where is this in the pipeline" is never a
 *  question the table cannot answer. */
function StageTicks({ stage, className }: { stage: MockStage; className?: string }) {
  const idx = STAGE_ORDER.indexOf(stage);
  const tone = stageTone(stage);
  return (
    <span
      className={cn("inline-flex items-center gap-px align-middle", className)}
      title={`${stage} — ${STAGE_BLURB[stage]}`}
    >
      {STAGE_ORDER.map((s, i) => (
        <span
          key={s}
          className="inline-block h-2.5 w-1 rounded-[1px]"
          style={{
            background: i <= idx ? tone : "var(--line)",
            opacity: i <= idx ? stageDim(stage) : 1,
          }}
        />
      ))}
    </span>
  );
}

// ── Local edit / decision state ─────────────────────────────────────────────

interface RoomEdit {
  name?: string;
  type?: RoomType;
  ceilingFt?: number;
  people?: number;
  lightingW?: number;
  equipSensible?: number;
  equipLatent?: number;
  ventilationCfm?: number;
}

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

type Verdict = "accept" | "dismiss";
const flagKey = (guid: string, flag: string) => `${guid}::${flag}`;

// ── Row model ───────────────────────────────────────────────────────────────

interface Row {
  zone: GeoZone;
  room: GeoRoom;
}

const shortId = (guid: string) => guid.slice(guid.lastIndexOf("-") + 1);

/** Room review state — what the plan fill and the table's state column both read from. */
type Review = "open" | "drifted" | "synced" | "settled";

function reviewOf(room: GeoRoom, open: number): Review {
  if (open > 0) return "open";
  if (room.r10 && room.r10.lastSyncedSqft !== room.sqft) return "drifted";
  if (room.r10) return "synced";
  return "settled";
}

const REVIEW_TONE: Record<Review, string> = {
  open: "var(--cat-clay)",
  drifted: "var(--cat-clay)",
  synced: "var(--cat-blue)",
  settled: "var(--cat-slate)",
};

// ── Variant ─────────────────────────────────────────────────────────────────

export function Variant() {
  const { world, geoReady } = useMockWorldGeo();

  const [stageFilter, setStageFilter] = useState<MockStage | null>(null);
  const [level, setLevel] = useState<string>("Main");
  const [zoneKey, setZoneKey] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [edits, setEdits] = useState<Record<string, RoomEdit>>({});
  const [decided, setDecided] = useState<Record<string, Verdict>>({});

  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  // Local edits are a lens over the fixture, never a write.
  const apply = (room: GeoRoom): GeoRoom => {
    const e = edits[room.guid];
    if (!e) return room;
    return {
      ...room,
      name: e.name ?? room.name,
      type: e.type ?? room.type,
      ceilingFt: e.ceilingFt ?? room.ceilingFt,
      data: room.data
        ? {
            people: e.people ?? room.data.people,
            lightingW: e.lightingW ?? room.data.lightingW,
            equipSensible: e.equipSensible ?? room.data.equipSensible,
            equipLatent: e.equipLatent ?? room.data.equipLatent,
            ventilationCfm: e.ventilationCfm ?? room.data.ventilationCfm,
          }
        : null,
    };
  };
  const patch = (guid: string, p: RoomEdit) =>
    setEdits((prev) => ({ ...prev, [guid]: { ...prev[guid], ...p } }));

  const openFlags = (room: GeoRoom) =>
    room.flags.filter(
      (f) => !room.decisions.some((d) => d.flag === f) && !decided[flagKey(room.guid, f)],
    );

  // ── Scope derivation ──────────────────────────────────────────────────────
  // The stage strip filters the world; the plan selects within it; the table shows the result.

  const inStage = (z: GeoZone) => stageFilter === null || z.stage === stageFilter;
  const filteredZones = useMemo(
    () => world.zones.filter(inStage),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world, stageFilter],
  );

  const selected = zoneKey ? (world.zones.find((z) => z.zone.key === zoneKey) ?? null) : null;
  const levelZones = world.zones.filter((z) => z.zone.lane.label === level);

  const scopeZones = selected ? [selected] : filteredZones;
  const rows = useMemo<Row[]>(() => {
    const q = filter.trim().toLowerCase();
    const out: Row[] = [];
    for (const zone of scopeZones)
      for (const room of zone.rooms) {
        const shown = apply(room);
        if (
          q &&
          !shown.name.toLowerCase().includes(q) &&
          !shown.type.includes(q) &&
          !zone.zone.key.toLowerCase().includes(q)
        )
          continue;
        out.push({ zone, room: shown });
      }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeZones, filter, edits]);

  const cursorRow = rows.find((r) => r.room.guid === cursor) ?? null;

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
        if (rows.length === 0) return;
        const i = rows.findIndex((r) => r.room.guid === cursor);
        const next = e.key === "j" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
        setCursor(rows[i === -1 ? 0 : next]!.room.guid);
        return;
      }
      if ((e.key === "a" || e.key === "d") && cursorRow) {
        const open = openFlags(cursorRow.room);
        if (open.length === 0) return;
        e.preventDefault();
        decide(cursorRow.room, open[0]!, e.key === "a" ? "accept" : "dismiss");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (cursor) rowRefs.current.get(cursor)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const decide = (room: GeoRoom, flag: string, verb: Verdict) =>
    setDecided((prev) => ({ ...prev, [flagKey(room.guid, flag)]: verb }));

  const selectZone = (z: GeoZone | null) => {
    setZoneKey(z ? z.zone.key : null);
    setCursor(null);
    if (z) setLevel(z.zone.lane.label);
  };

  // ── Census ────────────────────────────────────────────────────────────────
  const stageCounts = STAGE_ORDER.map((s) => ({
    stage: s,
    n: world.zones.filter((z) => z.stage === s).length,
  }));
  const scopeOpen = scopeZones.reduce(
    (n, z) => n + z.rooms.reduce((m, r) => m + openFlags(r).length, 0),
    0,
  );
  const scopeSqft = rows.reduce((s, r) => s + r.room.sqft, 0);

  const proposedUrl =
    `/takeoff?level=${level}` +
    (selected ? `&zone=${encodeURIComponent(selected.zone.key)}` : "") +
    (cursorRow ? `&room=${shortId(cursorRow.room.guid)}` : "");

  return (
    <main className="flex h-screen min-h-0 flex-col bg-background">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5">
        <h1 className="font-pe-display text-lg font-semibold tracking-tight">Atlas</h1>
        <span className="tele text-muted-foreground">the plan is the index; the table is the truth</span>
        <Live>{world.docName}</Live>
        <span className="tele text-muted-foreground">{world.r10Path}</span>
        <div className="ml-auto flex items-center gap-2">
          {!geoReady && (
            <span className="tele text-cat-clay">loading real room geometry…</span>
          )}
          <Seam className="max-w-96">
            proposed URL <span className="tele">{proposedUrl}</span>
          </Seam>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── LEFT: global pipeline filter + zone list ─────────────────────── */}
        <aside className="flex w-64 min-w-64 shrink-0 flex-col border-r border-border bg-background">
          <div className="shrink-0 border-b border-border px-2 py-2">
            <div className="tele-label mb-1 text-muted-foreground">pipeline — global filter</div>
            <div className="flex flex-col">
              {stageCounts.map(({ stage, n }) => {
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
                      "flex items-center gap-1.5 rounded-[var(--radius)] px-1 py-0.5 text-left hover:bg-muted",
                      on && "bg-primary/[0.08]",
                    )}
                  >
                    <StageTicks stage={stage} />
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

          {/* Minimal zone list, grouped by level only so the list stays consistent — level is
              never the organizer, the pipeline is. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {LEVEL_LANES.map((lane) => {
              const zs = filteredZones.filter((z) => z.zone.lane.label === lane.label);
              if (zs.length === 0) return null;
              return (
                <div key={lane.label}>
                  <div className="tele-label sticky top-0 z-10 border-y border-[var(--line-soft)] bg-muted px-2 py-0.5 text-muted-foreground">
                    {lane.label} · {zs.length}
                  </div>
                  <ul>
                    {zs.map((z) => {
                      const open = z.rooms.reduce((n, r) => n + openFlags(r).length, 0);
                      const on = z.zone.key === zoneKey;
                      return (
                        <li key={z.zone.key}>
                          <button
                            type="button"
                            onClick={() => selectZone(on ? null : z)}
                            className={cn(
                              "flex w-full items-center gap-1.5 border-b border-[var(--line-soft)] px-2 py-1 text-left hover:bg-muted",
                              on && "bg-primary/[0.08]",
                            )}
                          >
                            <span
                              className="size-2.5 shrink-0 rounded-[1px] border"
                              style={{
                                borderColor: `rgb(${z.zone.color})`,
                                background: `color-mix(in srgb, rgb(${z.zone.color}) 30%, transparent)`,
                              }}
                            />
                            <span className="tele shrink-0">{z.zone.key}</span>
                            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                              {z.name}
                            </span>
                            {open > 0 && (
                              <span className="tele rounded-[var(--radius)] bg-cat-clay/15 px-1 text-cat-clay">
                                {open}
                              </span>
                            )}
                            <StageTicks stage={z.stage} className="shrink-0" />
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

        {/* ── MIDDLE: the plan (dominant) + the master table (subordinate, never hidden) ── */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
            {LEVEL_LANES.map((lane) => {
              const zs = world.zones.filter((z) => z.zone.lane.label === lane.label);
              const open = zs.reduce(
                (n, z) => n + z.rooms.reduce((m, r) => m + openFlags(r).length, 0),
                0,
              );
              return (
                <button
                  key={lane.label}
                  type="button"
                  onClick={() => setLevel(lane.label)}
                  title={lane.view}
                  className={cn(
                    "tele rounded-[var(--radius)] border px-2 py-0.5",
                    lane.label === level
                      ? "border-primary/40 bg-primary/[0.08]"
                      : "border-transparent text-muted-foreground hover:bg-muted",
                  )}
                >
                  {lane.label}
                  <span className="ml-1 opacity-60">{zs.length}</span>
                  {open > 0 && <span className="ml-1 text-cat-clay">·{open}</span>}
                </button>
              );
            })}
            <span className="tele ml-auto text-muted-foreground">
              {selected ? `scoped to ${selected.zone.key}` : "whole house in scope"} — Esc clears
            </span>
          </div>

          <LevelPlan
            zones={levelZones}
            stageFilter={stageFilter}
            selectedKey={zoneKey}
            cursor={cursor}
            openFlags={openFlags}
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

          {/* The master table. Scoped, never hidden, never a per-zone detail pane. */}
          <div className="flex min-h-0 flex-[4] flex-col border-t border-border">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-1">
              <span className="tele-label text-muted-foreground">rooms in scope</span>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="filter name / type / zone…"
                className="tele h-6 w-48 rounded-[var(--radius)] border border-border bg-transparent px-1.5 outline-none focus:border-ring"
              />
              <span className="tele text-muted-foreground">
                {rows.length} rooms · {fmtNum(scopeSqft, 0)} sf
                {scopeOpen > 0 && <span className="text-cat-clay"> · {scopeOpen} open</span>}
              </span>
              {selected && (
                <button
                  type="button"
                  className="tele-label text-muted-foreground hover:text-foreground"
                  onClick={() => selectZone(null)}
                >
                  ← back to whole house
                </button>
              )}
              <span className="tele ml-auto text-muted-foreground">j/k cursor · a/d accept/dismiss</span>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {[
                      ["pipeline", ""],
                      ["zone", ""],
                      ["name", ""],
                      ["type", ""],
                      ["sf", "r"],
                      ["ceil", "r"],
                      ["ppl", "r"],
                      ["ltg W", "r"],
                      ["eq S", "r"],
                      ["eq L", "r"],
                      ["vent", "r"],
                      ["flags", ""],
                      [".r10", ""],
                    ].map(([label, align]) => (
                      <th
                        key={label}
                        className={cn(
                          "tele-label sticky top-0 z-10 whitespace-nowrap border-b border-l border-border bg-muted px-1.5 py-1 font-normal text-muted-foreground first:border-l-0",
                          align === "r" ? "text-right" : "text-left",
                        )}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ zone, room }) => (
                    <TableRow
                      key={room.guid}
                      zone={zone}
                      room={room}
                      open={openFlags(room)}
                      cursor={cursor === room.guid}
                      rowRef={(el) => {
                        if (el) rowRefs.current.set(room.guid, el);
                        else rowRefs.current.delete(room.guid);
                      }}
                      onFocus={() => {
                        setCursor(room.guid);
                        if (!selected) setLevel(zone.zone.lane.label);
                      }}
                      onPatch={(p) => patch(room.guid, p)}
                    />
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && (
                <p className="p-6 text-center text-xs text-muted-foreground">
                  No rooms in scope. Zones before <span className="tele">partitioned</span> have no
                  rooms yet.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ── RIGHT: granular data. Opaque — round-1 con answered. ─────────── */}
        <aside className="flex w-80 min-w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-background">
          {cursorRow ? (
            <RoomCard
              zone={cursorRow.zone}
              room={cursorRow.room}
              open={openFlags(cursorRow.room)}
              decided={decided}
              onDecide={decide}
            />
          ) : selected ? (
            <ZoneCard zone={selected} open={scopeOpen} world={world} openFlags={openFlags} />
          ) : (
            <HouseCard world={world} zones={filteredZones} openFlags={openFlags} />
          )}
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
  openFlags,
  onSelectZone,
  onCursor,
  onClear,
}: {
  zones: GeoZone[];
  stageFilter: MockStage | null;
  selectedKey: string | null;
  cursor: string | null;
  openFlags: (room: GeoRoom) => string[];
  onSelectZone: (z: GeoZone) => void;
  onCursor: (z: GeoZone, guid: string) => void;
  onClear: () => void;
}) {
  const bounds = useMemo<Bounds | null>(() => {
    if (zones.length === 0) return null;
    let b: Bounds = zones[0]!.zone.bounds;
    for (const z of zones) {
      b = mergeBounds(b, z.zone.bounds);
      for (const r of z.rooms) if (r.outer) b = mergeBounds(b, boundsOf([r.outer]));
      for (const s of z.residues) b = mergeBounds(b, boundsOf([s.outer]));
    }
    return b;
  }, [zones]);

  if (!bounds)
    return (
      <div className="flex min-h-0 flex-[5] items-center justify-center text-xs text-muted-foreground">
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
    <div className="relative min-h-0 flex-[5] overflow-hidden bg-card">
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

        {zones.map((z) => {
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
                const open = openFlags(room).length;
                const review = reviewOf(room, open);
                const isCursor = room.guid === cursor;
                const tone = isCursor ? "var(--primary)" : REVIEW_TONE[review];
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
                      <title>{`${room.name} — ${room.sqft} sf (no detected boundary)`}</title>
                    </circle>
                  );
                return (
                  <g key={room.guid} className="cursor-pointer" onClick={click}>
                    <path
                      d={pathD([room.outer, ...room.holes], bounds)}
                      fillRule="evenodd"
                      fill={`color-mix(in srgb, ${tone} ${isCursor ? 34 : 13}%, transparent)`}
                      stroke={tone}
                      strokeOpacity={0.85}
                      strokeWidth={isCursor ? 2.5 : review === "open" ? 1.5 : 1}
                      strokeDasharray={review === "open" && !isCursor ? "4 2.5" : undefined}
                      vectorEffect="non-scaling-stroke"
                    >
                      <title>{`${room.name} — ${room.sqft} sf · ${review}`}</title>
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
        <Swatch tone={REVIEW_TONE.settled} label="settled" />
        <Swatch tone={REVIEW_TONE.open} label="open decision" dashed />
        <Swatch tone={REVIEW_TONE.synced} label="in .r10" />
        <Swatch tone="var(--muted-foreground)" label="held residue" dashed />
        <Swatch tone="var(--primary)" label="cursor" />
      </div>
    </div>
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

// ── Table row ───────────────────────────────────────────────────────────────

const cellNum = "border-b border-l border-[var(--line-soft)] p-0";
const cellRead =
  "tele whitespace-nowrap border-b border-l border-[var(--line-soft)] px-1.5 text-right";

function TableRow({
  zone,
  room,
  open,
  cursor,
  rowRef,
  onFocus,
  onPatch,
}: {
  zone: GeoZone;
  room: GeoRoom;
  open: string[];
  cursor: boolean;
  rowRef: (el: HTMLTableRowElement | null) => void;
  onFocus: () => void;
  onPatch: (p: RoomEdit) => void;
}) {
  const drifted = room.r10 !== null && room.r10.lastSyncedSqft !== room.sqft;
  const d = room.data;
  const na = <span className="tele block px-1.5 text-right text-muted-foreground/50">—</span>;

  return (
    <tr
      ref={rowRef}
      className={cn("h-7 scroll-mt-8 hover:bg-muted/60", cursor && "bg-primary/[0.06]")}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onFocus();
      }}
    >
      <td className="whitespace-nowrap border-b border-[var(--line-soft)] px-1.5">
        <StageTicks stage={zone.stage} />
      </td>
      <td className="tele whitespace-nowrap border-b border-l border-[var(--line-soft)] px-1.5">
        <span
          className="mr-1 inline-block size-2 rounded-[1px] align-middle"
          style={{ background: `rgb(${zone.zone.color})` }}
        />
        {zone.zone.key}
      </td>
      <td className={cn(cellNum, "min-w-40")}>
        <TextCell value={room.name} onCommit={(v) => onPatch({ name: v })} className="text-left" />
      </td>
      <td className={cn(cellNum, "w-32")}>
        <CellSelect value={room.type} onChange={(v) => onPatch({ type: v as RoomType })}>
          {ROOM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </CellSelect>
      </td>
      {/* Machine-measured: geometry edits happen in Revit, never here. */}
      <td
        className={cn(cellRead, "w-16 tabular-nums")}
        title={`detected area — source ${room.provenance.sourceSqft} sf, run ${room.provenance.runId}`}
      >
        {room.sqft}
      </td>
      <td className={cn(cellNum, "w-14")}>
        <NumberCell
          value={room.ceilingFt}
          digits={1}
          min={0}
          onCommit={(v) => onPatch({ ceilingFt: v })}
        />
      </td>
      <td className={cn(cellNum, "w-12")}>
        {d ? (
          <NumberCell value={d.people} integer min={0} onCommit={(v) => onPatch({ people: v })} />
        ) : (
          na
        )}
      </td>
      <td className={cn(cellNum, "w-16")}>
        {d ? (
          <NumberCell
            value={d.lightingW}
            digits={0}
            min={0}
            onCommit={(v) => onPatch({ lightingW: v })}
          />
        ) : (
          na
        )}
      </td>
      <td className={cn(cellNum, "w-16")}>
        {d ? (
          <NumberCell
            value={d.equipSensible}
            digits={0}
            min={0}
            onCommit={(v) => onPatch({ equipSensible: v })}
          />
        ) : (
          na
        )}
      </td>
      <td className={cn(cellNum, "w-16")}>
        {d ? (
          <NumberCell
            value={d.equipLatent}
            digits={0}
            min={0}
            onCommit={(v) => onPatch({ equipLatent: v })}
          />
        ) : (
          na
        )}
      </td>
      <td className={cn(cellNum, "w-16")}>
        {d ? (
          <NumberCell
            value={d.ventilationCfm}
            digits={0}
            min={0}
            onCommit={(v) => onPatch({ ventilationCfm: v })}
          />
        ) : (
          na
        )}
      </td>
      <td className="whitespace-nowrap border-b border-l border-[var(--line-soft)] px-1.5">
        {open.length > 0 ? (
          <span className="tele text-cat-clay" title={open.join(", ")}>
            {open.length} open
          </span>
        ) : room.decisions.length > 0 ? (
          <span className="tele text-muted-foreground">{room.decisions.length} decided</span>
        ) : null}
      </td>
      <td className="whitespace-nowrap border-b border-l border-[var(--line-soft)] px-1.5">
        {room.r10 ? (
          drifted ? (
            <span className="tele text-cat-clay">
              drift {room.sqft - room.r10.lastSyncedSqft > 0 ? "+" : ""}
              {room.sqft - room.r10.lastSyncedSqft} sf
            </span>
          ) : (
            <span className="tele text-cat-blue">#{room.r10.identifier}</span>
          )
        ) : (
          <span className="tele text-muted-foreground/50">—</span>
        )}
      </td>
    </tr>
  );
}

// ── Right rail cards ────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-[var(--line-soft)] py-0.5">
      <span className="tele-label shrink-0 text-muted-foreground">{label}</span>
      <span className="tele min-w-0 truncate text-right">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border px-3 py-2">
      <h3 className="section-label mb-1 text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function nextAction(zone: GeoZone, open: number): string {
  switch (zone.stage) {
    case "declared":
      return "type a system tag on the Zoning Region (step 2)";
    case "registered":
      return "run the partition to materialize rooms (step 3)";
    case "partitioned":
      return open > 0 ? `clear ${open} open decision${open === 1 ? "" : "s"} (step 4)` : "review clean — enter Manual J data";
    case "reviewed":
      return "enter Manual J data (step 5)";
    case "data":
      return "export to the .r10 (step 6)";
    case "synced":
      return "nothing pending";
    case "drifted":
      return `re-sync — ${zone.driftSqft} sf of hand-edit drift since last export`;
  }
}

function RoomCard({
  zone,
  room,
  open,
  decided,
  onDecide,
}: {
  zone: GeoZone;
  room: GeoRoom;
  open: string[];
  decided: Record<string, Verdict>;
  onDecide: (room: GeoRoom, flag: string, verb: Verdict) => void;
}) {
  const local = room.flags
    .map((f) => ({ flag: f, verb: decided[flagKey(room.guid, f)] }))
    .filter((x): x is { flag: string; verb: Verdict } => x.verb !== undefined);

  return (
    <>
      <Section title="cursor room">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="font-pe-display text-base font-semibold tracking-tight">{room.name}</span>
          <span className="tele text-muted-foreground">{shortId(room.guid)}</span>
        </div>
        <Field label="zone">
          {zone.zone.key} · {zone.name}
        </Field>
        <Field label="stage">
          <StageTicks stage={zone.stage} className="mr-1" />
          {zone.stage}
        </Field>
        <Field label="type">{room.type}</Field>
        <Field label="area">{room.sqft} sf</Field>
        <Field label="ceiling">{fmtNum(room.ceilingFt, 1)} ft</Field>
        <Field label="boundary">
          {room.outer ? `${room.outer.length} pts detected` : "no polygon — dot only"}
        </Field>
      </Section>

      <Section title="provenance">
        <Field label="run">{room.provenance.runId}</Field>
        <Field label="source sf">{room.provenance.sourceSqft}</Field>
        <Field label="guid">{room.guid}</Field>
        <Field label=".r10">
          {room.r10
            ? `#${room.r10.identifier} · synced ${room.r10.syncedAt.slice(0, 10)} at ${room.r10.lastSyncedSqft} sf`
            : "never exported"}
        </Field>
        {room.decisions.length === 0 && local.length === 0 ? (
          <p className="tele mt-1 text-muted-foreground">no decision receipts on this room</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {room.decisions.map((d) => (
              <li key={d.flag} className="tele text-muted-foreground">
                <span className={d.verb === "accept" ? "text-cat-blue" : "text-cat-clay"}>
                  {d.verb}
                </span>{" "}
                {d.flag} · {d.at.slice(0, 10)} · {d.runId}
              </li>
            ))}
            {local.map((d) => (
              <li key={d.flag} className="tele text-muted-foreground">
                <span className={d.verb === "accept" ? "text-cat-blue" : "text-cat-clay"}>
                  {d.verb}
                </span>{" "}
                {d.flag} · <span className="text-cat-clay">this session</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`open flags — ${open.length}`}>
        {open.length === 0 ? (
          <p className="tele text-muted-foreground">nothing to decide here.</p>
        ) : (
          <ul className="space-y-1.5">
            {open.map((flag) => (
              <li key={flag} className="rounded-[var(--radius)] border border-[var(--line)] p-1.5">
                <div className="tele mb-1 text-cat-clay">{flag}</div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="tele flex-1 rounded-[var(--radius)] border border-[var(--line-2)] px-2 py-0.5 hover:bg-muted"
                    onClick={() => onDecide(room, flag, "accept")}
                  >
                    accept <span className="opacity-50">a</span>
                  </button>
                  <button
                    type="button"
                    className="tele flex-1 rounded-[var(--radius)] border border-[var(--line-2)] px-2 py-0.5 hover:bg-muted"
                    onClick={() => onDecide(room, flag, "dismiss")}
                  >
                    dismiss <span className="opacity-50">d</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Seam className="mt-2">
          verbs write through to the Room Region provenance blob; here they are local only
        </Seam>
      </Section>

      <ClosureSection zone={zone} />
    </>
  );
}

function ZoneCard({
  zone,
  open,
  world,
  openFlags,
}: {
  zone: GeoZone;
  open: number;
  world: { systems: { tag: string; zoneKeys: string[]; sensibleBtuh: number; overCap: boolean }[] };
  openFlags: (room: GeoRoom) => string[];
}) {
  void openFlags;
  const systems = world.systems.filter((s) => s.zoneKeys.includes(zone.zone.key));
  return (
    <>
      <Section title="selected zone">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="font-pe-display text-base font-semibold tracking-tight">{zone.name}</span>
          <span className="tele text-muted-foreground">{zone.zone.key}</span>
        </div>
        <Field label="stage">
          <StageTicks stage={zone.stage} className="mr-1" />
          {zone.stage}
        </Field>
        <Field label="level">{zone.zone.lane.label}</Field>
        <Field label="declared">{fmtNum(zone.zone.declaredSqft, 0)} sf</Field>
        <Field label="rooms">{zone.rooms.length}</Field>
        <Field label="open">{open}</Field>
        <Field label="tags">{zone.tags.join(", ") || "none"}</Field>
        <Field label="guid">{zone.zone.guid}</Field>
      </Section>

      {systems.length > 0 && (
        <Section title="systems">
          {systems.map((s) => (
            <Field key={s.tag} label={s.tag}>
              <span className={s.overCap ? "text-cat-clay" : undefined}>
                {fmtNum(s.sensibleBtuh, 0)} Btu/h sensible
                {s.overCap && ` — over ${SENSIBLE_CAP_BTUH.toLocaleString()} cap`}
              </span>
            </Field>
          ))}
        </Section>
      )}

      <ClosureSection zone={zone} />

      <Section title="next action">
        <p className="text-xs">{nextAction(zone, open)}</p>
      </Section>
    </>
  );
}

/** Accounting closure — declared area must be fully accounted for: rooms + claimed wall band +
 *  held residue + excluded. A zone that does not close is not reviewable. */
function ClosureSection({ zone }: { zone: GeoZone }) {
  const run = zone.runs[zone.runs.length - 1];
  if (!run)
    return (
      <Section title="accounting closure">
        <p className="tele text-muted-foreground">no partition run yet — nothing to close.</p>
      </Section>
    );
  const accounted = run.roomSqft + run.claimedWallSqft + zone.heldSqft + run.excludedSqft;
  const residual = run.declaredSqft - accounted;
  const closed = Math.abs(residual) < 1;
  return (
    <Section title="accounting closure">
      <p className="tele leading-relaxed">
        {fmtNum(run.roomSqft, 0)} rooms + {fmtNum(run.claimedWallSqft, 0)} wall +{" "}
        {fmtNum(zone.heldSqft, 0)} held + {fmtNum(run.excludedSqft, 0)} excluded ={" "}
        {fmtNum(accounted, 0)} of {fmtNum(run.declaredSqft, 0)} declared
      </p>
      <p className={cn("tele mt-1", closed ? "text-cat-blue" : "text-cat-clay")}>
        {closed ? "closed — residual < 1 sf" : `residual ${fmtNum(residual, 1)} sf unaccounted`}
      </p>
      <Field label="run">{run.runId}</Field>
      <Field label="census">
        {run.created} created · {run.rebound} rebound · {run.held} held · {run.orphaned} orphaned
      </Field>
    </Section>
  );
}

function HouseCard({
  world,
  zones,
  openFlags,
}: {
  world: { docName: string; r10Path: string; systems: { tag: string; overCap: boolean }[] };
  zones: GeoZone[];
  openFlags: (room: GeoRoom) => string[];
}) {
  const rooms = zones.reduce((n, z) => n + z.rooms.length, 0);
  const open = zones.reduce((n, z) => n + z.rooms.reduce((m, r) => m + openFlags(r).length, 0), 0);
  const declared = zones.reduce((s, z) => s + z.zone.declaredSqft, 0);
  const over = world.systems.filter((s) => s.overCap);
  const worst = [...zones]
    .map((z) => ({ z, open: z.rooms.reduce((m, r) => m + openFlags(r).length, 0) }))
    .filter((x) => x.open > 0)
    .sort((a, b) => b.open - a.open)
    .slice(0, 6);

  return (
    <>
      <Section title="whole house">
        <p className="tele mb-1 text-muted-foreground">
          Nothing selected — the table is showing everything in the current filter.
        </p>
        <Field label="zones">{zones.length}</Field>
        <Field label="rooms">{rooms}</Field>
        <Field label="declared">{fmtNum(declared, 0)} sf</Field>
        <Field label="open">{open}</Field>
        <Field label="doc">{world.docName}</Field>
      </Section>

      {over.length > 0 && (
        <Section title="cap violations">
          <p className="tele text-cat-clay">
            {over.map((s) => s.tag).join(", ")} exceed {SENSIBLE_CAP_BTUH.toLocaleString()} Btu/h
            sensible.
          </p>
        </Section>
      )}

      <Section title="heaviest review debt">
        {worst.length === 0 ? (
          <p className="tele text-muted-foreground">no open decisions in this filter.</p>
        ) : (
          <ul className="space-y-0.5">
            {worst.map(({ z, open: n }) => (
              <li key={z.zone.key} className="flex items-center gap-1.5">
                <StageTicks stage={z.stage} />
                <span className="tele">{z.zone.key}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {z.name}
                </span>
                <span className="tele text-cat-clay">{n}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="how to drive this">
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          <li>Click a zone on the plan to scope everything to it.</li>
          <li>Click a room to put the cursor on it; the rail follows.</li>
          <li>
            <span className="tele">j</span>/<span className="tele">k</span> move the cursor,{" "}
            <span className="tele">a</span>/<span className="tele">d</span> accept/dismiss,{" "}
            <span className="tele">Esc</span> returns to the whole house.
          </li>
        </ul>
      </Section>
    </>
  );
}
