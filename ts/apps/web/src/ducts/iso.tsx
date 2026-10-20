/**
 * S2, `page.view` `iso`: every level in one orthographic projection, looked at from 30° above the
 * horizon. Yaw turns in 90° steps from the band, or freely by dragging (shift-drag pans). The
 * projection pivots on the subject's centre, so turning never throws it off screen. Vertical is
 * true scale unless the band says otherwise; a riser is a vertical line of its own length.
 * The camera is always the globe (`proto/orbit/camera`): free yaw and elevation, a selection pivot.
 * `page.camera` is a preset of it, `iso` (default) or `plan`; see `cameraOf`.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { FactChip } from "@pe/kit/lang/chip";
import { Button } from "@pe/kit/lang/button";
import type { Scene } from "./drawing";
import type { Segment } from "./encoding";
import type { DuctsPage } from "./manifest";
import { cameraOf, type CameraPreset } from "./picture";
import { contextOf, sceneOf, type DuctIndex, type SpatialView } from "./scene";
import { useOrbit } from "./proto/orbit/camera";

const ELEVATION = Math.PI / 6;
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

const centre = (segments: readonly Pick<Segment, "polyline">[]) => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const segment of segments)
    for (const point of segment.polyline)
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i]!, point[i]!);
        hi[i] = Math.max(hi[i]!, point[i]!);
      }
  return lo.map((v, i) => (Number.isFinite(v) ? (v + hi[i]!) / 2 : 0));
};

/** The plan grid the ducts run on, in degrees mod 90: the length-weighted mean of 4θ. */
export const gridAngle = (segments: readonly Pick<Segment, "polyline">[]) => {
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

/** `subject` is the subject scene when `page.scene` names it; the pivot and grid come from its segments. */
export function useIso(
  index: DuctIndex,
  page: Pick<DuctsPage, "group">,
  subject: Scene | null = null,
): SpatialView {
  // Turns are offsets from the group's own grid set on the diagonal, so its ducts never run
  // straight into the screen (where depth would read as a riser).
  const [turned, setTurned] = useState(0);
  const [stretch, setStretch] = useState<number>(Z_STRETCH[0]);
  const preset = cameraOf(page);

  const scene = useMemo(
    () => subject ?? sceneOf(index, page.group, () => true),
    [index, page.group, subject],
  );
  const { pivot, grid } = useMemo(() => {
    const own = subject
      ? subject.segments.map((facts) => facts.segment)
      : index.segmentsOf.get(page.group);
    const pool = own?.length
      ? own
      : contextOf(index, page.group).flatMap((level) => level.polylines);
    return { pivot: centre(pool), grid: gridAngle(pool) };
  }, [index, page.group, subject]);
  const yaw = 45 - grid + turned;
  // Free elevation, a selection pivot and the globe; `project` carries it to the drawing.
  const cam = useOrbit({
    index,
    group: page.group,
    scene,
    grid,
    basePivot: pivot,
    stretch,
    turned,
    setTurned,
  });

  // A preset glides the one camera: plan is straight down with north up, iso the grid diagonal at
  // 30 degrees. The camera starts at iso, so only a plan (a deep link too) moves on mount.
  const arrived = useRef<CameraPreset>("iso");
  useEffect(() => {
    if (arrived.current === preset) return;
    arrived.current = preset;
    if (preset === "plan") cam.goTo(0, 90);
    else cam.goTo(45 - grid, 30);
    // `cam` is rebuilt each render; the preset is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);
  // A step lands on the next diagonal of the group's grid, the classic iso corner.
  const turn = (by: number) => setTurned((t) => Math.round(t / 90) * 90 + by);
  return {
    label: preset === "plan" ? "plan" : "isometric",
    project: cam.project,
    scene,
    // Refit on a new subject or a vertical change; a turn keeps the zoom (the pivot holds it).
    fitKey: `iso|${subject ? "subject" : page.group}|${stretch}|${preset}`,
    onDrag: (dx, dy, shift) => {
      if (shift) return false;
      cam.drag(dx, dy);
      return true;
    },
    band: (
      <>
        <Button type="button" kind="framed" label="turn 90° left" onClick={() => turn(-90)}>
          ⟲ 90°
        </Button>
        <Button type="button" kind="framed" label="turn 90° right" onClick={() => turn(90)}>
          90° ⟳
        </Button>
        <FactChip title="yaw from north; drag across to turn, up and down to tilt (snaps at 90, 30, 0), shift-drag to pan, wheel to zoom, F to frame the selection, double-click to select and frame">
          yaw <span className="face-mono">{(((yaw % 360) + 360) % 360).toFixed(0)}°</span> ·{" "}
          <span className="face-mono">{cam.elev.toFixed(0)}°</span> above
        </FactChip>
        <Button
          type="button"
          kind="framed"
          pressed={stretch === Z_STRETCH[1]}
          label="stretch vertical ×3 so drops and risers read; lengths along z are then not to scale"
          onClick={() => setStretch((s) => (s === Z_STRETCH[0] ? Z_STRETCH[1] : Z_STRETCH[0]))}
        >
          vertical ×{stretch}
        </Button>
      </>
    ),
  };
}
