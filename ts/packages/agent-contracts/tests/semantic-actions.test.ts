import { expect, expectTypeOf, test } from "vite-plus/test";
import {
  actionControls,
  familyReads,
  hostActions,
  instancesReading,
  scheduleReads,
  semanticActions,
  type ActionDefinition,
} from "../src/index.ts";

test("host actions are one key space of records with one prose field and declared Reading keys", () => {
  expectTypeOf<Extract<keyof ActionDefinition, "description">>().toEqualTypeOf<never>();
  expectTypeOf<"snapshto">().not.toExtend<ActionDefinition["dirties"][number]>();
  // A key declared in two tables would silently override in the union; the count catches it.
  const declared = [semanticActions, actionControls, familyReads, scheduleReads].flatMap(
    Object.keys,
  );
  expect(Object.keys(hostActions)).toHaveLength(declared.length + 1);
  expect(hostActions["instances.read"]).toBe(instancesReading);
  for (const row of Object.values(hostActions)) {
    expect(row).not.toHaveProperty("description");
    expect(row.says).not.toBe("");
  }
});
