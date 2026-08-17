// light — the PLAN variant for /runs (find-the-product round 1).
//
// Thesis: the page is a level of the building drawn whole and spatially true — the /takeoffs
// atlas posture, but for run results. One level-wide ink raster per run+level painted ONCE to
// an offscreen canvas (bins are level-wide already; every zone crops from the same bitmap, so
// we draw it whole instead), rooms/residues/zone boundaries as SVG in true model position,
// pan/zoom by CSS transform. Run history is a filmstrip; ArrowUp/ArrowDown flip-book the plan
// between runs in place (viewport held fixed = cheap temporal diffing). Shift-click a second
// run for synchronized A/B panes.
//
// Color law (eval/rhvac/render-zone-promotion.py v2 + render forensics 2026-08-16): received
// ink solid near-black painted LAST so nothing hides it; invented closures (seals/close)
// screened red/tan, clearly synthetic; accepted rooms pale fills + crisp outlines UNDER ink;
// held residues (reason "rejected") dashed amber outlines; void/excluded quiet; zone boundary
// purple. Chrome uses role tokens; the plan canvas is a visual canvas with its own resting
// palette (COLOR-ROLES.md).
import {
  type CSSProperties,
  type Dispatch,
  type ReactElement,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  boardSummary,
  fetchRunIndex,
  loadRaster,
  loadRunReport,
  loadZoneGeometry,
  paintRaster,
  type Raster,
  ringPath,
  type RunIndexEntry,
  type RunReport,
  toPx,
  type ZoneGeometry,
  type ZoneRecord,
  type ZoneViewport,
} from "./world";

// ---- plan-canvas resting palette (deliberately NOT role tokens — this is a drawing) ----
const PAPER = "#faf9f6";
const INK_RGBA: [number, number, number, number] = [28, 25, 23, 255];
const SEALS_RGBA: [number, number, number, number] = [178, 58, 48, 205];
const CLOSE_RGBA: [number, number, number, number] = [187, 142, 82, 195];
const ROOM_FILL = "rgba(122, 148, 112, 0.16)";
const ROOM_STROKE = "rgba(84, 110, 76, 0.85)";
const QUIET_FILL = "rgba(120, 113, 108, 0.07)";
const HELD_STROKE = "#bd8a1f";
const ZONE_STROKE = "rgba(124, 92, 191, 0.8)";
const MIST = "rgba(100, 116, 139, 0.12)"; // focus-is-mist law even on the canvas
const LABEL = "rgba(120, 113, 108, 0.8)";

const PX_PER_FT = 4; // world px per model foot at scale=1 → exactly 1px per 0.25ft cell

type Frame = { minX: number; minY: number; maxX: number; maxY: number };
type View = { tx: number; ty: number; scale: number };

// gap: world.ts's zoneViewport is zone-shaped (takes a ZoneRecord and pads its bbox); a
// whole-level page needs a bounds-shaped viewport. Built here from the same ZoneViewport
// struct so toPx/ringPath/paintRaster still apply unchanged. Finding for the round: the
// registration primitive wants to be bounds-first with zoneViewport as a convenience on top.
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

// The level frame is seeded by the FIRST raster seen for a level and then held fixed, so run
// stepping flip-books in place instead of re-fitting. gap: a later run whose raster outgrows
// the seed frame still renders (overflow is visible) but the fitted view is framed to the
// seed — good enough while all runs share one model.
const frameCache = new Map<string, Frame>();
function levelFrame(level: string, ink: Raster): Frame {
  let f = frameCache.get(level);
  if (!f) {
    f = rasterFrame(ink);
    frameCache.set(level, f);
  }
  return f;
}

