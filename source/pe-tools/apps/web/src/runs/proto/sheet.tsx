// SHEET variant — the contact sheet, webified. The page IS a dense grid of zone cards:
// levels as sections, one active run picked from a compact history scrubber, and picking a
// second run splits every card into two synchronized A/B panels. No master table (ledger's
// thesis), no whole-level spatial pan/zoom (light's thesis) — the unit of attention here is
// the ZONE CARD, and the run is a lens you swap over the whole sheet at once.
//
// Canvas layering follows eval/rhvac/render-zone-promotion.py's honesty law exactly:
// decision fills (pale) sit UNDER evidence; received ink is solid near-black; invented
// closures (seals/close) are screened so synthetic cells can never read as drawn walls.
// The plan canvas keeps that palette (visual-canvas law); chrome uses role tokens.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  boardSummary,
  fetchRunIndex,
  loadRaster,
  loadRunReport,
  loadZoneGeometry,
  paintRaster,
  ringPath,
  zoneViewport,
  type Raster,
  type RunIndexEntry,
  type RunReport,
  type ZoneGeometry,
  type ZoneRecord,
  type ZoneViewport,
} from "./world";

// ---- canvas palette (render-zone-promotion.py, verbatim) ----
const INK: [number, number, number, number] = [25, 25, 25, 255];
const SEAL: [number, number, number, number] = [222, 58, 20, 235];
const CLOSE: [number, number, number, number] = [200, 165, 130, 220];
const ACCEPTED = "rgb(24,91,122)";
const ACCEPTED_FILL = "rgb(229,237,241)";
const HELD = "rgb(219,150,55)";
const HELD_FILL = "rgb(250,238,217)";
const VOID = "rgb(145,145,145)";
const VOID_FILL = "rgb(236,236,236)";
const ZONE = "rgb(112,44,138)";
const PAPER = "#ffffff";

const PANEL_W = 300;
const PANEL_H = 210;
const PANEL_W_AB = 246;
const PANEL_H_AB = 190;

// ---------------------------------------------------------------------------
// Zone panel: <canvas> evidence underlay + <svg> decision strokes, one shared viewport.
// ---------------------------------------------------------------------------

function ZonePanel(props: {
  runId: string;
  zone: ZoneRecord;
  maxW: number;
  maxH: number;
}) {
  const { runId, zone, maxW, maxH } = props;
  const vp: ZoneViewport = useMemo(() => {
    const pad = 4;
    const wFt = zone.MaxX - zone.MinX + pad * 2;
    const hFt = zone.MaxY - zone.MinY + pad * 2;
    // Fit the zone into the fixed panel box; cap so closet-sized zones don't render as
    // eight-px boulders of raster cells.
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
      const [ink, seals, close] = await Promise.all([
        loadRaster(runId, zone.Ink).catch(() => null),
        loadRaster(runId, zone.Seals).catch(() => null),
        loadRaster(runId, zone.Close).catch(() => null),
      ]);
      if (!live) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, vp.widthPx, vp.heightPx);
      // DECIDED fills first — under the evidence, so a decision can never obscure ink.
      const fill = (loops: [number, number][][], color: string) => {
        ctx.fillStyle = color;
        ctx.fill(new Path2D(ringPath(vp, loops)), "evenodd");
      };
      for (const room of geom.rooms) {
        const rings = geom.polys.get(room.id);
        if (rings) fill(rings.map((r) => r.points), ACCEPTED_FILL);
      }
      for (const res of geom.residues) {
        fill(res.loops, res.reason === "rejected" ? HELD_FILL : VOID_FILL);
      }
      // ADDED (screened, invented) under RECEIVED (solid, drawn).
      // gap: world.ts paintRaster has no speck filter — the python renderer hides closure
      // components < 0.25 sf; here single-cell closure speckle paints as-is.
      if (close) paintRasterSafe(ctx, close, vp, CLOSE, true);
      if (seals) paintRasterSafe(ctx, seals, vp, SEAL, true);
      if (ink) paintRasterSafe(ctx, ink, vp, INK, false);
    })();
    return () => {
      live = false;
    };
  }, [runId, zone, vp, geom]);

  return (
    <div
      className="relative shrink-0 overflow-hidden"
      style={{ width: maxW, height: maxH, background: PAPER }}
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
        <svg
          className="absolute inset-0"
          width={vp.widthPx}
          height={vp.heightPx}
          aria-hidden
        >
          {geom?.rooms.map((room) => {
            const rings = geom.polys.get(room.id);
            return rings ? (
              <path
                key={room.id}
                d={ringPath(vp, rings.map((r) => r.points))}
                fill="none"
                stroke={ACCEPTED}
                strokeWidth={1.5}
              />
            ) : null;
          })}
          {geom?.residues.map((res) => (
            <path
              key={res.id}
              d={ringPath(vp, res.loops)}
              fill="none"
              stroke={res.reason === "rejected" ? HELD : VOID}
              strokeWidth={res.reason === "rejected" ? 1.4 : 0.75}
              strokeDasharray={res.reason === "rejected" ? "4 3" : undefined}
            />
          ))}
          <path
            d={ringPath(vp, zone.ZoneLoops as [number, number][][])}
            fill="none"
            stroke={ZONE}
            strokeWidth={1.25}
            opacity={0.9}
          />
        </svg>
      </div>
    </div>
  );
}

