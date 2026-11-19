import { z } from "zod";
import { CALC_ENGINE_VERSION } from "./fan-calc.ts";
import { ductsCalcOverviewSchema, ductsCalcResponseSchema } from "./calc-read.ts";
import {
  encounterSchema,
  fanClaimSchema,
  fanEspValuesSchema,
  fanIssueSchema,
} from "./fans-inputs.ts";

const details = ductsCalcResponseSchema.options;
const calcPath = z.object({
  side: z.enum(["supply", "return"]),
  legIds: z.array(z.string()),
  end: details[4].shape.ends.element,
  knownInWg: z.number(),
  blockerIds: z.array(z.string()),
});
/**
 * One fan calc whole (the domain `Sheet`, `ducts-domain/src/sheet/types.ts`), as /ducts reads it:
 * the same wire parts the fans read publishes. The claim is the wire `FanClaim`; the brand never crosses.
 */
export const ductsFanCalcSchema = z.object({
  engineVersion: z.literal(
    CALC_ENGINE_VERSION,
    "Retired calc engine; record this calculation again. Recording bytes were not changed.",
  ),
  basis: z.string(),
  fan: ductsCalcOverviewSchema.shape.fan.unwrap().omit({ ratedEspInWg: true }),
  legs: details[3].shape.legs,
  paths: z.array(calcPath),
  claim: fanClaimSchema,
  esp: fanEspValuesSchema,
  encounters: z.array(encounterSchema),
  issues: z.array(fanIssueSchema),
  network: z.string(),
  totals: ductsCalcOverviewSchema.shape.totals.unwrap(),
  assumed: z.object({
    paths: z.array(calcPath),
    legs: details[3].shape.legs,
    blockers: details[4].shape.blockers,
  }),
  blockers: details[4].shape.blockers,
  notes: details[4].shape.notes,
  fittings: details[4].shape.fittings,
  walkedElementIds: details[2].shape.walkedElementIds,
});
