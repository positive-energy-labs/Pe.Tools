import { expect, expectTypeOf, test } from "vite-plus/test";
import {
  actionControls,
  instancesReading,
  familyReads,
  scheduleReads,
  semanticActions,
  type ActionDefinition,
} from "../src/index.ts";

test("action records have one prose field and declared Reading keys", () => {
  expectTypeOf<Extract<keyof ActionDefinition, "description">>().toEqualTypeOf<never>();
  expectTypeOf<"snapshto">().not.toExtend<ActionDefinition["dirties"][number]>();
  for (const row of Object.values({
    ...semanticActions,
    ...actionControls,
    ...familyReads,
    ...scheduleReads,
    instancesReading,
  })) {
    expect(row).not.toHaveProperty("description");
    expect(row.says).not.toBe("");
  }
});
