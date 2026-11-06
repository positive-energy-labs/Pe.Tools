/**
 * The per-document change mark, held by the host. Revit's `document-changed` event names the
 * documents that changed (`changedOpenIds`); this holds, per exact open document, when the last
 * one arrived on the host's own clock. Freshness is that mark against when the host served a
 * Reading — never a timer, never an age.
 *
 * A detached bridge marks the whole session at the moment we went blind: nothing can be known
 * about a model we are not attached to, so every Reading taken before that moment is changed until
 * it is read again.
 */
import { Clock, Context, Effect, Layer, Schema } from "effect";
import type { DoorFailure } from "@pe/host-internal/request-contracts";
import { BridgeError, RevitBridge } from "./bridge.ts";
import { canonicalJson } from "@pe/host-internal/native-read";
import { InvalidRead } from "./native-reads.ts";
import {
  captureInput,
  inputBindingKey,
  replayInput,
  type RecordingReader,
  type RecordingWriter,
  type TakingObserver,
} from "./native-recording.ts";

export interface DocumentRef {
  readonly session: string;
  readonly openId: string;
}

export interface DocumentMarks {
  /** Earliest read this host can judge against its own observed change events. */
  readonly observedSince?: number;
  /** When this exact open document last changed in Revit, or null while it never has. */
  readonly changedAt: (ref: DocumentRef) => number | null;
  /** Host-observed event generation; two changes in one clock millisecond remain distinct. */
  readonly generation?: (ref: DocumentRef) => number;
  /** Fires whenever any mark moves. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Resolves once every event the host has received so far is reflected in the marks; a fake has none pending. */
  readonly settled?: () => Promise<void>;
}

/** The marks one reading consumed for one document, exactly as the holder answered them. */
export interface MarkSnapshot {
  readonly generation?: number;
  readonly observedSince?: number;
  readonly changedAt: number | null;
}
const markSnapshot = Schema.Struct({
  generation: Schema.optionalKey(Schema.Number),
  observedSince: Schema.optionalKey(Schema.Number),
  changedAt: Schema.NullOr(Schema.Number),
});
const markFrame = Schema.Struct({ marks: markSnapshot, servedAt: Schema.Number });

/** The host's marks: the synchronous holder plus the one explicit boundary a recording can keep. */
export interface HostMarks extends DocumentMarks {
  /** The holder's current marks for `ref`; the capture and replay boundary for a reading's freshness. */
  readonly snapshot: (ref: DocumentRef) => Effect.Effect<MarkSnapshot, DoorFailure>;
  /**
   * The marks one served frame is compared against, with that frame's comparison time captured
   * once: the source's own `servedAt` when the frame has one, else the Clock when it is consumed.
   * Later mark updates compare against this time, never a newer one.
   */
  readonly readFrame: (
    ref: DocumentRef,
    frameKey: string,
    servedAt?: number,
  ) => Effect.Effect<MarkFrame, DoorFailure>;
}
export interface MarkFrame {
  readonly marks: MarkSnapshot;
  readonly servedAt: number;
}
/** A synchronous holder with its snapshot read straight from it, at the moment of the call. */
export const hostMarks = (marks: DocumentMarks): HostMarks => {
  const snapshot = (ref: DocumentRef) =>
    Effect.sync(
      (): MarkSnapshot => ({
        ...(marks.observedSince === undefined ? {} : { observedSince: marks.observedSince }),
        changedAt: marks.changedAt(ref),
        ...(marks.generation ? { generation: marks.generation(ref) } : {}),
      }),
    );
  return {
    ...marks,
    snapshot,
    readFrame: (ref, _frameKey, servedAt) =>
      Effect.gen(function* () {
        const at = servedAt ?? (yield* Clock.currentTimeMillis);
        return { marks: yield* snapshot(ref), servedAt: at };
      }),
  };
};

/** The one refusal an apply over a newer change mark gets. */
export const STALE_READ = "This read is no longer verified against Revit; read again, then apply.";

/** An apply rests on the read taken at `takenAt`; a later mark on its document refuses it undispatched. */
export function assertFresh(marks: DocumentMarks, ref: DocumentRef, takenAt: string | null): void {
  const at = takenAt === null ? Number.NaN : Date.parse(takenAt);
  if (!Number.isFinite(at) || (marks.observedSince ?? 0) > at || (marks.changedAt(ref) ?? 0) > at)
    throw new BridgeError(STALE_READ, 409, { notDispatched: true });
}

/** The one refusal a sealed write gets when its document's mark moved after the plan. */
export const PLAN_CHANGED =
  "Plan changed (documentMark): Revit changed this document after the plan; plan the current Work again.";

/**
 * A sealed write rests on the mark its plan sealed. Waits for events already received but still
 * being applied (the tail awaits `bridge.list`), so a received change cannot hide behind the cache.
 * Ceiling: a change Revit has not yet reported to the host is invisible here.
 */
export async function assertSealed(
  marks: DocumentMarks,
  ref: DocumentRef,
  sealed: { observedSince: number | null; changedAt: number | null },
): Promise<void> {
  await marks.settled?.();
  if (
    (marks.observedSince ?? null) !== sealed.observedSince ||
    marks.changedAt(ref) !== sealed.changedAt
  )
    throw new BridgeError(PLAN_CHANGED, 409, { notDispatched: true });
}

/**
 * The host's one marks holder, fed by the bridge tap: the Reading observer and every apply share
 * it. `session` is whichever id a Target names: marks are recorded under both the broker session
 * id and the pe-revit session id the payload reported. Time is the layer's `Clock`; closing the
 * layer's scope unsubscribes from the bridge.
 */
