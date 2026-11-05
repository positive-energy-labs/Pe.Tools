import type { ReadingRequest } from "@pe/agent-contracts";
import type { Readings } from "../readings";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { Immutable } from "../../../../packages/agent-contracts/src/route-kernel-data";
import { z } from "zod";
import {
  contentHash,
  openSource,
  type DeriveSource,
  type ReadingContext,
  type ReadingPublication,
  type ReadingSource,
  type UseSource,
} from "./readings";

/** A demand attempt's context: no Page or Work, only its target, attempt generation and args. */
export const demandContext = (
  target: ReadingContext["target"],
  generation: number,
  args: unknown,
  signal: AbortSignal,
): ReadingContext => ({
  target,
  workKey: null,
  workRevision: null,
  page: {},
  work: null,
  attempt: { target, workKey: null, generation },
  trigger: { kind: "demand" },
  args,
  inputs: {},
  signal,
});

/**
 * The one source-attempt lifecycle: admitted route readings and shell hook subjects both open
 * sources here. It maps frames to `ReadingSnapshot`, keeps the last value through pending, stale
 * and failure, and closes the source once. The caller owns `context.signal`; aborting it ends delivery.
 * `live`: silence past `waitS` fails the subject (stale if it holds a value); a failure holds until an answer.
 */
export function openSourceReading<T>(
  source: Exclude<ReadingSource<T>, DeriveSource<T>>,
  context: ReadingContext,
  deliver: (snapshot: ReadingSnapshot<T>) => void,
  options: { observe?(log: unknown): void; live?: { waitS: number; onTimeout?(): void } } = {},
): () => void {
  let value: Immutable<T> | undefined;
  const live = options.live;
  let failed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const held = (status: "pending" | "unavailable" | "failed", reason: string, kept = value) =>
    ({ status, current: false, value: kept, reason }) as ReadingSnapshot<T>;
  const disarm = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const arm = () => {
    if (!live || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (value !== undefined) return emit(held("unavailable", "Reading is stale"));
      failed = true;
      live.onTimeout?.();
      emit(
        held("failed", `Source sent no answer after ${live.waitS}s; explicitly refresh to retry`),
      );
    }, live.waitS * 1000);
  };
  const emit = (snapshot: ReadingSnapshot<T>) => {
    if (context.signal.aborted) return;
    if (snapshot.value !== undefined) value = snapshot.value;
    deliver(snapshot);
  };
  let [closed, release] = [false, undefined as (() => void) | undefined];
  openSource(
    source,
    context,
    (frame) => {
      if (context.signal.aborted) return;
      if (live && frame.kind !== "log") {
        // A live subject's failure is said until its next answer; silence re-arms the deadline.
        if (failed && (frame.kind === "pending" || frame.kind === "stale")) return;
        failed = frame.kind === "failure";
        if (failed || (frame.kind === "complete" && frame.fresh !== false)) disarm();
        else arm();
      }
      const sent = (frame as { value?: unknown }).value as Immutable<T>;
      switch (frame.kind) {
        case "part":
          return emit(held("pending", "Reading incomplete", sent));
        case "complete":
          return emit(
            frame.fresh === false
              ? held("unavailable", "Reading is stale", sent)
              : {
                  status: "ready",
                  current: true,
                  value: sent,
                  hash: z.string().parse(contentHash(sent)),
                },
          );
        case "pending":
          return emit(held("pending", "Reading pending"));
        case "stale":
          return emit(held("unavailable", "Reading is stale"));
        case "failure":
          return emit(held("failed", String(frame.error)));
        case "log":
          options.observe?.(frame.value);
      }
    },
    // A release arriving after close runs at once: each source closes exactly once.
    (next) => (next && closed ? next() : (release = next || release)),
  );
  // A transport may replay a current cached answer inside open(); its complete frame already
  // disarmed the deadline. Pending/stale frames arm their own timer above.
  if (value === undefined && !failed) arm();
  return () => {
    if (closed) return;
    closed = true;
    disarm();
    release?.();
  };
}

/** Acquire one fresh result, retiring its lease before a caller can acquire the next batch. */
export function acquireSource<T>(source: UseSource<T>, context: ReadingContext) {
  type Complete = Extract<ReadingPublication<T>, { kind: "part" | "complete" }>;
  let release: void | (() => void);
  let settled = false;
  const close = () => {
    const own = release;
    release = undefined;
    own?.();
  };
  let abort = () => {};
  let deliver!: (event: ReadingPublication<T>) => void;
  const result = new Promise<Complete>((resolve, reject) => {
    abort = () => {
      settled = true;
      reject(context.signal.reason);
    };
    deliver = (event) => {
      if (settled) return;
      if (event.kind === "failure") {
        settled = true;
        reject(event.error);
      } else if (event.kind === "complete" && event.fresh !== false) {
        settled = true;
        resolve(event);
      }
    };
  });
  context.signal.addEventListener("abort", abort, { once: true });
  const opened = Promise.resolve()
    .then(() => {
      context.signal.throwIfAborted();
      return source.open(context, deliver);
    })
    .then((own) => {
      release = own;
      if (settled) close();
    });
  return Promise.all([opened, result])
    .then(([, value]) => value)
    .finally(() => {
      settled = true;
      close();
      context.signal.removeEventListener("abort", abort);
    });
}

/** Uses the existing acquisition door. Decoding stays typed and source-owned; no second transport. */
export function subscriptionSource<T>(options: {
  request(context: ReadingContext): ReadingRequest;
  decode(value: unknown): T;
  resources?: Readings;
  kind?: "use" | "feed";
  /** A feed can fold its ordered events while sending the same events to the route log. */
  fold?(previous: T | undefined, event: unknown): T;
  dirties?: readonly string[];
}): UseSource<T> {
  return {
    kind: options.kind ?? "use",
    dirties: options.dirties,
    async open(context, deliver) {
      // Lazy import keeps the graph React-free and construction free of browser/service effects.
      const resources = options.resources ?? (await import("../readings")).peReadings;
      if (context.signal.aborted) return;
      let revision = 0;
      let value: T | undefined;
      let lastEvent = -1;
      let fresh = true;
      return resources.subscribe(options.request(context), (frame) => {
        if (frame.kind === "snapshot") {
          try {
            value = options.decode(frame.value);
            fresh = !frame.stale && !frame.changed;
            deliver({
              kind: "complete",
              value,
              revision: ++revision,
              fresh,
            });
          } catch (error) {
            deliver({ kind: "failure", error });
          }
        } else if (frame.kind === "failure") {
          fresh = false;
          if (frame.stale) deliver({ kind: "stale" });
          else deliver({ kind: "failure", error: frame.error });
        } else if (frame.kind === "event" && options.kind === "feed") {
          if (frame.id !== undefined && frame.id <= lastEvent) return;
          if (frame.id !== undefined) lastEvent = frame.id;
          try {
            value = options.fold ? options.fold(value, frame.value) : options.decode(frame.value);
            deliver({
              kind: "complete",
              value,
              revision: ++revision,
              fresh: fresh && !frame.stale,
            });
            deliver({ kind: "log", value: frame.value, id: frame.id?.toString() });
          } catch (error) {
            deliver({ kind: "failure", error });
          }
        } else if (frame.kind === "stale" || frame.kind === "gap") {
          fresh = false;
          deliver({ kind: "stale" });
        }
      });
    },
  };
}
