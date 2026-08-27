/**
 * PROTOTYPE (round 1) — the ONE drawing renderer every variant uses.
 *
 * Predicted and actual are two FEEDS into the same renderer and the same world window. A second
 * renderer per side would compare renderers, not geometry — and that is the failure mode this
 * whole board exists to catch.
 *
 * Drawing conventions mirror `ProbeSvgGallery` exactly (plan / front / right, one shared scale,
 * cylinders true-round in plan and boxed in elevation, axis-aligned plane traces only), so a
 * disagreement between this board and the SVG gallery is a real disagreement, not a projection
 * difference.
 *
 * NO HUE CARRIES A VERDICT HERE. Predicted is a thin outline, actual is filled ink, void is
 * dashed. Disagreement reads as DAYLIGHT between the two, which survives colour-blindness, a
 * greyscale screenshot, and a printout — and is the one signal the drawing is for.
 */
import { useId } from "react";

import { VIEWS, type BoardView, type Scene, type SceneBox, type Vec3 } from "#/family-review/model";

const PAD = 1.12;

interface Projector {
  h: (feet: number) => number;
  v: (feet: number) => number;
  scale: number;
}

function projector(halfSpan: number, size: number): Projector {
  const scale = size / (2 * halfSpan * PAD);
  const mid = size / 2;
  return { h: (feet) => mid + feet * scale, v: (feet) => mid - feet * scale, scale };
}

const dominantAxis = (normal: Vec3): 0 | 1 | 2 | null => {
  const magnitudes = normal.map(Math.abs);
  const best = magnitudes.indexOf(Math.max(...magnitudes)) as 0 | 1 | 2;
  // Outside the v1 axis-aligned vocabulary: skipped rather than drawn at a guess.
  return magnitudes[best] > 0.999 ? best : null;
};

function BoxMark({
  box,
  view,
  project,
  outline,
}: {
  box: SceneBox;
  view: BoardView;
  project: Projector;
  outline: boolean;
}) {
  const stroke = outline ? "var(--pe-ink-mute)" : box.isSolid ? "var(--pe-ink)" : "var(--pe-ink-2)";
  const common = {
    fill: outline
      ? "none"
      : box.isSolid
        ? "color-mix(in srgb, var(--pe-ink) 12%, transparent)"
        : "none",
    stroke,
    strokeWidth: outline ? 0.8 : 1.3,
    strokeDasharray: box.isSolid ? undefined : "4 3",
  };

  if (box.diameter != null && view.depth === 2) {
    const cx = project.h((box.min[view.right] + box.max[view.right]) / 2);
    const cy = project.v((box.min[view.up] + box.max[view.up]) / 2);
    return <circle cx={cx} cy={cy} r={(box.diameter / 2) * project.scale} {...common} />;
  }

  const h0 = project.h(box.min[view.right]);
  const h1 = project.h(box.max[view.right]);
  const v0 = project.v(box.min[view.up]);
  const v1 = project.v(box.max[view.up]);
  return (
    <rect
      x={Math.min(h0, h1)}
      y={Math.min(v0, v1)}
      width={Math.abs(h1 - h0)}
      height={Math.abs(v1 - v0)}
      {...common}
    />
  );
}