// paintRaster mutates via getImageData/putImageData; wrap so one malformed bin can't take
// the whole card down — the decision fills underneath stay visible.
function paintRasterSafe(
  ctx: CanvasRenderingContext2D,
  raster: Raster,
  vp: ZoneViewport,
  rgba: [number, number, number, number],
  screen: boolean,
) {
  try {
    paintRaster(ctx, raster, vp, rgba, screen);
  } catch {
    // evidence layer failed; the network tab is loud enough
  }
}

// ---------------------------------------------------------------------------
// Zone card: name + verdict + the few numbers that matter, panel(s) below.
// ---------------------------------------------------------------------------

function topRejection(zone: ZoneRecord): string | null {
  const entries = Object.entries(zone.Rejections).sort((a, b) => b[1] - a[1]);
  const top = entries[0];
  return top ? `${top[0]} ×${top[1]}` : null;
}

function StatLine(props: { zone: ZoneRecord; tag?: string }) {
  const { zone, tag } = props;
  return (
    <div className="flex items-baseline gap-2 whitespace-nowrap font-mono text-[11px] leading-4">
      {tag ? (
        <span className="font-semibold" style={{ color: "var(--st-meta)" }}>
          {tag}
        </span>
      ) : null}
      <span>
        {zone.AcceptedRooms}
        <span style={{ color: ACCEPTED }}>✓</span>
        {zone.HeldRooms > 0 ? (
          <>
            {" "}
            {zone.HeldRooms}
            <span style={{ color: HELD }}>⚑</span>
          </>
        ) : null}
      </span>
      <span className="text-muted-foreground">{Math.round(zone.AcceptedSqft)} sf</span>
      <span
        style={{
          color: zone.triage.verdict === "solve" ? "var(--st-done)" : "var(--st-warn)",
        }}
      >
        {zone.triage.verdict}
        {zone.triage.verdict === "hold" ? ` · ${zone.triage.reason}` : ""}
      </span>
      {topRejection(zone) ? (
        <span className="truncate text-muted-foreground">{topRejection(zone)}</span>
      ) : null}
    </div>
  );
}

