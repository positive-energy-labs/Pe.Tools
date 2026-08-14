/** PROTOTYPE — variant "pea": chat-native workspace. */
/**
 * What /takeoff looks like once it stops being a page and becomes a route-state chat plugin.
 *
 * The workspace is the main pane and pea is a first-class operator in the flank: it proposes
 * through tool cards, the human accepts or dismisses per item, and every acceptance lands
 * visibly in the workspace (stage chips advance, rooms appear, badges update). Nothing here
 * talks to a host — the transcript is canned and every effect is local `useState`. The point
 * of the variant is to make the chat-plugin *implications* judgeable: what pea may write,
 * what it may only command, what it refuses when its evidence is stale, and what the URL
 * shape and state slice would have to look like.
 */
import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Lock, Undo2, X } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { ValueDiff } from "#/components/ui/value-diff";
import { cn } from "#/lib/utils";
import { fmtNum } from "#/rhvac/cells";
import { containsEvenOdd, pathD, type Zone } from "#/takeoff/model";
import {
  assistData,
  mockWorld,
  openDecisions,
  type MockRoom,
  type MockStage,
  type MockZone,
  type RoomType,
} from "#/takeoff/proto/mock";
import { Live, Seam } from "#/takeoff/seam";
import { ZoneThumb } from "#/takeoff/zone-plan";

/* ── Canned proposal vocabulary ─────────────────────────────────────────────
 *
 * A proposal card is one route tool call. Its items are the trichotomy rows: a live value,
 * a staged proposal, and a review verdict. Two verbs only — accept, dismiss — matching the
 * takeoff decision law. Nothing auto-applies; the human is the only writer of record.
 */

type Verdict = "accept" | "dismiss";

interface DiffField {
  label: string;
  /** Live value in the model; null when the field does not exist yet. */
  from: string | null;
  to: string;
}

interface ProposalItem {
  id: string;
  zoneKey: string;
  label: string;
  sub: string;
  fields: DiffField[];
  /** register: the tags this item resolves onto the Zoning Region. */
  tags?: string[];
  /** partition: the room this item would materialize. */
  room?: { name: string; type: RoomType; sqft: number; label: [number, number] };
  /** assist / sync: the existing room this item touches. */
  roomGuid?: string;
  /** Set when pea declines to stage the item at all — the freshness refusal. */
  refused?: string;
}

type Effect = "register" | "partition" | "assist" | "sync";

interface ProposalCard {
  id: string;
  tool: "route_state_apply" | "route_command";
  /** The command name or the masked path pea wrote, rendered as the card's machine line. */
  wire: string;
  title: string;
  note: string;
  /** `human` cards can be staged by pea but only committed by a person. */
  actor: "any" | "human";
  effect: Effect;
  items: ProposalItem[];
}

type Entry =
  | { kind: "say"; who: "you" | "pea"; text: string }
  | { kind: "card"; card: ProposalCard };

/* ── World-derived transcript ───────────────────────────────────────────────── */

const DOC_TOKEN = "v-8f21c4";
const STALE_TOKEN = "v-7ac902";

/** Evenly-spread interior points, deterministic — proposed rooms need somewhere to land. */
function samplePoints(zone: Zone, n: number): [number, number][] {
  const { minX, minY, maxX, maxY } = zone.bounds;
  const inside: [number, number][] = [];
  const steps = 13;
  for (let i = 1; i < steps; i++)
    for (let j = 1; j < steps; j++) {
      const x = minX + ((maxX - minX) * i) / steps;
      const y = minY + ((maxY - minY) * j) / steps;
      if (containsEvenOdd(zone.loops, x, y)) inside.push([x, y]);
    }
  const center: [number, number] = [(minX + maxX) / 2, (minY + maxY) / 2];
  return Array.from({ length: n }, (_, k) =>
    inside.length === 0 ? center : (inside[Math.floor((k * inside.length) / n)] ?? center),
  );
}

const PROPOSED_ROOMS: [string, RoomType, number][] = [
  ["Great Room", "great room", 412],
  ["Kitchen", "kitchen", 236],
  ["Powder", "powder", 44],
  ["Hall", "hall", 118],
];

