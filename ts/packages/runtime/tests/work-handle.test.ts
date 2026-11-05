/** ADR 0030 rule 9: one stored Work, one handle, however the caller spelled its key. */
import { expect, test } from "vite-plus/test";
import { address, bindWork, catalogWorkSpecs, workHandle, type RouteStateSpec } from "@pe/agent-contracts";
import type { z } from "zod";
import { RouteWorkspace } from "../src/route-workspace.ts";

test("a Page-less catalog owner carries Save As Work over and returns its one canonical handle", async () => {
  const state = new Map<string, unknown>();
  const module = new RouteWorkspace({
    registrations: [{ spec: catalogWorkSpecs["parameter-links"] as unknown as RouteStateSpec<z.ZodType> }],
    store: {
      getState: async ({ targetKey, route }) => structuredClone(state.get(`${targetKey}\0${route}`)),
      setState: async ({ targetKey, route, value }) => void state.set(`${targetKey}\0${route}`, value),
    },
  });
  const open = { session: "s", openId: "o" };
  const unsaved = bindWork("parameter-links", null, undefined, open);
  const staged = await module.apply(unsaved, "parameter-links", "pea", [
    { path: ["assignments", "a1"], value: { edit: { value: { definitionId: "d1" } } } },
  ], 0);
  expect(staged).toMatchObject({ ok: true, handle: workHandle(unsaved, 1) });

  const saved = bindWork("parameter-links", address("C:/Jobs/A.rvt"), undefined, open);
  const read = await module.read(saved, "parameter-links");
  expect(read).toMatchObject({ revision: 1, doc: { assignments: { a1: { edit: { value: { definitionId: "d1" } } } } } });
  expect(read?.handle).toEqual(workHandle(bindWork("parameter-links", address("c:\\jobs\\a.rvt")), 1));
  expect(read?.handle.key).not.toHaveProperty("from");
  expect((await module.readRaw(read!.handle.key, "parameter-links"))?.handle).toEqual(read?.handle);

  const fed: unknown[] = [];
  const acks: unknown[] = [];
  const stop = module.observeFeed(saved, (value) => fed.push(value), (ack) => acks.push(ack.key), () => {});
  await module.apply(saved, "parameter-links", "pea", [
    { path: ["assignments", "a2"], value: { edit: { value: { definitionId: "d1" } } } },
  ], 1);
  stop();
  expect(fed).toMatchObject([{ revision: 1, handle: read?.handle }]);
  expect(acks).toEqual([read?.handle.key]);
});
