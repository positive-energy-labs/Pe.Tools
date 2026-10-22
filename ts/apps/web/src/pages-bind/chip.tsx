import { useEffect, useState } from "react";
import { routeAddress, type PageTargetReading } from "@pe/agent-contracts";
import { useRouteSearch } from "#/route/activity";
import { openEventSource } from "#/readings";
import { peClient } from "#/host/pe-client";
import { readPageTarget } from "./client";
import { TooltipHint } from "@pe/kit/lang/tooltip";

/** SPA chrome owns consent. Page code never draws or answers this control. */
export function PageBindingChip({ slug }: { slug: string }) {
  const { carry } = routeAddress("bind").read(useRouteSearch());
  const [reading, setReading] = useState<PageTargetReading | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    let retired = false;
    let generation = 0;
    const fresh = async () => {
      const attempt = ++generation;
      setReading(null);
      try {
        const next = await readPageTarget(slug);
        if (retired || attempt !== generation) return;
        setReading(next);
        setRefusal(null);
      } catch (error) {
        if (!retired && attempt === generation)
          setRefusal(error instanceof Error ? error.message : String(error));
      }
    };
    const events = openEventSource(
      peClient.url("page.events", {
        params: { slug },
        query: { after: Number.MAX_SAFE_INTEGER },
      }),
    );
    events.onopen = () => void fresh();
    events.addEventListener("head", () => void fresh());
    events.addEventListener("binding", () => void fresh());
    events.onerror = () => {
      generation++;
      setReading(null);
    };
    void fresh();
    return () => {
      retired = true;
      events.close();
    };
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
        <span role="status" data-tone="alarm">
          {refusal}
        </span>
      )}
    </div>
  );
}
