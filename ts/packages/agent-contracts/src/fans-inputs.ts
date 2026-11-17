import { sourcedValueSchema, authoredValueSchema } from "./work-value.ts";
export { sourcedValueSchema, authoredValueSchema } from "./work-value.ts";
import type { ValueSource, SourcedValue, AuthoredValue } from "./work-value.ts";
export type { SourcedValue, AuthoredValue } from "./work-value.ts";
import type { Domain } from "./slots/sheet.ts";
import type { FanBlockerKind } from "@pe/host-contracts/generated";
import { DUCT_UNIT_KINDS, FAN_BLOCKER_KINDS } from "@pe/host-contracts/generated";
import { z } from "zod";
import { VALUE_SOURCES } from "./work-value.ts";
import { schemaOf } from "./slots/sheet.ts";
import type { DuctsCriteriaLayer } from "./ducts-sheet.ts";

export type FanRef = { unitId: number; portIndex: number };
export type FanInputRow<T> = {
  name: string;
  role: "input" | "result";
  on: "fan" | "terminal" | "component" | "fitting" | "criteria";
  domain: Domain;
  home: "Work" | "project" | "firm" | "model" | "derived";
  owner: "fans" | "ducts";
  layers: readonly ValueSource[];
  segment: string | null;
  parameter: "requiredEsp" | "ratedEsp" | "fanFlow" | "componentDrop" |
    "terminalDrop" | "fittingCoefficient" | "terminalFlow" | null;
  write: "stated-only" | "never";
  accepts: (value: unknown) => value is T;
};
export type CoverageGap = {
  kind: "native-peer" | "budget" | "pricing" | "host-calc" | "cycle";
  elementId: number | null; ref: string;
};
export type Encounter = {
  fan: FanRef; host: FanRef; elementId: number; connector: number;
  side: "supply" | "return";
  verdict: "unruled" | "accepted" | "refused";
  static: { kind: "none" } | { kind: "host-calc"; basis: string;
    inWg: number; source: string };
};
export type FanClaim =
  | { kind: "complete"; basis: string; requiredEspInWg: number;
      coverage: readonly []; blockingIds: readonly [] }
  | { kind: "to-boundary"; basis: string; knownInWg: number;
      boundaries: readonly [Encounter, ...Encounter[]];
      coverage: readonly []; blockingIds: readonly string[] }
  | { kind: "incomplete"; basis: string; knownInWg: number;
      coverage: readonly CoverageGap[]; blockingIds: readonly string[] };
export type InputTarget = {
  work: "fans" | "ducts"; segment: string; row: string;
};
export type FanCloser =
  | { kind: "cell"; target: InputTarget;
      offers: readonly AuthoredValue<number>[] }
  | { kind: "heal"; pair: readonly [string, string] }
  | { kind: "encounter"; encounter: Encounter }
  | { kind: "none"; reason: string };
export type FanIssue = {
  id: string; kind: FanBlockerKind; elementId: number;
  severity: "blocking" | "warning"; closer: FanCloser;
};
export type LegEvidence =
  | { kind: "friction"; roughnessFt: number; lengthFt: number;
      hydraulicDiameterFt: number; ref: string }
  | { kind: "coefficient"; coefficient: number;
      velocityPressureInWg: number; basisElementId: number;
      rule: string; table: string;
      lookup: Readonly<Record<string, number | string>>; ref: string }
  | { kind: "drop"; value: SourcedValue<number> }
  | { kind: "unpriced"; issueId: string };
export type FanParameterCohort = {
  parameter: string;
  owner: { kind: "instance" | "type"; id: number };
  members: readonly { elementId: number; uniqueId: string }[];
  basis: string; complete: boolean;
};
export type FanEspValues = {
  rated: SourcedValue<number>;
  required: FanClaim;
};
export type SetAsideRow = {
  work: "fans" | "ducts"; segment: string; row: string;
  source: string | null; ref: string | null;
};

export type { DuctUnitKind, FanBlockerKind } from "@pe/host-contracts/generated";

