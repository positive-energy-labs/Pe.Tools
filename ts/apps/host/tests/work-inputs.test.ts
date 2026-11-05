import { Effect, Exit, Schema } from "effect";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { address, routeBindingsSchema, type WorkKey } from "@pe/agent-contracts";
import { RouteWorkspace, type RouteDocumentStore } from "@pe/runtime";
import { liveWorkInput, workInput, workInputCodecs, type WorkView } from "../src/work-inputs.ts";

const schema = z
  .object({ bindings: routeBindingsSchema, values: z.record(z.string(), z.string()).default({}) })
  .prefault({});
const state = new Map<string, unknown>();
const store: RouteDocumentStore = {
  getState: async ({ targetKey, route }) => structuredClone(state.get(`${targetKey}\0${route}`)),
  setState: async ({ targetKey, route, value }) => {
    state.set(`${targetKey}\0${route}`, structuredClone(value));
  },
};
const key: WorkKey = { binding: "address", route: "fans", target: address("C:\\Models\\A.rvt") };
const workspace = new RouteWorkspace({
  registrations: [{ spec: { route: "fans", title: "Fans", description: "Fans Work", schema } }],
  store,
});
const roundTrip = <V extends WorkView>(view: V, value: unknown) =>
  Effect.runPromiseExit(
    Schema.decodeUnknownEffect(workInputCodecs[view])(JSON.parse(JSON.stringify(value))),
  );

test("each live Work view is the canonical read, and its recorded bytes decode through the Work contracts", async () => {
  for (const [revision, value] of [[0, "250"], [1, "300"]] as const)
    expect(
      await workspace.apply(key, "fans", "human", [{ path: ["values", "4"], value }], revision),
    ).toMatchObject({ ok: true });
  const live = <V extends WorkView>(view: V) => Effect.runPromise(liveWorkInput(workspace, key, view));
  expect(workInput(key, "feed")).toEqual({ kind: "work", key: expect.any(String), view: "feed" });
  expect(await live("raw")).toEqual(await workspace.readRaw(key, "fans"));
  expect(await live("view")).toEqual(await workspace.view(key, "fans"));
  // The feed keeps its handle, revision and the retained history its consumers undo over.
  const feed = await live("feed");
  expect(feed).toMatchObject({ revision: 2, handle: { revision: 2 }, history: { from: 1 } });
  expect(feed.history.acks.map((ack) => ack.revision)).toEqual([1, 2]);
  for (const view of ["raw", "view", "feed"] as const) {
    const decoded = await roundTrip(view, await live(view));
    expect(Exit.isSuccess(decoded), view).toBe(true);
  }
});

test("recorded Work that breaks its handle or ack contract refuses instead of being coerced", async () => {
  const feed = await Effect.runPromise(liveWorkInput(workspace, key, "feed"));
  const forged = [
    { ...feed, handle: { revision: feed.revision } },
    { ...feed, history: { from: feed.history.from, acks: [{ revision: 1 }] } },
    { ...feed, revision: -1 },
  ];
  for (const value of forged) expect(Exit.isFailure(await roundTrip("feed", value))).toBe(true);
  expect(Exit.isSuccess(await roundTrip("raw", null))).toBe(true);
});
