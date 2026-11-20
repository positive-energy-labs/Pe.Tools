/**
 * /ducts Work, every segment a family of cells with one staged edit each. The
 * fan-side cells live in the /fans Work (`fans.ts`, FANSPLIT); pricing reads both (`ductsDesign`).
 * - `assumptions`, keyed by what the assumption is about: an issue id from the snapshot
 *   (`open-end:g123:456:1`) holds a verdict; `flex-roughness:<flex type>`,
 *   `fan-static:<equipment id>`, `component-drop:<family>` hold overrides. An `ignore` verdict is a
 *   ruling the model keeps (`_PE_DuctLosses` v2 `verdicts`, ducts-domain `rulings.ts`): Work holds
 *   only the pending delta over the stored one, and a delete edit takes it back.
 * - `rules`: loss-rule key (the web's `LOSS_RULES`) -> the ASHRAE table every instance of the rule
 *   is re-looked-up under. Either author edits a type's table, never a raw coefficient.
 * - The scene (pressure-drop ledger, 2026-10-19): `subject`, keyed by group id, each cell an ORDERED
 *   element-id list; `labelParameter`, one cell naming the instance parameter whose value names
 *   equipment for people (`ducts.snapshot` reads it into `DuctNode.label`). Either author stages
 *   both. A claim with a verdict is a finding (ADR 0035 rule 9), not ducts Work.
 * - `workingPhase` (kaitpw 2026-10-19), one cell naming the phase the firm's views show (a name in
 *   the snapshot's `phases.order`); either author stages it from the snapshot's view
 *   census, and the route leaves out every element that does not exist in it (`phases.ts`).
 * `ducts.apply` runs from two doors (D9). /fans writes the fitting coefficients of the rules named in `writeIntent.cells`,
 * the fans Work's drops, flows, complete-claim ESP and slots to Revit, and roles to the store. /duct-systems stores its
 * staged rule tables and verdicts and writes no element.
 */
import { decode, subjectOf, subjectRefCodeSchema } from "@pe/agent-contracts/subject-ref";
import { isRecord } from "@pe/agent-contracts";
import { cell, workSchema } from "@pe/agent-contracts/product";
import { serveSetting, type SettingTierRead } from "@pe/agent-contracts/tiered-setting";
import { z } from "zod";
import {
  DUCT_PARAMETER_KEYS,
  ductParameterNameSchema,
  DUCT_UNIT_KINDS,
  DUCTS_CRITERIA_CELLS,
  type DuctsCriteriaCell,
} from "./duct-inputs.ts";
import { criterionLabel } from "./criterion-words.neutral.ts";

export const DUCT_SYSTEMS_ROUTE = "duct-systems";

export const ductAssumptionSchema = z.discriminatedUnion("kind", [
  /**
   * capped: the open end carries no flow; connect: it must be connected in the model; ignore: leave
   * it out. On a proximity finding id: ignore breaks the inference; connect confirms it (and joins a
   * near miss across classifications anyway). Only a staged verdict rules.
   */
  z.strictObject({ kind: z.literal("verdict"), verdict: z.enum(["capped", "connect", "ignore"]) }),
  z.strictObject({ kind: z.literal("flex-roughness"), ft: z.number().positive() }),
  z.strictObject({ kind: z.literal("fan-static"), inWg: z.number().nonnegative() }),
  z.strictObject({ kind: z.literal("component-drop"), inWg: z.number().nonnegative() }),
]);
export type DuctAssumption = z.infer<typeof ductAssumptionSchema>;

const OVERRIDES = ["flex-roughness", "fan-static", "component-drop"] as const;
export type DuctOverrideKind = (typeof OVERRIDES)[number];

const kindOfKey = (key: string): DuctAssumption["kind"] => {
  const head = key.slice(0, key.indexOf(":"));
  return OVERRIDES.find((kind) => kind === head) ?? "verdict";
};

