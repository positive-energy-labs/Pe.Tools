import {
  READING_MAX_FRAME_BYTES,
  READING_MAX_REQUEST_BYTES,
  readingKey,
  readingRequestsSchema,
  type ReadingFrame,
  type ReadingRequest,
  type ThreadHead,
} from "@pe/agent-contracts";
import type { RouteWorkspace } from "./route-workspace.ts";
import type { OwnerValue } from "./owner-read.ts";

/** Who answers the `thread-head` Reading: the host's harness thread store. */
export interface ThreadHeadSource {
  observe(threadId: string, listener: (value: OwnerValue<ThreadHead>) => void): () => void;
}

/** `after` is the connection's host log cursor (absent: none); only log-backed Readings read it. */
export type ResourceObserver = (
  request: ReadingRequest,
  publish: (frame: ReadingFrame) => void,
  after?: number | null,
) => () => void;
export const resourceSnapshot = (key: string, result: OwnerValue<unknown>): ReadingFrame =>
  "error" in result
    ? { kind: "failure", key, error: result.error }
    : { kind: "snapshot", key, value: result.value };

export function observeResources(
  work: RouteWorkspace,
  heads: ThreadHeadSource,
  host?: ResourceObserver,
): ResourceObserver {
  return (request, publish, after) => {
    const key = readingKey(request);
    const accept = (value: OwnerValue<unknown>) => publish(resourceSnapshot(key, value));
    if (request.kind === "work") return work.observe(request, request.route, accept);
    if (request.kind === "thread-head") return heads.observe(request.thread, accept);
    if (request.kind === "work-acks")
      return work.observeAccepted(request.work, (ack) =>
        publish({ kind: "event", key, value: ack }),
      );
    if (host) return host(request, publish, after);
    publish({ kind: "failure", key, error: `Resource '${request.kind}' is unavailable` });
    return () => {};
  };
}

/** The pseudo-key of the one host log lane in the ready set. */
const LOG = "\u0000log";

/**
 * One bounded connection mailbox. Producers only offer; they never await the socket. Snapshot keys
 * keep their latest frame; `world` and `work-acks` keep a bounded tail per key with gap frames; host log frames (those
 * carrying an `id`) share one lane in id order, and a reader that falls `logFrames` behind loses
 * the connection: it reconnects from its cursor and the durable log replays what it missed.
 */
export function resourceResponse(
  request: Request,
  observe: ResourceObserver,
  limits = {
    frameBytes: READING_MAX_FRAME_BYTES,
    worldEvents: 64,
    // One Work's retained window is 100 writes (`RouteWorkspace.observeAccepted`); replay must fit.
    workAckEvents: 128,
    stallMs: 10_000,
    logFrames: 4096,
  },
): Response {
  const url = new URL(request.url);
  const raw = url.searchParams.get("keys") ?? "";
  const cursor = url.searchParams.get("after") ?? request.headers.get("last-event-id");
  const after = cursor === null || cursor === "" ? null : Number(cursor);
  if (after !== null && !(Number.isSafeInteger(after) && after >= 0))
    return Response.json({ error: "Invalid resource cursor" }, { status: 400 });
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
  const tails = new Map<string, { frames: Uint8Array[]; gap: boolean; dropped: number | null }>();
  const tailLimit = (key: string) => {
    const kind = requested.get(key)?.kind;
    return kind === "world" ? limits.worldEvents : kind === "work-acks" ? limits.workAckEvents : 0;
  };
  const lane: Uint8Array[] = [];
  let closed = false;
  let demand: (() => void) | undefined;
  let stalled: ReturnType<typeof setTimeout> | undefined;
  const releases: Array<() => void> = [];
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const encode = (frame: ReadingFrame) =>
    encoder.encode(
      `${"id" in frame && frame.id !== undefined ? `id: ${frame.id}\n` : ""}data: ${JSON.stringify(frame)}\n\n`,
    );
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
    tails.clear();
    lane.length = 0;
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
      if (key === LOG) {
        bytes = lane.shift()!;
        if (lane.length) ready.add(LOG);
      } else if (tailLimit(key)) {
        const tail = tails.get(key)!;
        if (tail.gap) {
          bytes = encode({ kind: "gap", key, dropped: tail.dropped });
          tail.gap = false;
          tail.dropped = 0;
        } else bytes = tail.frames.shift()!;
        if (tail.frames.length || tail.gap) ready.add(key);
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
      if ("id" in frame && frame.id !== undefined) {
        if (lane.length === limits.logFrames) return abort();
        lane.push(bytes);
        ready.add(LOG);
        return drain();
      } else if (tailLimit(frame.key)) {
        const tail = tails.get(frame.key) ?? { frames: [], gap: false, dropped: null };
        tails.set(frame.key, tail);
        if (frame.kind === "gap") {
          tail.gap = true;
          tail.dropped = frame.dropped;
        } else {
          if (tail.frames.length === tailLimit(frame.key)) {
            tail.frames.shift();
            tail.gap = true;
            tail.dropped = (tail.dropped ?? 0) + 1;
          }
          tail.frames.push(bytes);
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
            const release = observe(value, publish, after);
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
