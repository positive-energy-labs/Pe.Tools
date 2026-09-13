import { expect, test } from "vite-plus/test";
import { instancesRouteState, type WorkKey } from "@pe/agent-contracts";
import { RouteWorkspace } from "../src/route-workspace.ts";

/**
 * Instances Work is standalone (`?work=<id>`), never document-scoped: a session lifecycle
 * outlives every document. Its lifecycle is an Action, not a route command, so the only route
 * proof left here is the mask and the Work key. Dispatch, replay-once, refusal and recovery are
 * proven on the real journal in apps/host/tests/instances-actions.test.ts.
 */
test("Instances isolates Work by key and admits an agent only to the staged proposal", async () => {
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
  const a: WorkKey = { route: "instances", target: null, work: "chat-a" };
  const b: WorkKey = { route: "instances", target: null, work: "chat-b" };

  expect(
    await workspace.apply(a, "instances", "agent", [{ path: ["observation"], value: {} }], 0),
  ).toMatchObject({ ok: false, hint: expect.stringContaining("human-only") });
  expect(
    await workspace.apply(
      a,
      "instances",
      "agent",
      [
        {
          path: ["staged"],
          value: { kind: "open", session: "session:exact", document: "C:\\Models\\A.rvt" },
        },
      ],
      0,
    ),
  ).toMatchObject({ ok: true, revision: 1 });
  expect((await workspace.read(a, "instances"))?.doc).toMatchObject({
    staged: { kind: "open", document: "C:\\Models\\A.rvt" },
  });
  expect(await workspace.read(b, "instances")).toBeNull();
  expect([...data.keys()]).toEqual(["instances/workspace:chat-a/instances"]);
});
