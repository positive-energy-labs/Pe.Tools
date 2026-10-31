// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { bindWork, pane, type RouteGraph, type WorkWrite } from "@pe/agent-contracts";
import { RouteWorkspace } from "../../../../packages/runtime/src/route-workspace";
import { createGraphMount } from "./mount-owner";
import type { ReadingDelivery } from "./readings";
import { workVerb } from "./verbs";

function fixture() {
  const key = bindWork("history-proof", null, crypto.randomUUID());
  const schema = z.object({ amount: z.number() });
  let stored = { version: 1, revision: 0, doc: { amount: 1 } };
  let changed = () => {};
  const workspace = new RouteWorkspace({
    registrations: [{ spec: { route: key.route, title: "History", description: "Proof", schema } }],
    store: {
      getState: async () => structuredClone(stored),
      setState: async ({ value }) => {
        stored = structuredClone(value) as typeof stored;
        changed();
      },
    },
  });
  const deliveries: { revision: number | null; deliver: ReadingDelivery<number> }[] = [];
  const requests: WorkWrite[] = [];
  const graph: RouteGraph<Record<string, never>, z.output<typeof schema>> = {
    key: key.route,
    address: key.route,
    name: "History",
    fields: {},
    work: schema,
    readings: { total: { kind: "use", source: "total", retire: "target" } },
    verbs: {
      edit: workVerb(
        { label: "Edit", input: z.object({ amount: z.number() }) },
        {
          patches: (_, input) => [{ path: ["amount"], value: input.amount }],
          history: {
            readings: ["total"],
            describe: (before, input, after) => ({
              label: `amount → ${input.amount}`,
              meta: { before: before.readings.total?.value, after: after?.total?.value },
            }),
          },
        },
      ),
    },
    panes: { main: { label: "Main", purpose: "Proof", draws: ["total"], verbs: ["edit"] } },
    stages: { main: { word: "Main", panes: ["main"], verbs: [] } },
    layout: pane("main"),
  };
  const owner = createGraphMount(graph, {
    getSnapshot: () => ({
      target: { kind: "host" },
      work: { handle: { key, revision: stored.revision }, doc: stored.doc },
    }),
    subscribe: (notify) => {
      changed = notify;
      return () => {
        changed = () => {};
      };
    },
    subscribeAcceptedDeltas: (_, accept) =>
      workspace.subscribe((event) => {
        if (event.ok) accept(event);
      }),
    binding: (_, row) => ({ subject: null, args: row }),
    sources: {
      total: {
        kind: "use",
        key: (scope) => scope.workRevision,
        open: (ctx, deliver) => {
          deliveries.push({ revision: ctx.workRevision, deliver });
        },
      },
    },
    write: (_, request) => {
      requests.push(structuredClone(request));
      return workspace.write(key, key.route, "human", request);
    },
  });
  const disconnect = owner.connect();
  const release = owner.readings.mount(["total"]);
  deliveries[0]!.deliver({ kind: "complete", value: 10, revision: 1 });
  return {
    key,
    owner,
    deliveries,
    requests,
    dispose: () => {
      release();
      disconnect();
      owner.dispose();
    },
  };
}

test("a Work verb attaches metadata after acknowledgement and completes only from its fresh revision", async () => {
  const f = fixture();
  try {
    expect((await f.owner.control("edit", { amount: 2 }).run()).state).toBe("done");
    const journal = f.owner.journal(f.key);
    expect(journal.read().undo[0]).toMatchObject({
      label: "amount → 2",
      meta: { before: 10, after: undefined },
    });
    expect(f.requests[0]).not.toHaveProperty("history");
    expect(f.deliveries.at(-1)!.revision).toBe(1);
    // A retired attempt and a stale result must never become this edit's after-value.
    f.deliveries[0]!.deliver({ kind: "complete", value: 999, revision: 2 });
    f.deliveries.at(-1)!.deliver({ kind: "complete", value: 998, revision: 1, fresh: false });
    expect(journal.read().undo[0]!.meta).toEqual({ before: 10, after: undefined });
    f.deliveries.at(-1)!.deliver({ kind: "complete", value: 20, revision: 2 });
    expect(journal.read().undo[0]!.meta).toEqual({ before: 10, after: 20 });
    expect(await f.owner.restore("undo")).toMatchObject({ ok: true });
    expect(journal.read().redo[0]).toMatchObject({
      label: "amount → 2",
      meta: { before: 10, after: 20 },
    });
    expect(await f.owner.restore("redo")).toMatchObject({ ok: true });
    expect(journal.read().undo[0]).toMatchObject({
      label: "amount → 2",
      meta: { before: 10, after: 20 },
    });
  } finally {
    f.dispose();
  }
});

test("a later Work revision cannot fill an earlier edit's missing totals", async () => {
  const f = fixture();
  try {
    await f.owner.control("edit", { amount: 2 }).run();
    const old = f.deliveries.at(-1)!;
    await f.owner.control("edit", { amount: 3 }).run();
    old.deliver({ kind: "complete", value: 20, revision: 1 });
    f.deliveries.at(-1)!.deliver({ kind: "complete", value: 30, revision: 1 });
    const steps = f.owner.journal(f.key).read().undo;
    expect(steps).toHaveLength(2);
    expect(steps[0]!.meta).toEqual({ before: 10, after: undefined });
    expect(steps[1]!.meta).toEqual({ before: undefined, after: 30 });
  } finally {
    f.dispose();
  }
});
