import { expect, test } from "vite-plus/test";
import { address, familiesRouteState, familyCellKey } from "@pe/agent-contracts";

import { RouteWorkspace } from "../../runtime/src/route-workspace.ts";
import { createRouteRegistrations } from "../src/pea/routes.ts";

const at = address("c:\\models\\j1.rvt");
const scope = { route: "families", target: at };
// One loaded family, 3573700, with one type; 3573718 is that TYPE's element id (F-J1-7).
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
const propose = (familyId: number, typeName = "12 X 4") => ({
  path: ["cells", familyCellKey({ familyId, typeName, parameter: "View Description" }), "proposal"],
  value: { value: { familyName: "Casework", value: "Base" } },
});

test("F-J1-7: a proposal keyed by a type's element id is refused at the door, naming the key", async () => {
  const { work } = workspace();
  const refused = await work.apply(scope, "families", "agent", [propose(3573718)], 0);
  expect(refused).toMatchObject({ ok: false, kind: "refused" });
  if (refused.ok) return;
  expect(refused.error).toContain('[3573718,"12 X 4","View Description"]');
  expect(refused.hint).toContain('[3573700,"12 X 4",');
  expect((await work.view(scope, "families"))!.revision).toBe(0);
});

test("a type the family does not have is refused, a human write too", async () => {
  const { work } = workspace();
  const refused = await work.apply(scope, "families", "human", [propose(3573700, "24 X 4")], 0);
  expect(refused).toMatchObject({ ok: false, kind: "refused" });
});

test("a valid key lands, and clearing a cell never asks Revit", async () => {
  const { work, reads } = workspace();
  const landed = await work.apply(scope, "families", "agent", [propose(3573700)], 0);
  expect(landed).toMatchObject({ ok: true, revision: 1 });
  expect(reads).toEqual([{ target: at, filter: null }]);
  const key = familyCellKey({
    familyId: 3573700,
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
