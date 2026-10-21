/**
 * The two bins a finding falls in (ruling 5, kaitpw 2026-10-20; MUSE axis D). The grades stay
 * metadata; the surface shows two bins:
 * - `diagnostic`: the builder bridged it and the result is final. Bridged inferred joins (a near
 *   miss, a stretched join) read as one collapsed "Assumed joins" group with no verb.
 * - `blocking`: the builder could not bridge it, so no fan-to-terminal path prices past it:
 *   an anomalous join (reversed connector, part through its host, cross-class), no root or several,
 *   an open end with no face in tolerance, an unresolved loop, no air mover (`no-fan`), a missing
 *   terminal flow. A terminal with no drop (no catalog table, input out of range) is diagnostic:
 *   terminals are priceable but never required (kaitpw 2026-10-20).
 * Pure on `{ kind, grade }`, so it classifies a survey finding and a snapshot issue alike.
 */
import type { DuctInferenceGrade } from "@pe/agent-contracts";

export type DuctBin = "diagnostic" | "blocking";

/** Finding and issue kinds the builder cannot bridge. A graded join is classed by its grade instead. */
export const BLOCKING_KINDS: ReadonlySet<string> = new Set([
  "open-end",
  "loop",
  "loop-by-inference",
  "no-root",
  "multi-root",
  "no-fan",
  "no-terminal-flow",
  "no-flow",
]);

export function bin(item: { kind: string; grade?: DuctInferenceGrade | null }): DuctBin {
  if (item.grade) return item.grade === "anomalous" ? "blocking" : "diagnostic";
  return BLOCKING_KINDS.has(item.kind) ? "blocking" : "diagnostic";
}
