import { expect, test } from "vite-plus/test";
import { TABLE_IDS } from "@pe/ducts-domain/pricing";
import { entries, neutralBodies } from "./neutral.ts";

test("Ducts tables reads carry the shared nonempty table identities", () => {
  const context: Parameters<typeof neutralBodies.tablesArgs.run>[0] = { page: {}, work: {}, readings: {} };
  expect(entries["ducts.tables"].input.safeParse({}).success).toBe(false);
  expect(entries["ducts.tables"].input.safeParse(neutralBodies.tablesArgs.run(context)).success).toBe(true);
  expect(TABLE_IDS.length).toBeGreaterThan(0);
  expect(neutralBodies.tablesArgs.run(context)).toEqual({ ids: [...TABLE_IDS] });
});
