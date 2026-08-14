/** PROTOTYPE — variant "zones": zone-first workbench. */
/**
 * The zone is the unit of everything.
 *
 * There is no page of global steps here: the seven pipeline steps are re-cut as ONE zone's
 * lifecycle, and the designer lives in one zone at a time. Three fixed panes, none of which
 * scrolls the others — index (left), plan (center), lifecycle (right). Progress is read off the
 * stage strip at the top, not off a scrollbar position.
 *
 * Laws it embodies: two verbs only (accept takes the recalc's proposal, dismiss keeps the
 * designer's state); geometry is drawn and reshaped in Revit, never here; nothing on this page
 * applies anything — the next action names the op it WOULD run; accounting closes per zone and
 * is shown, not absorbed; every datum names its one home.
 *
 * Read-only mock (src/takeoff/proto/mock.ts). No host imports, no network.
 */
import { Check, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";
import { fmtNum } from "#/rhvac/cells";
import { LEVEL_LANES, boundsOf, mergeBounds, pathD, type Bounds } from "#/takeoff/model";
import {
  STAGE_ORDER,
  mockWorld,
  type MockRoom,
  type MockStage,
  type MockZone,
} from "#/takeoff/proto/mock";
import { Live, Seam } from "#/takeoff/seam";
import { ZoneThumb } from "#/takeoff/zone-plan";

// ── Stage vocabulary ────────────────────────────────────────────────────────
// One hue per stage, straight off the categorical palette. Color reinforces the ordering that
// position already establishes — the strip reads left-to-right whether or not you see color.

interface StageMeta {
  /** SVG-usable color token. */
  color: string;
  text: string;
  chip: string;
  note: string;
}

const STAGE_META: Record<MockStage, StageMeta> = {
  declared: {
    color: "var(--cat-kiln)",
    text: "text-cat-kiln",
    chip: "border-cat-kiln/25 bg-cat-kiln/12 text-cat-kiln",
    note: "drawn on the zoning view — no System tags typed yet",
  },
  registered: {
    color: "var(--cat-slate)",
    text: "text-cat-slate",
    chip: "border-cat-slate/25 bg-cat-slate/12 text-cat-slate",
    note: "tags resolved against the System registry",
  },
  partitioned: {
    color: "var(--cat-clay)",
    text: "text-cat-clay",
    chip: "border-cat-clay/25 bg-cat-clay/12 text-cat-clay",
    note: "rooms materialized — decisions open",
  },
  reviewed: {
    color: "var(--cat-lichen)",
    text: "text-cat-lichen",
    chip: "border-cat-lichen/25 bg-cat-lichen/12 text-cat-lichen",
    note: "every flag answered; nothing pending",
  },
  data: {
    color: "var(--cat-blue)",
    text: "text-cat-blue",
    chip: "border-cat-blue/25 bg-cat-blue/12 text-cat-blue",
    note: "Manual J data entered, not exported",
  },
  synced: {
    color: "var(--cat-green)",
    text: "text-cat-green",
    chip: "border-cat-green/25 bg-cat-green/12 text-cat-green",
    note: "rooms linked into the .r10",
  },
  drifted: {
    color: "var(--destructive)",
    text: "text-destructive",
    chip: "border-destructive/30 bg-destructive/10 text-destructive",
    note: "hand edits in Revit since the last sync",
  },
};

/** Lifecycle position, 0–5. `drifted` is synced-with-a-problem, not a seventh rung. */
const progressOf = (stage: MockStage) =>
  stage === "drifted" ? 5 : Math.min(5, STAGE_ORDER.indexOf(stage));

// ── Local decisions (session state — the mock's stand-in for the blob write) ─

type Verb = "accept" | "dismiss";
const decisionKey = (zoneKey: string, roomGuid: string, flag: string) =>
  `${zoneKey}|${roomGuid}|${flag}`;

interface OpenFlag {
  room: MockRoom;
  flag: string;
}

/** Flags with no decision on the FR blob and none taken in this session. */
function openFlags(zone: MockZone, local: Record<string, Verb>): OpenFlag[] {
  const rows: OpenFlag[] = [];
  for (const room of zone.rooms)
    for (const flag of room.flags) {
      if (room.decisions.some((d) => d.flag === flag)) continue;
      if (local[decisionKey(zone.zone.key, room.guid, flag)]) continue;
      rows.push({ room, flag });
    }
  return rows;
}

const FLAG_MEANING: Record<string, string> = {
  seedless: "no seed room backs this space — verify it is a real room",
  "suspect:narrow": "narrow enough that the boundary may be a wall band, not a room",
  "suspect:ceiling-variance": "ceiling height varies — chase, void, or vault",
  "low-evidence-boundary": "boundary placed on weak wall evidence",
};

// ── Next action ─────────────────────────────────────────────────────────────

interface NextAction {
  label: string;
  /** Who does it. `revit` actions are deliberately not buttons on this page. */
  owner: "op" | "you" | "revit";
  /** The op or surface it would reach, named so the button is never a mystery. */
  reaches: string;
  step: string;
}

function nextAction(zone: MockZone, open: number): NextAction {
  if (zone.stage === "drifted")
    return {
      label: `Re-partition — ${fmtNum(zone.driftSqft, 0)} sf drifted`,
      owner: "op",
      reaches: "takeoff.partition (proposal diff — nothing auto-applies)",
      step: "partition",
    };
  if (open > 0)
    return {
      label: `Review ${open} open decision${open === 1 ? "" : "s"}`,
      owner: "you",
      reaches: "provenance blob on each Room Region FR",
      step: "review",
    };
  switch (zone.stage) {
    case "declared":
      return {
        label: "Type System tags on the Zoning Region",
        owner: "revit",
        reaches: "Zoning Region FR + Pe params",
        step: "declare",
      };
    case "registered":
      return {
        label: "Partition this zone",
        owner: "op",
        reaches: "takeoff.partition → Room Region + held FRs",
        step: "partition",
      };
    case "partitioned":
      return {
        label: "Close review for this zone",
        owner: "you",
        reaches: "provenance blob on each Room Region FR",
        step: "review",
      };
    case "reviewed":
      return {
        label: "Enter Manual J room data",
        owner: "you",
        reaches: "the .r10 (via the grid)",
        step: "data",
      };
    case "data":
      return {
        label: "Export to the .r10",
        owner: "op",
        reaches: "rhvac.sync — copy → validate → atomic swap",
        step: "export",
      };
    default:
      return {
        label: "In sync — reconcile report only",
        owner: "op",
        reaches: "takeoff.reconcile (writes nothing)",
        step: "reconcile",
      };
  }
}

// ── Root ────────────────────────────────────────────────────────────────────

export function Variant() {
  const world = useMemo(() => mockWorld(), []);
  const [selectedKey, setSelectedKey] = useState(world.zones[0]?.zone.key ?? "");
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<MockStage | null>(null);
  const [local, setLocal] = useState<Record<string, Verb>>({});
  /** Honest echo of a click: names the op it would run, and applies nothing. */
  const [pending, setPending] = useState<string | null>(null);

  const selected = world.zones.find((z) => z.zone.key === selectedKey) ?? world.zones[0]!;
  const lane = selected.zone.lane;
  const laneZones = world.zones.filter((z) => z.zone.lane.view === lane.view);

  const open = openFlags(selected, local);
  const action = nextAction(selected, open.length);

  const decide = (room: MockRoom, flag: string, verb: Verb) => {
    setLocal((prev) => ({ ...prev, [decisionKey(selected.zone.key, room.guid, flag)]: verb }));
    setPending(
      `${verb} · ${room.name} · ${flag} — would write through to the Room Region blob before the row reads as decided`,
    );
  };

  const select = (key: string) => {
    setSelectedKey(key);
    setPending(null);
  };

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background">
      <Header world={world} selected={selected} action={action} />
      <StageStrip
        zones={world.zones}
        local={local}
        filter={stageFilter}
        onFilter={(s) => setStageFilter((prev) => (prev === s ? null : s))}
      />

      <div className="flex min-h-0 flex-1">
        <ZoneIndex
          zones={world.zones}
          local={local}
          selectedKey={selected.zone.key}
          hoverKey={hoverKey}
          filter={stageFilter}
          onSelect={select}
          onHover={setHoverKey}
        />

        <section className="flex min-w-0 flex-1 flex-col border-r border-[var(--line)]">
          <LevelPlan
            zones={laneZones}
            selectedKey={selected.zone.key}
            hoverKey={hoverKey}
            local={local}
            onSelect={select}
            onHover={setHoverKey}
          />
          <PlanFooter zones={laneZones} laneLabel={lane.label} view={lane.view} />
        </section>

        <ZoneLifecycle
          zone={selected}
          open={open}
          action={action}
          pending={pending}
          onDecide={decide}
          onAct={(a) =>
            setPending(
              a.owner === "revit"
                ? `${a.label} — happens in Revit. This page never edits geometry.`
                : `would call ${a.reaches} for ${selected.zone.key} — prototype applies nothing`,
            )
          }
        />
      </div>
    </main>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function Header({
  world,
  selected,
  action,
}: {
  world: ReturnType<typeof mockWorld>;
  selected: MockZone;
  action: NextAction;
}) {
  const url = `/takeoff?zone=${encodeURIComponent(selected.zone.key)}&step=${action.step}`;
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--line)] px-4 py-2">
      <h1 className="font-pe-display text-lg font-semibold tracking-tight">Takeoff</h1>
      <span className="text-xs text-muted-foreground">
        one zone at a time — the pipeline is this zone&rsquo;s lifecycle
      </span>
      <Live>{world.docName}</Live>
      <span className="tele text-muted-foreground">{world.r10Path}</span>
      <span className="ml-auto flex items-center gap-1.5">
        <span className="tele-label text-muted-foreground">route</span>
        <code className="tele rounded-[var(--radius)] border border-[var(--line)] bg-muted/60 px-1.5 py-0.5 text-foreground">
          {url}
        </code>
        <Seam className="max-w-72">
          proposed URL shape — zone + step are the whole address of the workbench; this prototype
          does not wire the search params
        </Seam>
      </span>
    </header>
  );
}