const ref = z.string().min(1).refine(value => value.trim().length > 0, "evidence identity must be nonempty");
const pressure = z.number().finite().nonnegative();
const id = z.number().int().positive();
export const fanRefSchema = z.strictObject({ unitId: id, portIndex: z.number().int().nonnegative() });
export const coverageGapSchema = z.strictObject({ kind: z.enum(["native-peer", "budget", "pricing", "host-calc", "cycle"]), elementId: id.nullable(), ref });
export const encounterSchema = z.strictObject({
  fan: fanRefSchema, host: fanRefSchema, elementId: id, connector: z.number().int().nonnegative(),
  side: z.enum(["supply", "return"]), verdict: z.enum(["unruled", "accepted", "refused"]),
  static: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("none") }), z.strictObject({ kind: z.literal("host-calc"), basis: ref, inWg: pressure, source: ref })]),
});
export const fanClaimSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("complete"), basis: ref, requiredEspInWg: pressure, coverage: z.tuple([]), blockingIds: z.tuple([]) }),
  z.strictObject({ kind: z.literal("to-boundary"), basis: ref, knownInWg: pressure, boundaries: z.tuple([encounterSchema], encounterSchema), coverage: z.tuple([]), blockingIds: z.array(ref) }),
  z.strictObject({ kind: z.literal("incomplete"), basis: ref, knownInWg: pressure, coverage: z.array(coverageGapSchema), blockingIds: z.array(ref) }),
]);
export const inputTargetSchema = z.strictObject({ work: z.enum(["fans", "ducts"]), segment: ref, row: ref });
export const fanCloserSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("cell"), target: inputTargetSchema, offers: z.array(authoredValueSchema(pressure)) }),
  z.strictObject({ kind: z.literal("heal"), pair: z.tuple([ref, ref]) }),
  z.strictObject({ kind: z.literal("encounter"), encounter: encounterSchema }),
  z.strictObject({ kind: z.literal("none"), reason: ref }),
]);
export const fanIssueSchema = z.strictObject({ id: ref, kind: z.enum(FAN_BLOCKER_KINDS), elementId: id, severity: z.enum(["blocking", "warning"]), closer: fanCloserSchema });
export const legEvidenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("friction"), roughnessFt: pressure, lengthFt: pressure, hydraulicDiameterFt: pressure.positive(), ref }),
  z.strictObject({ kind: z.literal("coefficient"), coefficient: pressure, velocityPressureInWg: pressure, basisElementId: id, rule: ref, table: ref, lookup: z.record(z.string(), z.union([z.number().finite(), z.string()])), ref }),
  z.strictObject({ kind: z.literal("drop"), value: sourcedValueSchema(pressure) }),
  z.strictObject({ kind: z.literal("unpriced"), issueId: ref }),
]);
export const fanParameterCohortSchema = z.strictObject({
  parameter: ref, owner: z.strictObject({ kind: z.enum(["instance", "type"]), id }),
  members: z.array(z.strictObject({ elementId: id, uniqueId: ref })), basis: ref, complete: z.boolean(),
}).refine(c => !c.complete || (c.members.length > 0 && new Set(c.members.map(m => m.elementId)).size === c.members.length && (c.owner.kind !== "instance" || (c.members.length === 1 && c.members[0].elementId === c.owner.id))), "complete cohorts require distinct members and one instance owner");
export const fanEspValuesSchema = z.strictObject({ rated: sourcedValueSchema(pressure), required: fanClaimSchema });
export const setAsideRowSchema = z.strictObject({ work: z.enum(["fans", "ducts"]), segment: ref, row: ref, source: z.string().nullable(), ref: ref.nullable() });

const numberDomain = (unit: string) => ({ kind: "number", min: 0, unit } as const);
const inWg = { kind: "object", fields: { inWg: numberDomain("in-wg") } } as const;
const criterion = <const L extends readonly [keyof DuctsCriteriaLayer, ("supply" | "return")?], const D extends Domain>(layer: L, domain: D) =>
  ({ layer, domain, value: schemaOf(domain), unit: domain.kind === "number" ? domain.unit : undefined });
const splitPolicy = z.enum(["even", "proportional"]);
/** Criteria cell locators and domains feed the same input table as the fan cells. */
export const FAN_CRITERIA_CELLS = {
  velocitySupplyFpm: criterion(["velocityLimitFpm", "supply"], { kind: "number", exclusiveMin: 0, unit: "fpm" }),
  velocityReturnFpm: criterion(["velocityLimitFpm", "return"], { kind: "number", exclusiveMin: 0, unit: "fpm" }),
  terminalDropInWg: criterion(["terminalDropInWg"], { kind: "number", min: 0, unit: "in-wg" }),
  autoJoinGapIn: criterion(["autoJoinGapIn"], { kind: "number", min: 0, unit: "in" }),
  healBoxIn: criterion(["healBoxIn"], { kind: "number", min: 0, unit: "in" }),
  splitPolicy: criterion(["splitPolicy"], { kind: "enum", shape: splitPolicy, choices: ["even", "proportional"].map(value => ({ value, label: value })) }),
  allowanceSupplyInWg: criterion(["allowanceInWg", "supply"], { kind: "number", min: 0, unit: "in-wg" }),
  allowanceReturnInWg: criterion(["allowanceInWg", "return"], { kind: "number", min: 0, unit: "in-wg" }),
};
const row = <const R extends Omit<FanInputRow<unknown>, "accepts" | "layers">>(definition: R) => ({
  ...definition, layers: VALUE_SOURCES,
  accepts: (value: unknown): value is unknown => schemaOf(definition.domain).safeParse(value).success,
});
const input = <const D extends Domain>(name: string, on: FanInputRow<unknown>["on"], segment: string, parameter: FanInputRow<unknown>["parameter"], domain: D) =>
  row({ name, role: "input", on, domain, home: "Work", owner: "fans", segment, parameter, write: "stated-only" } as const);
