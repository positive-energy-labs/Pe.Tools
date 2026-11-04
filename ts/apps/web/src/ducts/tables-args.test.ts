import { expect, test } from "vite-plus/test";
import { TABLE_IDS } from "@pe/ducts-domain/pricing";
import { entries, neutralBodies } from "./neutral.ts";

test("Ducts tables reads carry the shared nonempty table identities", () => {
  expect(entries["ducts.tables"].input.safeParse({}).success).toBe(false);
  expect(entries["ducts.tables"].input.safeParse(neutralBodies.tablesArgs.run()).success).toBe(true);
  expect(TABLE_IDS.length).toBeGreaterThan(0);
  expect(neutralBodies.tablesArgs.run()).toEqual({ ids: [...TABLE_IDS] });
});
