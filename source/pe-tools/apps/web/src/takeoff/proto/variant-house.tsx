/** PROTOTYPE — variant "house": house as system. */
/*
 * The building's mechanical story is the hero. The page is a System tree —
 * System (tag) → Zones → Rooms — and the pipeline never appears as a sequence of steps.
 * Steps only show up as *blockers*: the sentence "what stops this System from being real"
 * with the one home that would clear it. Two verbs (accept/dismiss) exist on decision rows
 * only; every other blocker is a pointer at its owner, because nothing else is the web's
 * to do — geometry changes in Revit, ops write to the model and the .r10.
 */
import { useMemo, useState } from "react";

import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";
import { fmtNum } from "#/rhvac/cells";
import {
  SENSIBLE_CAP_BTUH,
  STAGE_ORDER,
  mockWorld,
  type MockRoom,
  type MockStage,
  type MockSystem,
  type MockZone,
} from "#/takeoff/proto/mock";
import { Live, Seam } from "#/takeoff/seam";
import { ZoneThumb } from "#/takeoff/zone-plan";

// ── Stage vocabulary → one hue each ─────────────────────────────────────────

const STAGE_TONE: Record<MockStage, { text: string; bg: string; border: string; fill: string }> = {
  declared: {
    text: "text-cat-kiln",
    bg: "bg-cat-kiln/12",
    border: "border-cat-kiln/25",
    fill: "bg-cat-kiln/45",
  },
  registered: {
    text: "text-cat-slate",
    bg: "bg-cat-slate/12",
    border: "border-cat-slate/25",
    fill: "bg-cat-slate/55",
  },
  partitioned: {
    text: "text-cat-blue",
    bg: "bg-cat-blue/12",
    border: "border-cat-blue/25",
    fill: "bg-cat-blue/45",
  },
  reviewed: {
    text: "text-cat-blue",
    bg: "bg-cat-blue/12",
    border: "border-cat-blue/25",
    fill: "bg-cat-blue/70",
  },
  data: {
    text: "text-cat-lichen",
    bg: "bg-cat-lichen/12",
    border: "border-cat-lichen/25",
    fill: "bg-cat-lichen/70",
  },
  synced: {
    text: "text-cat-green",
    bg: "bg-cat-green/12",
    border: "border-cat-green/25",
    fill: "bg-cat-green/80",
  },
  drifted: {
    text: "text-cat-clay",
    bg: "bg-cat-clay/12",
    border: "border-cat-clay/25",
    fill: "bg-cat-clay/70",
  },
};

const STAGE_MEANING: Record<MockStage, string> = {
  declared: "drawn, no System tag typed",
  registered: "tag resolved against the registry",
  partitioned: "rooms materialized, decisions open",
  reviewed: "decision queue empty",
  data: "Manual J data entered, not exported",
  synced: ".r10 in sync",
  drifted: "hand edits since last sync",
};

type Resolved = Record<string, "accept" | "dismiss">;

const openFlagsOf = (room: MockRoom, resolved: Resolved) =>
  room.flags.filter(
    (f) => !room.decisions.some((d) => d.flag === f) && !resolved[`${room.guid}:${f}`],
  );

// ── Blockers: "what stops this from being real" ─────────────────────────────

interface Blocker {
  /** short imperative sentence — the thing that is not yet true */
  text: string;
  /** the one home that would make it true (README data-homes table) */
  home: string;
  tone: "warn" | "hold" | "info";
}

interface ZoneFacts {
  open: number;
  missingData: number;
  unsynced: number;
  roomSqft: number;
  claimedWallSqft: number;
  closure: number | null;
  blockers: Blocker[];
}

