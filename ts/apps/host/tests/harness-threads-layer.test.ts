import { randomUUID } from "node:crypto";
import { followThread } from "@pe/agent-contracts/chat-state";
import { Spawner } from "../src/harness/spawner.ts";
import { NodeServices } from "@effect/platform-node";
import { Context, Effect, FileSystem, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import { expect, vi } from "vite-plus/test";
import { human } from "./callers.ts";
import { withInvocationContext } from "@pe/runtime/context";
import { HostLog } from "../src/host-log.ts";
import { HarnessThreads, type HarnessThreadsOptions } from "../src/harness/threads.ts";
import { loadThread } from "../src/harness/thread-store.ts";
import type { Providers } from "../src/harness/providers.ts";
import { captureLogs, consentService, effectTest } from "./effect-test.ts";

/** An Effect test over the node file system, for fixtures that live on disk. */
const nodeTest = <A, E>(
  name: string,
  body: () => Effect.Effect<A, E, Scope.Scope | FileSystem.FileSystem>,
) => effectTest(name, () => body().pipe(Effect.provide(NodeServices.layer)));

const meta = (id: string) => ({
  id,
  harness: "claude",
  providerId: "claude",
  providerName: "Claude",
  title: id,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  modelId: null,
  acpSessionId: null,
  models: [],
});
const prompt = { seq: 1, at: "2026-10-01T00:00:00.000Z", kind: "prompt", turnId: "t1", text: "hi" };
const turnEnd = {
  seq: 2,
  at: "2026-10-01T00:00:01.000Z",
  kind: "turn_end",
  turnId: "t1",
  stopReason: "end_turn",
};

/** The store over a temp root. Providers know `claude`, and nothing here may spawn a child. */
const store = Effect.fn("test.store")(function* (
  root: string,
  logs?: ReturnType<typeof captureLogs>,
) {
  const options: HarnessThreadsOptions = {
    root,
    runs: consentService(),
    log: new HostLog(`${root}.log`, Date.now),
    worldRoot: root,
    mcpServer: () => ({ name: "unused", command: "unused", args: [], env: [] }),
    providers: {
      get: () => ({
        id: "claude",
        harness: "claude",
        name: "Claude",
        auth: { kind: "subscription" },
      }),
      keys: () => [],
      invalidate: () => {},
    } as unknown as Providers,
  };
  const built = Layer.build(
    HarnessThreads.layer(options).pipe(
      Layer.provide(Spawner.live),
      Layer.provide(NodeServices.layer),
    ),
  );
  const context = yield* logs ? built.pipe(Effect.provide(logs.layer)) : built;
  return Context.get(context, HarnessThreads);
});

const seed = Effect.fn("test.seed")(function* (
  root: string,
  id: string,
  metaText: string,
  eventsText?: string,
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(`${root}/${id}`, { recursive: true });
  yield* fs.writeFileString(`${root}/${id}/meta.json`, metaText);
  if (eventsText !== undefined) yield* fs.writeFileString(`${root}/${id}/events.jsonl`, eventsText);
});

nodeTest("the Layer replays a saved events.jsonl into the store, skipping a torn line", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* seed(
      root,
      "thread",
      JSON.stringify(meta("thread")),
      [JSON.stringify(prompt), '{"seq":2,"kind":"prom', JSON.stringify(turnEnd), ""].join("\r\n"),
    );
    const logs = captureLogs();
    const threads = yield* store(root, logs);
    const [saved] = threads.historySnapshot();
    expect(saved?.id).toBe("thread");
    expect(saved?.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(logs.lines.map((line) => line.annotations)).toMatchObject([{ line: 2 }]);
  }),
);

nodeTest("a thread whose meta.json does not decode fails typed and the others still load", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* seed(root, "good", JSON.stringify(meta("good")));
    yield* seed(root, "bad", "{ not json");
    const unreadable = yield* Effect.flip(loadThread(root, "bad", () => "Claude")).pipe(
      Effect.provide(NodeServices.layer),
    );
    expect(unreadable._tag).toBe("ThreadUnreadable");
    expect(unreadable.dir).toContain("bad");
    const logs = captureLogs();
    const threads = yield* store(root, logs);
    expect(threads.historySnapshot().map((thread) => thread.id)).toEqual(["good"]);
    expect(String(logs.lines[0]?.message)).toContain("bad");
  }),
);

nodeTest("a thread root that cannot be made fails the Layer with a typed error", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(`${dir}/occupied`, "a file where the root should be");
    const failure = yield* Effect.flip(store(`${dir}/occupied`)).pipe(
      Effect.provide(NodeServices.layer),
    );
    expect(failure).toMatchObject({ _tag: "ThreadStoreUnavailable" });
  }),
);

