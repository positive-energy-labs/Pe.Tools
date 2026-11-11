import { z } from "zod";
import { openEventSource } from "./resource-stream";
import type { ReadingContext, UseSource } from "../shell/source-contract";

export function publicationSource<T extends { generation: number; version: number; state: string; reason?: string; value: { evaluation: string; coverage: { refused: readonly { keys: readonly string[]; reason: string }[]; unknown: readonly string[] } } | null }>(options: {
  read(ctx: ReadingContext, publication: { subscription: string; generation: number }, release: boolean): Promise<T>;
}): UseSource<T> {
  return { kind: "use", dirties: ["snapshot"], open(ctx, deliver) {
    const publication = ctx.publication ?? { subscription: crypto.randomUUID(), generation: 0 };
    let closed = false, refreshing = false, invalidated = false, races = 0;
    let events: EventSource | undefined;
    const refresh = async () => {
      if (closed) return;
      if (refreshing) { invalidated = true; return; }
      refreshing = true;
      try {
        const result = await options.read(ctx, publication, false);
        if (closed || ctx.signal.aborted || result.generation !== publication.generation) return;
        // Observe even a superseded first response; the host retains its Work invalidation.
        if (!events && !ctx.historyPoint) {
          events = openEventSource(`/pe/read-events?subscription=${encodeURIComponent(publication.subscription)}&generation=${publication.generation}`);
          events.onmessage = event => {
            const state = z.object({ generation: z.number(), state: z.string() }).parse(JSON.parse(event.data));
            if (!closed && state.generation === publication.generation && state.state === "refresh-needed") {
              deliver({ kind: "stale" }); void refresh();
            }
          };
          events.onerror = () => { if (!closed) deliver({ kind: "stale" }); };
        }
        if (result.state === "superseded") return;
        // The host answers refresh-needed when an input moved under its evaluation (the machine
        // census changing mid-read) and sends no event for it, so this source re-reads.
        // ponytail: two re-reads for any refusal, since the host does not type a race apart from a
        // lasting one; a typed retry flag on the publication is the upgrade.
        if (result.state === "refresh-needed" && races < 2) {
          await new Promise(resolve => setTimeout(resolve, 250 * ++races));
          invalidated = true;
          if (closed || !result.value) return;
        } else races = 0;
        if (!result.value) return deliver({ kind: "failure", error: result.reason ?? "Refresh needed" });
        deliver({ kind: "complete", value: result, revision: result.version, sourceVersion: result.value.evaluation,
          fresh: result.state === "current" && !result.value.coverage.refused.length && !result.value.coverage.unknown.length,
          reason: result.reason ?? [...result.value.coverage.refused.map(part => `${part.keys.join(", ")}: ${part.reason}`),
            ...(result.value.coverage.unknown.length ? [`Not covered: ${result.value.coverage.unknown.join(", ")}`] : [])].join("; ") });
      } catch (error) { if (!closed && !ctx.signal.aborted) deliver({ kind: "failure", error }); }
      finally { refreshing = false; if (invalidated) { invalidated = false; void refresh(); } }
    };
    void refresh();
    return () => { closed = true; events?.close(); if (!ctx.historyPoint) void options.read({ ...ctx, signal: new AbortController().signal }, publication, true).catch(() => {}); };
  } };
}
