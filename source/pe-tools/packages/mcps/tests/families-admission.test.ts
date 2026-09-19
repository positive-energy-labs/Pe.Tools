import { expect, test } from "vite-plus/test";
import { address, familiesRouteState, familyCellKey } from "@pe/agent-contracts";

import { RouteWorkspace } from "../../runtime/src/route-workspace.ts";
import { hostLoadedFamilies, type HostCall } from "../src/pea/families-admission.ts";
import { createRouteRegistrations } from "../src/pea/routes.ts";

const at = address("c:\\models\\j1.rvt");
const scope = { route: "families", target: at };
// One loaded family, "Casework", with one type. Its element id changes on every reload; its name does not.
const loaded = [{ familyId: 3573700, familyName: "Casework", types: [{ typeName: "12 X 4" }] }];

function workspace() {
  const saved = new Map<string, unknown>();
  const reads: unknown[] = [];
  return {
    reads,
    work: new RouteWorkspace({
      registrations: createRouteRegistrations({
        hostBaseUrl: "http://127.0.0.1:1",
        loadedFamilies: async (target, filter) => {
          reads.push({ target, filter });
          return loaded;
        },
      }),
      store: {
        getState: async ({ targetKey, route }) => saved.get(`${targetKey}\0${route}`),
        setState: async ({ targetKey, route, value }) => {
          saved.set(`${targetKey}\0${route}`, value);
        },
      },
    }),
  };
}
const propose = (familyName: string, typeName = "12 X 4") => ({
  path: [
    "cells",
    familyCellKey({ familyName, typeName, parameter: "View Description" }),
    "proposal",
  ],
  value: { value: { value: "Base" } },
});

test("F-J1-7: a proposal naming no loaded family is refused at the door, naming the key", async () => {
  const { work } = workspace();
  const refused = await work.apply(scope, "families", "agent", [propose("Casework 2")], 0);
  expect(refused).toMatchObject({ ok: false, kind: "refused" });
  if (refused.ok) return;
  expect(refused.error).toContain('["Casework 2","12 X 4","View Description"]');
  expect(refused.hint).toContain('["Casework","12 X 4",');
  expect((await work.view(scope, "families"))!.revision).toBe(0);
});

test("an element id in the family slot is refused by the schema, before Revit is asked", async () => {
  const { work, reads } = workspace();
  const key = JSON.stringify([3573700, "12 X 4", "View Description"]);
  const refused = await work.apply(
    scope,
    "families",
    "agent",
    [{ path: ["cells", key, "proposal"], value: { value: { value: "Base" } } }],
    0,
  );
  expect(refused).toMatchObject({ ok: false });
  expect(reads).toHaveLength(0);
});

test("a type the family does not have is refused, a human write too", async () => {
  const { work } = workspace();
  const refused = await work.apply(scope, "families", "human", [propose("Casework", "24 X 4")], 0);
  expect(refused).toMatchObject({ ok: false, kind: "refused" });
});

test("a valid key lands, and clearing a cell never asks Revit", async () => {
  const { work, reads } = workspace();
  const landed = await work.apply(scope, "families", "agent", [propose("Casework")], 0);
  expect(landed).toMatchObject({ ok: true, revision: 1 });
  expect(reads).toEqual([{ target: at, filter: null }]);
  const key = familyCellKey({
    familyName: "Casework",
    typeName: "12 X 4",
    parameter: "View Description",
  });
  const withdrawn = await work.apply(
    scope,
    "families",
    "agent",
    [{ path: ["cells", key, "proposal"], value: null }],
    1,
  );
  expect(withdrawn).toMatchObject({ ok: true });
  expect(reads).toHaveLength(1);
  expect(
    familiesRouteState.schema.parse((await work.view(scope, "families"))!.doc).cells[key],
  ).toMatchObject({ proposal: null });
});

test("an exclusion carries its writer: Pea cannot write one as the person, nor lift the person's", async () => {
  const { work, reads } = workspace();
  const exclude = (by: string) => [{ path: ["excluded", "Casework"], value: { by } }];
  expect(await work.apply(scope, "families", "agent", exclude("person"), 0)).toMatchObject({
    ok: false,
    kind: "refused",
  });
  expect(await work.apply(scope, "families", "human", exclude("pea"), 0)).toMatchObject({
    ok: false,
  });
  const held = await work.apply(scope, "families", "human", exclude("person"), 0);
  expect(held).toMatchObject({ ok: true, revision: 1 });
  const lifted = await work.apply(
    scope,
    "families",
    "agent",
    [{ path: ["excluded", "Casework"] }],
    1,
  );
  expect(lifted).toMatchObject({ ok: false, kind: "refused" });
  expect(reads).toHaveLength(0);
});