function ZoneCard(props: {
  name: string;
  a: ZoneRecord | null;
  b: ZoneRecord | null;
  runA: string;
  runB: string | null;
}) {
  const { name, a, b, runA, runB } = props;
  const comparing = runB !== null;
  const w = comparing ? PANEL_W_AB : PANEL_W;
  const h = comparing ? PANEL_H_AB : PANEL_H;
  const short = name.includes("#") ? `#${name.split("#")[1]}` : name;
  const deltaSf =
    comparing && a && b ? Math.round(b.AcceptedSqft - a.AcceptedSqft) : null;
  return (
    <div
      className="flex flex-col gap-1 border p-2"
      style={{ borderColor: "var(--line-2)", borderRadius: 2 }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs font-semibold">{short}</span>
        {deltaSf !== null && deltaSf !== 0 ? (
          <span
            className="font-mono text-[11px]"
            style={{ color: deltaSf > 0 ? "var(--st-done)" : "var(--st-warn)" }}
          >
            Δ{deltaSf > 0 ? "+" : ""}
            {deltaSf} sf
          </span>
        ) : null}
      </div>
      <div className="flex gap-2">
        {a ? (
          <ZonePanel runId={runA} zone={a} maxW={w} maxH={h} />
        ) : (
          <Missing w={w} h={h} />
        )}
        {comparing && runB ? (
          b ? (
            <ZonePanel runId={runB} zone={b} maxW={w} maxH={h} />
          ) : (
            <Missing w={w} h={h} />
          )
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5">
        {a ? <StatLine zone={a} tag={comparing ? "A" : undefined} /> : null}
        {comparing ? (
          b ? (
            <StatLine zone={b} tag="B" />
          ) : (
            <div className="font-mono text-[11px] text-muted-foreground">
              B — zone not in run
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}

function Missing(props: { w: number; h: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center font-mono text-[11px] text-muted-foreground"
      style={{ width: props.w, height: props.h, background: "var(--secondary)" }}
    >
      not in run
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run scrubber: newest first, label + optionsHash chips. Click = active (A);
// the "B" corner sets/clears the comparison run.
// ---------------------------------------------------------------------------

function RunChip(props: {
  entry: RunIndexEntry;
  isA: boolean;
  isB: boolean;
  onPickA: () => void;
  onToggleB: () => void;
}) {
  const { entry, isA, isB, onPickA, onToggleB } = props;
  const meta = entry.meta;
  const label = meta?.label ?? entry.id.slice(0, 15);
  const time = meta
    ? new Date(meta.generatedUtc).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  return (
    <div
      className="flex shrink-0 items-stretch overflow-hidden border"
      style={{
        borderColor: isA || isB ? "var(--st-meta)" : "var(--line-2)",
        borderRadius: 2,
        background: isA ? "var(--secondary)" : "transparent",
      }}
    >
      <button
        type="button"
        onClick={onPickA}
        className="flex flex-col items-start px-2 py-1 text-left"
        title={entry.id}
      >
        <span className="font-mono text-xs leading-4">
          {isA ? <b>A · </b> : null}
          {label}
        </span>
        <span className="font-mono text-[10px] leading-3 text-muted-foreground">
          {meta?.optionsHash.slice(0, 8) ?? "?"} · {time}
        </span>
      </button>
      <button
        type="button"
        onClick={onToggleB}
        disabled={isA}
        className="border-l px-1.5 font-mono text-[10px]"
        style={{
          borderColor: "var(--line-2)",
          background: isB ? "var(--secondary)" : "transparent",
          color: isA ? "var(--line-2)" : isB ? "var(--foreground)" : "var(--st-meta)",
        }}
        title={isB ? "clear comparison" : "compare as B"}
      >
        {isB ? "B✕" : "B"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The sheet.
// ---------------------------------------------------------------------------

export default function Sheet() {
  const [runs, setRuns] = useState<RunIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runA, setRunA] = useState<string | null>(null);
  const [runB, setRunB] = useState<string | null>(null);
  const [reportA, setReportA] = useState<RunReport | null>(null);
  const [reportB, setReportB] = useState<RunReport | null>(null);

  useEffect(() => {
    fetchRunIndex()
      .then((index) => {
        setRuns(index);
        setRunA((prev) => prev ?? index[0]?.id ?? null);
      })
      .catch((err: unknown) => setError(String(err)));
  }, []);

  useEffect(() => {
    if (!runA) return;
    let live = true;
    setReportA(null);
    loadRunReport(runA)
      .then((r) => live && setReportA(r))
      .catch((err: unknown) => live && setError(String(err)));
    return () => {
      live = false;
    };
  }, [runA]);

  useEffect(() => {
    if (!runB) {
      setReportB(null);
      return;
    }
    let live = true;
    setReportB(null);
    loadRunReport(runB)
      .then((r) => live && setReportB(r))
      .catch(() => live && setReportB(null));
    return () => {
      live = false;
    };
  }, [runB]);

  // Levels as sections, report order preserved; zones matched across runs by name.
  // gap: world.ts offers no stable cross-run zone identity — Zone name ("Main Level#03") is
  // positional by construction, so an A/B pair can silently compare different geography when
  // zoning itself changed between runs. A persisted zone key (bbox hash?) belongs in report.json.
  const levels = useMemo(() => {
    if (!reportA) return [];
    const order: string[] = [];
    const byLevel = new Map<string, ZoneRecord[]>();
    for (const zone of reportA.Zones) {
      if (!byLevel.has(zone.Level)) {
        byLevel.set(zone.Level, []);
        order.push(zone.Level);
      }
      byLevel.get(zone.Level)!.push(zone);
    }
    // B-only zones still deserve a card — append them to their level's tail.
    if (reportB) {
      for (const zone of reportB.Zones) {
        const list = byLevel.get(zone.Level);
        if (!list) {
          byLevel.set(zone.Level, []);
          order.push(zone.Level);
        }
        if (!reportA.Zones.some((z) => z.Zone === zone.Zone)) {
          byLevel.get(zone.Level)!.push(zone);
        }
      }
    }
    return order.map((level) => ({ level, zones: byLevel.get(level)! }));
  }, [reportA, reportB]);

  const bZones = useMemo(() => {
    const map = new Map<string, ZoneRecord>();
    for (const zone of reportB?.Zones ?? []) map.set(zone.Zone, zone);
    return map;
  }, [reportB]);
  const aZones = useMemo(() => {
    const map = new Map<string, ZoneRecord>();
    for (const zone of reportA?.Zones ?? []) map.set(zone.Zone, zone);
    return map;
  }, [reportA]);

  const board = reportA ? boardSummary(reportA) : null;
  const boardB = reportB ? boardSummary(reportB) : null;
  const comparing = runB !== null && reportB !== null;

  if (error) {
    return (
      <div className="p-8 font-mono text-sm" style={{ color: "var(--st-warn)" }}>
        run pool unavailable: {error}
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-10 flex flex-col gap-2 border-b bg-background px-4 py-2"
        style={{ borderColor: "var(--line-2)" }}
      >
        <div className="flex items-baseline gap-3">
          <h1 className="font-mono text-sm font-semibold">runs / sheet</h1>
          {board ? (
            <span className="font-mono text-xs text-muted-foreground">
              A: {board.solved}/{board.zones} solved · {board.acceptedRooms} rooms ·{" "}
              {Math.round(board.acceptedSqft).toLocaleString()} sf accepted ·{" "}
              {Math.round(board.heldSqft).toLocaleString()} sf held
            </span>
          ) : null}
          {boardB ? (
            <span className="font-mono text-xs text-muted-foreground">
              B: {boardB.solved}/{boardB.zones} ·{" "}
              {Math.round(boardB.acceptedSqft).toLocaleString()} sf
            </span>
          ) : null}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {runs === null ? (
            <span className="font-mono text-xs text-muted-foreground">loading pool…</span>
          ) : (
            runs.map((entry) => (
              <RunChip
                key={entry.id}
                entry={entry}
                isA={entry.id === runA}
                isB={entry.id === runB}
                onPickA={() => {
                  if (entry.id === runB) setRunB(null);
                  setRunA(entry.id);
                }}
                onToggleB={() => setRunB((prev) => (prev === entry.id ? null : entry.id))}
              />
            ))
          )}
        </div>
      </header>

      {reportA === null ? (
        <div className="p-8 font-mono text-sm text-muted-foreground">loading run…</div>
      ) : (
        <main className="flex flex-col gap-6 p-4">
          {levels.map(({ level, zones }) => {
            const solved = zones.filter(
              (z) => aZones.get(z.Zone)?.triage.verdict === "solve",
            ).length;
            const sf = zones.reduce(
              (sum, z) => sum + (aZones.get(z.Zone)?.AcceptedSqft ?? 0),
              0,
            );
            return (
              <section key={level}>
                <div className="mb-2 flex items-baseline gap-3">
                  <h2 className="font-mono text-xs font-semibold uppercase tracking-wide">
                    {level}
                  </h2>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {solved}/{zones.length} solved · {Math.round(sf).toLocaleString()} sf
                  </span>
                </div>
                <div
                  className="grid gap-2"
                  style={{
                    gridTemplateColumns: `repeat(auto-fill, minmax(${
                      comparing ? PANEL_W_AB * 2 + 40 : PANEL_W + 20
                    }px, 1fr))`,
                  }}
                >
                  {zones.map((zone) => (
                    <ZoneCard
                      key={zone.Zone}
                      name={zone.Zone}
                      a={aZones.get(zone.Zone) ?? null}
                      b={comparing ? bZones.get(zone.Zone) ?? null : null}
                      runA={runA!}
                      runB={comparing ? runB : null}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </main>
      )}
    </div>
  );
}
