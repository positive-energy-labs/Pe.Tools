import { dash, token } from "#/lib/token";
import { useEffect, useMemo, useRef, useState } from "react";
import { fb, itemKey, useFb } from "../feedback/staging";
import { CLOSE_M, INK_M, PLAN_LAW, SEAL_DOOR, SEAL_RUN, ZONE_STROKE, ZONE_WIDTH } from "../palette";
import {
  comparisonPlan,
  paintPlan,
  paintClassRaster,
  paintRaster,
  type RegisteredPlan,
  ringPath,
  type ZoneGeometry,
  type ZoneRecord,
  type ZoneViewport,
  zoneViewport,
} from "../world";
import { useRunsSource } from "../source";
import { ReviewShapes, ReviewList, reviewShapes } from "../review";

export function ZonePanel(props: {
  runId: string;
  zone: ZoneRecord;
  maxW: number;
  maxH: number;
  underlay: boolean;
  registrationRunId?: string;
  registrationZone?: ZoneRecord;
  fbKey?: string;
  onStage?: () => void;
}) {
  const source = useRunsSource();
  const { runId, zone, maxW, maxH, underlay } = props;
  const { items } = useFb();
  const key = props.fbKey ?? itemKey(zone.Zone, null, runId);
  const stagedItem = items.find((item) => item.key === key);
  const flags = stagedItem?.flags ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const toggleFlag = (el: string) => {
    if (!stagedItem) props.onStage?.();
    fb.toggleFlag(key, el);
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
  const [geometryError, setGeometryError] = useState<string | null>(null);
  const [plan, setPlan] = useState<RegisteredPlan | null>();

  useEffect(() => {
    let live = true;
    setGeom(null);
    setGeometryError(null);
    source
      .loadZoneGeometry(runId, zone.Tsv)
      .then((g) => live && setGeom(g))
      .catch((err: unknown) => live && setGeometryError(String(err)));
    return () => {
      live = false;
    };
  }, [runId, zone.Tsv, source]);

  useEffect(() => {
    let live = true;
    setPlan(undefined);
    Promise.all([
      source.loadPlan(runId, zone.Ink, zone.plan),
      props.registrationRunId && props.registrationZone
        ? source.loadPlan(
            props.registrationRunId,
            props.registrationZone.Ink,
            props.registrationZone.plan,
          )
        : Promise.resolve(null),
    ])
      .then(([value, reference]) => live && setPlan(comparisonPlan(value, reference)))
      .catch(() => live && setPlan(null));
    return () => {
      live = false;
    };
  }, [runId, zone.Ink, zone.plan, props.registrationRunId, props.registrationZone, source]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !geom) return;
    let live = true;
    void (async () => {
      const [ink, seals, close, sealClasses] = underlay
        ? await Promise.all([
            zone.Ink ? source.loadReplaySeedInk(runId, zone.Ink).catch(() => null) : null,
            zone.Seals ? source.loadRaster(runId, zone.Seals).catch(() => null) : null,
            zone.Close ? source.loadRaster(runId, zone.Close).catch(() => null) : null,
            zone.Seals ? source.loadSealClasses(runId, zone.Seals).catch(() => null) : null,
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
  }, [runId, zone, vp, geom, plan, underlay, source]);

  const shapes = geom ? reviewShapes(geom, zone) : [];
  return (
    <div>
      <div
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
          {geometryError && (
            <span className="absolute inset-x-0 top-0" data-tone="alarm">
              Geometry unavailable: {geometryError}
            </span>
          )}
          <svg
            fillRule="evenodd"
            className="absolute inset-0"
            width={vp.widthPx}
            height={vp.heightPx}
            aria-label="room and residue review"
          >
            <ReviewShapes
              shapes={shapes}
              zone={zone.Zone}
              runId={runId}
              vp={vp}
              flags={flags}
              selected={selected}
              onSelect={setSelected}
            />
            <path
              d={ringPath(vp, zone.ZoneLoops as [number, number][][])}
              fill="none"
              stroke={ZONE_STROKE}
              strokeWidth={ZONE_WIDTH}
              strokeDasharray={dash("reference")}
            />
          </svg>
        </div>
        {plan === null ? (
          <div className="absolute bottom-1 left-1 px-1">plan unavailable in this package</div>
        ) : null}
      </div>
      <ReviewList
        shapes={shapes}
        selected={selected}
        flags={flags}
        onSelect={setSelected}
        onFlag={props.fbKey ? toggleFlag : undefined}
      />
    </div>
  );
}