// ── Progress strip ──────────────────────────────────────────────────────────

/**
 * Progress at a glance: one proportional bar over all 45 zones, split by stage, with the count
 * of open decisions riding above it. Clicking a stage narrows the index rail to it.
 */
function StageStrip({
  zones,
  local,
  filter,
  onFilter,
}: {
  zones: MockZone[];
  local: Record<string, Verb>;
  filter: MockStage | null;
  onFilter: (stage: MockStage) => void;
}) {
  const counts = STAGE_ORDER.map((stage) => ({
    stage,
    zones: zones.filter((z) => z.stage === stage),
  }));
  const total = zones.length;
  const openTotal = zones.reduce((n, z) => n + openFlags(z, local).length, 0);
  const sqft = zones.reduce((s, z) => s + z.zone.declaredSqft, 0);

  return (
    <div className="border-b border-[var(--line)] px-4 py-2">
      <div className="flex items-baseline gap-x-3">
        <span className="section-label">project progress</span>
        <span className="tele text-muted-foreground">
          {total} zones · {fmtNum(sqft, 0)} sf declared ·{" "}
          <span className={openTotal ? "text-cat-clay" : "text-cat-green"}>
            {openTotal} decisions open
          </span>
        </span>
        {filter && (
          <button
            type="button"
            className="tele text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => onFilter(filter)}
          >
            clear filter
          </button>
        )}
      </div>

      <div className="mt-1.5 flex h-2 gap-px overflow-hidden rounded-[var(--radius)]">
        {counts.map(({ stage, zones: group }) => (
          <button
            key={stage}
            type="button"
            title={`${group.length} ${stage}`}
            aria-label={`${group.length} zones ${stage}`}
            className={cn(
              "h-full min-w-[2px] transition-opacity",
              filter && filter !== stage ? "opacity-25" : "opacity-100",
            )}
            style={{
              flexGrow: Math.max(group.length, 0.35),
              background: STAGE_META[stage].color,
            }}
            onClick={() => onFilter(stage)}
          />
        ))}
      </div>

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
        {counts.map(({ stage, zones: group }) => (
          <button
            key={stage}
            type="button"
            className={cn(
              "flex items-baseline gap-1 transition-opacity",
              filter && filter !== stage && "opacity-40",
            )}
            onClick={() => onFilter(stage)}
          >
            <span
              className="inline-block size-1.5 translate-y-px rounded-[1px]"
              style={{ background: STAGE_META[stage].color }}
            />
            <span className="tele-label text-muted-foreground">{stage}</span>
            <span className={cn("tele", STAGE_META[stage].text)}>{group.length}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Left: the zone index ────────────────────────────────────────────────────

function ZoneIndex({
  zones,
  local,
  selectedKey,
  hoverKey,
  filter,
  onSelect,
  onHover,
}: {
  zones: MockZone[];
  local: Record<string, Verb>;
  selectedKey: string;
  hoverKey: string | null;
  filter: MockStage | null;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
}) {
  return (
    <nav className="w-[19.5rem] shrink-0 overflow-y-auto border-r border-[var(--line)]">
      {LEVEL_LANES.map((lane) => {
        const laneZones = zones.filter((z) => z.zone.lane.view === lane.view);
        const laneOpen = laneZones.reduce((n, z) => n + openFlags(z, local).length, 0);
        return (
          <div key={lane.view}>
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--line)] bg-background/95 px-2 py-1 backdrop-blur">
              <span className="section-label text-foreground">{lane.label}</span>
              <span className="tele text-muted-foreground">{laneZones.length}</span>
              <span className="flex flex-1 gap-px">
                {laneZones.map((z) => (
                  <span
                    key={z.zone.key}
                    className="h-1.5 flex-1"
                    style={{ background: STAGE_META[z.stage].color }}
                  />
                ))}
              </span>
              {laneOpen > 0 && <span className="tele text-cat-clay">{laneOpen}</span>}
            </div>

            <ul className="divide-y divide-[var(--line-soft)]">
              {laneZones.map((z) => {
                const open = openFlags(z, local).length;
                const dim = filter !== null && z.stage !== filter;
                const active = z.zone.key === selectedKey;
                return (
                  <li key={z.zone.key}>
                    <button
                      type="button"
                      onClick={() => onSelect(z.zone.key)}
                      onMouseEnter={() => onHover(z.zone.key)}
                      onMouseLeave={() => onHover(null)}
                      className={cn(
                        "flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors",
                        active && "bg-primary/[0.07]",
                        !active && hoverKey === z.zone.key && "bg-muted/60",
                        dim && "opacity-35",
                      )}
                    >
                      <span
                        className="h-8 w-0.5 shrink-0"
                        style={{ background: active ? "var(--primary)" : STAGE_META[z.stage].color }}
                      />
                      <ZoneThumb zone={z.zone} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5">
                          <span className="tele shrink-0">{z.zone.key}</span>
                          <span className="truncate text-xs text-muted-foreground">{z.name}</span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-1">
                          <span
                            className={cn(
                              "tele-label rounded-[var(--radius)] border px-1",
                              STAGE_META[z.stage].chip,
                            )}
                          >
                            {z.stage}
                          </span>
                          {z.tags.map((t) => (
                            <Badge key={t} variant="slate" className="tele px-1 py-0">
                              {t}
                            </Badge>
                          ))}
                          <span className="tele ml-auto text-muted-foreground">
                            {fmtNum(z.zone.declaredSqft, 0)} sf
                          </span>
                        </span>
                      </span>
                      {open > 0 && (
                        <span className="tele shrink-0 rounded-[var(--radius)] border border-cat-clay/30 bg-cat-clay/12 px-1 text-cat-clay">
                          {open}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

// ── Center: the level plan ──────────────────────────────────────────────────

/**
 * Every zone of the selected level in ONE frame (merged bounds, Y-flipped once) — a zone's
 * position on screen is its position in the model. The selected zone is emphasized and shows its
 * rooms as labelled dots; nothing here is editable.
 */
function LevelPlan({
  zones,
  selectedKey,
  hoverKey,
  local,
  onSelect,
  onHover,
}: {
  zones: MockZone[];
  selectedKey: string;
  hoverKey: string | null;
  local: Record<string, Verb>;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
}) {
  const bounds = useMemo<Bounds>(() => {
    const boxes = zones.map((z) => z.zone.bounds);
    return boxes.length === 0
      ? boundsOf([[[0, 0] as [number, number]]])
      : boxes.reduce((a, b) => mergeBounds(a, b));
  }, [zones]);

  const w = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const h = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const pad = Math.max(w, h) * 0.04;
  const font = Math.max(w, h) / 105;
  const dot = Math.max(w, h) / 320;
  const flip = (y: number) => bounds.minY + bounds.maxY - y;
  const selected = zones.find((z) => z.zone.key === selectedKey) ?? null;

  return (
    <div className="min-h-0 flex-1 bg-card">
      <svg
        viewBox={`${bounds.minX - pad} ${bounds.minY - pad} ${w + pad * 2} ${h + pad * 2}`}
        preserveAspectRatio="xMidYMid meet"
        className="size-full"
      >
        <title>{`${zones[0]?.zone.lane.label ?? ""} level — zones by lifecycle stage`}</title>

        {zones.map((z) => {
          const active = z.zone.key === selectedKey;
          const hovered = z.zone.key === hoverKey;
          const meta = STAGE_META[z.stage];
          return (
            <g
              key={z.zone.key}
              className="cursor-pointer"
              onClick={() => onSelect(z.zone.key)}
              onMouseEnter={() => onHover(z.zone.key)}
              onMouseLeave={() => onHover(null)}
            >
              <path
                d={pathD(z.zone.loops, bounds)}
                fillRule="evenodd"
                fill={`color-mix(in srgb, ${meta.color} ${active ? 34 : hovered ? 24 : 14}%, transparent)`}
                stroke={active ? "var(--primary)" : meta.color}
                strokeWidth={active ? 2.4 : hovered ? 1.6 : 0.9}
                strokeOpacity={active ? 1 : 0.75}
                vectorEffect="non-scaling-stroke"
              />
              {!active && (
                <text
                  x={(z.zone.bounds.minX + z.zone.bounds.maxX) / 2}
                  y={flip((z.zone.bounds.minY + z.zone.bounds.maxY) / 2)}
                  textAnchor="middle"
                  fontSize={font}
                  fill="var(--foreground)"
                  fillOpacity={0.5}
                  className="pointer-events-none select-none"
                >
                  {z.zone.key}
                </text>
              )}
            </g>
          );
        })}

        {/* Selected zone, on top: key + rooms as labelled dots (rooms carry label points, not
            polygons — the mock is honest that room geometry lives in Revit). */}
        {selected && (
          <g className="pointer-events-none">
            <text
              x={(selected.zone.bounds.minX + selected.zone.bounds.maxX) / 2}
              y={flip(selected.zone.bounds.maxY) - font * 0.5}
              textAnchor="middle"
              fontSize={font * 1.25}
              fontWeight={600}
              fill="var(--primary)"
            >
              {selected.zone.key} · {selected.name}
            </text>
            {selected.rooms.map((room) => {
              const openHere = room.flags.some(
                (f) =>
                  !room.decisions.some((d) => d.flag === f) &&
                  !local[decisionKey(selected.zone.key, room.guid, f)],
              );
              const tone = openHere ? "var(--cat-clay)" : "var(--primary)";
              return (
                <g key={room.guid}>
                  <circle
                    cx={room.label[0]}
                    cy={flip(room.label[1])}
                    r={dot}
                    fill={tone}
                    fillOpacity={openHere ? 0.9 : 0.55}
                    stroke={tone}
                    strokeWidth={openHere ? 1.4 : 0.8}
                    strokeDasharray={openHere ? "2 1.5" : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={room.label[0]}
                    y={flip(room.label[1]) + font * 1.35}
                    textAnchor="middle"
                    fontSize={font * 0.82}
                    fill="var(--foreground)"
                    className="select-none"
                  >
                    <tspan x={room.label[0]}>{room.name}</tspan>
                    <tspan x={room.label[0]} dy={font} fillOpacity={0.6}>
                      {fmtNum(room.sqft, 0)} sf
                    </tspan>
                  </text>
                </g>
              );
            })}
          </g>
        )}
      </svg>
    </div>
  );
}

function PlanFooter({
  zones,
  laneLabel,
  view,
}: {
  zones: MockZone[];
  laneLabel: string;
  view: string;
}) {
  const present = STAGE_ORDER.filter((s) => zones.some((z) => z.stage === s));
  return (
    <div className="space-y-1 border-t border-[var(--line)] px-3 py-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="section-label">{laneLabel} level</span>
        {present.map((stage) => (
          <span key={stage} className="tele inline-flex items-center gap-1 text-muted-foreground">
            <span
              className="inline-block size-2.5 rounded-[1px] border"
              style={{
                background: `color-mix(in srgb, ${STAGE_META[stage].color} 18%, transparent)`,
                borderColor: STAGE_META[stage].color,
              }}
            />
            {stage}
          </span>
        ))}
        <span className="tele inline-flex items-center gap-1 text-muted-foreground">
          <span className="inline-block size-2 rounded-full border border-dashed border-cat-clay bg-cat-clay/50" />
          room with an open decision
        </span>
      </div>
      <p className="tele text-muted-foreground">
        {view} · read-only. Shapes change in Revit&rsquo;s sketch editor; this plan is an index,
        never a drawing tool.
      </p>
    </div>
  );
}

// ── Right: this zone's lifecycle ────────────────────────────────────────────

interface StepDef {
  n: string;
  title: string;
  owner: string;
  home: string;
  /** Lifecycle position at which this step reads as done. */
  doneAt: number;
}

const STEPS: StepDef[] = [
  { n: "1", title: "Declare zone", owner: "designer", home: "Zoning Region FR", doneAt: 0 },
  { n: "2", title: "Validate + register", owner: "op", home: "System registry blob", doneAt: 1 },
  { n: "3", title: "Partition", owner: "op", home: "Room Region + held FRs", doneAt: 2 },
  { n: "4", title: "Edit + review", owner: "designer", home: "provenance blob", doneAt: 3 },
  { n: "5", title: "Room data", owner: "designer", home: "the .r10", doneAt: 4 },
  { n: "6", title: "Export", owner: "op", home: "the .r10", doneAt: 5 },
  { n: "7", title: "Reconcile", owner: "op", home: "report only", doneAt: 6 },
];

function ZoneLifecycle({
  zone,
  open,
  action,
  pending,
  onDecide,
  onAct,
}: {
  zone: MockZone;
  open: OpenFlag[];
  action: NextAction;
  pending: string | null;
  onDecide: (room: MockRoom, flag: string, verb: Verb) => void;
  onAct: (action: NextAction) => void;
}) {
  const progress = progressOf(zone.stage);
  const roomSqft = zone.rooms.reduce((s, r) => s + r.sqft, 0);
  const run = zone.runs[zone.runs.length - 1] ?? null;
  const withData = zone.rooms.filter((r) => r.data !== null).length;
  const linked = zone.rooms.filter((r) => r.r10 !== null).length;
  /** A step is "now" when it is the first one this zone has not finished. */
  const nowStep = STEPS.find((s) => s.doneAt > progress || (s.doneAt === 3 && open.length > 0));

  return (
    <aside className="flex w-[30rem] shrink-0 flex-col overflow-y-auto">
      {/* Zone identity — every datum with its home named. */}
      <div className="space-y-1.5 border-b border-[var(--line)] px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="font-pe-display text-base font-semibold tracking-tight">
            {zone.zone.key}
          </h2>
          <span className="text-sm text-muted-foreground">{zone.name}</span>
          <span
            className={cn(
              "tele-label rounded-[var(--radius)] border px-1.5 py-px",
              STAGE_META[zone.stage].chip,
            )}
          >
            {zone.stage}
          </span>
        </div>
        <p className="tele text-muted-foreground">
          {fmtNum(zone.zone.declaredSqft, 0)} sf declared · {zone.rooms.length} rooms ·{" "}
          {zone.zone.guid.slice(0, 8)} · {STAGE_META[zone.stage].note}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {zone.tags.length === 0 ? (
            <span className="tele text-muted-foreground">no System tags typed</span>
          ) : (
            zone.tags.map((t) => (
              <Badge key={t} variant="slate" className="tele">
                {t}
              </Badge>
            ))
          )}
          <span className="tele ml-auto text-muted-foreground">{zone.zone.lane.view}</span>
        </div>
      </div>

      {/* The single next action. Owner decides whether it is a button at all. */}
      <div className="space-y-1 border-b border-[var(--line)] bg-muted/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="tele-label shrink-0 text-muted-foreground">next</span>
          <Button
            size="lg"
            variant={action.owner === "revit" ? "outline" : "default"}
            className="min-w-0 flex-1"
            onClick={() => onAct(action)}
          >
            <span className="truncate">{action.label}</span>
          </Button>
          <span
            className={cn(
              "tele-label shrink-0 rounded-[var(--radius)] border px-1 py-px",
              action.owner === "op" && "border-cat-blue/30 bg-cat-blue/12 text-cat-blue",
              action.owner === "you" && "border-cat-clay/30 bg-cat-clay/12 text-cat-clay",
              action.owner === "revit" && "border-[var(--line-2)] text-muted-foreground",
            )}
          >
            {action.owner === "revit" ? "in revit" : action.owner}
          </span>
        </div>
        <p className="tele text-muted-foreground">→ {action.reaches}</p>
        {pending && (
          <p className="tele rounded-[var(--radius)] border border-dashed border-cat-clay/45 bg-cat-clay/[0.06] px-1.5 py-0.5 text-foreground/75">
            {pending}
          </p>
        )}
      </div>

      {/* This zone's seven steps, as its own timeline. */}
      <ol className="px-3 py-2">
        {STEPS.map((step, i) => {
          const done = progress >= step.doneAt && !(step.doneAt === 3 && open.length > 0);
          const now = nowStep?.n === step.n;
          const last = i === STEPS.length - 1;
          return (
            <li key={step.n} className="relative flex gap-2.5 pb-2 last:pb-0">
              <span className="flex flex-col items-center">
                <span
                  className={cn(
                    "tele-label flex size-4 shrink-0 items-center justify-center rounded-[var(--radius)] border",
                    done && "border-cat-green/35 bg-cat-green/15 text-cat-green",
                    now && "border-primary bg-primary text-primary-foreground",
                    !done && !now && "border-[var(--line-2)] text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-2.5" /> : step.n}
                </span>
                {!last && <span className="mt-0.5 w-px flex-1 bg-[var(--line)]" />}
              </span>

              <div className="min-w-0 flex-1 pb-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      !done && !now && "text-muted-foreground",
                    )}
                  >
                    {step.title}
                  </span>
                  <span className="tele text-muted-foreground">
                    {step.owner} → {step.home}
                  </span>
                </div>
                <StepBody
                  step={step}
                  zone={zone}
                  open={open}
                  onDecide={onDecide}
                  roomSqft={roomSqft}
                  withData={withData}
                  linked={linked}
                  run={run}
                />
              </div>
            </li>
          );
        })}
      </ol>

      <RoomTable zone={zone} />
    </aside>
  );
}

/** Per-step evidence: what actually happened to THIS zone, with run ids and timestamps. */
function StepBody({
  step,
  zone,
  open,
  onDecide,
  roomSqft,
  withData,
  linked,
  run,
}: {
  step: StepDef;
  zone: MockZone;
  open: OpenFlag[];
  onDecide: (room: MockRoom, flag: string, verb: Verb) => void;
  roomSqft: number;
  withData: number;
  linked: number;
  run: MockZone["runs"][number] | null;
}) {
  const decided = zone.rooms.flatMap((r) => r.decisions.map((d) => ({ room: r, d })));

  switch (step.n) {
    case "1":
      return (
        <p className="tele mt-0.5 text-muted-foreground">
          {zone.zone.loops.length} loop{zone.zone.loops.length === 1 ? "" : "s"} ·{" "}
          {fmtNum(zone.zone.declaredSqft, 0)} sf (shoelace, even-odd) · type{" "}
          {zone.zone.typeName}
        </p>
      );
    case "2":
      return zone.tags.length === 0 ? (
        <p className="tele mt-0.5 text-cat-clay">no tags — the registry has nothing to resolve</p>
      ) : (
        <p className="tele mt-0.5 text-muted-foreground">
          {zone.tags.join(" · ")} resolved · rename-vs-new asked explicitly, never guessed
        </p>
      );
    case "3":
      return zone.runs.length === 0 ? (
        <p className="tele mt-0.5 text-muted-foreground">no run yet for this zone</p>
      ) : (
        <div className="mt-0.5 space-y-0.5">
          {zone.runs.map((r) => (
            <p key={r.runId} className="tele text-muted-foreground">
              <span className="text-foreground">{r.runId}</span> ·{" "}
              {r.at.slice(0, 16).replace("T", " ")} · created {r.created} · rebound {r.rebound} ·
              held {r.held} · orphaned {r.orphaned}
            </p>
          ))}
          {run && (
            <p className="tele">
              <span className="text-muted-foreground">accounting </span>
              {fmtNum(run.roomSqft, 0)} rooms + {fmtNum(zone.heldSqft, 0)} held +{" "}
              {fmtNum(run.claimedWallSqft, 0)} wall claim ={" "}
              <span className="text-cat-green">
                {fmtNum(run.roomSqft + zone.heldSqft + run.claimedWallSqft, 0)} sf
              </span>{" "}
              <span className="text-muted-foreground">
                vs {fmtNum(run.declaredSqft, 0)} declared
              </span>
            </p>
          )}
        </div>
      );
    case "4":
      return (
        <div className="mt-1 space-y-1">
          <p className="tele text-muted-foreground">
            shapes change only in Revit · two verbs here:{" "}
            <span className="text-foreground">accept</span> takes the recalculation&rsquo;s
            proposal, <span className="text-foreground">dismiss</span> keeps your state
          </p>
          {open.length === 0 ? (
            <p className="tele text-cat-green">
              nothing open{decided.length > 0 && ` · ${decided.length} decided earlier`}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--line-soft)] rounded-[var(--radius)] border border-cat-clay/30">
              {open.map(({ room, flag }) => (
                <li key={`${room.guid}:${flag}`} className="px-1.5 py-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="tele min-w-0 flex-1 truncate">{room.name}</span>
                    <span className="tele text-muted-foreground">{fmtNum(room.sqft, 0)} sf</span>
                    <span className="tele text-cat-clay">{flag}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="tele min-w-0 flex-1 truncate text-muted-foreground">
                      {FLAG_MEANING[flag] ?? flag}
                    </span>
                    <Button size="xs" variant="ghost" onClick={() => onDecide(room, flag, "accept")}>
                      accept
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => onDecide(room, flag, "dismiss")}
                    >
                      dismiss
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {decided.length > 0 && (
            <p className="tele text-muted-foreground">
              provenance:{" "}
              {decided
                .slice(0, 2)
                .map(
                  ({ room, d }) =>
                    `${room.name} ${d.verb} ${d.flag} · ${d.at.slice(0, 10)} · ${d.runId}`,
                )
                .join(" — ")}
              {decided.length > 2 && ` — +${decided.length - 2} more`}
            </p>
          )}
        </div>
      );
    case "5":
      return (
        <p className="tele mt-0.5 text-muted-foreground">
          {withData}/{zone.rooms.length} rooms carry Manual J data
          {withData > 0 && " · assist-derived (0.25 W/sf lighting, people by bedrooms), engineer confirms"}
        </p>
      );
    case "6":
      return (
        <p className="tele mt-0.5 text-muted-foreground">
          {linked === 0
            ? "no .r10 link yet — export writes {file, Identifier} into each Room Region blob"
            : `${linked}/${zone.rooms.length} rooms linked · last sync ${
                zone.rooms.find((r) => r.r10)?.r10?.syncedAt.slice(0, 16).replace("T", " ") ?? "—"
              }`}
          {zone.driftSqft > 0 && (
            <span className="text-destructive">
              {" "}
              · {fmtNum(zone.driftSqft, 0)} sf drifted since
            </span>
          )}
        </p>
      );
    default:
      return (
        <p className="tele mt-0.5 text-muted-foreground">
          tag join across .r10 ↔ zones ↔ equipment — {roomSqft > 0 ? `${fmtNum(roomSqft, 0)} sf` : "no rooms"} to
          account for; writes nothing
        </p>
      );
  }
}

// ── Room table ──────────────────────────────────────────────────────────────

function RoomTable({ zone }: { zone: MockZone }) {
  if (zone.rooms.length === 0)
    return (
      <p className="tele border-t border-[var(--line)] px-3 py-2 text-muted-foreground">
        no rooms materialized — partition this zone first.
      </p>
    );

  return (
    <div className="border-t border-[var(--line)]">
      <p className="section-label px-3 py-1">
        rooms
        <span className="tele ml-1.5 normal-case text-muted-foreground">
          {zone.rooms.length} · {fmtNum(zone.rooms.reduce((s, r) => s + r.sqft, 0), 0)} sf
        </span>
      </p>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-y border-[var(--line)]">
            {["room", "sf", "ceil", "manual j", ".r10", ""].map((h) => (
              <th key={h} className="section-label px-1.5 py-0.5 font-normal first:pl-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {zone.rooms.map((room) => {
            const drift = room.r10 && room.r10.lastSyncedSqft !== room.sqft;
            return (
              <tr key={room.guid} className="border-b border-[var(--line-soft)]">
                <td className="px-1.5 py-0.5 pl-3 text-xs">{room.name}</td>
                <td className="tele px-1.5 py-0.5">{fmtNum(room.sqft, 0)}</td>
                <td className="tele px-1.5 py-0.5 text-muted-foreground">
                  {fmtNum(room.ceilingFt, 1)}
                </td>
                <td className="tele px-1.5 py-0.5 text-muted-foreground">
                  {room.data
                    ? `${room.data.people}p · ${room.data.lightingW}W · ${room.data.equipSensible}/${room.data.equipLatent} · ${room.data.ventilationCfm}cfm`
                    : "not entered"}
                </td>
                <td className="tele px-1.5 py-0.5 text-muted-foreground">
                  {room.r10 ? `#${room.r10.identifier}` : "unlinked"}
                </td>
                <td className="px-1.5 py-0.5">
                  {drift && (
                    <span
                      className="tele inline-flex items-center gap-1 text-destructive"
                      title={`synced at ${fmtNum(room.r10!.lastSyncedSqft, 0)} sf — the .r10 is stale for this room`}
                    >
                      <TriangleAlert className="size-3" />
                      {fmtNum(room.sqft - room.r10!.lastSyncedSqft, 0)} sf
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="tele px-3 py-1.5 text-muted-foreground">
        room geometry lives on the Room Region FR · identity, provenance and the .r10 link live in
        its blob · Manual J values live in the .r10
      </p>
    </div>
  );
}
