import { useEffect, useState } from "react";
import { CLOSE_M, INK_M, SEAL_DOOR, SEAL_RUN } from "./palette";
import {
  loadPlan,
  loadReplaySeedInk,
  loadRaster,
  loadRunReport,
  loadSealClasses,
  loadZoneGeometry,
  paintClassRaster,
  paintRaster,
  type Raster,
  type RegisteredPlan,
  type RunReport,
  toPx,
  type ZoneGeometry,
  type ZoneRecord,
  type ZoneViewport,
} from "./world";
import { PX_PER_FT } from "./browser-unknown-title";

export type Frame = { minX: number; minY: number; maxX: number; maxY: number };

export type View = { tx: number; ty: number; scale: number };

// gap (SHIMS.md #7): world.ts's zoneViewport is zone-shaped; a whole-level page needs a
export function levelViewport(f: Frame): ZoneViewport {
  return {
    ...f,
    pxPerFt: PX_PER_FT,
    widthPx: Math.ceil((f.maxX - f.minX) * PX_PER_FT),
    heightPx: Math.ceil((f.maxY - f.minY) * PX_PER_FT),
  };
}

export function rasterFrame(r: Raster): Frame {
  return {
    minX: r.minX,
    minY: r.minY,
    maxX: r.minX + r.w * r.cellFt,
    maxY: r.minY + r.h * r.cellFt,
  };
}

export const frameCache = new Map<string, Frame>();

export function levelFrame(level: string, source: Frame): Frame {
  let f = frameCache.get(level);
  if (!f) {
    f = source;
    frameCache.set(level, f);
  }
  return f;
}

export const levelCanvasCache = new Map<
  string,
  Promise<{ canvas: HTMLCanvasElement; ink: Raster }>
>();

export function loadLevelCanvas(
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

export type LevelData = {
  report: RunReport;
  zones: ZoneRecord[];
  plan: RegisteredPlan | null;
  ink: Raster | null;
  canvas: HTMLCanvasElement | null;
  geom: Map<string, ZoneGeometry>;
};

export function useLevelData(runId: string | null, level: string | null): LevelData | null {
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

export function rectPath(vp: ZoneViewport, z: ZoneRecord): string {
  const [x0, y0] = toPx(vp, z.MinX, z.MaxY);
  const [x1, y1] = toPx(vp, z.MaxX, z.MinY);
  return `M${x0} ${y0} L${x1} ${y0} L${x1} ${y1} L${x0} ${y1} Z`;
}
