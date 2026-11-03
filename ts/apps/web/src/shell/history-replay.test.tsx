// @vitest-environment jsdom
import { test, expect, vi } from "vite-plus/test";
import { act, render, waitFor } from "@testing-library/react";
import { z } from "zod";
import {
  bindWork,
  workKey,
  pane,
  actionReceiptSchema,
  type ActionReceipt,
  type RouteGraph,
} from "@pe/agent-contracts";
import { RouteWorkspace } from "../../../../packages/runtime/src/route-workspace";
import { GraphHistory } from "./mount-timeline";
import { workVerb } from "./verbs";
import { testSubject, testFields, testSources, testReadings } from "../test-route-subject";

test("fresh host replay renders identical History with human edits and committed invocations", async () => {
  const route = `replay-${crypto.randomUUID()}`;
  const key = bindWork(route, null, "fan");
  const schema = z.object({ flow: z.number().default(0) });
  const disk = new Map<string, unknown>([
    [workKey(key), { version: 1, revision: 0, doc: { flow: 0 } }],
  ]);
  const host = () =>
    new RouteWorkspace({
      registrations: [{ spec: { route, title: route, description: route, schema } }],
      store: {
        getState: async ({ targetKey }) => structuredClone(disk.get(targetKey) ?? null),
        setState: async ({ targetKey, value }) => {
          disk.set(targetKey, structuredClone(value));
        },
      },
    });
  const graph: RouteGraph<any, z.output<typeof schema>> = {
    ...testSubject,
    key: route,
    address: route,
    name: route,
    work: schema,
    fields: testFields,
    readings: testReadings,
    workFields: { flow: { label: "fan flow" } },
    verbs: {
      edit: workVerb(
        { label: "Edit fan flow", input: z.object({}) },
        { patches: () => [{ path: ["flow"], value: 950 }] },
      ),
      write: { label: "Write to Revit", kind: "command", does: "ducts.apply-losses" } as never,
    },
    panes: { body: { label: "Body", purpose: "History", draws: [], verbs: ["edit"] } },
    stages: { main: { word: "Main", panes: ["body"], verbs: [] } },
    layout: pane("body"),
  };
  let receipt: ActionReceipt | null = null;
  const mount = async (workspace: RouteWorkspace) => {
    vi.resetModules();
    const { createGraphMount } = await import("./mount-owner");
    const { workVerb } = await import("./verbs");
    const mountedGraph = {
      ...graph,
      verbs: {
        ...graph.verbs,
        edit: workVerb(
          { label: "Edit fan flow", input: z.object({}) },
          {
            patches: () => [{ path: ["flow"], value: 950 }],
            history: { describe: () => ({ label: "flow MUAS-1" }) },
          },
        ),
      },
    };
    let deliver!: (receipt: ActionReceipt, work: typeof key) => void;
    const owner = createGraphMount(mountedGraph, {
      sources: testSources,
      binding: () => ({ subject: null, args: {} }),
      getSnapshot: () => {
        const saved = disk.get(workKey(key)) as
          | { revision: number; doc: z.output<typeof schema> }
          | undefined;
        return {
          target: { kind: "host" },
          work: { handle: { key, revision: saved?.revision ?? 0 }, doc: saved?.doc ?? { flow: 0 } },
        };
      },
      subscribe: (notify) => workspace.subscribe(() => notify()),
      subscribeAcceptedDeltas: (_, accept) => workspace.observeAccepted(key, accept),
      subscribeReceipts: (accept) => {
        deliver = accept;
        if (receipt) accept(receipt, key);
        return () => {};
      },
      receiptPaths: () => [["flow"]],
      write: (_, request) => workspace.write(key, route, "human", request),
    });
    const disconnect = owner.connect();
    const ui = render(<GraphHistory owner={owner} />);
    return {
      owner,
      ui,
      deliver: (value: ActionReceipt) => deliver(value, key),
      close: () => {
        ui.unmount();
        disconnect();
        owner.dispose();
      },
    };
  };
  const workspace = host();
  const one = await mount(workspace);
  await act(async () => {
    const result = await one.owner.control("edit").run();
    if (result.state !== "done") throw Error(JSON.stringify(result));
  });
  await act(async () => {
    receipt = actionReceiptSchema.parse({
      id: "write-1",
      key: "ducts.apply-losses",
      caller: { kind: "human", via: "local" },
      target: { kind: "host" },
      basis: null,
      input: {},
      consumes: [],
      steps: [],
      prepared: { state: "unprepared" },
      recovery: [],
      startedAt: "2026-11-02T12:00:00Z",
      state: "succeeded",
      result: {},
    });
    one.deliver({ ...receipt, state: "running" } as ActionReceipt);
    expect(
      await workspace.publish(key, route, [{ path: ["flow"], value: 1000 }], 1, receipt.id),
    ).toMatchObject({ ok: true });
    one.deliver(receipt);
  });
  const before = one.ui.container.textContent;
  expect(before).toContain("flow MUAS-1");
  expect(before).toContain("applied");
  expect(before).toContain("Write to Revit");
  expect(before).not.toContain("running");
  one.close();
  const two = await mount(host());
  try {
    await waitFor(() => expect(two.ui.container.textContent).toBe(before));
  } finally {
    two.close();
  }
});
