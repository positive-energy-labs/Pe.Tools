import type { PartitionReviewData } from "@pe/agent-contracts";
import { useId } from "react";
import { Press } from "#/components/lang/press";
import { token } from "#/lib/token";
import { candidateTone, HELD_HATCH, LABEL, LABEL_SIZE, RESIDUE_TREATMENT } from "./palette";
import { ringPath, toPx, type ZoneGeometry, type ZoneRecord, type ZoneViewport } from "./world";
import { HatchPattern } from "./browser/unknown";

export function reviewShapes(geom: ZoneGeometry, zone: ZoneRecord): ReviewShape[] {
  return [
    ...geom.rooms.map<ReviewShape>((room) => ({
      key: `room:${room.id}`,
      id: room.id,
      disposition: room.disposition,
      reason: zone.RejectionDetails?.[room.id] ?? null,
      sqft: room.sqft,
      label: [room.lx, room.ly] as [number, number],
      loops: (geom.polys.get(room.id) ?? []).map((ring) => ring.points),
    })),
    ...geom.residues.map<ReviewShape>((residue) => ({
      key: `residue:${residue.id}`,
      id: residue.id,
      disposition:
        residue.reason === "rejected"
          ? ("held" as const)
          : residue.reason === "void" || residue.reason === "excluded"
            ? residue.reason
            : null,
      reason: zone.RejectionDetails?.[residue.id] ?? null,
      sqft: residue.sqft,
      label: residue.loops[0]?.[0],
      loops: residue.loops,
    })),
  ];
}

export type ReviewShape = Omit<PartitionReviewData["shapes"][number], "kind" | "label"> & {
  key: string;
  label?: [number, number];
};
export const partitionReviewShapes = (review: PartitionReviewData): ReviewShape[] =>
  review.shapes.map(({ kind, label, ...shape }) => ({
    ...shape,
    key: `${kind}:${shape.id}`,
    label: label ?? undefined,
  }));
export const reviewLabel = (shape: ReviewShape) =>
  `${shape.disposition ?? "unknown"} ${shape.id} · ${shape.sqft ?? "unknown"} sf · ${shape.reason ?? "reason unavailable"}`;

/** Screen and exported SVG share marks; flags never change the solver's disposition. */
export function ReviewShapes({
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

export function ReviewList({
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
    <div className="max-h-48 overflow-auto" aria-label="shape review">
      {shapes.map((shape) => (
        <div key={shape.key} className="flex items-baseline gap-2 hairline-b-faint">
          <Press
            tone="quiet"
            size="caption"
            state={selected === shape.key ? "selected" : "rest"}
            onClick={() => onSelect(shape.key)}
          >
            {reviewLabel(shape)}
          </Press>
          {onFlag && (
            <Press
              tone="quiet"
              size="caption"
              state={flags.includes(shape.key) ? "selected" : "rest"}
              onClick={() => onFlag(shape.key)}
            >
              {flags.includes(shape.key) ? "unflag" : "flag"} {shape.id}
            </Press>
          )}
        </div>
      ))}
    </div>
  );
}
