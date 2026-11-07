import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Context, Effect, Exit, Layer, Schema, Scope } from "effect";
import { afterEach, expect, test } from "vite-plus/test";
import { address, bindWork, workKey, fansRouteState } from "@pe/agent-contracts";
import {
  RouteWorkspace,
  type RouteDocumentStore,
  type WorkCarriage,
  type WorkReadContext,
  type WorkReadSource,
} from "@pe/runtime";
import { workFingerprintSchema } from "../../../packages/agent-contracts/src/route-kernel-admission.ts";
import { AdmittedBuiltins, admittedBuiltinsLayer } from "../src/admitted-builtins.ts";
import { builtinEnrollments } from "../src/builtin-enrollment.ts";
import {
  nativeCatalogIdentity,
  openRecordingReader,
  openRecordingWriter,
  type Taking,
} from "../src/native-recording.ts";
import { InvalidRead } from "../src/native-reads.ts";
import type { HostInputLane } from "../src/native-recording.ts";
import { HostInputReadSets, type ConsumerRecipe, type ReadSetId } from "../src/input-occurrence.ts";
import {
  capturedWorkReads,
  recordedWorkSource,
  workFeedCodecs,
  workInputCodecs,
  workReadContext,
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
const firstFeed = (
  workspace: RouteWorkspace,
  shape: "work" | "work-acks",
  context?: WorkReadContext,
) =>
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
      context,
    );
  });

const recipe: ConsumerRecipe = {
  key: "ducts.sheet",
  input: { fan: "F-1" },
  scope: '["work-inputs"]',
};
/** One request's consumption over a real lane, and the Work context it carries explicitly. */
async function consumer(lane: HostInputLane, selected: ReadSetId | null = null) {
  const scope = await Effect.runPromise(Scope.make());
  scopes.push(scope);
  const built = await Effect.runPromise(Layer.buildWithScope(HostInputReadSets.layer(lane), scope));
  const consumption = await Effect.runPromise(
    Context.get(built, HostInputReadSets).open(recipe, selected),
  );
  return { consumption, context: workReadContext(consumption, run) };
}

/** The same context, keeping every token its begin minted, for delivery identity checks. */
const minting = (context: WorkReadContext) => {
  const minted: (WorkCarriage | undefined)[] = [];
  const counted: WorkReadContext = {
    begin: (request) => {
      const begun = context.begin(request);
      if (begun.ok) minted.push(begun.carriage);
      return begun;
    },
  };
  return { context: counted, minted };
};

