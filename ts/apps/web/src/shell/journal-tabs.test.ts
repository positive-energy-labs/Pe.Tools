// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { act, render } from "@testing-library/react";
import { createElement } from "react";
import { z } from "zod";
import { bindWork, pane, type RouteGraph, type WorkWrite } from "@pe/agent-contracts";
import { RouteWorkspace } from "../../../../packages/runtime/src/route-workspace";
import { GraphHistory } from "./mount";

async function tabs() {
  const route = `journal-tabs-${crypto.randomUUID()}`;
  const key = bindWork(route, null, "fan-sheet");
  const schema = z.object({ rules: z.record(z.string(), z.string()), drop: z.number() });
  type Work = z.output<typeof schema>;
  let stored = { version: 1, revision: 78, doc: { rules: {}, drop: 0.1 } as Work };
  const listeners = new Set<() => void>();
  const host = new RouteWorkspace({
    registrations: [{ spec: { route, title: route, description: route, schema } }],
    store: {
      getState: async () => structuredClone(stored),
      setState: async ({ value }) => {
        stored = structuredClone(value) as typeof stored;
        for (const notify of listeners) notify();
      },
    },
  });
  const graph: RouteGraph<{}, Work> = {
    key: route,
    address: route,
    name: route,
    fields: {},
    work: schema,
    readings: {},
    verbs: {},
    cells: [
      { segment: "rules", groupOf: (id) => [id], label: () => "Round Elbow 1 D" },
      { segment: null, key: "drop", groupOf: () => [], label: () => "DS-1 drop" },
    ],
    panes: { main: { label: "Main", purpose: "Journal proof", draws: [], verbs: [] } },
    stages: { main: { word: "Main", panes: ["main"], verbs: [] } },
    layout: pane("main"),
  };
  const mount = async () => {
    // Independent module registries model two browser tabs, not two readers in one page.
    vi.resetModules();
    const { createGraphMount } = await import("./mount-owner");
    const requests: WorkWrite[] = [];
    const owner = createGraphMount(graph, {
      getSnapshot: () => ({
        target: { kind: "host" },
        work: {
          handle: { key, revision: stored.revision },
          doc: stored.doc,
        },
      }),
      subscribe: (notify) => {
        listeners.add(notify);
        return () => listeners.delete(notify);
      },
      sources: {},
      subscribeAcceptedDeltas: (_, accept) => host.observeAccepted(key, accept),
      write: (_, request) => {
        requests.push(structuredClone(request));
        return host.write(key, route, "human", request);
      },
    });
    const disconnect = owner.connect();
    return {
      owner,
      requests,
      close: () => {
        disconnect();
        owner.dispose();
      },
    };
  };
  const a = await mount(),
    b = await mount();
  const edit = async (tab: typeof a, patches: WorkWrite["patches"], press: string) => {
    expect(
      (
        await tab.owner.context.write(key, {
          patches,
          expectedRevision: stored.revision,
          press,
        })
      ).ok,
    ).toBe(true);
  };
  return {
    a,
    b,
    key,
    edit,
    doc: () => stored.doc,
    revision: () => stored.revision,
    close: () => {
      a.close();
      b.close();
    },
  };
}

test("X1: a foreign composer revert supersedes the named rule edit without becoming a local undo", async () => {
  const f = await tabs();
  const history = render(
    createElement(GraphHistory<{}, ReturnType<typeof f.doc>>, { owner: f.a.owner }),
  );
  try {
    await act(async () => {
      await f.edit(f.a, [{ path: ["rules", "round-elbow-1d"], value: "CD3-1" }], "rule");
      await f.edit(f.a, [{ path: ["drop"], value: 0.05 }], "drop");
      await f.edit(f.b, [{ path: ["rules", "round-elbow-1d"] }], "composer-revert");
    });
    expect(f.revision()).toBe(81);
    const steps = f.a.owner.journal(f.key).read().undo;
    expect(steps.map(({ press }) => press)).toEqual(["rule", "drop"]);
    expect(steps[0]).toMatchObject({
      label: "Edit Round Elbow 1 D",
      superseded: {
        revision: 81,
        message: expect.stringContaining("changed elsewhere at r81"),
      },
    });
    expect(steps.every(({ label }) => Boolean(label?.trim()))).toBe(true);
    expect(history.getByText(/Edit Round Elbow 1 D.*superseded at r81/)).toBeTruthy();
    expect(history.queryByText("No activity yet")).toBeNull();
    await act(async () => {
      expect((await f.a.owner.restore("undo"))?.ok).toBe(true);
    });
    const before = f.a.requests.length;
    await act(async () => {
      expect(await f.a.owner.restore("undo")).toMatchObject({
        ok: false,
        code: "barrier",
        message: expect.stringContaining("undo would overwrite it"),
      });
    });
    expect(f.a.requests).toHaveLength(before);
    expect(f.doc()).toEqual({ rules: {}, drop: 0.1 });
    expect(f.a.owner.journal(f.key).read().undo).toHaveLength(1);
  } finally {
    history.unmount();
    f.close();
  }
});

test("redo refuses a foreign write and keeps the named superseded entry", async () => {
  const f = await tabs();
  try {
    await f.edit(f.a, [{ path: ["drop"], value: 0.05 }], "drop");
    expect((await f.a.owner.restore("undo"))?.ok).toBe(true);
    await f.edit(f.b, [{ path: ["drop"], value: 0.2 }], "foreign-drop");
    const before = f.a.requests.length;
    expect(await f.a.owner.restore("redo")).toMatchObject({ ok: false, code: "barrier" });
    expect(f.a.requests).toHaveLength(before);
    expect(f.doc().drop).toBe(0.2);
    expect(f.a.owner.journal(f.key).read().redo[0]).toMatchObject({
      label: "Edit DS-1 drop",
      superseded: { revision: 81 },
    });
  } finally {
    f.close();
  }
});

test("a foreign write on disjoint paths leaves the local undo usable", async () => {
  const f = await tabs();
  try {
    await f.edit(f.a, [{ path: ["drop"], value: 0.05 }], "drop");
    await f.edit(f.b, [{ path: ["rules", "round-elbow-1d"], value: "CD3-1" }], "foreign-rule");
    expect(
      f.a.owner
        .journal(f.key)
        .read()
        .undo.map(({ press }) => press),
    ).toEqual(["drop"]);
    expect((await f.a.owner.restore("undo"))?.ok).toBe(true);
    expect(f.doc()).toEqual({ rules: { "round-elbow-1d": "CD3-1" }, drop: 0.1 });
  } finally {
    f.close();
  }
});
