/**
 * S1, `page.view` `plan`: one level from above. The level is `page.level`, else the level holding
 * most of the subject's segments. The ground is a 10/50/100 ft grid, not Revit's plan image: the
 * image export (`revit.context.view-image`) is keyed on a plan view, and `ducts.snapshot` names
 * levels, not views, so an image would need a second read and a view pick (owed, not guessed).
 */
import { useMemo } from "react";

import { FactChip } from "#/components/lang/chip";
import type { Bounds2 } from "#/lib/affine-frame";
import { token } from "#/lib/token";
import type { DuctsPage } from "./manifest";
import { sceneOf, type DuctIndex, type SpatialView } from "./scene";

/** Model XY to drawing feet, north up. */
const top = (point: readonly number[]) => [point[0]!, -point[1]!] as const;

function Grid({ box }: { box: Bounds2 }) {
  const width = box.maxX - box.minX;
  const step = width < 400 ? 10 : width < 2000 ? 50 : 100;
  const lines = [];
  for (let x = Math.ceil(box.minX / step) * step; x <= box.maxX; x += step)
    lines.push(
      <line
        key={`x${x}`}
        x1={x}
        x2={x}
        y1={box.minY}
        y2={box.maxY}
        vectorEffect="non-scaling-stroke"
      />,
    );
  for (let y = Math.ceil(box.minY / step) * step; y <= box.maxY; y += step)
    lines.push(
      <line
        key={`y${y}`}
        y1={y}
        y2={y}
        x1={box.minX}
        x2={box.maxX}
        vectorEffect="non-scaling-stroke"
      />,
    );
  return (
    <g
      data-grid={step}
      stroke={token("line")}
      strokeWidth={1}
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    >
      {lines}
    </g>
  );
}
const underlay = (box: Bounds2) => <Grid box={box} />;

export function usePlan(index: DuctIndex, page: Pick<DuctsPage, "group" | "level">): SpatialView {
  return useMemo(() => {
    const own = index.segmentsOf.get(page.group) ?? [];
    const pool = own.length ? own : index.snapshot.segments;
    const tally = new Map<number, number>();
    for (const segment of pool)
      if (segment.levelId != null)
        tally.set(segment.levelId, (tally.get(segment.levelId) ?? 0) + 1);
    const busiest = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const levelId = page.level ? Number(page.level) : busiest;
    const level = index.levels.find((item) => item.id === levelId) ?? null;
    const context = index.snapshot.segments.filter(
      (segment) => segment.levelId === levelId && segment.groupId !== page.group,
    );
    const scene = sceneOf(index, page.group, (id) => id === levelId, [context]);
    const elsewhere = own.length - scene.segments.length;
    return {
      label: "plan",
      project: top,
      scene,
      fitKey: `plan|${page.group}|${levelId}`,
      underlay,
      band: (
        <>
          <FactChip title="the level drawn; choose another in the sentence">
            {level?.name ?? "no level"}
            {page.level ? "" : " (busiest)"}
          </FactChip>
          {elsewhere > 0 ? (
            <FactChip title="the subject's segments on other levels; the isometric draws every level">
              +{elsewhere} on other levels
            </FactChip>
          ) : null}
          <FactChip
            dashed
            title="ducts.snapshot names levels, not plan views; Revit's plan image is keyed on a view, so it needs a second read (owed)"
          >
            grid, no plan image
          </FactChip>
        </>
      ),
    };
  }, [index, page.group, page.level]);
}