export function ViewPanel({
  view,
  size,
  halfSpan,
  ink,
  ghost,
  labelPlanes = false,
}: {
  view: BoardView;
  size: number;
  halfSpan: number;
  /** Drawn solid — the side being judged. */
  ink: Scene;
  /** Drawn as a thin outline behind the ink. Omit for a single-feed panel. */
  ghost?: Scene;
  labelPlanes?: boolean;
}) {
  const project = projector(halfSpan, size);
  const clip = useId();

  const planeTraces = (scene: Scene, muted: boolean) =>
    scene.planes.flatMap((plane) => {
      const axis = dominantAxis(plane.normal);
      if (axis == null || axis === view.depth) return [];
      const vertical = axis === view.right;
      const at = vertical ? project.h(plane.point[view.right]) : project.v(plane.point[view.up]);
      return [
        <g key={`${muted ? "g" : "i"}:${plane.key}`}>
          <line
            x1={vertical ? at : 0}
            y1={vertical ? 0 : at}
            x2={vertical ? at : size}
            y2={vertical ? size : at}
            stroke={muted ? "var(--pe-line)" : "var(--pe-line-2)"}
            strokeWidth={0.75}
            strokeDasharray="2 3"
          />
          {labelPlanes && !muted ? (
            <text
              x={vertical ? at + 2 : 3}
              y={vertical ? size - 4 : at - 2}
              fontSize={7}
              fill="var(--pe-ink-mute)"
            >
              {plane.key}
            </text>
          ) : null}
        </g>,
      ];
    });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={view.title}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={0} y={0} width={size} height={size} />
        </clipPath>
      </defs>
      <rect
        x={0}
        y={0}
        width={size}
        height={size}
        fill="var(--pe-artifact)"
        stroke="var(--pe-line)"
      />
      <g clipPath={`url(#${clip})`}>
        <line x1={0} y1={project.v(0)} x2={size} y2={project.v(0)} stroke="var(--pe-line)" />
        <line x1={project.h(0)} y1={0} x2={project.h(0)} y2={size} stroke="var(--pe-line)" />
        {planeTraces(ink, false)}
        {ghost ? planeTraces(ghost, true) : null}
        {ghost?.boxes.map((box) => (
          <BoxMark key={`ghost:${box.key}`} box={box} view={view} project={project} outline />
        ))}
        {ink.boxes.map((box) => (
          <BoxMark key={box.key} box={box} view={view} project={project} outline={false} />
        ))}
        {ink.connectors.map((connector) => {
          const x = project.h(connector.origin[view.right]);
          const y = project.v(connector.origin[view.up]);
          const dh = connector.normal[view.right];
          const dv = connector.normal[view.up];
          const length = Math.hypot(dh, dv);
          return (
            <g key={connector.key}>
              <circle cx={x} cy={y} r={2.4} fill="var(--viz-1)" />
              {length > 1e-9 ? (
                <line
                  x1={x}
                  y1={y}
                  x2={x + (dh / length) * 14}
                  y2={y - (dv / length) * 14}
                  stroke="var(--viz-1)"
                  strokeWidth={1.1}
                />
              ) : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** The three views in a row, sharing one window. `ghost` turns every panel into an overlay. */
export function Triptych({
  size,
  halfSpan,
  ink,
  ghost,
  labelPlanes,
  captions = "full",
}: {
  size: number;
  halfSpan: number;
  ink: Scene;
  ghost?: Scene;
  labelPlanes?: boolean;
  /** At sidebar scale the axis clause does not fit under an 80px panel and wraps to two lines,
   *  which breaks the row rhythm. `short` keeps the view name — the part that identifies it. */
  captions?: "full" | "short";
}) {
  return (
    <div className="flex gap-2">
      {VIEWS.map((view) => (
        <figure key={view.title} className="m-0 flex flex-col gap-0.5">
          <ViewPanel
            view={view}
            size={size}
            halfSpan={halfSpan}
            ink={ink}
            ghost={ghost}
            labelPlanes={labelPlanes}
          />
          <figcaption className="face-mono t-caption text-[var(--pe-ink-mute)]">
            {captions === "short" ? view.title : `${view.title} · ${view.axes}`}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/** Scale legend for a triptych — the one number that makes the drawings measurable. */
export function ScaleNote({ halfSpan, size }: { halfSpan: number; size: number }) {
  const scale = size / (2 * halfSpan * PAD);
  const step =
    [1 / 12, 0.25, 0.5, 1, 2, 5, 10].filter((feet) => feet * scale <= size / 3).pop() ?? 1 / 12;
  const label = step < 1 ? `${Math.round(step * 12)}″` : `${step}′`;
  return (
    <div className="flex items-center gap-1.5 face-mono t-caption text-[var(--pe-ink-2)]">
      <svg width={step * scale + 2} height={9}>
        <line
          x1={1}
          y1={4.5}
          x2={step * scale + 1}
          y2={4.5}
          stroke="currentColor"
          strokeWidth={1.2}
        />
        <line x1={1} y1={0.5} x2={1} y2={8.5} stroke="currentColor" strokeWidth={1.2} />
        <line
          x1={step * scale + 1}
          y1={0.5}
          x2={step * scale + 1}
          y2={8.5}
          stroke="currentColor"
          strokeWidth={1.2}
        />
      </svg>
      {label} · all views
    </div>
  );
}
