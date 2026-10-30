import { z } from "zod";
import { actionStatusSchema, type HarnessThreadSummary, type Machine } from "@pe/agent-contracts";
import type { RecentDocument } from "@pe/host-contracts/pe-revit-contract";
import { subscriptionSource } from "#/shell/readings-use";
import type { ReadingSource, UseSource } from "#/shell/readings";
import { harnessClient } from "#/workbench/provider/harness-client";
import { resolveWorkbenchConfig } from "#/workbench/config";
import { BAY_RECENTS, BAY_THREADS, MACHINE_SEEDS } from "./seeds";
import type { OpenPageState } from "./graph";
export type Recents = { result?: { recents?: RecentDocument[] } };
const fixture = (page: unknown) => {
  const p = page as OpenPageState;
  return !!p.demo && !p.live;
};
const seeded = <T>(source: UseSource<T>, value: T): UseSource<T> => ({
  ...source,
  open: (ctx, deliver) =>
    fixture(ctx.page)
      ? deliver({ kind: "complete", value, revision: 0 })
      : source.open(ctx, deliver),
});
export function openSources(): Readonly<Record<string, ReadingSource>> {
  return {
    "open.machine": seeded(
      subscriptionSource({
        request: () => ({ kind: "machine" }),
        decode: (v) => v as Machine,
        dirties: ["machine", "sdk"],
      }),
      (MACHINE_SEEDS["patch-bay"] as { observation: Machine }).observation,
    ),
    "open.recents": seeded(
      subscriptionSource({
        request: () => ({ kind: "sdk", read: "recents" }),
        decode: (v) => v as Recents,
        dirties: ["machine", "recents", "sdk"],
      }),
      BAY_RECENTS,
    ),
    "open.receipts": seeded(
      subscriptionSource({
        request: () => ({ kind: "receipts", tool: "instances" }),
        decode: (v) => z.array(actionStatusSchema).parse(v),
        dirties: ["machine", "receipts", "sdk"],
      }),
      [],
    ),
    "open.world": {
      kind: "feed",
      async open(ctx, deliver) {
        if (fixture(ctx.page)) return deliver({ kind: "complete", value: [], revision: 0 });
        return subscriptionSource({
          kind: "feed",
          request: () => ({ kind: "world" }),
          decode: (v) => v,
          fold: (_, event) => event,
        }).open(ctx, deliver);
      },
    },
    "open.threads": {
      kind: "use",
      open(ctx, deliver) {
        if (fixture(ctx.page))
          return deliver({ kind: "complete", value: BAY_THREADS, revision: 0 });
        let revision = 0;
        return harnessClient(resolveWorkbenchConfig().origin).summaries(
          (value: readonly HarnessThreadSummary[]) =>
            deliver({ kind: "complete", value, revision: ++revision }),
          (error) => deliver({ kind: "failure", error }),
        );
      },
    },
  };
}
