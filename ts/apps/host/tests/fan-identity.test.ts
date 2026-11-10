import { testDuctFiles, settle } from "./effect-test.ts";
import { expect, test } from "vite-plus/test";
import { fanRoster } from "../src/reads/fan-sheet.ts";
import { evaluate } from "../src/reads/evaluator.ts";
import { sheetPort } from "./ducts-read.fixture.ts";
import { RouteWorkspace } from "@pe/runtime";
import { bindWork } from "@pe/agent-contracts";
import { snapshot } from "../../web/src/ducts/test-fixture.ts";

test("roster composition retains UniqueId for two equipment instances with the same mark", async () => {
  const fan = snapshot.nodes.find((node) => node.id === 100)!;
  const nodes = [
    { ...fan, family: "Fan Coil", uniqueId: "fixture-fan-alpha" },
    { ...fan, id: 101, family: "Fan Coil", uniqueId: "fixture-fan-beta" },
  ];
  const target = { session: "fixture", openId: "doc" };
  const workspace = new RouteWorkspace({ registrations: [], store: { getState: async () => null, setState: async () => {} } });
  const roster = (await evaluate(fanRoster, { target }, sheetPort({
    firm: (owner) => settle(testDuctFiles().firm(owner)), catalogs: () => settle(testDuctFiles().ductCatalogs),
    workKey: async () => bindWork("ducts", null, undefined, target),
    call: async () => Response.json({ ...snapshot, nodes }),
  }, workspace))).data;
  expect(roster.rows).toHaveLength(2);
  expect(roster.rows.map((row) => row.mark)).toEqual(["FC-1", "FC-1"]);
  expect(new Set(roster.rows.map((row) => `${row.uniqueId}@${row.portIndex}`)).size).toBe(2);
  expect(roster.rows.map((row) => row.uniqueId)).toEqual(["fixture-fan-alpha", "fixture-fan-beta"]);
});