export class HostDocumentMarks extends Context.Service<HostDocumentMarks, HostMarks>()(
  "pe/DocumentMarks",
) {
  static readonly layer = Layer.effect(
    HostDocumentMarks,
    Effect.gen(function* () {
      const bridge = yield* RevitBridge;
      const clock = yield* Clock.Clock;
      const marks = new Map<string, Map<string, number>>();
      const generations = new Map<string, number>();
      let generation = 0;
      const listeners = new Set<() => void>();
      let tail = Promise.resolve();
      const unsubscribe = bridge.subscribe((event) => {
        const atMs = clock.currentTimeMillisUnsafe();
        tail = tail
          .then(async () => {
            // effect-edge: island, phase 5
            const sessions = await Effect.runPromise(bridge.list);
            const ids = (session: (typeof sessions)[number]) =>
              [session.sessionId, session.sdkSessionId].filter((id): id is string => !!id);
            const alive = new Set(sessions.flatMap(ids));
            let changed = false;
            for (const session of marks.keys())
              if (!alive.has(session)) {
                changed = marks.delete(session) || changed;
                for (const key of generations.keys()) if (JSON.parse(key)[0] === session) generations.delete(key);
              }
            const current = sessions.find((session) => session.sessionId === event.sessionId);
            const openIds: unknown =
              event.kind === "disconnected"
                ? [""]
                : event.kind === "event" &&
                    event.eventName === "document-changed" &&
                    event.payloadJson
                  ? (JSON.parse(event.payloadJson) as { changedOpenIds?: unknown }).changedOpenIds
                  : [];
            if (current && Array.isArray(openIds) && openIds.length) {
              const next = ++generation;
              for (const session of ids(current)) {
                const documents = marks.get(session) ?? new Map<string, number>();
                for (const openId of openIds) {
                  documents.set(String(openId), atMs);
                  generations.set(JSON.stringify([session, String(openId)]), next);
                }
                marks.set(session, documents);
              }
              changed = true;
            }
            if (changed) for (const listener of listeners) listener();
          })
          .catch((error) => {
            console.error("document-marks: asynchronous operation failed", error);
            return undefined;
          });
      });
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
      return hostMarks({
        observedSince: clock.currentTimeMillisUnsafe(),
        changedAt: (ref) =>
          Math.max(
            marks.get(ref.session)?.get(ref.openId) ?? 0,
            marks.get(ref.session)?.get("") ?? 0,
          ) || null,
        generation: ref => Math.max(generations.get(JSON.stringify([ref.session, ref.openId])) ?? 0, generations.get(JSON.stringify([ref.session, ""])) ?? 0),
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        settled: () => tail,
      });
    }),
  );
  /**
   * The live holder, each snapshot and frame kept as a taking of exactly the values it answered,
   * for exactly that ref (and frame), at the moment the reading asked. The synchronous accessors
   * stay the live holder's.
   */
  static readonly capturing = (writer: RecordingWriter, observed?: TakingObserver) =>
    Layer.effect(
      HostDocumentMarks,
      Effect.map(
        Effect.service(HostDocumentMarks),
        (live): HostMarks => ({
          ...live,
          snapshot: (ref) =>
            captureInput(
              writer,
              marksInput(ref, null),
              scopeOf(ref),
              markSnapshot,
              live.snapshot(ref),
              observed,
            ),
          readFrame: (ref, frameKey, servedAt) =>
            captureInput(
              writer,
              marksInput(ref, frameKey),
              scopeOf(ref),
              markFrame,
              live.readFrame(ref, frameKey, servedAt),
              observed,
            ),
        }),
      ),
    );
  /**
   * Recorded marks only: `snapshot` and `readFrame` replay the exact recorded values (and frame
   * time) for that ref, under the root's explicit binding when one is given. No clock, no bridge,
   * nothing moves. The synchronous accessors have no recorded answer, so they refuse rather than
   * invent one.
   */
  static readonly recorded = (
    reader: RecordingReader,
    bindings: ReadonlyMap<string, string> = new Map(),
  ) => {
    const unrecorded = () => {
      throw new InvalidRead({
        message: "A recording answers document marks only through snapshot(ref) or readFrame",
        status: 409,
        problem: "recording.miss",
      });
    };
    const replay = <A, I>(ref: DocumentRef, frame: string | null, codec: Schema.Codec<A, I>) => {
      const input = marksInput(ref, frame);
      return replayInput(
        reader,
        input,
        scopeOf(ref),
        codec,
        bindings.get(inputBindingKey(input, scopeOf(ref))),
      );
    };
    return Layer.succeed(HostDocumentMarks, {
      get observedSince(): number {
        return unrecorded();
      },
      changedAt: unrecorded,
      subscribe: () => () => {},
      snapshot: (ref) => replay(ref, null, markSnapshot),
      readFrame: (ref, frameKey, servedAt) =>
        Effect.flatMap(replay(ref, frameKey, markFrame), (frame) =>
          servedAt === undefined || servedAt === frame.servedAt
            ? Effect.succeed(frame)
            : Effect.fail(
                new InvalidRead({
                  message: `Frame ${frameKey} was served at ${frame.servedAt}, not ${servedAt}`,
                  status: 409,
                  problem: "recording.mismatch",
                }),
              ),
        ),
    } satisfies HostMarks);
  };
  /** Tests only: a host that observes no Revit, so nothing ever changes. Never a production fallback. */
  static readonly none = Layer.succeed(
    HostDocumentMarks,
    hostMarks({ changedAt: () => null, subscribe: () => () => {} }),
  );
}

const marksInput = (ref: DocumentRef, frame: string | null) =>
  ({ kind: "marks", ref: { session: ref.session, openId: ref.openId }, frame }) as const;
const scopeOf = (ref: DocumentRef) => canonicalJson({ session: ref.session, openId: ref.openId });