function buildTranscript(zones: MockZone[]) {
  const upper = zones.filter((z) => z.zone.lane.label === "Upper" && z.stage === "declared").slice(0, 3);
  const upperFallback = upper.length > 0 ? upper : zones.filter((z) => z.zone.lane.label === "Upper").slice(0, 3);

  const partitionTarget =
    zones.find((z) => z.zone.lane.label === "Main" && z.rooms.length === 0 && z.tags.length > 0) ??
    zones.find((z) => z.zone.lane.label === "Main")!;

  // Rooms with no Manual J data yet — the assist card's subjects. A few already carry data,
  // so the card shows real overwrite diffs and not only null → value.
  const assistPool: { zone: MockZone; room: MockRoom }[] = [];
  for (const z of zones)
    for (const r of z.rooms) {
      if (assistPool.length >= 12) break;
      if (r.data == null) assistPool.push({ zone: z, room: r });
    }
  for (const z of zones)
    for (const r of z.rooms) {
      if (assistPool.length >= 12) break;
      if (r.data != null) assistPool.push({ zone: z, room: r });
    }

  const syncPool: { zone: MockZone; room: MockRoom }[] = [];
  for (const z of zones)
    for (const r of z.rooms) {
      if (syncPool.length >= 8) break;
      if (r.data != null && r.r10 == null) syncPool.push({ zone: z, room: r });
    }
  const driftedZone = zones.find((z) => z.stage === "drifted");

  const registerCard: ProposalCard = {
    id: "c-register",
    tool: "route_command",
    wire: 'route_command · takeoff.register { level: "Upper" }',
    title: "Register 3 zones",
    note: "Tags read off the mechanical legend and resolved against the System registry blob. Registering mints zone identity; it touches no geometry.",
    actor: "any",
    effect: "register",
    items: upperFallback.map((z, i) => {
      const tags = i === 2 ? [`FC-2${i + 1}`, `FC-2${i + 2}`] : [`FC-2${i + 1}`];
      return {
        id: `register:${z.zone.key}`,
        zoneKey: z.zone.key,
        label: z.zone.key,
        sub: `${z.name} · ${fmtNum(z.zone.declaredSqft, 0)} sf declared`,
        tags,
        fields: [
          { label: "tags", from: z.tags.length > 0 ? z.tags.join(", ") : null, to: tags.join(", ") },
          { label: "stage", from: "declared", to: "registered" },
        ],
      };
    }),
  };

  const points = samplePoints(partitionTarget.zone, PROPOSED_ROOMS.length);
  const partitionCard: ProposalCard = {
    id: "c-partition",
    tool: "route_command",
    wire: `route_command · takeoff.partition { zone: "${partitionTarget.zone.key}" }`,
    title: `Partition ${partitionTarget.zone.key}`,
    note: `Replay of the Main-level capture masked to this zone. 4 created, 0 rebound, 0 orphaned; ${fmtNum(
      partitionTarget.zone.declaredSqft * 0.06,
      0,
    )} sf held rather than guessed.`,
    actor: "any",
    effect: "partition",
    items: PROPOSED_ROOMS.map(([name, type, sqft], i) => ({
      id: `partition:${partitionTarget.zone.key}:${i}`,
      zoneKey: partitionTarget.zone.key,
      label: name,
      sub: `${fmtNum(sqft, 0)} sf · detected boundary`,
      room: { name, type, sqft, label: points[i] ?? [0, 0] },
      fields: [
        { label: "type", from: null, to: type },
        { label: "area", from: null, to: `${fmtNum(sqft, 0)} sf` },
      ],
    })),
  };

  const assistCard: ProposalCard = {
    id: "c-assist",
    tool: "route_state_apply",
    wire: "route_state_apply · assists.<roomGuid>.*",
    title: "Derive Manual J assists for 12 rooms",
    note: "Occupancy, lighting density and ventilation derived from room type and area. Assists are proposals in the slice — they become model truth only on sync.",
    actor: "any",
    effect: "assist",
    items: assistPool.map(({ zone, room }) => {
      const bedrooms = zone.rooms.filter((r) => r.type.includes("bedroom")).length;
      const next = assistData(room.type, room.sqft, bedrooms);
      const live = room.data;
      return {
        id: `assist:${room.guid}`,
        zoneKey: zone.zone.key,
        roomGuid: room.guid,
        label: room.name,
        sub: `${zone.zone.key} · ${room.type}`,
        fields: [
          { label: "people", from: live ? String(live.people) : null, to: String(next.people) },
          {
            label: "lighting",
            from: live ? `${live.lightingW} W` : null,
            to: `${next.lightingW} W`,
          },
          {
            label: "ventilation",
            from: live ? `${live.ventilationCfm} cfm` : null,
            to: `${next.ventilationCfm} cfm`,
          },
        ],
      };
    }),
  };

  const syncCard: ProposalCard = {
    id: "c-sync",
    tool: "route_command",
    wire: "route_command · takeoff.sync { dryRun: true }",
    title: "Stage .r10 sync of 8 rooms",
    note: "Writes into a copy of the .r10 behind the safety envelope. Staging is pea's; the commit is not — sync mutates a file outside Revit, so the command is human-only.",
    actor: "human",
    effect: "sync",
    items: syncPool.map(({ zone, room }) => ({
      id: `sync:${room.guid}`,
      zoneKey: zone.zone.key,
      roomGuid: room.guid,
      label: room.name,
      sub: `${zone.zone.key} · ${fmtNum(room.sqft, 0)} sf`,
      fields: [
        { label: "r10 row", from: null, to: `new · ${fmtNum(room.sqft, 0)} sf` },
        { label: "ceiling", from: null, to: `${fmtNum(room.ceilingFt, 1)} ft` },
      ],
      refused:
        driftedZone != null && zone.zone.key === driftedZone.zone.key
          ? `capture ${STALE_TOKEN} ≠ document ${DOC_TOKEN}`
          : undefined,
    })),
  };

  const cards = [registerCard, partitionCard, assistCard, syncCard];

  const entries: Entry[] = [
    {
      kind: "say",
      who: "you",
      text: "Register the upper level and partition what's ready. Then get the Manual J numbers as far as you can without touching the .r10.",
    },
    {
      kind: "say",
      who: "pea",
      text: `Bound to ${"sandbox:rvt-a1c9"} at document ${DOC_TOKEN}. Three Upper zones are declared with legible legend tags, one Main zone is registered and unpartitioned. I'll propose all four steps — you decide what lands.`,
    },
    { kind: "card", card: registerCard },
    { kind: "card", card: partitionCard },
    {
      kind: "say",
      who: "pea",
      text: "Partition is a replay against a baked level capture, so its accounting closes: declared = rooms + held + claimed wall. I held the stair residue rather than guess a boundary for it.",
    },
    { kind: "card", card: assistCard },
    { kind: "card", card: syncCard },
    {
      kind: "say",
      who: "pea",
      text: driftedZone
        ? `One room is refused: ${driftedZone.zone.key} was hand-edited since its capture (${STALE_TOKEN}), so its geometry no longer matches the evidence I'd be syncing. Recapture that zone or exclude it — I won't stage a row I can't stand behind.`
        : "Nothing is refused; every room's capture token matches the open document.",
    },
  ];

  return { cards, entries, partitionTarget, driftedZone };
}

