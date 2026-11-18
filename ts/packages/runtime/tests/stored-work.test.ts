import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { address, bindWork, fansRouteState } from "@pe/agent-contracts";
import { RouteWorkspace, type RouteDocumentStore } from "../src/route-workspace.ts";
import stored from "./fixtures/fans-29e4d97e.json" with { type: "json" };

test.each([{}, [], null, { edit: { value: 12, by: "human" } }, { future: 1 }, 0, false, ""].map(calculation => ({ calculation })))(
  "stored fans Work preserves flows across an unknown calculation key: %j", async ({ calculation }) => {
    let saved: unknown = { ...stored, doc: { ...stored.doc, calculation } };
    const reasons: string[] = [], kept: unknown[] = [];
    const store: RouteDocumentStore = { getState: async () => saved, setState: async ({ value, reason }) => {
      if (value === null) { reasons.push(reason!); kept.push(saved); }
      saved = value;
    } };
    const options = { registrations: [{ spec: fansRouteState }], store };
    const key = bindWork("fans", address("C:/test.rvt"));
    const read = await new RouteWorkspace(options).read(key, "fans");
    expect(read?.doc).toEqual(fansRouteState.schema.parse({ flows: stored.doc.flows }));
    expect(read?.doc).not.toHaveProperty("calculation");
    const empty = calculation === null || (typeof calculation === "object" && !Object.keys(calculation).length);
    expect(reasons).toHaveLength(empty ? 0 : 1);
    if (!empty) expect(reasons[0]).toContain("calculation");
    if (!empty) expect(kept[0]).toMatchObject({ doc: { calculation } });
    expect(await new RouteWorkspace(options).read(key, "fans")).toEqual(read);
    expect(reasons).toHaveLength(empty ? 0 : 1);
  },
);

test("unknown nested key beside an invalid cell preserves the other cells with one notice", async () => {
  let saved: unknown = { ...stored, doc: { ...stored.doc, calculation: { future: 1 },
    flows: { ...stored.doc.flows, "UniqueId:bad": { edit: { value: "bad", by: "human" } } },
    writeIntent: { future: { value: 1 } } } };
  const reasons: string[] = [];
  const routes = new RouteWorkspace({ registrations: [{ spec: fansRouteState }], store: {
    getState: async () => saved, setState: async ({ value, reason }) => { if (value === null) reasons.push(reason!); saved = value; },
  } });
  expect(await routes.read(bindWork("fans", address("C:/test.rvt")), "fans")).toMatchObject({ doc: {
    flows: { ...stored.doc.flows, "UniqueId:bad": { invalid: expect.any(String) } }, writeIntent: {},
  } });
  expect(reasons).toHaveLength(1);
  for (const name of ["calculation", "writeIntent/future", "flows/UniqueId:bad"]) expect(reasons[0]).toContain(name);
  expect(reasons[0]).not.toContain("flows/UniqueId:abc-1");
  expect(reasons[0]).not.toContain(". : ");
});
test("whole-record root failures have no empty-path notice prefix", async () => {
  const reasons: string[] = [];
  const routes = new RouteWorkspace({ registrations: [{ spec: { ...fansRouteState, schema: z.strictObject({}) } }],
    store: { getState: async () => ({ ...stored, doc: 12 }), setState: async ({ reason }) => { reasons.push(reason!); } } });
  expect(await routes.read(bindWork("fans", address("C:/test.rvt")), "fans")).toBeNull();
  expect(reasons).toEqual([expect.stringMatching(/^Invalid input:/)]);
});
