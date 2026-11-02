import { expect, test } from "vite-plus/test";
import { createDuctsSheets } from "../src/ducts-sheet.ts";
import { snapshot } from "../../web/src/ducts/test-fixture.ts";

test("roster composition retains UniqueId for two equipment instances with the same mark", async () => {
  const fan = snapshot.nodes.find((node) => node.id === 100)!;
  const nodes = [
    { ...fan, family: "Fan Coil", uniqueId: "fixture-fan-alpha" },
    { ...fan, id: 101, family: "Fan Coil", uniqueId: "fixture-fan-beta" },
  ];
  const sheets = createDuctsSheets({
    call: async () => Response.json({ ...snapshot, nodes }),
  });
  const roster = await sheets.roster({ target: { session: "fixture", openId: "doc" } });
  expect(roster.rows).toHaveLength(2);
  expect(roster.rows.map((row) => row.mark)).toEqual(["FC-1", "FC-1"]);
  expect(new Set(roster.rows.map((row) => `${row.uniqueId}@${row.portIndex}`)).size).toBe(2);
  expect(roster.rows.map((row) => row.uniqueId)).toEqual(["fixture-fan-alpha", "fixture-fan-beta"]);
});