nodeTest("event timestamps come from the Clock, not the wall", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* TestClock.setTime(Date.parse("2031-01-02T03:04:05.000Z"));
    const threads = yield* store(root);
    // The provider stub cannot start a child, so the new thread logs an `error` event: a stamped append.
    yield* Effect.promise(async () => {
      const response = await withInvocationContext({ caller: human }, () =>
        threads.fetch(
          new Request("http://host/pe/threads", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ providerId: "claude" }),
          }),
        ),
      );
      expect(response.status).toBeLessThan(300);
      await vi.waitFor(() =>
        expect(threads.historySnapshot()[0]?.events.map((e) => e.kind)).toContain("error"),
      );
    });
    const [created] = threads.historySnapshot();
    expect(created?.events.map((event) => event.at)).toEqual(["2031-01-02T03:04:05.000Z"]);
    expect(created?.createdAt).toBe("2031-01-02T03:04:05.000Z");
  }),
);

nodeTest("replay damage preserves sequence identity and delivers the first live event", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* seed(
      root,
      "thread",
      JSON.stringify(meta("thread")),
      [
        JSON.stringify(prompt),
        '{"seq":2,"kind":"torn',
        JSON.stringify({ ...turnEnd, seq: 3 }),
        "",
      ].join("\n"),
    );
    const threads = yield* store(root);
    const delivered: ReturnType<typeof followThread>[] = [];
    const unsubscribe = threads.observe({ kind: "thread", thread: "thread" }, (frame) => {
      if (frame.kind === "event") delivered.push(followThread(3, frame));
    });
    yield* Effect.addFinalizer(() => Effect.sync(() => unsubscribe?.()));
    const response = yield* Effect.promise(() =>
      withInvocationContext({ caller: human }, () =>
        threads.fetch(
          new Request("http://host/pe/threads/thread", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "changed" }),
          }),
        ),
      ),
    );
    expect(response.status).toBe(200);
    expect.soft(threads.historySnapshot()[0]?.events.map((e) => e.seq)).toEqual([1, 3, 4]);
    expect(delivered).toMatchObject([{ kind: "apply", event: { seq: 4, kind: "title_changed" } }]);
    // One stream carries many tails, so the cursor rides the key: `after` replays the log from
    // there, where a key with no cursor is told to re-read the body.
    const kinds = (request: Parameters<typeof threads.observe>[0]) => {
      const seen: string[] = [];
      threads.observe(request, (frame) => seen.push(frame.kind))?.();
      return seen;
    };
    expect(kinds({ kind: "thread", thread: "thread", after: 0 })).toEqual(["event"]);
    expect(kinds({ kind: "thread", thread: "thread" })).toEqual(["gap"]);
  }),
);

nodeTest("a failed service close is tagged and logged at the scope boundary", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const logs = captureLogs();
    yield* Effect.scoped(
      Effect.gen(function* () {
        const threads = yield* store(root, logs);
        const close = threads.close;
        vi.spyOn(threads, "close").mockImplementationOnce(async () => {
          await close();
          throw Error("close disk failed");
        });
      }),
    ).pipe(Effect.provide(logs.layer));
    expect(logs.lines.map((line) => line.message)).toMatchObject([
      [{ _tag: "ThreadCloseFailed", message: "Error: close disk failed" }],
    ]);
  }),
);

nodeTest("a replay gap keeps every new target part linked to its prompt sequence", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* seed(root, "thread", JSON.stringify(meta("thread")), [
      JSON.stringify(prompt), '{"seq":2,"kind":"torn',
      JSON.stringify({ ...turnEnd, seq: 3 }), "",
    ].join("\n"));
    const threads = yield* store(root);
    const response = yield* Effect.promise(() => withInvocationContext({ caller: human }, () =>
      threads.fetch(new Request("http://host/pe/threads/thread/prompt", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: randomUUID(), text: "after damage" }),
      })),
    ));
    expect(yield* Effect.promise(() => response.json())).toMatchObject({});
    expect(response.status).toBe(200);
    const events = threads.historySnapshot()[0]?.events ?? [];
    const delivered = events.find((event) => event.kind === "prompt" && event.seq > 3);
    expect(delivered).toMatchObject({ kind: "prompt", seq: 5 });
    const parts = events.filter((event) => event.kind === "turn_element_targets").filter((event) => event.seq > 3);
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) expect(part.promptSeq).toBe(delivered?.seq);
  }),
);
