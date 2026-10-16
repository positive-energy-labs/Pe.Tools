/**
 * /ducts Work, every segment a family of trichotomy cells (Pea proposes, a person stages):
 * - `assumptions`, keyed by what the assumption is about: an issue id from the snapshot
 *   (`open-end:g123:456:1`) holds a verdict; `flex-roughness:<flex type>`,
 *   `fan-static:<equipment id>`, `component-drop:<family>` hold overrides. Never written to Revit.
 * - `rules`: loss-rule key (the web's `LOSS_RULES`) -> the ASHRAE table every instance of the rule
 *   is re-looked-up under. A person edits a type's table, never a raw coefficient.
 * - `terminalDrops` (terminal id) and `componentDrops` (fitting or accessory id): a stated drop in
 *   in-wg and where it came from.
 * - `unitStatics` (air mover id): the external static Pe writes to a unit, in in-wg.
 * - `loads`, one cell keyed `preview`: the load tool's Load Preview as parsed (systems, each tagged
 *   by the equipment Mark in its name, with its rooms). `flows` (terminal id): a stated design flow
 *   in cfm that overrides the preview split. Neither is written to Revit.
 * - `parameters`: which Revit parameter carries each slot; person-only, Pea cannot propose.
 * `ducts.apply` writes the staged rules, drops, unit statics and slots to Revit.
 */
import { z } from "zod";

import { type RouteStateSpec } from "./route-state.ts";
import { trichotomyCellSchema } from "./trichotomy.ts";

export const ductAssumptionSchema = z.discriminatedUnion("kind", [
  /** capped: the open end carries no flow; connect: it must be connected in the model; ignore: leave it out. */
  z.strictObject({ kind: z.literal("verdict"), verdict: z.enum(["capped", "connect", "ignore"]) }),
  z.strictObject({ kind: z.literal("flex-roughness"), ft: z.number().positive() }),
  z.strictObject({ kind: z.literal("fan-static"), inWg: z.number().nonnegative() }),
  z.strictObject({ kind: z.literal("component-drop"), inWg: z.number().nonnegative() }),
]);
export type DuctAssumption = z.infer<typeof ductAssumptionSchema>;

const OVERRIDES = ["flex-roughness", "fan-static", "component-drop"] as const;
export type DuctOverrideKind = (typeof OVERRIDES)[number];

/** The cell key of an override: `<kind>:<subject>`. Any other key is an issue id and holds a verdict. */
export const ductOverrideKey = (kind: DuctOverrideKind, subject: string | number) =>
  `${kind}:${subject}`;
const kindOfKey = (key: string): DuctAssumption["kind"] => {
  const head = key.slice(0, key.indexOf(":"));
  return (OVERRIDES as readonly string[]).includes(head) ? (head as DuctOverrideKind) : "verdict";
};

/** The parameter slots `ducts.snapshot` reads and `ducts.apply` writes through. */
export const DUCT_PARAMETER_KEYS = [
  "fanStatic",
  "fanFlow",
  "componentDrop",
  "terminalDrop",
  "fittingCoefficient",
] as const;
export type DuctParameterKey = (typeof DUCT_PARAMETER_KEYS)[number];

const dropSchema = z.strictObject({
  inWg: z.number().nonnegative(),
  /** Where the number came from: a catalog page, a submittal, "rule of thumb". */
  source: z.string().optional(),
});
export type DuctDrop = z.infer<typeof dropSchema>;
/** The external static Pe writes to an air mover (a unit id key); staged only, never a side effect. */
const unitStaticSchema = z.strictObject({ inWg: z.number().nonnegative() });
const elementKey = z.string().regex(/^\d+$/, { error: "a drop cell key is an element id" });

/** The load tool's Load Preview: one system per equipment (its Mark is the tag), its rooms under it. */
const loadRoomSchema = z.strictObject({
  name: z.string().min(1),
  number: z.string().nullable(),
  cfm: z.number().nonnegative().nullable(),
});
export const ductLoadPreviewSchema = z.strictObject({
  systems: z.array(
    z.strictObject({
      name: z.string().min(1),
      tag: z.string().nullable(),
      cfm: z.number().nonnegative().nullable(),
      rooms: z.array(loadRoomSchema),
    }),
  ),
});
export type DuctLoadPreview = z.infer<typeof ductLoadPreviewSchema>;
/** A terminal's stated design flow; `source` says where (a balancing report, a note, a person). */
const flowSchema = z.strictObject({ cfm: z.number().nonnegative(), source: z.string().optional() });
export type DuctFlow = z.infer<typeof flowSchema>;

