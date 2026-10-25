import { token } from "@pe/kit/lib/token";
import { LOOK } from "./grounds";
import type { Project } from "./projection";
import type { SceneMeshes } from "./types";

/** A caption names its nearest retained continuation end, rather than a busy junction centre. */
export function continuationAnchor(
  meshes: SceneMeshes,
  ids: readonly number[],
  at: readonly number[],
) {
  return (
    ids
      .flatMap((id) => meshes.cuts.get(id) ?? [])
      .sort(
        (a, b) =>
          Math.hypot(...a.at.map((n, i) => n - at[i]!)) -
          Math.hypot(...b.at.map((n, i) => n - at[i]!)),
      )[0]?.at ?? at
  );
}

/** Paired cross ticks mean the captured branch continues beyond this developed-length cut. */
export function ContinuationMarks({ meshes, project }: { meshes: SceneMeshes; project: Project }) {
  const mark = LOOK.read().captions.markPx;
  return (
    <g aria-label="continuation ends">
      <g fill="none" stroke={token("ink-2")}>
        {[...meshes.cuts].flatMap(([id, cuts]) =>
          cuts.map((cut, index) => {
            const at = project(cut.at),
              from = project(cut.from);
            if (!at || !from) return null;
            const yaw = (Math.atan2(at[1] - from[1], at[0] - from[0]) * 180) / Math.PI;
            return (
              <path
                key={`${id}:${index}`}
                data-continuation-end={id}
                transform={`translate(${at[0]} ${at[1]}) rotate(${yaw})`}
                d={`M${-mark / 3} ${-mark}L${mark / 3} ${mark}M${mark / 3} ${-mark}L${mark} ${mark}`}
              />
            );
          }),
        )}
      </g>
    </g>
  );
}
