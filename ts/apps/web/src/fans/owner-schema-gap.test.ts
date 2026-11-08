import { expect, test } from "vite-plus/test";
import { fansDocumentSchema, type FansRouteDocument } from "@pe/agent-contracts";
import type { WorkOf } from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import type { WorkPatches } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import { module } from "./route.ts";
const fansData = { ...module.data, work: { schema: "work" as const, route: "fans", version: 1, } };
const schemas = { work: module.spec.edits!.work.schema };
const patch: WorkPatches<typeof fansData, typeof schemas> = [{ path: ["equipmentFlows", "7"], value: { edit: { value: { cfm: 200 } } } }];
const invalid: WorkPatches<typeof fansData, typeof schemas> = [
  // @ts-expect-error Q2: fan writers cannot author ducts rules.
  { path: ["rules"], value: {} },
];
function workTypes(value: WorkOf<typeof fansData, typeof schemas>): FansRouteDocument { return value; }
test("fans retains its own keyed paths and callback Work types", () => {
  expect(patch[0]?.path).toEqual(["equipmentFlows", "7"]);
  expect(fansDocumentSchema.safeParse({ rules: {} }).success).toBe(false);
  expect(workTypes(fansDocumentSchema.parse({})).equipmentFlows).toEqual({});
  void invalid;
});