/** Exact retained connector witness. A matching index alone does not establish the same port. */
const elementIdentity = z.strictObject({
  id: z.number().int().positive(),
  uniqueId: z.string().min(1),
});
export const ductPortPinSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  point: z.tuple([z.number(), z.number(), z.number()]),
  shape: z.enum(["round", "rectangular", "oval", "other"]),
  diameterIn: z.number().positive().nullable(),
  widthIn: z.number().positive().nullable(),
  heightIn: z.number().positive().nullable(),
  direction: z.string().min(1),
  connectedTo: elementIdentity
    .extend({ connector: z.number().int().nonnegative() })
    .nullable()
    .describe(
      "Required exact native peer witness; null asserts this physical port has no peer. It supplies no pressure, loss or flow premise by itself.",
    ),
});
const designPoint = z.strictObject({
  totalLossInWg: z
    .number()
    .nonnegative()
    .describe(
      "Dissipative TOTAL pressure loss in in-wg at flowCfm between the source's exact upstream/downstream planes. Not catalog static pressure. If starting with static loss, caller must establish both velocity pressures and convert: totalLoss = staticLoss + PvUp - PvDown. No automatic conversion or invented curve.",
    ),
  flowCfm: z
    .number()
    .nonnegative()
    .describe(
      "The exact flow of this sourced TOTAL-loss design point. It is not a curve and is not extrapolated to another flow.",
    ),
  source: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Inspectable source or staged design assumption identifying pressure basis, measurement planes and flow; retain any caller static-to-total conversion inputs and rationale.",
    ),
});
/** Exact component content, excluding polling timestamps and measured/computed flows. */
export const ductComponentWitnessSchema = z.array(
  z.strictObject({
    element: elementIdentity,
    coordinateEncoding: z.literal("native-double").nullable(),
    curveKind: z.enum(["line", "arc", "flex-polyline", "other"]).nullable(),
    kind: z.string(),
    family: z.string().nullable(),
    type: z.string().nullable(),
    partType: z.string().nullable(),
    classification: z.string().nullable(),
    ports: z.array(
      z.strictObject({
        index: z.number().int(),
        kind: z.string(),
        point: z.array(z.number()).length(3),
        shape: z.string(),
        diameterIn: z.number().nullable(),
        widthIn: z.number().nullable(),
        heightIn: z.number().nullable(),
        direction: z.string(),
        classification: z.string().nullable(),
        connectedTo: z
          .strictObject({
            id: z.number().int(),
            uniqueId: z.string().nullable(),
            connector: z.number().int(),
          })
          .nullable(),
      }),
    ),
    polyline: z.array(z.array(z.number()).length(3)).nullable(),
    lengthFt: z.number().nullable(),
    rolePartitions: z.array(z.string()),
  }),
);
export type DuctComponentWitness = z.infer<typeof ductComponentWitnessSchema>;
const hydraulicPort = z.strictObject({ element: elementIdentity, port: ductPortPinSchema });
const hydraulicSource = z.string().trim().min(1);
export const ductHydraulicsSchema = z.strictObject({
  mode: z
    .literal("prescribed-flow-demand")
    .describe(
      "Staged prescribed-flow TOTAL-pressure closure only, not nonlinear circulation or fan operating-point prediction. Unknown flow/laws remain partial. Source strings are declared premises, not manufacturer approval.",
    ),
  anchors: z.array(
    z.strictObject({
      at: hydraulicPort,
      kind: z.enum(["gauge", "physical-boundary"]),
      totalPressureInWg: z.number(),
      source: hydraulicSource,
    }),
  ),
  laws: z.array(
    z.strictObject({
      from: hydraulicPort,
      to: hydraulicPort,
      signedCfm: z
        .number()
        .describe(
          "Flow from pressure from-plane toward to-plane: inward at same-owner from port; outward at an actual reciprocal-joint from port. The complete portFlows tuple always uses owner-outward sense.",
        ),
      portFlows: z
        .array(z.strictObject({ at: hydraulicPort, signedCfm: z.number() }))
        .min(2)
        .describe(
          "Every physical owner port exactly once, signed OUTWARD owner to reciprocal joint; complete vector binds split ratio and point freshness.",
        ),
      totalPressureDifferenceInWg: z
        .number()
        .describe(
          "Signed TOTAL Pt_from minus Pt_to in in-wg at the exact admitted planes and complete source flow vector; not static pressure or an inferred loss coefficient.",
        ),
      source: hydraulicSource,
    }),
  ),
  stationEquivalences: z.array(
    z.strictObject({
      element: elementIdentity,
      ports: z.array(ductPortPinSchema).min(1),
      source: hydraulicSource,
    }),
  ),
  fanAllocations: z.array(
    z.strictObject({
      element: elementIdentity,
      inlet: ductPortPinSchema.nullable(),
      outlet: ductPortPinSchema.nullable(),
      flowCfm: z.number().nonnegative(),
      totalRiseInWg: z.number(),
      source: hydraulicSource,
    }),
  ),
  source: hydraulicSource,
});
export type DuctHydraulics = z.infer<typeof ductHydraulicsSchema>;
/** Calculation-only evidence; generic Work owns proposal/staging and persists it once. */
export const ductCalculationSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("component-flow"),
      hydraulics: ductHydraulicsSchema.nullable(),
      componentWitness: ductComponentWitnessSchema.min(1),
      constraints: z.array(
        z.strictObject({
          element: elementIdentity,
          port: ductPortPinSchema.extend({
            connectedTo: elementIdentity.extend({ connector: z.number().int().nonnegative() }),
          }),
          signedCfm: z.number(),
          source: z.string().trim().min(1),
        }),
      ),
      source: z.string().trim().min(1),
    })
    .refine(
      (v) => v.constraints.length > 0 || v.hydraulics !== null,
      "A component entry needs flow constraints or hydraulics",
    ),
  z.strictObject({
    kind: z.literal("passive"),
    element: elementIdentity,
    ports: z.tuple([ductPortPinSchema, ductPortPinSchema]),
    loss: designPoint,
    source: z.string().trim().min(1),
  }),
  z
    .strictObject({
      kind: z.literal("fan"),
      element: elementIdentity,
      inlet: ductPortPinSchema
        .nullable()
        .describe(
          "Exact exterior inlet port. Null explicitly declares a lossless connection to the stated quiescent reference reservoir (Pv=0), not an unknown port to omit. Source must justify this design assumption; no implicit entrance loss is added.",
        ),
      outlet: ductPortPinSchema
        .nullable()
        .describe(
          "Exact exterior outlet port. Null explicitly declares a lossless connection to the stated quiescent reference reservoir (Pv=0), not an unknown port to omit. Source must justify this design assumption; no implicit discharge loss is added.",
        ),
      referenceTotalPressureInWg: z
        .number()
        .describe(
          "TOTAL pressure in in-wg at a declared implicit reservoir plane on a null-port side. A quiescent reservoir has static=total and Pv=0. Ignored when both physical ports are supplied; never an invented cabinet pressure or manufacturer ESP.",
        ),
      designFlowCfm: z.number().nonnegative().nullable(),
      source: z.string().trim().min(1),
    })
    .refine((v) => v.inlet !== null || v.outlet !== null, "A fan needs a physical external port"),
  z.strictObject({
    kind: z.literal("terminal"),
    element: elementIdentity,
    port: ductPortPinSchema,
    role: z.enum(["demand", "reference"]),
    flowCfm: z.number().nonnegative().nullable(),
    boundaryTotalPressureInWg: z
      .number()
      .describe(
        "TOTAL pressure in in-wg at the external room/outdoor reference plane beyond the terminal on discharge paths or before it on intake paths. The terminal's explicit total loss is charged separately. Still-air static=total is a stated design assumption; duct static with nonzero Pv must not be supplied unchanged.",
      ),
    loss: designPoint
      .nullable()
      .describe(
        "Explicit sourced TOTAL-loss point for this terminal/opening, including justified zero. Null remains unknown: legacy terminalDrops and native catalog/assigned static values are not reinterpreted as total pressure.",
      ),
    source: z.string().trim().min(1),
  }),
  z.strictObject({ kind: z.literal("balanced-design"), source: z.string().trim().min(1) }),
]);
export type DuctCalculation = z.infer<typeof ductCalculationSchema>;
export type DuctPortPin = z.infer<typeof ductPortPinSchema>;

