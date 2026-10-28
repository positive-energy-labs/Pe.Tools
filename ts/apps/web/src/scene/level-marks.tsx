import { ListPopup } from "@pe/kit/lang/list-popup";
import { token } from "@pe/kit/lib/token";
import { useMemo } from "react";
import { levelExtents, levelNames, type SceneLevels } from "./levels";
import type { Bounds } from "./types";
import type { Project, Size } from "./projection";

export function LevelMarks({
  levels,
  bounds,
  project,
  size,
}: {
  levels: SceneLevels;
  bounds: Bounds;
  project: Project;
  size: Size;
}) {
  const marks = levelExtents(levels, bounds)
    .flatMap(({ plane, index, corners, z }) => {
      const points = corners
        .map((c) => project(c))
        .filter((p) => p !== null)
        .filter((p) => p[0] >= 0 && p[0] <= size.width && p[1] >= 0 && p[1] <= size.height)
        .sort((a, b) => a[0] - b[0]);
      return points[0] ? [{ plane, index, at: points[0], z }] : [];
    })
    .sort((a, b) => a.at[1] - b.at[1]);
  let lastY = -Infinity;
  return (
    <g aria-label="model levels" className="t-small text-ink-2" fill={token("ink-2")}>
      {marks.map(({ plane, index, at, z }) => {
        // Close datums retain their tick; the inventory carries every name without collisions.
        const labelled = at[1] - lastY >= 24;
        if (labelled) lastY = at[1];
        return (
          <g key={index} data-level-plane={index} data-level-z={z}>
            <path d={`M${at[0] - 6} ${at[1]}h12`} stroke="currentColor" />
            {labelled && (
              <text x={at[0] + 9} y={at[1] - 4}>
                {levelNames(plane)} <tspan className="face-mono">{z.toFixed(2)} ft</tspan>
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** The full inventory is fixed at the picture root, including distant and stray datums. */
export function LevelReadout({
  levels,
  bounds,
  pending = false,
}: {
  levels: SceneLevels | null;
  bounds: Bounds | null;
  pending?: boolean;
}) {
  const rows = useMemo(
    () =>
      levels?.planes
        .flatMap((plane, index) =>
          plane.members.map((member) => ({
            key: `${member.source}:${member.elementId}`,
            name: member.name,
            source: levels.sources[member.source]!.name,
            plane: index,
            elevation: plane.point[2]!,
            status: "loaded",
            outside: !!bounds && (plane.point[2]! < bounds.minZ || plane.point[2]! > bounds.maxZ),
          })),
        )
        .concat(
          levels.sources
            .filter((s) => s.status !== "loaded")
            .map((s) => ({
              key: `source:${s.source}`,
              name: s.name,
              source: s.name,
              plane: -1,
              elevation: NaN,
              status: s.status,
              outside: false,
            })),
        ) ?? [],
    [levels, bounds],
  );
  const unloaded = levels?.sources.filter((s) => s.status === "unloaded").length ?? 0;
  const unavailable = levels?.sources.filter((s) => s.status === "unavailable").length ?? 0;
  const unread = levels?.sources.reduce((n, s) => n + s.unavailableLevelIds.length, 0) ?? 0;
  return (
    <div className="flex flex-col items-start gap-1" data-level-readout="">
      <ListPopup
        anchor="trigger"
        face="control"
        trigger={
          levels
            ? `Levels · ${levels.planes.reduce((n, p) => n + p.members.length, 0)}`
            : pending
              ? "Reading levels…"
              : "Levels unavailable"
        }
        disabled={!levels}
        aria-label="Model levels"
        triggerLabel="Model levels"
        items={rows}
        filter="words"
        keyOf={(r) => r.key}
        labelOf={(r) => r.name}
        detailOf={(r) => r.source}
        groupOf={(r) => r.source}
        select="single"
        empty="No levels in the model"
        row={(r) => ({
          label: r.name,
          meta:
            r.status === "loaded" ? (
              <span className="face-mono">{r.elevation.toFixed(2)} ft</span>
            ) : (
              r.status
            ),
          sub: r.outside ? "Outside picture height" : undefined,
          lines: r.outside ? 2 : 1,
        })}
      />
      {!!(unloaded || unavailable || unread) && (
        <span className="t-small text-ink-2">
          {[
            unloaded && `${unloaded} sources unloaded`,
            unavailable && `${unavailable} sources unavailable`,
            unread && `${unread} levels unread`,
          ]
            .filter(Boolean)
            .join(" / ")}
        </span>
      )}
    </div>
  );
}
