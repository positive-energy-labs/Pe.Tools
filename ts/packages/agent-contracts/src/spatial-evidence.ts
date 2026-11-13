import { nativeResponseSchema } from "@pe/host-contracts/native-schemas";
import { observedSchema } from "./action-receipts.ts";

/** Newtonsoft omits null members. Absence is unknown, never a numeric clearance. */
export const sweepAnswerSchema = nativeResponseSchema("revit.detail.space-sweep").transform((answer) => ({
  ...answer,
  evidence: { ...answer.evidence, ...observedSchema.parse(answer.evidence) },
  segments: answer.segments.map((segment) => ({ ...segment, minGapFt: segment.minGapFt ?? null })),
}));