export const ductsDocumentSchema = z
  .strictObject({
    calculation: z
      .record(z.string().min(1), trichotomyCellSchema(ductCalculationSchema))
      .default({}),
    assumptions: z.record(z.string(), trichotomyCellSchema(ductAssumptionSchema)).default({}),
    rules: z
      .record(z.string(), trichotomyCellSchema(z.strictObject({ table: z.string().min(1) })))
      .default({}),
    terminalDrops: z.record(elementKey, trichotomyCellSchema(dropSchema)).default({}),
    componentDrops: z.record(elementKey, trichotomyCellSchema(dropSchema)).default({}),
    unitStatics: z.record(elementKey, trichotomyCellSchema(unitStaticSchema)).default({}),
    loads: z
      .partialRecord(z.literal("preview"), trichotomyCellSchema(ductLoadPreviewSchema))
      .default({}),
    flows: z.record(elementKey, trichotomyCellSchema(flowSchema)).default({}),
    parameters: z
      .partialRecord(z.enum(DUCT_PARAMETER_KEYS), trichotomyCellSchema(z.string().min(1)))
      .default({}),
  })
  .superRefine((doc, ctx) => {
    for (const [key, cell] of Object.entries(doc.assumptions))
      for (const rung of ["proposal", "staged"] as const) {
        const value = cell[rung]?.value;
        if (value && value.kind !== kindOfKey(key))
          ctx.addIssue({
            code: "custom",
            path: ["assumptions", key, rung, "value"],
            message: `the key ${key} holds a ${kindOfKey(key)}, not a ${value.kind}`,
          });
      }
  });
