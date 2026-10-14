import { expect, test } from "vite-plus/test";
import { createPluginRuntime } from "@pe/agent-contracts";
import { observePluginOperations } from "../src/plugin-receipts.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { crossingOf } from "./callers.ts";

test("disable disposes registrations, re-enable activates once, removal ends influence", async () => {
  const runtime = createPluginRuntime<string>();
  const seen: string[] = [];
  let cleanup = 0;
  await runtime.install({
    id: "sample",
    setup(context) {
      context.contribute("skill:sample/inspect", "bytes");
      context.hook("turn.before", () => {
        seen.push("turn");
      });
      return () => {
        cleanup++;
      };
    },
  });
  await runtime.emit("turn.before", { threadId: "t", turnId: "one" });
  expect(runtime.contributions()).toEqual(["bytes"]);
  await runtime.setEnabled("sample", false);
  await runtime.emit("turn.before", { threadId: "t", turnId: "two" });
  expect(runtime.contributions()).toEqual([]);
  expect(seen).toEqual(["turn"]);
  expect(cleanup).toBe(1);
  await runtime.setEnabled("sample", true);
  await runtime.setEnabled("sample", true);
  await runtime.remove("sample");
  expect(cleanup).toBe(2);
  expect(runtime.inventory()).toEqual([]);
});

test("failed activation and duplicate keys roll back only the failed scope", async () => {
  const runtime = createPluginRuntime<string>();
  await runtime.install({
    id: "first",
    setup(c) {
      c.contribute("key", "first");
    },
  });
  await runtime.install({
    id: "second",
    setup(c) {
      c.contribute("key", "second");
    },
  });
  expect(runtime.contributions()).toEqual(["first"]);
  expect(runtime.inventory().find((p) => p.id === "second")?.status).toBe("error");
  await runtime.install({
    id: "broken",
    setup(c) {
      c.contribute("partial", "partial");
      throw Error("activation failed");
    },
  });
  expect(runtime.contributions()).toEqual(["first"]);
});

test("observer failures are isolated, events are immutable, retained contexts cannot register", async () => {
  const runtime = createPluginRuntime<string>();
  let retained: Parameters<Parameters<typeof runtime.install>[0]["setup"]>[0] | undefined;
  const seen: string[] = [];
  await runtime.install({
    id: "bad",
    setup(c) {
      retained = c;
      c.hook("turn.before", (event) => {
        (event as { threadId: string }).threadId = "changed";
      });
    },
  });
  await runtime.install({
    id: "good",
    setup(c) {
      c.hook("turn.before", (e) => {
        seen.push(e.threadId);
      });
    },
  });
  await runtime.emit("turn.before", { threadId: "original", turnId: "one" });
  expect(seen).toEqual(["original"]);
  expect(runtime.inventory().find((p) => p.id === "bad")?.error).toContain("read only");
  await runtime.setEnabled("bad", false);
  expect(() => retained!.contribute("late", "late")).toThrow("inactive");
});

test("nested hook data is frozen and a disabled hook never starts", async () => {
  const runtime = createPluginRuntime<string>();
  const seen: number[] = [];
  await runtime.install({
    id: "mutator",
    setup(c) {
      c.hook("turn.before", (event) => {
        (event as unknown as { detail: { value: number } }).detail.value = 2;
      });
    },
  });
  await runtime.install({
    id: "reader",
    setup(c) {
      c.hook("turn.before", (event) => {
        seen.push((event as unknown as { detail: { value: number } }).detail.value);
      });
    },
  });
  const event = { threadId: "t", turnId: "one", detail: { value: 1 } };
  await runtime.emit("turn.before", event);
  expect(seen).toEqual([1]);
});

test("committed operation receipt hook ignores starts and repeated request updates", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-plugin-receipts-"));
  try {
    const journal = new ActionJournal(join(root, "journal.json"));
    const runtime = createPluginRuntime<string>();
    const seen: string[] = [];
    await runtime.install({
      id: "observer",
      setup(c) {
        c.hook("op.after", (event) => {
          seen.push(event.key);
        });
      },
    });
    const stop = observePluginOperations(journal, runtime.emit);
    const requestId = randomUUID();
    await journal.recordFact({ kind: "turn", phase: "started" }, { requestId });
    expect(seen).toEqual([]);
    await journal.recordFact(
      { kind: "usage", event: "host_op", counters: { op: "example.read", outcome: "succeeded" } },
      { requestId },
    );
    await journal.recordFact(
      { kind: "usage", event: "host_op", counters: { op: "example.read", outcome: "succeeded" } },
      { requestId },
    );
    expect(seen).toEqual(["example.read"]);
    await runtime.setEnabled("observer", false);
    await journal.recordFact(
      { kind: "usage", event: "host_op", counters: { op: "later.read", outcome: "failed" } },
      { requestId: randomUUID() },
    );
    expect(seen).toEqual(["example.read"]);
    stop();
    await runtime.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("operation hooks observe the committed action result, never an uncommitted call response", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-plugin-result-"));
  try {
    const journal = new ActionJournal(join(root, "journal.json"));
    const runtime = createPluginRuntime<string>();
    const seen: unknown[] = [];
    await runtime.install({
      id: "reader",
      setup(c) {
        c.hook("op.after", (e) => {
          seen.push(e.result);
        });
      },
    });
    const stop = observePluginOperations(journal, runtime.emit);
    const row = await journal.admit(
      {
        id: randomUUID(),
        kind: "workflow",
        key: "sample.read",
        destination: { kind: "host" },
        input: {},
        bases: {},
        ...crossingOf("human"),
      },
      async () => ({}),
      async () => ({ value: 42, nested: { kept: true } }),
    );
    await journal.wait(row.id);
    expect(seen).toEqual([{ value: 42, nested: { kept: true } }]);
    stop();
    await runtime.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
