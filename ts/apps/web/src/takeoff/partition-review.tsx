import { useId, useState } from "react";
import type { PartitionReviewData } from "@pe/agent-contracts";
import { List } from "#/components/lang/list-popup";
import { Press } from "#/components/lang/press";
import { token } from "#/lib/token";
import law from "./visual-law.json";

type ZoneViewport = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pxPerFt: number;
  widthPx: number;
  heightPx: number;
};

function zoneViewport(
  zone: { MinX: number; MinY: number; MaxX: number; MaxY: number },
  pxPerFt: number,
  padFt = 4,
): ZoneViewport {
  const minX = zone.MinX - padFt;
  const minY = zone.MinY - padFt;
  const maxX = zone.MaxX + padFt;
  const maxY = zone.MaxY + padFt;
  return {
    minX,
    minY,
    maxX,
    maxY,
    pxPerFt,
    widthPx: Math.ceil((maxX - minX) * pxPerFt),
    heightPx: Math.ceil((maxY - minY) * pxPerFt),
  };
}

const toPx = (vp: ZoneViewport, xFt: number, yFt: number): [number, number] => [
  (xFt - vp.minX) * vp.pxPerFt,
  (vp.maxY - yFt) * vp.pxPerFt,
];

function ringPath(vp: ZoneViewport, rings: [number, number][][]): string {
  return rings
    .map(
      (ring) =>
        ring
          .map((point, index) => {
            const [x, y] = toPx(vp, point[0], point[1]);
            return `${index === 0 ? "M" : "L"}${x} ${y}`;
          })
          .join(" ") + " Z",
    )
    .join(" ");
}

const residueTreatment = (residue: typeof law.void) => ({
  outline: {
    color: `rgba(${residue.outline.rgba.join(",")})`,
    widthPx: residue.outline.widthPx,
  },
  hatch: {
    angleDeg: residue.hatch.angleDeg,
    color: `rgba(${residue.hatch.rgba.join(",")})`,
    spacingPx: residue.hatch.spacingPx,
    widthPx: residue.hatch.widthPx,
  },
});
const RESIDUE_TREATMENT = {
  void: residueTreatment(law.void),
  excluded: residueTreatment(law.excluded),
};
const LABEL = `rgba(${law.label.rgba.join(",")})`;
const LABEL_SIZE = law.label.sizePx;
const HELD_HATCH = law.candidate.status.held.hatch;

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}

function candidateTone(zone: string, candidateId: string): { fill: string; dark: string } {
  const ordinal = Number(candidateId.match(/\d+/)?.[0] ?? hash(candidateId));
  const hue = ((hash(zone) % 360) + ordinal * 137.508) % 360;
  return {
    fill: `hsl(${hue} 82% 48% / ${law.candidate.fill.alpha})`,
    dark: `hsl(${hue} 82% 28%)`,
  };
}

function HatchPattern(props: {
  id: string;
  color: string;
  hatch: { angleDeg: number; spacingPx: number; widthPx: number };
}) {
  const { hatch } = props;
  return (
    <pattern
      id={props.id}
      width={hatch.spacingPx}
      height={hatch.spacingPx}
      patternUnits="userSpaceOnUse"
      patternTransform={`rotate(${hatch.angleDeg})`}
    >
      <line y2={hatch.spacingPx} stroke={props.color} strokeWidth={hatch.widthPx} />
    </pattern>
  );
}

type ReviewShape = Omit<PartitionReviewData["shapes"][number], "kind" | "label"> & {
  key: string;
  label?: [number, number];
};
const partitionReviewShapes = (review: PartitionReviewData): ReviewShape[] =>
  review.shapes.map(({ kind, label, ...shape }) => ({
    ...shape,
    key: `${kind}:${shape.id}`,
    label: label ?? undefined,
  }));
const reviewLabel = (shape: ReviewShape) =>
  `${shape.disposition ?? "unknown"} ${shape.id} · ${shape.sqft ?? "unknown"} sf · ${shape.reason ?? "reason unavailable"}`;

