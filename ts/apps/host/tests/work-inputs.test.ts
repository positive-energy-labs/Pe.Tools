import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Exit, Layer, Schema, Scope } from "effect";
import { afterEach, expect, test } from "vite-plus/test";
import { address, bindWork } from "@pe/agent-contracts";
import { RouteWorkspace, type RouteDocumentStore, type WorkReadSource } from "@pe/runtime";
import { workFingerprintSchema } from "../../../packages/agent-contracts/src/route-kernel-admission.ts";
import { AdmittedBuiltins, admittedBuiltinsLayer } from "../src/admitted-builtins.ts";
import { builtinEnrollments } from "../src/builtin-enrollment.ts";
import {
  nativeCatalogIdentity,
  openRecordingReader,
  openRecordingWriter,
} from "../src/native-recording.ts";
import { capturedWorkReads, recordedWorkSource, workInputCodecs } from "../src/work-inputs.ts";

const dirs: string[] = [];
const scopes: Scope.Closeable[] = [];
afterEach(async () => {
  for (const scope of scopes.splice(0)) await Effect.runPromise(Scope.close(scope, Exit.void));
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const fans = builtinEnrollments.find((entry) => entry.routeKey === "fans")!;
const admission = {
  routeKey: "fans",
  fingerprint: workFingerprintSchema.parse(`builtin-closure:${fans.closure.fingerprint}`),
};
const key = bindWork("fans", address("C:\\Models\\A.rvt"));
const other = bindWork("fans", address("C:\\Models\\B.rvt"));
const identity = { build: "build-1", catalog: nativeCatalogIdentity() };
const bounds = { maxBytes: 1_000_000, maxTakings: 100 };
/** The real builtin Fans admission, held open until the test ends (or `retire` closes it). */
async function admit(workspace: RouteWorkspace) {
  const scope = await Effect.runPromise(Scope.make());
  scopes.push(scope);
  const built = await Effect.runPromise(
    Layer.buildWithScope(admittedBuiltinsLayer(workspace, [fans]), scope),
  );
  expect(Context.get(built, AdmittedBuiltins).routes.has("fans")).toBe(true);
  return () => Effect.runPromise(Scope.close(scope, Exit.void));
}
const memory = (): RouteDocumentStore => {
  const state = new Map<string, unknown>();
  return {
    getState: async ({ targetKey, route }) => structuredClone(state.get(`${targetKey}\0${route}`)),
    setState: async ({ targetKey, route, value }) => {
      state.set(`${targetKey}\0${route}`, structuredClone(value));
    },
  };
};
/** The first delivery of the admitted feed, with every ack seen while it was open. */
const firstFeed = (workspace: RouteWorkspace, shape: "work" | "work-acks") =>
  new Promise<{ value: unknown; acks: unknown[] }>((resolve, reject) => {
    const acks: unknown[] = [];
    const stop = workspace.observeAdmittedFeed(
      key,
      admission,
      shape,
      (value) => {
        stop();
        "error" in value ? reject(value.error) : resolve({ value: value.value, acks });
      },
      (ack) => acks.push(ack),
      reject,
    );
  });

test("a recorded workspace with no store serves the delivered Work, feed and history; it never mutates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-work-inputs-"));
  dirs.push(dir);
  const writer = await Effect.runPromise(openRecordingWriter(dir, identity, bounds));
  const live = new RouteWorkspace({ registrations: [], store: memory(), capture: capturedWorkReads(writer) });
  await admit(live);
  for (const [revision, cfm] of [[0, 250], [1, 300]] as const)
    expect(
      await live.apply(key, "fans", "human", [{ path: ["flows", "4", "edit"], value: { value: { cfm } } }], revision),
    ).toMatchObject({ ok: true });
  const delivered = {
    raw: await live.readRaw(key, "fans"),
    view: JSON.parse(JSON.stringify(await live.view(key, "fans"))),
    feed: (await firstFeed(live, "work-acks")).value,
  };
  expect(delivered.feed).toMatchObject({ revision: 2, history: { from: 1 } });

  const recorded = new RouteWorkspace({
    registrations: [],
    recorded: recordedWorkSource(await Effect.runPromise(openRecordingReader(dir, identity, bounds))),
  });
  await admit(recorded);
  expect(await recorded.readRaw(key, "fans")).toEqual(delivered.raw);
  expect(await recorded.view(key, "fans")).toEqual(delivered.view);
  // Once, with its original handle and history; a recording invents no acks.
  expect(await firstFeed(recorded, "work-acks")).toEqual({ value: delivered.feed, acks: [] });
  // A taking never made is the store's typed miss, never an empty r0 Work.
  await expect(recorded.readRaw(other, "fans")).rejects.toMatchObject({
    _tag: "InvalidRequest",
    problem: "recording.miss",
  });
  // The view-with-history shape was never delivered live; its scope fence refuses the other shape's taking.
  await expect(firstFeed(recorded, "work")).rejects.toMatchObject({ problem: "recording.scope" });
  await expect(
    recorded.apply(key, "fans", "human", [{ path: ["flows", "4", "edit"], value: { value: { cfm: 1 } } }], 2),
  ).rejects.toThrow("recorded workspace refuses Work edit");
  expect(Exit.isSuccess(await Effect.runPromiseExit(Schema.decodeUnknownEffect(workInputCodecs.feed)(delivered.feed)))).toBe(true);
});

test("a recorded feed re-admits after acquisition, and a valid handle for other Work refuses", async () => {
  let release!: (value: unknown) => void;
  const pending = new Promise((resolve) => (release = resolve));
  const live = new RouteWorkspace({ registrations: [], store: memory() });
  const foreign = await live.readRaw(other, "fans").then(async () => {
    await admit(live);
    return live.view(other, "fans");
  });
  const source: WorkReadSource = { read: async () => foreign, feed: () => pending };
  const recorded = new RouteWorkspace({ registrations: [], recorded: source });
  const retire = await admit(recorded);
  await expect(recorded.view(key, "fans")).rejects.toThrow("belongs to another key");
  const feed = firstFeed(recorded, "work-acks");
  await retire(); // the admission retires while the recorded snapshot is still being read
  release({ ...(foreign as object), handle: { key, revision: 0 }, history: { from: 1, acks: [] } });
  await expect(feed).rejects.toMatchObject({ code: "WorkRouteUnregistered" });
});
