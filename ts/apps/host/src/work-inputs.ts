/**
 * Work as a host input (ADR 0031): the exact RouteWorkspace read each body consumes, its recorded
 * identity, and its authoritative codec. Live reads the canonical workspace; capture and replay go
 * through the one taking store (`captureInput`/`replayInput`), never a second Work store.
 */
import { Effect, Schema } from "effect";
import { z } from "zod";
import {
  workHandleSchema,
  workKey,
  workWriteAckSchema,
  type WorkHandle,
  type WorkKey,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import type { DoorFailure } from "@pe/host-internal/request-contracts";
import type { RouteWorkspace } from "@pe/runtime";
import { InvalidRead } from "./native-reads.ts";

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

const failed = (view: WorkView, error: unknown) =>
  new InvalidRead({ message: `Work ${view} failed: ${String(error)}`, status: 503, problem: "work.read" });

/** The connected live port: exactly the canonical read each view names, on the key's own route. */
export const liveWorkInput = <V extends WorkView>(
  workspace: RouteWorkspace,
  key: WorkKey,
  view: V,
): Effect.Effect<WorkValue<V>, DoorFailure> => {
  if (view === "feed")
    // One acquisition on the workspace's write tail; the live ack listener is released at once.
    return Effect.callback<WorkValue<V>, DoorFailure>((resume) => {
      const stop = workspace.observeFeed(
        key,
        (snapshot) => {
          stop();
          resume(Effect.succeed(snapshot as WorkValue<V>));
        },
        () => {},
        (error) => resume(Effect.fail(failed(view, JSON.stringify(error) ?? error))),
      );
      return Effect.sync(stop);
    });
  const read = { read: "read", raw: "readRaw", view: "view" } as const;
  return Effect.tryPromise({
    try: () => workspace[read[view as Exclude<WorkView, "feed">]](key, key.route),
    catch: (error) => failed(view, error),
  }) as Effect.Effect<WorkValue<V>, DoorFailure>;
};