/* ── Overlay: what accepted proposals do to the workspace ───────────────────── */

interface Overlay {
  tags: Record<string, string[]>;
  stage: Record<string, MockStage>;
  rooms: Record<string, { name: string; sqft: number; label: [number, number] }[]>;
  assists: Set<string>;
  syncStaged: Set<string>;
}

function buildOverlay(cards: ProposalCard[], verdicts: Record<string, Verdict>): Overlay {
  const overlay: Overlay = {
    tags: {},
    stage: {},
    rooms: {},
    assists: new Set(),
    syncStaged: new Set(),
  };
  for (const card of cards) {
    const accepted = card.items.filter((item) => verdicts[item.id] === "accept");
    if (card.effect === "register")
      for (const item of accepted) {
        overlay.tags[item.zoneKey] = item.tags ?? [];
        overlay.stage[item.zoneKey] = "registered";
      }
    if (card.effect === "partition")
      for (const item of accepted) {
        if (!item.room) continue;
        (overlay.rooms[item.zoneKey] ??= []).push({
          name: item.room.name,
          sqft: item.room.sqft,
          label: item.room.label,
        });
        overlay.stage[item.zoneKey] = "partitioned";
      }
    if (card.effect === "assist")
      for (const item of accepted) if (item.roomGuid) overlay.assists.add(item.roomGuid);
    if (card.effect === "sync")
      for (const item of accepted) if (item.roomGuid) overlay.syncStaged.add(item.roomGuid);
  }
  return overlay;
}

/* ── The variant ────────────────────────────────────────────────────────────── */

