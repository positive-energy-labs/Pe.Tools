import { z } from "zod";
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
        // Native metadata-only roster ports retain [] in the exact-content witness.
        point: z.union([z.array(z.number()).length(0), z.array(z.number()).length(3)]),
        shape: z.string(),
        diameterIn: z.number().nullable(),
        widthIn: z.number().nullable(),
        heightIn: z.number().nullable(),
        direction: z.string(),
        classification: z.string().nullable(),
        connectedTo: z
          .strictObject({
            id: z.number().int(),
            uniqueId: z.string(),
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
