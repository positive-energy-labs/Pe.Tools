/**
 * The trichotomy — proposal → staged → committed — as a shared core.
 *
 * Every collaborative route speaks this grammar: pea writes `proposal` (and `review`)
 * under the agent mask; a human promotes a value into `staged` (mask-denied to pea);
 * a human-only commit command redeems the staged set against the outside world.
 *
 * `staged` is a nullable PRESENCE OBJECT (`{ value } | null`), not a bare optional —
 * so "staged, and the staged value happens to be undefined/empty" is representable
 * without a `hasStaged` sidecar boolean (the settings-route wart).
 *
 * Domain provenance (e.g. family-types' markdown `source` ref) is a per-route
 * EXTENSION of the proposal, not part of the core.
 */
import { z } from "zod";

export const cellReviewSchema = z.enum(["none", "good", "attention"]);
export type CellReview = z.infer<typeof cellReviewSchema>;

/** Core proposal shape; routes add provenance via `.extend(...)` on the returned object. */
export function cellProposalSchema<V extends z.ZodType>(value: V) {
  return z.object({
    value,
    by: z.enum(["pea", "human"]).default("pea"),
    note: z.string().nullish(),
    confidence: z.enum(["high", "low"]).nullish(),
  });
}

/** One trichotomy cell: proposal (agent-writable), staged presence-object, review mark. */
export function trichotomyCellSchema<V extends z.ZodType>(value: V) {
  return trichotomyCellWithProposal(value, cellProposalSchema(value));
}

/** Trichotomy cell with a route-extended proposal (e.g. family-types' markdown source ref). */
export function trichotomyCellWithProposal<V extends z.ZodType, P extends z.ZodType>(
  value: V,
  proposal: P,
) {
  return z.object({
    proposal: proposal.nullish(),
    /** Human-promoted value — what commit sends. Pea must never write this (mask-denied). */
    staged: z.object({ value }).nullish(),
    review: cellReviewSchema.default("none"),
  });
}

/** The mask fragment every trichotomy route grants pea: proposals + review marks. */
export function trichotomyAgentMask(cellsSegment = "cells"): string[][] {
  return [
    [cellsSegment, "*", "proposal"],
    [cellsSegment, "*", "review"],
  ];
}

/* ── shared cell queries (the logic previously copy-pasted per plugin) ─────── */

export interface TrichotomyCellLike {
  proposal?: { confidence?: "high" | "low" | null | undefined } | null | undefined;
  staged?: { value: unknown } | null | undefined;
  review: CellReview;
}

export interface CellSummary {
  proposals: number;
  staged: number;
  good: number;
  attention: number;
}

export function cellSummary(cells: Record<string, TrichotomyCellLike>): CellSummary {
  const summary: CellSummary = { proposals: 0, staged: 0, good: 0, attention: 0 };
  for (const cell of Object.values(cells)) {
    if (cell.proposal != null) summary.proposals += 1;
    if (cell.staged != null) summary.staged += 1;
    if (cell.review === "good") summary.good += 1;
    if (cell.review === "attention") summary.attention += 1;
  }
  return summary;
}

export function stagedEntries<TCell extends TrichotomyCellLike>(
  cells: Record<string, TCell>,
): [string, TCell][] {
  return Object.entries(cells).filter(([, cell]) => cell.staged != null);
}

/** Document refine predicate: a low-confidence proposal that isn't flagged is a silent risk. */
export function lowConfidenceIsFlagged(cells: Record<string, TrichotomyCellLike>): boolean {
  return Object.values(cells).every(
    (cell) => !(cell.proposal?.confidence === "low" && cell.review === "none"),
  );
}

export const LOW_CONFIDENCE_REFINE_ERROR = "low-confidence proposals must set review to attention";
