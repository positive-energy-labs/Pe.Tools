import {
  READING_MAX_FRAME_BYTES,
  READING_MAX_REQUEST_BYTES,
  readingKey,
  readingRequestsSchema,
  type ReadingFrame,
  type ReadingRequest,
} from "@pe/agent-contracts";
import type { RouteWorkspace } from "./route-workspace.ts";
import type { ScopeStore } from "./scope-store.ts";
import type { OwnerValue } from "./owner-read.ts";

export type ResourceObserver = (
  request: ReadingRequest,
  publish: (frame: ReadingFrame) => void,
) => () => void;
export const resourceSnapshot = (key: string, result: OwnerValue<unknown>): ReadingFrame =>
  "error" in result
    ? { kind: "failure", key, error: result.error }
    : { kind: "snapshot", key, value: result.value };

export function observeResources(
  work: RouteWorkspace,
  scopes: ScopeStore,
  host?: ResourceObserver,
): ResourceObserver {
  return (request, publish) => {
    const key = readingKey(request);
    const accept = (value: OwnerValue<unknown>) => publish(resourceSnapshot(key, value));
    if (request.kind === "work") return work.observe(request, request.route, accept);
    if (request.kind === "thread-head") return scopes.observe(request.thread, accept);
    if (host) return host(request, publish);
    publish({ kind: "failure", key, error: `Resource '${request.kind}' is unavailable` });
    return () => {};
  };
}

/** One bounded connection mailbox. Producers only offer; they never await the socket. */
export function resourceResponse(
  request: Request,
  observe: ResourceObserver,
  limits = { frameBytes: READING_MAX_FRAME_BYTES, worldEvents: 64, stallMs: 10_000 },
): Response {
  const raw = new URL(request.url).searchParams.get("keys") ?? "";
  if (new TextEncoder().encode(raw).byteLength > READING_MAX_REQUEST_BYTES)
    return Response.json({ error: "Resource request is too large" }, { status: 400 });
  let requests: ReadingRequest[];
  try {
    requests = readingRequestsSchema.parse(JSON.parse(raw));
  } catch {
    return Response.json({ error: "Invalid resource keys" }, { status: 400 });
  }
  const requested = new Map(requests.map((value) => [readingKey(value), value]));
  const encoder = new TextEncoder();
  const pending = new Map<string, Uint8Array>();
  const ready = new Set<string>();
  const world: Uint8Array[] = [];
  let dropped: number | null = null;
  let gap = false;
  let closed = false;
  let demand: (() => void) | undefined;
  let stalled: ReturnType<typeof setTimeout> | undefined;
  const releases: Array<() => void> = [];
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const encode = (frame: ReadingFrame) => encoder.encode(`data: ${JSON.stringify(frame)}\n\n`);
  const rejected = new Map(
    [...requested.keys()].map((key) => [
      key,
      encode({
        kind: "failure",
        key,
        error: "Resource value exceeds the frame limit or cannot be serialized.",
      }),
    ]),
  );
  if ([...rejected.values()].some((bytes) => bytes.byteLength > limits.frameBytes))
    return Response.json(
      { error: "Resource key cannot fit a bounded failure frame" },
      { status: 400 },
    );
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(stalled);
    request.signal.removeEventListener("abort", abort);
    for (const release of releases.splice(0)) release();
    pending.clear();
    ready.clear();
    world.length = 0;
    demand?.();
    demand = undefined;
  };
  const abort = () => {
    close();
    controller.error(Error("Resource connection closed"));
  };
  const drain = () => {
    if (closed) return;
    if (demand && ready.size) {
      const key = ready.values().next().value!;
      ready.delete(key);
      let bytes: Uint8Array;
      if (requested.get(key)?.kind === "world") {
        if (gap) {
          bytes = encode({ kind: "gap", key, dropped });
          gap = false;
          dropped = 0;
        } else bytes = world.shift()!;
        if (world.length || gap) ready.add(key);
      } else {
        bytes = pending.get(key)!;
        pending.delete(key);
      }
      const pulled = demand;
      demand = undefined;
      clearTimeout(stalled);
      stalled = undefined;
      controller.enqueue(bytes);
      // The next pull acknowledges that the downstream writer accepted this frame.
      stalled = setTimeout(abort, limits.stallMs);
      pulled();
    }
    if (ready.size && !stalled) stalled = setTimeout(abort, limits.stallMs);
  };
  const publish = (frame: ReadingFrame) => {
    if (closed || !requested.has(frame.key)) return;
    let bytes = rejected.get(frame.key)!;
    try {
      const encoded = encode(frame);
      if (encoded.byteLength <= limits.frameBytes) bytes = encoded;
    } catch {
      // A bad owner value fails only this key; healthy resources keep the same connection.
    }
    try {
      if (requested.get(frame.key)?.kind === "world") {
        if (frame.kind === "gap") {
          gap = true;
          dropped = frame.dropped;
        } else {
          if (world.length === limits.worldEvents) {
            world.shift();
            gap = true;
            dropped = (dropped ?? 0) + 1;
          }
          world.push(bytes);
        }
      } else pending.set(frame.key, bytes);
      ready.add(frame.key);
      drain();
    } catch {
      abort();
    }
  };
  const body = new ReadableStream<Uint8Array>(
    {
      start(ctl) {
        controller = ctl;
        request.signal.addEventListener("abort", abort, { once: true });
        if (request.signal.aborted) {
          abort();
          return;
        }
        for (const [key, value] of requested) {
          if (closed) break;
          if (value.kind === "world") publish({ kind: "gap", key, dropped: null });
          try {
            const release = observe(value, publish);
            if (closed) release();
            else releases.push(release);
          } catch (error) {
            publish({ kind: "failure", key, error: String(error) });
          }
        }
      },
      pull() {
        clearTimeout(stalled);
        stalled = undefined;
        return new Promise<void>((resolve) => {
          demand = resolve;
          drain();
        });
      },
      cancel() {
        close();
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
