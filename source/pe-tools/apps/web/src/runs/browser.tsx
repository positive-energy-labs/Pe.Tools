// The takeoff run browser — the one /runs surface. A sheet of two-column zone cards is the page
// body, grouped into level sections; the PLAN docks collapsible + resizable at the TOP (atlas
// presentation law); the LEDGER docks collapsible at the BOTTOM, and its row marks ARE the run
// selector. A/B against the chronological predecessor is the DEFAULT state, not a mode you enter:
// clearing the baseline never shifts the layout, it only empties the A side of each card.
//
// Underlay law: every canvas underlay is DESATURATED — received ink is a solid mid-gray, invented
// closures are lighter + screened (honesty survives the muting: solid = drawn/received, screened =
// synthetic/invented). SVG decisions are rebalanced to read against the muted paper. The raster
// layer is togglable. Chrome is light-mode role tokens.
//
// Promoted from the round-2 `combo` prototype at round close, 2026-08-17 — the three round-1
// variants (sheet/ledger/light) and the variant switcher are deleted; git history holds them at
// a26916e/33139e2. Open stand-ins are ledgered in docs/features/takeoff-runs/SHIMS.md.
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
import { Chip } from "#/components/ui/chip";
import { Pane, PaneSplit } from "#/components/ui/pane";
import { cn } from "#/lib/utils";
// The app's one EmptyState primitive lives in ops/primitives (components/lang has none). It is
// pure presentation — no ops coupling — so /runs borrows it rather than forking a second one.
import { EmptyState } from "#/ops/primitives";

import {
  boardSummary,
  fetchRunIndex,
  loadRaster,
  loadRunReport,
  loadRunScores,
  loadZoneGeometry,
  matchZone,
  paintRaster,
  pairZones,
  type Raster,
  ringPath,
  type RunIndexEntry,
  type RunReport,
  type RunScores,
  scoreBoards,
  toPx,
  type TsvRoom,
  type ZoneGeometry,
  type ZonePair,
  type ZoneRecord,
  type ZoneViewport,
  zoneViewport,
} from "./world";

// ---------------------------------------------------------------------------
// Palette. The canvas is a visual canvas (COLOR-ROLES: its own resting palette), but round 2's
// underlay law mutes the EVIDENCE so the DECISIONS can be read. Received ink stays the only
// solid raster; invented closures stay screened — gray vs lighter screened keeps the honesty
// semantics even desaturated.
// ---------------------------------------------------------------------------

const PAPER = "#fcfbf9";
// evidence (muted): solid mid-gray ink; closures lighter, faint residual hue, screened
const INK_M: [number, number, number, number] = [122, 118, 114, 235];
const SEAL_M: [number, number, number, number] = [184, 126, 118, 175];
const CLOSE_M: [number, number, number, number] = [196, 178, 152, 165];
// decisions (rebalanced UP against the muted paper)
const ACCEPT_STROKE = "rgb(23,98,135)";
const ACCEPT_FILL = "rgba(35,118,158,0.12)";
const HELD_STROKE = "#a97e16";
const HELD_FILL = "rgba(196,150,44,0.10)";
const VOID_STROKE = "rgba(146,142,138,0.7)";
const VOID_FILL = "rgba(146,142,138,0.07)";
// disposition-unknown rooms: pre-column packages (SHIMS.md #3). Neutral warm gray — deliberately
// NOT the accepted blue; unknown must never dress as accepted.
const UNKNOWN_STROKE = "rgba(120,113,108,0.9)";
const UNKNOWN_FILL = "rgba(120,113,108,0.08)";
const ZONE_STROKE = "rgb(108,52,140)";
const MIST = "rgba(100,116,139,0.14)"; // focus-is-mist law, even on the drawing
const LABEL = "rgba(120,113,108,0.85)";

const UNKNOWN_TITLE =
  "Disposition unknown — this package predates the persisted ROOM disposition column. " +
  "Not drawn as accepted; re-run the harness for a package that says which rooms it accepted.";

