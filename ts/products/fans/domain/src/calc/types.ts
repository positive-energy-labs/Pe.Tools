import type { DomainClaim } from "./encounters.ts";
import type { Calc as WireCalc } from "@pe/fans-contract/fan-calc";
export type { FanPortRef, LegKind, Leg, PathEnd, EndRuling, Side, CalcPath, BlockerKind, Blocker, FittingPricing, HealProposal, SideTotals, CalcNote, Chain } from "@pe/fans-contract/fan-calc";
export const CALC_ENGINE_VERSION = "sheet/5";
/** The engine retains the complete-claim capability; the published projection carries no brand. */
export interface Calc extends Omit<WireCalc, "claim"> { claim: DomainClaim }
