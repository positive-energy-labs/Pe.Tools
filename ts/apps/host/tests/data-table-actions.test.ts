import { afterEach, expect, test } from "vite-plus/test";
import { Effect } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  actionAdmissionSchema,
  commands,
  dataTablesWorkSchema,
  workKey,
  type WorkKey,
} from "@pe/agent-contracts";
import { createRouteRegistrations } from "../../../packages/mcps/src/pea/routes.ts";
import { RouteWorkspace } from "@pe/runtime";
import { ActionJournal } from "../src/action-journal.ts";
import { commandRegistry } from "../src/command-registry.ts";
import { commandResources } from "../src/command-reads.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { markDispatched } from "../src/action-dispatch.ts";
import type { RevitBridge } from "../src/bridge.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { crossingOf } from "./callers.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const release of cleanup.splice(0)) await release();
});
const draft = {
  name: "Loads",
  isNew: true,
  columns: [{ heading: "Load", kind: "Number" as const }],
  rows: [{ key: "a", values: ["1"] }],
};
const ref = { session: "A", openId: "open-A" };
const key: WorkKey = { binding: "open", route: "data-tables", target: null, open: ref };

async function fixture(
  options: { fail?: boolean; duringNative?: (work: RouteWorkspace) => Promise<void> } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "pe-data-table-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const stored = new Map<string, unknown>();
  const registrations = createRouteRegistrations();
  const work = new RouteWorkspace({
    registrations,
    store: {
      getState: async ({ targetKey }) => structuredClone(stored.get(targetKey) ?? null),
      setState: async ({ targetKey, value }) => {
        stored.set(targetKey, structuredClone(value));
      },
    },
  });
  const sent: { key: string; input: unknown; session?: string; document?: string }[] = [];
  const bridge = {
    list: Effect.succeed([
      {
        sessionId: "A",
        connected: true,
        lane: hostOwnership.lane,
        sourceRoot: hostOwnership.sourceRoot,
        serviceName: hostOwnership.serviceName,
        processId: 42,
        processStartUtcUnixMs: 1000,
        state: { openDocuments: [{ ...ref, isFamilyDocument: false }] },
      },
    ]),
    invoke: (key: string, input: unknown, session?: string, document?: string, id?: string) =>
      Effect.promise(async () => {
        if (id) await markDispatched(id);
        sent.push({ key, input, session, document });
        if (options.fail) throw Error("Native apply failed");
        await options.duringNative?.(work);
        return {
          value: {
            dryRun: false,
            table: { ...draft, placements: [] },
            warnings: ["Native warning"],
          },
        };
      }),
  } as unknown as RevitBridge["Service"];
  const owner = new ActionJournal(join(directory, "actions.json"));
  const deps = { sdk: sdkSessions, workspace: work };
  owner.bindCommands({
    ...commandResources(bridge, deps, async (id) => (await owner.list(undefined, id))[0]),
    resolve: commandRegistry(
      bridge,
      new TakeoffCaptures(join(directory, "captures")),
      deps,
      async () => {
        throw Error("No local operation expected");
      },
    ),
  });
  await work.write(key, "data-tables", "human", {
    patches: [{ path: ["draft"], value: draft }],
    expectedRevision: 0,
    press: "edit",
    kind: "apply",
  });
  const invoke = async (
    table = {
      name: draft.name,
      columns: draft.columns,
      rows: draft.rows,
      pruneMissingRows: true as const,
    },
  ) => {
    const admitted = await owner.invoke(
      actionAdmissionSchema.parse({
        id: crypto.randomUUID(),
        key: "data-table.apply",
        target: { kind: "document", ref },
        input: commands["data-table.apply"].work.bind({ table }, { key, revision: 1 }),
      }),
      crossingOf(),
    );
    return owner.wait(admitted.id);
  };
  return { work, registrations, sent, invoke };
}

test("host registry persists Data Tables Work per document and admits its shared schema", async () => {
  const f = await fixture();
  expect(f.registrations.find((item) => item.spec.route === "data-tables")?.spec.schema).toBe(
    dataTablesWorkSchema,
  );
  const other: WorkKey = { ...key, open: { ...ref, openId: "open-B" } };
  expect(workKey(other)).not.toBe(workKey(key));
  expect((await f.work.view(other, "data-tables"))?.doc).toEqual({ draft: null });
  expect((await f.work.read(key, "data-tables"))?.doc).toEqual({ draft });
});

test("Apply uses the exact document and settles Work through the command publication", async () => {
  const f = await fixture();
  const result = await f.invoke();
  expect(result).toMatchObject({
    state: "succeeded",
    result: { name: "Loads", warnings: ["Native warning"] },
  });
  expect(f.sent).toEqual([
    {
      key: "data-table.apply",
      input: {
        table: { name: "Loads", columns: draft.columns, rows: draft.rows, pruneMissingRows: true },
      },
      session: "A",
      document: "open-A",
    },
  ]);
  expect((await f.work.read(key, "data-tables"))?.doc).toEqual({
    draft: { ...draft, isNew: false },
  });
  expect(result.steps).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: "publication", state: "succeeded" })]),
  );
});

test("Apply refuses a draft mismatch before dispatch and retains Work after native failure", async () => {
  const f = await fixture({ fail: true });
  const mismatch = await f.invoke({
    name: "Other",
    columns: draft.columns,
    rows: draft.rows,
    pruneMissingRows: true,
  });
  expect(mismatch.state).not.toBe("succeeded");
  expect(f.sent).toHaveLength(0);
  const failed = await f.invoke();
  expect(failed.state).not.toBe("succeeded");
  expect((await f.work.read(key, "data-tables"))?.doc).toEqual({ draft });
});

test("settlement preserves a replacement draft written while native Apply runs", async () => {
  const replacement = { ...draft, name: "Another table" };
  const f = await fixture({
    duringNative: async (work) => {
      const current = await work.read(key, "data-tables");
      await work.write(key, "data-tables", "human", {
        patches: [{ path: ["draft"], value: replacement }],
        expectedRevision: current!.revision,
        press: "replace",
        kind: "apply",
      });
    },
  });
  const result = await f.invoke();
  expect(result).toMatchObject({
    state: "incomplete",
    steps: expect.arrayContaining([
      expect.objectContaining({ kind: "native", state: "succeeded" }),
    ]),
  });
  expect((await f.work.read(key, "data-tables"))?.doc).toEqual({ draft: replacement });
});
