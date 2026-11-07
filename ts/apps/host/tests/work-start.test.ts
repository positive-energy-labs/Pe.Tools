import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { bindWork, type Caller } from "@pe/agent-contracts";
import { RouteWorkspace } from "@pe/runtime";
import { ActionJournal } from "../src/action-journal.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { workStartExecutor } from "../src/work-start.ts";
import { bindControl } from "../src/control.ts";
import { testConsents } from "./effect-test.ts";
import type { ConsentEvent } from "../src/run-consent.ts";

test("Work start validates seeds, waits for consent, and cannot overwrite a winner after consent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-work-start-"));
  const workspace = new RouteWorkspace({
    registrations: [],
    store: fileRouteDocumentStore(join(dir, "work")),
  });
  workspace.register({
    spec: {
      route: "sample",
      title: "Sample",
      description: "Start witness",
      schema: z.object({ count: z.number() }),
    },
  });
  const events: ConsentEvent[] = [],
    runs = testConsents((_, event) => events.push(event));
  const run = { thread: "start-thread", turn: "start-turn" };
  runs.open(run);
  bindControl({ runs, acquired: () => null });
  const caller: Caller = {
    kind: "pea",
    context: "host-minted",
    thread: run.thread,
    run,
    root: run,
  };
  const journal = new ActionJournal(join(dir, "journal.jsonl"), Date.now, () => null, 1);
  journal.bindCommands({
    work: workspace,
    probe: async () => null,
    resolve: () => workStartExecutor(workspace),
  });
  const key = bindWork("sample", null, "one");
  const invoke = async (id: string, seed: unknown) => {
    await journal.invoke(
      { id, key: "work.start", target: { kind: "host" }, input: { key, seed } },
      { caller, basis: null },
    );
    return journal.wait(id);
  };
  try {
    expect((await invoke("invalid", { count: "wrong" })).state).toBe("failed");
    expect(await workspace.readRaw(key, "sample")).toBeNull();
    const pending = invoke("race", { count: 1 });
    const ask = await vi.waitFor(() => {
      const row = events.find((e) => e.kind === "permission_request");
      if (row?.kind !== "permission_request") throw Error("No consent request");
      return row;
    });
    expect(await workspace.readRaw(key, "sample")).toBeNull();
    expect(await workspace.start(key, { count: 2 }, "human")).toMatchObject({
      ok: true,
      revision: 1,
    });
    runs.decide(run.thread, ask.requestId, "allow_now");
    expect((await pending).state).toBe("failed");
    expect((await workspace.readRaw(key, "sample"))?.doc).toEqual({ count: 2 });
    const results = await Promise.all([
      workspace.start(key, { count: 3 }, "human"),
      workspace.start(key, { count: 4 }, "human"),
    ]);
    expect(results.every((result) => !result.ok)).toBe(true);
  } finally {
    runs.closeAll();
    await journal.close();
    await rm(dir, { recursive: true, force: true });
  }
});