/**
 * The Fans Work cells, by segment name: the rows the Fans document schema and the Fans sheet read
 * by name, so neither restates a domain nor counts positions in the table below.
 */
export const FAN_CELLS = {
  /** The ESP the fan is rated for, as someone stated it. Work or a separately named rated parameter, never the required ESP write target (P-030). */
  ratedEsp: row({ name: "ratedEsp", role: "input", on: "fan", domain: inWg, home: "Work", owner: "fans", segment: "ratedEsp", parameter: "ratedEsp", write: "never" }),
  equipmentFlows: input("equipmentFlows", "fan", "equipmentFlows", "fanFlow", numberDomain("cfm")),
  flows: input("flows", "terminal", "flows", "terminalFlow", numberDomain("cfm")),
  terminalDrops: input("terminalDrops", "terminal", "terminalDrops", "terminalDrop", inWg),
  componentDrops: input("componentDrops", "component", "componentDrops", "componentDrop", inWg),
  roles: row({ name: "roles", role: "input", on: "fan", domain: { kind: "object", fields: { role: { kind: "enum", shape: z.enum(["fan", "passive"]), choices: ["fan", "passive"].map(value => ({ value, label: value })) } } }, home: "Work", owner: "fans", segment: "roles", parameter: null, write: "never" }),
};
/** Phase 2 keeps metadata beside its existing consumer; phase 4 moves this single table to fans/contract. */
export const FAN_INPUTS = [
  FAN_CELLS.ratedEsp, FAN_CELLS.equipmentFlows, FAN_CELLS.flows, FAN_CELLS.terminalDrops, FAN_CELLS.componentDrops,
  row({ name: "fittingCoefficient", role: "input", on: "fitting", domain: numberDomain(""), home: "model", owner: "ducts", segment: null, parameter: "fittingCoefficient", write: "never" }),
  FAN_CELLS.roles,
  row({ name: "kinds", role: "input", on: "fan", domain: { kind: "enum", shape: z.enum(DUCT_UNIT_KINDS), choices: DUCT_UNIT_KINDS.map(value => ({ value, label: value })) }, home: "Work", owner: "ducts", segment: "kinds", parameter: null, write: "never" }),
  row({ name: "derivedFlow", role: "result", on: "fan", domain: numberDomain("cfm"), home: "derived", owner: "fans", segment: null, parameter: null, write: "never" }),
  row({ name: "requiredEsp", role: "result", on: "fan", domain: numberDomain("in-wg"), home: "derived", owner: "fans", segment: null, parameter: null, write: "never" }),
  ...Object.entries(FAN_CRITERIA_CELLS).map(([name, cell]) => row({ name, role: "input", on: "criteria", domain: cell.domain, home: "project", owner: "ducts", segment: "criteria", parameter: null, write: "never" })),
] as const satisfies readonly FanInputRow<unknown>[];
export const fanInputRows = (rows: readonly FanInputRow<unknown>[] = FAN_INPUTS) => rows.filter(r => r.role === "input");
export const fanWriteRows = (rows: readonly FanInputRow<unknown>[] = FAN_INPUTS) => rows.filter(r => r.write === "stated-only" && r.segment !== null);
export const fanBindingRows = (rows: readonly FanInputRow<unknown>[] = FAN_INPUTS) => rows.filter(r => r.segment !== null);
export const fanInputShape = (rows: readonly FanInputRow<unknown>[] = FAN_INPUTS) => Object.fromEntries(fanBindingRows(rows).map(r => [r.name, schemaOf(r.domain)]));
export const FAN_PARAMETER_KEYS = [...new Set(FAN_INPUTS.flatMap(r => r.parameter === null ? [] : [r.parameter]))];
