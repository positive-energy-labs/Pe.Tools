import { expect, test } from "vite-plus/test";
import { TABLE_IDS } from "@pe/ducts-domain/pricing";
import { neutralBodies } from "./neutral.ts";

test("Ducts tables reads carry the shared nonempty table identities", () => {
  expect(TABLE_IDS.length).toBeGreaterThan(0);
  expect(neutralBodies.tablesArgs.run()).toEqual({ ids: [...TABLE_IDS] });
});
