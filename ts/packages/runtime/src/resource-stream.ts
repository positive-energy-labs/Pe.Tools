import {
  READING_MAX_FRAME_BYTES,
  READING_MAX_KEYS,
  readingRequestSchema,
  READING_MAX_REQUEST_BYTES,
  readingKey,
  readingRequestsSchema,
  type ReadingFrame,
  type ReadingRequest,
  type ThreadHead,
} from "@pe/agent-contracts";
import {
  workFeedFailureMessage,
  workFeedFailureSchema,
} from "../../agent-contracts/src/work-journal-door.ts";
import type { RouteWorkspace, WorkReadContext, WorkCarriage } from "./route-workspace.ts";
import type { OwnerValue } from "./owner-read.ts";

/** Who answers the `thread-head` Reading: the host's harness thread store. */
export interface ThreadHeadSource {
  observe(threadId: string, listener: (value: OwnerValue<ThreadHead>) => void): () => void;
}

/** `after` is the connection's host log cursor (absent: none); only log-backed Readings read it. */
export type ResourceObserver = (
  request: ReadingRequest,
  publish: (frame: ReadingFrame, carriage?: WorkCarriage) => void,
  after?: number | null,
) => () => void;
export const resourceSnapshot = (key: string, result: OwnerValue<unknown>): ReadingFrame =>
  "error" in result
    ? { kind: "failure", key, error: result.error }
    : { kind: "snapshot", key, value: result.value };

export function observeResources(
  work: RouteWorkspace,
  heads: ThreadHeadSource | undefined,
  host?: ResourceObserver,
  context?: WorkReadContext,
): ResourceObserver {
  return (request, publish, after) => {
    const key = readingKey(request);
    const accept = (value: OwnerValue<unknown>, carriage?: WorkCarriage) => publish(resourceSnapshot(key, value), carriage);
    if ((request.kind === "work" || request.kind === "work-acks") && request.admission) {
      let closed = false;
      let release = () => {};
      const scope = request.kind === "work" ? request : request.work;
      const admission = request.admission;
      let stopAdmission = () => {};
      const refuse = (
        failure: import("../../agent-contracts/src/work-journal-door.ts").WorkFeedFailure,
      ) => {
        if (closed) return;
        closed = true;
        release();
        stopAdmission();
        publish({ kind: "failure", key, error: workFeedFailureMessage(failure), failure });
      };
      stopAdmission = work.observeAdmission(admission.routeKey, () => {
        void work.admitFeed(scope, admission).then((failure) => {
          if (failure) refuse(failure);
        });
      });
      void work.admitFeed(scope, admission).then(
        (failure) => {
          if (closed) return;
          if (failure) return refuse(failure);
          release = work.observeAdmittedFeed(
            scope,
            admission,
            request.kind,
            (value, carriage?: WorkCarriage) => {
              if (!closed) accept(value, carriage);
            },
            (ack) => publish({ kind: "event", key, value: ack }),
            (error) => {
              const typed = workFeedFailureSchema.safeParse(error);
              if (typed.success) return refuse(typed.data);
              if (error instanceof Error && "code" in error && error.code === "WorkUnreadable") {
                const failure = workFeedFailureSchema.parse({ kind: "failed", code: error.code,
                  message: error.message, ...("schemaAge" in error ? { schemaAge: error.schemaAge } : {}) });
                return refuse(failure);
              }
              publish({
                kind: "failure",
                key,
                error: error instanceof Error ? error.message : String(error),
              });
            },
            context,
          );
        },
        (error) => {
          refuse({ kind: "failed", code: "WorkAdmissionFailed", message: String(error) });
        },
      );
      return () => {
        closed = true;
        release();
        stopAdmission();
      };
    }
    if (
      (request.kind === "work" || request.kind === "work-acks") &&
      work.requiresAdmission(request.kind === "work" ? request.route : request.work.route)
    ) {
      const failure = {
        kind: "failed" as const,
        code: "WorkAdmissionRequired",
        message: "Admitted Work requires the route fingerprint",
      };
      publish({ kind: "failure", key, error: failure.message, failure });
      return () => {};
    }
    if (request.kind === "work") return work.observe(request, request.route, accept, false, false, context);
    if (request.kind === "thread-head" && heads) return heads.observe(request.thread, accept);
    if (request.kind === "work-acks")
      return work.observeAccepted(
        request.work,
        (ack) => publish({ kind: "event", key, value: ack }),
        (error) =>
          publish({
            kind: "failure",
            key,
            error: error instanceof Error ? error.message : String(error),
          }),
      );
    if (host) return host(request, publish, after);
    publish({ kind: "failure", key, error: `Resource '${request.kind}' is unavailable` });
    return () => {};
  };
}

