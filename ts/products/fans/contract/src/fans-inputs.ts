import { sourcedValueSchema, authoredValueSchema } from "@pe/agent-contracts/work-value";
export { sourcedValueSchema, authoredValueSchema } from "@pe/agent-contracts/work-value";
import type { SourcedValue, AuthoredValue } from "@pe/agent-contracts/work-value";
export type { SourcedValue, AuthoredValue } from "@pe/agent-contracts/work-value";
import type { FanBlockerKind } from "@pe/host-contracts/generated";
import { FAN_BLOCKER_KINDS } from "@pe/host-contracts/generated";
import { z } from "zod";

export type FanRef = { unitId: number; portIndex: number };
export type CoverageGap = {
  kind: "native-peer" | "budget" | "pricing" | "host-calc" | "cycle";
  elementId: number | null;
  ref: string;
};
export type Encounter = {
  fan: FanRef;
  host: FanRef;
  elementId: number;
  connector: number;
  side: "supply" | "return";
  verdict: "unruled" | "accepted" | "refused";
  static: { kind: "none" } | { kind: "host-calc"; basis: string; inWg: number; source: string };
};
export type FanClaim =
  | {
      kind: "complete";
      basis: string;
      requiredEspInWg: number;
      coverage: readonly [];
      blockingIds: readonly [];
    }
  | {
      kind: "to-boundary";
      basis: string;
      knownInWg: number;
      boundaries: readonly [Encounter, ...Encounter[]];
      coverage: readonly [];
      blockingIds: readonly string[];
    }
  | {
      kind: "incomplete";
      basis: string;
      knownInWg: number;
      coverage: readonly CoverageGap[];
      blockingIds: readonly string[];
    };
export type InputTarget = {
  work: "fans" | "duct-systems";
  segment: string;
  row: string;
};
export type FanCloser =
  | { kind: "cell"; target: InputTarget; offers: readonly AuthoredValue<number>[] }
  | { kind: "heal"; pair: readonly [string, string] }
  | { kind: "encounter"; encounter: Encounter }
  | { kind: "none"; reason: string };
export type FanIssue = {
  id: string;
  kind: FanBlockerKind;
  elementId: number;
  severity: "blocking" | "warning";
  closer: FanCloser;
};
export type LegEvidence =
  | {
      kind: "friction";
      roughnessFt: number;
      lengthFt: number;
      hydraulicDiameterFt: number;
      ref: string;
    }
  | {
      kind: "coefficient";
      coefficient: number;
      velocityPressureInWg: number;
      basisElementId: number;
      rule: string;
      table: string;
      lookup: Readonly<Record<string, number | string>>;
      ref: string;
    }
  | { kind: "drop"; value: SourcedValue<number> }
  | { kind: "unpriced"; issueId: string };
export type FanParameterCohort = {
  parameter: string;
  owner: { kind: "instance" | "type"; id: number };
  members: readonly { elementId: number; uniqueId: string }[];
  basis: string;
  complete: boolean;
};
export type FanEspValues = {
  rated: SourcedValue<number>;
  required: FanClaim;
};

export type { DuctUnitKind, FanBlockerKind } from "@pe/host-contracts/generated";

const ref = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "evidence identity must be nonempty");
const pressure = z.number().finite().nonnegative();
const id = z.number().int().positive();
export const fanRefSchema = z.strictObject({
  unitId: id,
  portIndex: z.number().int().nonnegative(),
});
export const coverageGapSchema = z.strictObject({
  kind: z.enum(["native-peer", "budget", "pricing", "host-calc", "cycle"]),
  elementId: id.nullable(),
  ref,
});
export const encounterSchema = z.strictObject({
  fan: fanRefSchema,
  host: fanRefSchema,
  elementId: id,
  connector: z.number().int().nonnegative(),
  side: z.enum(["supply", "return"]),
  verdict: z.enum(["unruled", "accepted", "refused"]),
  static: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({ kind: z.literal("host-calc"), basis: ref, inWg: pressure, source: ref }),
  ]),
});
export const fanClaimSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("complete"),
    basis: ref,
    requiredEspInWg: pressure,
    coverage: z.tuple([]),
    blockingIds: z.tuple([]),
  }),
  z.strictObject({
    kind: z.literal("to-boundary"),
    basis: ref,
    knownInWg: pressure,
    boundaries: z.tuple([encounterSchema], encounterSchema),
    coverage: z.tuple([]),
    blockingIds: z.array(ref),
  }),
  z.strictObject({
    kind: z.literal("incomplete"),
    basis: ref,
    knownInWg: pressure,
    coverage: z.array(coverageGapSchema),
    blockingIds: z.array(ref),
  }),
]);
export const inputTargetSchema = z.strictObject({
  work: z.enum(["fans", "duct-systems"]),
  segment: ref,
  row: ref,
});
export const fanCloserSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("cell"),
    target: inputTargetSchema,
    offers: z.array(authoredValueSchema(pressure)),
  }),
  z.strictObject({ kind: z.literal("heal"), pair: z.tuple([ref, ref]) }),
  z.strictObject({ kind: z.literal("encounter"), encounter: encounterSchema }),
  z.strictObject({ kind: z.literal("none"), reason: ref }),
]);
export const fanIssueSchema = z.strictObject({
  id: ref,
  kind: z.enum(FAN_BLOCKER_KINDS),
  elementId: id,
  severity: z.enum(["blocking", "warning"]),
  closer: fanCloserSchema,
});
export const legEvidenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("friction"),
    roughnessFt: pressure,
    lengthFt: pressure,
    hydraulicDiameterFt: pressure.positive(),
    ref,
  }),
  z.strictObject({
    kind: z.literal("coefficient"),
    coefficient: z.number().finite(),
    velocityPressureInWg: pressure,
    basisElementId: id,
    rule: ref,
    table: ref,
    lookup: z.record(z.string(), z.union([z.number().finite(), z.string()])),
    ref,
  }),
  z.strictObject({ kind: z.literal("drop"), value: sourcedValueSchema(pressure) }),
  z.strictObject({ kind: z.literal("unpriced"), issueId: ref }),
]);
export const fanParameterCohortSchema = z
  .strictObject({
    parameter: ref,
    owner: z.strictObject({ kind: z.enum(["instance", "type"]), id }),
    members: z.array(z.strictObject({ elementId: id, uniqueId: ref })),
    basis: ref,
    complete: z.boolean(),
  })
  .refine(
    (c) =>
      !c.complete ||
      (c.members.length > 0 &&
        new Set(c.members.map((m) => m.elementId)).size === c.members.length &&
        (c.owner.kind !== "instance" ||
          (c.members.length === 1 && c.members[0].elementId === c.owner.id))),
    "complete cohorts require distinct members and one instance owner",
  );
export const fanEspValuesSchema = z.strictObject({
  rated: sourcedValueSchema(pressure),
  required: fanClaimSchema,
});
