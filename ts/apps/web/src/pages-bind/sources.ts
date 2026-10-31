import { z } from "zod";
import { harnessThreadSummarySchema } from "@pe/agent-contracts";
import { subscriptionSource } from "#/shell/readings-use";
import type { UseSource } from "#/shell/readings";
import { readPageTarget } from "./client";
import type { BindPage } from "./graph";

export function bindSources(): Record<string, UseSource> {
  const threads = subscriptionSource({
    request: () => ({ kind: "threads" }),
    decode: (value) => z.array(harnessThreadSummarySchema).parse(value),
  });
  const inventory = subscriptionSource({
    request: () => ({ kind: "inventory" }),
    decode: (value) => value,
  });
  const pickerOnly = (source: UseSource): UseSource => ({
    kind: "use",
    open(ctx, deliver) {
      if ((ctx.page as BindPage).view)
        return deliver({ kind: "complete", value: null, revision: 0 });
      return source.open(ctx, deliver);
    },
  });
  return {
    "bind.target": {
      kind: "use",
      async open(ctx, deliver) {
        const p = ctx.page as BindPage;
        if (!p.page || p.view) return deliver({ kind: "complete", value: null, revision: 0 });
        try {
          const value = await readPageTarget(p.page, ctx.signal);
          if (!ctx.signal.aborted) deliver({ kind: "complete", value, revision: 1 });
        } catch (error) {
          if (!ctx.signal.aborted) deliver({ kind: "failure", error });
        }
      },
    },
    "bind.threads": pickerOnly(threads),
    "bind.inventory": pickerOnly(inventory),
  };
}