// One offscreen canvas per run+level, painted at native raster resolution (1 cell = 1 px) and
// never repainted on pan/zoom — Main Level is ~1600×1450 cells and repainting per frame is
// exactly the perf trap the brief warns about.
const levelCanvasCache = new Map<string, Promise<{ canvas: HTMLCanvasElement; ink: Raster }>>();
function loadLevelCanvas(runId: string, zone: ZoneRecord): Promise<{ canvas: HTMLCanvasElement; ink: Raster }> {
  const key = `${runId}/${zone.Ink}`;
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
      // Paint order is the law: invented closures under, received ink LAST so nothing hides it.
      if (close) paintRaster(ctx, close, vp, CLOSE_RGBA, true);
      if (seals) paintRaster(ctx, seals, vp, SEALS_RGBA, true);
      paintRaster(ctx, ink, vp, INK_RGBA);
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
        console.error("light: level data load failed", err);
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

function fmtTime(utc: string): string {
  const d = new Date(utc);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const fmtSqft = (v: number) => `${Math.round(v).toLocaleString()} ft²`;
const fmtPct = (v: number) => `${Math.round(v * 100)}%`;

// ---------------------------------------------------------------------------

export default function LightPlan() {
  const [runs, setRuns] = useState<RunIndexEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runA, setRunA] = useState<string | null>(null);
  const [runB, setRunB] = useState<string | null>(null);
  const [levels, setLevels] = useState<string[]>([]);
  const [level, setLevel] = useState<string | null>(null);
  const [view, setView] = useState<View>({ tx: 0, ty: 0, scale: 1 });
  const [hoverZone, setHoverZone] = useState<string | null>(null);
  const [pinnedZone, setPinnedZone] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Map<string, ReturnType<typeof boardSummary>>>(new Map());
  const mainRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetchRunIndex()
      .then((index) => {
        setRuns(index);
        setRunA((cur) => cur ?? index[0]?.id ?? null);
      })
      .catch((err: unknown) => setLoadError(String(err)));
  }, []);

  // Board summaries for the filmstrip (5 runs — eager is fine).
  useEffect(() => {
    for (const r of runs) {
      void loadRunReport(r.id).then((rep) =>
        setSummaries((m) => (m.has(r.id) ? m : new Map(m).set(r.id, boardSummary(rep)))),
      );
    }
  }, [runs]);

  // Level list from run A's report; default to Main Level.
  useEffect(() => {
    if (!runA) return;
    let stale = false;
    void loadRunReport(runA).then((rep) => {
      if (stale) return;
      const order = levelOrder(rep);
      setLevels(order);
      setLevel((cur) => (cur && order.includes(cur) ? cur : (order.find((l) => l.includes("Main")) ?? order[0] ?? null)));
    });
    return () => {
      stale = true;
    };
  }, [runA]);

  const dataA = useLevelData(runA, level);
  const dataB = useLevelData(runB, level);
  const compare = runB !== null;

  const frame = useMemo(() => {
    if (!level) return null;
    if (dataA?.ink) return levelFrame(level, dataA.ink);
    return frameCache.get(level) ?? null;
  }, [level, dataA]);

  // Fit on level change / compare toggle — NOT on run step (flip-book holds the viewport).
  useEffect(() => {
    if (!frame) return;
    const el = mainRef.current;
    if (!el) return;
    const vp = levelViewport(frame);
    const paneW = compare ? el.clientWidth / 2 : el.clientWidth;
    const s = Math.min(paneW / vp.widthPx, el.clientHeight / vp.heightPx) * 0.94;
    setView({ scale: s, tx: (paneW - vp.widthPx * s) / 2, ty: (el.clientHeight - vp.heightPx * s) / 2 });
  }, [frame, compare]);

  // Run scrubbing. gap: the brief asked for ArrowLeft/Right, but the shared VariantSwitcher
  // binds those globally to switch variants — so the filmstrip scrubs on ArrowUp (newer) /
  // ArrowDown (older) instead. A finding for the round: the harness eats the best keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /input|textarea|select/i.test(t.tagName)) return;
      if (e.key === "Escape") {
        setPinnedZone(null);
        return;
      }
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      setRunA((current) => {
        if (runs.length === 0) return current;
        const idx = Math.max(0, runs.findIndex((r) => r.id === current));
        const next = e.key === "ArrowUp" ? Math.max(0, idx - 1) : Math.min(runs.length - 1, idx + 1);
        return runs[next]?.id ?? current;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runs]);

  // Level switch invalidates the peek target; run steps keep it (names are stable enough).
  useEffect(() => {
    setPinnedZone(null);
    setHoverZone(null);
  }, [level]);

  // Stable handlers: the panes' over-layer memo depends on these, and the parent re-renders
  // on every pan/zoom tick — inline lambdas would bust that memo every frame.
  const onPick = useCallback((z: string) => setPinnedZone((cur) => (cur === z ? null : z)), []);

  const peekZone = hoverZone ?? pinnedZone;
  const zoneA = peekZone ? (dataA?.zones.find((z) => z.Zone === peekZone) ?? null) : null;
  const zoneB = peekZone ? (dataB?.zones.find((z) => z.Zone === peekZone) ?? null) : null;
  const metaA = runs.find((r) => r.id === runA)?.meta ?? null;
  const summaryA = runA ? summaries.get(runA) : undefined;

  if (loadError) return <div className="p-8 font-mono text-sm text-destructive">run pool failed: {loadError}</div>;
  if (runs.length === 0) return <div className="p-8 text-sm text-muted-foreground">loading run pool…</div>;

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* ---- chrome: header (role tokens, not canvas palette) ---- */}
      <div className="flex items-center gap-3 border-b px-3 py-1.5 text-xs">
        <span className="font-mono text-muted-foreground">/runs · light — the plan</span>
        <div className="flex gap-0.5">
          {levels.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLevel(l)}
              className={`rounded-sm px-2 py-0.5 ${l === level ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              {l.replace(" Level", "")}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 font-mono text-muted-foreground">
          {metaA && (
            <span className="text-foreground">
              {metaA.label ?? metaA.optionsHash} · {fmtTime(metaA.generatedUtc)}
            </span>
          )}
          {summaryA && (
            <span>
              {summaryA.solved}/{summaryA.zones} zones solve · {fmtSqft(summaryA.acceptedSqft)} accepted
            </span>
          )}
          <span className="text-[10px]">shift-click run = A/B · ↑↓ scrub runs · esc unpin</span>
        </div>
      </div>

      {/* ---- filmstrip: newest first, ↑↓ scrubs, shift-click sets B ---- */}
      <div className="flex items-stretch gap-1 overflow-x-auto border-b px-2 py-1">
        {runs.map((r) => {
          const s = summaries.get(r.id);
          const isA = r.id === runA;
          const isB = r.id === runB;
          return (
            <button
              key={r.id}
              type="button"
              title={r.id}
              onClick={(e) => {
                if (e.shiftKey) setRunB((cur) => (cur === r.id ? null : r.id));
                else setRunA(r.id);
              }}
              className={`shrink-0 rounded-sm border px-2 py-0.5 text-left font-mono text-[11px] leading-tight ${
                isA
                  ? "border-transparent bg-secondary text-secondary-foreground"
                  : "border-transparent text-muted-foreground hover:bg-muted"
              } ${isB ? "border-[var(--st-warn,#b8860b)]" : ""}`}
            >
              <span className="block">
                {isB && <span className="mr-1 font-bold">B</span>}
                {r.meta?.label ?? r.meta?.optionsHash ?? r.id.slice(-12)}
              </span>
              <span className="block text-[10px] opacity-70">
                {r.meta ? fmtTime(r.meta.generatedUtc) : "—"}
                {s ? ` · ${s.solved}/${s.zones} solve` : ""}
              </span>
            </button>
          );
        })}
        {compare && (
          <button
            type="button"
            onClick={() => setRunB(null)}
            className="shrink-0 self-center rounded-sm px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted"
          >
            × exit A/B
          </button>
        )}
      </div>

      {/* ---- the plan(s) ---- */}
      <div ref={mainRef} className="relative flex min-h-0 flex-1">
        {frame && level && runA ? (
          <>
            <PlanPane
              runId={runA}
              tag={compare ? `A · ${metaA?.label ?? metaA?.optionsHash ?? runA}` : null}
              data={dataA}
              frame={frame}
              view={view}
              setView={setView}
              hoverZone={hoverZone}
              pinnedZone={pinnedZone}
              onHover={setHoverZone}
              onPick={onPick}
            />
            {compare && (
              <div className="flex flex-1 border-l">
                <PlanPane
                  runId={runB ?? ""}
                  tag={`B · ${runs.find((r) => r.id === runB)?.meta?.label ?? runB ?? ""}`}
                  data={dataB}
                  frame={frame}
                  view={view}
                  setView={setView}
                  hoverZone={hoverZone}
                  pinnedZone={pinnedZone}
                  onHover={setHoverZone}
                  onPick={onPick}
                />
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            loading {level ?? "level"}…
          </div>
        )}

        <Legend />

        {peekZone && zoneA && (
          <ZonePeekCard zoneName={peekZone} a={zoneA} b={zoneB} compare={compare} pinned={pinnedZone === peekZone} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PlanPane(props: {
  runId: string;
  tag: string | null;
  data: LevelData | null;
  frame: Frame;
  view: View;
  setView: Dispatch<SetStateAction<View>>;
  hoverZone: string | null;
  pinnedZone: string | null;
  onHover: (zone: string | null) => void;
  onPick: (zone: string) => void;
}) {
  const { data, frame, view, setView } = props;
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

  // Rooms + quiet residues, UNDER the ink canvas. Memoized — pan/zoom only touches the
  // transform and the --sw stroke variable, not this tree.
  const underLayer = useMemo(() => {
    if (!data) return null;
    const nodes: ReactElement[] = [];
    for (const zone of data.zones) {
      const geom = data.geom.get(zone.Zone);
      if (!geom) continue;
      for (const res of geom.residues) {
        if (res.reason === "rejected") continue; // held → over layer
        nodes.push(
          <path
            key={`q:${zone.Zone}/${res.id}`}
            d={ringPath(vp, res.loops)}
            fillRule="evenodd"
            fill={QUIET_FILL}
            stroke="none"
          />,
        );
      }
      for (const [roomId, rings] of geom.polys) {
        nodes.push(
          <path
            key={`r:${zone.Zone}/${roomId}`}
            d={ringPath(vp, rings.map((ring) => ring.points))}
            fillRule="evenodd"
            fill={ROOM_FILL}
            stroke={ROOM_STROKE}
            style={{ strokeWidth: "calc(var(--sw) * 1px)" }}
          />,
        );
      }
    }
    return nodes;
  }, [data, vp]);

  // Held residues + zone boundaries + hover/hit + labels, ABOVE the ink canvas.
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
            style={{ strokeWidth: `calc(var(--sw) * ${lit ? 2 : 1.2}px)`, cursor: "pointer" }}
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
    // held above zone boundaries so amber stays readable inside lit zones
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
        <div className="absolute left-2 top-2 rounded-sm border bg-background/90 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
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

// Fallback hit/boundary shape for zones whose ZoneLoops came back empty.
function rectPath(vp: ZoneViewport, z: ZoneRecord): string {
  const [x0, y0] = toPx(vp, z.MinX, z.MaxY);
  const [x1, y1] = toPx(vp, z.MaxX, z.MinY);
  return `M${x0} ${y0} L${x1} ${y0} L${x1} ${y1} L${x0} ${y1} Z`;
}

// ---------------------------------------------------------------------------

function Legend() {
  const sw = (bg: string, extra?: CSSProperties) => (
    <span className="inline-block h-2.5 w-2.5 rounded-[1px] align-middle" style={{ background: bg, ...extra }} />
  );
  return (
    <div className="pointer-events-none absolute right-2 top-2 flex flex-col gap-0.5 rounded-sm border bg-background/90 px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
      <span>{sw("rgb(28,25,23)")} received ink</span>
      <span>{sw("rgba(178,58,48,0.8)")} sealed (invented)</span>
      <span>{sw("rgba(187,142,82,0.78)")} gap-closed (invented)</span>
      <span>{sw(ROOM_FILL, { border: `1px solid ${ROOM_STROKE}` })} accepted room</span>
      <span>{sw("transparent", { border: `1px dashed ${HELD_STROKE}` })} held residue</span>
      <span>{sw("transparent", { border: `1px solid ${ZONE_STROKE}` })} zone (dashed = hold)</span>
    </div>
  );
}

function ZonePeekCard(props: {
  zoneName: string;
  a: ZoneRecord;
  b: ZoneRecord | null | undefined;
  compare: boolean;
  pinned: boolean;
}) {
  const { a, b, compare } = props;
  const topRejections = (z: ZoneRecord) =>
    Object.entries(z.Rejections)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3);
  const cell = (z: ZoneRecord | null | undefined, f: (z: ZoneRecord) => string) => (z ? f(z) : "—");
  const rows: [string, (z: ZoneRecord) => string][] = [
    ["verdict", (z) => `${z.triage.verdict} (${z.triage.reason})`],
    ["accepted", (z) => `${z.AcceptedRooms}/${z.OracleRooms} rooms · ${fmtSqft(z.AcceptedSqft)}`],
    ["held", (z) => `${z.HeldRooms} rooms · ${fmtSqft(z.HeldSqft)}`],
    ["ink-backed edge", (z) => fmtPct(z.InkBackedEdgeFraction)],
    ["ink ratio", (z) => z.census.inkRatio.toFixed(2)],
  ];
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 w-[24rem] rounded-sm border bg-background/95 p-2 font-mono text-[11px] shadow-sm">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-foreground">{props.zoneName}</span>
        {props.pinned && <span className="text-[10px] text-muted-foreground">pinned · esc</span>}
        {compare && <span className="ml-auto text-[10px] text-muted-foreground">A / B</span>}
      </div>
      <table className="w-full">
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label}>
              <td className="pr-2 text-muted-foreground">{label}</td>
              <td className="text-foreground">{f(a)}</td>
              {compare && <td className="pl-2 text-foreground">{cell(b, f)}</td>}
            </tr>
          ))}
          <tr>
            <td className="pr-2 align-top text-muted-foreground">rejections</td>
            <td className="text-foreground">
              {topRejections(a).map(([k, n]) => (
                <span key={k} className="block">
                  {k} ×{n}
                </span>
              ))}
              {Object.keys(a.Rejections).length === 0 && "none"}
            </td>
            {compare && (
              <td className="pl-2 align-top text-foreground">
                {b
                  ? topRejections(b).map(([k, n]) => (
                      <span key={k} className="block">
                        {k} ×{n}
                      </span>
                    ))
                  : "—"}
              </td>
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