export function Variant() {
  const world = useMemo(() => mockWorld(), []);
  const { cards, entries, partitionTarget, driftedZone } = useMemo(
    () => buildTranscript(world.zones),
    [world],
  );

  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [committed, setCommitted] = useState<string[]>([]);

  const overlay = useMemo(() => buildOverlay(cards, verdicts), [cards, verdicts]);

  const decide = (ids: string[], verdict: Verdict) =>
    setVerdicts((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = verdict;
      return next;
    });
  const undo = (ids: string[]) =>
    setVerdicts((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });

  const actionable = (item: ProposalItem) => item.refused == null;
  const pending = cards.flatMap((card) =>
    card.items.filter((item) => actionable(item) && verdicts[item.id] == null).map((item) => item.id),
  );

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <Header world={world} />

      <div className="flex min-h-0 flex-1">
        {/* ── Workspace pane ──────────────────────────────────────────────── */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-5">
            <WorkspaceBoard
              zones={world.zones}
              overlay={overlay}
              driftedKey={driftedZone?.zone.key ?? null}
            />
            <PartitionCanvas target={partitionTarget} overlay={overlay} />
            <Inspector
              open={inspectorOpen}
              onToggle={() => setInspectorOpen((v) => !v)}
              landed={
                Object.keys(overlay.stage).length +
                overlay.assists.size +
                overlay.syncStaged.size
              }
            />
          </div>
        </main>

        {/* ── Chat lane: a structural flank, not an overlay ───────────────── */}
        <aside className="flex w-[27rem] shrink-0 flex-col border-l border-[var(--line)] bg-card/40">
          <div className="flex items-baseline justify-between border-b border-[var(--line)] px-4 py-2.5">
            <span className="section-label">thread t_842</span>
            <span className="tele text-muted-foreground">plugin · takeoff</span>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {entries.map((entry, i) =>
              entry.kind === "say" ? (
                <Say key={`say-${i}`} who={entry.who} text={entry.text} />
              ) : (
                <ProposalCardView
                  key={entry.card.id}
                  card={entry.card}
                  verdicts={verdicts}
                  onDecide={decide}
                  onUndo={undo}
                />
              ),
            )}
            <div className="pt-1">
              <Seam>
                Transcript is canned. Real cards would render from `route_state_apply` /
                `route_command` tool calls in the live thread.
              </Seam>
            </div>
          </div>

          <ReviewDock
            cards={cards}
            verdicts={verdicts}
            pending={pending}
            committed={committed}
            onDecide={decide}
            onCommit={(id) => setCommitted((prev) => [...new Set([...prev, id])])}
          />
        </aside>
      </div>
    </div>
  );
}

/* ── Header: binding + freshness + routing ──────────────────────────────────── */

function Header({ world }: { world: ReturnType<typeof mockWorld> }) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--line)] px-6 py-3">
      <h1 className="font-pe-display text-base font-semibold tracking-tight">Takeoff</h1>
      <span className="tele-label rounded-[var(--radius)] border border-[var(--line-2)] px-1.5 py-px text-muted-foreground">
        route:takeoff
      </span>
      <Live>bound · sandbox:rvt-a1c9 · {world.docName}</Live>
      <Badge variant="green" className="tele gap-1.5">
        <span className="size-1.5 rounded-full bg-cat-green" />
        evidence {DOC_TOKEN} matches document
      </Badge>
      <span className="ml-auto tele text-muted-foreground">
        /takeoff?thread=t_842&amp;plugin=takeoff
      </span>
    </header>
  );
}

/* ── Workspace board ────────────────────────────────────────────────────────── */

const STAGE_TONE: Record<MockStage, "kiln" | "slate" | "blue" | "lichen" | "green" | "clay"> = {
  declared: "kiln",
  registered: "slate",
  partitioned: "blue",
  reviewed: "lichen",
  data: "green",
  synced: "green",
  drifted: "clay",
};

