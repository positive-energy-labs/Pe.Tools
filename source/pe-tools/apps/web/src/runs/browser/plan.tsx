import { useHotkeys } from "@tanstack/react-hotkeys";

import { keyMeta } from "#/route/keys";
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
import { LABEL, LABEL_SIZE, PLAN_LAW, ZONE_STROKE, ZONE_WIDTH } from "../palette";
import { paintPlan, ringPath, toPx, type RegisteredPlan } from "../world";
import type { Frame, LevelData, View } from "./frame";
import { PX_PER_FT } from "./unknown";
import { ReviewShapes, ReviewList, reviewShapes } from "../review";
import { fb, itemKey, useFb } from "../feedback/staging";
import { levelViewport, rectPath } from "./frame";

export function PlanPane(props: {
  runId: string;
  tag: string | null;
  data: LevelData | null;
  plan: RegisteredPlan | null;
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
  const [selection, setSelection] = useState<{ zone: string; key: string } | null>(null);
  const { items } = useFb();
  const selectedZone = data?.zones.find((zone) => zone.Zone === selection?.zone);
  const selectedGeom = selectedZone && data?.geom.get(selectedZone.Zone);
  const selectedShapes =
    selectedZone && selectedGeom ? reviewShapes(selectedGeom, selectedZone) : [];
  const feedbackKey = selectedZone ? itemKey(selectedZone.Zone, null, props.runId) : null;
  const staged = items.find((item) => item.key === feedbackKey);
  const toggleFlag = (key: string) => {
    if (!selectedZone || !feedbackKey) return;
    if (!staged)
      fb.toggleStage({
        key: feedbackKey,
        zone: selectedZone.Zone,
        level: selectedZone.Level,
        runA: null,
        runB: props.runId,
        a: null,
        b: selectedZone,
      });
    fb.toggleFlag(feedbackKey, key);
  };
  const vp = useMemo(() => levelViewport(frame), [frame]);
  const hostRef = useRef<HTMLDivElement | null>(null);
  useHotkeys(
    [
      {
        hotkey: "Escape",
        callback: () => setSelection(null),
        options: {
          meta: keyMeta({
            name: "clear selection",
            description: "drop the selected element",
            tier: "widget",
            region: "plan",
          }),
        },
      },
    ],
    { target: hostRef },
  );
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
    if (!canvas || !data || !props.plan) return;
    canvas.width = vp.widthPx;
    canvas.height = vp.heightPx;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    paintPlan(
      ctx,
      props.plan,
      vp,
      data.zones.map((zone) => zone.ZoneLoops as [number, number][][]),
      PLAN_LAW.blackPoint,
      PLAN_LAW.whitePoint,
      PLAN_LAW.insideZoneOpacity,
      PLAN_LAW.outsideZoneOpacity,
    );
  }, [data, props.plan, vp]);

  useEffect(() => {
    const el = canvasRef.current;
    const src = data?.canvas;
    if (!el || !src) return;
    el.width = src.width;
    el.height = src.height;
    el.getContext("2d")?.drawImage(src, 0, 0);
  }, [data]);

  const overLayer = (() => {
    if (!data) return null;
    const zones: ReactElement[] = [];
    for (const zone of data.zones) {
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
              if (dragDist.current < 5) {
                setSelection({ zone: zone.Zone, key: "" });
                props.onPick(zone.Zone);
              }
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
    return (
      <>
        {zones}
        {data.zones.map((zone) => {
          const geom = data.geom.get(zone.Zone);
          const key = itemKey(zone.Zone, null, props.runId);
          return geom ? (
            <ReviewShapes
              key={zone.Zone}
              shapes={reviewShapes(geom, zone)}
              zone={zone.Zone}
              runId={props.runId}
              vp={vp}
              scale={view.scale}
              flags={items.find((item) => item.key === key)?.flags}
              selected={selection?.zone === zone.Zone ? selection.key : null}
              onSelect={(key) => setSelection({ zone: zone.Zone, key })}
            />
          ) : null;
        })}
      </>
    );
  })();

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
        if (dragDist.current >= 5) e.currentTarget.setPointerCapture(e.pointerId);
        setView((v) => ({ ...v, tx: d.tx + dx, ty: d.ty + dy }));
      }}
      onPointerUp={() => {
        drag.current = null;
        setDragging(false);
      }}
    >
      <div style={worldStyle}>
        {props.plan ? (
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
          aria-label="zones, rooms and residues"
        >
          {overLayer}
        </svg>
      </div>
      {selectedZone && (
        <div
          className="absolute bottom-2 right-2 max-w-[70%] p-2"
          data-surface="page"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div>
            {selectedZone.Zone} / {props.runId}
          </div>
          <ReviewList
            shapes={selectedShapes}
            selected={selection?.key ?? null}
            flags={staged?.flags ?? []}
            onSelect={(key) => setSelection({ zone: selectedZone.Zone, key })}
            onFlag={toggleFlag}
          />
        </div>
      )}
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
      {data && !props.plan ? (
        <div className="absolute bottom-2 left-2 px-1.5 py-0.5">
          plan unavailable in this package
        </div>
      ) : null}
    </div>
  );
}