function zoneFacts(z: MockZone, resolved: Resolved): ZoneFacts {
  const open = z.rooms.reduce((n, r) => n + openFlagsOf(r, resolved).length, 0);
  const missingData = z.rooms.filter((r) => !r.data).length;
  const unsynced = z.rooms.filter((r) => !r.r10).length;
  const roomSqft = z.rooms.reduce((s, r) => s + r.sqft, 0);
  const run = z.runs.length > 0 ? z.runs[z.runs.length - 1]! : null;
  const claimedWallSqft = run?.claimedWallSqft ?? 0;
  const closure = run
    ? roomSqft + z.heldSqft + claimedWallSqft + run.excludedSqft - run.declaredSqft
    : null;

  const blockers: Blocker[] = [];
  if (z.tags.length === 0)
    blockers.push({
      text: "no System tag — this area is under no System",
      home: "Zoning Region FR",
      tone: "warn",
    });
  if (z.rooms.length === 0)
    blockers.push({
      text: `${fmtNum(z.zone.declaredSqft, 0)} sf declared, no rooms — zone not partitioned`,
      home: "takeoff.partition → Room Region FRs",
      tone: "warn",
    });
  if (open > 0)
    blockers.push({
      text: `${open} open decision${open === 1 ? "" : "s"} on detected rooms`,
      home: "provenance blob on the Room Region",
      tone: "hold",
    });
  if (z.heldSqft > 0)
    blockers.push({
      text: `${fmtNum(z.heldSqft, 0)} sf held — the detector abstained rather than guess`,
      home: "held FR",
      tone: "hold",
    });
  if (z.driftSqft > 0)
    blockers.push({
      text: `${fmtNum(z.driftSqft, 0)} sf drift against the accepted state since last sync`,
      home: "Room Region FR (reshape in Revit)",
      tone: "warn",
    });
  if (z.rooms.length > 0 && missingData > 0)
    blockers.push({
      text: `${missingData} room${missingData === 1 ? "" : "s"} without Manual J data`,
      home: "the .r10 (assists propose, engineer confirms)",
      tone: "info",
    });
  if (z.rooms.length > 0 && unsynced > 0)
    blockers.push({
      text: `${unsynced} room${unsynced === 1 ? "" : "s"} never exported — no .r10 link`,
      home: "rhvac export → .r10 link blob",
      tone: "info",
    });
  if (closure !== null && Math.abs(closure) > 0.6)
    blockers.push({
      text: `accounting off by ${fmtNum(closure, 1)} sf — rooms + held + wall ≠ declared`,
      home: "per-zone closure law",
      tone: "warn",
    });
  return { open, missingData, unsynced, roomSqft, claimedWallSqft, closure, blockers };
}

// ── The page ────────────────────────────────────────────────────────────────