/** Room tones follow the PERSISTED disposition column only. */
function roomTone(disposition: TsvRoom["disposition"]): { stroke: string; fill: string } {
  if (disposition === "accepted") return { stroke: ACCEPT_STROKE, fill: ACCEPT_FILL };
  if (disposition === "held") return { stroke: HELD_STROKE, fill: HELD_FILL };
  return { stroke: UNKNOWN_STROKE, fill: UNKNOWN_FILL };
}

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
  if (value === null) return <span className="text-muted-foreground/60">—</span>;
  const eps = 0.5 * 10 ** -digits; // half a display unit — matches every precision, incl. scorer's 3

  if (Math.abs(value) < eps) {
    return (
      <span className="text-muted-foreground/60" title="No change vs the baseline run.">
        ·
      </span>
    );
  }
  const good = goodWhenUp ? value > 0 : value < 0;
  return (
    <span
      className="tabular-nums"
      style={{ color: good ? "var(--st-done)" : "var(--st-warn)" }}
    >
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

function ZonePanel(props: {
  runId: string;
  zone: ZoneRecord;
  maxW: number;
  maxH: number;
  underlay: boolean;
}) {
  const { runId, zone, maxW, maxH, underlay } = props;
  const vp: ZoneViewport = useMemo(() => {
    const pad = 4;
    const wFt = zone.MaxX - zone.MinX + pad * 2;
    const hFt = zone.MaxY - zone.MinY + pad * 2;
    const pxPerFt = Math.min(7, Math.max(0.4, Math.min(maxW / wFt, maxH / hFt)));
    return zoneViewport(zone, pxPerFt, pad);
  }, [zone, maxW, maxH]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [geom, setGeom] = useState<ZoneGeometry | null>(null);

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
    const canvas = canvasRef.current;
    if (!canvas || !geom) return;
    let live = true;
    void (async () => {
      const [ink, seals, close] = underlay
        ? await Promise.all([
            loadRaster(runId, zone.Ink).catch(() => null),
            zone.Seals ? loadRaster(runId, zone.Seals).catch(() => null) : null,
            zone.Close ? loadRaster(runId, zone.Close).catch(() => null) : null,
          ])
        : [null, null, null];
      if (!live) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, vp.widthPx, vp.heightPx);
      const fill = (loops: [number, number][][], color: string) => {
        ctx.fillStyle = color;
        ctx.fill(new Path2D(ringPath(vp, loops)), "evenodd");
      };
      for (const room of geom.rooms) {
        const rings = geom.polys.get(room.id);
        if (rings) fill(rings.map((r) => r.points), roomTone(room.disposition).fill);
      }
      for (const res of geom.residues) {
        fill(res.loops, res.reason === "rejected" ? HELD_FILL : VOID_FILL);
      }
      // gap (SHIMS.md #6): world.ts paintRaster has no speck filter — the python renderer hides
      // closure components < 0.25 sf; here single-cell closure speckle paints as-is (muted, at
      // least). The two renderers therefore disagree about what a closure "looks like".
      try {
        if (close) paintRaster(ctx, close, vp, CLOSE_M, true);
        if (seals) paintRaster(ctx, seals, vp, SEAL_M, true);
        if (ink) paintRaster(ctx, ink, vp, INK_M, false);
      } catch {
        // evidence layer failed — the decision fills underneath stay visible
      }
    })();
    return () => {
      live = false;
    };
  }, [runId, zone, vp, geom, underlay]);

  return (
    <div
      className="relative shrink-0 overflow-hidden"
      style={{ width: maxW, height: maxH, background: PAPER, borderRadius: 2 }}
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
          {geom?.rooms.map((room) => {
            const rings = geom.polys.get(room.id);
            if (!rings) return null;
            const unknown = room.disposition === null;
            return (
              <path
                key={room.id}
                d={ringPath(vp, rings.map((r) => r.points))}
                fill="none"
                stroke={roomTone(room.disposition).stroke}
                strokeWidth={unknown ? 1.25 : 1.75}
                strokeDasharray={unknown ? "2 2" : undefined}
              >
                {unknown ? <title>{UNKNOWN_TITLE}</title> : null}
              </path>
            );
          })}
          {geom?.residues.map((res) => (
            <path
              key={res.id}
              d={ringPath(vp, res.loops)}
              fill="none"
              stroke={res.reason === "rejected" ? HELD_STROKE : VOID_STROKE}
              strokeWidth={res.reason === "rejected" ? 1.6 : 0.75}
              strokeDasharray={res.reason === "rejected" ? "4 3" : undefined}
            />
          ))}
          <path
            d={ringPath(vp, zone.ZoneLoops as [number, number][][])}
            fill="none"
            stroke={ZONE_STROKE}
            strokeWidth={1.5}
            strokeDasharray={zone.triage.verdict === "hold" ? "7 4" : undefined}
            opacity={0.9}
          />
        </svg>
      </div>
    </div>
  );
}

