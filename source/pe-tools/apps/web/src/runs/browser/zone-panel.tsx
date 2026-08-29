import { token } from "#/lib/token";
import { useEffect, useMemo, useRef, useState } from "react";
import { fb, useFb } from "../feedback/staging";
import {
  candidateTone,
  CLOSE_M,
  INK_M,
  LABEL,
  LABEL_SIZE,
  PLAN_LAW,
  RESIDUE_TREATMENT,
  SEAL_DOOR,
  SEAL_RUN,
  ZONE_STROKE,
  ZONE_WIDTH,
} from "../palette";
import {
  loadPlan,
  loadReplaySeedInk,
  loadRaster,
  loadSealClasses,
  loadZoneGeometry,
  paintPlan,
  paintClassRaster,
  paintRaster,
  type RegisteredPlan,
  ringPath,
  toPx,
  type ZoneGeometry,
  type ZoneRecord,
  type ZoneViewport,
  zoneViewport,
} from "../world";
import type { PanelHover } from "./unknown";
import {
  HatchPattern,
  UNKNOWN_TITLE,
  heldPatternId,
  residueKind,
  residuePatternId,
} from "./unknown";

export function ZonePanel(props: {
  runId: string;
  zone: ZoneRecord;
  maxW: number;
  maxH: number;
  underlay: boolean;
  fbKey?: string;
}) {
  const { runId, zone, maxW, maxH, underlay } = props;
  const { items, hoverFlag } = useFb();
  const stagedItem = props.fbKey ? (items.find((i) => i.key === props.fbKey) ?? null) : null;
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
      try {
        if (close) paintRaster(ctx, close, vp, CLOSE_M);
        if (sealClasses) {
          paintClassRaster(ctx, sealClasses, vp, new Set([2, 4]), SEAL_DOOR);
          paintClassRaster(ctx, sealClasses, vp, new Set([3]), SEAL_RUN);
        } else if (seals) paintRaster(ctx, seals, vp, SEAL_DOOR);
        if (ink) paintRaster(ctx, ink, vp, INK_M);
      } catch {}
    })();
    return () => {
      live = false;
    };
  }, [runId, zone, vp, geom, plan, underlay]);

  return (
    <div
      ref={hostRef}
      className="relative shrink-0 overflow-hidden"
      style={{
        width: maxW,
        height: maxH,
        backgroundColor: token("page"),
        borderRadius: "var(--radius)",
      }}
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
            const flagged = flags.has(`room:${room.id}`);
            const hot = lit(`room:${room.id}`);
            // Unflagged, the room wears its PERSISTED disposition (SHIMS.md #3): unknown is a
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
        <div className="absolute bottom-1 left-1 px-1">plan unavailable in this package</div>
      ) : null}

      {hover && (
        <div
          className="pointer-events-none absolute z-raised whitespace-nowrap px-1.5 py-0.5"
          style={{
            left: Math.min(hover.x + 10, maxW - 90),
            top: Math.min(hover.y + 12, maxH - 22),
            borderColor: hover.flagged ? token("alarm") : token("line-2"),
            color: hover.flagged ? token("alarm") : token("ink"),
            borderRadius: "var(--radius)",
          }}
        >
          {hover.flagged ? "⚑ " : ""}
          {hover.label}
        </div>
      )}
    </div>
  );
}
