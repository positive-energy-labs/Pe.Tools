import { SvgTip } from "@pe/kit/lang/tooltip";
/** The subject's own words over the model picture (gaps, inferred joins, omissions, legs, places),
 * and the caption every annotation label wears. */
import { createContext, useContext, type ReactNode } from "react";

import { token } from "@pe/kit/lib/token";
import type { Project } from "#/scene/projection";

import { DASH_CLASS, inferredInk } from "./encoding";
import type { Scene } from "./scene";

const GLYPH = 4;
/** A leg shorter than this carries no caption (its endpoints' names say enough). */
const LABEL_LEG_FT = 2;

/** The picture a caption must stay inside (the annotation layer's size); none = unclamped. */
export const CaptionBounds = createContext<{ width: number; height: number } | null>(null);
/** The 10 px mono face's advance, a little generous so the halo fits too. */
const CHAR_PX = 6.3;

/** A caption on a page-coloured halo, so it reads over any mesh; kept wholly inside the picture. */
export function Caption({
  x,
  y,
  children,
  anchor = "start",
  ink = token("ink-2"),
}: {
  x: number;
  y: number;
  children: string;
  anchor?: "start" | "middle";
  ink?: string;
}) {
  const bounds = useContext(CaptionBounds);
  if (bounds) {
    const width = children.length * CHAR_PX;
    const left = anchor === "middle" ? x - width / 2 : x;
    const right = bounds.width - 3 - (left + width);
    x += left < 3 ? 3 - left : Math.min(0, right);
    y = Math.min(Math.max(y, 11), bounds.height - 4);
  }
  return (
    <text
      x={x}
      y={y}
      fontSize={10}
      className="face-mono"
      textAnchor={anchor}
      fill={ink}
      stroke={token("page")}
      strokeWidth={3}
      paintOrder="stroke"
    >
      {children}
    </text>
  );
}

/** A polyline's projected `d`; null when any point is behind the camera. */
export const pathOf = (line: readonly (readonly number[])[], project: Project) => {
  let d = "";
  for (const [i, p] of line.entries()) {
    const xy = project(p);
    if (!xy) return null;
    d += `${i ? "L" : "M"}${xy[0].toFixed(1)} ${xy[1].toFixed(1)}`;
  }
  return d;
};

/** The subject's own words over the picture: gaps, inferred joins, omissions, legs and places. */
export function SubjectLabels({
  sub,
  project,
}: {
  sub: NonNullable<Scene["subject"]>;
  project: Project;
}): ReactNode {
  const span = (from: readonly number[], to: readonly number[]) => {
    const a = project(from);
    const b = project(to);
    return a && b
      ? { x1: a[0], y1: a[1], x2: b[0], y2: b[1], mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 }
      : null;
  };
  const caption = (id: number) => {
    const p = sub.pointOf(id);
    return p ? project(p) : null;
  };
  return (
    <g data-subject="">
      {sub.gaps.map((gap) => {
        const s = span(gap.from, gap.to);
        return s ? (
          <g key={`${gap.after}-${gap.before}`} data-gap={`${gap.after}-${gap.before}`}>
            <SvgTip content={"gap"} />
            <line {...s} stroke={token("ink-2")} strokeWidth={1.5} className="dash-void" />
            <Caption x={s.mx} y={s.my - 8} anchor="middle">
              gap
            </Caption>
          </g>
        ) : null;
      })}
      {sub.inferred.map((bridge) => {
        const s = span(bridge.from, bridge.to);
        return s ? (
          <g
            key={`${bridge.after}-${bridge.before}`}
            data-inferred={`${bridge.after}-${bridge.before}`}
          >
            <line {...s} stroke={inferredInk(bridge)} strokeWidth={1.5} />
            <Caption x={s.mx} y={s.my - 8} anchor="middle">
              {bridge.confirmed
                ? "confirmed"
                : bridge.grade === "near-miss"
                  ? "near miss"
                  : bridge.grade}
            </Caption>
          </g>
        ) : null;
      })}
      {sub.omissions.map((omission) => {
        const d = pathOf(omission.line, project);
        const mid = omission.line[Math.floor(omission.line.length / 2)];
        const m = mid && project(mid);
        return d ? (
          <g
            key={`${omission.after}-${omission.before}`}
            data-omission={`${omission.after}-${omission.before}`}
          >
            <path
              d={d}
              fill="none"
              stroke={token("ink")}
              strokeOpacity={0.5}
              strokeWidth={3}
              className={DASH_CLASS.reference}
            />
            {m ? (
              <Caption x={m[0]} y={m[1] - 8} anchor="middle">
                {`skipped ${omission.skipped.length}`}
              </Caption>
            ) : null}
          </g>
        ) : null;
      })}
      {sub.cut.legs.map((leg) => {
        const middle = leg.ids[Math.floor(leg.ids.length / 2)];
        const xy = leg.lengthFt < LABEL_LEG_FT || middle === undefined ? null : caption(middle);
        return xy ? (
          <g key={`${leg.name}|${leg.ids[0]}`} data-leg-label={leg.name}>
            <Caption x={xy[0] + 6} y={xy[1] - 6}>
              {`${leg.size ?? "?"} · ${leg.lengthFt.toFixed(1)} ft · ${leg.fittings} elb`}
            </Caption>
          </g>
        ) : null;
      })}
      {sub.cut.nodes.map((place, i) => {
        const xy = caption(place.id);
        return xy ? (
          <g
            key={`${place.id}-${i}`}
            data-place={place.kind}
            transform={`translate(${xy[0]} ${xy[1]})`}
          >
            <Caption x={GLYPH * 2} y={GLYPH * 3.5} ink={token("ink")}>
              {place.name}
            </Caption>
          </g>
        ) : null;
      })}
    </g>
  );
}