export const DUCT_AIR_TYPES = ["supply", "return", "exhaust", "fresh", "unknown"] as const;
export type DuctAirType = (typeof DUCT_AIR_TYPES)[number];
const ductInk = z.string().regex(/^#[\da-f]{6}$/i, "Use a six-digit hex colour, such as #0569a5");
export const ductSystemColoursSchema = z.strictObject({
  supply: ductInk,
  return: ductInk,
  exhaust: ductInk,
  fresh: ductInk,
  unknown: ductInk,
});
export type DuctSystemColours = z.infer<typeof ductSystemColoursSchema>;

const nonempty = z.string().min(1);
const named = <S extends z.ZodType>(value: S) => z.record(nonempty, value);
const value = <S extends z.ZodType, const K extends "route" | "name">(shape: S, per: K) =>
  cell({ kind: "value", shape }, per);
const criterion = <K extends DuctsCriteriaCell>(key: K) => {
  const {
    domain,
    layer: [name, side],
  } = DUCTS_CRITERIA_CELLS[key];
  return cell(domain, "route", {
    label: side ? criterionLabel(name) + " " + side : criterionLabel(name),
  });
};
export const ductSystemCells = {
  velocitySupplyFpm: criterion("velocitySupplyFpm"),
  velocityReturnFpm: criterion("velocityReturnFpm"),
  terminalDropInWg: criterion("terminalDropInWg"),
  autoJoinGapIn: criterion("autoJoinGapIn"),
  healBoxIn: criterion("healBoxIn"),
  splitPolicy: criterion("splitPolicy"),
  allowanceSupplyInWg: criterion("allowanceSupplyInWg"),
  allowanceReturnInWg: criterion("allowanceReturnInWg"),
  writeIntent: value(
    z.strictObject({
      /** Network groups as SubjectRef `group:<id>` codes (ADR 0035 rule 2), decoded at this door. */
      groups: z
        .array(
          subjectRefCodeSchema.refine(
            (code) => decode(code).ok && subjectOf(code).keyKind === "group",
            {
              message: "a write-scope group is a group:<id> SubjectRef",
            },
          ),
        )
        .readonly()
        .optional(),
      cells: z
        .array(z.tuple([z.literal("rules"), z.string().min(1)]).readonly())
        .min(1)
        .readonly()
        .optional()
        .describe(
          'The rule cells whose fitting coefficients a /fans sheet.apply writes to elements, for example [["rules","elbow-round"]]; omitted, no fitting is written. The rule itself stays staged. Preview and apply use the same scope.',
        ),
      fan: z.strictObject({ unitId: z.number().int(), systemId: z.number().int() }).optional(),
    }),
    "route",
  ),
  assumptions: cell({ kind: "value", shape: ductAssumptionSchema }, "name", {
    deletable: true,
    record: <S extends z.ZodType>(shape: S) =>
      z.record(z.string(), shape).superRefine((rows, ctx) => {
        for (const [key, row] of Object.entries(rows)) {
          const value = isRecord(row) && isRecord(row.edit) ? row.edit.value : undefined;
          const kind = kindOfKey(key);
          if (isRecord(value) && value.kind !== kind)
            ctx.addIssue({
              code: "custom",
              path: [key, "edit", "value"],
              message: `the key ${key} holds a ${kind}, not a ${value.kind}`,
            });
        }
      }),
  }),
  rules: value(z.strictObject({ table: nonempty }), "name"),
  catalogs: value(z.strictObject({ table: nonempty }), "name"),
  ruleAssignments: cell({ kind: "value", shape: z.strictObject({ rule: nonempty }) }, "name", {
    record: named,
  }),
  subject: cell({ kind: "value", shape: z.array(z.number().int()).min(1).readonly() }, "name", {
    record: named,
  }),
  labelParameter: cell({ kind: "text", shape: nonempty.nullable() }, "route"),
  workingPhase: cell({ kind: "text", shape: nonempty.nullable() }, "route"),
  systemColours: value(ductSystemColoursSchema, "route"),
  kinds: cell({ kind: "value", shape: z.strictObject({ kind: z.enum(DUCT_UNIT_KINDS) }) }, "name", {
    record: named,
  }),
};
export const ductsDocumentSchema = workSchema(ductSystemCells);
export type DuctsRouteDocument = z.infer<typeof ductsDocumentSchema>;

/** Host requests project only served names; native fallbacks belong to the default tier. */
export const ductParameterSlots = (settings?: readonly SettingTierRead[]) =>
  Object.fromEntries(
    DUCT_PARAMETER_KEYS.map((key) => {
      const served = serveSetting(
        settings,
        ["project", "firm"],
        ["parameters", key],
        ductParameterNameSchema(key),
      );
      return [
        key,
        {
          name: served.value,
          source: ductSlotSourcesSchema.valueType.shape.source.parse(served.tier),
          ref: served.ref,
          note: served.note,
        },
      ];
    }),
  );
export const ductSlotSourcesSchema = z.record(
  z.string(),
  z.object({
    name: z.string().nullable(),
    source: z.enum(["project", "firm", "default"]),
    ref: z.string().optional(),
    note: z.string().optional(),
  }),
);
export const ductSlotRequest = (settings?: readonly SettingTierRead[]) =>
  Object.fromEntries(
    Object.entries(ductParameterSlots(settings)).flatMap(([key, slot]) =>
      slot.name == null ? [] : [[key, slot.name]],
    ),
  );
export const slotLayer = (
  snapshot:
    | {
        readonly slots: Readonly<Record<string, string | null>>;
        readonly slotSources?: Readonly<z.output<typeof ductSlotSourcesSchema>>;
      }
    | null
    | undefined,
  key: string,
) => ({
  source: "default" as const,
  ...snapshot?.slotSources?.[key],
  value: snapshot?.slots[key] ?? null,
});
