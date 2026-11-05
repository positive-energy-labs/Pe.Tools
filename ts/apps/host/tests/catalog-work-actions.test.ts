import { detachedBridge, sessionView, testConsents } from "./effect-test.ts";
import { workWriteBoundary } from "../src/work-write-boundary.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import { address, catalogWorkCommands, catalogWorkSpecs } from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { markDispatched } from "../src/action-dispatch.ts";
import { commandResources } from "../src/command-reads.ts";
import { catalogWorkExecutors } from "../src/catalog-work-actions.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import type { ConsentEvent } from "../src/run-consent.ts";
import { bindControl } from "../src/control.ts";

test("parameter links apply refuses before dispatch until the plan preserves stored ids", async () => {
  const executor = catalogWorkExecutors(detachedBridge())["parameter-links.apply"]!;
  await expect(executor.bind({
    admission: { id: "blocked-profile", key: "parameter-links.apply", target: { kind: "document", ref: { session: "s", openId: "o" } }, input: {} },
    caller: { kind: "human", via: "local" },
    basis: { kind: "human" },
    work: new RouteWorkspace({ registrations: [] }),
    consumed: [],
    selectWork: async () => { throw Error("No Work should be read by the refused executor"); },
    read: { receipts: () => [] },
  })).rejects.toMatchObject({ refusal: { kind: "domain", code: "catalog.stored-profile-required" } });
});

test("catalog Work plans with no native call and applies the derived request once through the boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pe-catalog-work-"));
  const target = { session: "s", openId: "o" };
  const at = address("C:/Models/Tables.rvt");
  const key = { binding: "address" as const, target: at, route: "data-tables" };
  const spec = catalogWorkSpecs["data-tables"];
  let state: unknown;
  const work = new RouteWorkspace({
    registrations: [{ spec }],
    store: { getState: async () => state, setState: async ({ value }) => void (state = structuredClone(value)) },
  });
  const calls: { key: string; input: unknown }[] = [];
  const events: ConsentEvent[] = [];
  const runs = testConsents((_run, event) => events.push(event));
  const run = { thread: "t", turn: "u" };
  runs.open(run);
  bindControl({ runs });
  const bridge = detachedBridge({
    list: Effect.succeed([
      sessionView({
        sessionId: target.session,
        connected: true,
        processId: 42,
        processStartUtcUnixMs: 1000,
        lane: hostOwnership.lane,
        sourceRoot: hostOwnership.sourceRoot,
        serviceName: hostOwnership.serviceName,
        state: { openDocuments: [{ openId: target.openId, address: at, title: "Tables.rvt", isActive: true, isFamilyDocument: false }] },
      }),
    ]),
    invoke: (op: string, input: unknown, _s?: string, _d?: string | null, id?: string) =>
      Effect.promise(async () => {
        if (id) await markDispatched(id);
        calls.push({ key: op, input });
        return { target: { session: _s!, document: null }, value: { written: 1 } };
      }),
  });
  const write = catalogWorkExecutors(bridge)["data-table.apply"]!;
  try {
    const staged = (value: unknown) => ({ edit: { value } });
    await work.publish(key, "data-tables", [
      { path: ["name"], value: staged("T") },
      { path: ["columns"], value: { "text:0": staged("A"), "text:1": staged("B") } },
      { path: ["rows"], value: { r1: { "text:0": staged("a1"), "text:1": staged("x") } } },
    ], 0);
    const rendered = (await work.read(key, "data-tables"))!;
    const deps = { workspace: work, sdk: sdkSessions };
    const entries = {
      "data-table.apply": workWriteBoundary(write, bridge, deps, spec as never),
      "data-table.apply.plan": workWriteBoundary({ ...write, definition: catalogWorkCommands["data-table.apply.plan"] }, bridge, deps, spec as never),
    } as Record<string, ReturnType<typeof workWriteBoundary>>;
    const owner = new ActionJournal(join(directory, "journal.jsonl"));
    owner.bindCommands({
      ...commandResources(bridge, deps, async (id) => (await owner.list(undefined, id))[0]),
      resolve: (k) => entries[k]!,
    });
    const handle = { key, revision: rendered.revision };
    await owner.invoke(
      { id: "plan", key: "data-table.apply.plan", target: { kind: "document", ref: target }, input: { work: handle } },
      { caller: { kind: "human", via: "local" }, basis: { kind: "human" } },
    );
    const plan = await owner.wait("plan");
    expect(plan.state, JSON.stringify(plan)).toBe("succeeded");
    expect(calls).toEqual([]);
    await owner.invoke(
      { id: "apply", key: "data-table.apply", target: { kind: "document", ref: target }, input: { work: handle } },
      { caller: { kind: "pea", context: "catalog-test", thread: run.thread, run, root: run }, basis: null },
    );
    await vi.waitFor(() => expect(events.some((e) => e.kind === "permission_request")).toBe(true));
    const ask = events.find((e) => e.kind === "permission_request");
    if (ask?.kind !== "permission_request") throw Error("Missing consent request");
    runs.decide(run.thread, ask.requestId, "allow_now");
    const receipt = await owner.wait("apply");
    expect(receipt.state, JSON.stringify(receipt)).toBe("succeeded");
    expect(calls).toEqual([
      { key: "data-table.apply", input: { table: { name: "T", columns: [{ heading: "A", kind: "Text" }, { heading: "B", kind: "Text" }], rows: [{ key: "r1", values: ["a1", "x"] }] } } },
    ]);
    // Catalog Work is the authored source: the receipt keeps its cells.
    expect((await work.read(key, "data-tables"))!.doc).toMatchObject({ rows: { r1: { "text:1": staged("x") } } });
  } finally {
    runs.closeAll();
    bindControl({ runs: undefined });
    await rm(directory, { recursive: true, force: true });
  }
});
