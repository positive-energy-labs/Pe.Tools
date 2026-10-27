import { invokeCommand } from "./command-fixture.ts";
import { expect, test } from "vite-plus/test";
import { createPluginRuntime } from "@pe/agent-contracts";
import { observePluginOperations } from "../src/plugin-receipts.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { crossingOf } from "./callers.ts";

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
    const row = await invokeCommand(
      journal,
      {
        id: randomUUID(),
        key: "sample.read",
        target: { kind: "host" },
        input: {},
        ...crossingOf("human"),
        effects: [],
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
