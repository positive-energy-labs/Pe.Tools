import { token } from "#/lib/token";
// The takeoff run browser — the one /runs surface. A sheet of two-column zone cards is the page
// body, grouped into level sections; the PLAN docks collapsible + resizable at the TOP (atlas
// presentation law); the STAGING TRAY docks collapsible at the RIGHT of the A/B section
// (feedback round-2 ruling: tray won, deck and ledger variants died as chrome); the LEDGER
// docks collapsible at the BOTTOM, and its row marks ARE the run selector. A/B against the
// chronological predecessor is the DEFAULT state, not a mode you enter: clearing the baseline
// never shifts the layout, it only empties the A side of each card.
//
// Lens vs pin (feedback round-2 state model): the page's A/B selection is a viewing LENS;
// staged items PIN their pair at stage time and switching the lens never alters the stage.
// "Review staged" flips the sheet to a single-column layout of the staged items at their
// pinned pairs — same ZoneCard, two layouts (the deck's surviving UX).
//
// visual-law.json owns the drawing: registered Revit plan substrate, optional replay evidence,
// saturated candidate fills, held hatching, and hairline dashed zone authority.
//
// Promoted from the round-2 `combo` prototype at round close, 2026-08-17 — the three round-1
// variants (sheet/ledger/light) and the variant switcher are deleted; git history holds them at
// a26916e/33139e2. The feedback round-1 variants (?fb=tray|deck|ledger + switcher) died at the
// round-2 ruling; history holds them at 34ce188. Open stand-ins are ledgered in
// docs/features/takeoff-runs/SHIMS.md.
import {
  type CSSProperties,
  type Dispatch,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { MasterTable } from "#/components/master-table/master-table";
import { fmtNum, type Column, type MasterTableState } from "#/components/master-table/model";
import { FactChip as Chip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { Pane, PaneSplit } from "#/components/ui/pane";
import { cn } from "#/lib/utils";

import { hydrateFromSet } from "./feedback/hydrate";
import { fb, itemKey, type StagedItem, useFb } from "./feedback/staging";
import { NoteInput } from "./feedback/verbs";
import { type Lens, Tray, TrayCollapsed } from "./feedback/tray";
import {
  candidateTone,
  CLOSE_M,
  HELD_HATCH,
  INK_M,
  LABEL,
  LABEL_SIZE,
  PLAN_LAW,
  RESIDUE_TREATMENT,
  type ResidueKind,
  SEAL_DOOR,
  SEAL_RUN,
  ZONE_STROKE,
  ZONE_WIDTH,
} from "./palette";
import {
  boardSummary,
  fetchRunIndex,
  loadPlan,
  loadReplaySeedInk,
  loadRaster,
  loadRunReport,
  loadRunScores,
  loadSealClasses,
  loadZoneGeometry,
  matchZone,
  modalZoneCount,
  paintPlan,
  paintClassRaster,
  paintRaster,
  pairZones,
  type Partiality,
  partiality,
  poolModalZones,
  type Raster,
  type RegisteredPlan,
  ringPath,
  type RunIndexEntry,
  type RunReport,
  type RunScores,
  scoreBoards,
  planFrame,
  toPx,
  type ZoneGeometry,
  type ZonePair,
  type ZoneRecord,
  type ZoneViewport,
  zoneViewport,
} from "./world";
import { Press } from "#/components/lang/press";

// Palette lives in ./palette — shared with the export compositor so the PNGs an agent reads
// match the screen (round-1 friction #1 resolved). UNKNOWN_STROKE/UNKNOWN_FILL live there too:
// the export must not dress a disposition-unknown room as accepted either (SHIMS.md #3).

const UNKNOWN_TITLE =
  "Disposition unknown — this package predates the persisted ROOM disposition column. " +
  "Not drawn as accepted; re-run the harness for a package that says which rooms it accepted.";

const PX_PER_FT = 4; // plan world px per model foot at scale=1 (1px per 0.25ft cell)

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

const fmtSqft = (v: number) => `${Math.round(v).toLocaleString()} sf`;
const fmtPct = (v: number) => `${Math.round(v * 100)}%`;

function fmtTime(utc: string): string {
  const d = new Date(utc);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const zoneShort = (name: string) => (name.includes("#") ? `#${name.split("#")[1]}` : name);

/** The zone's adaptive-policy deviations. Typed on ZoneRecord now; empty on every run in the
 * pool because the adaptive seam carries no live rules yet — the card simply shows nothing. */
function adaptedKnobs(zone: ZoneRecord): [string, string][] {
  return Object.entries(zone.adaptedKnobs ?? {});
}

function topRejections(zone: ZoneRecord, n = 3): [string, number][] {
  return Object.entries(zone.Rejections)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

// ---- partial-run marks (the 20260817-161144 misattribution close) ----
// A zone-filtered package must SAY so wherever it can be mistaken for a baseline. Never block,
// always inform.

const partialTitle = (zone: string) =>
  `Partial run — the harness executed under PE_TAKEOFF_ZONE, so this package holds only zones ` +
  `matching "${zone}". Its board and scores cover that slice, not the full baseline scope; ` +
  `pairing it against a full run measures the filter, not the knobs.`;

const possiblyPartialTitle = (zones: number, modal: number) =>
  `Possibly partial — pre-field package: it predates the persisted zoneFilter field, so it ` +
  `cannot say whether it ran zone-filtered, and it holds ${zones} zones where the pool's modal ` +
  `full run holds ${modal} (run 20260817-161144 lied exactly this way). Trust it as a baseline ` +
  `accordingly.`;

/** The partiality mark. `compact` for tight table cells; full sentence otherwise. */
function PartialityChip(props: { part: Partiality | null; prefix?: string; compact?: boolean }) {
  const { part, prefix = "", compact = false } = props;
  if (!part || part.kind === "full") return null;
  if (part.kind === "partial") {
    return (
      <Chip tone="caution" title={partialTitle(part.zone)}>
        {prefix}
        {compact
          ? `partial · ${zoneShort(part.zone)}`
          : `partial run — zone-filtered: ${part.zone}`}
      </Chip>
    );
  }
  return (
    <Chip tone="caution" dashed title={possiblyPartialTitle(part.zones, part.modal)}>
      {prefix}
      {compact
        ? `partial? ${part.zones}/${part.modal}`
        : `possibly partial — pre-field package (${part.zones}/${part.modal} zones)`}
    </Chip>
  );
}

/** Why this A/B pairing is suspect, or null when it is clean. Both-sides-filtered-to-the-same-
 * zone is the tuning loop's legitimate case and gets no caveat. */
function pairingCaveat(a: Partiality, b: Partiality): string | null {
  const aFull = a.kind === "full";
  const bFull = b.kind === "full";
  if (aFull && bFull) return null;
  if (a.kind === "partial" && b.kind === "partial") {
    return a.zone === b.zone
      ? null
      : `A and B were filtered to DIFFERENT zones ("${a.zone}" vs "${b.zone}") — this A/B compares different slices of the building.`;
  }
  if (!aFull && !bFull) {
    return "Both sides of this A/B are partial (or possibly partial) packages with no declared common filter — the pairing may compare different slices of the building.";
  }
  if (!aFull) {
    return "The baseline (A) is a partial (or possibly partial) package paired against a full current run — the Δs measure the missing zones, not the knobs.";
  }
  return "The current run (B) is a partial (or possibly partial) package paired against a full baseline — the Δs measure the missing zones, not the knobs.";
}

/** How a STAGED pair was matched. A staged item snapshots the two ZoneRecords, not the pairing
 * that produced them, so this re-derives it: two v4-keyed sides carrying the SAME zoneKey were
 * matched by stable identity; anything else came from the positional-name fallback and must say
 * so on the review card exactly as it does on the sheet (SHIMS.md #2 close). */
function stagedPairedBy(item: StagedItem): "key" | "name" {
  const key = item.a?.zoneKey;
  return key && item.b?.zoneKey === key ? "key" : "name";
}

/** Did the zone materially move between the two runs? (ledger's materiality donation) */
function materiallyChanged(a: ZoneRecord | null, b: ZoneRecord | null): boolean {
  if (!a || !b) return true;
  return (
    a.AcceptedRooms !== b.AcceptedRooms ||
    Math.abs(b.AcceptedSqft - a.AcceptedSqft) > 0.5 ||
    a.triage.verdict !== b.triage.verdict
  );
}

function useElementWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Signed delta, toned by improvement direction. Held improves DOWN. (ledger donation) */
function Delta({
  value,
  digits = 0,
  goodWhenUp = true,
  suffix = "",
}: {
  value: number | null;
  digits?: number;
  goodWhenUp?: boolean;
  suffix?: string;
}) {
  if (value === null) return <span className="text-ink-2/60">—</span>;
  const eps = 0.5 * 10 ** -digits; // half a display unit — matches every precision, incl. scorer's 3

  if (Math.abs(value) < eps) {
    return (
      <span className="text-ink-2/60" title="No change vs the baseline run.">
        ·
      </span>
    );
  }
  const good = goodWhenUp ? value > 0 : value < 0;
  return (
    <span className="tabular-nums" style={{ color: good ? token("done") : token("caution") }}>
      {value > 0 ? "+" : ""}
      {fmtNum(value, digits)}
      {suffix}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Zone panel — sheet.tsx's card renderer, repainted under the round-2 underlay law.
// Canvas: paper, then decision fills (under evidence — a decision may never obscure ink),
// then muted invented closures (screened), then muted received ink (solid) LAST.
// SVG: rebalanced decision strokes on top. One shared viewport so layers cannot drift.
// ---------------------------------------------------------------------------

/** The instant room-id popover (round-2 change #1): the native <title> tooltip "displays too
 * slowly to be useful" — this follows the cursor with zero delay whenever it is over a
 * flaggable element, showing the element id (the DATA) and nothing else. */
type PanelHover = { label: string; flaggable: boolean; flagged: boolean; x: number; y: number };

function HatchPattern(props: {
  id: string;
  color: string;
  hatch?: { angleDeg: number; spacingPx: number; widthPx: number };
}) {
  const hatch = props.hatch ?? HELD_HATCH;
  return (
    <pattern
      id={props.id}
      width={hatch.spacingPx}
      height={hatch.spacingPx}
      patternUnits="userSpaceOnUse"
      patternTransform={`rotate(${hatch.angleDeg})`}
    >
      <line y2={hatch.spacingPx} stroke={props.color} strokeWidth={hatch.widthPx} />
    </pattern>
  );
}

const heldPatternId = (runId: string, zone: ZoneRecord, candidateId: string) =>
  `held-${encodeURIComponent(`${runId}/${zone.zoneKey ?? zone.Zone}/${candidateId}`)}`;
const residuePatternId = (runId: string, zone: ZoneRecord, elementId: string, kind: ResidueKind) =>
  `residue-${kind}-${encodeURIComponent(`${runId}/${zone.zoneKey ?? zone.Zone}/${elementId}`)}`;
const residueKind = (reason: string): ResidueKind => (reason === "excluded" ? "excluded" : "void");

export function ZonePanel(props: {
  runId: string;
  zone: ZoneRecord;
  maxW: number;
  maxH: number;
  underlay: boolean;
  /** Staged-item key — when set AND that exact pair is staged, rooms/residues become
   * flaggable (click toggles; flagged = alarm family). Flags land on B only. */
  fbKey?: string;
}) {
  const { runId, zone, maxW, maxH, underlay } = props;
  const { items, hoverFlag } = useFb();
  const stagedItem = props.fbKey ? (items.find((i) => i.key === props.fbKey) ?? null) : null;
  // A flag chip under the cursor lights its shape on THIS panel (chips are per staged item, so
  // the item key is part of the token — room ids repeat across zones).
  const lit = (el: string) => hoverFlag !== null && hoverFlag === `${props.fbKey}::${el}`;
  const flags = useMemo(() => new Set(stagedItem?.flags ?? []), [stagedItem]);
  const toggleFlag = (el: string) => {
    if (stagedItem) fb.toggleFlag(stagedItem.key, el);
  };
  const [hover, setHover] = useState<PanelHover | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const trackHover = (label: string, flagged: boolean) => (e: React.PointerEvent) => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({
      label,
      flaggable: stagedItem !== null,
      flagged,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };
  const vp: ZoneViewport = useMemo(() => {
    const pad = 4;
    const wFt = zone.MaxX - zone.MinX + pad * 2;
    const hFt = zone.MaxY - zone.MinY + pad * 2;
    const pxPerFt = Math.min(7, Math.max(0.4, Math.min(maxW / wFt, maxH / hFt)));
    return zoneViewport(zone, pxPerFt, pad);
  }, [zone, maxW, maxH]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [geom, setGeom] = useState<ZoneGeometry | null>(null);
  const [plan, setPlan] = useState<RegisteredPlan | null>();

  useEffect(() => {
    let live = true;
    loadZoneGeometry(runId, zone.Tsv)
      .then((g) => live && setGeom(g))
      .catch(() => live && setGeom({ rooms: [], polys: new Map(), residues: [] }));
    return () => {
      live = false;
    };
  }, [runId, zone.Tsv]);

  useEffect(() => {
    let live = true;
    setPlan(undefined);
    loadPlan(runId, zone.Ink)
      .then((value) => live && setPlan(value))
      .catch(() => live && setPlan(null));
    return () => {
      live = false;
    };
  }, [runId, zone.Ink]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !geom) return;
    let live = true;
    void (async () => {
      const [ink, seals, close, sealClasses] = underlay
        ? await Promise.all([
            loadReplaySeedInk(runId, zone.Ink).catch(() => null),
            zone.Seals ? loadRaster(runId, zone.Seals).catch(() => null) : null,
            zone.Close ? loadRaster(runId, zone.Close).catch(() => null) : null,
            zone.Seals ? loadSealClasses(runId, zone.Seals).catch(() => null) : null,
          ])
        : [null, null, null, null];
      if (!live) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = token("page");
      ctx.fillRect(0, 0, vp.widthPx, vp.heightPx);
      if (plan) {
        paintPlan(
          ctx,
          plan,
          vp,
          [zone.ZoneLoops as [number, number][][]],
          PLAN_LAW.blackPoint,
          PLAN_LAW.whitePoint,
          PLAN_LAW.insideZoneOpacity,
          PLAN_LAW.outsideZoneOpacity,
        );
      }
      // gap (SHIMS.md #6): world.ts paintRaster has no speck filter — the python renderer hides
      // closure components < 0.25 sf; here single-cell closure speckle paints as-is (muted, at
      // least). The two renderers therefore disagree about what a closure "looks like".
      try {
        if (close) paintRaster(ctx, close, vp, CLOSE_M);
        if (sealClasses) {
          paintClassRaster(ctx, sealClasses, vp, new Set([2, 4]), SEAL_DOOR);
          paintClassRaster(ctx, sealClasses, vp, new Set([3]), SEAL_RUN);
        } else if (seals) paintRaster(ctx, seals, vp, SEAL_DOOR);
        if (ink) paintRaster(ctx, ink, vp, INK_M);
      } catch {
        // evidence layer failed — the decision fills underneath stay visible
      }
    })();
    return () => {
      live = false;
    };
  }, [runId, zone, vp, geom, plan, underlay]);

  return (
    <div
      ref={hostRef}
      className="relative shrink-0 overflow-hidden"
      style={{ width: maxW, height: maxH, backgroundColor: token("page"), borderRadius: 2 }}
    >
      <div
        className="absolute"
        style={{
          left: (maxW - vp.widthPx) / 2,
          top: (maxH - vp.heightPx) / 2,
          width: vp.widthPx,
          height: vp.heightPx,
        }}
      >
        <canvas ref={canvasRef} width={vp.widthPx} height={vp.heightPx} />
        <svg className="absolute inset-0" width={vp.widthPx} height={vp.heightPx} aria-hidden>
          <defs>
            {geom?.rooms
              .filter((room) => room.disposition === "held")
              .map((room) => (
                <HatchPattern
                  key={`pattern:${room.id}`}
                  id={heldPatternId(runId, zone, room.id)}
                  color={candidateTone(zone.Zone, room.id).dark}
                />
              ))}
            {geom?.rooms
              .filter((room) => room.disposition === null)
              .map((room) => (
                <HatchPattern
                  key={`void-room-pattern:${room.id}`}
                  id={residuePatternId(runId, zone, `room:${room.id}`, "void")}
                  color={RESIDUE_TREATMENT.void.hatch.color}
                  hatch={RESIDUE_TREATMENT.void.hatch}
                />
              ))}
            {geom?.residues
              .filter((res) => res.reason === "rejected")
              .map((res) => (
                <HatchPattern
                  key={`pattern:${res.id}`}
                  id={heldPatternId(runId, zone, res.id)}
                  color={candidateTone(zone.Zone, res.id).dark}
                />
              ))}
            {geom?.residues
              .filter((res) => res.reason !== "rejected")
              .map((res) => {
                const kind = residueKind(res.reason);
                return (
                  <HatchPattern
                    key={`${kind}-residue-pattern:${res.id}`}
                    id={residuePatternId(runId, zone, `residue:${res.id}`, kind)}
                    color={RESIDUE_TREATMENT[kind].hatch.color}
                    hatch={RESIDUE_TREATMENT[kind].hatch}
                  />
                );
              })}
          </defs>
          {geom?.rooms.map((room) => {
            const rings = geom.polys.get(room.id);
            if (!rings) return null;
            // A flag is DATA — the element id, not pixels. Hover-id is always live; the click
            // arms only when this exact pair is staged.
            const flagged = flags.has(`room:${room.id}`);
            const hot = lit(`room:${room.id}`);
            // Unflagged, the room wears its PERSISTED disposition (SHIMS.md #3): unknown is a
            // dashed neutral that carries the caveat, never the accepted blue. Flagged, the
            // alarm overrides — a user's flag is louder than a provenance tint.
            const tone = candidateTone(zone.Zone, room.id);
            const residue = room.disposition === null ? RESIDUE_TREATMENT.void : null;
            const d = ringPath(
              vp,
              rings.map((r) => r.points),
            );
            const [labelX, labelY] = toPx(vp, room.lx, room.ly);
            return (
              <g key={room.id}>
                <path
                  d={d}
                  fill={residue ? "none" : tone.fill}
                  stroke={hot || flagged ? token("alarm") : (residue?.outline.color ?? "none")}
                  strokeWidth={hot ? 4 : flagged ? 2.5 : (residue?.outline.widthPx ?? 0)}
                  pointerEvents="all"
                  style={{ cursor: stagedItem ? "crosshair" : "default" }}
                  onPointerMove={trackHover(`room ${room.id}`, flagged)}
                  onPointerLeave={() => setHover(null)}
                  onClick={stagedItem ? () => toggleFlag(`room:${room.id}`) : undefined}
                >
                  {room.disposition === null ? <title>{UNKNOWN_TITLE}</title> : null}
                </path>
                {residue ? (
                  <path
                    d={d}
                    fill={`url(#${residuePatternId(runId, zone, `room:${room.id}`, "void")})`}
                    pointerEvents="none"
                  />
                ) : null}
                {room.disposition === "held" ? (
                  <path
                    d={d}
                    fill={`url(#${heldPatternId(runId, zone, room.id)})`}
                    pointerEvents="none"
                  />
                ) : null}
                {room.disposition ? (
                  <text
                    x={labelX}
                    y={labelY}
                    fill={LABEL}
                    fontSize={LABEL_SIZE}
                    fontFamily="var(--font-mono)"
                    textAnchor="middle"
                    pointerEvents="none"
                  >
                    {room.disposition === "held" ? "H" : "A"} {room.id}
                  </text>
                ) : null}
              </g>
            );
          })}
          {geom?.residues.map((res) => {
            const flagged = flags.has(`residue:${res.id}`);
            const hot = lit(`residue:${res.id}`);
            const held = res.reason === "rejected";
            const kind = residueKind(res.reason);
            const residue = held ? null : RESIDUE_TREATMENT[kind];
            const tone = candidateTone(zone.Zone, res.id);
            const d = ringPath(vp, res.loops);
            const labelPoint = res.loops[0]?.[0];
            return (
              <g key={res.id}>
                <path
                  d={d}
                  fill={held ? tone.fill : "none"}
                  stroke={hot || flagged ? token("alarm") : (residue?.outline.color ?? "none")}
                  strokeWidth={hot ? 4 : flagged ? 2.5 : (residue?.outline.widthPx ?? 0)}
                  pointerEvents="all"
                  style={{ cursor: stagedItem ? "crosshair" : "default" }}
                  onPointerMove={trackHover(`residue ${res.id}`, flagged)}
                  onPointerLeave={() => setHover(null)}
                  onClick={stagedItem ? () => toggleFlag(`residue:${res.id}`) : undefined}
                />
                {residue ? (
                  <path
                    d={d}
                    fill={`url(#${residuePatternId(runId, zone, `residue:${res.id}`, kind)})`}
                    pointerEvents="none"
                  />
                ) : null}
                {held ? (
                  <>
                    <path
                      d={d}
                      fill={`url(#${heldPatternId(runId, zone, res.id)})`}
                      pointerEvents="none"
                    />
                    {labelPoint ? (
                      <text
                        x={toPx(vp, labelPoint[0], labelPoint[1])[0]}
                        y={toPx(vp, labelPoint[0], labelPoint[1])[1]}
                        fill={LABEL}
                        fontSize={LABEL_SIZE}
                        fontFamily="var(--font-mono)"
                        pointerEvents="none"
                      >
                        H {res.id}
                      </text>
                    ) : null}
                  </>
                ) : null}
              </g>
            );
          })}
          <path
            d={ringPath(vp, zone.ZoneLoops as [number, number][][])}
            fill="none"
            stroke={ZONE_STROKE}
            strokeWidth={ZONE_WIDTH}
            className="dash-reference"
          />
        </svg>
      </div>
      {plan === null ? (
        <div className="face-mono absolute bottom-1 left-1 border bg-page/90 px-1 t-caption text-ink-2">
          plan unavailable in this package
        </div>
      ) : null}
      {/* Instant id popover — replaces the slow native tooltip on these elements. */}
      {hover && (
        <div
          className="face-mono pointer-events-none absolute z-10 whitespace-nowrap border bg-page/95 px-1.5 py-0.5 t-caption shadow-sm"
          style={{
            left: Math.min(hover.x + 10, maxW - 90),
            top: Math.min(hover.y + 12, maxH - 22),
            borderColor: hover.flagged ? token("alarm") : token("line-2"),
            color: hover.flagged ? token("alarm") : token("ink"),
            borderRadius: 2,
          }}
        >
          {hover.flagged ? "⚑ " : ""}
          {hover.label}
        </div>
      )}
    </div>
  );
}

function MissingPanel(props: { w: number; h: number; label: string }) {
  return (
    <div
      className="face-mono flex shrink-0 items-center justify-center bg-recess t-label text-ink-2"
      style={{ width: props.w, height: props.h, borderRadius: 2 }}
    >
      {props.label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage button — pins the card's CURRENT pair into the staging tray. The lens is a view;
// the stage is a pin (round-2 state model). When the zone is already staged under a
// different pair, a subtle ⚑ mark says so — clicking it swings the lens to that pair.
// ---------------------------------------------------------------------------

function StageButton(props: {
  name: string;
  runA: string | null;
  runB: string;
  a: ZoneRecord | null;
  b: ZoneRecord | null;
  onSwing: (item: StagedItem) => void;
}) {
  const { items } = useFb();
  const key = itemKey(props.name, props.runA, props.runB);
  const staged = items.some((i) => i.key === key);
  const otherPairs = items.filter((i) => i.zone === props.name && i.key !== key);
  return (
    <>
      {otherPairs.length > 0 && (
        <Press
          type="button"
          onClick={() => props.onSwing(otherPairs[0]!)}
          title={`This zone is staged under ${otherPairs.length} other A/B pair${otherPairs.length === 1 ? "" : "s"} (pinned at stage time; the lens is only a view). Click to swing the lens to the pinned pair.`}
          className="face-mono shrink-0 t-caption"
          style={{ color: token("caution") }}
        >
          ⚑{otherPairs.length}≠
        </Press>
      )}
      <Press
        type="button"
        onClick={() =>
          fb.toggleStage({
            key,
            zone: props.name,
            level: (props.b ?? props.a)?.Level ?? "?",
            runA: props.runA,
            runB: props.runB,
            a: props.a,
            b: props.b,
          })
        }
        title={
          staged
            ? "Staged for export (this exact A/B pair is pinned) — click to unstage. Click rooms/residues on the B panel to flag them."
            : "Stage this zone's current A/B pair for the feedback export. The pair is pinned at stage time; switching the lens afterwards never alters it."
        }
        className="face-mono shrink-0 border px-1.5 t-caption"
        style={{
          borderRadius: 2,
          borderColor: staged ? token("alarm") : token("line-2"),
          color: staged ? token("alarm") : token("ink-2"),
        }}
      >
        {staged ? "staged ✓" : "＋ stage"}
      </Press>
    </>
  );
}

// ---------------------------------------------------------------------------
// Zone card — the round-2 rich summary. A|B panels side by side by DEFAULT; with the baseline
// cleared the single panel spans the same footprint (the page grid never shifts). Stats are a
// fixed-row A/B table so the eye can column-scan the whole sheet. The SAME component renders
// the review-staged layout — one card, two layouts (round-2 ruling).
// ---------------------------------------------------------------------------

type StatRow = {
  label: string;
  value: (z: ZoneRecord) => ReactNode;
  delta?: (a: ZoneRecord, b: ZoneRecord) => ReactNode;
};

const STAT_ROWS: StatRow[] = [
  {
    label: "verdict",
    value: (z) => (
      <span style={{ color: z.triage.verdict === "solve" ? token("done") : token("caution") }}>
        {z.triage.verdict}
        <span className="text-ink-2"> · {z.triage.reason}</span>
      </span>
    ),
  },
  {
    label: "accepted",
    value: (z) => `${z.AcceptedRooms}/${z.OracleRooms}r · ${fmtSqft(z.AcceptedSqft)}`,
    delta: (a, b) => <Delta value={b.AcceptedSqft - a.AcceptedSqft} suffix=" sf" />,
  },
  {
    label: "held",
    value: (z) => `${z.HeldRooms}r · ${fmtSqft(z.HeldSqft)}`,
    delta: (a, b) => <Delta value={b.HeldSqft - a.HeldSqft} goodWhenUp={false} suffix=" sf" />,
  },
  {
    label: "ink-backed",
    value: (z) => fmtPct(z.InkBackedEdgeFraction),
    delta: (a, b) => (
      <Delta
        value={(b.InkBackedEdgeFraction - a.InkBackedEdgeFraction) * 100}
        digits={1}
        suffix="pp"
      />
    ),
  },
  {
    label: "closure",
    value: (z) =>
      `dh ${Math.round(z.closure.doorHeadSqft)} · wall ${Math.round(z.closure.wallRunGapSqft)} · gap ${Math.round(z.closure.gapCloseSqft)}`,
  },
  {
    label: "rejections",
    value: (z) => {
      const top = topRejections(z, 2);
      return top.length === 0 ? (
        <span className="text-ink-2">none</span>
      ) : (
        top.map(([k, n]) => `${k} ×${n}`).join(" · ")
      );
    },
  },
];

function ZoneCard(props: {
  name: string;
  a: ZoneRecord | null; // baseline (older)
  b: ZoneRecord | null; // current
  /** How the A side was matched: "key" = stable zone identity (report v4); "name" = positional
   * ordinal fallback for pre-key packages — surfaced as a caveat because it can silently compare
   * different geography (SHIMS.md #2). */
  pairedBy: "key" | "name";
  runA: string | null;
  runB: string;
  panelFullW: number;
  panelHalfW: number;
  panelH: number;
  underlay: boolean;
  /** Round-2 change #3: "focus" died, HIGHLIGHT is a toggle — persistent until clicked again
   * or another zone is chosen; the button state syncs with the plan's highlight. */
  highlighted: boolean;
  onToggleHighlight: (zone: ZoneRecord) => void;
  onSwing: (item: StagedItem) => void;
}) {
  const { name, a, b, pairedBy, runA, runB, panelFullW, panelHalfW, panelH, underlay } = props;
  const comparing = runA !== null;
  const deltaSf = comparing && a && b ? Math.round(b.AcceptedSqft - a.AcceptedSqft) : null;
  const locatable = b ?? a;
  const knobs = b ? adaptedKnobs(b) : [];
  // The staged-item key for THIS pair. Flags land on the B side — the run under judgment.
  const fbKey = itemKey(name, runA, runB);

  return (
    <div
      className="flex min-w-0 flex-col gap-1.5 border bg-page p-2"
      style={{ borderColor: token("line-2"), borderRadius: 2 }}
    >
      <div className="flex items-baseline gap-2">
        <span className="face-mono t-value font-semibold" title={name}>
          {zoneShort(name)}
        </span>
        {b ? (
          <Chip
            tone={b.triage.verdict === "solve" ? "done" : "caution"}
            title={`Triage verdict for the current run: ${b.triage.verdict} — ${b.triage.reason}`}
          >
            {b.triage.verdict}
          </Chip>
        ) : (
          <Chip
            tone="meta"
            title="This zone exists only in the baseline run — the zoning pass cut the level differently."
          >
            baseline only
          </Chip>
        )}
        {comparing && pairedBy === "name" ? (
          <Chip
            tone="meta"
            dashed
            title="One or both packages predate the stable zone key (report v4), so A/B was matched by the positional zone NAME. If zoning itself moved between the runs, this pair can compare different geography without warning."
          >
            paired by name — pre-key package
          </Chip>
        ) : null}
        {deltaSf !== null && deltaSf !== 0 ? (
          <span className="face-mono t-label">
            Δ<Delta value={deltaSf} suffix=" sf" />
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <StageButton name={name} runA={runA} runB={runB} a={a} b={b} onSwing={props.onSwing} />
          {locatable ? (
            <Press
              type="button"
              onClick={() => props.onToggleHighlight(locatable)}
              title={
                props.highlighted
                  ? "Highlighted on the plan — click to clear the highlight."
                  : "Highlight this zone on the plan (opens + centers the plan dock). Stays lit until you click again, pick another zone, or hit esc."
              }
              className={cn(
                "face-mono shrink-0 border px-1.5 t-caption",
                props.highlighted ? "bg-recess text-ink" : "text-ink-2 hover:text-ink",
              )}
              style={{
                borderColor: props.highlighted ? token("ink-2") : token("line-2"),
                borderRadius: 2,
              }}
            >
              ⌖ highlight
            </Press>
          ) : null}
        </span>
      </div>

      {/* Panel strip: A|B when a baseline is set; the single panel SPANS the same footprint
          otherwise — the card (and the page grid) never changes size. */}
      <div className="flex gap-2">
        {comparing ? (
          <>
            {a && runA ? (
              <ZonePanel
                runId={runA}
                zone={a}
                maxW={panelHalfW}
                maxH={panelH}
                underlay={underlay}
              />
            ) : (
              <MissingPanel w={panelHalfW} h={panelH} label="not in baseline" />
            )}
            {b ? (
              <ZonePanel
                runId={runB}
                zone={b}
                maxW={panelHalfW}
                maxH={panelH}
                underlay={underlay}
                fbKey={fbKey}
              />
            ) : (
              <MissingPanel w={panelHalfW} h={panelH} label="not in current" />
            )}
          </>
        ) : b ? (
          <ZonePanel
            runId={runB}
            zone={b}
            maxW={panelFullW}
            maxH={panelH}
            underlay={underlay}
            fbKey={fbKey}
          />
        ) : (
          <MissingPanel w={panelFullW} h={panelH} label="not in run" />
        )}
      </div>

      <table className="face-mono w-full table-fixed t-label">
        <colgroup>
          <col className="w-[76px]" />
          {comparing ? (
            <>
              <col />
              <col />
              <col className="w-[84px]" />
            </>
          ) : (
            <col />
          )}
        </colgroup>
        {comparing ? (
          <thead>
            <tr className="t-caption text-ink-2">
              <th aria-label="stat" />
              <th className="text-left font-normal">A · baseline</th>
              <th className="text-left font-normal">B · current</th>
              <th className="text-right font-normal">Δ</th>
            </tr>
          </thead>
        ) : null}
        <tbody>
          {STAT_ROWS.map((row) => (
            <tr key={row.label} className="align-top">
              <td className="pr-2 text-ink-2">{row.label}</td>
              {comparing ? (
                <>
                  <td className="truncate pr-2">{a ? row.value(a) : "—"}</td>
                  <td className="truncate pr-2">{b ? row.value(b) : "—"}</td>
                  <td className="text-right">{row.delta && a && b ? row.delta(a, b) : ""}</td>
                </>
              ) : (
                <td className="truncate">{b ? row.value(b) : "—"}</td>
              )}
            </tr>
          ))}
          {knobs.length > 0 ? (
            <tr className="align-top">
              <td className="pr-2 text-ink-2">knobs</td>
              <td colSpan={comparing ? 3 : 1}>
                <span className="flex flex-wrap gap-1">
                  {knobs.map(([k, v]) => (
                    <Chip
                      key={k}
                      tone="meta"
                      dashed
                      title={`Solver self-tuned ${k} to ${v} for this zone.`}
                    >
                      {k}={v}
                    </Chip>
                  ))}
                </span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run strip — sheet.tsx's scrubber, reshaped for the round-2 model: click = current run (B),
// the corner button = baseline (A). It earns its header space because the ledger dock is
// collapsed by default.
// ---------------------------------------------------------------------------

function RunStrip(props: {
  runs: RunIndexEntry[];
  curId: string | null;
  prevId: string | null;
  onPickCur: (id: string) => void;
  onPickBaseline: (id: string) => void;
}) {
  const { runs, curId, prevId, onPickCur, onPickBaseline } = props;
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {runs.map((entry) => {
        const isCur = entry.id === curId;
        const isPrev = entry.id === prevId;
        const meta = entry.meta;
        return (
          <div
            key={entry.id}
            className="flex shrink-0 items-stretch overflow-hidden border"
            style={{
              borderColor: isCur || isPrev ? token("ink-2") : token("line-2"),
              borderRadius: 2,
              backgroundColor: isCur ? token("recess") : "transparent",
            }}
          >
            <Press
              type="button"
              onClick={() => onPickCur(entry.id)}
              className="flex flex-col items-start px-2 py-1 text-left"
              title={`${entry.id} — click to make this the CURRENT run (B).`}
            >
              <span className="face-mono t-value">
                {isCur ? <b>B · </b> : null}
                {meta?.label ?? entry.id.slice(0, 15)}
              </span>
              <span className="face-mono t-caption text-ink-2">
                {meta?.optionsHash.slice(0, 8) ?? "?"} · {meta ? fmtTime(meta.generatedUtc) : ""}
                {typeof meta?.zoneFilter === "string" ? (
                  <span style={{ color: token("caution") }} title={partialTitle(meta.zoneFilter)}>
                    {" "}
                    · partial
                  </span>
                ) : null}
              </span>
            </Press>
            <Press
              type="button"
              onClick={() => onPickBaseline(entry.id)}
              disabled={isCur}
              className="border-l px-1.5 t-caption"
              style={{
                borderColor: token("line-2"),
                backgroundColor: isPrev ? token("recess") : "transparent",
                color: isCur ? token("line-2") : isPrev ? token("ink") : token("ink-2"),
              }}
              title={
                isPrev
                  ? "This is the baseline (A) — click to clear it."
                  : "Compare against this run as baseline (A)."
              }
            >
              {isPrev ? "A✕" : "A"}
            </Press>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan dock internals — light.tsx's level canvas, transplanted: offscreen cache at native
// raster resolution (painted ONCE, never on pan/zoom), fixed level frame so run changes
// flip-book in place, synced A/B panes, zone hover/click peek. Only the paint palette and
// the floaters changed.
// ---------------------------------------------------------------------------

type Frame = { minX: number; minY: number; maxX: number; maxY: number };
type View = { tx: number; ty: number; scale: number };

// gap (SHIMS.md #7): world.ts's zoneViewport is zone-shaped; a whole-level page needs a
// bounds-shaped viewport (carried finding from round 1 — the registration primitive wants to be
// bounds-first with zoneViewport as a convenience on top).
function levelViewport(f: Frame): ZoneViewport {
  return {
    ...f,
    pxPerFt: PX_PER_FT,
    widthPx: Math.ceil((f.maxX - f.minX) * PX_PER_FT),
    heightPx: Math.ceil((f.maxY - f.minY) * PX_PER_FT),
  };
}

function rasterFrame(r: Raster): Frame {
  return {
    minX: r.minX,
    minY: r.minY,
    maxX: r.minX + r.w * r.cellFt,
    maxY: r.minY + r.h * r.cellFt,
  };
}

// Level frame seeded by the FIRST raster seen and then held fixed → run stepping flip-books
// in place instead of re-fitting.
const frameCache = new Map<string, Frame>();
function levelFrame(level: string, source: Frame): Frame {
  let f = frameCache.get(level);
  if (!f) {
    f = source;
    frameCache.set(level, f);
  }
  return f;
}

// One offscreen canvas per run+level at native raster resolution, muted palette. Separate
// cache from light.tsx's (different paint) — both are tiny.
const levelCanvasCache = new Map<string, Promise<{ canvas: HTMLCanvasElement; ink: Raster }>>();
function loadLevelCanvas(
  runId: string,
  zone: ZoneRecord,
): Promise<{ canvas: HTMLCanvasElement; ink: Raster }> {
  const key = `combo:${runId}/${zone.Ink}`;
  let cached = levelCanvasCache.get(key);
  if (!cached) {
    cached = (async () => {
      const [ink, seals, close, sealClasses] = await Promise.all([
        loadReplaySeedInk(runId, zone.Ink),
        zone.Seals ? loadRaster(runId, zone.Seals) : Promise.resolve(null),
        zone.Close ? loadRaster(runId, zone.Close) : Promise.resolve(null),
        zone.Seals ? loadSealClasses(runId, zone.Seals) : Promise.resolve(null),
      ]);
      const vp: ZoneViewport = {
        ...rasterFrame(ink),
        pxPerFt: 1 / ink.cellFt,
        widthPx: ink.w,
        heightPx: ink.h,
      };
      const canvas = document.createElement("canvas");
      canvas.width = ink.w;
      canvas.height = ink.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context unavailable");
      // Paint order is the law: invented closures under, received ink LAST.
      if (close) paintRaster(ctx, close, vp, CLOSE_M);
      if (sealClasses) {
        paintClassRaster(ctx, sealClasses, vp, new Set([2, 4]), SEAL_DOOR);
        paintClassRaster(ctx, sealClasses, vp, new Set([3]), SEAL_RUN);
      } else if (seals) paintRaster(ctx, seals, vp, SEAL_DOOR);
      paintRaster(ctx, ink, vp, INK_M);
      return { canvas, ink };
    })();
    levelCanvasCache.set(key, cached);
  }
  return cached;
}

type LevelData = {
  report: RunReport;
  zones: ZoneRecord[];
  plan: RegisteredPlan | null;
  ink: Raster | null;
  canvas: HTMLCanvasElement | null;
  geom: Map<string, ZoneGeometry>;
};

function useLevelData(runId: string | null, level: string | null): LevelData | null {
  const [data, setData] = useState<LevelData | null>(null);
  useEffect(() => {
    setData(null);
    if (!runId || !level) return;
    let stale = false;
    void (async () => {
      try {
        const report = await loadRunReport(runId);
        const zones = report.Zones.filter((z) => z.Level === level);
        const anchor = zones.find((z) => z.Ink);
        const [plan, painted] = anchor
          ? await Promise.all([
              loadPlan(runId, anchor.Ink),
              loadLevelCanvas(runId, anchor).catch(() => null),
            ])
          : [null, null];
        const geomEntries = await Promise.all(
          zones
            .filter((z) => z.Tsv)
            .map(async (z) => [z.Zone, await loadZoneGeometry(runId, z.Tsv)] as const),
        );
        if (stale) return;
        setData({
          report,
          zones,
          plan,
          ink: painted?.ink ?? null,
          canvas: painted?.canvas ?? null,
          geom: new Map(geomEntries),
        });
      } catch (err) {
        console.error("combo: level data load failed", err);
      }
    })();
    return () => {
      stale = true;
    };
  }, [runId, level]);
  return data;
}

function rectPath(vp: ZoneViewport, z: ZoneRecord): string {
  const [x0, y0] = toPx(vp, z.MinX, z.MaxY);
  const [x1, y1] = toPx(vp, z.MaxX, z.MinY);
  return `M${x0} ${y0} L${x1} ${y0} L${x1} ${y1} L${x0} ${y1} Z`;
}

function PlanPane(props: {
  runId: string;
  tag: string | null;
  data: LevelData | null;
  frame: Frame;
  view: View;
  setView: Dispatch<SetStateAction<View>>;
  underlay: boolean;
  hoverZone: string | null;
  pinnedZone: string | null;
  onHover: (zone: string | null) => void;
  onPick: (zone: string) => void;
}) {
  const { data, frame, view, setView, underlay } = props;
  const vp = useMemo(() => levelViewport(frame), [frame]);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const planCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const dragDist = useRef(0);
  const [dragging, setDragging] = useState(false);

  // Wheel zoom about the cursor — native listener so preventDefault beats page scroll.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView((v) => {
        const scale = Math.min(24, Math.max(0.02, v.scale * Math.exp(-e.deltaY * 0.0015)));
        return {
          scale,
          tx: cx - ((cx - v.tx) * scale) / v.scale,
          ty: cy - ((cy - v.ty) * scale) / v.scale,
        };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setView]);

  useEffect(() => {
    const canvas = planCanvasRef.current;
    if (!canvas || !data?.plan) return;
    canvas.width = vp.widthPx;
    canvas.height = vp.heightPx;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    paintPlan(
      ctx,
      data.plan,
      vp,
      data.zones.map((zone) => zone.ZoneLoops as [number, number][][]),
      PLAN_LAW.blackPoint,
      PLAN_LAW.whitePoint,
      PLAN_LAW.insideZoneOpacity,
      PLAN_LAW.outsideZoneOpacity,
    );
  }, [data, vp]);

  // Blit the cached offscreen level canvas once per run/level — never on pan/zoom.
  useEffect(() => {
    const el = canvasRef.current;
    const src = data?.canvas;
    if (!el || !src) return;
    el.width = src.width;
    el.height = src.height;
    el.getContext("2d")?.drawImage(src, 0, 0);
  }, [data]);

  // Rooms + quiet residues UNDER the ink canvas. Memoized — pan/zoom touches only the
  // transform and the --sw stroke var, never this tree.
  const underLayer = useMemo(() => {
    if (!data) return null;
    const nodes: ReactElement[] = [];
    for (const zone of data.zones) {
      const geom = data.geom.get(zone.Zone);
      if (!geom) continue;
      for (const res of geom.residues) {
        if (res.reason === "rejected") continue;
        const kind = residueKind(res.reason);
        const treatment = RESIDUE_TREATMENT[kind];
        const patternId = residuePatternId(props.runId, zone, `residue:${res.id}`, kind);
        const d = ringPath(vp, res.loops);
        nodes.push(
          <g key={`q:${zone.Zone}/${res.id}`}>
            <defs>
              <HatchPattern id={patternId} color={treatment.hatch.color} hatch={treatment.hatch} />
            </defs>
            <path
              d={d}
              fillRule="evenodd"
              fill="none"
              stroke={treatment.outline.color}
              style={{ strokeWidth: `calc(var(--sw) * ${treatment.outline.widthPx}px)` }}
            />
            <path d={d} fillRule="evenodd" fill={`url(#${patternId})`} />
          </g>,
        );
      }
      const dispositionById = new Map(geom.rooms.map((room) => [room.id, room.disposition]));
      for (const [roomId, rings] of geom.polys) {
        const disposition = dispositionById.get(roomId) ?? null;
        const tone = candidateTone(zone.Zone, roomId);
        const treatment = disposition === null ? RESIDUE_TREATMENT.void : null;
        const patternId = residuePatternId(props.runId, zone, `room:${roomId}`, "void");
        const d = ringPath(
          vp,
          rings.map((ring) => ring.points),
        );
        nodes.push(
          <g key={`r:${zone.Zone}/${roomId}`}>
            {treatment ? (
              <defs>
                <HatchPattern
                  id={patternId}
                  color={treatment.hatch.color}
                  hatch={treatment.hatch}
                />
              </defs>
            ) : null}
            <path
              d={d}
              fillRule="evenodd"
              fill={treatment ? "none" : tone.fill}
              stroke={treatment?.outline.color}
              style={
                treatment
                  ? { strokeWidth: `calc(var(--sw) * ${treatment.outline.widthPx}px)` }
                  : undefined
              }
            >
              {disposition === null ? <title>{UNKNOWN_TITLE}</title> : null}
            </path>
            {treatment ? <path d={d} fill={`url(#${patternId})`} /> : null}
            {disposition === "held" ? (
              <>
                <defs>
                  <HatchPattern id={heldPatternId(props.runId, zone, roomId)} color={tone.dark} />
                </defs>
                <path d={d} fill={`url(#${heldPatternId(props.runId, zone, roomId)})`} />
              </>
            ) : null}
          </g>,
        );
      }
    }
    return nodes;
  }, [data, vp, props.runId]);

  // Held residues + zone boundaries + hover/hit + labels ABOVE the ink canvas.
  const overLayer = useMemo(() => {
    if (!data) return null;
    const held: ReactElement[] = [];
    const zones: ReactElement[] = [];
    for (const zone of data.zones) {
      const geom = data.geom.get(zone.Zone);
      if (geom) {
        for (const res of geom.residues) {
          if (res.reason !== "rejected") continue;
          const tone = candidateTone(zone.Zone, res.id);
          const patternId = heldPatternId(props.runId, zone, res.id);
          const labelPoint = res.loops[0]?.[0];
          held.push(
            <g key={`h:${zone.Zone}/${res.id}`}>
              <defs>
                <HatchPattern id={patternId} color={tone.dark} />
              </defs>
              <path d={ringPath(vp, res.loops)} fillRule="evenodd" fill={tone.fill} />
              <path d={ringPath(vp, res.loops)} fillRule="evenodd" fill={`url(#${patternId})`} />
              {labelPoint ? (
                <text
                  x={toPx(vp, labelPoint[0], labelPoint[1])[0]}
                  y={toPx(vp, labelPoint[0], labelPoint[1])[1]}
                  fill={LABEL}
                  fontFamily="var(--font-mono)"
                  style={{ fontSize: `calc(var(--sw) * ${LABEL_SIZE}px)` }}
                >
                  H {res.id}
                </text>
              ) : null}
            </g>,
          );
        }
      }
      const lit = props.hoverZone === zone.Zone || props.pinnedZone === zone.Zone;
      const loops = zone.ZoneLoops as [number, number][][];
      const d = loops.length > 0 ? ringPath(vp, loops) : rectPath(vp, zone);
      const [lx, ly] = toPx(vp, zone.MinX, zone.MaxY);
      zones.push(
        <g key={`z:${zone.Zone}`}>
          <path
            d={d}
            fillRule="evenodd"
            fill={lit ? token("veil") : "transparent"}
            stroke={ZONE_STROKE}
            className="dash-reference"
            style={{ strokeWidth: `calc(var(--sw) * ${ZONE_WIDTH}px)`, cursor: "pointer" }}
            onPointerEnter={() => props.onHover(zone.Zone)}
            onPointerLeave={() => props.onHover(null)}
            onClick={() => {
              if (dragDist.current < 5) props.onPick(zone.Zone);
            }}
          />
          <text
            x={lx + 3}
            y={ly - 4}
            pointerEvents="none"
            fill={LABEL}
            fontFamily="var(--font-mono)"
            style={{ fontSize: `calc(var(--sw) * ${LABEL_SIZE}px)` }}
          >
            {zone.Zone.split("#")[1] ?? zone.Zone} {zone.triage.verdict === "hold" ? "· hold" : ""}
          </text>
        </g>,
      );
    }
    return [...zones, ...held];
  }, [data, vp, props.hoverZone, props.pinnedZone, props.onHover, props.onPick]);

  const inkTopLeft = data?.ink
    ? toPx(vp, data.ink.minX, data.ink.minY + data.ink.h * data.ink.cellFt)
    : null;
  const worldStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: vp.widthPx,
    height: vp.heightPx,
    transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
    transformOrigin: "0 0",
    ...({ "--sw": String(1 / view.scale) } as CSSProperties),
  };

  return (
    <div
      ref={hostRef}
      className="relative flex-1 overflow-hidden"
      style={{
        backgroundColor: token("page"),
        cursor: dragging ? "grabbing" : "grab",
        touchAction: "none",
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
        dragDist.current = 0;
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        dragDist.current = Math.max(dragDist.current, Math.abs(dx) + Math.abs(dy));
        setView((v) => ({ ...v, tx: d.tx + dx, ty: d.ty + dy }));
      }}
      onPointerUp={() => {
        drag.current = null;
        setDragging(false);
      }}
    >
      <div style={worldStyle}>
        {data?.plan ? (
          <canvas
            ref={planCanvasRef}
            style={{ position: "absolute", inset: 0, width: vp.widthPx, height: vp.heightPx }}
          />
        ) : null}
        {inkTopLeft && data?.ink && (
          <canvas
            ref={canvasRef}
            style={{
              position: "absolute",
              left: inkTopLeft[0],
              top: inkTopLeft[1],
              width: data.ink.w * data.ink.cellFt * PX_PER_FT,
              height: data.ink.h * data.ink.cellFt * PX_PER_FT,
              imageRendering: "pixelated",
              pointerEvents: "none",
              display: underlay ? undefined : "none",
            }}
          />
        )}
        <svg
          width={vp.widthPx}
          height={vp.heightPx}
          viewBox={`0 0 ${vp.widthPx} ${vp.heightPx}`}
          style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
          role="img"
          aria-label="candidate rooms"
        >
          {underLayer}
        </svg>
        <svg
          width={vp.widthPx}
          height={vp.heightPx}
          viewBox={`0 0 ${vp.widthPx} ${vp.heightPx}`}
          style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
          role="img"
          aria-label="zones and held residues"
        >
          {overLayer}
        </svg>
      </div>
      {props.tag && (
        <div
          className="face-mono absolute left-2 top-2 border bg-page/90 px-1.5 py-0.5 t-label text-ink-2"
          style={{ borderRadius: 2 }}
        >
          {props.tag}
        </div>
      )}
      {!data && (
        <div className="absolute inset-0 flex items-center justify-center t-prose text-ink-2">
          loading {props.runId}…
        </div>
      )}
      {data && !data.plan ? (
        <div className="face-mono absolute bottom-2 left-2 border bg-page/90 px-1.5 py-0.5 t-caption text-ink-2">
          plan unavailable in this package
        </div>
      ) : null}
    </div>
  );
}

// ---- floaters -------------------------------------------------------------

/** The key. Round-2 brief: takeoffs' key is bad — this one says what each mark MEANS, groups
 * evidence (the run's raster) apart from decisions (SVG), and states the honesty rule out
 * loud instead of leaving it to induction. Hideable (atlas floater treatment, change #5). */
function LegendFloater(props: { underlay: boolean; onClose: () => void }) {
  const sw = (bg: string, extra?: CSSProperties) => (
    <span
      className="inline-block h-2.5 w-4 shrink-0 rounded-[1px]"
      style={{ backgroundColor: bg, ...extra }}
    />
  );
  // Drawn as an SVG line, not a border, so the swatch wears the SAME broken-line role the plan
  // draws with — a legend that restates a pattern in a second dialect can drift out of true.
  const line = (stroke: string, reference = false) => (
    <svg className="h-0.5 w-4 shrink-0 overflow-visible" viewBox="0 0 16 2" aria-hidden>
      <line
        x1={0}
        y1={1}
        x2={16}
        y2={1}
        stroke={stroke}
        strokeWidth={2}
        className={reference ? "dash-reference" : undefined}
      />
    </svg>
  );
  const hatchedSwatch = (
    id: string,
    hatch: { angleDeg: number; color: string; spacingPx: number; widthPx: number },
    fill: string,
    stroke: string,
    strokeWidth: number,
  ) => (
    <svg className="h-2.5 w-4 shrink-0" viewBox="0 0 16 10" aria-hidden>
      <defs>
        <HatchPattern id={id} color={hatch.color} hatch={hatch} />
      </defs>
      <rect
        x={strokeWidth / 2}
        y={strokeWidth / 2}
        width={16 - strokeWidth}
        height={10 - strokeWidth}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      <rect width="16" height="10" fill={`url(#${id})`} />
    </svg>
  );
  const residueSwatch = (kind: ResidueKind) => {
    const treatment = RESIDUE_TREATMENT[kind];
    return hatchedSwatch(
      `legend-${kind}`,
      treatment.hatch,
      "none",
      treatment.outline.color,
      treatment.outline.widthPx,
    );
  };
  const row = (mark: ReactNode, label: string, meaning: string) => (
    <span className="flex items-center gap-1.5" title={meaning}>
      {mark}
      <span>{label}</span>
    </span>
  );
  return (
    <div
      className="face-mono absolute right-2 top-2 flex w-52 flex-col gap-1 border bg-page/95 px-2 py-1.5 t-caption text-ink-2 shadow-sm"
      style={{ borderRadius: 2 }}
    >
      <span className="flex items-baseline">
        <span
          className={cn(
            "font-semibold uppercase tracking-wide",
            !props.underlay && "line-through opacity-50",
          )}
        >
          evidence — the run's raster
        </span>
        <Press
          type="button"
          onClick={props.onClose}
          title="Hide the key (the plan header's 'key' button brings it back)."
          className="face-mono ml-auto text-ink-2 hover:text-ink"
        >
          ×
        </Press>
      </span>
      <div className={cn("flex flex-col gap-0.5", !props.underlay && "opacity-40")}>
        {row(
          sw(`rgba(${INK_M.join(",")})`),
          "received ink (solid)",
          "Wall pixels the solver actually received from the DWG. Solid + dark = drawn; muted so decisions stay readable.",
        )}
        {row(
          sw(`rgba(${SEAL_DOOR.join(",")})`),
          "door-head seal (invented)",
          "Closure the solver INVENTED across door openings. Pale + translucent = synthetic — it can never read as a drawn wall.",
        )}
        {row(
          sw(`rgba(${CLOSE_M.join(",")})`),
          "gap-close (invented)",
          "Closure the solver INVENTED across wall-run gaps. Pale + translucent = synthetic.",
        )}
      </div>
      <span className="mt-0.5 font-semibold uppercase tracking-wide">decisions — drawn on top</span>
      <div className="flex flex-col gap-0.5">
        {row(
          sw(candidateTone("legend", "R01").fill),
          "accepted room",
          "A room the solver accepted into the takeoff — per the persisted disposition column.",
        )}
        {row(
          hatchedSwatch(
            "legend-held",
            { ...HELD_HATCH, color: candidateTone("legend", "R02").dark },
            candidateTone("legend", "R02").fill,
            "none",
            0,
          ),
          "held residue",
          "Area the solver found but did not trust — held for review, not counted.",
        )}
        {row(residueSwatch("void"), "void / disposition unknown", UNKNOWN_TITLE)}
        {row(
          residueSwatch("excluded"),
          "excluded residue",
          "Area inside the zone the solver deliberately excluded.",
        )}
        {row(
          line(ZONE_STROKE, true),
          "zone authority",
          "Input zone boundary. Always a hairline dash; status never changes its stroke.",
        )}
      </div>
      <span className="mt-0.5 border-t pt-1 t-caption" style={{ borderColor: token("line-2") }}>
        solid dark = received · pale translucent = invented
        {props.underlay ? "" : " · underlay hidden"}
      </span>
    </div>
  );
}

/** Level stats for algo tuning: solved/zones, accepted vs held sf, loudest rejection families
 * on the visible level, and A/B deltas while comparing. Hideable (atlas treatment, #5). */
function LevelStatsFloater(props: {
  level: string;
  cur: LevelData | null;
  prev: LevelData | null;
  onClose: () => void;
}) {
  const { level, cur, prev } = props;
  const agg = (data: LevelData | null) => {
    if (!data) return null;
    const zones = data.zones;
    const rej = new Map<string, number>();
    for (const z of zones) {
      for (const [k, n] of Object.entries(z.Rejections)) rej.set(k, (rej.get(k) ?? 0) + n);
    }
    return {
      zones: zones.length,
      solved: zones.filter((z) => z.triage.verdict === "solve").length,
      acceptedSqft: zones.reduce((s, z) => s + z.AcceptedSqft, 0),
      heldSqft: zones.reduce((s, z) => s + z.HeldSqft, 0),
      rejTop: [...rej.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    };
  };
  const b = agg(cur);
  const a = agg(prev);
  if (!b) return null;
  return (
    <div
      className="face-mono absolute bottom-2 right-2 flex w-56 flex-col gap-0.5 border bg-page/95 px-2 py-1.5 t-label shadow-sm"
      style={{ borderRadius: 2 }}
    >
      <span className="flex items-baseline t-caption font-semibold uppercase tracking-wide text-ink-2">
        {level} — this run
        <Press
          type="button"
          onClick={props.onClose}
          title="Hide the level stats (the plan header's 'stats' button brings them back)."
          className="face-mono ml-auto normal-case tracking-normal hover:text-ink"
        >
          ×
        </Press>
      </span>
      <span>
        {b.solved}/{b.zones} zones solve{" "}
        {a ? (
          <>
            (<Delta value={b.solved - a.solved} />)
          </>
        ) : null}
      </span>
      <span>
        accepted {fmtSqft(b.acceptedSqft)}{" "}
        {a ? <Delta value={b.acceptedSqft - a.acceptedSqft} suffix=" sf" /> : null}
      </span>
      <span>
        held {fmtSqft(b.heldSqft)}{" "}
        {a ? <Delta value={b.heldSqft - a.heldSqft} goodWhenUp={false} suffix=" sf" /> : null}
      </span>
      {b.rejTop.length > 0 && (
        <span className="mt-0.5 flex flex-col text-ink-2">
          {b.rejTop.map(([k, n]) => (
            <span key={k} title={`${n} rejections of kind ${k} across this level's zones.`}>
              {k} ×{n}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/** Zone peek — reshaped per round-2 change #6: it sits centered ON the A/B split line, the
 * zone name centered at top, row labels centered, A values reading toward the A pane and B
 * values toward the B pane. Single-run (no A) keeps the same centered spine. */
function ZonePeekFloater(props: {
  zoneName: string;
  b: ZoneRecord;
  a: ZoneRecord | null | undefined;
  comparing: boolean;
  highlighted: boolean;
}) {
  const { a, b, comparing } = props;
  const rows: [string, (z: ZoneRecord) => string][] = [
    ["verdict", (z) => `${z.triage.verdict} (${z.triage.reason})`],
    ["accepted", (z) => `${z.AcceptedRooms}/${z.OracleRooms}r · ${fmtSqft(z.AcceptedSqft)}`],
    ["held", (z) => `${z.HeldRooms}r · ${fmtSqft(z.HeldSqft)}`],
    ["ink-backed", (z) => fmtPct(z.InkBackedEdgeFraction)],
    ["ink ratio", (z) => z.census.inkRatio.toFixed(2)],
    [
      "closure",
      (z) =>
        `dh ${Math.round(z.closure.doorHeadSqft)} · wall ${Math.round(z.closure.wallRunGapSqft)} · gap ${Math.round(z.closure.gapCloseSqft)} sf`,
    ],
  ];
  const rejList = (z: ZoneRecord | null | undefined, alignEnd: boolean) =>
    z ? (
      <span className={cn("flex flex-col", alignEnd ? "items-end" : "items-start")}>
        {topRejections(z).map(([k, n]) => (
          <span key={k}>
            {k} ×{n}
          </span>
        ))}
        {Object.keys(z.Rejections).length === 0 && <span>none</span>}
      </span>
    ) : (
      "—"
    );
  const knobs = adaptedKnobs(b);
  return (
    <div
      className="face-mono pointer-events-none absolute bottom-2 left-1/2 w-[30rem] max-w-[calc(100%-1rem)] -translate-x-1/2 border bg-page/95 p-2 t-label shadow-sm"
      style={{ borderRadius: 2 }}
    >
      <div className="mb-1 flex flex-col items-center">
        <span className="text-ink">{props.zoneName}</span>
        {props.highlighted && (
          <span className="t-caption text-ink-2">highlighted · esc clears</span>
        )}
      </div>
      <table className="w-full table-fixed">
        <colgroup>
          {comparing && <col />}
          <col className="w-[84px]" />
          <col />
        </colgroup>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label} className="align-top">
              {comparing && <td className="pr-2 text-right text-ink">{a ? f(a) : "—"}</td>}
              <td className="text-center text-ink-2">{label}</td>
              <td className={cn("pl-2 text-ink", comparing ? "text-left" : "text-center")}>
                {f(b)}
              </td>
            </tr>
          ))}
          <tr className="align-top">
            {comparing && <td className="pr-2 text-right text-ink">{rejList(a, true)}</td>}
            <td className="text-center text-ink-2">rejections</td>
            <td className={cn("pl-2 text-ink", comparing ? "text-left" : "text-center")}>
              {rejList(b, false)}
            </td>
          </tr>
          {knobs.length > 0 && (
            <tr className="align-top">
              {comparing && <td />}
              <td className="text-center text-ink-2">knobs</td>
              <td className={cn("pl-2 text-ink", comparing ? "text-left" : "text-center")}>
                {knobs.map(([k, v]) => `${k}=${v}`).join(" · ")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---- the dock -------------------------------------------------------------

type FocusRequest = { zone: ZoneRecord; nonce: number };

function PlanDock(props: {
  curId: string;
  prevId: string | null;
  underlay: boolean;
  focus: FocusRequest | null;
  /** Round-2 change #4: the level is OWNED by the page (scroll-sync with the sheet body);
   * the dock renders it and reports tab clicks up. */
  levels: string[];
  level: string | null;
  onPickLevel: (level: string) => void;
  /** Round-2 change #3: highlight is a page-level toggle shared with the cards. */
  highlight: string | null;
  onToggleZone: (zone: string) => void;
}) {
  const { curId, prevId, underlay, focus, levels, level } = props;
  const comparing = prevId !== null;

  const [view, setView] = useState<View>({ tx: 0, ty: 0, scale: 1 });
  const [hoverZone, setHoverZone] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<FocusRequest | null>(null);
  // Floaters are hideable, atlas treatment (round-2 change #5): header toggles + × on each.
  const [showKey, setShowKey] = useState(true);
  const [showStats, setShowStats] = useState(true);
  const mainRef = useRef<HTMLDivElement | null>(null);

  const dataCur = useLevelData(curId, level);
  const dataPrev = useLevelData(prevId, level);

  const frame = useMemo(() => {
    if (!level) return null;
    if (dataCur?.plan) return levelFrame(level, planFrame(dataCur.plan.registration));
    if (dataCur?.zones.length) {
      return levelFrame(level, {
        minX: Math.min(...dataCur.zones.map((zone) => zone.MinX)) - 4,
        minY: Math.min(...dataCur.zones.map((zone) => zone.MinY)) - 4,
        maxX: Math.max(...dataCur.zones.map((zone) => zone.MaxX)) + 4,
        maxY: Math.max(...dataCur.zones.map((zone) => zone.MaxY)) + 4,
      });
    }
    return frameCache.get(level) ?? null;
  }, [level, dataCur]);

  // Fit on level change / compare toggle — NOT on run step (flip-book holds the viewport).
  useEffect(() => {
    if (!frame) return;
    const el = mainRef.current;
    if (!el || el.clientHeight < 40) return;
    const vp = levelViewport(frame);
    const paneW = comparing ? el.clientWidth / 2 : el.clientWidth;
    const s = Math.min(paneW / vp.widthPx, el.clientHeight / vp.heightPx) * 0.94;
    setView({
      scale: s,
      tx: (paneW - vp.widthPx * s) / 2,
      ty: (el.clientHeight - vp.heightPx * s) / 2,
    });
  }, [frame, comparing]);

  // A highlight/locate request centers the view on the zone's bbox once the level frame is
  // available (the page already switched the level and lit the zone).
  useEffect(() => {
    if (!focus) return;
    setPendingFocus(focus);
  }, [focus]);

  useEffect(() => {
    if (!pendingFocus || !frame || pendingFocus.zone.Level !== level) return;
    const el = mainRef.current;
    if (!el || el.clientHeight < 40) return;
    const vp = levelViewport(frame);
    const z = pendingFocus.zone;
    const [x0, y0] = toPx(vp, z.MinX, z.MaxY);
    const [x1, y1] = toPx(vp, z.MaxX, z.MinY);
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);
    const paneW = comparing ? el.clientWidth / 2 : el.clientWidth;
    const s = Math.min(8, Math.min(paneW / (w * 1.35), el.clientHeight / (h * 1.35)));
    setView({
      scale: s,
      tx: paneW / 2 - s * (x0 + w / 2),
      ty: el.clientHeight / 2 - s * (y0 + h / 2),
    });
    setPendingFocus(null);
  }, [pendingFocus, frame, level, comparing]);

  useEffect(() => {
    setHoverZone(null);
  }, [level]);

  const { onToggleZone } = props;
  const onPick = useCallback((z: string) => onToggleZone(z), [onToggleZone]);

  const peekZone = hoverZone ?? props.highlight;
  const zoneCur = peekZone ? (dataCur?.zones.find((z) => z.Zone === peekZone) ?? null) : null;
  // A-side twin by the stable zone key when both packages carry it; positional-name matching
  // only as the pre-key fallback (SHIMS.md #2 close).
  const zonePrev = zoneCur ? matchZone(dataPrev?.zones ?? [], zoneCur) : null;

  return (
    <div className="flex size-full min-h-0 flex-col">
      <div
        className="flex shrink-0 items-center gap-2 border-b px-2 py-1"
        style={{ borderColor: token("line-2") }}
      >
        <div className="flex gap-0.5">
          {levels.map((l) => (
            <Press
              key={l}
              type="button"
              onClick={() => props.onPickLevel(l)}
              title="Show this level on the plan — the sheet scrolls to its section (and scrolling the sheet moves this tab)."
              className={cn(
                "face-mono rounded-[2px] px-2 py-0.5 t-label",
                l === level ? "bg-recess text-ink" : "text-ink-2 hover:bg-recess",
              )}
            >
              {l.replace(" Level", "")}
            </Press>
          ))}
        </div>
        <span className="ml-auto flex items-center gap-1.5">
          <Press
            type="button"
            onClick={() => setShowKey((v) => !v)}
            title="Show/hide the key — what each mark on the plan means."
            className={cn(
              "face-mono rounded-[2px] border px-1.5 py-0.5 t-caption",
              showKey ? "bg-recess text-ink" : "text-ink-2 hover:bg-recess",
            )}
            style={{ borderColor: token("line-2") }}
          >
            key
          </Press>
          <Press
            type="button"
            onClick={() => setShowStats((v) => !v)}
            title="Show/hide the level-stats floater — solve counts, sf, loudest rejections, A/B deltas."
            className={cn(
              "face-mono rounded-[2px] border px-1.5 py-0.5 t-caption",
              showStats ? "bg-recess text-ink" : "text-ink-2 hover:bg-recess",
            )}
            style={{ borderColor: token("line-2") }}
          >
            stats
          </Press>
          <span className="face-mono t-caption text-ink-2">
            drag = pan · wheel = zoom · click zone = highlight · esc = clear
          </span>
        </span>
      </div>
      <div ref={mainRef} className="relative flex min-h-0 flex-1">
        {frame && level ? (
          <>
            {comparing && prevId ? (
              <PlanPane
                runId={prevId}
                tag="A · baseline"
                data={dataPrev}
                frame={frame}
                view={view}
                setView={setView}
                underlay={underlay}
                hoverZone={hoverZone}
                pinnedZone={props.highlight}
                onHover={setHoverZone}
                onPick={onPick}
              />
            ) : null}
            <div
              className={cn("flex flex-1", comparing && "border-l")}
              style={comparing ? { borderColor: token("line-2") } : undefined}
            >
              <PlanPane
                runId={curId}
                tag={comparing ? "B · current" : null}
                data={dataCur}
                frame={frame}
                view={view}
                setView={setView}
                underlay={underlay}
                hoverZone={hoverZone}
                pinnedZone={props.highlight}
                onHover={setHoverZone}
                onPick={onPick}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center t-prose text-ink-2">
            loading {level ?? "level"}…
          </div>
        )}
        {showKey && <LegendFloater underlay={underlay} onClose={() => setShowKey(false)} />}
        {showStats && level && (
          <LevelStatsFloater
            level={level}
            cur={dataCur}
            prev={comparing ? dataPrev : null}
            onClose={() => setShowStats(false)}
          />
        )}
        {peekZone && zoneCur && (
          <ZonePeekFloater
            zoneName={peekZone}
            b={zoneCur}
            a={zonePrev}
            comparing={comparing}
            highlighted={props.highlight === peekZone}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ledger dock — the runs master-table with its chronological-predecessor delta columns
// (ledger.tsx donation). Row click = current run (B); the mark cell = baseline (A). The
// ledger IS the run selector at heart; the header strip is its collapsed face.
// ---------------------------------------------------------------------------

type Board = ReturnType<typeof boardSummary>;

/** Scorer columns lifted from the package's scores.json. The python scorer is the only author
 * of these numbers (SHIMS.md #1 close) — this row NEVER computes a stand-in. */
type RowScores = {
  savedV11: number | null;
  savedV1: number | null;
  recall: number | null;
  edgeAcc: number | null;
};

type RunRow = {
  id: string;
  label: string | null;
  hash: string;
  when: string;
  board: Board;
  /** Null = the run package has no scores.json — rendered as an explicit mark. */
  scores: RowScores | null;
  /** savedWork vs the chronological predecessor, currency-matched (v1.1 against v1.1, else v1
   * against v1). Null when either side lacks a comparable board. */
  scoreDelta: number | null;
  /** Null on the oldest run — nothing earlier to diff against. Deltas are CHRONOLOGICAL
   * (vs the run before it in time), never "the row below after sorting". */
  delta: { solved: number; rooms: number; sqft: number; held: number } | null;
  /** Partial-run honesty: declared zoneFilter, or the pre-field heuristic vs the pool's modal
   * zone count (the 20260817-161144 misattribution close). */
  partiality: Partiality;
};

function rowScores(scores: RunScores | null): RowScores | null {
  if (!scores) return null;
  const { v11, v1 } = scoreBoards(scores);
  const primary = v11 ?? v1;
  return {
    savedV11: v11?.savedWork ?? null,
    savedV1: v1?.savedWork ?? null,
    recall: primary?.roomRecall ?? null,
    edgeAcc: primary?.edgeOnInkAccepted ?? null,
  };
}

/** Currency-matched savedWork delta: v1.1 diffs only against v1.1, v1 only against v1. */
function savedWorkDelta(cur: RunScores | null, prev: RunScores | null): number | null {
  if (!cur || !prev) return null;
  const c = scoreBoards(cur);
  const p = scoreBoards(prev);
  if (c.v11?.savedWork != null && p.v11?.savedWork != null)
    return c.v11.savedWork - p.v11.savedWork;
  if (c.v11 || p.v11) return null; // one side is v1-only — not the same currency, no fake delta
  if (c.v1?.savedWork != null && p.v1?.savedWork != null) return c.v1.savedWork - p.v1.savedWork;
  return null;
}

async function buildLedgerRows(index: RunIndexEntry[]): Promise<RunRow[]> {
  const [reports, scoresAll] = await Promise.all([
    Promise.all(index.map((entry) => loadRunReport(entry.id))),
    Promise.all(index.map((entry) => loadRunScores(entry.id))),
  ]);
  const modal = modalZoneCount(reports);
  return index.map((entry, i) => {
    const report = reports[i]!;
    const board = boardSummary(report);
    const prev = i + 1 < index.length ? boardSummary(reports[i + 1]!) : null;
    return {
      id: entry.id,
      label: entry.meta?.label ?? null,
      hash: entry.meta?.optionsHash ?? report.optionsHash,
      when: entry.meta?.generatedUtc ?? report.GeneratedUtc,
      board,
      scores: rowScores(scoresAll[i]!),
      scoreDelta: savedWorkDelta(scoresAll[i]!, i + 1 < index.length ? scoresAll[i + 1]! : null),
      delta: prev
        ? {
            solved: board.solved - prev.solved,
            rooms: board.acceptedRooms - prev.acceptedRooms,
            sqft: board.acceptedSqft - prev.acceptedSqft,
            held: board.heldSqft - prev.heldSqft,
          }
        : null,
      partiality: partiality(report, modal),
    };
  });
}

const NO_SCORES_TITLE =
  "No scores.json in this run package — the scorer never ran for it (python unavailable at " +
  "persist time, or the package predates persist-time scoring). Nothing is recomputed in its place.";

/** A scorer cell: explicit "no scores" mark when the package has no scores.json; "—" when the
 * file exists but the scorer could not produce this number. */
function scoreCell(row: RunRow, value: number | null): ReactNode {
  if (row.scores === null) {
    return (
      <span
        className="face-mono block px-1.5 text-right t-caption text-ink-2"
        title={NO_SCORES_TITLE}
      >
        no scores
      </span>
    );
  }
  return (
    <span className="face-mono block px-1.5 text-right tabular-nums">
      {value === null ? "—" : value.toFixed(3)}
    </span>
  );
}

const runName = (row: Pick<RunRow, "label" | "hash">) => row.label ?? `run ${row.hash.slice(0, 6)}`;

/** The scorer's board line for the current run (B) — read from the package's scores.json, with a
 * currency-matched savedWork delta vs the A baseline. An absent file is said out loud; nothing
 * here is ever computed as a stand-in (SHIMS.md #1 close). */
function HeaderScores(props: {
  cur: RunScores | null | undefined;
  prev: RunScores | null | undefined;
}) {
  const { cur, prev } = props;
  if (cur === undefined) return null; // still loading — silence beats a flashed fake absent state
  if (cur === null) {
    return (
      <Chip tone="caution" title={NO_SCORES_TITLE}>
        no scores.json
      </Chip>
    );
  }
  const { v11, v1 } = scoreBoards(cur);
  const primary = v11 ?? v1;
  const delta = savedWorkDelta(cur, prev ?? null);
  const f = (value: number | null | undefined) => (value == null ? "—" : value.toFixed(3));
  return (
    <span
      className="face-mono t-value text-ink-2"
      title="scores.json — the python scorer's board (score-looks-good.py, the single measure authority), persisted into the run package at harness time."
    >
      saved {f(primary?.savedWork)} {v11 ? "v1.1" : "v1"}
      {v11 && v1 ? ` · ${f(v1.savedWork)} v1` : ""}
      {delta !== null ? (
        <>
          {" · Δ vs A "}
          <Delta value={delta} digits={3} />
        </>
      ) : null}
      {` · recall ${f(primary?.roomRecall)} · edgeOnInk ${f(primary?.edgeOnInkAccepted)}`}
    </span>
  );
}

function LedgerDock(props: {
  runs: RunIndexEntry[];
  /** Absolute directory the pool resolved to — the dock says WHICH .artifacts it is reading. */
  pool: string | null;
  curId: string | null;
  prevId: string | null;
  open: boolean;
  onToggle: () => void;
  onPickCur: (id: string) => void;
  onPickBaseline: (id: string) => void;
}) {
  const { runs, pool, curId, prevId, open, onToggle, onPickCur, onPickBaseline } = props;
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [tableState, setTableState] = useState<MasterTableState>({
    filters: {},
    sorts: [{ key: "run", dir: "desc" }],
    query: "",
  });

  useEffect(() => {
    if (!open || rows !== null || runs.length === 0) return;
    buildLedgerRows(runs).then(setRows, (err: unknown) => console.error("combo ledger:", err));
  }, [open, rows, runs]);

  const columns = useMemo<Column<RunRow>[]>(
    () => [
      {
        key: "run",
        label: "run",
        lock: true,
        width: "w-52",
        title:
          "The run's label (or options-hash name) and when the harness persisted it. Sorted descending = newest first. Click the row to make it the CURRENT run (B).",
        sort: (row) => row.id, // ids are timestamp-prefixed — id order IS chronology
        search: (row) => `${row.label ?? ""} ${row.hash} ${row.id}`,
        cell: (row) => (
          <span className="face-mono flex min-w-0 items-baseline gap-1.5 px-1.5">
            <span className={cn("truncate", row.label ? "text-ink" : "text-ink-2")}>
              {runName(row)}
            </span>
            <span className="shrink-0 t-caption text-ink-2/70">{fmtTime(row.when)}</span>
            <PartialityChip part={row.partiality} compact />
          </span>
        ),
      },
      {
        key: "options",
        label: "options",
        width: "w-20",
        title:
          "Solver options generation — runs sharing a hash ran identical options; a hash change means the knobs moved.",
        facet: (row) => row.hash,
        cell: (row) => (
          <span className="flex px-1">
            <Chip tone="meta" title={`optionsHash ${row.hash} — same hash = same solver options.`}>
              {row.hash.slice(0, 6)}
            </Chip>
          </span>
        ),
      },
      {
        key: "mark",
        label: "a/b",
        width: "w-14",
        title:
          "The sheet's A/B selection. B (current) follows the clicked row; this cell sets/clears A (baseline).",
        cell: (row) => {
          if (row.id === curId) {
            return <span className="face-mono block px-1.5 font-semibold text-ink">B</span>;
          }
          const isA = row.id === prevId;
          // Picker warning, not a block: a partial package can still be a legitimate baseline
          // (e.g. against another run under the SAME filter) — but never silently.
          const caveat =
            row.partiality.kind === "partial"
              ? ` WARNING: ${partialTitle(row.partiality.zone)}`
              : row.partiality.kind === "possibly-partial"
                ? ` WARNING: ${possiblyPartialTitle(row.partiality.zones, row.partiality.modal)}`
                : "";
          return (
            <Press
              type="button"
              onClick={() => onPickBaseline(row.id)}
              title={
                (isA
                  ? "This is the baseline (A) — click to clear it."
                  : "Set this run as the baseline (A).") + caveat
              }
              className={cn(
                "face-mono h-7 w-full px-1.5 text-left",
                isA ? "font-semibold text-ink" : "text-ink-2/60 hover:text-ink-2",
              )}
            >
              {isA ? "A" : "set A"}
            </Press>
          );
        },
      },
      {
        key: "solved",
        label: "solved",
        group: "board",
        right: true,
        width: "w-16",
        title: "Zones the triage verdict marked solve, over all zones the run partitioned.",
        sort: (row) => row.board.solved,
        cell: (row) => (
          <span className="face-mono block px-1.5 text-right tabular-nums">
            {row.board.solved}/{row.board.zones}
          </span>
        ),
      },
      {
        key: "rooms",
        label: "rooms",
        group: "board",
        right: true,
        width: "w-14",
        title: "Accepted rooms across every solved zone.",
        sort: (row) => row.board.acceptedRooms,
        cell: (row) => (
          <span className="face-mono block px-1.5 text-right tabular-nums">
            {row.board.acceptedRooms}
          </span>
        ),
      },
      {
        key: "sqft",
        label: "accepted sf",
        group: "board",
        right: true,
        width: "w-20",
        title: "Accepted square footage across every solved zone.",
        sort: (row) => row.board.acceptedSqft,
        cell: (row) => (
          <span className="face-mono block px-1.5 text-right tabular-nums">
            {fmtNum(row.board.acceptedSqft, 0)}
          </span>
        ),
      },
      {
        key: "held",
        label: "held sf",
        group: "board",
        right: true,
        width: "w-16",
        title: "Square footage in held rooms — area the solver found but did not trust.",
        sort: (row) => row.board.heldSqft,
        cell: (row) => (
          <span className="face-mono block px-1.5 text-right tabular-nums text-ink-2">
            {fmtNum(row.board.heldSqft, 0)}
          </span>
        ),
      },
      // scores.json columns (SHIMS.md #1 close): the python scorer's board, read from the run
      // package. A missing file is an explicit mark — the ledger never computes a stand-in.
      {
        key: "saved",
        label: "saved",
        group: "scores.json",
        right: true,
        width: "w-16",
        title:
          "Board savedWork under currency v1.1 (cleaned oracle), from the package's scores.json. The python scorer (score-looks-good.py) is the only author of this number.",
        sort: (row) => row.scores?.savedV11 ?? Number.NEGATIVE_INFINITY,
        cell: (row) => scoreCell(row, row.scores?.savedV11 ?? null),
      },
      {
        key: "saved-v1",
        label: "saved v1",
        group: "scores.json",
        right: true,
        width: "w-16",
        title:
          "Board savedWork under currency v1 (raw oracle) — carried alongside v1.1 during the currency transition.",
        sort: (row) => row.scores?.savedV1 ?? Number.NEGATIVE_INFINITY,
        cell: (row) => scoreCell(row, row.scores?.savedV1 ?? null),
      },
      {
        key: "recall",
        label: "recall",
        group: "scores.json",
        right: true,
        width: "w-16",
        title:
          "Board roomRecall from scores.json (v1.1 board when present, else the v1 board the file carries).",
        sort: (row) => row.scores?.recall ?? Number.NEGATIVE_INFINITY,
        cell: (row) => scoreCell(row, row.scores?.recall ?? null),
      },
      {
        key: "edge-acc",
        label: "edgeOnInk",
        group: "scores.json",
        right: true,
        width: "w-20",
        title:
          "Board edgeOnInkAccepted from scores.json — how much of the accepted boundary stands on evidence.",
        sort: (row) => row.scores?.edgeAcc ?? Number.NEGATIVE_INFINITY,
        cell: (row) => scoreCell(row, row.scores?.edgeAcc ?? null),
      },
      {
        key: "d-saved",
        label: "Δ saved",
        group: "scores.json",
        right: true,
        width: "w-16",
        title:
          "savedWork vs the chronological predecessor, currency-matched (v1.1 against v1.1, else v1 against v1). Empty when either run lacks a comparable scores.json board.",
        sort: (row) => row.scoreDelta ?? Number.NEGATIVE_INFINITY,
        cell: (row) => (
          <span className="face-mono block px-1.5 text-right">
            <Delta value={row.scoreDelta} digits={3} />
          </span>
        ),
      },
      // gap(master-table): still no canon "value + delta" column pair — these four hand-built
      // Δ columns repeat the same shape (carried finding from round 1).
      {
        key: "d-solved",
        label: "Δ solved",
        group: "Δ vs prev run",
        right: true,
        width: "w-16",
        title:
          "Solved zones vs this run's chronological predecessor — NOT the row below after sorting.",
        sort: (row) => row.delta?.solved ?? Number.NEGATIVE_INFINITY,
        cell: (row) => (
          <span className="face-mono block px-1.5 text-right">
            <Delta value={row.delta?.solved ?? null} />
          </span>
        ),
      },
      {
        key: "d-rooms",
        label: "Δ rooms",
        group: "Δ vs prev run",
        right: true,
        width: "w-16",
        title: "Accepted rooms vs the chronological predecessor.",
        sort: (row) => row.delta?.rooms ?? Number.NEGATIVE_INFINITY,
        cell: (row) => (
          <span className="face-mono block px-1.5 text-right">
            <Delta value={row.delta?.rooms ?? null} />
          </span>
        ),
      },
      {
        key: "d-sqft",
        label: "Δ sf",
        group: "Δ vs prev run",
        right: true,
        width: "w-16",
        title: "Accepted square footage vs the chronological predecessor.",
        sort: (row) => row.delta?.sqft ?? Number.NEGATIVE_INFINITY,
        cell: (row) => (
          <span className="face-mono block px-1.5 text-right">
            <Delta value={row.delta?.sqft ?? null} />
          </span>
        ),
      },
      {
        key: "d-held",
        label: "Δ held",
        group: "Δ vs prev run",
        right: true,
        width: "w-16",
        title: "Held square footage vs the chronological predecessor — down is the improvement.",
        sort: (row) => row.delta?.held ?? Number.NEGATIVE_INFINITY,
        cell: (row) => (
          <span className="face-mono block px-1.5 text-right">
            <Delta value={row.delta?.held ?? null} goodWhenUp={false} />
          </span>
        ),
      },
      {
        key: "rejects",
        label: "top rejections",
        title: "The run's three loudest rejection reasons with counts — the histogram's head.",
        facet: (row) => row.board.rejectionTop[0]?.[0] ?? "",
        all: "any loudest",
        cell: (row) => (
          <span className="flex items-center gap-1 px-1">
            {row.board.rejectionTop.map(([reason, count]) => (
              <Chip
                key={reason}
                tone="meta"
                title={`${count} rejections of kind ${reason} in this run.`}
              >
                {reason} {count}
              </Chip>
            ))}
          </span>
        ),
      },
    ],
    [curId, prevId, onPickBaseline],
  );

  const optionSets = new Set(runs.map((r) => r.meta?.optionsHash ?? "?")).size;

  return (
    <div className="shrink-0 border-t" style={{ borderColor: token("line-2") }}>
      <Press
        type="button"
        onClick={onToggle}
        title={
          open
            ? "Collapse the run ledger."
            : "Expand the run ledger — rows are runs, marks drive the sheet's A/B."
        }
        className="flex w-full items-baseline gap-2 px-3 py-1 text-left hover:bg-recess"
      >
        <span className="face-mono t-caption t-upper text-ink-2">ledger</span>
        <span className="face-mono t-label text-ink-2">
          {runs.length} runs · {optionSets} option sets · click a row = current (B), mark = baseline
          (A)
        </span>
        <span className="face-mono ml-auto t-label text-ink-2">
          {open ? "▾ collapse" : "▴ expand"}
        </span>
      </Press>
      {open && (
        <div className="flex flex-col" style={{ height: 320 }}>
          {/* Provenance: the surface names the directory it read, so "which pool am I looking
              at?" is never an inference from the run labels. */}
          {pool && (
            <div
              className="face-mono shrink-0 truncate border-b px-3 py-1 t-caption text-ink-2"
              style={{ borderColor: token("line-2") }}
              title="The run pool this page is reading — PE_TAKEOFF_RUNS_DIR if set, else <repo>/.artifacts/takeoff-runs."
            >
              pool {pool}
            </div>
          )}
          {rows === null ? (
            <div className="face-mono p-4 t-prose text-ink-2">loading the run ledger…</div>
          ) : (
            <MasterTable
              rows={rows}
              columns={columns}
              rowKey={(row) => row.id}
              scopeLabel="runs in pool"
              searchPlaceholder="label / hash…"
              summary={`${rows.length} runs`}
              empty="No runs in the pool yet — run the zone-bounded detect harness once and it will auto-persist here."
              activeKey={curId}
              onRowClick={(row) => onPickCur(row.id)}
              tableState={tableState}
              onTableStateChange={setTableState}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The combo page.
// ---------------------------------------------------------------------------

/** Baseline selection: "auto" follows the current run's chronological predecessor (the round-2
 * default), null is comparison off, a run id is an explicit pick. */
type Baseline = "auto" | null | string;

export default function RunBrowser() {
  const [runs, setRuns] = useState<RunIndexEntry[] | null>(null);
  const [pool, setPool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [curId, setCurId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<Baseline>("auto");
  const [underlay, setUnderlay] = useState(false);
  const [changedOnly, setChangedOnly] = useState(false);
  const [planOpen, setPlanOpen] = useState(true);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(true);
  /** Review-staged mode (the deck's surviving UX): the sheet flips to single-column staged
   * items at their PINNED pairs. Same ZoneCard, second layout. */
  const [review, setReview] = useState(false);
  /** The page-level zone highlight (change #3) — shared by the plan and every card button. */
  const [highlight, setHighlight] = useState<string | null>(null);
  /** The plan's level — page-owned for the sheet↔plan scroll-sync (change #4). */
  const [planLevel, setPlanLevel] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [reportCur, setReportCur] = useState<RunReport | null>(null);
  const [reportPrev, setReportPrev] = useState<RunReport | null>(null);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const { items: stagedItems } = useFb();
  // scores.json per side: undefined = loading, null = the package has no scores.json.
  const [scoresCur, setScoresCur] = useState<RunScores | null | undefined>(undefined);
  const [scoresPrev, setScoresPrev] = useState<RunScores | null | undefined>(undefined);
  // The pool's modal zone count — the pre-field partiality heuristic's yardstick. Null until
  // computed (heuristic disabled, never guessed).
  const [modalZones, setModalZones] = useState<number | null>(null);

  useEffect(() => {
    if (!runs || runs.length === 0) return;
    let live = true;
    poolModalZones(runs.map((entry) => entry.id)).then(
      (modal) => live && setModalZones(modal),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [runs]);

  useEffect(() => {
    fetchRunIndex()
      .then((index) => {
        setRuns(index.runs);
        setPool(index.pool);
        setCurId((prev) => prev ?? index.runs[0]?.id ?? null);
      })
      .catch((err: unknown) => setError(String(err)));
  }, []);

  // Deep links, applied ONCE against the loaded pool (round-2 state model):
  //   ?set=<stamp>        — rehydrate staging (editable) from the export manifest. The ONLY
  //                         persistence lane; re-export mints a new stamp.
  //   ?a=&b=&zone=        — a STATELESS lens link: sets the A/B lens and highlights/scrolls to
  //                         the zone. Stages nothing. No multi-pair encoding exists on purpose.
  const linkApplied = useRef(false);
  const pendingZone = useRef<string | null>(null);
  useEffect(() => {
    if (!runs || linkApplied.current) return;
    linkApplied.current = true;
    const params = new URLSearchParams(window.location.search);
    const set = params.get("set");
    if (set) {
      hydrateFromSet(set)
        .then(() => setTrayOpen(true))
        .catch((err: unknown) => setLinkNote(`set ${set} did not load: ${String(err)}`));
    }
    const b = params.get("b");
    const a = params.get("a");
    const has = (id: string | null) => id !== null && runs.some((r) => r.id === id);
    if (has(b)) setCurId(b);
    if (has(a) && a !== b) setBaseline(a);
    const zone = params.get("zone");
    if (zone) pendingZone.current = zone;
    if ((b && !has(b)) || (a && !has(a))) {
      setLinkNote(
        `deep link run${b && !has(b) ? ` B=${b}` : ""}${a && !has(a) ? ` A=${a}` : ""} is not in the pool`,
      );
    }
  }, [runs]);

  // A/B is the DEFAULT: "auto" resolves to the run chronologically just before the current one.
  const prevId = useMemo(() => {
    if (!runs || !curId || baseline === null) return null;
    if (baseline !== "auto") return baseline === curId ? null : baseline;
    const idx = runs.findIndex((r) => r.id === curId);
    return idx >= 0 ? (runs[idx + 1]?.id ?? null) : null;
  }, [runs, curId, baseline]);

  useEffect(() => {
    if (!curId) return;
    let live = true;
    setReportCur(null);
    setScoresCur(undefined);
    loadRunReport(curId)
      .then((r) => live && setReportCur(r))
      .catch((err: unknown) => live && setError(String(err)));
    loadRunScores(curId)
      .then((s) => live && setScoresCur(s))
      .catch((err: unknown) => {
        console.error("runs: scores.json load failed", err);
        if (live) setScoresCur(null);
      });
    return () => {
      live = false;
    };
  }, [curId]);

  useEffect(() => {
    if (!prevId) {
      setReportPrev(null);
      setScoresPrev(undefined);
      return;
    }
    let live = true;
    setReportPrev(null);
    setScoresPrev(undefined);
    loadRunReport(prevId)
      .then((r) => live && setReportPrev(r))
      .catch(() => live && setReportPrev(null));
    loadRunScores(prevId)
      .then((s) => live && setScoresPrev(s))
      .catch(() => live && setScoresPrev(null));
    return () => {
      live = false;
    };
  }, [prevId]);

  // ↑/↓ scrub the current run through the pool; esc clears the zone highlight. (←/→ are free
  // again now that the round-1 switchers are gone.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /input|textarea|select/i.test(t.tagName)) return;
      if (e.key === "Escape") {
        setHighlight(null);
        return;
      }
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (!runs || runs.length === 0) return;
      e.preventDefault();
      setCurId((current) => {
        const idx = Math.max(
          0,
          runs.findIndex((r) => r.id === current),
        );
        const next =
          e.key === "ArrowUp" ? Math.max(0, idx - 1) : Math.min(runs.length - 1, idx + 1);
        return runs[next]?.id ?? current;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runs]);

  const pickCur = useCallback((id: string) => {
    setCurId(id);
    // Picking the baseline run as current would compare a run to itself — fall back to auto.
    setBaseline((b) => (b === id ? "auto" : b));
  }, []);

  const pickBaseline = useCallback((id: string) => setBaseline((b) => (b === id ? null : id)), []);

  /** A staged card's row/mark was clicked: swing the LENS to its pinned pair. The stage is
   * untouched — the lens is a view (round-2 state model). */
  const swingLens = useCallback((item: StagedItem) => {
    setCurId(item.runB);
    setBaseline(item.runA); // null pin = staged without a baseline → lens comparison off
  }, []);

  /** Change #3: highlight is a TOGGLE. Activating opens + centers the plan on the zone;
   * re-clicking (card button or plan polygon) clears it; choosing another zone replaces it. */
  const toggleHighlight = useCallback((zone: ZoneRecord) => {
    setHighlight((cur) => {
      if (cur === zone.Zone) return null;
      setPlanOpen(true);
      setPlanLevel(zone.Level);
      setFocus((f) => ({ zone, nonce: (f?.nonce ?? 0) + 1 }));
      return zone.Zone;
    });
  }, []);

  /** Plan polygon click: same toggle by name (no recentering — the zone is already in view). */
  const toggleZoneByName = useCallback((zoneName: string) => {
    setHighlight((cur) => (cur === zoneName ? null : zoneName));
  }, []);

  // A/B zone pairing on the stable zone key when both packages carry it (report v4); the
  // positional-name fallback for pre-key packages is surfaced as a caveat on every card
  // (SHIMS.md #2 close). Orphans under key pairing are honest orphans, never name-matched.
  const comparing = prevId !== null && reportPrev !== null;
  const pairs = useMemo(
    () => (reportCur ? pairZones(reportCur, comparing ? reportPrev : null) : []),
    [reportCur, reportPrev, comparing],
  );
  const levels = useMemo(() => {
    const order: string[] = [];
    const byLevel = new Map<string, ZonePair[]>();
    for (const pair of pairs) {
      if (!byLevel.has(pair.level)) {
        byLevel.set(pair.level, []);
        order.push(pair.level);
      }
      byLevel.get(pair.level)!.push(pair);
    }
    return order.map((level) => ({ level, zonePairs: byLevel.get(level)! }));
  }, [pairs]);

  // Keep the plan level honest against the current run's levels (and seed it on first load).
  useEffect(() => {
    if (levels.length === 0) return;
    setPlanLevel((cur) => (cur && levels.some((l) => l.level === cur) ? cur : levels[0]!.level));
  }, [levels]);

  // --- change #4: sheet↔plan scroll-sync (bidirectional, loop-guarded) --------------------
  // The level section in view drives the plan's level tab; a tab click scrolls the sheet to
  // that section. `suppressUntil` keeps the programmatic scroll from echoing back as a
  // tab change mid-flight.
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const suppressUntil = useRef(0);

  const onSheetScroll = useCallback(() => {
    if (review) return; // review mode has no level sections
    if (Date.now() < suppressUntil.current) return;
    const main = mainScrollRef.current;
    if (!main) return;
    const mainTop = main.getBoundingClientRect().top;
    let active: string | null = null;
    for (const [level, el] of sectionRefs.current) {
      if (el.getBoundingClientRect().top - mainTop <= 90) active = level;
    }
    if (active) setPlanLevel((cur) => (cur === active ? cur : active));
  }, [review]);

  const pickLevel = useCallback((level: string) => {
    setPlanLevel(level);
    const el = sectionRefs.current.get(level);
    if (el) {
      suppressUntil.current = Date.now() + 900;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // ?zone= deep-link tail: once the current report is in, light the zone, center the plan on
  // it, and scroll its card into view. Stages nothing.
  useEffect(() => {
    const name = pendingZone.current;
    if (!name || !reportCur) return;
    pendingZone.current = null;
    const zone = reportCur.Zones.find((z) => z.Zone === name);
    if (!zone) {
      setLinkNote(`deep link zone "${name}" is not in run ${curId ?? "?"}`);
      return;
    }
    toggleHighlight(zone);
    // After paint: the card grid must exist before the card can be scrolled to.
    requestAnimationFrame(() => {
      const el = cardRefs.current.get(name);
      if (el) {
        suppressUntil.current = Date.now() + 900;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }, [reportCur, curId, toggleHighlight]);

  const board = reportCur ? boardSummary(reportCur) : null;
  const boardPrev = comparing && reportPrev ? boardSummary(reportPrev) : null;
  const prevMeta = runs?.find((r) => r.id === prevId)?.meta ?? null;
  // Partial-run honesty on the header: a filtered/partial package says so next to its board,
  // and a suspect A/B pairing carries an explicit caveat (never a block).
  const partCur = reportCur ? partiality(reportCur, modalZones) : null;
  const partPrev = comparing && reportPrev ? partiality(reportPrev, modalZones) : null;
  const abCaveat = partCur && partPrev ? pairingCaveat(partPrev, partCur) : null;

  // Sheet geometry: measured once at the scroll container, cards derive their panel boxes.
  // Review mode is the SAME card at single-column width with taller panels — layout, not
  // mechanics (round-2 ruling).
  const [sheetRef, sheetW] = useElementWidth();
  const cardInnerW = sheetW > 0 ? Math.max(280, Math.floor((sheetW - 32 - 12) / 2) - 18) : 560;
  const reviewInnerW = sheetW > 0 ? Math.max(280, sheetW - 32 - 18) : 1120;
  const panelFullW = review ? reviewInnerW : cardInnerW;
  const panelHalfW = Math.floor(((review ? reviewInnerW : cardInnerW) - 8) / 2);
  const panelH = review ? 440 : 220;
  const lens: Lens = { curId, prevId };

  if (error) {
    return (
      <div className="face-mono p-8 t-prose" style={{ color: token("caution") }}>
        run pool unavailable: {error}
      </div>
    );
  }
  if (!runs) {
    return <div className="face-mono p-8 t-prose text-ink-2">loading run pool…</div>;
  }
  // Empty pool is a SYSTEM story, not a filter story: nothing is hidden, nothing has been
  // captured. The page says which directory it watched and what fills it.
  if (runs.length === 0 || !curId) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-2 p-8">
        <EmptyState story="scope" exit="run the takeoff harness to fill the pool">
          No runs captured yet
        </EmptyState>
        <p className="face-mono t-label text-ink-2">
          Every run of{" "}
          <span className="text-ink">
            ZoneBoundedDetectTests.ProjectA_zones_partition_within_declared_scope
          </span>{" "}
          auto-persists its package (report.json, zone TSVs, INKP bins) into the pool; this page
          reads whatever is there. Nothing to configure.
        </p>
        {pool && (
          <p
            className="face-mono break-all t-caption text-ink-2"
            title="The run pool this page is reading — PE_TAKEOFF_RUNS_DIR if set, else <repo>/.artifacts/takeoff-runs."
          >
            pool {pool}
          </p>
        )}
      </div>
    );
  }

  const setMainRefs = (el: HTMLElement | null) => {
    sheetRef.current = el as HTMLDivElement | null;
    mainScrollRef.current = el;
  };

  // The A/B sheet — normal layout: two-column zone cards under the current lens, grouped into
  // level sections. Review layout (round-2 ruling): the SAME card, single column at full
  // width, staged items only, each rendered at its PINNED pair.
  //
  // Cards come from `levels`, i.e. from world.pairZones — the stable zoneKey pairing (report v4)
  // with the positional-name fallback surfaced per card as `pairedBy`. The sheet never re-derives
  // an A side by name; a keyed miss stays an honest orphan (SHIMS.md #2 close).
  const sheetBody = (
    <main ref={setMainRefs} onScroll={onSheetScroll} className="size-full min-h-0 overflow-y-auto">
      {reportCur === null ? (
        <div className="face-mono p-8 t-prose text-ink-2">loading run…</div>
      ) : review ? (
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-baseline gap-3">
            <h2 className="face-mono t-value font-semibold uppercase tracking-wide">
              review — {stagedItems.length} staged
            </h2>
            <span className="face-mono t-label text-ink-2">
              each item at its pinned A/B pair · the lens is untouched
            </span>
            <Press
              type="button"
              onClick={() => setReview(false)}
              title="Back to the normal sheet."
              className="face-mono ml-auto border px-1.5 py-0.5 t-caption text-ink-2 hover:text-ink"
              style={{ borderColor: token("line-2"), borderRadius: 2 }}
            >
              ✕ exit review
            </Press>
          </div>
          {stagedItems.length === 0 && (
            <p className="face-mono t-label text-ink-2">
              Nothing staged anymore — stage zone cards from the normal sheet.
            </p>
          )}
          {stagedItems.map((item) => {
            const onLens = item.runB === curId && item.runA === prevId;
            return (
              <div key={item.key} className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <Press
                    type="button"
                    onClick={() => swingLens(item)}
                    title={
                      onLens
                        ? "This item's pinned pair IS the current lens."
                        : "Pinned pair ≠ current lens — click to swing the lens to this pair (the stage is untouched)."
                    }
                    className="face-mono flex items-baseline gap-2 t-label text-ink-2 hover:text-ink"
                  >
                    <span>
                      pinned A {item.runA ?? "(none)"} → B {item.runB}
                    </span>
                    {!onLens && (
                      <span
                        style={{ color: token("caution") }}
                        title="Pinned pair differs from the page lens."
                      >
                        ≠ lens
                      </span>
                    )}
                  </Press>
                  <Press
                    type="button"
                    onClick={() => fb.unstage(item.key)}
                    title="Remove this item from the staged set."
                    className="face-mono ml-auto t-caption text-ink-2 hover:text-ink"
                  >
                    ✕ unstage
                  </Press>
                </div>
                <ZoneCard
                  name={item.zone}
                  a={item.a}
                  b={item.b}
                  pairedBy={stagedPairedBy(item)}
                  runA={item.runA}
                  runB={item.runB}
                  panelFullW={panelFullW}
                  panelHalfW={panelHalfW}
                  panelH={panelH}
                  underlay={underlay}
                  highlighted={highlight === item.zone}
                  onToggleHighlight={toggleHighlight}
                  onSwing={swingLens}
                />
                <NoteInput item={item} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-5 p-4">
          {levels.map(({ level, zonePairs }) => {
            const visible = zonePairs.filter((pair) => {
              if (!comparing || !changedOnly) return true;
              return materiallyChanged(pair.a, pair.b);
            });
            const hidden = zonePairs.length - visible.length;
            const solved = zonePairs.filter((pair) => pair.b?.triage.verdict === "solve").length;
            const sf = zonePairs.reduce((sum, pair) => sum + (pair.b?.AcceptedSqft ?? 0), 0);
            return (
              <section
                key={level}
                ref={(el) => {
                  if (el) sectionRefs.current.set(level, el);
                  else sectionRefs.current.delete(level);
                }}
              >
                <div
                  className="sticky top-0 z-10 -mx-4 mb-2 flex items-baseline gap-3 border-b bg-page px-4 py-1"
                  style={{ borderColor: token("line-2") }}
                >
                  <h2 className="face-mono t-value font-semibold uppercase tracking-wide">
                    {level}
                  </h2>
                  <span className="face-mono t-label text-ink-2">
                    {solved}/{zonePairs.length} solved · {fmtSqft(sf)}
                  </span>
                  {hidden > 0 && (
                    <Chip
                      tone="meta"
                      title="Zones with no material A/B change, hidden by the 'changed only' filter."
                    >
                      {hidden} unchanged hidden
                    </Chip>
                  )}
                </div>
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
                >
                  {visible.map((pair) => (
                    <div
                      key={pair.id}
                      className="min-w-0"
                      // Card refs stay NAME-keyed: the ?zone= deep link and the scroll-sync both
                      // address cards by zone name, which is what a human reads off the plan.
                      ref={(el) => {
                        if (el) cardRefs.current.set(pair.name, el);
                        else cardRefs.current.delete(pair.name);
                      }}
                    >
                      <ZoneCard
                        name={pair.name}
                        a={comparing ? pair.a : null}
                        b={pair.b}
                        pairedBy={pair.pairedBy}
                        runA={comparing ? prevId : null}
                        runB={curId}
                        panelFullW={panelFullW}
                        panelHalfW={panelHalfW}
                        panelH={panelH}
                        underlay={underlay}
                        highlighted={highlight === pair.name}
                        onToggleHighlight={toggleHighlight}
                        onSwing={swingLens}
                      />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );

  const sheetAndLedger = (
    <div className="flex size-full min-h-0 flex-col">
      {/* The staging tray — a collapsible right side pane of the A/B section (round-2 ruling:
          the tray won; it is NOT page-height chrome). */}
      <PaneSplit
        axis="horizontal"
        className="min-h-0 flex-1"
        resize={{
          target: "end",
          defaultSize: 340,
          minSize: 260,
          minOtherSize: 360,
          persist: "pe-runs-tray-w",
          collapse: {
            collapsed: !trayOpen,
            onCollapsedChange: (c) => setTrayOpen(!c),
            collapsedSize: 30,
            collapseBelow: 140,
          },
        }}
        start={sheetBody}
        end={
          trayOpen ? (
            <Tray
              pool={pool}
              lens={lens}
              onSwing={swingLens}
              review={review}
              onToggleReview={() => setReview((r) => !r)}
            />
          ) : (
            <TrayCollapsed count={stagedItems.length} onExpand={() => setTrayOpen(true)} />
          )
        }
      />
      <LedgerDock
        runs={runs}
        pool={pool}
        curId={curId}
        prevId={prevId}
        open={ledgerOpen}
        onToggle={() => setLedgerOpen((o) => !o)}
        onPickCur={pickCur}
        onPickBaseline={pickBaseline}
      />
    </div>
  );

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-page text-ink">
      <header
        className="flex shrink-0 flex-col gap-1.5 border-b px-4 py-2"
        style={{ borderColor: token("line-2") }}
      >
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="face-mono t-title">runs</h1>
          {linkNote && (
            <span
              className="face-mono t-label"
              style={{ color: token("caution") }}
              title="The URL's deep link could not be fully applied."
            >
              {linkNote}
            </span>
          )}
          {board && (
            <span className="face-mono t-value text-ink-2">
              B: {board.solved}/{board.zones} solved · {board.acceptedRooms} rooms ·{" "}
              {fmtSqft(board.acceptedSqft)} accepted · {fmtSqft(board.heldSqft)} held
            </span>
          )}
          <PartialityChip part={partCur} prefix="B: " />
          <PartialityChip part={partPrev} prefix="A: " />
          {boardPrev && board && (
            <span className="face-mono t-value text-ink-2">
              Δ vs A: <Delta value={board.solved - boardPrev.solved} /> solved ·{" "}
              <Delta value={board.acceptedSqft - boardPrev.acceptedSqft} suffix=" sf" /> ·{" "}
              <Delta
                value={board.heldSqft - boardPrev.heldSqft}
                goodWhenUp={false}
                suffix=" sf held"
              />
            </span>
          )}
          {abCaveat ? (
            <Chip tone="caution" title={abCaveat}>
              A/B pairing caveat
            </Chip>
          ) : null}
          <HeaderScores cur={scoresCur} prev={comparing ? scoresPrev : undefined} />
          <span className="ml-auto flex items-center gap-1.5">
            {prevId ? (
              <Chip
                tone="meta"
                title={
                  baseline === "auto"
                    ? "Baseline (A) follows the current run's chronological predecessor. Clear it for a single-run sheet — the layout will not shift."
                    : "Explicitly picked baseline (A)."
                }
              >
                A: {prevMeta?.label ?? prevId.slice(0, 15)}
                {baseline === "auto" ? " · auto" : ""}
              </Chip>
            ) : null}
            {prevId ? (
              <Press
                type="button"
                onClick={() => setBaseline(null)}
                title="Clear the baseline — cards show the current run only, same footprint."
                className="face-mono border px-1.5 py-0.5 t-caption text-ink-2 hover:text-ink"
                style={{ borderColor: token("line-2"), borderRadius: 2 }}
              >
                clear A
              </Press>
            ) : (
              <Press
                type="button"
                onClick={() => setBaseline("auto")}
                title="Restore the default baseline: the current run's chronological predecessor."
                className="face-mono border px-1.5 py-0.5 t-caption text-ink-2 hover:text-ink"
                style={{ borderColor: token("line-2"), borderRadius: 2 }}
              >
                A: auto
              </Press>
            )}
            <Press
              type="button"
              onClick={() => setUnderlay((u) => !u)}
              title="Show/hide the solver evidence layer (received ink + invented closures). The registered Revit plan remains the substrate."
              className={cn(
                "face-mono rounded-[2px] px-1.5 py-0.5 t-caption",
                underlay ? "bg-recess text-ink" : "border text-ink-2",
              )}
              style={underlay ? undefined : { borderColor: token("line-2") }}
            >
              ink evidence
            </Press>
            <Press
              type="button"
              onClick={() => setChangedOnly((c) => !c)}
              disabled={!comparing}
              title={
                comparing
                  ? "Show only zones that materially changed between A and B (rooms moved, sf moved > 0.5, verdict flipped, or exists on one side only)."
                  : "Needs a baseline — pick A first."
              }
              className={cn(
                "face-mono rounded-[2px] px-1.5 py-0.5 t-caption",
                changedOnly && comparing
                  ? "bg-recess text-ink"
                  : "border text-ink-2 disabled:opacity-40",
              )}
              style={changedOnly && comparing ? undefined : { borderColor: token("line-2") }}
            >
              changed only
            </Press>
          </span>
        </div>
        <RunStrip
          runs={runs}
          curId={curId}
          prevId={prevId}
          onPickCur={pickCur}
          onPickBaseline={pickBaseline}
        />
      </header>

      <div className="min-h-0 flex-1">
        <PaneSplit
          axis="vertical"
          resize={{
            target: "start",
            defaultSize: 360,
            minSize: 180,
            minOtherSize: 240,
            persist: "pe-runs-combo-plan-h",
            collapse: {
              collapsed: !planOpen,
              onCollapsedChange: (c) => setPlanOpen(!c),
              collapsedSize: 33,
              collapseBelow: 100,
            },
          }}
          start={
            <Pane
              kind="visual"
              title="plan"
              meta={comparing ? "A | B — panes share one viewport" : "the level, spatially true"}
              actions={
                <Press
                  type="button"
                  onClick={() => setPlanOpen((o) => !o)}
                  title={
                    planOpen
                      ? "Collapse the plan dock (drag the divider to resize it)."
                      : "Expand the plan dock."
                  }
                  className="face-mono px-1.5 t-label text-ink-2 hover:text-ink"
                >
                  {planOpen ? "▴ hide plan" : "▾ show plan"}
                </Press>
              }
            >
              {planOpen && (
                <PlanDock
                  curId={curId}
                  prevId={prevId}
                  underlay={underlay}
                  focus={focus}
                  levels={levels.map((l) => l.level)}
                  level={planLevel}
                  onPickLevel={pickLevel}
                  highlight={highlight}
                  onToggleZone={toggleZoneByName}
                />
              )}
            </Pane>
          }
          end={sheetAndLedger}
        />
      </div>
    </div>
  );
}
