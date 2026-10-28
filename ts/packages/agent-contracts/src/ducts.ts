/**
 * /ducts Work, every segment a family of shared cells with edits and optional suggestions:
 * - `assumptions`, keyed by what the assumption is about: an issue id from the snapshot
 *   (`open-end:g123:456:1`) holds a verdict; `flex-roughness:<flex type>`,
 *   `fan-static:<equipment id>`, `component-drop:<family>` hold overrides. An `ignore` verdict is a
 *   ruling the model keeps (`_PE_DuctLosses` v2 `verdicts`, ducts-domain `rulings.ts`): Work holds
 *   only the pending delta over the stored one, and a delete edit takes it back.
 * - `rules`: loss-rule key (the web's `LOSS_RULES`) -> the ASHRAE table every instance of the rule
 *   is re-looked-up under. Either author edits a type's table, never a raw coefficient.
 * - `terminalDrops` (terminal id) and `componentDrops` (fitting or accessory id): a stated drop in
 *   in-wg and where it came from.
 * - `esp` (air mover id): the external static Pe writes to a unit, in in-wg.
 * - `equipmentFlows` (air mover id): a stated design flow in cfm for the unit, written to its FanFlow slot.
 *   `roles` (air mover id): whether the unit is a `fan` or a `passive` part. Without a ruling the
 *   route proposes one from the unit's design flow (ducts-domain `unit-roles.ts`); a ruling, `fan`
 *   or `passive`, is kept in the model's store (v2 `roles`) and Work holds only the pending delta.
 * - `loads`, one cell keyed `preview`: the load tool's Load Preview as parsed (systems, each tagged
 *   by the equipment tag in its name, with its rooms). `flows` (terminal id): a stated design flow
 *   in cfm that overrides the preview split. The preview stays in Work; apply writes resolved flows.
 * - `parameters`: which Revit parameter carries each slot; either author may edit or suggest it.
 *   A terminal's built-in `Flow` is its connector's flow.
 * - The scene (pressure-drop ledger, 2026-10-19): `subject`, keyed by group id, each cell an ORDERED
 *   element-id list (a claim shows only on the groups that hold its ids, `claimsForGroup`); `claims`, keyed by claim id, a sentence pinned to element ids with the author's state and a
 *   verdict slot; `labelParameter`, one cell naming the instance parameter whose value names
 *   equipment for people (`ducts.snapshot` reads it into `DuctNode.label`). Either author edits or
 *   suggests all three; a verdict in the current edit is the verdict record.
 * - `workingPhase` (kaitpw 2026-10-19), one cell naming the phase the firm's views show (a name in
 *   the snapshot's `phases.order`); either author edits or suggests it from the snapshot's view
 *   census, and the route leaves out every element that does not exist in it (`phases.ts`).
 * `ducts.apply` writes the edited rules, drops, flows, esp, slots and rulings to Revit.
 */
import { z } from "zod";
import { ductsSheetInputsSchema, ductsSheetDefaultsSchema } from "./ducts-sheet.ts";

import { type RouteStateSpec } from "./route-state.ts";
import { draftCellSchema } from "./draft.ts";

