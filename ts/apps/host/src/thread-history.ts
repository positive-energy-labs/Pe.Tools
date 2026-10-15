import { z } from "zod";
import type { HarnessEvent, HarnessThreadSummary, ReceiptReader } from "@pe/agent-contracts";
import { currentCaller } from "./control.ts";

const querySchema = z
  .strictObject({
    since: z.iso.datetime(),
    before: z.iso.datetime(),
    threadId: z.string().optional(),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .refine((q) => q.since <= q.before, "since must precede before");

/** Read through the transcript owner and receipt spine; never ask the model to locate private state. */
export function threadHistory(options: {
  snapshot: () => Array<HarnessThreadSummary & { events: HarnessEvent[] }>;
  receipts: ReceiptReader;
  threadJoin: (id: string) => Promise<string>;
}) {
  return async (request: Request): Promise<Response> => {
    const caller = currentCaller();
    if (caller.kind !== "human" && caller.kind !== "pea")
      return Response.json(
        { error: "Thread history requires a human or Pea context" },
        { status: 403 },
      );
    try {
      const q = querySchema.parse(
        JSON.parse(new URL(request.url).searchParams.get("query") ?? "{}"),
      );
      const rows = options
        .snapshot()
        .filter(
          (t) =>
            t.lifecycle.status === "settled" &&
            t.lifecycle.settledAt &&
            t.lifecycle.settledAt > q.since &&
            t.lifecycle.settledAt <= q.before &&
            t.activity.state !== "running" &&
            !t.activity.pending &&
            !(t.origin?.kind === "scheduled" && t.origin.taskId === "feedback-miner"),
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      const page = <T>(values: T[]) => ({
        items: values.slice(q.offset, q.offset + q.limit),
        hasMore: values.length > q.offset + q.limit,
      });
      if (!q.threadId) return Response.json(page(rows.map(({ events: _, ...summary }) => summary)));
      const row = rows.find((r) => r.id === q.threadId);
      if (!row) return Response.json({ error: "No eligible settled thread" }, { status: 404 });
      const receipts = await options.receipts.read({ threadId: await options.threadJoin(row.id) });
      const entries = [
        ...row.events.filter((e) => e.at <= q.before).map((event) => ({ kind: "event", event })),
        ...receipts
          .filter((r) => r.at <= q.before)
          .map((receipt) => ({ kind: "receipt", receipt })),
      ];
      return Response.json({ threadId: row.id, ...page(entries) });
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 400 });
    }
  };
}
