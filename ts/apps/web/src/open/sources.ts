import { z } from "zod";
import { actionStatusSchema, type HarnessThreadSummary, type Machine } from "@pe/agent-contracts";
import type { RecentDocument } from "@pe/host-contracts/pe-revit-contract";
import { subscriptionSource } from "#/shell/readings-use";
import type { ReadingSource } from "#/shell/readings";
import { harnessClient } from "#/workbench/provider/harness-client";
import { resolveWorkbenchConfig } from "#/workbench/config";
export type Recents = { result?: { recents?: RecentDocument[] } };
export function openSources(): Readonly<Record<string, ReadingSource>> {
  return {
    "open.machine": subscriptionSource({
      request: () => ({ kind: "machine" }),
      decode: (v) => v as Machine,
      dirties: ["machine", "sdk"],
    }),
    "open.recents": subscriptionSource({
      request: () => ({ kind: "sdk", read: "recents" }),
      decode: (v) => v as Recents,
      dirties: ["machine", "recents", "sdk"],
    }),
    "open.receipts": subscriptionSource({
      request: () => ({ kind: "receipts", tool: "instances" }),
      decode: (v) => z.array(actionStatusSchema).parse(v),
      dirties: ["machine", "receipts", "sdk"],
    }),
    "open.world": {
      kind: "feed",
      async open(ctx, deliver) {
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
      open(_ctx, deliver) {
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
