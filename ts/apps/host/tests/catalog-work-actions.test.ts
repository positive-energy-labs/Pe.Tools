import { detachedBridge, sessionView, testConsents } from "./effect-test.ts";
import { workWriteBoundary } from "../src/work-write-boundary.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import { address, catalogWorkCommands, catalogWorkSpecs, type RouteStatePatch } from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { markDispatched } from "../src/action-dispatch.ts";
import { commandResources } from "../src/command-reads.ts";
import { catalogWorkExecutors } from "../src/catalog-work-actions.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import type { ConsentEvent } from "../src/run-consent.ts";
import { bindControl } from "../src/control.ts";

const target = { session: "s", openId: "o" };
const at = address("C:/Models/A.rvt");
const staged = (value: unknown) => ({ edit: { value } });

/** One owner's plan then apply through the real journal, boundary and generic executor over a fake bridge. */
async function catalogRun(
  owner: "data-tables" | "parameter-links",
  patches: RouteStatePatch[],
  native: (op: string, input: unknown) => unknown,
  between: () => void = () => {},
) {
  const directory = await mkdtemp(join(tmpdir(), "pe-catalog-work-"));
  const key = { binding: "address" as const, target: at, route: owner };
  const spec = catalogWorkSpecs[owner];
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
        state: { openDocuments: [{ openId: target.openId, address: at, title: "A.rvt", isActive: true, isFamilyDocument: false }] },
      }),
    ]),
    invoke: (op: string, input: unknown, _s?: string, _d?: string | null, id?: string) =>
      Effect.promise(async () => {
        if (id) await markDispatched(id);
        calls.push({ key: op, input });
        return { target: { session: _s!, document: null }, value: native(op, input) };
      }),
  });
  const apply = owner === "data-tables" ? "data-table.apply" : "parameter-links.apply";
  const deps = { workspace: work, sdk: sdkSessions };
  const write = catalogWorkExecutors(bridge, deps)[apply]!;
  try {
    await work.publish(key, owner, patches, 0);
    const rendered = (await work.read(key, owner))!;
    const entries = {
      [apply]: workWriteBoundary(write, bridge, deps, spec as never),
      [`${apply}.plan`]: workWriteBoundary({ ...write, definition: catalogWorkCommands[`${apply}.plan`] }, bridge, deps, spec as never),
    } as Record<string, ReturnType<typeof workWriteBoundary>>;
    const journal = new ActionJournal(join(directory, "journal.jsonl"));
    journal.bindCommands({
      ...commandResources(bridge, deps, async (id) => (await journal.list(undefined, id))[0]),
      resolve: (k) => entries[k]!,
    });
    const handle = { key, revision: rendered.revision };
    await journal.invoke(
      { id: "plan", key: `${apply}.plan`, target: { kind: "document", ref: target }, input: { work: handle } },
      { caller: { kind: "human", via: "local" }, basis: { kind: "human" } },
    );
    const plan = await journal.wait("plan");
    const planCalls = calls.map((c) => c.key);
    between();
    await journal.invoke(
      { id: "apply", key: apply, target: { kind: "document", ref: target }, input: { work: handle } },
      { caller: { kind: "pea", context: "catalog-test", thread: run.thread, run, root: run }, basis: null },
    );
    // A moved base can refuse at preflight, before consent opens; otherwise consent, then the recheck.
    const done = journal.wait("apply");
    const asked = vi.waitFor(() => {
      const ask = events.find((e) => e.kind === "permission_request");
      if (ask?.kind !== "permission_request") throw Error("Missing consent request");
      return ask;
    });
    const first = await Promise.race([done.then(() => null), asked]);
    if (first) runs.decide(run.thread, first.requestId, "allow_now");
    const receipt = await done;
    return {
      plan,
      planCalls,
      receipt,
      applied: calls.filter((c) => c.key !== "revit.detail.parameter-links"),
      doc: (await work.read(key, owner))!.doc,
    };
  } finally {
    runs.closeAll();
    bindControl({ runs: undefined });
    await rm(directory, { recursive: true, force: true });
  }
}

test("catalog Work plans with no native call and applies the derived request once through the boundary", async () => {
  const r = await catalogRun("data-tables", [
    { path: ["name"], value: staged("T") },
    { path: ["columns"], value: { "text:0": staged("A"), "text:1": staged("B") } },
    { path: ["rows"], value: { r1: { "text:0": staged("a1"), "text:1": staged("x") } } },
  ], () => ({ written: 1 }));
  expect(r.plan.state, JSON.stringify(r.plan)).toBe("succeeded");
  expect(r.planCalls).toEqual([]);
  expect(r.receipt.state, JSON.stringify(r.receipt)).toBe("succeeded");
  expect(r.applied).toEqual([
    { key: "data-table.apply", input: { table: { name: "T", columns: [{ heading: "A", kind: "Text" }, { heading: "B", kind: "Text" }], rows: [{ key: "r1", values: ["a1", "x"] }] } } },
  ]);
  // Catalog Work is the authored source: the receipt keeps its cells.
  expect(r.doc).toMatchObject({ rows: { r1: { "text:1": staged("x") } } });
});

const def = (name: string) => ({ sourceCategoryId: -2001040, sourceParameter: { name: "MOCP" }, relationship: "sameElement" as const, targetParameter: { name } });
const stored = (d2 = "B2") => ({ formatVersion: 1, definitions: [{ id: "D1", ...def("B1") }, { id: "D2", ...def(d2) }], assignments: [] });
const detail = (profile: unknown) => ({ profile, status: { hasStoredProfile: true, updaterRegistered: true, activeDefinitionCount: 2, activeAssignmentCount: 0 }, profileChanged: false, appliedWriteCount: 0 });

test("parameter links: stored D1 and D2 survive a staged D3; the plan only reads and shows the before it read", async () => {
  const r = await catalogRun("parameter-links", [{ path: ["definitions"], value: { D3: staged(def("B3")) } }], (op) =>
    op === "revit.detail.parameter-links" ? detail(stored()) : { written: 1 },
  );
  expect(r.plan.state, JSON.stringify(r.plan)).toBe("succeeded");
  expect(r.planCalls).toEqual(["revit.detail.parameter-links"]);
  expect((r.plan as { result?: { evidence?: unknown } }).result?.evidence).toMatchObject({
    before: stored(),
    touched: [{ path: ["definitions", "D3"], before: null, after: { id: "D3", ...def("B3") } }],
  });
  expect(r.receipt.state, JSON.stringify(r.receipt)).toBe("succeeded");
  // The native apply gets the whole merged profile, read again after consent, never staged ids alone.
  expect(r.applied).toMatchObject([
    { key: "revit.apply.parameter-links", input: { reconcile: true, profile: { ...stored(), definitions: [...stored().definitions, { id: "D3", ...def("B3") }] } } },
  ]);
});

test("parameter links: a stored profile that moved after the plan refuses the apply and keeps the cells", async () => {
  let d2 = "B2";
  const r = await catalogRun(
    "parameter-links",
    [{ path: ["definitions"], value: { D3: staged(def("B3")) } }],
    (op) => (op === "revit.detail.parameter-links" ? detail(stored(d2)) : { written: 1 }),
    () => void (d2 = "B2-changed-in-revit"),
  );
  expect(r.plan.state).toBe("succeeded");
  expect(r.receipt).toMatchObject({ state: "failed", notDispatched: true, refusal: { code: "preview.stale" } });
  expect(r.applied).toEqual([]);
  expect(r.doc).toMatchObject({ definitions: { D3: staged(def("B3")) } });
});
