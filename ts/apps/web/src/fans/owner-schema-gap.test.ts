import { expect, test } from "vite-plus/test";
import { ductsDocumentSchema, type DuctsRouteDocument } from "@pe/agent-contracts";
import type {
  BodyBindings,
  WorkPatches,
} from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { WorkOf } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { capturesData } from "../captures/kernel";

// TODO: W1e H6: carry the admitted owner's schema into presenter authoring types.
// Runtime resolves the owner, but these public types still index G.work.schema.
const owner = {
  ...capturesData,
  key: "ducts",
  address: "/ducts",
  capabilities: ["work"],
  work: { route: "ducts", schema: "work", version: 1, migrations: {} },
  verbs: {
    slot: {
      kind: "work",
      input: "none",
      label: "Slot",
      review: "none",
      deps: { page: [], work: ["parameters"], readings: [] },
      captures: [],
      patches: "slot",
    },
  },
} as const;
const presenter = { ...owner, key: "fans", address: "/fans", work: { route: "ducts" } } as const;
const schemas = { work: ductsDocumentSchema };
const slot = {
  path: ["parameters", "fanFlow"],
  value: { edit: { value: "PE_M_Fan_AirFlow" } },
} as const;
const ownerSlot: WorkPatches<typeof owner, typeof schemas> = [slot];
// @ts-expect-error H6: a schema-less presenter rejects its resolved owner's keyed patch.
const presenterSlot: WorkPatches<typeof presenter, typeof schemas> = [slot];

// This compiles today: schema loss also silently admits invalid root fields/values.
const uncheckedRoot: WorkPatches<typeof presenter, typeof schemas> = [
  { path: ["notADuctsField"], value: 42 },
];
type OwnerWork = WorkOf<typeof owner, typeof schemas>;
type PresenterWork = WorkOf<typeof presenter, typeof schemas>;
function workTypes(ownerWork: OwnerWork, presenterWork: PresenterWork) {
  const positive: DuctsRouteDocument | null = ownerWork;
  // @ts-expect-error H6: presenter Work collapses to null; an owner document is rejected.
  const negative: PresenterWork = ownerWork;
  return [positive, negative, presenterWork];
}
const ownerBody: BodyBindings<typeof owner, typeof schemas, {}>["slot"] = {
  slot: "verbs.slot.patches",
  kind: "work",
  source: { module: "fans/owner-schema-gap.test.ts", export: "ownerBody" },
  run: () => ownerSlot,
};
// @ts-expect-error H6: reusing correctly typed owner bodies cannot repair presenter authoring.
const presenterBody: BodyBindings<typeof presenter, typeof schemas, {}>["slot"] = ownerBody;

test("owner-reference Work loses keyed paths and Work context in public authoring types", () => {
  expect(presenter.work).toEqual({ route: "ducts" });
  expect(ownerSlot).toEqual(presenterSlot);
  expect(ductsDocumentSchema.safeParse({ notADuctsField: 42 }).success).toBe(false);
  expect(uncheckedRoot[0]!.path).toEqual(["notADuctsField"]);
  expect(presenterBody).toBe(ownerBody);
  expect(workTypes).toBeTypeOf("function");
});