export const ductAssumptionSchema = z.discriminatedUnion("kind", [
  /**
   * capped: the open end carries no flow; connect: it must be connected in the model; ignore: leave
   * it out. On a proximity finding id: ignore breaks the inference; connect confirms it (and joins a
   * near miss across classifications anyway). Only an edited verdict rules; a suggestion never does.
   */
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
  "terminalFlow",
] as const;
export type DuctParameterKey = (typeof DUCT_PARAMETER_KEYS)[number];

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

const dropSchema = z.strictObject({
  inWg: z.number().nonnegative(),
  /** Where the number came from: a catalog page, a submittal, "rule of thumb". */
  source: z.string().optional(),
});
export type DuctDrop = z.infer<typeof dropSchema>;
/** The external static Pe writes to an air mover (a unit id key); staged only, never a side effect. */
const espSchema = z.strictObject({ inWg: z.number().nonnegative() });
export const DUCT_UNIT_ROLES = ["fan", "passive"] as const;
/** Whether an air mover moves air (`fan`) or only sits in the path with a loss (`passive`). */
const roleSchema = z.strictObject({ role: z.enum(DUCT_UNIT_ROLES) });
export type DuctUnitRole = z.infer<typeof roleSchema>;
const elementKey = z.string().regex(/^\d+$/, { error: "a drop cell key is an element id" });

/** One group's subject: element ids in walking order. The web cuts legs from it (`ducts/legs.ts`). */
const subjectSchema = z.array(z.number().int()).min(1);
export const DUCT_CLAIM_STATES = ["proven", "assumed", "unproven"] as const;
export const DUCT_CLAIM_VERDICTS = ["yes", "no", "not-this"] as const;
/** A short noun-phrase title on the surface, one sentence in its hint, and element ids.
 * `state` and `verdict` are authored judgments. The enclosing Change owns trusted provenance.
 * Historical verdictBy/verdictAt are retained declarations, never authenticated identities. */
export const ductClaimSchema = z
  .strictObject({
    title: z.string().min(1).max(60),
    text: z.string().min(1),
    ids: z.array(z.number().int()).min(1),
    state: z.enum(DUCT_CLAIM_STATES),
    verdict: z.enum(DUCT_CLAIM_VERDICTS).optional(),
    verdictBy: z.string().min(1).optional(),
    verdictAt: z.string().optional(),
  })
  .refine((claim) => claim.verdict !== undefined || (!claim.verdictBy && !claim.verdictAt), {
    error: "verdictBy and verdictAt describe a verdict; give one",
  });
export type DuctClaim = z.infer<typeof ductClaimSchema>;

/** The load tool's Load Preview: one system per equipment (its tag is the firm equipment tag), its rooms under it. */
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
    // ponytail: Work holds pending sheet inputs; durable connector rulings belong in the model store when sheet apply lands.
    sheetDefaults: draftCellSchema(ductsSheetDefaultsSchema).default({}),
    sheetInputs: z.record(z.string().min(1), draftCellSchema(ductsSheetInputsSchema)).default({}),
    calculation: z.record(z.string().min(1), draftCellSchema(ductCalculationSchema)).default({}),
    /** Deletable: a delete edit takes back the verdict the model's store holds at that key. */
    assumptions: z
      .record(z.string(), draftCellSchema(ductAssumptionSchema, { deletable: true }))
      .default({}),
    rules: z
      .record(z.string(), draftCellSchema(z.strictObject({ table: z.string().min(1) })))
      .default({}),
    /** Key = JSON.stringify([family, type]), type "" for the whole family; edited link beats the Pe_Catalog TYPE fact. */
    catalogs: z
      .record(z.string(), draftCellSchema(z.strictObject({ table: z.string().min(1) })))
      .default({}),
    /** Key = a fitting family name no rule matches; the cell holds the rule key it is priced as. Read before any rule's own `when`; stays in Pe like `catalogs`. */
    ruleAssignments: z
      .record(z.string().min(1), draftCellSchema(z.strictObject({ rule: z.string().min(1) })))
      .default({}),
    terminalDrops: z.record(elementKey, draftCellSchema(dropSchema)).default({}),
    componentDrops: z.record(elementKey, draftCellSchema(dropSchema)).default({}),
    esp: z.record(elementKey, draftCellSchema(espSchema)).default({}),
    /** A unit's design flow (air mover id), written to the FanFlow slot; beats Revit's fanFlow fact. */
    equipmentFlows: z.record(elementKey, draftCellSchema(flowSchema)).default({}),
    /** Whether an air mover is a fan or a passive part; keyed by the unit's element id. */
    roles: z.record(elementKey, draftCellSchema(roleSchema)).default({}),
    loads: z
      .partialRecord(z.literal("preview"), draftCellSchema(ductLoadPreviewSchema))
      .default({}),
    flows: z.record(elementKey, draftCellSchema(flowSchema)).default({}),
    parameters: z
      .partialRecord(z.enum(DUCT_PARAMETER_KEYS), draftCellSchema(z.string().min(1)))
      .default({}),
    /** Keyed by group id (`g<min element id>`): the ordered element ids of that group's system as intended. */
    subject: z.record(z.string().min(1), draftCellSchema(subjectSchema)).default({}),
    claims: z.record(z.string().min(1), draftCellSchema(ductClaimSchema)).default({}),
    /** The instance parameter whose value names equipment for people; absent reads the firm tag PE_G___TagInstance. */
    labelParameter: draftCellSchema(z.string().min(1).nullable()).default({}),
    /** The phase the network is read in; null (or no cell) reads every element. */
    workingPhase: draftCellSchema(z.string().min(1).nullable()).default({}),
    /**
     * The design friction rate, in-wg per 100 ft: the one rate the route reads each run against and
     * the fallback a part with no duct on its path is read at. A firm-authored Manual D rate; Revit never receives it.
     */
    designFriction: draftCellSchema(z.number().positive()).default({}),
    /** Shared picture palette. Persisted with ducts Work; never included in Revit apply. */
    systemColours: draftCellSchema(ductSystemColoursSchema).default({}),
  })
  .superRefine((doc, ctx) => {
    for (const [key, cell] of Object.entries(doc.assumptions))
      for (const rung of ["suggestion", "edit"] as const) {
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

/**
 * Saved Work this version's schema refuses, read as far as it still parses: every segment (and
 * every keyed cell of a record segment) that parses is kept, only the broken ones are dropped and
 * named in `dropped` (`segment` or `segment.key`). No migration of old shapes: a dropped cell is
 * just gone from this read. A document-level refusal (the cross-cell rules) drops the cells that
 * break them. `whole` is true when nothing at all was readable.
 */
export function salvageDuctsWork(raw: unknown): {
  doc: DuctsRouteDocument;
  dropped: string[];
  whole: boolean;
} {
  const whole = ductsDocumentSchema.safeParse(raw);
  if (whole.success) return { doc: whole.data, dropped: [], whole: false };
  const empty = ductsDocumentSchema.parse({});
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return { doc: empty, dropped: ["(whole document)"], whole: true };
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [segment, value] of Object.entries(raw)) {
    const shape = (ductsDocumentSchema.shape as Record<string, z.ZodType | undefined>)[segment];
    if (!shape) {
      dropped.push(segment);
      continue;
    }
    if (shape.safeParse(value).success) {
      kept[segment] = value;
      continue;
    }
    const isRecord = typeof value === "object" && value !== null && !Array.isArray(value);
    const cells = isRecord ? Object.entries(value) : [];
    const keptCells = cells.filter(([key, cell]) => {
      const ok = shape.safeParse({ [key]: cell }).success;
      if (!ok) dropped.push(`${segment}.${key}`);
      return ok;
    });
    if (!cells.length) dropped.push(segment);
    else if (keptCells.length) kept[segment] = Object.fromEntries(keptCells);
  }
  const second = ductsDocumentSchema.safeParse(kept);
  if (second.success) return { doc: second.data, dropped: [...new Set(dropped)], whole: false };
  // Cross-cell rules (a verdict on a proposed claim, an assumption of the wrong kind) broke the
  // kept cells: drop those segments whole, they are the only place the rules look.
  const ruled = Object.fromEntries(
    Object.entries(kept).filter(([segment]) => segment !== "claims" && segment !== "assumptions"),
  );
  return {
    doc: ductsDocumentSchema.parse(ruled),
    dropped: [...new Set([...dropped, "claims", "assumptions"])],
    whole: false,
  };
}

const stagedOf = <V>(cells: Record<string, { edit?: { value?: V } | null } | undefined>) =>
  Object.fromEntries(
    Object.entries(cells).flatMap(([key, cell]) =>
      cell?.edit?.value === undefined ? [] : [[key, cell.edit.value]],
    ),
  ) as Record<string, V>;

/** Current edits only, per segment; optional suggestions remain review content. */
export function stagedDucts(doc: DuctsRouteDocument | null) {
  return {
    calculation: stagedOf(doc?.calculation ?? {}),
    rules: stagedOf(doc?.rules ?? {}),
    assumptions: stagedOf<DuctAssumption>(doc?.assumptions ?? {}),
    catalogs: stagedOf(doc?.catalogs ?? {}),
    ruleAssignments: stagedOf(doc?.ruleAssignments ?? {}),
    terminalDrops: stagedOf(doc?.terminalDrops ?? {}),
    componentDrops: stagedOf(doc?.componentDrops ?? {}),
    esp: stagedOf(doc?.esp ?? {}),
    equipmentFlows: stagedOf(doc?.equipmentFlows ?? {}) as Record<string, DuctFlow>,
    roles: stagedOf(doc?.roles ?? {}) as Record<string, DuctUnitRole>,
    loads: stagedOf(doc?.loads ?? {}) as { preview?: DuctLoadPreview },
    flows: stagedOf(doc?.flows ?? {}) as Record<string, DuctFlow>,
    parameters: stagedOf(doc?.parameters ?? {}) as Partial<Record<DuctParameterKey, string>>,
    subject: stagedOf<number[]>(doc?.subject ?? {}),
    claims: stagedOf<DuctClaim>(doc?.claims ?? {}),
    labelParameter: doc?.labelParameter?.edit?.value ?? null,
    workingPhase: doc?.workingPhase?.edit?.value ?? null,
    designFriction: doc?.designFriction?.edit?.value ?? null,
  };
}

/**
 * The phase the route reads the network in: the current edit, else an optional suggestion, so either
 * author can inspect a suggested phase before editing; an edited null reads every element.
 */
export const workingPhaseOf = (doc: DuctsRouteDocument | null) => {
  const cell = doc?.workingPhase;
  return (cell?.edit ? cell.edit.value : cell?.suggestion?.value) ?? null;
};

/**
 * What `ducts.preview-losses` and `ducts.apply-losses` send; the host adds `previewOnly` and calls
 * the native `ducts.apply`. Mirrors the generated `DuctsApply.Req.Request` field for field (the web
 * test pins the two types to each other). Built by the web from the edited cells and Pe's own
 * lookup: one fitting row per instance of an edited rule under the rule's chosen table; the
 * equipment rows are the edited `esp`, through the `fanStatic` slot, and the flow rows the resolved
 * terminal flows (`terminalFlow` slot) and edited `equipmentFlows` (`fanFlow` slot).
 */
const optionalText = z.string().nullable().optional();
const writeDrop = z.strictObject({
  id: z.number().int(),
  inWg: z.number().nonnegative(),
  source: optionalText,
});
const writeFlow = z.strictObject({
  id: z.number().int(),
  cfm: z.number().nonnegative(),
  source: optionalText,
});
const slotsSchema = z.strictObject({
  fanStatic: z.string().min(1).optional(),
  fanFlow: z.string().min(1).optional(),
  componentDrop: z.string().min(1).optional(),
  terminalDrop: optionalText,
  /** The fitting family's own coefficient parameter the Pe loss server reads (default Pe_C). */
  fittingCoefficient: z.string().min(1).optional(),
  /**
   * The terminal's design CFM parameter the snapshot reads and apply writes (default
   * PE_M_Grd_AirFlow); the built-in `Flow` is the connector's own flow.
   */
  terminalFlow: z.string().min(1).optional(),
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
  /** Resolved design flow per terminal in a priced group, written to the TerminalFlow slot (instance). */
  terminalFlows: z.array(writeFlow),
  /** Staged unit design flow, written to the FanFlow slot (instance first, then type). */
  equipmentFlows: z.array(writeFlow),
  /**
   * The whole provenance store after this apply (`DuctLossStore` v2): the model's store, its
   * unknown keys passed through, with this apply's rules, instances and drops over it, since the
   * native op writes it as sent. `workRevision` is the model store's revision as read; an older
   * one refuses as stale.
   */
  store: z.looseObject({
    /** 2; the native op reads v1 and v2 and writes v2. */
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
    terminalFlows: z
      .record(
        z.string(),
        z.strictObject({
          cfm: z.number().nonnegative(),
          source: optionalText,
          appliedAt: z.string(),
        }),
      )
      .optional(),
    equipmentFlows: z
      .record(
        z.string(),
        z.strictObject({
          cfm: z.number().nonnegative(),
          source: optionalText,
          appliedAt: z.string(),
        }),
      )
      .optional(),
    /** The rulings after this apply: `ignore` verdicts by issue or finding id (`rulings.ts`). */
    verdicts: z
      .record(z.string(), z.strictObject({ verdict: z.string().min(1), ruledAt: z.string() }))
      .optional(),
    /** Unit roles (`fan` or `passive`) a person ruled, by element id. */
    roles: z
      .record(z.string(), z.strictObject({ role: z.string().min(1), ruledAt: z.string() }))
      .optional(),
    slots: slotsSchema.nullable().optional(),
    workRevision: z.number().int().nonnegative().optional(),
    appliedAt: optionalText,
  }),
});
export type DuctsApplyInput = z.infer<typeof ductsApplyInputSchema>;

/**
 * What `ducts.preview-heal` and `ducts.apply-heal` send; the host adds `previewOnly` and calls the
 * native `ducts.heal` (`DuctsHeal.Req.Request`). Each group is one transaction on apply. A group's
 * items are the route's Heal row (ducts-domain `heal.ts`), keys `elementId:connectorIndex`; a group
 * sent without items is planned by the host from a fresh snapshot with the same classifier, so an
 * agent names the group and reads the plan back from the preview.
 */
const connectorKey = z.string().regex(/^\d+:\d+$/);
export const ductsHealInputSchema = z.strictObject({
  groups: z
    .array(
      z.strictObject({
        group: z.string().min(1),
        items: z
          .array(
            z.strictObject({
              key: z.string().min(1),
              kind: z.enum(["cap", "join"]),
              end: connectorKey,
              other: connectorKey.optional(),
            }),
          )
          .optional(),
      }),
    )
    .min(1),
});
export type DuctsHealInput = z.infer<typeof ductsHealInputSchema>;

/**
 * What `ducts.preview-assign-fan` and `ducts.apply-assign-fan` send; the host adds `previewOnly` and
 * calls the native `ducts.assign-fan` (`DuctsAssignFan.Req.Request`): make the unit the base equipment
 * of the Revit system (`ducts.snapshot` systems[].id and an equipment node id).
 */
export const ductsAssignFanInputSchema = z.strictObject({
  systemId: z.number().int().positive(),
  unitId: z.number().int().positive(),
});
export type DuctsAssignFanInput = z.infer<typeof ductsAssignFanInputSchema>;

/** What a person says when they want the Ducts page: the whole route family answers to these words. */
export const DUCTS_FINDS = [
  "duct",
  "ducts",
  "pressure drop",
  "pdrop",
  "static pressure",
  "esp",
  "fan",
  "system",
  "sa 19",
  "run",
  "ready",
  "open ends",
  "equipment tag",
] as const;

export const ductsRouteState = {
  route: "ducts",
  title: "Ducts",
  description:
    "calculation: edit-only physical fan/passive/terminal port witnesses, balanced-design scenario, and component-flow design with one complete componentWitness plus sourced signed joint constraints (positive owner to reciprocal partner); flow conservation is not pressure certification; required hydraulics:null or edited prescribed-flow TOTAL closure with complete port-flow-vector point laws, physical versus gauge anchors and explicit fan allocations; no automatic balancing or nonlinear circulation; source strings remain declared premises; element UniqueId and exact connected/open physical port pins must match a new snapshot. Historical snapshots without UniqueId cannot certify circuits. Evidence is calculation-only, never native apply. Human and Pea edit shared Work at an expected revision. Duct pressure-drop Work, one shared cell per key. assumptions: an issue id from ducts.snapshot holds a verdict (capped, connect, ignore), and a proximity:<...> finding id holds ignore (break that inferred join) or connect (confirm it, or join a near miss across air classifications anyway); a near-miss or stretched join is bridged by the route and final (a diagnostic, no verdict owed); only an anomalous join (reversed connector, part through its host, cross-class) leaves a result provisional until an author edits a verdict, and a suggested verdict never makes it final, so include the evidence for a suggested ruling in the note; flex-roughness:<flex type> (ft), fan-static:<equipment id> (in-wg) and component-drop:<family> (in-wg) hold overrides, never written to Revit. An ignore verdict (an open end left out, an inferred join objected to) and a unit role (fan or passive) are rulings the model keeps in its _PE_DuctLosses store once written: ducts.snapshot store.verdicts and store.roles are the standing rulings, Work holds only pending changes over them, and either author removes a stored verdict with a delete edit. rules: a loss-rule key holds { table }, the ASHRAE table every instance of that fitting type is looked up under. ruleAssignments: a fitting family name no rule matches holds { rule }, the loss-rule key every fitting of that family is priced as (read before any rule's own match; stays in Pe, never written to Revit). terminalDrops and componentDrops: an element id holds { inWg, source }. esp: an air mover's element id holds { inWg }, the external static written to it (FanStatic slot). equipmentFlows: an air mover's element id holds { cfm, source }, the unit's design flow written to its FanFlow slot; it beats Revit's fanFlow fact. roles: an air mover's element id holds { role: fan | passive }; a passive part adds a loss and moves no air (the route passes air through it: the groups its ports reach price as one network, and a port of it that connects to nothing is an open end), a fan is what a group needs to price (a group with no fan reads no duct path to a fan). Unruled, a unit is proposed fan when it is base equipment of a Revit system its groups carry, else when it has airflow in the FanFlow slot; passive only when every duct port carries one classification (a through-flow device) and another unit moves air in its network; else fan. A fan with no stated flow reads the sum of the terminal flows it serves (derived, never written). Several fans price per fan without blocking (the largest flow owns the trunk, each smaller fan its port to the first junction); a fan with no known flow is a unit-flow Set row. parameters: fanStatic, fanFlow, componentDrop, terminalDrop, fittingCoefficient, terminalFlow name the Revit parameter of each slot (authored); fittingCoefficient is the family parameter the Pe loss server reads (default Pe_C). terminalFlow is the airflow read slot, a walk step: ducts.snapshot airflowCandidates lists every air flow parameter the terminals carry (slot, instance or type, shared, have of N terminals, per group) and each terminal node's flowParameter names the slot that supplied its terminalFlow fact; the built-in Flow is the connector's own flow. fanFlow is the same walk step over units: ducts.snapshot fanFlowCandidates (coverage per group the unit roots) and each equipment node's flowParameter. Either author may edit either slot; suggest the candidate with the best coverage in the chosen group as a claim (state assumed, ids = the terminals it covers) and either author selects it in the Set group's Airflow from row. loads: the one key preview holds the load tool's Load Preview as parsed ({ systems: [{ name, tag, cfm, rooms }] }, tag = the equipment tag in the system name, the value of the firm tag parameter PE_G___TagInstance, never the built-in Mark); flows: a terminal id holds { cfm, source }, a design flow that beats every other source (precedence: edited flow, then the rooms split when the rooms route supplies one, then the load preview split, then Revit's own flow); apply writes the resolved terminal flow to the terminal's TerminalFlow slot. catalogs: JSON.stringify([family, type]) (type \"\" = every type of the family) holds { table }, the manufacturer catalog table id; edited links beat the family TYPE Pe_Catalog parameter and stay in Work. The scene: subject is keyed by group id (the id from ducts.snapshot groups, g<lowest element id>), each cell holding the ordered element ids of that group's whole system as intended, end to end (outdoor intake or terminal through every element to the last equipment), including elements past a break; list every element in order, short stubs and transitions too, and never stop at the last connected element: the route draws breaks and omissions, so leave nothing out to avoid a gap. claims, keyed by claim id, hold { title, text, ids, state: proven | assumed | unproven }; title is a required short noun phrase (1-60 characters), text is one sentence shown only in its hint (a claim shows on the groups that hold its ids) (write element names in text; ids are fine, the route names them) and an optional authored verdict (yes, no, not-this), with provenance stamped on the enclosing Change; labelParameter is one cell naming the instance parameter whose value names equipment for people; absent it reads PE_G___TagInstance, the firm equipment tag (type counterpart PE_G___TagType), not the built-in Mark, and ducts.analysis rows expose it as `tag` (match a name like FC-23 there). designFriction is one shared cell: the design friction rate in in-wg per 100 ft (default 0.08) each run is read against; the route reads lengths as equivalent feet at each duct's own rate (Manual D / RHVAC), never written to Revit. workingPhase is one cell naming the phase the network is read in: suggest or edit the phase (a name in ducts.snapshot phases.order) that the snapshot's phases.views census shows in most views; the route leaves out every element that does not exist in it and warns out-of-phase where one touches the network. Either author may edit rules, catalogs, drops, esp, equipmentFlows, roles, loads, flows, the subject, claims and verdicts, the label parameter and the working phase; ducts.preview-losses provides optional inspection; ducts.apply-losses writes the current edits through the host.",
  schema: ductsDocumentSchema,
  finds: DUCTS_FINDS,
} satisfies RouteStateSpec<typeof ductsDocumentSchema>;
