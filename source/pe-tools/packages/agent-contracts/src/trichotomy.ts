/**
 * The trichotomy — proposal → staged → committed — as a shared core.
 *
 * Every collaborative route speaks this grammar: pea writes `proposal` under the
 * agent mask; a human promotes a value into `staged` (mask-denied to pea); a
 * human-only commit command redeems the staged set against the outside world.
 *
 * `staged` is a nullable PRESENCE OBJECT (`{ value } | null`), not a bare optional —
 * so "staged, and the staged value happens to be undefined/empty" is representable
 * without a `hasStaged` sidecar boolean (the settings-route wart).
 *
 * There is NO `review` field (ruled 2026-08-31, proposal-state demiurge): staging IS
 * the human's approval, validation is derived from the value rather than stored, and
 * pea's disagreement channels are chat or a counter-proposal on the staged cell.
 *
 * Domain provenance (e.g. a route's markdown `source` ref) is a per-route
 * EXTENSION of the proposal, not part of the core.
 */
import { z } from "zod";

/** Core proposal shape; routes add provenance via `.extend(...)` on the returned object. */
export function cellProposalSchema<V extends z.ZodType>(value: V) {
  return z.object({
    value,
    by: z.enum(["pea", "human"]).default("pea"),
    note: z.string().nullish(),
    confidence: z.enum(["high", "low"]).nullish(),
  });
}

/** One trichotomy cell: proposal (agent-writable) and the staged presence-object. */
export function trichotomyCellSchema<V extends z.ZodType>(value: V) {
  return trichotomyCellWithProposal(value, cellProposalSchema(value));
}

/** Trichotomy cell with a route-extended proposal (e.g. a markdown source ref). */
export function trichotomyCellWithProposal<V extends z.ZodType, P extends z.ZodType>(
  value: V,
  proposal: P,
) {
  return z.object({
    proposal: proposal.nullish(),
    /** Human-promoted value — what commit sends. Pea must never write this (mask-denied). */
    staged: z.object({ value }).nullish(),
  });
}

/** The mask fragment every trichotomy route grants pea: proposals only. */
export function trichotomyAgentMask(cellsSegment = "cells"): string[][] {
  return [[cellsSegment, "*", "proposal"]];
}

/* ── shared cell queries (the logic previously copy-pasted per plugin) ─────── */

export interface TrichotomyCellLike {
  proposal?:
    | {
        value?: unknown;
        delete?: true;
        by?: "pea" | "human" | undefined;
        note?: string | null | undefined;
        confidence?: "high" | "low" | null | undefined;
      }
    | null
    | undefined;
  staged?: { value?: unknown; delete?: true } | null | undefined;
}

export interface CellSummary {
  proposals: number;
  staged: number;
}

export function cellSummary(cells: Record<string, TrichotomyCellLike>): CellSummary {
  const summary: CellSummary = { proposals: 0, staged: 0 };
  for (const cell of Object.values(cells)) {
    if (cell.proposal != null) summary.proposals += 1;
    if (cell.staged != null) summary.staged += 1;
  }
  return summary;
}

export function stagedEntries<TCell extends TrichotomyCellLike>(
  cells: Record<string, TCell>,
): [string, TCell][] {
  return Object.entries(cells).filter(([, cell]) => cell.staged != null);
}