export type DuctsRouteDocument = z.infer<typeof ductsDocumentSchema>;

const stagedOf = <V>(cells: Record<string, { staged?: { value?: V } | null } | undefined>) =>
  Object.fromEntries(
    Object.entries(cells).flatMap(([key, cell]) =>
      cell?.staged?.value === undefined ? [] : [[key, cell.staged.value]],
    ),
  ) as Record<string, V>;

/** The person's staged values only, per segment; proposals never reach Revit. */
export function stagedDucts(doc: DuctsRouteDocument | null) {
  return {
    calculation: stagedOf(doc?.calculation ?? {}),
    rules: stagedOf(doc?.rules ?? {}),
    terminalDrops: stagedOf(doc?.terminalDrops ?? {}),
    componentDrops: stagedOf(doc?.componentDrops ?? {}),
    unitStatics: stagedOf(doc?.unitStatics ?? {}),
    loads: stagedOf(doc?.loads ?? {}) as { preview?: DuctLoadPreview },
    flows: stagedOf(doc?.flows ?? {}) as Record<string, DuctFlow>,
    parameters: stagedOf(doc?.parameters ?? {}) as Partial<Record<DuctParameterKey, string>>,
  };
}

/**
 * What `ducts.preview-losses` and `ducts.apply-losses` send; the host adds `previewOnly` and calls
 * the native `ducts.apply`. Mirrors the generated `DuctsApply.Req.Request` field for field (the web
 * test pins the two types to each other). Built by the web from the staged cells and Pe's own
 * lookup: one fitting row per instance of a staged rule under the rule's chosen table; the
 * equipment rows are the staged `unitStatics`, through the `fanStatic` slot.
 */
const optionalText = z.string().nullable().optional();
const writeDrop = z.strictObject({
  id: z.number().int(),
  inWg: z.number().nonnegative(),
  source: optionalText,
});
const slotsSchema = z.strictObject({
  fanStatic: z.string().min(1).optional(),
  fanFlow: z.string().min(1).optional(),
  componentDrop: z.string().min(1).optional(),
  terminalDrop: optionalText,
  /** The fitting family's own coefficient parameter the Pe loss server reads (default Pe_C). */
  fittingCoefficient: z.string().min(1).optional(),
});
/**
 * How Revit is told a fitting's loss (pressure-drop ledger, 2026-10-12): the Pe loss server charges the
 * family's coefficient when it has one, else prices the legs live from the rule's table; a frozen
 * Specific Coefficient is the export route and never the web's. Revit's own table route is never written.
 */
