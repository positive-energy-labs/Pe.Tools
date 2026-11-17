import type { DomainClaim } from "./encounters.ts";
import type { Sheet as WireSheet } from "../../../agent-contracts/src/fan-calc.ts";
export type { FanPortRef, LegKind, Leg, PathEnd, EndRuling, Side, SheetPath, BlockerKind, Blocker, FittingPricing, HealProposal, SideTotals, SheetNote, Chain } from "../../../agent-contracts/src/fan-calc.ts";
export const SHEET_ENGINE_VERSION = "sheet/4";
/** The engine retains the complete-claim capability; the published projection carries no brand. */
export interface Sheet extends Omit<WireSheet, "claim"> { claim: DomainClaim }
