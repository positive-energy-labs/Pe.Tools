import { expect, test } from "vite-plus/test";
import { ductsDocumentSchema, type DuctsRouteDocument } from "@pe/agent-contracts";
import type {
  BodyBindings,
  WorkPatches,
  BodyContext,
  PaneContext,
} from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { WorkOf } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { capturesData } from "../captures/kernel";

import { withWorkOwner } from "../../../../packages/agent-contracts/src/route-work-owner";
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
      deps: { page: [], work: ["rules"], readings: [] },
      captures: [],
      patches: "slot",
    },
  },
} as const;
const presenter = { ...owner, key: "fans", address: "/fans", work: { route: "ducts" } } as const;
const ownerSchemas = { work: ductsDocumentSchema };
const schemas = withWorkOwner({}, { data: owner, schemas: ownerSchemas });
const slot = {
  path: ["rules", "elbow"],
  value: { edit: { value: { table: "PE_M_Fan_AirFlow" } } },
} as const;
const ownerSlot: WorkPatches<typeof owner, typeof ownerSchemas> = [slot];
const presenterSlot: WorkPatches<typeof presenter, typeof schemas> = [slot];

// The presenter cannot author a field absent from the owner schema.
const uncheckedRoot: WorkPatches<typeof presenter, typeof schemas> = [
  // @ts-expect-error Owner schema has no such field.
  { path: ["notADuctsField"], value: 42 },
];
type OwnerWork = WorkOf<typeof owner, typeof ownerSchemas>;
type PresenterWork = WorkOf<typeof presenter, typeof schemas>;
function workTypes(ownerWork: OwnerWork, presenterWork: PresenterWork) {
  const positive: DuctsRouteDocument | null = ownerWork;
  const negative: PresenterWork = ownerWork;
  return [positive, negative, presenterWork];
}
const ownerBody: BodyBindings<typeof owner, typeof ownerSchemas, {}>["slot"] = {
  slot: "verbs.slot.patches",
  kind: "work",
  source: { module: "fans/owner-schema-gap.test.ts", export: "ownerBody" },
  run: (ctx) => {
    const field: string | undefined = ctx.work.rules.elbow?.edit?.value.table;
    void field;
    return ownerSlot;
  },
};
const presenterBody: BodyBindings<typeof presenter, typeof schemas, {}>["slot"] = ownerBody;

test("owner-reference Work retains owner keyed paths and callback types", () => {
  expect(presenter.work).toEqual({ route: "ducts" });
  expect(ownerSlot).toEqual(presenterSlot);
  expect(ductsDocumentSchema.safeParse({ notADuctsField: 42 }).success).toBe(false);
  expect(uncheckedRoot[0]!.path).toEqual(["notADuctsField"]);
  expect(presenterBody).toBe(ownerBody);
  expect(workTypes).toBeTypeOf("function");
});

const described = {
  ...presenter,
  verbs: { slot: { ...presenter.verbs.slot, describe: "describe" } },
} as const;
const describe: BodyBindings<typeof described, typeof schemas, {}>["describe"] = {
  slot: "verbs.slot.describe",
  kind: "describe",
  source: { module: "fans/owner-schema-gap.test.ts", export: "describe" },
  run: (_input, ctx) => ({ label: String(ctx.work.rules.elbow?.edit?.value.table) }),
};
function ownerEvidence(
  ctx: BodyContext<typeof presenter, typeof schemas, {}, typeof presenter.verbs.slot>,
  pane: PaneContext<typeof presenter, typeof schemas, {}, keyof typeof presenter.panes>,
) {
  const value = ctx.work.rules.elbow?.edit?.value.table;
  const paneValue = pane.work?.rules.elbow?.edit?.value.table;
  // @ts-expect-error Typed owner callbacks cannot read absent Work fields.
  void ctx.work.notADuctsField;
  return [value, paneValue, pane.workBasis];
}
void [describe, ownerEvidence];

const presented = {
  ...presenter,
  verbs: {
    apply: {
      kind: "command",
      input: "none",
      label: "Apply",
      review: "shown",
      deps: presenter.verbs.slot.deps,
      captures: [],
      entry: "apply",
      intent: "apply",
      present: "present",
    },
  },
} as const;
const present: BodyBindings<typeof presented, typeof schemas, {}>["present"] = {
  slot: "verbs.apply.present",
  kind: "present",
  source: { module: "fans/owner-schema-gap.test.ts", export: "present" },
  run: (_result, evidence) => String(evidence.work.rules.elbow?.edit?.value.table),
};
void present;
