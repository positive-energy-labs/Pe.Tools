import { z } from "zod";
import { peReadings } from "./resource-stream";
import type { ReadingContext, UseSource } from "@pe/agent-contracts/route";
import { queueHolderSchema } from "@pe/agent-contracts/value";

const streamFrame = z.object({
  generation: z.number(),
  version: z.number().optional(),
  state: z.string().optional(),
  refreshCause: z.literal("document-changed").optional(),
  retry: z.number().optional(),
  holder: queueHolderSchema.optional(),
  statusVersion: z.number().optional(),
});

export function publicationSource<
  T extends {
    generation: number;
    version: number;
    state: string;
    reason?: string;
    refreshCause?: "document-changed";
    value: {
      evaluation: string;
      coverage: {
        refused: readonly { keys: readonly string[]; reason: string }[];
        unknown: readonly string[];
      };
    } | null;
  },
>(options: {
  read(
    ctx: ReadingContext,
    publication: { subscription: string; generation: number },
    release: boolean,
  ): Promise<T>;
}): UseSource<T> {
  return {
    kind: "use",
    dirties: ["snapshot"],
    open(ctx, deliver) {
      const publication = ctx.publication ?? { subscription: crypto.randomUUID(), generation: 0 };
      let closed = false,
        refreshing = false,
        invalidated = false,
        held = false,
        observed = false;
      let lastPublication: string | undefined;
      let statusVersion = -1;
      let holding = false;
      const clearHolder = () => {
        if (!holding) return;
        holding = false;
        deliver({ kind: "queue-holder", holder: null });
      };
      let unfollow: (() => void) | undefined;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let delay = 250;
      const refresh = async () => {
        if (closed || ctx.signal.aborted) return;
        if (refreshing) {
          invalidated = true;
          return;
        }
        clearTimeout(retry);
        refreshing = true;
        try {
          const result = await options.read(ctx, publication, false);
          if (closed || ctx.signal.aborted || result.generation !== publication.generation) return;
          // Observe even a superseded first response; the host retains its Work invalidation.
          // Invalidation is a Reading on the tab's one stream, never a stream per read (the origin has
          // 6 sockets). A fence or reconnect of that stream is not this read's staleness: the host
          // answers the key again, and `refresh-needed` then says whether to read.
          if (result.state === "superseded") return;
          if (!ctx.historyPoint && result.refreshCause === "document-changed") {
            deliver({ kind: "document-changed" });
            retry = setTimeout(() => void refresh(), delay);
            delay = Math.min(delay * 2, 2000);
            return;
          }
          delay = 250;
          // A refusal keeps the host's reason until a host event permits another acquisition.
          held = !!result.value;
          if (!result.value)
            return deliver({ kind: "failure", error: result.reason ?? "Refresh needed" });
          deliver({
            kind: "complete",
            value: result,
            revision: result.version,
            sourceVersion: result.value.evaluation,
            fresh:
              result.state === "current" &&
              !result.value.coverage.refused.length &&
              !result.value.coverage.unknown.length,
            reason:
              result.reason ??
              [
                ...result.value.coverage.refused.map(
                  (part) => `${part.keys.join(", ")}: ${part.reason}`,
                ),
                ...(result.value.coverage.unknown.length
                  ? [`Not covered: ${result.value.coverage.unknown.join(", ")}`]
                  : []),
              ].join("; "),
          });
        } catch (error) {
          if (!closed && !ctx.signal.aborted) deliver({ kind: "failure", error });
        } finally {
          refreshing = false;
          if (invalidated) {
            invalidated = false;
            void refresh();
          }
        }
      };
      if (ctx.historyPoint) void refresh();
      else
        unfollow = peReadings.subscribe(
          {
            kind: "publication",
            subscription: publication.subscription,
            generation: publication.generation,
          },
          (frame) => {
            if (closed || ctx.signal.aborted) return;
            if (frame.kind === "stale") {
              observed = false;
              lastPublication = undefined;
              statusVersion = -1;
              clearHolder();
              return;
            }
            if (frame.kind === "failure") {
              clearHolder();
              return deliver({ kind: "stale" });
            }
            const decoded = streamFrame.safeParse(
              frame.kind === "snapshot" && !frame.stale ? frame.value : null,
            );
            if (!decoded.success || decoded.data.generation !== publication.generation) return;
            const {
              version,
              state,
              refreshCause,
              retry,
              holder,
              statusVersion: next,
            } = decoded.data;
            if (holder !== undefined && next !== undefined && next > statusVersion) {
              statusVersion = next;
              if (holding || holder) deliver({ kind: "queue-holder", holder });
              holding = holder !== null;
            }
            if (state === undefined) return;
            const delivery = JSON.stringify([version, state, refreshCause, retry]);
            if (next !== undefined && lastPublication === delivery) return;
            lastPublication = delivery;
            // The stream must own the slot before HTTP acquires it. Reconnect reacquires the same ID.
            const first = !observed;
            observed = true;
            if (first || state === "refresh-needed" || (state === "absent" && held)) {
              if (refreshCause === "document-changed") deliver({ kind: "document-changed" });
              else if (!first) deliver({ kind: "stale" });
              void refresh();
            }
          },
        );
      return () => {
        closed = true;
        clearTimeout(retry);
        unfollow?.();
        if (!ctx.historyPoint)
          void options
            .read({ ...ctx, signal: new AbortController().signal }, publication, true)
            .catch(() => {});
      };
    },
  };
}
