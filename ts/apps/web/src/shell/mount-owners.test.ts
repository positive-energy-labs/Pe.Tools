// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { pane, type RouteGraph, type WorkKey } from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { createRolePagePorts } from "./page-port";
import { createWorkScopeAcceptance } from "./work-scope-acceptance";
import { createGraphMount } from "./mount-owner";
import { testSubject, testFields, testReadings, testSources } from "../test-route-subject";

test("scope authority preserves hydration and rejects copied, departed and closed scopes", () => {
  const a: WorkKey = {
    binding: "open",
    route: "proof",
    target: null,
    open: { session: "S", openId: "A" },
  };
  let key = a;
  const owner = createWorkScopeAcceptance(() => ({ target: { kind: "host" }, work: key }));
  const first = owner.capture();
  key = structuredClone(a);
  expect(owner.capture()).toBe(first);
  expect(owner.current(structuredClone(first))).toBe(false);
  key = { ...a, open: { session: "S", openId: "B" } };
  const second = owner.capture();
  key = a;
  const third = owner.capture();
  expect(owner.current(first)).toBe(false);
  expect(owner.current(second)).toBe(false);
  expect(owner.current(third)).toBe(true);
  owner.close();
  expect(owner.current(third)).toBe(false);
});

test("legacy Page ports share C's role refusal before invoking their writer", () => {
  const writes: unknown[] = [];
  const ports = createRolePagePorts(
    { selected: { role: "selection" }, pose: { role: "pose" } },
    {
      readPage: () => ({ selected: [], pose: 1 }),
      movePage: (patch, origin) => {
        writes.push({ patch, origin });
        return { kind: "accepted", revision: 1, changed: true, membership: "unresolved" };
      },
    },
  );
  expect(ports.page.pose({ selected: [] }, "gesture").kind).toBe("refused");
  expect(writes).toEqual([]);
  expect(ports.page.select([]).kind).toBe("accepted");
  expect(writes).toEqual([
    { patch: { selected: [] }, origin: { kind: "human", source: "selection", history: "push" } },
  ]);
});

test("mounted role ports use the existing Page transition and retain the legacy view door", () => {
  type Page = { selected: string; camera: number; search: string };
  const graph: RouteGraph<Page, null> = {
    ...testSubject,
    key: "owner-ports",
    address: "owner-ports",
    name: "Owner ports",
    fields: {
      ...testFields,
      testSelected: { ...testFields.testSelected, role: "query" },
      selected: { ...field(z.string().default(""), {}), role: "selection" },
      camera: { ...field(z.number().default(1), {}), role: "pose" },
      search: { ...field(z.string().default(""), {}), role: "query" },
    },
    readings: testReadings,
    verbs: {},
    panes: { main: { label: "Main", purpose: "Proof", draws: [], verbs: [] } },
    stages: { main: { word: "Main", panes: ["main"], verbs: [] } },
    layout: pane("main"),
    transition: (_page, patch) =>
      patch.search === "refused"
        ? { refusal: { code: "not-ready", message: "Blocked query" } }
        : { patch },
  };
  const mount = createGraphMount(graph, {
    getSnapshot: () => ({ target: { kind: "host" }, work: null }),
    subscribe: () => () => {},
    sources: testSources,
    write: async () => {
      throw Error("Page ports cannot write Work");
    },
    subscribeAcceptedDeltas: () => () => {},
  });
  try {
    expect(mount.page.select("row").kind).toBe("accepted");
    expect(mount.view.read().page).toMatchObject({ selected: "row", camera: 1 });
    expect(mount.controls.query("search", "refused").kind).toBe("refused");
    expect(mount.view.read().page.search).toBe("");
    mount.view.setPage({ camera: 2 });
    expect(mount.page.read().camera).toBe(2);
    mount.dispose();
    expect(mount.page.select("late").kind).toBe("refused");
  } finally {
    mount.dispose();
  }
});

test("B publishes exact ack patches while the external snapshot lags and retires departed delivery", () => {
  const key: WorkKey = { binding: "workspace", route: "ack-owner", target: null, work: "a" };
  let current = key;
  const owner = createWorkScopeAcceptance(() => ({ target: { kind: "host" }, work: current }));
  const snapshot = { handle: { key, revision: 0 }, doc: { value: "old", server: "" } };
  owner.observe(snapshot);
  const writing = owner.begin();
  const ack = {
    key,
    kind: "apply" as const,
    by: "human" as const,
    press: "ack-owner",
    base: 0,
    revision: 1,
    undoable: true,
    patches: [
      { path: ["value"], value: "normalized" },
      { path: ["server"], value: "stamp" },
    ],
    inverse: [
      { path: ["value"], value: "old" },
      { path: ["server"], value: "" },
    ],
  };
  expect(owner.accept(writing, ack).kind).toBe("published");
  owner.observe(snapshot);
  expect(owner.readWork()).toEqual({
    handle: { key, revision: 1 },
    doc: { value: "normalized", server: "stamp" },
  });
  const late = owner.begin();
  current = { ...key, work: "b" };
  owner.capture();
  expect(owner.readWork()).toBeNull();
  expect(owner.accept(late, { ...ack, base: 1, revision: 2, press: "late" }).kind).toBe(
    "receipt-only",
  );
  expect(owner.readWork()).toBeNull();
  owner.close();
});