function MissingPanel(props: { w: number; h: number; label: string }) {
  return (
    <div
      className="tele flex shrink-0 items-center justify-center bg-secondary text-[11px] text-muted-foreground"
      style={{ width: props.w, height: props.h, borderRadius: 2 }}
    >
      {props.label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zone card — the round-2 rich summary. A|B panels side by side by DEFAULT; with the baseline
// cleared the single panel spans the same footprint (the page grid never shifts). Stats are a
// fixed-row A/B table so the eye can column-scan the whole sheet.
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
      <span style={{ color: z.triage.verdict === "solve" ? "var(--st-done)" : "var(--st-warn)" }}>
        {z.triage.verdict}
        <span className="text-muted-foreground"> · {z.triage.reason}</span>
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
      <Delta value={(b.InkBackedEdgeFraction - a.InkBackedEdgeFraction) * 100} digits={1} suffix="pp" />
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
        <span className="text-muted-foreground">none</span>
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
  onLocate: (zone: ZoneRecord) => void;
}) {
  const { name, a, b, pairedBy, runA, runB, panelFullW, panelHalfW, panelH, underlay, onLocate } = props;
  const comparing = runA !== null;
  const deltaSf = comparing && a && b ? Math.round(b.AcceptedSqft - a.AcceptedSqft) : null;
  const locatable = b ?? a;
  const knobs = b ? adaptedKnobs(b) : [];

  return (
    <div
      className="flex min-w-0 flex-col gap-1.5 border bg-background p-2"
      style={{ borderColor: "var(--line-2)", borderRadius: 2 }}
    >
      <div className="flex items-baseline gap-2">
        <span className="tele text-xs font-semibold" title={name}>
          {zoneShort(name)}
        </span>
        {b ? (
          <Chip
            tone={b.triage.verdict === "solve" ? "done" : "warn"}
            title={`Triage verdict for the current run: ${b.triage.verdict} — ${b.triage.reason}`}
          >
            {b.triage.verdict}
          </Chip>
        ) : (
          <Chip tone="meta" title="This zone exists only in the baseline run — the zoning pass cut the level differently.">
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
          <span className="tele text-[11px]">
            Δ<Delta value={deltaSf} suffix=" sf" />
          </span>
        ) : null}
        {locatable ? (
          <button
            type="button"
            onClick={() => onLocate(locatable)}
            title="Open the plan dock (if closed) and center this zone on its level."
            className="tele ml-auto shrink-0 border px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            style={{ borderColor: "var(--line-2)", borderRadius: 2 }}
          >
            ⌖ plan
          </button>
        ) : null}
      </div>

      {/* Panel strip: A|B when a baseline is set; the single panel SPANS the same footprint
          otherwise — the card (and the page grid) never changes size. */}
      <div className="flex gap-2">
        {comparing ? (
          <>
            {a && runA ? (
              <ZonePanel runId={runA} zone={a} maxW={panelHalfW} maxH={panelH} underlay={underlay} />
            ) : (
              <MissingPanel w={panelHalfW} h={panelH} label="not in baseline" />
            )}
            {b ? (
              <ZonePanel runId={runB} zone={b} maxW={panelHalfW} maxH={panelH} underlay={underlay} />
            ) : (
              <MissingPanel w={panelHalfW} h={panelH} label="not in current" />
            )}
          </>
        ) : b ? (
          <ZonePanel runId={runB} zone={b} maxW={panelFullW} maxH={panelH} underlay={underlay} />
        ) : (
          <MissingPanel w={panelFullW} h={panelH} label="not in run" />
        )}
      </div>

      <table className="tele w-full table-fixed text-[11px] leading-4">
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
            <tr className="text-[10px] text-muted-foreground">
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
              <td className="pr-2 text-muted-foreground">{row.label}</td>
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
              <td className="pr-2 text-muted-foreground">knobs</td>
              <td colSpan={comparing ? 3 : 1}>
                <span className="flex flex-wrap gap-1">
                  {knobs.map(([k, v]) => (
                    <Chip key={k} tone="meta" dashed title={`Solver self-tuned ${k} to ${v} for this zone.`}>
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
              borderColor: isCur || isPrev ? "var(--st-meta)" : "var(--line-2)",
              borderRadius: 2,
              background: isCur ? "var(--secondary)" : "transparent",
            }}
          >
            <button
              type="button"
              onClick={() => onPickCur(entry.id)}
              className="flex flex-col items-start px-2 py-1 text-left"
              title={`${entry.id} — click to make this the CURRENT run (B).`}
            >
              <span className="tele text-xs leading-4">
                {isCur ? <b>B · </b> : null}
                {meta?.label ?? entry.id.slice(0, 15)}
              </span>
              <span className="tele text-[10px] leading-3 text-muted-foreground">
                {meta?.optionsHash.slice(0, 8) ?? "?"} · {meta ? fmtTime(meta.generatedUtc) : ""}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onPickBaseline(entry.id)}
              disabled={isCur}
              className="border-l px-1.5 text-[10px]"
              style={{
                borderColor: "var(--line-2)",
                background: isPrev ? "var(--secondary)" : "transparent",
                color: isCur
                  ? "var(--line-2)"
                  : isPrev
                    ? "var(--foreground)"
                    : "var(--st-meta)",
              }}
              title={isPrev ? "This is the baseline (A) — click to clear it." : "Compare against this run as baseline (A)."}
            >
              {isPrev ? "A✕" : "A"}
            </button>
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
  return { minX: r.minX, minY: r.minY, maxX: r.minX + r.w * r.cellFt, maxY: r.minY + r.h * r.cellFt };
}

// Level frame seeded by the FIRST raster seen and then held fixed → run stepping flip-books
// in place instead of re-fitting.
const frameCache = new Map<string, Frame>();
function levelFrame(level: string, ink: Raster): Frame {
  let f = frameCache.get(level);
  if (!f) {
    f = rasterFrame(ink);
    frameCache.set(level, f);
  }
  return f;
}

// One offscreen canvas per run+level at native raster resolution, muted palette. Separate
// cache from light.tsx's (different paint) — both are tiny.
const levelCanvasCache = new Map<string, Promise<{ canvas: HTMLCanvasElement; ink: Raster }>>();
function loadLevelCanvas(runId: string, zone: ZoneRecord): Promise<{ canvas: HTMLCanvasElement; ink: Raster }> {
  const key = `combo:${runId}/${zone.Ink}`;
  let cached = levelCanvasCache.get(key);
  if (!cached) {
    cached = (async () => {
      const [ink, seals, close] = await Promise.all([
        loadRaster(runId, zone.Ink),
        zone.Seals ? loadRaster(runId, zone.Seals) : Promise.resolve(null),
        zone.Close ? loadRaster(runId, zone.Close) : Promise.resolve(null),
      ]);
      const vp: ZoneViewport = { ...rasterFrame(ink), pxPerFt: 1 / ink.cellFt, widthPx: ink.w, heightPx: ink.h };
      const canvas = document.createElement("canvas");
      canvas.width = ink.w;
      canvas.height = ink.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context unavailable");
      // Paint order is the law: invented closures under, received ink LAST.
      if (close) paintRaster(ctx, close, vp, CLOSE_M, true);
      if (seals) paintRaster(ctx, seals, vp, SEAL_M, true);
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
        const painted = anchor ? await loadLevelCanvas(runId, anchor) : null;
        const geomEntries = await Promise.all(
          zones
            .filter((z) => z.Tsv)
            .map(async (z) => [z.Zone, await loadZoneGeometry(runId, z.Tsv)] as const),
        );
        if (stale) return;
        setData({
          report,
          zones,
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

function levelOrder(report: RunReport): string[] {
  const idx = new Map<string, number>();
  for (const z of report.Zones) {
    if (idx.has(z.Level)) continue;
    const m = /Level_(\d+)_/.exec(z.Ink);
    idx.set(z.Level, m ? Number(m[1]) : 99);
  }
  return [...idx.keys()].sort((a, b) => (idx.get(a) ?? 99) - (idx.get(b) ?? 99));
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
        nodes.push(
          <path
            key={`q:${zone.Zone}/${res.id}`}
            d={ringPath(vp, res.loops)}
            fillRule="evenodd"
            fill={VOID_FILL}
            stroke="none"
          />,
        );
      }
      const dispositionById = new Map(geom.rooms.map((room) => [room.id, room.disposition]));
      for (const [roomId, rings] of geom.polys) {
        const disposition = dispositionById.get(roomId) ?? null;
        const tone = roomTone(disposition);
        nodes.push(
          <path
            key={`r:${zone.Zone}/${roomId}`}
            d={ringPath(vp, rings.map((ring) => ring.points))}
            fillRule="evenodd"
            fill={tone.fill}
            stroke={tone.stroke}
            strokeOpacity={0.85}
            style={{ strokeWidth: "calc(var(--sw) * 1.4px)" }}
          >
            {disposition === null ? <title>{UNKNOWN_TITLE}</title> : null}
          </path>,
        );
      }
    }
    return nodes;
  }, [data, vp]);

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
          held.push(
            <path
              key={`h:${zone.Zone}/${res.id}`}
              d={ringPath(vp, res.loops)}
              fillRule="evenodd"
              fill="none"
              stroke={HELD_STROKE}
              strokeDasharray="6 4"
              style={{ strokeWidth: "calc(var(--sw) * 1.6px)" }}
            />,
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
            fill={lit ? MIST : "transparent"}
            stroke={ZONE_STROKE}
            strokeDasharray={zone.triage.verdict === "hold" ? "8 5" : undefined}
            style={{ strokeWidth: `calc(var(--sw) * ${lit ? 2.2 : 1.3}px)`, cursor: "pointer" }}
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
            fontFamily="monospace"
            style={{ fontSize: "calc(var(--sw) * 10px)" }}
          >
            {zone.Zone.split("#")[1] ?? zone.Zone} {zone.triage.verdict === "hold" ? "· hold" : ""}
          </text>
        </g>,
      );
    }
    return [...zones, ...held];
  }, [data, vp, props.hoverZone, props.pinnedZone, props.onHover, props.onPick]);

  const inkTopLeft = data?.ink ? toPx(vp, data.ink.minX, data.ink.minY + data.ink.h * data.ink.cellFt) : null;
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
      style={{ background: PAPER, cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
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
        <svg
          width={vp.widthPx}
          height={vp.heightPx}
          viewBox={`0 0 ${vp.widthPx} ${vp.heightPx}`}
          style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
          role="img"
          aria-label="accepted rooms"
        >
          {underLayer}
        </svg>
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
          aria-label="zones and held residues"
        >
          {overLayer}
        </svg>
      </div>
      {props.tag && (
        <div className="tele absolute left-2 top-2 border bg-background/90 px-1.5 py-0.5 text-[11px] text-muted-foreground" style={{ borderRadius: 2 }}>
          {props.tag}
        </div>
      )}
      {!data && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          loading {props.runId}…
        </div>
      )}
    </div>
  );
}

// ---- floaters -------------------------------------------------------------

/** The key. Round-2 brief: takeoffs' key is bad — this one says what each mark MEANS, groups
 * evidence (the run's raster) apart from decisions (SVG), and states the honesty rule out
 * loud instead of leaving it to induction. */
function LegendFloater(props: { underlay: boolean }) {
  const sw = (bg: string, extra?: CSSProperties) => (
    <span className="inline-block h-2.5 w-4 shrink-0 rounded-[1px]" style={{ background: bg, ...extra }} />
  );
  const line = (border: string, dashed = false) => (
    <span
      className="inline-block h-0 w-4 shrink-0"
      style={{ borderTop: `2px ${dashed ? "dashed" : "solid"} ${border}` }}
    />
  );
  const row = (mark: ReactNode, label: string, meaning: string) => (
    <span className="flex items-center gap-1.5" title={meaning}>
      {mark}
      <span>{label}</span>
    </span>
  );
  return (
    <div
      className="tele absolute right-2 top-2 flex w-52 flex-col gap-1 border bg-background/95 px-2 py-1.5 text-[10px] text-muted-foreground shadow-sm"
      style={{ borderRadius: 2 }}
    >
      <span className={cn("font-semibold uppercase tracking-wide", !props.underlay && "line-through opacity-50")}>
        evidence — the run's raster
      </span>
      <div className={cn("flex flex-col gap-0.5", !props.underlay && "opacity-40")}>
        {row(sw("rgb(122,118,114)"), "received ink (solid)", "Wall pixels the solver actually received from the DWG. Solid = drawn; muted so decisions stay readable.")}
        {row(
          sw("rgba(184,126,118,0.7)", { backgroundImage: "repeating-linear-gradient(45deg, transparent 0 2px, #fff 2px 3px)" }),
          "door-head seal (invented)",
          "Closure the solver INVENTED across door openings. Screened = synthetic — it can never read as a drawn wall, even muted.",
        )}
        {row(
          sw("rgba(196,178,152,0.7)", { backgroundImage: "repeating-linear-gradient(45deg, transparent 0 2px, #fff 2px 3px)" }),
          "gap-close (invented)",
          "Closure the solver INVENTED across wall-run gaps. Screened = synthetic.",
        )}
      </div>
      <span className="mt-0.5 font-semibold uppercase tracking-wide">decisions — drawn on top</span>
      <div className="flex flex-col gap-0.5">
        {row(sw(ACCEPT_FILL, { border: `1.5px solid ${ACCEPT_STROKE}` }), "accepted room", "A room the solver accepted into the takeoff — per the persisted disposition column.")}
        {row(line(HELD_STROKE, true), "held residue", "Area the solver found but did not trust — held for review, not counted.")}
        {row(sw(UNKNOWN_FILL, { border: `1px dashed ${UNKNOWN_STROKE}` }), "room — disposition unknown", UNKNOWN_TITLE)}
        {row(sw(VOID_FILL, { border: `1px solid ${VOID_STROKE}` }), "void / excluded", "Area inside the zone the solver deliberately excluded.")}
        {row(line(ZONE_STROKE), "zone — solid = solve", "Zone boundary. Solid stroke: triage verdict solve.")}
        {row(line(ZONE_STROKE, true), "zone — dashed = hold", "Zone boundary. Dashed stroke: triage verdict hold.")}
      </div>
      <span className="mt-0.5 border-t pt-1 text-[9px]" style={{ borderColor: "var(--line-2)" }}>
        solid = received · screened = invented{props.underlay ? "" : " · underlay hidden"}
      </span>
    </div>
  );
}

/** Level stats for algo tuning: solved/zones, accepted vs held sf, loudest rejection families
 * on the visible level, and A/B deltas while comparing. */
function LevelStatsFloater(props: { level: string; cur: LevelData | null; prev: LevelData | null }) {
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
      className="tele absolute bottom-2 right-2 flex w-56 flex-col gap-0.5 border bg-background/95 px-2 py-1.5 text-[11px] shadow-sm"
      style={{ borderRadius: 2 }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {level} — this run
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
        <span className="mt-0.5 flex flex-col text-muted-foreground">
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

/** Zone peek — light.tsx's card plus the closure split and adapted knobs. */
function ZonePeekFloater(props: {
  zoneName: string;
  b: ZoneRecord;
  a: ZoneRecord | null | undefined;
  comparing: boolean;
  pinned: boolean;
}) {
  const { a, b, comparing } = props;
  const cell = (z: ZoneRecord | null | undefined, f: (z: ZoneRecord) => string) => (z ? f(z) : "—");
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
  const knobs = adaptedKnobs(b);
  return (
    <div
      className="tele pointer-events-none absolute bottom-2 left-2 w-[26rem] border bg-background/95 p-2 text-[11px] shadow-sm"
      style={{ borderRadius: 2 }}
    >
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-foreground">{props.zoneName}</span>
        {props.pinned && <span className="text-[10px] text-muted-foreground">pinned · esc</span>}
        {comparing && <span className="ml-auto text-[10px] text-muted-foreground">A / B</span>}
      </div>
      <table className="w-full">
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label}>
              <td className="pr-2 text-muted-foreground">{label}</td>
              {comparing && <td className="pr-2 text-foreground">{cell(a, f)}</td>}
              <td className="text-foreground">{f(b)}</td>
            </tr>
          ))}
          <tr>
            <td className="pr-2 align-top text-muted-foreground">rejections</td>
            {comparing && (
              <td className="pr-2 align-top text-foreground">
                {a
                  ? topRejections(a).map(([k, n]) => (
                      <span key={k} className="block">
                        {k} ×{n}
                      </span>
                    ))
                  : "—"}
              </td>
            )}
            <td className="align-top text-foreground">
              {topRejections(b).map(([k, n]) => (
                <span key={k} className="block">
                  {k} ×{n}
                </span>
              ))}
              {Object.keys(b.Rejections).length === 0 && "none"}
            </td>
          </tr>
          {knobs.length > 0 && (
            <tr>
              <td className="pr-2 align-top text-muted-foreground">knobs</td>
              <td colSpan={comparing ? 2 : 1} className="text-foreground">
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
}) {
  const { curId, prevId, underlay, focus } = props;
  const comparing = prevId !== null;

  const [levels, setLevels] = useState<string[]>([]);
  const [level, setLevel] = useState<string | null>(null);
  const [view, setView] = useState<View>({ tx: 0, ty: 0, scale: 1 });
  const [hoverZone, setHoverZone] = useState<string | null>(null);
  const [pinnedZone, setPinnedZone] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<FocusRequest | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let stale = false;
    void loadRunReport(curId).then((rep) => {
      if (stale) return;
      const order = levelOrder(rep);
      setLevels(order);
      setLevel((cur) => (cur && order.includes(cur) ? cur : (order.find((l) => l.includes("Main")) ?? order[0] ?? null)));
    });
    return () => {
      stale = true;
    };
  }, [curId]);

  const dataCur = useLevelData(curId, level);
  const dataPrev = useLevelData(prevId, level);

  const frame = useMemo(() => {
    if (!level) return null;
    if (dataCur?.ink) return levelFrame(level, dataCur.ink);
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
    setView({ scale: s, tx: (paneW - vp.widthPx * s) / 2, ty: (el.clientHeight - vp.heightPx * s) / 2 });
  }, [frame, comparing]);

  // Card → plan linkage (one-directional this round): a locate request switches the level,
  // pins the zone, and centers the view on its bbox once the level frame is available.
  useEffect(() => {
    if (!focus) return;
    setLevel(focus.zone.Level);
    setPinnedZone(focus.zone.Zone);
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

  // esc unpins; input fields keep their keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /input|textarea|select/i.test(t.tagName)) return;
      if (e.key === "Escape") setPinnedZone(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setPinnedZone(null);
    setHoverZone(null);
  }, [level]);

  const onPick = useCallback((z: string) => setPinnedZone((cur) => (cur === z ? null : z)), []);

  const peekZone = hoverZone ?? pinnedZone;
  const zoneCur = peekZone ? (dataCur?.zones.find((z) => z.Zone === peekZone) ?? null) : null;
  // A-side twin by the stable zone key when both packages carry it; positional-name matching
  // only as the pre-key fallback (SHIMS.md #2 close).
  const zonePrev = zoneCur ? matchZone(dataPrev?.zones ?? [], zoneCur) : null;

  return (
    <div className="flex size-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1" style={{ borderColor: "var(--line-2)" }}>
        <div className="flex gap-0.5">
          {levels.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLevel(l)}
              className={cn(
                "tele rounded-[2px] px-2 py-0.5 text-[11px]",
                l === level ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {l.replace(" Level", "")}
            </button>
          ))}
        </div>
        <span className="tele ml-auto text-[10px] text-muted-foreground">
          drag = pan · wheel = zoom · click zone = pin peek · esc = unpin
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
                pinnedZone={pinnedZone}
                onHover={setHoverZone}
                onPick={onPick}
              />
            ) : null}
            <div className={cn("flex flex-1", comparing && "border-l")} style={comparing ? { borderColor: "var(--line-2)" } : undefined}>
              <PlanPane
                runId={curId}
                tag={comparing ? "B · current" : null}
                data={dataCur}
                frame={frame}
                view={view}
                setView={setView}
                underlay={underlay}
                hoverZone={hoverZone}
                pinnedZone={pinnedZone}
                onHover={setHoverZone}
                onPick={onPick}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            loading {level ?? "level"}…
          </div>
        )}
        <LegendFloater underlay={underlay} />
        {level && <LevelStatsFloater level={level} cur={dataCur} prev={comparing ? dataPrev : null} />}
        {peekZone && zoneCur && (
          <ZonePeekFloater
            zoneName={peekZone}
            b={zoneCur}
            a={zonePrev}
            comparing={comparing}
            pinned={pinnedZone === peekZone}
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
      scoreDelta: savedWorkDelta(
        scoresAll[i]!,
        i + 1 < index.length ? scoresAll[i + 1]! : null,
      ),
      delta: prev
        ? {
            solved: board.solved - prev.solved,
            rooms: board.acceptedRooms - prev.acceptedRooms,
            sqft: board.acceptedSqft - prev.acceptedSqft,
            held: board.heldSqft - prev.heldSqft,
          }
        : null,
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
        className="tele block px-1.5 text-right text-[10px] text-muted-foreground"
        title={NO_SCORES_TITLE}
      >
        no scores
      </span>
    );
  }
  return (
    <span className="tele block px-1.5 text-right tabular-nums">
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
      <Chip tone="warn" title={NO_SCORES_TITLE}>
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
      className="tele text-xs text-muted-foreground"
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
        title: "The run's label (or options-hash name) and when the harness persisted it. Sorted descending = newest first. Click the row to make it the CURRENT run (B).",
        sort: (row) => row.id, // ids are timestamp-prefixed — id order IS chronology
        search: (row) => `${row.label ?? ""} ${row.hash} ${row.id}`,
        cell: (row) => (
          <span className="tele flex min-w-0 items-baseline gap-1.5 px-1.5">
            <span className={cn("truncate", row.label ? "text-foreground" : "text-muted-foreground")}>
              {runName(row)}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground/70">{fmtTime(row.when)}</span>
          </span>
        ),
      },
      {
        key: "options",
        label: "options",
        width: "w-20",
        title: "Solver options generation — runs sharing a hash ran identical options; a hash change means the knobs moved.",
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
        title: "The sheet's A/B selection. B (current) follows the clicked row; this cell sets/clears A (baseline).",
        cell: (row) => {
          if (row.id === curId) {
            return <span className="tele block px-1.5 font-semibold text-foreground">B</span>;
          }
          const isA = row.id === prevId;
          return (
            <button
              type="button"
              onClick={() => onPickBaseline(row.id)}
              title={isA ? "This is the baseline (A) — click to clear it." : "Set this run as the baseline (A)."}
              className={cn(
                "tele h-7 w-full px-1.5 text-left",
                isA ? "font-semibold text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground",
              )}
            >
              {isA ? "A" : "set A"}
            </button>
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
          <span className="tele block px-1.5 text-right tabular-nums">
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
          <span className="tele block px-1.5 text-right tabular-nums">{row.board.acceptedRooms}</span>
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
          <span className="tele block px-1.5 text-right tabular-nums">{fmtNum(row.board.acceptedSqft, 0)}</span>
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
          <span className="tele block px-1.5 text-right tabular-nums text-muted-foreground">
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
          <span className="tele block px-1.5 text-right">
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
        title: "Solved zones vs this run's chronological predecessor — NOT the row below after sorting.",
        sort: (row) => row.delta?.solved ?? Number.NEGATIVE_INFINITY,
        cell: (row) => (
          <span className="tele block px-1.5 text-right">
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
          <span className="tele block px-1.5 text-right">
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
          <span className="tele block px-1.5 text-right">
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
          <span className="tele block px-1.5 text-right">
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
              <Chip key={reason} tone="meta" title={`${count} rejections of kind ${reason} in this run.`}>
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
    <div className="shrink-0 border-t" style={{ borderColor: "var(--line-2)" }}>
      <button
        type="button"
        onClick={onToggle}
        title={open ? "Collapse the run ledger." : "Expand the run ledger — rows are runs, marks drive the sheet's A/B."}
        className="flex w-full items-baseline gap-2 px-3 py-1 text-left hover:bg-muted"
      >
        <span className="tele-label text-muted-foreground">ledger</span>
        <span className="tele text-[11px] text-muted-foreground">
          {runs.length} runs · {optionSets} option sets · click a row = current (B), mark = baseline (A)
        </span>
        <span className="tele ml-auto text-[11px] text-muted-foreground">{open ? "▾ collapse" : "▴ expand"}</span>
      </button>
      {open && (
        <div className="flex flex-col" style={{ height: 320 }}>
          {/* Provenance: the surface names the directory it read, so "which pool am I looking
              at?" is never an inference from the run labels. */}
          {pool && (
            <div
              className="tele shrink-0 truncate border-b px-3 py-1 text-[10px] text-muted-foreground"
              style={{ borderColor: "var(--line-2)" }}
              title="The run pool this page is reading — PE_TAKEOFF_RUNS_DIR if set, else <repo>/.artifacts/takeoff-runs."
            >
              pool {pool}
            </div>
          )}
          {rows === null ? (
            <div className="tele p-4 text-sm text-muted-foreground">loading the run ledger…</div>
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
  const [underlay, setUnderlay] = useState(true);
  const [changedOnly, setChangedOnly] = useState(false);
  const [planOpen, setPlanOpen] = useState(true);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [reportCur, setReportCur] = useState<RunReport | null>(null);
  const [reportPrev, setReportPrev] = useState<RunReport | null>(null);
  // scores.json per side: undefined = loading, null = the package has no scores.json.
  const [scoresCur, setScoresCur] = useState<RunScores | null | undefined>(undefined);
  const [scoresPrev, setScoresPrev] = useState<RunScores | null | undefined>(undefined);

  useEffect(() => {
    fetchRunIndex()
      .then((index) => {
        setRuns(index.runs);
        setPool(index.pool);
        setCurId((prev) => prev ?? index.runs[0]?.id ?? null);
      })
      .catch((err: unknown) => setError(String(err)));
  }, []);

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

  // ↑/↓ scrub the current run through the pool. (←/→ are free again now that the round-1
  // variant switcher is gone; left unbound until there is a second axis worth scrubbing.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /input|textarea|select/i.test(t.tagName)) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (!runs || runs.length === 0) return;
      e.preventDefault();
      setCurId((current) => {
        const idx = Math.max(0, runs.findIndex((r) => r.id === current));
        const next = e.key === "ArrowUp" ? Math.max(0, idx - 1) : Math.min(runs.length - 1, idx + 1);
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

  const pickBaseline = useCallback(
    (id: string) => setBaseline((b) => (b === id ? null : id)),
    [],
  );

  const locate = useCallback((zone: ZoneRecord) => {
    setPlanOpen(true);
    setFocus((f) => ({ zone, nonce: (f?.nonce ?? 0) + 1 }));
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

  const board = reportCur ? boardSummary(reportCur) : null;
  const boardPrev = comparing && reportPrev ? boardSummary(reportPrev) : null;
  const prevMeta = runs?.find((r) => r.id === prevId)?.meta ?? null;

  // Sheet geometry: measured once at the scroll container, cards derive their panel boxes.
  const [sheetRef, sheetW] = useElementWidth();
  const cardInnerW = sheetW > 0 ? Math.max(280, Math.floor((sheetW - 32 - 12) / 2) - 18) : 560;
  const panelFullW = cardInnerW;
  const panelHalfW = Math.floor((cardInnerW - 8) / 2);
  const panelH = 220;

  if (error) {
    return (
      <div className="tele p-8 text-sm" style={{ color: "var(--st-warn)" }}>
        run pool unavailable: {error}
      </div>
    );
  }
  if (!runs) {
    return <div className="tele p-8 text-sm text-muted-foreground">loading run pool…</div>;
  }
  // Empty pool is a SYSTEM story, not a filter story: nothing is hidden, nothing has been
  // captured. The page says which directory it watched and what fills it.
  if (runs.length === 0 || !curId) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-2 p-8">
        <EmptyState note="No runs captured yet — the pool fills itself the next time the harness runs." />
        <p className="tele text-[11px] leading-relaxed text-muted-foreground">
          Every run of{" "}
          <span className="text-foreground">
            ZoneBoundedDetectTests.ProjectA_zones_partition_within_declared_scope
          </span>{" "}
          auto-persists its package (report.json, zone TSVs, INKP bins) into the pool; this page
          reads whatever is there. Nothing to configure.
        </p>
        {pool && (
          <p
            className="tele break-all text-[10px] text-muted-foreground"
            title="The run pool this page is reading — PE_TAKEOFF_RUNS_DIR if set, else <repo>/.artifacts/takeoff-runs."
          >
            pool {pool}
          </p>
        )}
      </div>
    );
  }

  const sheetAndLedger = (
    <div className="flex size-full min-h-0 flex-col">
      <main ref={sheetRef} className="min-h-0 flex-1 overflow-y-auto">
        {reportCur === null ? (
          <div className="tele p-8 text-sm text-muted-foreground">loading run…</div>
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
                <section key={level}>
                  <div
                    className="sticky top-0 z-10 -mx-4 mb-2 flex items-baseline gap-3 border-b bg-background px-4 py-1"
                    style={{ borderColor: "var(--line-2)" }}
                  >
                    <h2 className="tele text-xs font-semibold uppercase tracking-wide">{level}</h2>
                    <span className="tele text-[11px] text-muted-foreground">
                      {solved}/{zonePairs.length} solved · {fmtSqft(sf)}
                    </span>
                    {hidden > 0 && (
                      <Chip tone="meta" title="Zones with no material A/B change, hidden by the 'changed only' filter.">
                        {hidden} unchanged hidden
                      </Chip>
                    )}
                  </div>
                  <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                    {visible.map((pair) => (
                      <ZoneCard
                        key={pair.id}
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
                        onLocate={locate}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
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
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <header
        className="flex shrink-0 flex-col gap-1.5 border-b px-4 py-2"
        style={{ borderColor: "var(--line-2)" }}
      >
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="tele text-sm font-semibold">runs</h1>
          {board && (
            <span className="tele text-xs text-muted-foreground">
              B: {board.solved}/{board.zones} solved · {board.acceptedRooms} rooms ·{" "}
              {fmtSqft(board.acceptedSqft)} accepted · {fmtSqft(board.heldSqft)} held
            </span>
          )}
          {boardPrev && board && (
            <span className="tele text-xs text-muted-foreground">
              Δ vs A: <Delta value={board.solved - boardPrev.solved} /> solved ·{" "}
              <Delta value={board.acceptedSqft - boardPrev.acceptedSqft} suffix=" sf" /> ·{" "}
              <Delta value={board.heldSqft - boardPrev.heldSqft} goodWhenUp={false} suffix=" sf held" />
            </span>
          )}
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
              <button
                type="button"
                onClick={() => setBaseline(null)}
                title="Clear the baseline — cards show the current run only, same footprint."
                className="tele border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                style={{ borderColor: "var(--line-2)", borderRadius: 2 }}
              >
                clear A
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setBaseline("auto")}
                title="Restore the default baseline: the current run's chronological predecessor."
                className="tele border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                style={{ borderColor: "var(--line-2)", borderRadius: 2 }}
              >
                A: auto
              </button>
            )}
            <button
              type="button"
              onClick={() => setUnderlay((u) => !u)}
              title="Show/hide the raster evidence underlay (received ink + invented closures) on every panel and the plan."
              className={cn(
                "tele rounded-[2px] px-1.5 py-0.5 text-[10px]",
                underlay ? "bg-secondary text-secondary-foreground" : "border text-muted-foreground",
              )}
              style={underlay ? undefined : { borderColor: "var(--line-2)" }}
            >
              underlay
            </button>
            <button
              type="button"
              onClick={() => setChangedOnly((c) => !c)}
              disabled={!comparing}
              title={
                comparing
                  ? "Show only zones that materially changed between A and B (rooms moved, sf moved > 0.5, verdict flipped, or exists on one side only)."
                  : "Needs a baseline — pick A first."
              }
              className={cn(
                "tele rounded-[2px] px-1.5 py-0.5 text-[10px]",
                changedOnly && comparing
                  ? "bg-secondary text-secondary-foreground"
                  : "border text-muted-foreground disabled:opacity-40",
              )}
              style={changedOnly && comparing ? undefined : { borderColor: "var(--line-2)" }}
            >
              changed only
            </button>
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
                <button
                  type="button"
                  onClick={() => setPlanOpen((o) => !o)}
                  title={planOpen ? "Collapse the plan dock (drag the divider to resize it)." : "Expand the plan dock."}
                  className="tele px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {planOpen ? "▴ hide plan" : "▾ show plan"}
                </button>
              }
            >
              {planOpen && <PlanDock curId={curId} prevId={prevId} underlay={underlay} focus={focus} />}
            </Pane>
          }
          end={sheetAndLedger}
        />
      </div>
    </div>
  );
}
