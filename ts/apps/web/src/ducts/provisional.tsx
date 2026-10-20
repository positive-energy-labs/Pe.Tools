/**
 * A pressure number resting on inferences no person has confirmed is provisional (pressure-drop
 * ledger, 2026-10-19: inference may compute, never conclude). It wears its worst grade's tone (an
 * anomalous one washed, plainly unfinished) and says so in words beside the number; the finding
 * ids it rests on are in the hint, and the findings list holds each one's confirm.
 */
import type { DuctInferenceGrade } from "@pe/agent-contracts";
import type { Provisional } from "@pe/ducts-domain/losses";
import { TooltipHint } from "@pe/kit/lang/tooltip";

export const GRADE_TONE: Record<DuctInferenceGrade, "caution" | "alarm" | undefined> = {
  "near-miss": undefined,
  stretched: "caution",
  anomalous: "alarm",
};
/** What a number's wrapper wears: the worst grade's tone, washed when anomalous; nothing when final. */
export const provisionalTone = (p: Provisional) =>
  p
    ? {
        "data-provisional": p.worst,
        "data-tone": GRADE_TONE[p.worst],
        ...(p.worst === "anomalous" ? { "data-wash": "" } : {}),
      }
    : {};

/** The words, for a sentence: " provisional · rests on N inferences, worst: G", or "" when final. */
export const provisionalWords = (p: Provisional) =>
  p
    ? ` provisional · rests on ${p.count} inference${p.count === 1 ? "" : "s"}, worst: ${p.worst}`
    : "";
/** "provisional · rests on N inferences, worst: G" beside a number; nothing when it is final. */
export function ProvisionalNote({ provisional, of }: { provisional: Provisional; of: string }) {
  if (!provisional) return null;
  const { worst, findingIds } = provisional;
  return (
    <TooltipHint
      content={`${of} rests on ${findingIds.join(", ")}; a person confirms each in the findings`}
    >
      <span
        className="t-small whitespace-nowrap"
        data-provisional-note={worst}
        data-tone={GRADE_TONE[worst]}
        {...(worst === "anomalous" ? { "data-wash": "" } : {})}
      >
        {provisionalWords(provisional).trim()}
      </span>
    </TooltipHint>
  );
}