export function Variant() {
  const world = useMemo(() => mockWorld(), []);
  const [resolved, setResolved] = useState<Resolved>({});
  const [openSystems, setOpenSystems] = useState<Record<string, boolean>>({});
  const [openZones, setOpenZones] = useState<Record<string, boolean>>({});
  const [openRooms, setOpenRooms] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<"load" | "blockers" | "tag">("load");
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [focus, setFocus] = useState<{ sys?: string; zone?: string; room?: MockRoom }>({});

  const zoneByKey = useMemo(
    () => new Map(world.zones.map((z) => [z.zone.key, z])),
    [world],
  );

  const facts = useMemo(() => {
    const map = new Map<string, ZoneFacts>();
    for (const z of world.zones) map.set(z.zone.key, zoneFacts(z, resolved));
    return map;
  }, [world, resolved]);

  const factsOf = (key: string) => facts.get(key)!;

  const untagged = world.zones.filter((z) => z.tags.length === 0);

  /** Per-system rollups: load, ventilation, and the blocker debt underneath it. */
  const rows = useMemo(() => {
    return world.systems.map((sys) => {
      const zones = sys.zoneKeys.map((k) => zoneByKey.get(k)!).filter(Boolean);
      const declaredSqft = zones.reduce((s, z) => s + z.zone.declaredSqft, 0);
      const roomCount = zones.reduce((s, z) => s + z.rooms.length, 0);
      const ventCfm = zones.reduce(
        (s, z) => s + z.rooms.reduce((n, r) => n + (r.data?.ventilationCfm ?? 0), 0),
        0,
      );
      const blockerCount = zones.reduce((s, z) => s + factsOf(z.zone.key).blockers.length, 0);
      const openCount = zones.reduce((s, z) => s + factsOf(z.zone.key).open, 0);
      const syncedSqft = zones
        .filter((z) => z.stage === "synced")
        .reduce((s, z) => s + z.zone.declaredSqft, 0);
      return { sys, zones, declaredSqft, roomCount, ventCfm, blockerCount, openCount, syncedSqft };
    });
  }, [world, zoneByKey, facts]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => {
    const list = [...rows];
    if (sort === "load") list.sort((a, b) => b.sys.sensibleBtuh - a.sys.sensibleBtuh);
    if (sort === "blockers") list.sort((a, b) => b.blockerCount - a.blockerCount);
    if (sort === "tag")
      list.sort((a, b) =>
        a.sys.tag.localeCompare(b.sys.tag, undefined, { numeric: true }),
      );
    return list.filter((r) => !onlyBlocked || r.blockerCount > 0);
  }, [rows, sort, onlyBlocked]);

  // ── Whole-house totals ────────────────────────────────────────────────────
  const totalDeclared = world.zones.reduce((s, z) => s + z.zone.declaredSqft, 0);
  const totalSensible = world.systems.reduce((s, y) => s + y.sensibleBtuh, 0);
  const totalLatent = world.systems.reduce((s, y) => s + y.latentBtuh, 0);
  const overCap = world.systems.filter((y) => y.overCap);
  const totalBlockers = world.zones.reduce((s, z) => s + factsOf(z.zone.key).blockers.length, 0);
  const totalOpen = world.zones.reduce((s, z) => s + factsOf(z.zone.key).open, 0);
  const sqftIn = (pred: (z: MockZone) => boolean) =>
    world.zones.filter(pred).reduce((s, z) => s + z.zone.declaredSqft, 0);
  const idx = (z: MockZone) => STAGE_ORDER.indexOf(z.stage);
  const partitionedSqft = sqftIn((z) => idx(z) >= 2 || z.stage === "drifted");
  const reviewedSqft = sqftIn((z) => (idx(z) >= 3 || z.stage === "drifted") && factsOf(z.zone.key).open === 0);
  const syncedSqft = sqftIn((z) => z.stage === "synced");

  const lanes = useMemo(() => {
    const byLane = new Map<string, MockZone[]>();
    for (const z of world.zones) {
      const list = byLane.get(z.zone.lane.label) ?? [];
      list.push(z);
      byLane.set(z.zone.lane.label, list);
    }
    return [...byLane.entries()];
  }, [world]);

  const toggle =
    (set: React.Dispatch<React.SetStateAction<Record<string, boolean>>>) => (key: string) =>
      set((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleSystem = toggle(setOpenSystems);
  const toggleZone = toggle(setOpenZones);
  const toggleRoom = toggle(setOpenRooms);

  const decide = (room: MockRoom, flag: string, verb: "accept" | "dismiss") =>
    setResolved((prev) => ({ ...prev, [`${room.guid}:${flag}`]: verb }));

  return (
    <main className="min-h-screen bg-background pb-28">
      {/* ── The payoff header: the house, as one mechanical fact ───────────── */}
      <header className="border-b border-border bg-card">
        <div className="px-5 pt-5 pb-3">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div className="min-w-0">
              <p className="section-label">house as system</p>
              <h1 className="font-pe-display text-2xl leading-tight font-semibold tracking-tight">
                {world.docName.replace(/\.rvt$/, "")}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Live>45 declared Zoning Regions · 4 levels</Live>
                <Seam>
                  loads, tags and .r10 links are synthesized over the real zone fixture — no host
                  call on this page
                </Seam>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <Figure label="conditioned" value={fmtNum(totalDeclared, 0)} unit="sf" />
              <Figure label="sensible" value={fmtNum(totalSensible, 0)} unit="Btu/hr" />
              <Figure
                label="latent"
                value={fmtNum(totalLatent, 0)}
                unit="Btu/hr"
                muted
              />
              <Figure label="systems" value={String(world.systems.length)} unit="tags" muted />
              <Figure
                label="over cap"
                value={String(overCap.length)}
                unit={`of ${world.systems.length}`}
                tone={overCap.length > 0 ? "bad" : undefined}
              />
              <Figure
                label="blockers"
                value={String(totalBlockers)}
                unit={`${totalOpen} decisions`}
                tone={totalBlockers > 0 ? "warn" : undefined}
              />
            </div>
          </div>

          {/* Completion, in area rather than in step counts. */}
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div>
              <StageRibbon zones={world.zones} total={totalDeclared} />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {STAGE_ORDER.map((s) => {
                  const sf = sqftIn((z) => z.stage === s);
                  if (sf === 0) return null;
                  return (
                    <span key={s} className="tele inline-flex items-center gap-1.5">
                      <span
                        className={cn("inline-block size-2.5 rounded-[1px]", STAGE_TONE[s].fill)}
                      />
                      <span className={STAGE_TONE[s].text}>{s}</span>
                      <span className="text-muted-foreground">{fmtNum(sf, 0)} sf</span>
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Gauge label="partitioned" part={partitionedSqft} whole={totalDeclared} />
              <Gauge label="reviewed" part={reviewedSqft} whole={totalDeclared} />
              <Gauge label="synced" part={syncedSqft} whole={totalDeclared} />
            </div>
          </div>
        </div>

        {/* Spatial context, deliberately secondary: a level strip, never a plan. */}
        <div className="flex flex-wrap items-stretch gap-x-6 gap-y-2 border-t border-[var(--line-soft)] px-5 py-2">
          {lanes.map(([label, zs]) => {
            const sf = zs.reduce((s, z) => s + z.zone.declaredSqft, 0);
            return (
              <div key={label} className="min-w-40">
                <p className="tele-label text-muted-foreground">
                  {label}
                  <span className="ml-1.5 normal-case">
                    {zs.length} zones · {fmtNum(sf, 0)} sf
                  </span>
                </p>
                <div className="mt-1 flex gap-px">
                  {zs.map((z) => (
                    <button
                      key={z.zone.key}
                      type="button"
                      title={`${z.zone.key} — ${z.stage} · ${fmtNum(z.zone.declaredSqft, 0)} sf`}
                      onClick={() => {
                        setFocus({ sys: z.tags[0], zone: z.zone.key });
                        if (z.tags[0]) setOpenSystems((p) => ({ ...p, [z.tags[0]!]: true }));
                        setOpenZones((p) => ({ ...p, [z.zone.key]: true }));
                      }}
                      className={cn(
                        "h-4 w-2 rounded-[1px] transition-transform hover:scale-y-150",
                        STAGE_TONE[z.stage].fill,
                        focus.zone === z.zone.key && "ring-1 ring-primary ring-offset-1",
                      )}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </header>

      {/* ── Controls ───────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-background/95 px-5 py-1.5 backdrop-blur">
        <span className="section-label">the system tree</span>
        <span className="tele text-muted-foreground">
          system → zones → rooms · cap {fmtNum(SENSIBLE_CAP_BTUH, 0)} Btu/hr sensible
        </span>
        <div className="ml-auto flex items-center gap-1">
          <span className="tele-label text-muted-foreground">sort</span>
          {(["load", "blockers", "tag"] as const).map((s) => (
            <Button
              key={s}
              size="xs"
              variant={sort === s ? "secondary" : "ghost"}
              onClick={() => setSort(s)}
            >
              {s}
            </Button>
          ))}
          <Button
            size="xs"
            variant={onlyBlocked ? "secondary" : "ghost"}
            onClick={() => setOnlyBlocked((v) => !v)}
          >
            only blocked
          </Button>
        </div>
      </div>

      <div className="space-y-5 px-5 py-4">
        {/* Orphaned area comes first: it is under NO system, so the tree can't hold it. */}
        {untagged.length > 0 && (
          <section className="rounded-[var(--radius)] border border-cat-clay/25 bg-cat-clay/12">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-2.5 py-1.5">
              <span className="section-label text-cat-clay">under no system</span>
              <span className="tele">
                {untagged.length} zones · {fmtNum(
                  untagged.reduce((s, z) => s + z.zone.declaredSqft, 0),
                  0,
                )}{" "}
                sf
              </span>
              <span className="tele text-muted-foreground">
                area the house owns and no equipment answers for — a tag on the Zoning Region FR
                is what moves it into the tree
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-cat-clay/25 px-2.5 py-1.5">
              {untagged.map((z) => (
                <span key={z.zone.key} className="tele inline-flex items-center gap-1.5">
                  <ZoneThumb zone={z.zone} className="size-5" />
                  {z.zone.key}
                  <span className="text-muted-foreground">
                    {fmtNum(z.zone.declaredSqft, 0)} sf
                  </span>
                </span>
              ))}
            </div>
          </section>
        )}

        {sorted.map(({ sys, zones, declaredSqft, roomCount, ventCfm, blockerCount, openCount }) => {
          const isOpen = openSystems[sys.tag] ?? false;
          return (
            <section
              key={sys.tag}
              className={cn(
                "rounded-[var(--radius)] border bg-card",
                sys.overCap ? "border-destructive/40" : "border-[var(--line)]",
              )}
            >
              <SystemHead
                sys={sys}
                open={isOpen}
                zoneCount={zones.length}
                roomCount={roomCount}
                declaredSqft={declaredSqft}
                ventCfm={ventCfm}
                blockerCount={blockerCount}
                openCount={openCount}
                onToggle={() => {
                  toggleSystem(sys.tag);
                  setFocus({ sys: sys.tag });
                }}
              />

              {sys.overCap && (
                <p className="tele flex flex-wrap items-baseline gap-x-2 border-t border-destructive/30 bg-destructive/10 px-2.5 py-1 text-destructive">
                  <span className="tele-label">over cap</span>
                  <span className="normal-case text-foreground/80">
                    {fmtNum(sys.sensibleBtuh - SENSIBLE_CAP_BTUH, 0)} Btu/hr past the{" "}
                    {fmtNum(SENSIBLE_CAP_BTUH, 0)} equipment limit — this System cannot be built as
                    tagged. Split the zone tagging in Revit, or the load has to come down.
                  </span>
                </p>
              )}

              {isOpen && (
                <ul className="divide-y divide-[var(--line-soft)] border-t border-[var(--line)]">
                  {zones.map((z) => (
                    <ZoneRow
                      key={z.zone.key}
                      zone={z}
                      facts={factsOf(z.zone.key)}
                      open={openZones[z.zone.key] ?? false}
                      onToggle={() => {
                        toggleZone(z.zone.key);
                        setFocus({ sys: sys.tag, zone: z.zone.key });
                      }}
                      openRooms={openRooms}
                      onToggleRoom={(room) => {
                        toggleRoom(room.guid);
                        setFocus({ sys: sys.tag, zone: z.zone.key, room });
                      }}
                      resolved={resolved}
                      onDecide={decide}
                      r10Path={world.r10Path}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <RouteChip focus={focus} />
    </main>
  );
}

// ── Header pieces ───────────────────────────────────────────────────────────

function Figure({
  label,
  value,
  unit,
  muted,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  muted?: boolean;
  tone?: "warn" | "bad";
}) {
  return (
    <div>
      <p className="tele-label text-muted-foreground">{label}</p>
      <p
        className={cn(
          "font-pe-mono text-2xl leading-none font-medium tabular-nums tracking-tight",
          muted && "text-muted-foreground",
          tone === "warn" && "text-cat-clay",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </p>
      <p className="tele text-muted-foreground">{unit}</p>
    </div>
  );
}

/** Declared area, segmented by how far each piece of the house has actually got. */
function StageRibbon({ zones, total }: { zones: MockZone[]; total: number }) {
  return (
    <div>
      <p className="tele-label mb-1 text-muted-foreground">declared area by state</p>
      <div className="flex h-7 w-full overflow-hidden rounded-[var(--radius)] border border-[var(--line)]">
        {STAGE_ORDER.map((s) => {
          const sf = zones.filter((z) => z.stage === s).reduce((n, z) => n + z.zone.declaredSqft, 0);
          if (sf === 0) return null;
          const pct = (sf / total) * 100;
          return (
            <div
              key={s}
              title={`${s} — ${STAGE_MEANING[s]} · ${fmtNum(sf, 0)} sf`}
              style={{ width: `${pct}%` }}
              className={cn(
                "flex items-center justify-center border-r border-background/60 last:border-r-0",
                STAGE_TONE[s].fill,
              )}
            >
              {pct > 7 && (
                <span className="tele text-background mix-blend-luminosity">
                  {Math.round(pct)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Gauge({ label, part, whole }: { label: string; part: number; whole: number }) {
  const pct = whole > 0 ? (part / whole) * 100 : 0;
  return (
    <div className="rounded-[var(--radius)] border border-[var(--line)] px-2 py-1.5">
      <p className="tele-label text-muted-foreground">{label}</p>
      <p className="font-pe-mono text-lg leading-tight tabular-nums">{Math.round(pct)}%</p>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-[1px] bg-muted">
        <div className="h-full bg-primary/70" style={{ width: `${pct}%` }} />
      </div>
      <p className="tele mt-1 text-muted-foreground">{fmtNum(part, 0)} sf</p>
    </div>
  );
}

// ── System ──────────────────────────────────────────────────────────────────

function SystemHead({
  sys,
  open,
  zoneCount,
  roomCount,
  declaredSqft,
  ventCfm,
  blockerCount,
  openCount,
  onToggle,
}: {
  sys: MockSystem;
  open: boolean;
  zoneCount: number;
  roomCount: number;
  declaredSqft: number;
  ventCfm: number;
  blockerCount: number;
  openCount: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-2.5 py-2 text-left hover:bg-muted/40"
    >
      <span className="flex w-40 shrink-0 items-baseline gap-1.5">
        <span className="tele w-3 text-muted-foreground">{open ? "▾" : "▸"}</span>
        <span className="font-pe-display text-base font-semibold tracking-tight">{sys.tag}</span>
        <span className="tele text-muted-foreground">{sys.guid.slice(0, 7)}</span>
      </span>

      <span className="min-w-56 flex-1">
        <LoadBar sensible={sys.sensibleBtuh} />
      </span>

      <span className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
        <Stat label="latent" value={`${fmtNum(sys.latentBtuh, 0)} Btu/hr`} />
        <Stat label="vent" value={ventCfm > 0 ? `${fmtNum(ventCfm, 0)} cfm` : "—"} />
        <Stat label="area" value={`${fmtNum(declaredSqft, 0)} sf`} />
        <Stat label="zones" value={String(zoneCount)} />
        <Stat label="rooms" value={String(roomCount)} />
      </span>

      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {openCount > 0 && (
          <span className="tele rounded-[var(--radius)] border border-cat-blue/25 bg-cat-blue/12 px-1.5 py-px text-cat-blue">
            {openCount} to decide
          </span>
        )}
        <span
          className={cn(
            "tele rounded-[var(--radius)] border px-1.5 py-px",
            blockerCount === 0
              ? "border-cat-green/25 bg-cat-green/12 text-cat-green"
              : "border-cat-clay/25 bg-cat-clay/12 text-cat-clay",
          )}
        >
          {blockerCount === 0 ? "real" : `${blockerCount} blocking`}
        </span>
      </span>
    </button>
  );
}

/** Sensible load against the firm 32,000 Btu/hr equipment law. */
function LoadBar({ sensible }: { sensible: number }) {
  const pct = Math.min(100, (sensible / SENSIBLE_CAP_BTUH) * 100);
  const over = sensible > SENSIBLE_CAP_BTUH;
  const overPct = over ? Math.min(60, ((sensible - SENSIBLE_CAP_BTUH) / SENSIBLE_CAP_BTUH) * 100) : 0;
  return (
    <span className="block">
      <span className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="tele-label text-muted-foreground">sensible</span>
        <span
          className={cn(
            "font-pe-mono text-sm tabular-nums",
            over ? "text-destructive" : "text-foreground",
          )}
        >
          {fmtNum(sensible, 0)}
          <span className="tele ml-1 text-muted-foreground">
            / {fmtNum(SENSIBLE_CAP_BTUH, 0)} Btu/hr
          </span>
        </span>
      </span>
      <span className="flex h-2 w-full overflow-hidden rounded-[1px] bg-muted">
        <span
          className={cn("h-full", over ? "bg-destructive/55" : "bg-cat-blue/70")}
          style={{ width: `${pct}%` }}
        />
        {over && (
          <span
            className="h-full bg-destructive"
            style={{ width: `${overPct}%` }}
            title={`${fmtNum(sensible - SENSIBLE_CAP_BTUH, 0)} Btu/hr over cap`}
          />
        )}
      </span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="tele whitespace-nowrap text-muted-foreground">
      {label} <span className="text-foreground">{value}</span>
    </span>
  );
}

// ── Zone ────────────────────────────────────────────────────────────────────

function ZoneRow({
  zone,
  facts,
  open,
  onToggle,
  openRooms,
  onToggleRoom,
  resolved,
  onDecide,
  r10Path,
}: {
  zone: MockZone;
  facts: ZoneFacts;
  open: boolean;
  onToggle: () => void;
  openRooms: Record<string, boolean>;
  onToggleRoom: (room: MockRoom) => void;
  resolved: Resolved;
  onDecide: (room: MockRoom, flag: string, verb: "accept" | "dismiss") => void;
  r10Path: string;
}) {
  const tone = STAGE_TONE[zone.stage];
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-left hover:bg-muted/40"
      >
        <span className="tele w-3 shrink-0 text-muted-foreground">{open ? "▾" : "▸"}</span>
        <ZoneThumb zone={zone.zone} className="size-7" />
        <span className="w-44 min-w-0 shrink-0">
          <span className="block truncate text-xs font-medium">{zone.name}</span>
          <span className="tele block text-muted-foreground">
            {zone.zone.key} · {zone.zone.guid.slice(0, 8)}
          </span>
        </span>
        <span
          className={cn(
            "tele-label shrink-0 rounded-[var(--radius)] border px-1 py-px",
            tone.border,
            tone.bg,
            tone.text,
          )}
          title={STAGE_MEANING[zone.stage]}
        >
          {zone.stage}
        </span>
        <span className="min-w-48 flex-1">
          <ClosureMeter zone={zone} facts={facts} />
        </span>
        <span className="flex shrink-0 flex-wrap items-baseline gap-x-3">
          <Stat label="rooms" value={String(zone.rooms.length)} />
          <Stat
            label="mj"
            value={`${zone.rooms.length - facts.missingData}/${zone.rooms.length}`}
          />
          <Stat
            label=".r10"
            value={`${zone.rooms.length - facts.unsynced}/${zone.rooms.length}`}
          />
        </span>
        {facts.blockers.length > 0 && (
          <span className="tele shrink-0 text-cat-clay">{facts.blockers.length} blocking</span>
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t border-[var(--line-soft)] bg-muted/25 px-2.5 py-2 pl-8">
          {facts.blockers.length === 0 ? (
            <p className="tele text-cat-green">
              nothing blocks this zone — declared area is fully accounted for, reviewed, and in the
              .r10.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {facts.blockers.map((b) => (
                <li key={b.text} className="tele flex flex-wrap items-baseline gap-x-2">
                  <span
                    className={cn(
                      "tele-label shrink-0",
                      b.tone === "warn"
                        ? "text-cat-clay"
                        : b.tone === "hold"
                          ? "text-cat-blue"
                          : "text-muted-foreground",
                    )}
                  >
                    blocks
                  </span>
                  <span className="text-foreground">{b.text}</span>
                  <span className="text-muted-foreground">→ {b.home}</span>
                </li>
              ))}
            </ul>
          )}

          {zone.rooms.length > 0 && (
            <ul className="divide-y divide-[var(--line-soft)] rounded-[var(--radius)] border border-[var(--line)] bg-card">
              {zone.rooms.map((room) => (
                <RoomRow
                  key={room.guid}
                  room={room}
                  open={openRooms[room.guid] ?? false}
                  onToggle={() => onToggleRoom(room)}
                  resolved={resolved}
                  onDecide={onDecide}
                  r10Path={r10Path}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Accounting closure, per zone: rooms + held + claimed wall band must equal the designer's
 * declared area, exactly. The meter shows the parts, not a verdict word.
 */
function ClosureMeter({ zone, facts }: { zone: MockZone; facts: ZoneFacts }) {
  const declared = zone.zone.declaredSqft;
  const parts = [
    { label: "rooms", sf: facts.roomSqft, cls: "bg-cat-blue/60" },
    { label: "held", sf: zone.heldSqft, cls: "bg-cat-kiln/60" },
    { label: "wall", sf: Math.max(0, facts.claimedWallSqft), cls: "bg-cat-slate/45" },
  ];
  const accounted = parts.reduce((s, p) => s + p.sf, 0);
  const unaccounted = Math.max(0, declared - accounted);
  return (
    <span className="block">
      <span className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="tele-label text-muted-foreground">closure</span>
        <span className="tele text-muted-foreground">
          {fmtNum(accounted, 0)} / {fmtNum(declared, 0)} sf declared
          {facts.closure !== null && (
            <span
              className={cn(
                "ml-1.5",
                Math.abs(facts.closure) > 0.6 ? "text-destructive" : "text-cat-green",
              )}
            >
              Δ {fmtNum(facts.closure, 1)}
            </span>
          )}
        </span>
      </span>
      <span className="flex h-1.5 w-full overflow-hidden rounded-[1px] bg-muted">
        {parts.map((p) => (
          <span
            key={p.label}
            className={p.cls}
            title={`${p.label} ${fmtNum(p.sf, 0)} sf`}
            style={{ width: `${declared > 0 ? (p.sf / declared) * 100 : 0}%` }}
          />
        ))}
        {unaccounted > 0.5 && (
          <span
            className="border-l border-dashed border-cat-clay/60 bg-cat-clay/15"
            title={`unaccounted ${fmtNum(unaccounted, 0)} sf`}
            style={{ width: `${(unaccounted / declared) * 100}%` }}
          />
        )}
      </span>
    </span>
  );
}

// ── Room ────────────────────────────────────────────────────────────────────

function RoomRow({
  room,
  open,
  onToggle,
  resolved,
  onDecide,
  r10Path,
}: {
  room: MockRoom;
  open: boolean;
  onToggle: () => void;
  resolved: Resolved;
  onDecide: (room: MockRoom, flag: string, verb: "accept" | "dismiss") => void;
  r10Path: string;
}) {
  const openFlags = openFlagsOf(room, resolved);
  const drifted = room.r10 !== null && room.r10.lastSyncedSqft !== room.sqft;
  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="tele w-3 shrink-0 text-muted-foreground">{open ? "▾" : "▸"}</span>
          <span className="w-40 min-w-0 truncate text-xs">{room.name}</span>
          <span className="tele w-24 shrink-0 text-muted-foreground">{room.type}</span>
          <span className="tele w-16 shrink-0 text-right">{fmtNum(room.sqft, 0)} sf</span>
          <span className="tele w-14 shrink-0 text-right text-muted-foreground">
            {fmtNum(room.ceilingFt, 1)} ft
          </span>
          <DataDots room={room} />
          <span
            className={cn(
              "tele shrink-0",
              room.r10 === null
                ? "text-muted-foreground"
                : drifted
                  ? "text-cat-clay"
                  : "text-cat-green",
            )}
            title={
              room.r10 === null
                ? "never exported — no .r10 link on the Room Region blob"
                : `.r10 Identifier ${room.r10.identifier}, synced ${room.r10.syncedAt}`
            }
          >
            {room.r10 === null
              ? "no .r10"
              : drifted
                ? `#${room.r10.identifier} drift ${fmtNum(room.sqft - room.r10.lastSyncedSqft, 0)} sf`
                : `#${room.r10.identifier}`}
          </span>
        </button>

        {openFlags.length > 0 && (
          <span className="flex shrink-0 flex-wrap items-center gap-1">
            {openFlags.map((flag) => (
              <span
                key={flag}
                className="tele inline-flex items-center gap-1 rounded-[var(--radius)] border border-cat-clay/25 bg-cat-clay/12 px-1.5 py-px"
              >
                <span className="text-cat-clay">{flag}</span>
                <Button size="xs" variant="ghost" onClick={() => onDecide(room, flag, "accept")}>
                  accept
                </Button>
                <Button size="xs" variant="ghost" onClick={() => onDecide(room, flag, "dismiss")}>
                  dismiss
                </Button>
              </span>
            ))}
          </span>
        )}
      </div>

      {open && <ProvenanceCard room={room} resolved={resolved} r10Path={r10Path} />}
    </li>
  );
}

/** Manual J data completeness, one dot per datum: filled = value, ring = assist says none. */
function DataDots({ room }: { room: MockRoom }) {
  const fields: [string, number | null][] = [
    ["people", room.data?.people ?? null],
    ["lighting W", room.data?.lightingW ?? null],
    ["equip sens", room.data?.equipSensible ?? null],
    ["equip lat", room.data?.equipLatent ?? null],
    ["vent cfm", room.data?.ventilationCfm ?? null],
  ];
  return (
    <span className="flex shrink-0 items-center gap-0.5" title={
      room.data === null
        ? "no Manual J data — lives in the .r10"
        : fields.map(([k, v]) => `${k} ${v}`).join(" · ")
    }>
      {fields.map(([k, v]) => (
        <span
          key={k}
          className={cn(
            "inline-block size-1.5 rounded-full border",
            v === null
              ? "border-[var(--line-2)] bg-transparent"
              : v === 0
                ? "border-cat-lichen/60 bg-transparent"
                : "border-cat-lichen bg-cat-lichen",
          )}
        />
      ))}
    </span>
  );
}

/**
 * The room's paper trail: where each datum lives (README data-homes table), the run that
 * proposed it, every decision already taken, and the .r10 link if export has written one.
 */
function ProvenanceCard({
  room,
  resolved,
  r10Path,
}: {
  room: MockRoom;
  resolved: Resolved;
  r10Path: string;
}) {
  const local = Object.entries(resolved)
    .filter(([k]) => k.startsWith(`${room.guid}:`))
    .map(([k, verb]) => ({ flag: k.slice(room.guid.length + 1), verb, at: "just now (session)" }));
  const homes: [string, string][] = [
    ["geometry", "Room Region FR — reshaped only in Revit"],
    ["identity + provenance", "JSON blob on the Room Region FR"],
    ["room type", "PE_M___RoomType on the Room Region FR"],
    ["Manual J data", `the .r10 — ${r10Path}`],
    ["loads", "the .r10 — RHVAC is the calculation authority"],
  ];
  return (
    <div className="grid gap-x-6 gap-y-2 border-t border-[var(--line-soft)] bg-muted/40 px-2 py-2 pl-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <p className="section-label">provenance</p>
        <dl className="mt-0.5 space-y-0.5">
          <Field k="guid" v={room.guid} />
          <Field k="run" v={room.provenance.runId} />
          <Field
            k="source sqft"
            v={`${fmtNum(room.provenance.sourceSqft, 0)} sf detected → ${fmtNum(room.sqft, 0)} sf now`}
          />
          <Field
            k=".r10 link"
            v={
              room.r10
                ? `Identifier ${room.r10.identifier} · synced ${room.r10.syncedAt} · ${fmtNum(room.r10.lastSyncedSqft, 0)} sf`
                : "none — export has never written this room"
            }
          />
        </dl>
        <p className="section-label mt-2">decisions</p>
        {room.decisions.length === 0 && local.length === 0 ? (
          <p className="tele text-muted-foreground">none taken.</p>
        ) : (
          <ul className="mt-0.5 space-y-0.5">
            {[...room.decisions, ...local].map((d, i) => (
              <li key={`${d.flag}-${i}`} className="tele">
                <span className={d.verb === "accept" ? "text-cat-blue" : "text-muted-foreground"}>
                  {d.verb}
                </span>{" "}
                <span className="text-cat-clay">{d.flag}</span>{" "}
                <span className="text-muted-foreground">· {d.at}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="section-label">where each datum lives</p>
        <dl className="mt-0.5 space-y-0.5">
          {homes.map(([k, v]) => (
            <Field key={k} k={k} v={v} />
          ))}
        </dl>
        <Seam className="mt-2">
          this card is read-only by law — the web never edits geometry, and Manual J values are
          written through the export lane, not here
        </Seam>
      </div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="tele-label w-28 shrink-0 text-muted-foreground">{k}</dt>
      <dd className="tele min-w-0 flex-1 break-all">{v}</dd>
    </div>
  );
}

// ── Routing proposal (mock) ─────────────────────────────────────────────────

function RouteChip({ focus }: { focus: { sys?: string; zone?: string; room?: MockRoom } }) {
  const params = [
    "variant=house",
    focus.sys && `sys=${focus.sys}`,
    focus.zone && `zone=${encodeURIComponent(focus.zone)}`,
    focus.room && `room=${focus.room.guid.slice(0, 8)}`,
  ].filter(Boolean) as string[];
  return (
    <div className="fixed right-4 bottom-14 z-20 max-w-md rounded-[var(--radius)] border border-[var(--line-2)] bg-popover/95 px-2 py-1.5 shadow-sm backdrop-blur">
      <p className="tele-label text-muted-foreground">proposed url</p>
      <p className="tele break-all">/takeoff?{params.join("&")}</p>
      <Seam className="mt-1">
        selection is not in the URL yet — system/zone/room would be search params so a blocker is
        linkable in review
      </Seam>
    </div>
  );
}
