import { useEffect, useState } from "react";
import { z } from "zod";
import { canonicalRouteInput, type RouteStatePatch } from "@pe/agent-contracts";
import type { PlannedVerb } from "@pe/web-kernel/route";

type Cells = {
  readonly doc: unknown;
  readonly state: { readonly state: string };
  patch(
    patches: readonly RouteStatePatch[],
    history?: { label: string },
  ): Promise<{ message: string } | null>;
};
type Staged = { readonly key: string; readonly request: unknown; readonly verb: PlannedVerb };
const intents = z.looseObject({
  writeIntent: z.record(z.string(), z.looseObject({ edit: z.looseObject({ value: z.unknown() }).nullish() })),
});
const stagedIn = (doc: unknown, key: string) =>
  intents.safeParse(doc).data?.writeIntent[key]?.edit?.value;

/**
 * A sealed command reads its input from Work (`writeIntent[key]`). One press stages that input,
 * waits until the host has accepted it, then plans and applies: the staged Work is the review.
 */
export function useStaged(cells: Cells) {
  const [pending, setPending] = useState<Staged | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!pending || cells.state.state !== "ready") return;
    if (canonicalRouteInput(stagedIn(cells.doc, pending.key)) !== canonicalRouteInput(pending.request))
      return;
    setPending(null);
    void (async () => {
      await pending.verb.plan();
      await pending.verb.apply();
    })().catch((error) => setProblem(error instanceof Error ? error.message : String(error)));
  }, [pending, cells.doc, cells.state.state]);
  return {
    pending: pending?.key ?? null,
    problem,
    async run(key: string, request: unknown, verb: PlannedVerb, label: string) {
      setProblem(null);
      const failure = await cells.patch(
        [{ path: ["writeIntent", key, "edit"], value: { value: request } }],
        { label },
      );
      if (failure) setProblem(failure.message);
      else setPending({ key, request, verb });
    },
  };
}
