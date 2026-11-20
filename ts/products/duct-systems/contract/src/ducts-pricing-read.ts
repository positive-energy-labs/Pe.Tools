import { DUCT_UNIT_ROLES } from "@pe/ducts-contract/duct-inputs";
import { z } from "zod";
import { ductAssumptionSchema } from "@pe/ducts-contract/system-work";
import { ductsCriteriaLayerSchema, DUCT_UNIT_KINDS } from "@pe/ducts-contract/duct-inputs";
/**
 * How far an inferred join stands from the evidence (pressure-drop ledger, 2026-10-19: inference
 * may compute, never conclude), measured, never guessed: `near-miss` (a sub-inch, opposed, centred
 * open-to-open join of one classification), `stretched` (any other join the rule accepts), and
 * `anomalous` (a join made against the evidence: a reversed connector, a part placed inside a host,
 * classes a person joined anyway). Worst last.
 */
export const DUCT_INFERENCE_GRADES = ["near-miss", "stretched", "anomalous"] as const;
export type DuctInferenceGrade = (typeof DUCT_INFERENCE_GRADES)[number];
/** One thing the survey found: what the route assumed about it, if anything, and who clears it. */
export const ductFindingSchema = z.strictObject({
  id: z.string(),
  kind: z.string(),
  elementIds: z.array(z.number().int()),
  note: z.string(),
  assumed: z.string().nullable(),
  clearer: z.enum(["route", "pea", "person"]),
  /** An inferred join's grade; null or absent on a finding that joins nothing. */
  grade: z.enum(DUCT_INFERENCE_GRADES).nullable().optional(),
  /** A possible missed join is advisory and carries the measured gap and both open ports. */
  gapIn: z.number().nonnegative().optional(),
  connectors: z.tuple([z.string(), z.string()]).optional(),
  /** The group a finding is about when it is about a whole group (`no-fan`); absent otherwise. */
  groupId: z.string().nullable().optional(),
});
export type DuctFinding = z.infer<typeof ductFindingSchema>;
const n = z.number(),
  s = z.string(),
  ns = z.array(n);
const record = <S extends z.ZodType>(schema: S) => z.record(s, schema);
const grade = z.enum(DUCT_INFERENCE_GRADES);
export const inferenceReadSchema = z.object({
  joints: z.array(
    z.object({ id: s, a: s, b: s, kind: z.literal("joined-by-proximity"), gapIn: n, grade }),
  ),
  taps: z.array(
    z.object({
      id: s,
      a: s,
      segment: n,
      kind: z.literal("tap-by-proximity"),
      gapIn: n,
      at: n,
      point: ns,
      grade,
    }),
  ),
  inline: z.array(
    z.object({
      id: s,
      node: n,
      segment: n,
      kind: z.literal("inline-by-inference"),
      ports: z.tuple([s, s]),
      grade,
    }),
  ),
  findings: z.array(
    z.object({
      id: s,
      kind: z.enum([
        "joined-by-proximity",
        "tap-by-proximity",
        "inline-by-inference",
        "loop-by-inference",
        "near-miss-across-classifications",
        "missed-join",
        "out-of-phase",
      ]),
      elementIds: ns,
      note: s,
      grade: grade.nullable(),
      connectors: z.tuple([s, s]).optional(),
      gapIn: n.optional(),
    }),
  ),
});
const drop = z.object({ inWg: n, source: s.optional() });
export const effectiveDuctsReadSchema = z.object({
  rules: record(z.object({ table: s })),
  criteria: ductsCriteriaLayerSchema,
  kinds: record(z.object({ kind: z.enum(DUCT_UNIT_KINDS) })),
  assumptions: record(ductAssumptionSchema),
  catalogs: record(z.object({ table: s })),
  ruleAssignments: record(z.object({ rule: s })),
  terminalDrops: record(drop),
  componentDrops: record(drop),
  equipmentFlows: record(n),
  roles: record(z.object({ role: z.enum(DUCT_UNIT_ROLES) })),
  flows: record(n),
  parameters: record(s),
  subject: record(ns),
  labelParameter: s.nullable(),
  workingPhase: s.nullable(),
  designFriction: n.nullable(),
});
