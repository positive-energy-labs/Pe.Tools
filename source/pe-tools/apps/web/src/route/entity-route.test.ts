import { expect, test, vi } from "vite-plus/test";

import { entityRoute, type Ctx, type EntityPage, type PodRow } from "./manifest";

const def = {
  key: "things",
  name: "Things",
  entity: "thing",
  target: "document" as const,
  schema: "/schemas/settings/Things/things.json",
  capture: "thing.capture",
  plan: "thing.plan",
  apply: "thing.apply",
};

const pods: PodRow[] = [
  {
    id: "p",
    name: "P",
    version: "1",
    folder: "Pods/p",
    entrypoints: [],
    members: [
      {
        path: "settings/a.json",
        sha256: "h",
        schema: "http://x:1/schemas/settings/Things/things.json",
      },
      { path: "settings/b.json", sha256: "i", schema: null },
    ],
    diagnostics: [],
  },
];

function ctx(page: Partial<EntityPage>) {
  const calls: [string, unknown][] = [];
  const state = { page: { stage: "audit", pod: "", path: "", ...page } as EntityPage };
  const c = {
    target: { kind: "document", ref: { session: "s", openId: "o" } },
    readings: { pods: { state: "ready", observation: pods } },
    get page() {
      return state.page;
    },
    call: async (op: string, input?: unknown) => {
      calls.push([op, input]);
      return op === "thing.capture"
        ? { Name: "x" }
        : op === "pod.member.compose"
          ? { composed: { Name: "composed" } }
          : op === "thing.plan"
            ? { planHash: "ph" }
            : {};
    },
    setPage: (next: Partial<EntityPage>) => Object.assign(state.page, next),
  } as unknown as Ctx<unknown, string, EntityPage>;
  return { c, calls, state };
}

vi.stubGlobal("location", { origin: "http://web:3000" });

const { actions } = entityRoute(def);

test("capture files a new member with the route's $schema in the chosen pod", async () => {
  expect(actions!.capture.ready(ctx({}).c as never, undefined as never)).toMatch(/choose the pod/);
  const { c, calls, state } = ctx({ pod: "p" });
  await actions!.capture.run(c as never, undefined as never);
  const [op, write] = calls[1]!;
  expect(calls[0]![0]).toBe("thing.capture");
  expect(op).toBe("pod.member.write");
  expect(JSON.parse((write as { content: string }).content)).toMatchObject({
    $schema: expect.stringMatching(/\/schemas\/settings\/Things\/things\.json$/),
    Name: "x",
  });
  expect(state.page.path).toMatch(/^settings\/thing\/.+\.json$/);
});

test("apply refuses unsaved or foreign members and sends composed bytes with source and plan hash", async () => {
  expect(
    actions!.apply.ready(ctx({ pod: "p", path: "nope.json" }).c as never, undefined as never),
  ).toMatch(/save/);
  expect(
    actions!.apply.ready(ctx({ pod: "p", path: "settings/b.json" }).c as never, undefined as never),
  ).toMatch(/not a thing spec/);
  const { c, calls } = ctx({ pod: "p", path: "settings/a.json" });
  expect(actions!.apply.ready(c as never, undefined as never)).toBeNull();
  await actions!.apply.run(c as never, undefined as never);
  expect(calls.map(([op]) => op)).toEqual(["pod.member.compose", "thing.plan", "thing.apply"]);
  expect(calls[2]![1]).toMatchObject({
    spec: { Name: "composed" },
    planHash: "ph",
    source: { pod: "p", path: "settings/a.json", sha256: "h" },
  });
});
