/**
 * S2, `page.view` `iso`: every level in one orthographic projection, looked at from 30° above the
 * horizon. Yaw turns in 90° steps from the band, or freely by dragging (shift-drag pans). The
 * projection pivots on the subject's centre, so turning never throws it off screen. Vertical is
 * true scale unless the band says otherwise; a riser is a vertical line of its own length.
 */
import { useMemo, useRef, useState } from "react";

import { FactChip } from "#/components/lang/chip";
import { Press } from "#/components/lang/press";
import type { Segment } from "./encoding";
import type { DuctsPage } from "./manifest";
import { sceneOf, type DuctIndex, type SpatialView } from "./scene";

const ELEVATION = Math.PI / 6;
const DEG_PER_PX = 0.4;
const Z_STRETCH = [1, 3] as const;

/** The orthographic projection at `yaw` degrees about `pivot`, with vertical `stretch`. */
export const isoProject = (yaw: number, pivot: readonly number[], stretch: number) => {
  const a = (yaw * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const sinE = Math.sin(ELEVATION);
  const cosE = Math.cos(ELEVATION);
  return (point: readonly number[]) => {
    const x = point[0]! - pivot[0]!;
    const y = point[1]! - pivot[1]!;
    const z = (point[2]! - pivot[2]!) * stretch;
    const across = x * cos - y * sin;
    const depth = x * sin + y * cos;
    return [across, -(depth * sinE + z * cosE)] as const;
  };
};

const centre = (segments: readonly Segment[]) => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const segment of segments)
    for (const point of segment.polyline)
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i]!, point[i]!);
        hi[i] = Math.max(hi[i]!, point[i]!);
      }
  return lo.map((v, i) => (v + hi[i]!) / 2);
};

/** The plan grid the ducts run on, in degrees mod 90: the length-weighted mean of 4θ. */
export const gridAngle = (segments: readonly Segment[]) => {
  let c = 0;
  let s = 0;
  for (const { polyline } of segments) {
    const a = polyline[0]!;
    const b = polyline.at(-1)!;
    const dx = b[0]! - a[0]!;
    const dy = b[1]! - a[1]!;
    const run = Math.hypot(dx, dy);
    if (run < 1) continue;
    const t = 4 * Math.atan2(dy, dx);
    c += run * Math.cos(t);
    s += run * Math.sin(t);
  }
  return c === 0 && s === 0 ? 0 : (Math.atan2(s, c) * 180) / Math.PI / 4;
};

export function useIso(index: DuctIndex, page: Pick<DuctsPage, "group">): SpatialView {
  // Turns are offsets from the group's own grid set on the diagonal, so its ducts never run
  // straight into the screen (where depth would read as a riser).
  const [turned, setTurned] = useState(0);
  const drag = useRef({ dx: 0, frame: 0 });
  const [stretch, setStretch] = useState<number>(Z_STRETCH[0]);

  const scene = useMemo(() => {
    const byLevel = new Map<number | null, Segment[]>();
    for (const segment of index.snapshot.segments) {
      if (segment.groupId === page.group) continue;
      const key = segment.levelId ?? null;
      const list = byLevel.get(key);
      if (list) list.push(segment);
      else byLevel.set(key, [segment]);
    }
    return sceneOf(index, page.group, () => true, [...byLevel.values()]);
  }, [index, page.group]);
  const { pivot, grid } = useMemo(() => {
    const own = index.segmentsOf.get(page.group);
    const pool = own?.length ? own : index.snapshot.segments;
    return { pivot: centre(pool), grid: gridAngle(pool) };
  }, [index, page.group]);
  const yaw = 45 - grid + turned;
  const project = useMemo(() => isoProject(yaw, pivot, stretch), [yaw, pivot, stretch]);

  // A step lands on the next diagonal of the group's grid, the classic iso corner.
  const turn = (by: number) => setTurned((t) => Math.round(t / 90) * 90 + by);
  return {
    label: "isometric",
    project,
    scene,
    // Refit on a new subject or a vertical change; a turn keeps the zoom (the pivot holds it).
    fitKey: `iso|${page.group}|${stretch}`,
    onDrag: (dx, _dy, shift) => {
      if (shift) return false;
      // Coalesced to one turn per frame, however fast the pointer reports.
      drag.current.dx += dx;
      if (!drag.current.frame)
        drag.current.frame = requestAnimationFrame(() => {
          const by = drag.current.dx * DEG_PER_PX;
          drag.current = { dx: 0, frame: 0 };
          setTurned((t) => t + by);
        });
      return true;
    },
    band: (
      <>
        <Press
          type="button"
          frame="line"
          size="caption"
          title="turn 90° left"
          onClick={() => turn(-90)}
        >
          ⟲ 90°
        </Press>
        <Press
          type="button"
          frame="line"
          size="caption"
          title="turn 90° right"
          onClick={() => turn(90)}
        >
          90° ⟳
        </Press>
        <FactChip title="yaw from north; drag to turn, shift-drag to pan, wheel to zoom">
          yaw <span className="face-mono">{(((yaw % 360) + 360) % 360).toFixed(0)}°</span> · 30°
          above
        </FactChip>
        <Press
          type="button"
          frame="line"
          size="caption"
          state={stretch === Z_STRETCH[1] ? "selected" : "rest"}
          aria-pressed={stretch === Z_STRETCH[1]}
          title="stretch vertical ×3 so drops and risers read; lengths along z are then not to scale"
          onClick={() => setStretch((s) => (s === Z_STRETCH[0] ? Z_STRETCH[1] : Z_STRETCH[0]))}
        >
          vertical ×{stretch}
        </Press>
      </>
    ),
  };
}
