import { useState } from "react";
import type { PartitionReviewData } from "@pe/agent-contracts";
import { ReviewShapes, ReviewList, partitionReviewShapes } from "#/runs/review";
import { zoneViewport } from "#/runs/world";

/** The route owns the result and flags. No saved-run lookup or live-room reconstruction. */
export function PartitionReview({
  review,
  onFlag,
}: {
  review: { zone: string; data: PartitionReviewData | null; flags: string[] };
  onFlag: (key: string) => void;
}) {
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
        Partition review / {data.zone.name} / {data.source.runId}
      </div>
      <div>
        {data.source.documentKey} / {data.source.scopeKey}
      </div>
      <div>No plan evidence attached. Geometry is the partition result.</div>
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
            runId={data.source.runId}
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
        download={`${data.source.runId}-review.json`}
        href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ ...data, flags: review.flags }, null, 2))}`}
      >
        export review JSON
      </a>
    </div>
  );
}
