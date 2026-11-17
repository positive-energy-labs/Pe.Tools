import type { DomainClaim } from "./encounters.ts";
import type { Calc as WireCalc } from "@pe/fans-contract/fan-calc";
import type { Leg as WireLeg } from "@pe/fans-contract/fan-calc";
export type { FanPortRef, LegKind, PathEnd, EndRuling, Side, CalcPath, BlockerKind, Blocker, FittingPricing, HealProposal, SideTotals, CalcNote, Chain } from "@pe/fans-contract/fan-calc";
/** Test-visible receipt: published evidence has total length, but no per-piece length, cfm or drop. */
export interface Leg extends WireLeg {
  testVisiblePieceReceipt?: { lengthFt: number; cfm: number; lossInWg: number | null }[];
}
export { CALC_ENGINE_VERSION } from "@pe/fans-contract/fan-calc";
/** The engine retains the complete-claim capability; the published projection carries no brand. */
export interface Calc extends Omit<WireCalc, "claim" | "legs"> { claim: DomainClaim; legs: Record<string, Leg> }
