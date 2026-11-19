import { CALC_READ, CALC_DETAIL_READ, CALC_BREAKDOWN_READ } from "./fan-calc.ts";
import { ductsRosterRequestSchema, ductsCalcRequestSchema } from "./calc-read.ts";
import { fansReadArgs } from "./fans-read.ts";

export const fansReadDiscovery = {
  inputs: {
    "fans.roster": ductsRosterRequestSchema,
    [CALC_READ]: fansReadArgs,
    [CALC_DETAIL_READ]: ductsCalcRequestSchema,
    [CALC_BREAKDOWN_READ]: ductsCalcRequestSchema,
  },
  help: "Use fans.roster with args {target, mark} to find a fan port by its mark, fans.calc-detail for a pressure sheet, and fans.calc for the Fans worksheet.",
};
