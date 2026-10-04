import { expect, expectTypeOf, test } from "vite-plus/test";
import {
  actionControls,
  ductsActions,
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

test("ducts preview and apply share one input, admitted on a project document by any actor", () => {
  expect(semanticActions["ducts.preview"]).toBe(ductsActions["ducts.preview"]);
  expect(ductsActions["ducts.preview"].input).toBe(ductsActions["ducts.apply"].input);
  for (const row of Object.values(ductsActions)) {
    expect(row.needs).toBe("project-document");
    expect(row.actor).toBe("any");
  }
  // Only the real write changes the model; the preview leaves the snapshot fresh.
  expect(ductsActions["ducts.apply"].dirties).toEqual(["snapshot"]);
  expect(ductsActions["ducts.preview"].dirties).toEqual([]);
  // previewOnly is the verb's, never the caller's.
  expect(() =>
    ductsActions["ducts.apply"].input.parse({ previewOnly: false } as never),
  ).toThrow();
});
