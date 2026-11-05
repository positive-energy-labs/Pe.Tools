import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Layer } from "effect";
import { afterEach, expect, test } from "vite-plus/test";
import { HostNativeRead } from "@pe/host-internal/native-read";
import { HostInputContext } from "../src/input-context.ts";
import { RequestIdentity, admittedRequestIdentity } from "../src/request-services.ts";
import {
  hostNativeReadFor,
  nativeCatalogIdentity,
  openRecordingReader,
  openRecordingWriter,
  type HostInputLane,
} from "../src/native-recording.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const identity = { build: "build-1", catalog: nativeCatalogIdentity() };
const bounds = { maxBytes: 1_000_000, maxTakings: 100 };
const context = (lane: HostInputLane) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* HostInputContext;
    }).pipe(Effect.provide(HostInputContext.layer(lane))),
  );
/** A real native bundle opened read-only, as a recording lane holds it. */
const recording = async (): Promise<HostInputLane> => {
  const dir = await mkdtemp(join(tmpdir(), "pe-input-lane-"));
  dirs.push(dir);
  const reader = await Effect.runPromise(
    openRecordingWriter(dir, identity, bounds).pipe(
      Effect.andThen(openRecordingReader(dir, identity, bounds)),
    ),
  );
  return { kind: "recording", recordingStore: reader, at: "2030-01-01T00:00:00.000Z" };
};
const problem = (refusal: { problem: string } | null) => refusal?.problem ?? null;

test("a recording lane refuses recording metadata writes", async () => {
  const { check } = await context(await recording());
  expect(problem(check({ kind: "recording", verb: "bind-point" }))).toBe("recording.historical");
});

test("live keeps its admission; a sourceless host fixture refuses and never builds live", async () => {
  expect((await context({ kind: "live" })).check({ kind: "work", verb: "edit" })).toBeNull();
  const fixture: HostInputLane = { kind: "fixture", name: "fans-demo" };
  const live = Layer.effect(HostNativeRead, Effect.die("live input acquired"));
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      return yield* (yield* HostNativeRead).read({ key: "host.ops.catalog", input: {}, scope: {} });
    }).pipe(
      Effect.provide(hostNativeReadFor(fixture, live)),
      Effect.provideService(RequestIdentity, admittedRequestIdentity({ kind: "human", via: "local" }, {})),
    ),
  );
  expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("recording.fixture");
});
