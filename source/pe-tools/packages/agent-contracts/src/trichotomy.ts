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
 * Only Pea proposes, so a proposal carries no author. Every change to a cell is one of the
 * transitions in `cellTransitions`, written through `transitionPatches` (v3 FINAL, 2026-09-18).
 *
 * Domain provenance (e.g. a route's markdown `source` ref) is a per-route
 * EXTENSION of the proposal, not part of the core.
 */
import { z } from "zod";
import { canonicalRouteInput } from "./route-doc.ts";
import type { RouteStatePatch } from "./route-state.ts";

/** Core proposal shape; routes add provenance via `.extend(...)` on the returned object. */
export function cellProposalSchema<V extends z.ZodType>(value: V) {
  return z.object({
    value,
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

/* ── the cell state machine (v3 FINAL) ─────────────────────────────────────── */

/** What a rung writes: a value, or the deletion of the addressed property. */
export interface Rung {
  value?: unknown;
  delete?: true;
}

/** Any trichotomy cell, read-only: the one interface every reader and transition takes. */
export interface TrichotomyCellLike {
  proposal?:
    | (Rung & {
        // Compile bridge only: `by` is gone from every schema. Interaction's `stagedBy` reader
        // replaces the last reader (`cellFromTrichotomy`) in the same wave, then this goes.
        by?: "pea" | "human" | undefined;
        note?: string | null | undefined;
        confidence?: "high" | "low" | null | undefined;
      })
    | null
    | undefined;
  staged?: Rung | null | undefined;
}

export type Actor = "pea" | "human";

/** Every way a cell changes. `retire` is the host's alone, after proven native success. */
export const cellTransitions = {
  propose: { actor: "pea", binding: "unbound" },
  withdraw: { actor: "pea", binding: "unbound" },
  accept: { actor: "human", binding: "bound" },
  deny: { actor: "human", binding: "bound" },
  stage: { actor: "human", binding: "unbound" },
  unstage: { actor: "human", binding: "unbound" },
  retire: { actor: "host", binding: "plan" },
} as const;
export type TransitionKind = keyof typeof cellTransitions;

export type Transition =
  | { kind: "propose"; rung: Rung; note?: string | null; confidence?: "high" | "low" | null }
  | { kind: "withdraw" | "accept" | "deny" | "unstage" }
  /**
   * A value equal to `baseline` stages nothing. No emptiness rule: parsing is the consumer's codec.
   * `baseline` omitted means the caller already diffed against its own baseline (Family's draft).
   */
  | { kind: "stage"; rung: Rung; baseline?: Rung }
  | { kind: "retire"; consumed: Rung };

/** Rungs compare as the canonical JSON of what they write, never by identity or by note. */
const same = (a: Rung | null | undefined, b: Rung | null | undefined) =>
  a != null &&
  b != null &&
  canonicalRouteInput({ value: a.value, delete: a.delete === true }) ===
    canonicalRouteInput({ value: b.value, delete: b.delete === true });
const rungOf = (rung: Rung): Rung =>
  rung.delete === true ? { delete: true } : { value: rung.value };

/** A proposal the person can still act on: present, and not already what is staged. */
const standing = (cell: TrichotomyCellLike) =>
  cell.proposal != null && !same(cell.proposal, cell.staged);

/** The transitions this actor may take on this cell, in table order: the cell's own controls. */
export function availableTransitions(
  cell: TrichotomyCellLike,
  actor: Actor,
  { lock }: { baseline: unknown; lock: string | null },
): TransitionKind[] {
  const open: Record<TransitionKind, boolean> = {
    propose: actor === "pea" && !lock,
    withdraw: actor === "pea" && cell.proposal != null,
    accept: actor === "human" && standing(cell) && !lock,
    // Allowed when locked: it only clears a stray Pea proposal.
    deny: actor === "human" && standing(cell),
    stage: actor === "human" && !lock,
    unstage: actor === "human" && cell.staged != null && !lock,
    retire: false,
  };
  return (Object.keys(cellTransitions) as TransitionKind[]).filter((kind) => open[kind]);
}

/** Bound kinds carry the rendered Work revision; `retire` carries its exact plan binding. */
export const transitionBinding = (kind: TransitionKind) => cellTransitions[kind].binding;

/** The only way anything writes a cell: the rung patches one transition makes. */
export function transitionPatches(
  cellsPath: readonly string[],
  key: string,
  cell: TrichotomyCellLike,
  transition: Transition,
): RouteStatePatch[] {
  const at = (rung: "proposal" | "staged", value: unknown): RouteStatePatch => ({
    path: [...cellsPath, key, rung],
    value,
  });
  switch (transition.kind) {
    case "propose":
      return [
        at("proposal", {
          ...rungOf(transition.rung),
          ...(transition.note != null ? { note: transition.note } : {}),
          ...(transition.confidence != null ? { confidence: transition.confidence } : {}),
        }),
      ];
    case "withdraw":
    case "deny":
      return [at("proposal", null)];
    case "accept":
      // The proposal as the caller saw it; the bound write refuses if Work moved since.
      return cell.proposal ? [at("staged", rungOf(cell.proposal))] : [];
    case "stage":
      return [
        at("staged", same(transition.rung, transition.baseline) ? null : rungOf(transition.rung)),
      ];
    case "unstage":
      return [at("staged", null)];
    case "retire":
      return [
        ...(same(cell.staged, transition.consumed) ? [at("staged", null)] : []),
        ...(same(cell.proposal, transition.consumed) ? [at("proposal", null)] : []),
      ];
  }
}

export type FanOutKind = "accept" | "deny" | "withdraw" | "unstage";
export type SkipReason = "actor" | "locked" | "contested" | "agreed" | "no-proposal" | "no-staged";

function skipReason(
  cell: TrichotomyCellLike,
  kind: FanOutKind,
  actor: Actor,
  lock: string | null,
): SkipReason | null {
  if (cellTransitions[kind].actor !== actor) return "actor";
  if (kind === "unstage") return cell.staged == null ? "no-staged" : lock ? "locked" : null;
  if (cell.proposal == null) return "no-proposal";
  if (kind === "withdraw") return null;
  if (!standing(cell)) return "agreed";
  if (kind === "deny") return null;
  if (lock) return "locked";
  return cell.staged != null ? "contested" : null;
}

/**
 * An aggregate control (header, row, group, "accept all N", a Chat count) is only this: one kind
 * over many keys, as ONE write, so one refusal covers every covered key. Keys the kind is not open
 * on are skipped with a reason. An aggregate accept also skips contested keys: it never overwrites
 * a value the person staged themselves (a single-cell accept on one still lands).
 */
export function fanOut(
  cells: Record<string, TrichotomyCellLike>,
  keys: readonly string[],
  kind: FanOutKind,
  ctx: { cellsPath: readonly string[]; actor: Actor; lockOf?: (key: string) => string | null },
): {
  patches: RouteStatePatch[];
  covered: string[];
  skipped: { key: string; reason: SkipReason }[];
} {
  const patches: RouteStatePatch[] = [];
  const covered: string[] = [];
  const skipped: { key: string; reason: SkipReason }[] = [];
  for (const key of keys) {
    const cell = cells[key] ?? {};
    const reason = skipReason(cell, kind, ctx.actor, ctx.lockOf?.(key) ?? null);
    if (reason) skipped.push({ key, reason });
    else {
      covered.push(key);
      patches.push(...transitionPatches(ctx.cellsPath, key, cell, { kind }));
    }
  }
  return { patches, covered, skipped };
}

export interface CellChange {
  from?: unknown;
  to: unknown;
}
export interface CellGroup {
  path: string[];
  proposed: number;
  staged: number;
  contested: number;
  locked: number;
  /** Distinct addresses in the group. */
  span: number;
  digest: { single: CellChange } | { many: { count: number; examples: CellChange[] } };
}

// ponytail: three examples per group; widen when Chat's wording asks for more.
const EXAMPLES = 3;

/**
 * Chat-scale counts, grouped by the route's own address path. Chat shows these and drills into the
 * route; it never lists cells. A cell's change is what it would write: staged if staged, else the
 * proposal. `to` is null for a deletion.
 */
export function summarize(
  cells: Record<string, TrichotomyCellLike>,
  ctx: {
    groupOf: (key: string) => string[];
    baselineOf: (key: string) => unknown;
    lockOf?: (key: string) => string | null;
  },
): { groups: CellGroup[] } {
  const groups = new Map<string, Omit<CellGroup, "digest"> & { changes: CellChange[] }>();
  for (const [key, cell] of Object.entries(cells)) {
    const path = ctx.groupOf(key);
    const id = JSON.stringify(path);
    let group = groups.get(id);
    if (!group) {
      group = { path, proposed: 0, staged: 0, contested: 0, locked: 0, span: 0, changes: [] };
      groups.set(id, group);
    }
    group.span += 1;
    if (cell.proposal != null) group.proposed += 1;
    if (cell.staged != null) group.staged += 1;
    if (cell.staged != null && standing(cell)) group.contested += 1;
    if (ctx.lockOf?.(key)) group.locked += 1;
    const change = cell.staged ?? cell.proposal;
    if (change == null) continue;
    const from = ctx.baselineOf(key);
    group.changes.push({
      ...(from !== undefined ? { from } : {}),
      to: change.delete === true ? null : change.value,
    });
  }
  return {
    groups: [...groups.values()].map(({ changes, ...group }) => ({
      ...group,
      digest:
        changes.length === 1
          ? { single: changes[0]! }
          : { many: { count: changes.length, examples: changes.slice(0, EXAMPLES) } },
    })),
  };
}

export function stagedEntries<TCell extends TrichotomyCellLike>(
  cells: Record<string, TCell>,
): [string, TCell][] {
  return Object.entries(cells).filter(([, cell]) => cell.staged != null);
}
