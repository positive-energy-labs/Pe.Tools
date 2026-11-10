import type { CatalogAxes } from "./catalog.ts";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { hostActions } from "./semantic-actions.ts";

type HostActionKey = keyof typeof hostActions;
/** Keys built as the plan half of a Work write; their axes derive from the write. */
type PreviewKey = {
  [K in HostActionKey]: (typeof hostActions)[K] extends { writeBoundary: { phase: "preview" } }
    ? K
    : never;
}[HostActionKey];

/** Keys whose entry declares its own axes (catalog Work commands, from their native leaf). */
type OwnAxesKey = {
  [K in HostActionKey]: (typeof hostActions)[K] extends { axes: CatalogAxes } ? K : never;
}[HostActionKey];
const ownAxes = Object.fromEntries(
  Object.entries(hostActions).flatMap(([key, action]) =>
    "axes" in action ? [[key, action.axes as CatalogAxes]] : [],
  ),
) as Record<OwnAxesKey, CatalogAxes>;

/** Explicit command budgets; adding a command requires an axis declaration. */
const handAxes = {
  // Slice 7: the sheet pair's write; its plan derives Read from its first native leaf.
  "sheet.apply": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "ModelWrite",
    cost: "Mutation",
    // One, like the losses pair it replaces: the route-wide control doors (actions.admit) bound every write at One.
    cardinality: "One",
  },
  "settings.observe": {
    subject: "None",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "settings.write": {
    subject: "None",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "family.attach-spec": {
    subject: "None",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "family.observe": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "Read",
    cost: "Mutation",
    cardinality: "One",
  },
  "family.capture": {
    subject: "Elements",
    touches: ["Geometry"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "family.plan": {
    subject: "Elements",
    touches: ["Geometry"],
    effect: "TransactRead",
    rollsBack: true,
    cost: "Mutation",
    cardinality: "One",
  },
  "family.apply": {
    subject: "Elements",
    touches: ["Geometry"],
    effect: "ModelWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "family.build": {
    subject: "Elements",
    touches: ["Geometry"],
    effect: "ModelWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "families.read": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "families.cancel-read": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "families.capture": {
    subject: "Elements",
    touches: ["Geometry"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "families.plan": {
    subject: "Elements",
    touches: ["Geometry"],
    effect: "TransactRead",
    rollsBack: true,
    cost: "Mutation",
    cardinality: "One",
  },
  "families.apply": {
    subject: "Elements",
    touches: ["Geometry"],
    effect: "ModelWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "families.save-draft": {
    subject: "None",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "schedule.grid.read": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "schedule.grid.bind": {
    subject: "None",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "schedule.grid.push": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "ModelWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "schedule.capture": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "schedule.apply": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "ModelWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "takeoffs.initialize": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "takeoffs.adopt": {
    subject: "Elements",
    touches: ["Geometry"],
    effect: "ModelWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "takeoffs.partition": {
    subject: "Elements",
    touches: ["Geometry"],
    effect: "ModelWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "takeoffs.sync": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "rooms.partition": {
    subject: "Elements",
    touches: ["Geometry"],
    effect: "ModelWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "rooms.draw": {
    subject: "Elements",
    touches: ["Geometry"],
    effect: "ModelWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "rooms.write": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "ModelWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "rooms.merge": {
    subject: "Elements",
    touches: ["Geometry"],
    effect: "ModelWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "ducts.refresh": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "Read",
    cost: "Mutation",
    cardinality: "One",
  },
  "ducts.apply-heal": {
    subject: "Elements",
    touches: ["Geometry"],
    effect: "ModelWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "ducts.apply-assign-fan": {
    subject: "Elements",
    touches: ["Topology"],
    effect: "ModelWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "ducts.rehearse-heal": {
    subject: "Elements",
    touches: ["Geometry"],
    effect: "TransactRead",
    rollsBack: true,
    cost: "Mutation",
    cardinality: "One",
  },
  "ducts.rehearse-assign-fan": {
    subject: "Elements",
    touches: ["Topology"],
    effect: "TransactRead",
    rollsBack: true,
    cost: "Mutation",
    cardinality: "One",
  },
  "instances.start": {
    subject: "None",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "instances.open": {
    subject: "None",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "instances.restart": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "instances.stop": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "instances.reset": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "instances.dialogs": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "instances.save": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "instances.handover": {
    subject: "None",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "instances.cleanup": {
    subject: "None",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "instances.close": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "action.read": {
    subject: "None",
    touches: ["Metadata"],
    effect: "Read",
    cost: "Mutation",
    cardinality: "One",
  },
  "action.recover": {
    subject: "None",
    touches: ["Metadata"],
    effect: "Read",
    cost: "Mutation",
    cardinality: "One",
  },
  "action.resume": {
    subject: "None",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "action.cancel": {
    subject: "None",
    touches: ["Metadata"],
    effect: "SessionWrite",
    cost: "Mutation",
    cardinality: "One",
  },
  "family.read": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "Read",
    cost: "Mutation",
    cardinality: "One",
  },
  "family.cancel-read": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "Read",
    cost: "Mutation",
    cardinality: "One",
  },
  "family.saved": {
    subject: "None",
    touches: ["Metadata"],
    effect: "Read",
    cost: "Mutation",
    cardinality: "One",
  },
  "parameter-links.read": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "Read",
    cost: "Mutation",
    cardinality: "One",
  },
  "schedule.grid.catalog": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "Read",
    cost: "Mutation",
    cardinality: "One",
  },
  "schedule.grid.snapshot": {
    subject: "Elements",
    touches: ["Metadata"],
    effect: "Read",
    cost: "Mutation",
    cardinality: "One",
  },
  "schedule.grid.work": {
    subject: "None",
    touches: ["Metadata"],
    effect: "Read",
    cost: "Mutation",
    cardinality: "One",
  },
  "schedule.grid.history": {
    subject: "None",
    touches: ["Metadata"],
    effect: "Read",
    cost: "Mutation",
    cardinality: "One",
  },
  "schedule.grid.saved": {
    subject: "None",
    touches: ["Metadata"],
    effect: "Read",
    cost: "Mutation",
    cardinality: "One",
  },
  "instances.read": {
    subject: "None",
    touches: ["Metadata"],
    effect: "Read",
    cost: "Mutation",
    cardinality: "One",
  },
} satisfies Record<Exclude<HostActionKey, PreviewKey | OwnAxesKey>, CatalogAxes>;
const declaredAxes = { ...handAxes, ...ownAxes } satisfies Record<Exclude<HostActionKey, PreviewKey>, CatalogAxes>;

/**
 * A preview has the write's subject, Touches and cost by construction. Its Effect is its native leaf's
 * (ADR 0030 rule 4): a Read plan opens no transaction; anything else is a TransactRead rehearsal that
 * declares rollback. The linker refuses a ModelWrite whose preview binding breaks that.
 */
// No native leaf never means Read: families.apply.preview has none and still rehearses (0b001e2f).
const isReadPlan = (action: object) =>
  hostOpCatalog.find((op) => op.key === (action as { native?: readonly string[] }).native?.[0])?.effect === "Read";
const previewAxes = Object.fromEntries(
  Object.entries(hostActions).flatMap(([key, action]) =>
    "writeBoundary" in action && action.writeBoundary.phase === "preview" && !("axes" in action)
      ? [
          [
            key,
            {
              ...declaredAxes[action.writeBoundary.key as keyof typeof declaredAxes],
              ...(isReadPlan(action) ? { effect: "Read" } : { effect: "TransactRead", rollsBack: true }),
            },
          ],
        ]
      : [],
  ),
) as unknown as Record<PreviewKey, CatalogAxes>;
const allAxes = { ...declaredAxes, ...previewAxes } satisfies Record<HostActionKey,CatalogAxes>;
export const commandCatalogAxes: {[K in keyof typeof allAxes]:CatalogAxes & Pick<(typeof allAxes)[K],"effect">} = allAxes;

// The seal follows the axis: a Work write is sealed exactly when its Effect is ModelWrite. A
// SessionWrite capture uses `workIntent` and carries no boundary; the linker refuses the converse.
for (const [key, action] of Object.entries(hostActions)) {
  const phase = "writeBoundary" in action ? action.writeBoundary.phase : undefined;
  const effect = commandCatalogAxes[key as HostActionKey].effect;
  const allowed = phase === "apply" ? ["ModelWrite"] : ["Read", "TransactRead"];
  if (phase && !allowed.includes(effect))
    throw Error(`${key}: a ${phase} write boundary needs Effect ${allowed.join(" or ")}, not ${effect}`);
}