/** Screen and exported SVG share marks; flags never change the solver's disposition. */
function ReviewShapes({
  shapes,
  zone,
  runId,
  vp,
  flags = [],
  selected,
  onSelect,
  scale = 1,
}: {
  shapes: ReviewShape[];
  zone: string;
  runId: string;
  vp: ZoneViewport;
  flags?: readonly string[];
  selected?: string | null;
  onSelect?: (key: string) => void;
  scale?: number;
}) {
  const instance = useId();
  return (
    <g fillRule="evenodd">
      {shapes.map((shape) => {
        const tone = candidateTone(zone, shape.id);
        const held = shape.disposition === "held";
        const residue =
          shape.disposition === "accepted" || held
            ? null
            : RESIDUE_TREATMENT[shape.disposition === "excluded" ? "excluded" : "void"];
        const hatch = held ? { ...HELD_HATCH, color: tone.dark } : residue?.hatch;
        const id = `review-${instance}-${encodeURIComponent(`${runId}/${zone}/${shape.key}`)}`;
        const d = ringPath(vp, shape.loops);
        const flagged = flags.includes(shape.key);
        const picked = selected === shape.key;
        const label = reviewLabel(shape);
        return (
          <g key={shape.key}>
            {hatch && (
              <defs>
                <HatchPattern
                  id={id}
                  color={hatch.color}
                  hatch={{
                    ...hatch,
                    spacingPx: hatch.spacingPx / scale,
                    widthPx: hatch.widthPx / scale,
                  }}
                />
              </defs>
            )}
            <path
              d={d}
              fill={residue ? "transparent" : tone.fill}
              stroke={
                flagged
                  ? token("alarm")
                  : picked
                    ? token("ink")
                    : (residue?.outline.color ?? "none")
              }
              strokeWidth={(flagged || picked ? 2.5 : (residue?.outline.widthPx ?? 0)) / scale}
              pointerEvents="visiblePainted"
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect ? 0 : undefined}
              aria-label={label}
              aria-pressed={onSelect ? picked : undefined}
              onClick={
                onSelect
                  ? (event) => {
                      event.stopPropagation();
                      onSelect(shape.key);
                    }
                  : undefined
              }
              onKeyDown={
                onSelect
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        onSelect(shape.key);
                      }
                    }
                  : undefined
              }
            >
              <title>{label}</title>
            </path>
            {hatch && <path d={d} fill={`url(#${id})`} pointerEvents="none" />}
            {shape.label && (
              <text
                x={toPx(vp, ...shape.label)[0]}
                y={toPx(vp, ...shape.label)[1]}
                fill={LABEL}
                fontSize={LABEL_SIZE / scale}
                fontFamily="var(--font-mono), monospace"
                textAnchor="middle"
                pointerEvents="none"
              >
                {flagged ? "⚑ " : ""}
                {shape.disposition?.[0]?.toUpperCase() ?? "?"} {shape.id}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function ReviewList({
  shapes,
  selected,
  flags,
  onSelect,
  onFlag,
}: {
  shapes: ReviewShape[];
  selected: string | null;
  flags: readonly string[];
  onSelect: (key: string) => void;
  onFlag?: (key: string) => void;
}) {
  return (
    <List
      aria-label="shape review"
      items={shapes}
      keyOf={(shape) => shape.key}
      labelOf={reviewLabel}
      maxHeight="12rem"
      empty="no shapes to review"
      onPick={(shape) => onSelect(shape.key)}
      row={(shape) => ({
        // The flag is a mark on the row; the verb that sets it is a row action.
        lead: flags.includes(shape.key) ? "⚑" : undefined,
        label: reviewLabel(shape),
        active: selected === shape.key,
        actions: onFlag ? (
          <Press tone="quiet" size="caption" onClick={() => onFlag(shape.key)}>
            {flags.includes(shape.key) ? "unflag" : "flag"} {shape.id}
          </Press>
        ) : undefined,
      })}
    />
  );
}

export function PartitionReview({
  review,
  onFlag,
}: {
  review: {
    zone: string;
    data: PartitionReviewData | null;
    flags: string[];
    source: "fresh solver" | "saved native";
  };
  onFlag?: (key: string) => void;
}) {
  // Review-widget focus; the keyed review mount resets it when evidence changes.
  const [selected, setSelected] = useState<string | null>(null);
  const data = review.data;
  if (!data)
    return (
      <div className="p-2" role="status">
        {review.zone}: partition returned no review geometry.
      </div>
    );
  const shapes = partitionReviewShapes(data);
  const points = [...data.zone.loops, ...shapes.flatMap((shape) => shape.loops)].flat();
  if (!points.length) return <div className="p-2">{review.zone}: no shapes returned.</div>;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const bounds = {
    MinX: Math.min(...xs),
    MinY: Math.min(...ys),
    MaxX: Math.max(...xs),
    MaxY: Math.max(...ys),
  };
  const scale = Math.min(
    7,
    480 / (bounds.MaxX - bounds.MinX + 8),
    320 / (bounds.MaxY - bounds.MinY + 8),
  );
  const vp = zoneViewport(bounds, scale);
  return (
    <div className="p-2 overflow-auto">
      <div>
        Partition review / {review.source} / {data.zone.name} /{" "}
        {data.source.runId ?? "mixed original runs"}
      </div>
      <div>
        {data.source.documentKey} / {data.source.zoneKey}
      </div>
      <div>
        Edit boundaries in Revit, then refresh. Geometry is{" "}
        {review.source === "saved native"
          ? "read from Revit; original solver verdicts are historical"
          : "a temporary solver comparison; refresh or reload discards it"}
        .
      </div>
      <div className="flex flex-wrap gap-2">
        <svg
          width={vp.widthPx}
          height={vp.heightPx}
          viewBox={`0 0 ${vp.widthPx} ${vp.heightPx}`}
          aria-label="partition shape review"
        >
          <ReviewShapes
            shapes={shapes}
            zone={data.zone.key}
            runId={data.source.runId ?? data.source.zoneKey}
            vp={vp}
            selected={selected}
            flags={review.flags}
            onSelect={setSelected}
          />
        </svg>
        <ReviewList
          shapes={shapes}
          selected={selected}
          flags={review.flags}
          onSelect={setSelected}
          onFlag={onFlag}
        />
      </div>
      <a
        download={`${data.source.runId ?? data.source.zoneKey}-review.json`}
        href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ ...data, flags: review.flags }, null, 2))}`}
      >
        export review JSON
      </a>
    </div>
  );
}
