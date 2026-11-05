/**
 * Work as a host input (ADR 0031): the exact RouteWorkspace read each body consumes, its recorded
 * identity, and its authoritative codec. The canonical RouteWorkspace reads live, captures what it
 * delivers, or replays through these adapters over the one taking store; never a second Work store.
 */
import { Cause, Effect, Exit, Schema } from "effect";
import { z } from "zod";
import {
  workHandleSchema,
  workKey,
  workWriteAckSchema,
  type WorkHandle,
  type WorkKey,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { canonicalJson } from "@pe/host-internal/native-read";
import type { DoorFailure } from "@pe/host-internal/request-contracts";
import type {
  RouteWorkspace,
  WorkFeedShape,
  WorkReadCapture,
  WorkReadSource,
} from "@pe/runtime";
import type { WorkAdmission } from "../../../packages/agent-contracts/src/work-journal-door.ts";
import {
  captureInput,
  replayInput,
  type RecordingReader,
  type RecordingWriter,
} from "./native-recording.ts";

export type WorkView = "read" | "raw" | "view" | "feed";
/** The Work member of RecordedInput: the canonical Work key and the read shape it names. */
export type WorkInput = { readonly kind: "work"; readonly key: string; readonly view: WorkView };
export const workInput = (key: WorkKey, view: WorkView): WorkInput => ({
  kind: "work",
  key: workKey(key),
  view,
});

/** What the admitted feed acquires: the snapshot and its retained history, as `observeFeed` gives it. */
export type WorkFeedValue = {
  readonly doc: unknown;
  readonly revision: number;
  readonly handle: WorkHandle;
  readonly history: { readonly from: number; readonly acks: readonly WorkWriteAck[] };
};
type Reads = {
  read: Awaited<ReturnType<RouteWorkspace["read"]>>;
  raw: Awaited<ReturnType<RouteWorkspace["readRaw"]>>;
  view: Awaited<ReturnType<RouteWorkspace["view"]>>;
  feed: WorkFeedValue;
};
export type WorkValue<V extends WorkView> = Reads[V];

const revision = z.number().int().nonnegative();
const raw = z.object({ doc: z.unknown(), revision, handle: workHandleSchema })
  .refine((value) => value.revision === value.handle.revision);
// `view`/`read` also carry route, title, schema and schemaVersion; they pass through as recorded.
const shaped = raw.safeExtend({
  route: z.string(), title: z.string(), description: z.string(),
  schemaVersion: z.number().int().positive().nullable(), schema: z.record(z.string(), z.unknown()),
}).refine((value) => value.route === value.handle.key.route).passthrough();
const contracts: { readonly [V in WorkView]: z.ZodType } = {
  raw: raw.nullable(),
  read: shaped.nullable(),
  view: shaped.nullable(),
  feed: raw.safeExtend({ history: z.object({ from: revision, acks: z.array(workWriteAckSchema) }) })
    .refine(({ handle, revision, history }) => history.acks.length
      ? history.acks.every((ack, index) => ack.revision === history.from + index &&
          workKey(ack.key) === workKey(handle.key)) &&
        history.acks.at(-1)!.revision === revision
      : history.from === revision + 1),
};
/** Recorded Work bytes must satisfy the existing Work handle and ack contracts; nothing is coerced. */
const codec = <V extends WorkView>(view: V) =>
  Schema.Json.check(
    Schema.makeFilter(
      (value) => contracts[view].safeParse(value).success || `Recorded Work ${view} violates its contract`,
    ),
  ) as unknown as Schema.Codec<WorkValue<V>, Schema.Json>;
export const workInputCodecs: { readonly [V in WorkView]: Schema.Codec<WorkValue<V>, Schema.Json> } =
  { read: codec("read"), raw: codec("raw"), view: codec("view"), feed: codec("feed") };

/** The fence a Work taking is kept under: its canonical key, plus the feed's exact admission and shape. */
export const workInputScope = (
  key: WorkKey,
  feed?: { readonly admission: WorkAdmission; readonly shape: WorkFeedShape },
) => canonicalJson(feed ? [workKey(key), feed.shape, feed.admission] : [workKey(key)]);

// effect-edge: island, phase 5. RouteWorkspace's Promise read seam meets the Effect taking store
// here; a rejection is the store's own DoorFailure instance, so class and status survive.
const promised = <A>(effect: Effect.Effect<A, DoorFailure>): Promise<A> =>
  Effect.runPromiseExit(effect).then((exit) =>
    Exit.isSuccess(exit) ? exit.value : Promise.reject(Cause.squash(exit.cause)),
  );

/** Historical Work: each canonical read and admitted feed answered only by its recorded taking. */
export const recordedWorkSource = (reader: RecordingReader): WorkReadSource => ({
  read: (key, view) =>
    promised(replayInput(reader, workInput(key, view), workInputScope(key), workInputCodecs[view])),
  feed: (key, admission, shape) =>
    promised(
      replayInput(reader, workInput(key, "feed"), workInputScope(key, { admission, shape }), workInputCodecs.feed),
    ),
});

/** Live capture of the value a Work read is about to deliver, through the one taking store. */
export const capturedWorkReads = (writer: RecordingWriter): WorkReadCapture => {
  const keep = (input: WorkInput, scope: string, value: unknown) =>
    promised(
      captureInput(writer, input, scope, workInputCodecs[input.view], Effect.succeed(json(value) as never)),
    ).then(() => {});
  return {
    read: (key, view, value) => keep(workInput(key, view), workInputScope(key), value),
    feed: (key, admission, shape, value) =>
      keep(workInput(key, "feed"), workInputScope(key, { admission, shape }), value),
  };
};
/** Delivered values carry undefined optionals; their recorded form is their JSON. */
const json = (value: unknown) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));