// F-J1-12, from hold 4b's recorded shapes (thread 1da7e887): the session list and the catalog as
// the C# collector answers. It lists types only for a Rows/Full view, at most maxSamplesPerEntry
// (default 10), and warns when the filter matches nothing.
const projectA = "f2933e8d-9e16-4bf4-b9ca-484f461e4563";
const exhaust = {
  familyId: 3700298,
  familyUniqueId: "2b3da566-211f-4400-924e-3e29b481ab08-0038764a",
  familyName: "Price LBP15A Exhaust",
  categoryName: "Air Terminals",
  placedInstanceCount: 51,
  types: ["12 X 4", "12 X 4 W", "12 X 6 W", "16 x 8 clg", "6x6", "8 X 4", "8 X 4 W", "84 X 4 T"]
    .concat(Array.from({ length: 4 }, (_, i) => `extra ${i}`))
    .map((typeName) => ({ typeName })),
};
const liveHost = (): HostCall =>
  (async (key: string, request: any) => {
    if (key === "bridge.sessions.list")
      return {
        sessions: [
          {
            connected: true,
            sessionId: "session-0875810ce11c3ab9",
            openDocuments: [
              { openId: "4f27e503561449978eab2c0d293ebd38", address: projectA, isActive: true },
            ],
          },
        ],
      };
    const names: string[] = request.filter?.familyNames ?? [];
    const families = [exhaust].filter((f) => !names.length || names.includes(f.familyName));
    const full = ["Rows", "Full"].includes(request.projection?.view);
    return {
      summary: { truncated: false },
      families: families.map((f) => ({
        ...f,
        typeCount: f.types.length,
        types: full ? f.types.slice(0, request.budget?.maxSamplesPerEntry ?? 10) : [],
      })),
      issues: families.length
        ? []
        : [
            {
              code: "LoadedFamiliesFilterMatchedZeroFamilies",
              message: "Loaded-family filter matched zero families out of 1.",
            },
          ],
    };
  }) as HostCall;

function ProjectAWork(familyNames: string[]) {
  const target = address(projectA);
  const saved = new Map<string, unknown>();
  const work = new RouteWorkspace({
    registrations: createRouteRegistrations({
      loadedFamilies: hostLoadedFamilies(undefined, liveHost()),
    }),
    store: {
      getState: async ({ route }) => saved.get(route),
      setState: async ({ route, value }) => void saved.set(route, value),
    },
  });
  const at = { route: "families", target };
  const scoped = { categoryNames: ["Air Terminals"], familyNames, placementScope: "AllLoaded" };
  return {
    work,
    at,
    author: () => work.apply(at, "families", "human", [{ path: ["scope"], value: scoped }], 0),
  };
}

test("F-J1-12: the live catalog loopback admits a key for a type past the tenth, as Pea and as the person", async () => {
  const { work, at, author } = ProjectAWork(["Price LBP15A Exhaust"]);
  expect(await author()).toMatchObject({ ok: true, revision: 1 });
  const landed = await work.apply(at, "families", "agent", [propose("Price LBP15A Exhaust")], 1);
  expect(landed).toMatchObject({ ok: true, revision: 2 });
  const cleared = await work.apply(
    at,
    "families",
    "human",
    [
      {
        path: [
          "cells",
          familyCellKey({
            familyName: "Price LBP15A Exhaust",
            typeName: "extra 3",
            parameter: "Mech Equip Model Number",
          }),
          "staged",
        ],
        value: { value: { value: "" } },
      },
    ],
    2,
  );
  expect(cleared).toMatchObject({ ok: true, revision: 3 });
});

test("F-J1-12: a scope that resolves to no loaded family refuses with that diagnosis, not a key hint", async () => {
  const { work, at, author } = ProjectAWork(["Price LBPH15A Exhaust"]);
  await author();
  const refused = await work.apply(at, "families", "agent", [propose("Price LBP15A Exhaust")], 1);
  expect(refused).toMatchObject({ ok: false, kind: "refused" });
  if (refused.ok) return;
  expect(refused.error).toContain(
    "scope resolved to no loaded families: Loaded-family filter matched zero families out of 1.",
  );
  expect(refused.hint).not.toContain("A key is");
});
