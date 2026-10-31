import type { ReadingRequest } from "@pe/agent-contracts";
import type { Readings } from "../readings";
import type { ReadingContext, ReadingPublication, UseSource } from "./readings";

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