export const DUCT_FITTING_METHODS = ["pe-server", "specific-coefficient"] as const;
export type DuctFittingMethod = (typeof DUCT_FITTING_METHODS)[number];
export const ductsApplyInputSchema = z.strictObject({
  slots: slotsSchema.nullable().optional(),
  fittings: z.array(
    z.strictObject({
      id: z.number().int(),
      method: z.enum(DUCT_FITTING_METHODS),
      coefficient: z.number(),
      table: optionalText,
      inputs: optionalText,
      ruleKey: optionalText,
    }),
  ),
  terminals: z.array(writeDrop),
  components: z.array(writeDrop),
  equipment: z.array(
    z.strictObject({ id: z.number().int(), externalStaticInWg: z.number().nonnegative() }),
  ),
  /**
   * The whole provenance store after this apply (`DuctLossStore` v1): the model's store, its
   * unknown keys passed through, with this apply's rules, instances and drops over it, since the
   * native op writes it as sent. `workRevision` is the model store's revision as read; an older
   * one refuses as stale.
   */
  store: z.looseObject({
    /** 1; the native op refuses any other store version. */
    version: z.number().int().optional(),
    rules: z.record(z.string(), z.strictObject({ table: optionalText })).optional(),
    instances: z
      .record(
        z.string(),
        z.strictObject({
          table: optionalText,
          inputs: optionalText,
          coefficient: z.number(),
          appliedAt: z.string(),
        }),
      )
      .optional(),
    terminals: z
      .record(
        z.string(),
        z.strictObject({
          inWg: z.number().nonnegative(),
          source: optionalText,
          appliedAt: z.string(),
        }),
      )
      .optional(),
    slots: slotsSchema.nullable().optional(),
    workRevision: z.number().int().nonnegative().optional(),
    appliedAt: optionalText,
  }),
});
export type DuctsApplyInput = z.infer<typeof ductsApplyInputSchema>;

export const ductsRouteState = {
  route: "ducts",
  title: "Ducts",
  description:
    "calculation: staged-only physical fan/passive/terminal port witnesses, balanced-design scenario, and component-flow design with one complete componentWitness plus sourced signed joint constraints (positive owner to reciprocal partner); flow conservation is not pressure certification; required hydraulics:null or staged prescribed-flow TOTAL closure with complete port-flow-vector point laws, physical versus gauge anchors and explicit fan allocations; no automatic balancing or nonlinear circulation; source strings remain declared premises; element UniqueId and exact connected/open physical port pins must match a new snapshot. Historical snapshots without UniqueId cannot certify circuits. Evidence is calculation-only, never native apply. Pea proposes; a person stages. Duct pressure-drop Work, one trichotomy cell per key. assumptions: an issue id from ducts.snapshot holds a verdict (capped, connect, ignore); flex-roughness:<flex type> (ft), fan-static:<equipment id> (in-wg) and component-drop:<family> (in-wg) hold overrides, never written to Revit. rules: a loss-rule key holds { table }, the ASHRAE table every instance of that fitting type is looked up under. terminalDrops and componentDrops: an element id holds { inWg, source }. unitStatics: an air mover's element id holds { inWg }, the external static written to it. parameters: fanStatic, fanFlow, componentDrop, terminalDrop, fittingCoefficient name the Revit parameter of each slot (person only); fittingCoefficient is the family parameter the Pe loss server reads (default Pe_C). loads: the one key preview holds the load tool's Load Preview as parsed ({ systems: [{ name, tag, cfm, rooms }] }, tag = the equipment Mark in the system name); flows: a terminal id holds { cfm, source }, a design flow overriding the preview split. Pea may propose rules, drops, loads and flows; a person stages; ducts.apply-losses writes the staged cells to Revit after ducts.preview-losses.",
  schema: ductsDocumentSchema,
  agentWriteMask: [
    ["calculation", "*", "proposal"],
    ["assumptions", "*", "proposal"],
    ["rules", "*", "proposal"],
    ["terminalDrops", "*", "proposal"],
    ["componentDrops", "*", "proposal"],
    ["unitStatics", "*", "proposal"],
    ["loads", "*", "proposal"],
    ["flows", "*", "proposal"],
  ],
  commands: {},
} satisfies RouteStateSpec<typeof ductsDocumentSchema>;
