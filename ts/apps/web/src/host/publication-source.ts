import { z } from "zod";
import { peReadings } from "./resource-stream";
import type { ReadingContext, UseSource } from "@pe/web-kernel/shell/source-contract";

export function publicationSource<T extends { generation: number; version: number; state: string; reason?: string; value: { evaluation: string; coverage: { refused: readonly { keys: readonly string[]; reason: string }[]; unknown: readonly string[] } } | null }>(options: {
  read(ctx: ReadingContext, publication: { subscription: string; generation: number }, release: boolean): Promise<T>;
}): UseSource<T> {
  return { kind: "use", dirties: ["snapshot"], open(ctx, deliver) {
    const publication = ctx.publication ?? { subscription: crypto.randomUUID(), generation: 0 };
    let closed = false, refreshing = false, invalidated = false, held = false, observed = false;
    let unfollow: (() => void) | undefined;
    const refresh = async () => {
      if (closed) return;
      if (refreshing) { invalidated = true; return; }
      refreshing = true;
      try {
        const result = await options.read(ctx, publication, false);
        if (closed || ctx.signal.aborted || result.generation !== publication.generation) return;
        // Observe even a superseded first response; the host retains its Work invalidation.
        // Invalidation is a Reading on the tab's one stream, never a stream per read (the origin has
        // 6 sockets). A fence or reconnect of that stream is not this read's staleness: the host
        // answers the key again, and `refresh-needed` then says whether to read.
        if (result.state === "superseded") return;
        // A refusal keeps the host's reason until a host event permits another acquisition.
        held = !!result.value;
        if (!result.value) return deliver({ kind: "failure", error: result.reason ?? "Refresh needed" });
        deliver({ kind: "complete", value: result, revision: result.version, sourceVersion: result.value.evaluation,
          fresh: result.state === "current" && !result.value.coverage.refused.length && !result.value.coverage.unknown.length,
          reason: result.reason ?? [...result.value.coverage.refused.map(part => `${part.keys.join(", ")}: ${part.reason}`),
            ...(result.value.coverage.unknown.length ? [`Not covered: ${result.value.coverage.unknown.join(", ")}`] : [])].join("; ") });
      } catch (error) { if (!closed && !ctx.signal.aborted) deliver({ kind: "failure", error }); }
      finally { refreshing = false; if (invalidated) { invalidated = false; void refresh(); } }
    };
    if (ctx.historyPoint) void refresh();
    else unfollow = peReadings.subscribe({ kind: "publication", subscription: publication.subscription, generation: publication.generation }, frame => {
      if (closed) return;
      if (frame.kind === "stale") { observed = false; return; }
      if (frame.kind === "failure") return deliver({ kind: "stale" });
      const state = z.object({ generation: z.number(), state: z.string() }).safeParse(frame.kind === "snapshot" && !frame.stale ? frame.value : null);
      if (!state.success || state.data.generation !== publication.generation) return;
      // The stream must own the slot before HTTP acquires it. Reconnect reacquires the same ID.
      const first = !observed;
      observed = true;
      if (first || state.data.state === "refresh-needed" || (state.data.state === "absent" && held)) {
        if (!first) deliver({ kind: "stale" });
        void refresh();
      }
    });
    return () => { closed = true; unfollow?.(); if (!ctx.historyPoint) void options.read({ ...ctx, signal: new AbortController().signal }, publication, true).catch(() => {}); };
  } };
}
