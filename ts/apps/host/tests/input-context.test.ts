import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Layer } from "effect";
import { afterEach, expect, test } from "vite-plus/test";
import { HostNativeRead } from "@pe/host-internal/native-read";
import { sourceProvenanceSchema } from "@pe/agent-contracts";
import { HostInputContext, type InputUse } from "../src/input-context.ts";
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

test("a recording lane decides from the generated catalogs: only a covered native Read is served", async () => {
  const { check, source } = await context(await recording());
  const decisions = (
    [
      { kind: "native", key: "host.ops.catalog" },
      { kind: "native", key: "revit.matrix.loaded-families" },
      { kind: "native", key: "ducts.apply" },
      { kind: "native", key: "scripting.execute" },
      { kind: "native", key: "no.such.op" },
      { kind: "command", key: "families.apply.preview" },
      { kind: "command", key: "ducts.plan-losses" },
      { kind: "command", key: "ducts.apply-losses" },
      { kind: "input", input: "native" },
      { kind: "input", input: "work" },
      { kind: "work", verb: "undo" },
      { kind: "recording", verb: "bind-point" },
    ] satisfies InputUse[]
  ).map((use) => problem(check(use)));
  expect(decisions).toEqual([
    null,
    null, // a native Read whose rolled-back transaction answer was recorded
    "recording.historical", // ModelWrite
    "recording.historical", // scripts are writes in the catalog, whatever a client claims
    "read.contract",
    "recording.historical", // a TransactRead rehearsal command
    "recording.coverage", // a plan needs Work, files and metadata a native bundle lacks
    "recording.historical",
    null,
    "recording.coverage",
    "recording.historical",
    "recording.historical",
  ]);
  // The browser projection is the bounded provenance, never the opened store.
  expect(sourceProvenanceSchema.parse(source)).toEqual({
    kind: "recording",
    at: "2030-01-01T00:00:00.000Z",
    build: "build-1",
    catalog: identity.catalog,
    coverage: ["native"],
  });
});

test("live keeps its admission; a sourceless host fixture refuses and never builds live", async () => {
  expect((await context({ kind: "live" })).check({ kind: "work", verb: "edit" })).toBeNull();
  const fixture: HostInputLane = { kind: "fixture", name: "fans-demo" };
  expect(problem((await context(fixture)).check({ kind: "native", key: "host.ops.catalog" }))).toBe(
    "recording.fixture",
  );
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