function WorkspaceBoard({
  zones,
  overlay,
  driftedKey,
}: {
  zones: MockZone[];
  overlay: Overlay;
  driftedKey: string | null;
}) {
  // Only the levels the transcript touches, plus enough context to read the board.
  const lanes = ["Upper", "Main"];
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="section-label">workspace · zones</h2>
        <span className="tele text-muted-foreground">
          {zones.length} declared · accepted proposals land here
        </span>
      </div>

      {lanes.map((lane) => {
        const laneZones = zones.filter((z) => z.zone.lane.label === lane).slice(0, 8);
        return (
          <div key={lane} className="rounded-[var(--radius)] border border-[var(--line)]">
            <div className="border-b border-[var(--line-soft)] px-3 py-1.5">
              <span className="tele-label text-muted-foreground">{lane} level</span>
            </div>
            <div className="divide-y divide-[var(--line-soft)]">
              {laneZones.map((z) => (
                <ZoneRow
                  key={z.zone.key}
                  zone={z}
                  overlay={overlay}
                  stale={driftedKey === z.zone.key}
                />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function ZoneRow({ zone, overlay, stale }: { zone: MockZone; overlay: Overlay; stale: boolean }) {
  const landedStage = overlay.stage[zone.zone.key];
  const stage = landedStage ?? zone.stage;
  const landedTags = overlay.tags[zone.zone.key];
  const tags = landedTags ?? zone.tags;
  const addedRooms = overlay.rooms[zone.zone.key] ?? [];
  const roomCount = zone.rooms.length + addedRooms.length;
  const assists = zone.rooms.filter((r) => overlay.assists.has(r.guid)).length;
  const staged = zone.rooms.filter((r) => overlay.syncStaged.has(r.guid)).length;
  const open = openDecisions(zone);
  const touched = landedStage != null || landedTags != null || addedRooms.length > 0 || assists > 0 || staged > 0;

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2 transition-colors",
        touched && "bg-cat-green/[0.07]",
      )}
    >
      <ZoneThumb zone={zone.zone} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="tele font-medium">{zone.zone.key}</span>
          <span className="truncate text-sm text-muted-foreground">{zone.name}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          <span className="tele text-muted-foreground">{fmtNum(zone.zone.declaredSqft, 0)} sf</span>
          {tags.length > 0 ? (
            <span className={cn("tele", landedTags ? "text-cat-green" : "text-muted-foreground")}>
              {tags.join(" · ")}
            </span>
          ) : (
            <span className="tele text-muted-foreground/60">untagged</span>
          )}
          {roomCount > 0 && (
            <span className="tele text-muted-foreground">
              {roomCount} rooms
              {addedRooms.length > 0 && <span className="text-cat-green"> +{addedRooms.length}</span>}
            </span>
          )}
          {open > 0 && <span className="tele text-cat-clay">{open} open</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {assists > 0 && (
          <Badge variant="green" className="tele">
            {assists} assists
          </Badge>
        )}
        {staged > 0 && (
          <Badge variant="blue" className="tele">
            {staged} staged
          </Badge>
        )}
        {stale && (
          <Badge variant="clay" className="tele">
            {STALE_TOKEN} stale
          </Badge>
        )}
        <Badge variant={STAGE_TONE[stage]} className={cn("tele", landedStage && "ring-1 ring-cat-green/40")}>
          {stage}
        </Badge>
      </div>
    </div>
  );
}

/* ── Partition canvas: subordinate proof that a proposal landed spatially ───── */

function PartitionCanvas({ target, overlay }: { target: MockZone; overlay: Overlay }) {
  const added = overlay.rooms[target.zone.key] ?? [];
  const b = target.zone.bounds;
  const w = Math.max(b.maxX - b.minX, 1e-6);
  const h = Math.max(b.maxY - b.minY, 1e-6);
  const pad = Math.max(w, h) * 0.06;

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="section-label">partition target · {target.zone.key}</h2>
        <span className="tele text-muted-foreground">
          {added.length} of 4 rooms accepted ·{" "}
          {fmtNum(added.reduce((s, r) => s + r.sqft, 0), 0)} sf claimed
        </span>
      </div>
      <div className="flex gap-4 rounded-[var(--radius)] border border-[var(--line)] p-3">
        <svg
          viewBox={`${b.minX - pad} ${b.minY - pad} ${w + pad * 2} ${h + pad * 2}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-40 w-56 shrink-0"
        >
          <title>{`${target.zone.key} — declared zone with accepted room proposals`}</title>
          <path
            d={pathD(target.zone.loops, b)}
            fillRule="evenodd"
            fill={`color-mix(in srgb, rgb(${target.zone.color}) 10%, transparent)`}
            stroke={`rgb(${target.zone.color})`}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          {added.map((room) => (
            <circle
              key={room.name}
              cx={room.label[0]}
              cy={b.minY + b.maxY - room.label[1]}
              r={Math.max(Math.sqrt(room.sqft) / 2.6, w / 40)}
              fill="color-mix(in srgb, var(--cat-green) 22%, transparent)"
              stroke="var(--cat-green)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm leading-snug text-muted-foreground">
            Rooms appear as accepted, at their model positions. Nothing here is editable —
            geometry belongs to the Room Region family instance in Revit, and the write mask
            says so.
          </p>
          {added.length === 0 ? (
            <p className="tele text-muted-foreground/70">
              no proposals accepted yet — the zone is registered and empty
            </p>
          ) : (
            <ul className="space-y-0.5">
              {added.map((room) => (
                <li key={room.name} className="tele flex items-baseline gap-2">
                  <span className="text-cat-green">●</span>
                  <span className="flex-1">{room.name}</span>
                  <span className="text-muted-foreground">{fmtNum(room.sqft, 0)} sf</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Chat lane pieces ───────────────────────────────────────────────────────── */

function Say({ who, text }: { who: "you" | "pea"; text: string }) {
  return (
    <div className="space-y-1">
      <span className="tele-label text-muted-foreground">{who}</span>
      <p
        className={cn(
          "text-sm leading-snug",
          who === "you" ? "border-l-2 border-cat-slate/50 pl-2.5 text-foreground" : "text-foreground/85",
        )}
      >
        {text}
      </p>
    </div>
  );
}

function ProposalCardView({
  card,
  verdicts,
  onDecide,
  onUndo,
}: {
  card: ProposalCard;
  verdicts: Record<string, Verdict>;
  onDecide: (ids: string[], verdict: Verdict) => void;
  onUndo: (ids: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(card.items.length <= 4);
  const actionable = card.items.filter((item) => item.refused == null);
  const open = actionable.filter((item) => verdicts[item.id] == null);
  const accepted = actionable.filter((item) => verdicts[item.id] === "accept");
  const dismissed = actionable.filter((item) => verdicts[item.id] === "dismiss");
  const refused = card.items.filter((item) => item.refused != null);
  const shown = expanded ? card.items : card.items.slice(0, 4);

  return (
    <div className="rounded-[var(--radius)] border border-[var(--line-2)] bg-card">
      <div className="space-y-1 border-b border-[var(--line-soft)] px-2.5 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">{card.title}</span>
          {card.actor === "human" ? (
            <span className="tele-label inline-flex items-center gap-1 text-cat-clay">
              <Lock className="size-3" /> human commit
            </span>
          ) : (
            <span className="tele-label text-muted-foreground">proposal</span>
          )}
        </div>
        <div className="tele truncate text-muted-foreground">{card.wire}</div>
        <p className="text-xs leading-snug text-muted-foreground">{card.note}</p>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 pt-0.5">
          <Count n={open.length} label="open" />
          <Count n={accepted.length} label="accepted" tone="text-cat-green" />
          <Count n={dismissed.length} label="dismissed" />
          {refused.length > 0 && <Count n={refused.length} label="refused" tone="text-cat-clay" />}
        </div>
      </div>

      <div className="divide-y divide-[var(--line-soft)]">
        {shown.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            verdict={verdicts[item.id] ?? null}
            onDecide={(v) => onDecide([item.id], v)}
            onUndo={() => onUndo([item.id])}
          />
        ))}
      </div>

      <div className="flex items-center gap-1.5 border-t border-[var(--line-soft)] px-2.5 py-1.5">
        {card.items.length > 4 && (
          <button
            type="button"
            className="tele-label inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            {expanded ? "collapse" : `${card.items.length - 4} more`}
          </button>
        )}
        <div className="ml-auto flex gap-1">
          <Button
            size="xs"
            variant="ghost"
            disabled={open.length === 0}
            onClick={() => onDecide(open.map((i) => i.id), "dismiss")}
          >
            <X /> Dismiss all
          </Button>
          <Button
            size="xs"
            disabled={open.length === 0}
            onClick={() => onDecide(open.map((i) => i.id), "accept")}
          >
            <Check /> Accept {open.length > 0 ? open.length : ""}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ItemRow({
  item,
  verdict,
  onDecide,
  onUndo,
}: {
  item: ProposalItem;
  verdict: Verdict | null;
  onDecide: (v: Verdict) => void;
  onUndo: () => void;
}) {
  if (item.refused)
    return (
      <div className="flex items-start gap-2 bg-cat-clay/[0.06] px-2.5 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-muted-foreground line-through">{item.label}</div>
          <div className="tele text-cat-clay">refused · {item.refused}</div>
        </div>
        <span className="tele-label shrink-0 text-cat-clay">stale</span>
      </div>
    );

  return (
    <div
      className={cn(
        "flex items-start gap-2 px-2.5 py-1.5",
        verdict === "accept" && "bg-cat-green/[0.07]",
        verdict === "dismiss" && "opacity-45",
      )}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-xs font-medium">{item.label}</span>
          <span className="tele truncate text-muted-foreground">{item.sub}</span>
        </div>
        {item.fields.map((field) => (
          <div key={field.label} className="flex items-baseline gap-2">
            <span className="tele-label w-20 shrink-0 text-muted-foreground">{field.label}</span>
            <ValueDiff
              from={field.from}
              to={field.to}
              className={verdict === "accept" ? "text-cat-green" : "text-cat-clay"}
            />
          </div>
        ))}
      </div>
      <div className="flex shrink-0 gap-0.5">
        {verdict == null ? (
          <>
            <Button size="icon-sm" variant="ghost" title="Dismiss" onClick={() => onDecide("dismiss")}>
              <X />
            </Button>
            <Button size="icon-sm" title="Accept" onClick={() => onDecide("accept")}>
              <Check />
            </Button>
          </>
        ) : (
          <Button size="icon-sm" variant="ghost" title="Undo" onClick={onUndo}>
            <Undo2 />
          </Button>
        )}
      </div>
    </div>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1", n === 0 && "opacity-45", tone)}>
      <span className="tele">{n}</span>
      <span className="tele-label text-muted-foreground">{label}</span>
    </span>
  );
}

/* ── Review dock: one authoritative tail, the RouteChatPluginDock pattern ───── */

function ReviewDock({
  cards,
  verdicts,
  pending,
  committed,
  onDecide,
  onCommit,
}: {
  cards: ProposalCard[];
  verdicts: Record<string, Verdict>;
  pending: string[];
  committed: string[];
  onDecide: (ids: string[], verdict: Verdict) => void;
  onCommit: (id: string) => void;
}) {
  const rows = cards.map((card) => {
    const actionable = card.items.filter((item) => item.refused == null);
    return {
      card,
      open: actionable.filter((item) => verdicts[item.id] == null).length,
      accepted: actionable.filter((item) => verdicts[item.id] === "accept").length,
      refused: card.items.length - actionable.length,
    };
  });
  const totalAccepted = rows.reduce((s, r) => s + r.accepted, 0);
  const humanRow = rows.find((r) => r.card.actor === "human");
  const canCommit =
    humanRow != null && humanRow.accepted > 0 && !committed.includes(humanRow.card.id);

  return (
    <div className="shrink-0 border-t border-[var(--line-2)] bg-card px-4 py-2.5">
      <div className="flex items-baseline justify-between">
        <span className="section-label">review dock</span>
        <span className="tele text-muted-foreground">
          {pending.length} pending · {totalAccepted} accepted
        </span>
      </div>

      <div className="mt-1.5 space-y-0.5">
        {rows.map((row) => (
          <div key={row.card.id} className="flex items-baseline gap-2">
            <span className="truncate text-xs">{row.card.title}</span>
            <span className="flex-1 border-b border-dashed border-[var(--line-soft)]" />
            {row.refused > 0 && <span className="tele text-cat-clay">{row.refused} refused</span>}
            <span className={cn("tele", row.open === 0 ? "text-cat-green" : "text-muted-foreground")}>
              {row.open === 0 ? "clear" : `${row.open} open`}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <span className="tele min-w-0 flex-1 truncate text-muted-foreground">
          {pending.length > 0
            ? "Pea proposes; you are the only writer."
            : canCommit
              ? "Staged. Only you can run sync."
              : "Nothing pending."}
        </span>
        <Button
          size="xs"
          variant="ghost"
          disabled={pending.length === 0}
          onClick={() => onDecide(pending, "dismiss")}
        >
          <X /> Dismiss {pending.length || ""}
        </Button>
        <Button size="xs" disabled={pending.length === 0} onClick={() => onDecide(pending, "accept")}>
          <Check /> Accept {pending.length || ""}
        </Button>
        {humanRow && (
          <Button
            size="xs"
            variant="outline"
            disabled={!canCommit}
            onClick={() => onCommit(humanRow.card.id)}
          >
            <Lock />
            {committed.includes(humanRow.card.id) ? "Synced" : `Sync ${humanRow.accepted}`}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ── Inspector: the route-state slice as documentation ──────────────────────── */

interface SchemaRow {
  path: string;
  type: string;
  writer: "pea" | "human" | "command" | "denied";
  note: string;
  scope: "workspace" | "thread";
}

const SCHEMA: SchemaRow[] = [
  {
    path: "binding",
    type: "{ target: string | null, boundAt }",
    writer: "human",
    note: "Substrate-owned. The bind command is human-only; commands inherit the target.",
    scope: "workspace",
  },
  {
    path: "evidence",
    type: "{ capturedAt, documentVersionToken, replayFile }",
    writer: "command",
    note: "Stamped by capture. A token mismatch makes every downstream claim render stale.",
    scope: "workspace",
  },
  {
    path: "zones.*",
    type: "{ key, tags[], stage, runId }",
    writer: "command",
    note: "Written by register/partition only — never patched, so identity has one author.",
    scope: "workspace",
  },
  {
    path: "proposals.*",
    type: "{ kind, items[], createdAt }",
    writer: "pea",
    note: "The whole surface pea may patch freely. Proposals never apply themselves.",
    scope: "thread",
  },
  {
    path: "assists.*",
    type: "{ people, lightingW, equip*, ventilationCfm }",
    writer: "pea",
    note: "Derived Manual J inputs. Model truth only after a human-run sync.",
    scope: "thread",
  },
  {
    path: "decisions.*",
    type: "{ flag, verb: accept | dismiss, at, runId }",
    writer: "human",
    note: "Write-through review provenance. Two verbs, no third state.",
    scope: "workspace",
  },
  {
    path: "rooms.*.geometry",
    type: "Room Region FR outline",
    writer: "denied",
    note: "Not in the schema at all. Geometry is edited in Revit; the UI only reads it.",
    scope: "workspace",
  },
];

const WRITER_TONE: Record<SchemaRow["writer"], "green" | "slate" | "blue" | "clay"> = {
  pea: "green",
  human: "slate",
  command: "blue",
  denied: "clay",
};

const COMMANDS: { name: string; actor: "any" | "human"; flag: string; description: string }[] = [
  { name: "bind", actor: "human", flag: "", description: "Point the workspace at one Revit session." },
  {
    name: "register",
    actor: "any",
    flag: "mutatesExternal",
    description: "Resolve legend tags onto Zoning Regions and mint zone identity.",
  },
  {
    name: "partition",
    actor: "any",
    flag: "mutatesExternal",
    description: "Replay the level capture masked to one zone; materialize Room Region FRs.",
  },
  {
    name: "assist",
    actor: "any",
    flag: "",
    description: "Derive Manual J inputs into proposals — pure, no external effect.",
  },
  {
    name: "sync",
    actor: "human",
    flag: "mutatesExternal",
    description: "Write accepted rooms into a copy of the .r10 behind the safety envelope.",
  },
  {
    name: "recapture",
    actor: "any",
    flag: "recoversExternal",
    description: "Re-run the level capture; proves the document token fresh after drift.",
  },
];

function Inspector({
  open,
  onToggle,
  landed,
}: {
  open: boolean;
  onToggle: () => void;
  landed: number;
}) {
  return (
    <section className="rounded-[var(--radius)] border border-[var(--line)]">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={onToggle}
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <span className="section-label">route-state inspector</span>
        <span className="tele text-muted-foreground">route:takeoff</span>
        <span className="ml-auto tele text-muted-foreground">{landed} local writes this session</span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-[var(--line-soft)] px-3 py-4">
          <p className="max-w-prose text-sm leading-snug text-muted-foreground">
            Everything above is one route-state slice: a zod document, a declarative write mask,
            and named commands. No takeoff-specific server code beyond those three — RouteWorkspace
            owns persistence, ordering and validation, and this pane is a projection of it.
          </p>

          <div className="space-y-2">
            <h3 className="tele-label text-muted-foreground">schema · agentWriteMask</h3>
            <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--line-soft)]">
              <div className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_5.5rem_5rem] gap-x-3 border-b border-[var(--line-soft)] bg-muted/40 px-2.5 py-1">
                {["path", "type", "writer", "scope"].map((h) => (
                  <span key={h} className="tele-label text-muted-foreground">
                    {h}
                  </span>
                ))}
              </div>
              {SCHEMA.map((row) => (
                <div
                  key={row.path}
                  className={cn(
                    "grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_5.5rem_5rem] items-baseline gap-x-3 border-b border-[var(--line-soft)] px-2.5 py-1.5 last:border-b-0",
                    row.writer === "denied" && "bg-cat-clay/[0.05]",
                  )}
                >
                  <span className={cn("tele", row.writer === "denied" && "line-through opacity-70")}>
                    {row.path}
                  </span>
                  <span className="min-w-0">
                    <span className="tele block truncate text-muted-foreground">{row.type}</span>
                    <span className="block text-xs leading-snug text-muted-foreground/80">
                      {row.note}
                    </span>
                  </span>
                  <span>
                    <Badge variant={WRITER_TONE[row.writer]} className="tele">
                      {row.writer}
                    </Badge>
                  </span>
                  <span className="tele text-muted-foreground">{row.scope}</span>
                </div>
              ))}
            </div>
            <p className="tele text-muted-foreground">
              agentWriteMask = [["proposals","*"], ["assists","*"]] · default-deny everywhere else
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <h3 className="tele-label text-muted-foreground">commands</h3>
              <div className="space-y-1.5">
                {COMMANDS.map((command) => (
                  <div key={command.name} className="flex items-baseline gap-2">
                    <span className="tele w-20 shrink-0">{command.name}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <Badge variant={command.actor === "human" ? "clay" : "slate"} className="tele">
                          {command.actor}
                        </Badge>
                        {command.flag && (
                          <span className="tele text-muted-foreground">{command.flag}</span>
                        )}
                      </div>
                      <p className="text-xs leading-snug text-muted-foreground">
                        {command.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="tele-label text-muted-foreground">binding + freshness</h3>
                <div className="space-y-1.5 rounded-[var(--radius)] border border-[var(--line-soft)] p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Live>sandbox:rvt-a1c9</Live>
                    <span className="tele text-muted-foreground">boundAt 2026-08-14T09:02Z</span>
                  </div>
                  <div className="tele text-muted-foreground">
                    document {DOC_TOKEN} · capture {DOC_TOKEN} → fresh
                  </div>
                  <div className="tele text-cat-clay">
                    one zone at {STALE_TOKEN} → pea refuses sync, offers recapture
                  </div>
                  <p className="text-xs leading-snug text-muted-foreground">
                    Staleness is a first-class answer, not an error. Pea will still read, propose
                    and explain against stale evidence — it will not run a command whose external
                    effect depends on it.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="tele-label text-muted-foreground">scope + routing</h3>
                <div className="space-y-1.5 rounded-[var(--radius)] border border-[var(--line-soft)] p-2.5">
                  <div className="tele">/takeoff?thread=t_842&amp;plugin=takeoff</div>
                  <p className="text-xs leading-snug text-muted-foreground">
                    Thread scope carries proposals and assists — they die with the conversation.
                    Workspace scope carries binding, zones and decisions — they outlive it, and are
                    what a second designer joining the thread sees.
                  </p>
                  <Seam>
                    No takeoff route-state spec exists yet. This table is the proposal for one.
                  </Seam>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
