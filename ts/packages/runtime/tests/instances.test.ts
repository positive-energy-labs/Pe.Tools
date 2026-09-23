import { expect, test } from "vite-plus/test";
import { instancesRouteState, transitionPatches, type WorkKey } from "@pe/agent-contracts";
import { RouteWorkspace } from "../src/route-workspace.ts";

/**
 * Instances Work is standalone (`?work=<id>`), never document-scoped: a session lifecycle
 * outlives every document. Its lifecycle is an Action, not a route command, so the only route
 * proof left here is the mask and the Work key. Dispatch, replay-once, refusal and recovery are
 * proven on the real journal in apps/host/tests/instances-actions.test.ts.
 */
test("Instances isolates Work by key; Pea proposes a launch and only a person stages it", async () => {
  const data = new Map<string, unknown>();
  const workspace = new RouteWorkspace({
    registrations: [{ spec: instancesRouteState, handlers: {} }],
    store: {
      getState: async ({ targetKey, route }) => data.get(`${targetKey}/${route}`),
      setState: async ({ targetKey, route, value }) => {
        data.set(`${targetKey}/${route}`, structuredClone(value));
      },
    },
  });
  const a: WorkKey = {
    binding: "workspace" as const,
    route: "instances",
    target: null,
    work: "chat-a",
  };
  const b: WorkKey = {
    binding: "workspace" as const,
    route: "instances",
    target: null,
    work: "chat-b",
  };

  expect(
    await workspace.apply(a, "instances", "agent", [{ path: ["observation"], value: {} }], 0),
  ).toMatchObject({ ok: false, hint: expect.stringContaining("human-only") });
  const launch = { kind: "open", session: "session:exact", document: "C:\\Models\\A.rvt" };
  // Pea proposes a launch; the staged value is what open/start consume, so Pea may not stage it.
  const propose = transitionPatches([], "launch", {}, { kind: "propose", rung: { value: launch } });
  const stage = transitionPatches([], "launch", {}, { kind: "stage", rung: { value: launch } });
  expect(await workspace.apply(a, "instances", "agent", stage, 0)).toMatchObject({ ok: false });
  expect(await workspace.apply(a, "instances", "agent", propose, 0)).toMatchObject({
    ok: true,
    revision: 1,
  });
  expect(await workspace.apply(a, "instances", "human", stage, 1)).toMatchObject({
    ok: true,
    revision: 2,
  });
  expect((await workspace.read(a, "instances"))?.doc).toMatchObject({
    launch: { proposal: { value: launch }, staged: { value: launch } },
  });
  expect(await workspace.read(b, "instances")).toBeNull();
  expect([...data.keys()]).toEqual(["instances/workspace:chat-a/instances"]);
});
