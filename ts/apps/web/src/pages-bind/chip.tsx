import { useEffect, useState } from "react";
import {
  pageTargetReadingSchema,
  routeAddress,
  type PageTargetReading,
} from "@pe/agent-contracts";
import { useRouteSearch } from "#/route/activity";
import { peReadings } from "#/host/resource-stream";
import { TooltipHint } from "@pe/kit/lang/tooltip";

/** SPA chrome owns consent. Page code never draws or answers this control. */
export function PageBindingChip({ slug }: { slug: string }) {
  const { carry } = routeAddress("bind").read(useRouteSearch());
  const [reading, setReading] = useState<PageTargetReading | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    setReading(null);
    // The Page's target is a Reading on the tab's one stream; the host serves it again when a
    // thread head or the binding moves. A fenced or lost stream stops naming the document at once.
    return peReadings.subscribe({ kind: "page-target", slug }, (frame) => {
      const next =
        frame.kind === "snapshot" && !frame.stale
          ? pageTargetReadingSchema.safeParse(frame.value)
          : null;
      setReading(next?.success ? next.data : null);
      if (next?.success) setRefusal(null);
      else if (frame.kind === "failure") setRefusal(frame.error);
      else if (next) setRefusal(next.error.message);
    });
  }, [slug]);
  const write = reading?.write;
  // The document's name is the visible consent (ADR 0021): a thread slot that writes names it.
  return (
    <div className="flex min-w-0 items-center gap-2" aria-label="Page binding">
      {write?.kind === "thread" ? (
        <TooltipHint content="A person added this document to the bound thread; this Page may write it.">
          <span className="face-mono" data-tone="done">
            {reading?.document?.title || "thread document"}
          </span>
        </TooltipHint>
      ) : (
        <TooltipHint
          content={write?.kind === "read" ? write.refusal.reason : (refusal ?? undefined)}
        >
          <span className="face-mono">{write?.kind ?? "unverified"}</span>
        </TooltipHint>
      )}
      <a href={routeAddress("bind").link({ page: slug }, carry)}>Bind…</a>
      {refusal && (
        <span role="status" data-tone="caution">
          {refusal}
        </span>
      )}
    </div>
  );
}
