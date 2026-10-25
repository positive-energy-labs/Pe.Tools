import { createContext, useContext, type ReactNode } from "react";
import { declutter, type Box } from "@pe/kit/lang/declutter";
import { token } from "@pe/kit/lib/token";
import type { Project } from "#/scene/projection";
import { DASH_CLASS, inferredInk } from "./encoding";
import type { Scene } from "./scene";
import { LOOK } from "#/scene/grounds";

export const CaptionBounds = createContext<{
  width: number;
  height: number;
  obstacles?: readonly Box[];
} | null>(null);
export type ScreenLabel = {
  key: string;
  x: number;
  y: number;
  text: string;
  ids?: readonly number[];
  priced?: boolean;
  stub?: boolean;
  at?: readonly number[];
};
export const pathOf = (line: readonly (readonly number[])[], project: Project) => {
  let d = "";
  for (const part of project.lines?.(line) ?? [line])
    for (const [i, p] of part.entries()) {
      const xy = project(p);
      if (!xy) return null;
      d += `${i ? "L" : "M"}${xy[0].toFixed(1)} ${xy[1].toFixed(1)}`;
    }
  return d;
};

/** Text and geometry share the annotation plane; all captions compete with pins and badges. */
export function layoutCaptions(
  labels: readonly ScreenLabel[],
  bounds: Box,
  obstacles: readonly Box[] = [],
  hovered: number | null = null,
) {
  const look = LOOK.read().captions;
  const unique = labels.filter(
    (a, i) =>
      !labels
        .slice(0, i)
        .some(
          (b) =>
            !a.stub &&
            !b.stub &&
            a.text === b.text &&
            Math.abs(a.x - b.x) < 6 * a.text.length &&
            Math.abs(a.y - b.y) < 12,
        ),
  );
  const ordered = [...unique].sort(
    (a, b) => Number(!!b.ids?.includes(hovered!)) - Number(!!a.ids?.includes(hovered!)),
  );
  const placed = declutter(
    ordered
      .filter((l) => !l.stub)
      .map((value) => {
        const width = value.text.length * 6.3 + 4;
        const x = Math.max(bounds.x, Math.min(value.x, bounds.x + bounds.width - width));
        const y = Math.max(bounds.y, Math.min(value.y - 10, bounds.y + bounds.height - 12));
        return {
          value,
          x,
          y,
          width,
          height: 12,
        };
      }),
    bounds,
    obstacles,
  ).map((slot) => ({ ...slot.value, x: slot.x + 2, y: slot.y + 10 }));
  const taken = [
    ...obstacles,
    ...placed.map((l) => ({ x: l.x - 2, y: l.y - 10, width: l.text.length * 6.3 + 4, height: 12 })),
  ];
  const stubs = ordered
    .filter((l) => l.stub)
    .map((l) => ({ ...l, text: l.text.split(/\s*,\s*/).join(", ") }));
  const out: (ScreenLabel & {
    anchor?: readonly [number, number];
    end?: readonly [number, number];
  })[] = [...placed];
  const crosses = (
    a: readonly number[],
    b: readonly number[],
    c: readonly number[],
    d: readonly number[],
  ) => {
    const side = (p: readonly number[], q: readonly number[], r: readonly number[]) =>
      (q[0]! - p[0]!) * (r[1]! - p[1]!) - (q[1]! - p[1]!) * (r[0]! - p[0]!);
    return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
  };
  for (const label of stubs) {
    const width = label.text.length * look.charPx + look.gapPx * 2;
    const height = look.rowPx + look.gapPx;
    const candidates: Box[] = [];
    for (let y = bounds.y; y + height <= bounds.y + bounds.height; y += height)
      for (
        let reach = look.leaderPx;
        reach <= Math.max(look.leaderPx, look.leaderMaxPx);
        reach += look.leaderPx
      )
        for (const side of [-1, 1])
          candidates.push({
            x: Math.max(
              bounds.x,
              Math.min(
                bounds.x + bounds.width - width,
                label.x + side * reach - (side < 0 ? width : 0),
              ),
            ),
            y,
            width,
            height,
          });
    const endOf = (b: Box) => [label.x < b.x ? b.x : b.x + b.width, b.y + look.rowPx / 2] as const;
    const cost = (b: Box) =>
      Math.hypot(b.x + b.width / 2 - label.x, b.y + b.height / 2 - label.y) +
      out.filter((l) => l.anchor && l.end && crosses([label.x, label.y], endOf(b), l.anchor, l.end))
        .length *
        (bounds.width + bounds.height);
    candidates.sort((a, b) => cost(a) - cost(b));
    const slot = candidates.find(
      (b) =>
        b.width <= bounds.width &&
        // Kit owns collision admission. The candidate's own bounds forbid a second search.
        declutter([b], b, taken).length === 1,
    );
    if (!slot) continue;
    taken.push(slot);
    out.push({
      ...label,
      anchor: [label.x, label.y],
      end: endOf(slot),
      x: slot.x + look.gapPx,
      y: slot.y + look.rowPx - look.gapPx / 3,
    });
  }
  return out;
}
export function SubjectLabels({
  sub,
  project,
  extra,
  bounds,
  obstacles,
  hovered,
}: {
  sub: Scene["subject"];
  project: Project;
  extra: readonly ScreenLabel[];
  bounds: Box;
  obstacles: readonly Box[];
  hovered: number | null;
}): ReactNode {
  const field = useContext(CaptionBounds);
  if (field) bounds = { x: 0, y: 0, ...field };
  if (field?.obstacles) obstacles = [...obstacles, ...field.obstacles];
  const labels: ScreenLabel[] = extra.flatMap((label) => {
    if (!label.stub || !label.at) return [label];
    const xy = project(label.at);
    return xy ? [{ ...label, x: xy[0], y: xy[1] }] : [];
  });
  const marks: ReactNode[] = [];
  const caption = (
    key: string,
    at: readonly number[],
    text: string,
    ids: readonly number[],
    centered = false,
  ) => {
    const xy = project(at);
    if (xy)
      labels.push({
        key,
        x: xy[0] + (centered ? -text.length * 3.15 : 8),
        y: xy[1] - 8,
        text,
        ids,
      });
  };
  const reference = (
    span: { after: number; before: number },
    line: readonly (readonly number[])[],
    text: string,
    ink: string,
    width = 1.5,
    dash?: string,
    opacity = 1,
  ) => {
    const key = `${text}:${span.after}-${span.before}`;
    const mid =
      line.length === 2
        ? line[0]!.map((v, i) => (v + line[1]![i]!) / 2)
        : line[Math.floor(line.length / 2)];
    if (mid) caption(key, mid, text, [span.after, span.before], true);
    const d = pathOf(line, project);
    if (d)
      marks.push(
        <path
          key={key}
          d={d}
          fill="none"
          stroke={ink}
          strokeWidth={width}
          strokeOpacity={opacity}
          className={dash}
        />,
      );
  };
  if (sub) {
    for (const span of sub.gaps)
      reference(span, [span.from, span.to], "gap", token("ink-2"), 1.5, "dash-void");
    for (const span of sub.inferred)
      reference(
        span,
        [span.from, span.to],
        span.confirmed ? "confirmed" : span.grade === "near-miss" ? "near miss" : span.grade,
        inferredInk(span),
      );
    for (const span of sub.omissions)
      reference(
        span,
        span.line,
        `skipped ${span.skipped.length}`,
        token("ink"),
        3,
        DASH_CLASS.reference,
        0.5,
      );
    for (const leg of sub.cut.legs) {
      const id = leg.ids[Math.floor(leg.ids.length / 2)],
        at = id == null ? null : sub.pointOf(id);
      if (at && leg.lengthFt >= 2)
        caption(
          `leg:${leg.name}|${leg.ids[0]}`,
          at,
          `${leg.size ?? "?"} · ${leg.lengthFt.toFixed(1)} ft · ${leg.fittings} elb`,
          leg.ids,
        );
    }
    for (const [i, place] of sub.cut.nodes.entries()) {
      const at = sub.pointOf(place.id);
      if (at) caption(`place:${place.id}-${i}`, at, place.name, [place.id]);
    }
  }
  return (
    <g data-subject="">
      {marks}
      {layoutCaptions(labels, bounds, obstacles, hovered).map((label) => (
        <g
          key={label.key}
          data-loss-label={label.stub ? undefined : label.text}
          data-stub-label={label.stub ? label.text : undefined}
        >
          {label.anchor && label.end && (
            <path
              d={`M${label.anchor[0]} ${label.anchor[1]}L${label.end[0]} ${label.end[1]}`}
              fill="none"
              stroke={token("ink-2")}
            />
          )}
          <text
            x={label.x}
            y={label.y}
            className="face-mono"
            fill={token(label.priced || label.stub ? "ink" : "ink-2")}
            stroke={token("page")}
            strokeWidth={3}
            paintOrder="stroke"
          >
            {label.text}
          </text>
        </g>
      ))}
    </g>
  );
}
