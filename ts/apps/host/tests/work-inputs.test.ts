import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Context, Effect, Exit, Layer, Schema, Scope } from "effect";
import { afterEach, expect, test } from "vite-plus/test";
import { address, bindWork } from "@pe/agent-contracts";
import { RouteWorkspace, type RouteDocumentStore, type WorkReadSource } from "@pe/runtime";
import { workFingerprintSchema } from "../../../packages/agent-contracts/src/route-kernel-admission.ts";
import { AdmittedBuiltins, admittedBuiltinsLayer } from "../src/admitted-builtins.ts";
import { builtinEnrollments } from "../src/builtin-enrollment.ts";
import {
  inputBindingKey,
  nativeCatalogIdentity,
  openRecordingReader,
  openRecordingWriter,
  type Taking,
} from "../src/native-recording.ts";
import { InvalidRead } from "../src/native-reads.ts";
import {
  capturedWorkReads,
  recordedWorkSource,
  workFeedCodecs,
  workInput,
  workInputCodecs,
  workInputScope,
  type WorkInputRunner,
} from "../src/work-inputs.ts";

/** The test's explicit Effect edge: a rejection is the DoorFailure itself. */
const run: WorkInputRunner = (effect) =>
  Effect.runPromiseExit(effect).then((exit) =>
    Exit.isSuccess(exit) ? exit.value : Promise.reject(Cause.squash(exit.cause)),
  );
const decodes = async (codec: Schema.Codec<unknown, Schema.Json>, value: unknown) =>
  Exit.isSuccess(await Effect.runPromiseExit(Schema.decodeUnknownEffect(codec)(value)));
