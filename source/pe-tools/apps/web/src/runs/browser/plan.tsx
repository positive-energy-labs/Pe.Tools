import { dash, token } from "#/lib/token";
import {
  type CSSProperties,
  type Dispatch,
  type ReactElement,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  candidateTone,
  LABEL,
  LABEL_SIZE,
  PLAN_LAW,
  RESIDUE_TREATMENT,
  ZONE_STROKE,
  ZONE_WIDTH,
} from "../palette";
import { paintPlan, ringPath, toPx } from "../world";
import type { Frame, LevelData, View } from "./frame";
import {
  HatchPattern,
  PX_PER_FT,
  UNKNOWN_TITLE,
  heldPatternId,
  residueKind,
  residuePatternId,
} from "./unknown";
import { levelViewport, rectPath } from "./frame";

export function PlanPane(props: {
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

  useEffect(() => {
    const el = canvasRef.current;
    const src = data?.canvas;
    if (!el || !src) return;
    el.width = src.width;
    el.height = src.height;
    el.getContext("2d")?.drawImage(src, 0, 0);
  }, [data]);

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
            strokeDasharray={dash("reference")}
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
          fillRule="evenodd"
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
          fillRule="evenodd"
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
          className="absolute left-2 top-2 px-1.5 py-0.5"
          style={{ borderRadius: "var(--radius)" }}
        >
          {props.tag}
        </div>
      )}
      {!data && (
        <div className="absolute inset-0 flex items-center justify-center">
          loading {props.runId}…
        </div>
      )}
      {data && !data.plan ? (
        <div className="absolute bottom-2 left-2 px-1.5 py-0.5">
          plan unavailable in this package
        </div>
      ) : null}
    </div>
  );
}
