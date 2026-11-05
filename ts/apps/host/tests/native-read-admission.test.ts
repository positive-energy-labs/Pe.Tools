/**
 * HostNativeRead admits each call for its own caller before the shared native join. These are the
 * refusals a flight must not paper over; join/terminal/cancel semantics stay in native-read-sharing.
 */
import { Effect, Layer } from "effect";
import { expect } from "vite-plus/test";
import type { Caller } from "@pe/agent-contracts";
import { HostNativeRead } from "@pe/host-internal/native-read";
import type {
  PreparedRead,
  RequestIdentity as IdentityKey,
} from "@pe/host-internal/request-contracts";
import { effectTest } from "./effect-test.ts";
import { HostNativeReadLive } from "../src/native-read.ts";
import { NativeReads } from "../src/native-reads.ts";
import {
  admittedRequestIdentity,
  ReadFreshness,
  RequestIdentity,
} from "../src/request-services.ts";
import { SdkSession } from "../src/sdk-session.ts";

const pea: Caller = { kind: "pea", thread: "t1" } as Caller;

function world(processId = 7, active: string[] = ["doc-A"]) {
  const joined: PreparedRead<unknown>[] = [];
  const session = {
    sessionId: "bridge-1",
    processId,
    processStartUtcUnixMs: 1_000,
    state: {
      openDocuments: ["doc-A", "doc-B"].map((openId) => ({
        openId,
        isActive: active.includes(openId),
        isFamilyDocument: false,
      })),
    },
  };
  const layer = HostNativeReadLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        ReadFreshness.layer,
        Layer.succeed(SdkSession, {
          resolve: () => Effect.succeed(session as never),
          resolveAttachment: () => Effect.succeed(session as never),
        }),
        Layer.succeed(NativeReads, {
          join: (read) =>
            Effect.sync(() => {
              joined.push(read as PreparedRead<unknown>);
              return { value: {}, nativeRequestId: "native-1" } as never;
            }),
          retained: Effect.succeed({ entries: 0, joiners: 0 }),
        }),
      ),
    ),
  );
  const as =
    (caller: Caller) =>
    <A, E>(effect: Effect.Effect<A, E, IdentityKey | HostNativeRead>) =>
      effect.pipe(
        Effect.provideService(RequestIdentity, admittedRequestIdentity(caller, {})),
        Effect.provide(layer),
      );
  return { joined, as };
}

const read = (key: string, input: unknown = {}, openDocumentId?: string) =>
  Effect.flatMap(Effect.service(HostNativeRead), (reads) =>
    reads.read({ key, input, scope: { openDocumentId } }),
  );
const resolve = (key: string, openDocumentId?: string) =>
  Effect.flatMap(Effect.service(HostNativeRead), (reads) =>
    reads.resolve({ key, input: {}, scope: { openDocumentId } }),
  );
const tag = <A, E extends { _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.map(() => "admitted"),
    Effect.catch((error: E) => Effect.succeed(error._tag)),
  );

effectTest(
  "each call is admitted for its own caller before the join; an anonymous caller refuses",
  () =>
    Effect.gen(function* () {
      const { joined, as } = world();
      expect(yield* as(pea)(tag(read("host.ops.catalog")))).toBe("admitted");
      expect(yield* as({ kind: "anonymous" })(tag(read("host.ops.catalog")))).toBe("Refused");
      expect(joined).toHaveLength(1);
    }),
);

effectTest("unknown keys, writes and malformed input refuse before any native join", () =>
  Effect.gen(function* () {
    const { joined, as } = world();
    for (const key of ["nope.key", "data-table.apply", "scripting.execute", "op.cancel"])
      expect(yield* as(pea)(tag(read(key)))).toBe("InvalidRequest");
    expect(yield* as(pea)(tag(read("settings.schema", "not an object", "doc-A")))).toBe(
      "InvalidRequest",
    );
    expect(joined).toEqual([]);
  }),
);

effectTest("process and document lifetimes separate reads; an ambiguous document refuses", () =>
  Effect.gen(function* () {
    const first = yield* world(7).as(pea)(resolve("ducts.snapshot.roster", "doc-A"));
    const restarted = yield* world(8).as(pea)(resolve("ducts.snapshot.roster", "doc-A"));
    const other = yield* world(7).as(pea)(resolve("ducts.snapshot.roster", "doc-B"));
    expect(first.processIncarnation).not.toEqual(restarted.processIncarnation);
    expect(first.openDocumentLifetime).toEqual({ openId: "doc-A" });
    expect(other.openDocumentLifetime).toEqual({ openId: "doc-B" });
    const ambiguous = world(7, ["doc-A", "doc-B"]);
    expect(yield* ambiguous.as(pea)(tag(read("ducts.snapshot.roster")))).not.toBe("admitted");
    expect(ambiguous.joined).toEqual([]);
  }),
);