test("a recorded workspace with no store serves the delivered Work, feed and history; it never mutates", async () => {
  const { dir, writer } = await bundle();
  const takings: Taking[] = [];
  const live = new RouteWorkspace({
    registrations: [],
    store: memory(),
    capture: capturedWorkReads(writer, run, (taking) =>
      Effect.sync(() => void takings.push(taking)),
    ),
  });
  await admit(live);
  const request = await consumer({ kind: "live", captureStore: writer });
  for (const [revision, cfm] of [
    [0, 250],
    [1, 300],
  ] as const)
    expect(
      await live.apply(
        key,
        "fans",
        "human",
        [{ path: ["flows", "4", "edit"], value: { value: { cfm } } }],
        revision,
      ),
    ).toMatchObject({ ok: true });
  const delivered = {
    raw: await live.readRaw(key, "fans", request.context),
    view: JSON.parse(JSON.stringify(await live.view(key, "fans", request.context))),
    feed: (await firstFeed(live, "work-acks", request.context)).value,
  };
  await run(request.consumption.seal);
  expect(delivered.feed).toMatchObject({ revision: 2, history: { from: 1 } });
  // The observer is told each durable taking before the read answers.
  expect(takings.map((taking) => (taking.input as { view: string }).view)).toEqual([
    "raw",
    "view",
    "feed",
  ]);

  const recorded = new RouteWorkspace({
    registrations: [],
    recorded: recordedWorkSource(await reader(dir)),
    authorizeMutation: (verb) => {
      if (verb === "start-fresh")
        throw Object.assign(Error("historical Work is read-only"), { code: "WorkHistorical" });
    },
  });
  await admit(recorded);
  const { context: again } = await consumer(
    { kind: "recording", recordingStore: await reader(dir), at: null },
    request.consumption.id,
  );
  expect(await recorded.readRaw(key, "fans", again)).toEqual(delivered.raw);
  expect(await recorded.view(key, "fans", again)).toEqual(delivered.view);
  // Once, with its original handle and history; a recording invents no acks.
  expect(await firstFeed(recorded, "work-acks", again)).toEqual({
    value: delivered.feed,
    acks: [],
  });
  // A taking never made is the store's typed miss, never an empty r0 Work.
  await expect(recorded.readRaw(other, "fans", again)).rejects.toMatchObject({
    _tag: "InvalidRequest",
    problem: "recording.miss",
  });
  // The view-with-history shape was never delivered live: this consumer has no such start.
  await expect(firstFeed(recorded, "work", again)).rejects.toMatchObject({
    problem: "recording.miss",
  });
  await expect(
    recorded.apply(
      key,
      "fans",
      "human",
      [{ path: ["flows", "4", "edit"], value: { value: { cfm: 1 } } }],
      2,
    ),
  ).rejects.toThrow("recorded workspace refuses Work edit");
  // The injected policy's own refusal wins over the store-less guard.
  await expect(recorded.startFresh(key, "fans", "human")).rejects.toMatchObject({
    code: "WorkHistorical",
  });
  // The two feed shapes are not interchangeable, and root's handle/revision/history invariants hold.
  const feed = delivered.feed as { revision: number; handle: object };
  expect(await decodes(workFeedCodecs["work-acks"], feed)).toBe(true);
  expect(await decodes(workFeedCodecs.work, feed)).toBe(false);
  expect(
    await decodes(workFeedCodecs["work-acks"], {
      ...feed,
      handle: { ...feed.handle, revision: feed.revision + 1 },
    }),
  ).toBe(false);
  expect(
    await decodes(workFeedCodecs["work-acks"], {
      ...feed,
      history: { from: feed.revision + 2, acks: [] },
    }),
  ).toBe(false);
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
  const source: WorkReadSource = {
    begin: () => ({ ok: true, carriage: undefined }),
    read: async () => foreign,
    feed: () => pending,
  };
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
  const store = memory();
  // This exercises continuation of existing Work; absent Work has its own feed state.
  await store.setState({
    targetKey: workKey(key),
    route: key.route,
    value: {
      version: 1,
      schemaVersion: fansRouteState.schemaVersion,
      revision: 0,
      doc: fansRouteState.schema.parse({}),
      history: [],
    },
  });
  const workspace = new RouteWorkspace({
    registrations: [],
    store,
    capture,
    workHistoryLimits: { maxCount: 2, maxBytes: 1_000_000 },
  });
  await admit(workspace);
  let revision = 0;
  const write = async () =>
    expect(
      await workspace.apply(
        key,
        "fans",
        "human",
        [{ path: ["flows", "4", "edit"], value: { value: { cfm: 100 + revision } } }],
        revision++,
      ),
    ).toMatchObject({ ok: true });
  const events: string[] = [];
  const open = (shape: "work" | "work-acks") =>
    workspace.observeAdmittedFeed(
      key,
      admission,
      shape,
      () => events.push("deliver"),
      () => events.push("ack"),
      (error) =>
        events.push(`failed:${(error as { code?: string }).code ?? (error as Error).message}`),
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
      begin: () => ({ ok: true, carriage: undefined }),
      stop: async () => {},
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
  "%s past a held capture's bound truncates capture, and the same live feed continues exactly once",
  async (shape) => {
    const { writer } = await bundle();
    const real = capturedWorkReads(writer, run);
    const request = await consumer({ kind: "live", captureStore: writer });
    const tokens = minting(request.context);
    const carried: (WorkCarriage | undefined)[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let feeds = 0;
    const f = await instrumented({
      ...real,
      feed: (...args) => {
        feeds++;
        return gate.then(() => real.feed(...args));
      },
    });
    const seen: number[] = [];
    const failures: unknown[] = [];
    const stop = f.workspace.observeAdmittedFeed(
      key,
      admission,
      shape,
      (value, carriage) => {
        carried.push(carriage);
        seen.push("error" in value ? -1 : (value.value as { revision: number }).revision);
      },
      (ack) => seen.push(ack.revision),
      (error) => failures.push(error),
      tokens.context,
    );
    await settled();
    for (let i = 0; i < 3; i++) await f.write(); // the third exceeds maxCount 2 while capture holds
    await settled();
    expect(writer.truncation).toMatchObject({ reason: "backlog" });
    expect(failures).toEqual([]);
    expect(seen).toEqual([0, 1, 2, 3]);
    release(); // the late capture completes: nothing repeats, nothing restarts capture
    await settled();
    await f.write();
    await settled();
    expect(seen).toEqual([0, 1, 2, 3, 4]);
    expect(failures).toEqual([]);
    expect(feeds).toBe(1);
    stop(); // cancellation during fallback ends delivery
    await f.write();
    await settled();
    expect(seen).toEqual([0, 1, 2, 3, 4]);
    // Values begun before the fallback carry their own exact token; after it nothing begins.
    const begun = shape === "work" ? 2 : 1;
    expect(tokens.minted).toHaveLength(begun);
    expect(carried).toHaveLength(shape === "work" ? 5 : 1);
    carried.forEach((carriage, index) => expect(carriage).toBe(tokens.minted[index]));
  },
);

test("each admitted-feed delivery carries the exact token its begin minted, live and recorded", async () => {
  const { dir, writer } = await bundle();
  const live = new RouteWorkspace({
    registrations: [],
    store: memory(),
    capture: capturedWorkReads(writer, run),
  });
  await admit(live);
  const request = await consumer({ kind: "live", captureStore: writer });
  const deliveries = (
    workspace: RouteWorkspace,
    shape: "work" | "work-acks",
    context: WorkReadContext,
  ) =>
    new Promise<WorkCarriage | undefined>((resolve, reject) => {
      const stop = workspace.observeAdmittedFeed(
        key,
        admission,
        shape,
        (_value, carriage) => {
          stop();
          resolve(carriage);
        },
        () => {},
        reject,
        context,
      );
    });
  for (const shape of ["work", "work-acks"] as const) {
    const tokens = minting(request.context);
    const carried = await deliveries(live, shape, tokens.context);
    expect(tokens.minted).toHaveLength(1);
    expect(carried).toBeDefined();
    expect(carried).toBe(tokens.minted[0]);
  }
  await run(request.consumption.seal);
  const recorded = new RouteWorkspace({
    registrations: [],
    recorded: recordedWorkSource(await reader(dir)),
  });
  await admit(recorded);
  const { context } = await consumer(
    { kind: "recording", recordingStore: await reader(dir), at: null },
    request.consumption.id,
  );
  const tokens = minting(context);
  const carried = await deliveries(recorded, "work", tokens.context);
  expect(carried).toBeDefined();
  expect(carried).toBe(tokens.minted[0]);
});

test("Work that cannot be recorded truncates capture; the live Work still answers and replay stays strict", async () => {
  const { dir, writer } = await bundle();
  const capture = capturedWorkReads(writer, run);
  const live = new RouteWorkspace({ registrations: [], store: memory(), capture });
  await admit(live);
  const request = await consumer({ kind: "live", captureStore: writer });
  const { title: _title, ...missingTitle } = (await live.view(key, "fans", request.context))!;
  const carriage = (view: "raw" | "view") => {
    const begun = capture.begin({ kind: "read", key, view }, request.context);
    return begun.ok ? begun.carriage : undefined;
  };
  await capture.read(key, "raw", undefined, carriage("raw")); // an undefined root is not a recorded null
  expect(writer.truncation).toEqual({ at: 2, stoppedAt: expect.any(Number), site: "work", op: "work.raw", reason: "encoding" });
  await capture.read(key, "view", missingTitle, carriage("view"));
  // Capture stopped at the first loss; later live reads answer and keep no taking.
  expect(await live.view(key, "fans", request.context)).toMatchObject({ revision: 0 });
  await run(request.consumption.seal);
  // A truncated capture keeps no complete read set: the consumer is not replayable at all.
  await expect(
    consumer(
      { kind: "recording", recordingStore: await reader(dir), at: null },
      request.consumption.id,
    ),
  ).rejects.toMatchObject({ problem: "recording.context" });
  expect((await reader(dir)).truncation).toEqual({
    at: 2,
    stoppedAt: expect.any(Number),
    site: "work",
    op: "work.raw",
    reason: "encoding",
  });
});

test("a failing taking observer truncates capture without failing the live read", async () => {
  const { writer } = await bundle();
  const live = new RouteWorkspace({
    registrations: [],
    store: memory(),
    capture: capturedWorkReads(writer, run, () =>
      Effect.fail(
        new InvalidRead({ message: "observer down", status: 500, problem: "provenance.down" }),
      ),
    ),
  });
  await admit(live);
  const request = await consumer({ kind: "live", captureStore: writer });
  expect(await live.view(key, "fans", request.context)).toMatchObject({ revision: 0 });
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
  const live = new RouteWorkspace({
    registrations: [],
    store,
    capture: capturedWorkReads(writer, run),
  });
  await admit(live); // admission is not a body read; the store is poisoned only after it
  const request = await consumer({ kind: "live", captureStore: writer });
  const busy = new InvalidRead({
    message: "Work store poisoned",
    status: 503,
    problem: "work.read",
  });
  poison = busy;
  await expect(live.readRaw(key, "fans", request.context)).rejects.toBe(busy);
  await expect(live.view(key, "fans", request.context)).rejects.toBe(busy);
  await expect(live.read(key, "fans", request.context)).rejects.toBe(busy);
  await expect(firstFeed(live, "work-acks", request.context)).rejects.toBe(busy);
  expect(writer.truncation).toBeNull();
  await run(request.consumption.seal);

  const recorded = new RouteWorkspace({
    registrations: [],
    recorded: recordedWorkSource(await reader(dir)),
  });
  await admit(recorded);
  const { context: again } = await consumer(
    { kind: "recording", recordingStore: await reader(dir), at: null },
    request.consumption.id,
  );
  const same = {
    _tag: "InvalidRequest",
    status: 503,
    problem: "work.read",
    message: "Work store poisoned",
  };
  await expect(recorded.readRaw(key, "fans", again)).rejects.toMatchObject(same);
  await expect(recorded.view(key, "fans", again)).rejects.toMatchObject(same);
  await expect(recorded.read(key, "fans", again)).rejects.toMatchObject(same);
  await expect(firstFeed(recorded, "work-acks", again)).rejects.toMatchObject(same);

  // A failure no taking can hold faithfully stops capture; the caller still gets it unchanged.
  const plain = Error("plain store fault");
  poison = plain;
  const later = await consumer({ kind: "live", captureStore: writer });
  await expect(live.view(other, "fans", later.context)).rejects.toBe(plain);
  expect(writer.truncation).toMatchObject({ reason: "unsupported" });
  // The `work` frame reaches the owner as its message only; live delivers it as it always did.
  poison = busy;
  await expect(firstFeed(live, "work", later.context)).rejects.toBe("Work store poisoned");
});

test("two request contexts cross the Work queue with reverse capture completion; each replays its own starts", async () => {
  const { dir, writer } = await bundle();
  const real = capturedWorkReads(writer, run);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let held = true;
  const live = new RouteWorkspace({
    registrations: [],
    store: memory(),
    capture: {
      ...real,
      read: (...args) => {
        if (!held) return real.read(...args);
        held = false; // the human's first capture completes last
        return gate.then(() => real.read(...args));
      },
    },
  });
  await admit(live);
  const human = await consumer({ kind: "live", captureStore: writer });
  const pea = await consumer({ kind: "live", captureStore: writer });
  const first = live.view(key, "fans", human.context);
  await live.apply(
    key,
    "fans",
    "human",
    [{ path: ["flows", "4", "edit"], value: { value: { cfm: 7 } } }],
    0,
  );
  expect(await live.view(key, "fans", pea.context)).toMatchObject({ revision: 1 });
  release();
  expect(await first).toMatchObject({ revision: 0 });
  expect(await live.view(key, "fans", human.context)).toMatchObject({ revision: 1 }); // a repeat start
  for (const { consumption } of [human, pea]) await run(consumption.seal);

  const reader_ = await reader(dir);
  const recorded = new RouteWorkspace({ registrations: [], recorded: recordedWorkSource(reader_) });
  await admit(recorded);
  const again = async (id: ReadSetId) =>
    (await consumer({ kind: "recording", recordingStore: reader_, at: null }, id)).context;
  const humanAgain = await again(human.consumption.id);
  expect(await recorded.view(key, "fans", humanAgain)).toMatchObject({ revision: 0 });
  expect(await recorded.view(key, "fans", humanAgain)).toMatchObject({ revision: 1 });
  const peaAgain = await again(pea.consumption.id);
  expect(await recorded.view(key, "fans", peaAgain)).toMatchObject({ revision: 1 });
  await expect(recorded.view(key, "fans", peaAgain)).rejects.toMatchObject({
    problem: "recording.miss",
  });
});

test("no context: a recording refuses before access; capture truncates and live Work is unchanged", async () => {
  const { dir, writer } = await bundle();
  const live = new RouteWorkspace({
    registrations: [],
    store: memory(),
    capture: capturedWorkReads(writer, run),
  });
  await admit(live);
  expect(await live.view(key, "fans")).toMatchObject({ revision: 0 });
  expect(writer.truncation).toMatchObject({ reason: "unsupported" });
  let touched = 0;
  const source = recordedWorkSource(await reader(dir));
  const recorded = new RouteWorkspace({
    registrations: [],
    recorded: { ...source, read: (...args) => (touched++, source.read(...args)) },
  });
  await admit(recorded);
  await expect(recorded.view(key, "fans")).rejects.toMatchObject({
    _tag: "InvalidRequest",
    problem: "recording.context",
  });
  await expect(firstFeed(recorded, "work-acks")).rejects.toMatchObject({
    problem: "recording.context",
  });
  expect(touched).toBe(0);
});

test("absent Work feeds capture and replay null without stopping recording", async () => {
  const { dir, writer } = await bundle();
  const capture = capturedWorkReads(writer, run);
  const request = await consumer({ kind: "live", captureStore: writer });
  for (const shape of ["work", "work-acks"] as const) {
    const begun = capture.begin({ kind: "feed", key, admission, shape }, request.context);
    if (!begun.ok) throw begun.error;
    await capture.feed(key, admission, shape, null, begun.carriage);
  }
  await run(request.consumption.seal);
  expect(writer.capture.truncated()).toBeNull();
  const recording = await reader(dir);
  const source = recordedWorkSource(recording);
  const replay = await consumer(
    { kind: "recording", recordingStore: recording, at: null },
    request.consumption.id,
  );
  for (const shape of ["work", "work-acks"] as const) {
    const begun = source.begin({ kind: "feed", key, admission, shape }, replay.context);
    if (!begun.ok) throw begun.error;
    expect(await source.feed(key, admission, shape, begun.carriage)).toBeNull();
  }
});

test("command Work reads carry context through binding and revalidation", async () => {
  const { dir, writer } = await bundle();
  const { ActionJournal } = await import("../src/action-journal.ts");
  const { commands, tools } = await import("@pe/agent-contracts");
  const { z } = await import("zod");
  const { crossingOf } = await import("./callers.ts");
  const workspace = new RouteWorkspace({
    registrations: [{ spec: tools.fans.work }],
    store: memory(),
    capture: capturedWorkReads(writer, run),
  });
  const journal = new ActionJournal(join(dir, "journal.json"), Date.now);
  const request = await consumer({ kind: "live", captureStore: writer });
  journal.bindCommands({
    work: workspace,
    workReads: () => ({
      read: (key, route) => workspace.read(key, route, request.context),
      view: (key, route) => workspace.view(key, route, request.context),
    }),
    probe: async () => true,
    resolve: () => ({
      definition: commands["ducts.plan-losses"],
      prepared: z.unknown(),
      bind: async (ctx) => {
        await ctx.selectWork(tools.fans.work, { key, revision: 0 });
        return { prepare: async () => null, effects: [] };
      },
      run: async () => ({
        previewOnly: true,
        derivedRequest: {},
        seal: {
          requestHash: "fixture",
          work: { handle: { key, revision: 0 } },
          documentMark: { session: "s", openId: "open", observedSince: null, changedAt: null },
          incarnation: {},
          dependencies: "fixture",
        },
      }),
    }),
  });
  const id = crypto.randomUUID();
  await journal.invoke(
    {
      id,
      key: "ducts.plan-losses",
      target: { kind: "document", ref: { session: "s", openId: "open" } },
      input: { work: { key, revision: 0 } },
    },
    crossingOf(),
  );
  const row = await journal.wait(id);
  expect(row.state, JSON.stringify(row)).toBe("succeeded");
  expect(writer.capture.truncated()).toBeNull();
  await run(request.consumption.seal);
  const store = await reader(dir);
  const replay = new RouteWorkspace({
    registrations: [{ spec: tools.fans.work }],
    recorded: recordedWorkSource(store),
  });
  const again = await consumer(
    { kind: "recording", recordingStore: store, at: null },
    request.consumption.id,
  );
  expect((await replay.view(key, "fans", again.context))?.revision).toBe(0);
});
