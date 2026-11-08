import { canonicalRouteInput, type Caller } from "@pe/agent-contracts";
import { z } from "zod";
import type { Publications } from "./evaluator.ts";

/** Invalidation metadata only. Values travel once in the read response; no browser acknowledgement. */
export function readEvents(publications: Publications, caller: Caller, request: Request) {
  const query = new URL(request.url, "http://host").searchParams;
  const subscription = z.string().min(1).max(128).parse(query.get("subscription"));
  const generation = z.coerce.number().int().nonnegative().parse(query.get("generation"));
  const id = canonicalRouteInput([caller, subscription]);
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(": open\n\n"));
      stop = publications.observe(id, (publication) => {
        if (publication.generation !== generation) return;
        const data = { generation, version: publication.version, state: publication.state };
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
      });
    },
    cancel() {
      stop();
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}