const bundle = async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-work-inputs-"));
  dirs.push(dir);
  return { dir, writer: await Effect.runPromise(openRecordingWriter(dir, identity, bounds)) };
};
const reader = (dir: string) => Effect.runPromise(openRecordingReader(dir, identity, bounds));

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
  const { dir, writer } = await bundle();
  const takings: Taking[] = [];
  const live = new RouteWorkspace({
    registrations: [],
    store: memory(),
    capture: capturedWorkReads(writer, run, (taking) => Effect.sync(() => void takings.push(taking))),
  });
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
  // The observer is told each durable taking before the read answers.
  expect(takings.map((taking) => (taking.input as { view: string }).view)).toEqual(["raw", "view", "feed"]);

  const recorded = new RouteWorkspace({
    registrations: [],
    recorded: recordedWorkSource(await reader(dir), run),
    authorizeMutation: (verb) => {
      if (verb === "start-fresh") throw Object.assign(Error("historical Work is read-only"), { code: "WorkHistorical" });
    },
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
  // The injected policy's own refusal wins over the store-less guard.
  await expect(recorded.startFresh(key, "fans", "human")).rejects.toMatchObject({ code: "WorkHistorical" });
  // The two feed shapes are not interchangeable, and root's handle/revision/history invariants hold.
  const feed = delivered.feed as { revision: number; handle: object };
  expect(await decodes(workFeedCodecs["work-acks"], feed)).toBe(true);
  expect(await decodes(workFeedCodecs.work, feed)).toBe(false);
  expect(await decodes(workFeedCodecs["work-acks"], { ...feed, handle: { ...feed.handle, revision: feed.revision + 1 } })).toBe(false);
  expect(await decodes(workFeedCodecs["work-acks"], { ...feed, history: { from: feed.revision + 2, acks: [] } })).toBe(false);
  const { title: _title, ...missingTitle } = delivered.view!;
  expect(await decodes(workInputCodecs.view, missingTitle)).toBe(false);
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

/** A live Fans workspace whose capture port is instrumented; the bound is its own history limit. */
async function instrumented(capture: import("@pe/runtime").WorkReadCapture) {
  const workspace = new RouteWorkspace({
    registrations: [],
    store: memory(),
    capture,
    workHistoryLimits: { maxCount: 2, maxBytes: 1_000_000 },
  });
  await admit(workspace);
  let revision = 0;
  const write = async () =>
    expect(
      await workspace.apply(key, "fans", "human", [{ path: ["flows", "4", "edit"], value: { value: { cfm: 100 + revision } } }], revision++),
    ).toMatchObject({ ok: true });
  const events: string[] = [];
  const open = (shape: "work" | "work-acks") =>
    workspace.observeAdmittedFeed(
      key,
      admission,
      shape,
      () => events.push("deliver"),
      () => events.push("ack"),
      (error) => events.push(`failed:${(error as { code?: string }).code ?? (error as Error).message}`),
    );
  return { workspace, write, events, open };
}
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

test.each(["work", "work-acks"] as const)(
  "a failed %s capture ends the feed: later writes are neither captured nor delivered",
  async (shape) => {
    let captures = 0;
    const f = await instrumented({
      read: async () => {},
      readFailed: async () => {},
      feedFailed: async () => {},
      feed: async () => {
        captures++;
        throw Error("bundle full");
      },
    });
    f.open(shape);
    await settled();
    await f.write();
    await f.write();
    await settled();
    expect(f.events).toEqual(["failed:bundle full"]);
    expect(captures).toBe(1);
  },
);

test.each(["work", "work-acks"] as const)(
  "%s frames waiting on a held capture are bounded by the workspace limit and end typed, undelivered",
  async (shape) => {
    const f = await instrumented({
      read: async () => {},
      readFailed: async () => {},
      feedFailed: async () => {},
      feed: () => new Promise(() => {}),
    });
    f.open(shape);
    await settled();
    for (let i = 0; i < 3; i++) await f.write();
    await settled();
    expect(f.events).toEqual(["failed:WorkFeedBacklog"]);
  },
);

test("a recorded read is bound to its exact taking; an unbound repeat is ambiguous and a foreign id refuses", async () => {
  const { dir, writer } = await bundle();
  const takings: Taking[] = [];
  const live = new RouteWorkspace({
    registrations: [],
    store: memory(),
    capture: capturedWorkReads(writer, run, (taking) => Effect.sync(() => void takings.push(taking))),
  });
  await admit(live);
  const first = await live.readRaw(key, "fans");
  await live.apply(key, "fans", "human", [{ path: ["flows", "4", "edit"], value: { value: { cfm: 9 } } }], 0);
  await live.readRaw(key, "fans");
  await live.view(key, "fans");
  const [raw0, , view] = takings;
  const binding = inputBindingKey(workInput(key, "raw"), workInputScope(key));
  const reader_ = await reader(dir);
  const replay = async (bindings?: Map<string, string>) => {
    const recorded = new RouteWorkspace({ registrations: [], recorded: recordedWorkSource(reader_, run, bindings) });
    await admit(recorded); // an unadmitted route reads null before any source (the preserved red)
    return recorded.readRaw(key, "fans");
  };
  await expect(replay()).rejects.toMatchObject({ problem: "recording.ambiguous" });
  expect(await replay(new Map([[binding, raw0!.id]]))).toEqual(first);
  await expect(replay(new Map([[binding, view!.id]]))).rejects.toMatchObject({ problem: "recording.mismatch" });
});

test("Work that cannot be recorded truncates capture; the live Work still answers and replay stays strict", async () => {
  const { dir, writer } = await bundle();
  const capture = capturedWorkReads(writer, run);
  const live = new RouteWorkspace({ registrations: [], store: memory(), capture });
  await admit(live);
  const { title: _title, ...missingTitle } = (await live.view(key, "fans"))!;
  await capture.read(key, "raw", undefined); // an undefined root is not a recorded null
  expect(writer.truncation).toEqual({ at: 2, reason: "encoding" });
  await capture.read(key, "view", missingTitle);
  // Capture stopped at the first loss; later live reads answer and keep no taking.
  expect(await live.view(key, "fans")).toMatchObject({ revision: 0 });
  const recorded = recordedWorkSource(await reader(dir), run);
  await expect(recorded.read(key, "raw")).rejects.toMatchObject({ problem: "recording.miss" });
  expect((await reader(dir)).truncation).toEqual({ at: 2, reason: "encoding" });
});

test("a failing taking observer truncates capture without failing the live read", async () => {
  const { writer } = await bundle();
  const live = new RouteWorkspace({
    registrations: [],
    store: memory(),
    capture: capturedWorkReads(writer, run, () => Effect.fail(new InvalidRead({ message: "observer down", status: 500, problem: "provenance.down" }))),
  });
  await admit(live);
  expect(await live.view(key, "fans")).toMatchObject({ revision: 0 });
  expect(writer.truncation).toMatchObject({ reason: "observer" });
});

test("a live Work body read failure is recorded as its exact DoorFailure, or truncates; callers see the original", async () => {
  const { dir, writer } = await bundle();
  const base = memory();
  let poison: unknown = null;
  const store: RouteDocumentStore = {
    ...base,
    getState: async (query) => {
      if (poison) throw poison;
      return base.getState(query);
    },
  };
  const live = new RouteWorkspace({ registrations: [], store, capture: capturedWorkReads(writer, run) });
  await admit(live); // admission is not a body read; the store is poisoned only after it
  const busy = new InvalidRead({ message: "Work store poisoned", status: 503, problem: "work.read" });
  poison = busy;
  await expect(live.readRaw(key, "fans")).rejects.toBe(busy);
  await expect(live.view(key, "fans")).rejects.toBe(busy);
  await expect(live.read(key, "fans")).rejects.toBe(busy);
  await expect(firstFeed(live, "work-acks")).rejects.toBe(busy);
  expect(writer.truncation).toBeNull();

  const recorded = new RouteWorkspace({ registrations: [], recorded: recordedWorkSource(await reader(dir), run) });
  await admit(recorded);
  const same = { _tag: "InvalidRequest", status: 503, problem: "work.read", message: "Work store poisoned" };
  await expect(recorded.readRaw(key, "fans")).rejects.toMatchObject(same);
  await expect(recorded.view(key, "fans")).rejects.toMatchObject(same);
  await expect(recorded.read(key, "fans")).rejects.toMatchObject(same);
  await expect(firstFeed(recorded, "work-acks")).rejects.toMatchObject(same);

  // A failure no taking can hold faithfully stops capture; the caller still gets it unchanged.
  const plain = Error("plain store fault");
  poison = plain;
  await expect(live.view(other, "fans")).rejects.toBe(plain);
  expect(writer.truncation).toMatchObject({ reason: "unsupported" });
  // The `work` frame reaches the owner as its message only; live delivers it as it always did.
  poison = busy;
  await expect(firstFeed(live, "work")).rejects.toBe("Work store poisoned");
});