// Subscription ownership is host-local and scoped to the same observer as the stream.
const connections = new WeakMap<
  ResourceObserver,
  Map<string, { update: (add: ReadingRequest[], remove: string[], owner: string | null) => Promise<void> }>
>();
/** The host and its borrowed-read proxy admit the same bounded subscription body. */
export function decodeResourceSubscriptionUpdate(raw: string): { add: ReadingRequest[]; remove: string[] } | { error: string } {
  if (new TextEncoder().encode(raw).byteLength > READING_MAX_REQUEST_BYTES)
    return { error: "Resource request is too large" };
  try {
    const value = JSON.parse(raw);
    const add = readingRequestSchema.array().max(READING_MAX_KEYS).parse(value.add);
    if (
      !Array.isArray(value.remove) ||
      value.remove.length > READING_MAX_KEYS ||
      value.remove.some((key: unknown) => typeof key !== "string")
    )
      throw Error("Invalid removals");
    return { add, remove: value.remove as string[] };
  } catch {
    return { error: "Invalid resource keys" };
  }
}
export async function updateResourceSubscriptions(request: Request, observe: ResourceObserver, owner: string | null = null): Promise<Response> {
  const id = new URL(request.url).searchParams.get("connection") ?? "";
  const update = connections.get(observe)?.get(id);
  if (!update) return Response.json({ error: "Reading connection retired" }, { status: 409 });
  const value = decodeResourceSubscriptionUpdate(await request.text());
  if ("error" in value) return Response.json({ error: value.error }, { status: 400 });
  try {
    await update.update(value.add, value.remove, owner);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Invalid resource keys" }, { status: 400 });
  }
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
    // Durable Work replay must not be truncated by the connection mailbox.
    workAckEvents: Infinity,
    stallMs: 10_000,
    logFrames: 4096,
  },
  registryOwner: ResourceObserver = observe,
  onClose?: () => void,
  owner: string | null = null,
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
    requests = !url.searchParams.has("keys") && url.searchParams.get("connection")
      ? [] : readingRequestsSchema.parse(JSON.parse(raw));
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
  const releases = new Map<string, () => void>();
  const connection = url.searchParams.get("connection");
  let registry = connections.get(registryOwner);
  if (!registry) connections.set(registryOwner, (registry = new Map()));
  if (connection && registry.has(connection))
    return Response.json({ error: "Connection already exists" }, { status: 409 });
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
    if (connection) registry!.delete(connection);
    for (const release of releases.values()) release();
    onClose?.();
    releases.clear();
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
    } catch (error) {
      console.warn("ts/packages/runtime/src/resource-stream.ts: fallback after failure", error);
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
        if (!requests.length) controller.enqueue(encoder.encode(": open\n\n"));
        request.signal.addEventListener("abort", abort, { once: true });
        if (request.signal.aborted) {
          abort();
          return;
        }
        const update = (add: ReadingRequest[], remove: string[]) => {
          if (closed) return;
          for (const key of remove) {
            requested.delete(key);
            releases.get(key)?.();
            releases.delete(key);
            pending.delete(key);
            ready.delete(key);
            tails.delete(key);
            rejected.delete(key);
          }
          for (const value of add) {
            const key = readingKey(value);
            if (releases.has(key)) continue;
            requested.set(key, value);
            rejected.set(
              key,
              encode({
                kind: "failure",
                key,
                error: "Resource value exceeds the frame limit or cannot be serialized.",
              }),
            );
            if (value.kind === "world") publish({ kind: "gap", key, dropped: null });
            try {
              const release = observe(value, publish, after);
              if (closed) release();
              else releases.set(key, release);
            } catch (error) {
              publish({ kind: "failure", key, error: String(error) });
            }
          }
        };
        if (connection) registry!.set(connection, { update: async (add, remove, caller) => {
          if (closed) throw Error("Connection is closed");
          if (owner && caller !== owner) throw Error("Foreign reading connection");
          update(add, remove);
        } });
        update([...requested.values()], []);
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
